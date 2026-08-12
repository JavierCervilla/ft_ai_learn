import type { CriterioRubrica, Cuaderno, Grafo, Nodo, Rama, Recurso } from "@ftai/core";
import type { crearCliente } from "./db.ts";

/**
 * Lee el grafo de Postgres y lo devuelve **en el mismo tipo que usa el núcleo**.
 *
 * Se consulta con SQL plano y no con Drizzle a propósito: `db/` vive fuera del workspace porque
 * `drizzle-kit` necesita su propio `node_modules` (ver `db/deno.json`), y arrastrar el ORM hasta aquí
 * sólo para hacer cinco `select` metería esa resolución en el servidor a cambio de nada. El tipo de
 * retorno es `Grafo`, así que el compilador sigue vigilando el mapeo.
 *
 * Cinco consultas en vez de un `join` gigante: a esta escala la diferencia es irrelevante y el código
 * se lee. Si algún día deja de serlo, se mide antes de complicarlo.
 */
export async function leerGrafo(sql: ReturnType<typeof crearCliente>): Promise<Grafo> {
  const ramas = await sql<
    { id: string; name: string; is_specialization: boolean; axis: string; target: number }[]
  >`select id, name, is_specialization, axis, target from branch order by id`;

  const nodos = await sql<{
    id: string;
    title: string;
    summary: string;
    type: string;
    branch_id: string;
    difficulty: number;
    est_minutes: number;
    micro: string;
    extended: string | null;
    stub: boolean;
    deprecated: boolean;
  }[]>`
    select id, title, summary, type, branch_id, difficulty, est_minutes, micro, extended, stub, deprecated
    from node order by id
  `;

  const aristas = await sql<{ node_id: string; prereq_id: string }[]>`
    select node_id, prereq_id from node_prereq order by node_id, prereq_id
  `;
  const recursos = await sql<{
    node_id: string;
    id: string;
    url: string;
    format: string;
    lang: string;
    minutes: number;
    why: string;
  }[]>`select node_id, id, url, format, lang, minutes, why from resource order by node_id, id`;

  const criterios = await sql<
    { node_id: string; id: string; criterion: string; how_to_check: string }[]
  >`select node_id, id, criterion, how_to_check from rubric_criterion order by node_id, id`;

  const cuadernos = await sql<
    { node_id: string; url: string; account: string; artifacts: string[]; checked_at: string }[]
  >`select node_id, url, account, artifacts, checked_at from notebook`;

  const competencias = await sql<{ node_id: string; axis: string; points: number }[]>`
    select node_id, axis, points from node_competency order by node_id, axis
  `;

  const agrupar = <T extends { node_id: string }>(filas: T[]) => {
    const m = new Map<string, T[]>();
    for (const f of filas) {
      const lista = m.get(f.node_id);
      if (lista) lista.push(f);
      else m.set(f.node_id, [f]);
    }
    return m;
  };

  const porNodo = {
    aristas: agrupar(aristas),
    recursos: agrupar(recursos),
    criterios: agrupar(criterios),
    competencias: agrupar(competencias),
  };
  const cuadernoDe = new Map(cuadernos.map((c) => [c.node_id, c]));

  return {
    branches: ramas.map((r): Rama => ({
      id: r.id,
      name: r.name,
      isSpecialization: r.is_specialization,
      axis: r.axis as Rama["axis"],
      target: r.target,
    })),
    nodes: nodos.map((n): Nodo => {
      const cuaderno = cuadernoDe.get(n.id);
      const competencies: Nodo["competencies"] = {};
      for (const c of porNodo.competencias.get(n.id) ?? []) {
        competencies[c.axis as Rama["axis"]] = c.points;
      }
      const rubrica = (porNodo.criterios.get(n.id) ?? []).map((c): CriterioRubrica => ({
        id: c.id,
        criterion: c.criterion,
        howToCheck: c.how_to_check,
      }));
      return {
        id: n.id,
        title: n.title,
        summary: n.summary,
        type: n.type as Nodo["type"],
        branch: n.branch_id,
        difficulty: n.difficulty,
        estMinutes: n.est_minutes,
        micro: n.micro,
        ...(n.extended ? { extended: n.extended } : {}),
        prerequisites: (porNodo.aristas.get(n.id) ?? []).map((a) => a.prereq_id),
        competencies,
        resources: (porNodo.recursos.get(n.id) ?? []).map((r): Recurso => ({
          id: r.id,
          url: r.url,
          format: r.format as Recurso["format"],
          lang: r.lang,
          minutes: r.minutes,
          why: r.why,
        })),
        ...(rubrica.length > 0 ? { rubric: rubrica } : {}),
        ...(cuaderno
          ? {
            notebook: {
              url: cuaderno.url,
              account: cuaderno.account,
              artifacts: cuaderno.artifacts,
              checkedAt: cuaderno.checked_at,
            } satisfies Cuaderno,
          }
          : {}),
        ...(n.stub ? { stub: true } : {}),
        ...(n.deprecated ? { deprecated: true } : {}),
      };
    }),
  };
}

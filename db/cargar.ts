/**
 * Carga el contenido de `content/*.yaml` a Postgres.
 *
 * Tres propiedades, y ninguna es decorativa:
 *
 * 1. **Valida antes de tocar la base.** Si el contenido incumple una regla del contrato, aborta sin
 *    escribir nada. Cargar "lo que se pueda" deja una base a medias que nadie sabe interpretar.
 * 2. **Es idempotente.** Cargar dos veces no cambia una fila. Es lo que permite que el arranque del
 *    contenedor cargue siempre sin pensárselo.
 * 3. **NUNCA borra un nodo.** Si un nodo está en la base y ya no está en el contenido, falla y pide
 *    que se marque `deprecated`. El `id` es la clave de la que cuelga el progreso de una persona
 *    (regla 4): un borrado silencioso le vacía el avance sin que nadie se entere. Un cargador que
 *    "sincroniza" alegremente es una pérdida de datos con buena prensa.
 *
 * Uso: `deno task contenido:cargar` (necesita `DATABASE_URL`).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { validar } from "@ftai/core";
import { leerContenido } from "../tools/contenido.ts";
import type { Grafo } from "@ftai/core";
import {
  branch,
  node,
  nodeCompetency,
  nodePrereq,
  notebook,
  resource,
  rubricCriterion,
} from "./schema.ts";

export interface Resultado {
  ramas: number;
  nodos: number;
  aristas: number;
}

export async function cargar(urlDb: string, grafo: Grafo, ahora: Date): Promise<Resultado> {
  const problemas = validar(grafo, ahora);
  if (problemas.length > 0) {
    const lista = problemas.map((p) => `  · regla ${p.regla} · ${p.donde}: ${p.mensaje}`).join(
      "\n",
    );
    throw new Error(
      `el contenido incumple ${problemas.length} regla(s); no se carga nada:\n${lista}`,
    );
  }

  const cliente = postgres(urlDb, { max: 1, onnotice: () => {} });
  const db = drizzle(cliente);
  try {
    return await db.transaction(async (tx) => {
      // --- La comprobación que protege el progreso ------------------------------------------------
      const enBase = await tx.select({ id: node.id }).from(node);
      const enContenido = new Set(grafo.nodes.map((n) => n.id));
      const desaparecidos = enBase.map((f) => f.id).filter((id) => !enContenido.has(id));
      if (desaparecidos.length > 0) {
        throw new Error(
          `estos nodos están en la base y ya no en el contenido: ${desaparecidos.join(", ")}.\n` +
            "El cargador NO borra nodos: su id es la clave del progreso de cada persona. " +
            "Si dejaron de valer, márcalos `deprecated: true` en el YAML en vez de quitarlos.",
        );
      }

      // --- Ramas ----------------------------------------------------------------------------------
      for (const r of grafo.branches) {
        await tx.insert(branch).values({
          id: r.id,
          name: r.name,
          isSpecialization: r.isSpecialization,
          axis: r.axis,
          target: r.target,
        }).onConflictDoUpdate({
          target: branch.id,
          set: {
            name: r.name,
            isSpecialization: r.isSpecialization,
            axis: r.axis,
            target: r.target,
          },
        });
      }

      // --- Nodos ----------------------------------------------------------------------------------
      for (const n of grafo.nodes) {
        await tx.insert(node).values({
          id: n.id,
          title: n.title,
          summary: n.summary,
          type: n.type,
          branchId: n.branch,
          difficulty: n.difficulty,
          estMinutes: n.estMinutes,
          micro: n.micro,
          extended: n.extended ?? null,
          stub: n.stub ?? false,
          deprecated: n.deprecated ?? false,
        }).onConflictDoUpdate({
          target: node.id,
          set: {
            title: n.title,
            summary: n.summary,
            type: n.type,
            branchId: n.branch,
            difficulty: n.difficulty,
            estMinutes: n.estMinutes,
            micro: n.micro,
            extended: n.extended ?? null,
            stub: n.stub ?? false,
            deprecated: n.deprecated ?? false,
          },
        });
      }

      // --- Lo que cuelga de un nodo -----------------------------------------------------------------
      // Estas filas SÍ se reemplazan: no son claves de nada externo, y borrar-e-insertar dentro de la
      // transacción es más simple y más fiable que calcular diferencias. La distinción con los nodos
      // es deliberada: allí el id es identidad, aquí es detalle.
      const ids = grafo.nodes.map((n) => n.id);
      await tx.delete(nodePrereq);
      await tx.delete(resource);
      await tx.delete(rubricCriterion);
      await tx.delete(notebook);
      await tx.delete(nodeCompetency);

      let aristas = 0;
      for (const n of grafo.nodes) {
        for (const pre of n.prerequisites) {
          await tx.insert(nodePrereq).values({ nodeId: n.id, prereqId: pre });
          aristas++;
        }
        for (const r of n.resources ?? []) {
          await tx.insert(resource).values({
            nodeId: n.id,
            id: r.id,
            url: r.url,
            format: r.format,
            lang: r.lang,
            minutes: r.minutes,
            why: r.why,
          });
        }
        for (const c of n.rubric ?? []) {
          await tx.insert(rubricCriterion).values({
            nodeId: n.id,
            id: c.id,
            criterion: c.criterion,
            howToCheck: c.howToCheck,
          });
        }
        if (n.notebook) {
          await tx.insert(notebook).values({
            nodeId: n.id,
            url: n.notebook.url,
            account: n.notebook.account,
            artifacts: n.notebook.artifacts,
            checkedAt: n.notebook.checkedAt,
          });
        }
        for (const [eje, puntos] of Object.entries(n.competencies ?? {})) {
          if (puntos === undefined) continue;
          await tx.insert(nodeCompetency).values({ nodeId: n.id, axis: eje, points: puntos });
        }
      }

      await tx.execute(sql`select count(*) from ${node}`); // fuerza el flush antes de cerrar
      return { ramas: grafo.branches.length, nodos: ids.length, aristas };
    });
  } finally {
    await cliente.end();
  }
}

if (import.meta.main) {
  const url = Deno.env.get("DATABASE_URL");
  if (!url) {
    console.error("falta DATABASE_URL (sólo por entorno; nunca en el repo)");
    Deno.exit(2);
  }
  const grafo = await leerContenido();
  const r = await cargar(url, grafo, new Date());
  console.log(`cargado: ${r.ramas} ramas, ${r.nodos} nodos, ${r.aristas} aristas`);
}

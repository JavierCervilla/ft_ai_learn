import type { EstadoNodo, Grafo, Nodo } from "./tipos.ts";

/**
 * Las reglas del grafo: validación y derivaciones.
 *
 * Puras y sin E/S, porque **servidor y navegador las ejecutan las dos**. El desbloqueo optimista del
 * cliente (para que la app responda sin red) y el autoritativo del servidor tienen que dar el mismo
 * resultado; escribirlas dos veces las haría divergir en silencio.
 *
 * Implementa las reglas duras de `contrato_grafo_aprendizaje.md` §4, **menos la 9** (que las URLs
 * resuelvan), que es E/S y vive en `tools/verificar-enlaces.ts`.
 */

/** Un problema encontrado. `regla` es el número del contrato, para poder rastrearlo. */
export interface Problema {
  regla: number;
  /** Nodo, rama o recurso implicado. Vacío si el problema es del grafo entero. */
  donde: string;
  mensaje: string;
}

const MINUTOS_POR_SENTADA = 15;
/** Un enlace a un tercero se pudre; el contrato le da 90 días de vida (regla 13). */
export const DIAS_CADUCIDAD_CUADERNO = 90;

/**
 * Valida el grafo entero contra el contrato.
 *
 * @param ahora  fecha de referencia para la caducidad de los cuadernos. Se **inyecta** en vez de
 *   leer el reloj: si no, la función deja de ser pura y sus tests caducan solos algún martes.
 * @returns todos los problemas encontrados, no el primero. Arreglar un grafo de uno en uno es
 *   trabajo de artesanía innecesario.
 */
export function validar(grafo: Grafo, ahora: Date): Problema[] {
  const problemas: Problema[] = [];
  const p = (regla: number, donde: string, mensaje: string) =>
    problemas.push({ regla, donde, mensaje });

  // --- Regla 3: ids únicos ---------------------------------------------------------------------
  const vistos = new Set<string>();
  for (const n of grafo.nodes) {
    if (vistos.has(n.id)) p(3, n.id, `el id "${n.id}" está repetido`);
    vistos.add(n.id);
  }
  const porId = new Map(grafo.nodes.map((n) => [n.id, n]));

  // --- Regla 14 (y su mitad del radar): ejes con target declarado -------------------------------
  const ejes = new Set(grafo.branches.map((b) => b.axis));
  const ramas = new Set(grafo.branches.map((b) => b.id));
  for (const b of grafo.branches) {
    if (!(b.target > 0)) p(14, b.id, `la rama "${b.id}" declara target=${b.target}; debe ser > 0`);
  }

  for (const n of grafo.nodes) {
    // --- Regla 2: prerequisitos existentes ------------------------------------------------------
    for (const pre of n.prerequisites) {
      if (!porId.has(pre)) p(2, n.id, `prerequisito huérfano: "${pre}" no existe`);
    }

    if (!ramas.has(n.branch)) p(2, n.id, `la rama "${n.branch}" no está declarada`);

    // --- Reglas 6 y 7: rúbricas de los nodos-proyecto -------------------------------------------
    if (n.type === "project") {
      const rubrica = n.rubric ?? [];
      if (rubrica.length === 0) p(6, n.id, "es de tipo project y no tiene rúbrica");
      for (const c of rubrica) {
        if (!c.criterion?.trim() || !c.howToCheck?.trim()) {
          p(7, `${n.id}/${c.id}`, "criterio sin `criterion` o sin `howToCheck`");
        }
      }
    }

    // --- Regla 8: recursos completos ------------------------------------------------------------
    for (const r of n.resources ?? []) {
      for (const campo of ["url", "format", "lang", "why"] as const) {
        if (!String(r[campo] ?? "").trim()) p(8, `${n.id}/${r.id}`, `recurso sin \`${campo}\``);
      }
    }

    // --- Regla 10: la unidad es la sentada de quince minutos ------------------------------------
    if (!(n.estMinutes > 0) || n.estMinutes % MINUTOS_POR_SENTADA !== 0) {
      p(
        10,
        n.id,
        `estMinutes=${n.estMinutes} no es un múltiplo positivo de ${MINUTOS_POR_SENTADA}`,
      );
    }

    // --- Regla 11: qué haces si sólo tienes quince minutos --------------------------------------
    if (!n.micro?.trim()) p(11, n.id, "sin `micro`");

    // --- Reglas 12 y 13: el cuaderno ------------------------------------------------------------
    if (n.notebook) {
      const c = n.notebook;
      for (const campo of ["url", "account", "checkedAt"] as const) {
        if (!String(c[campo] ?? "").trim()) p(12, n.id, `notebook sin \`${campo}\``);
      }
      if (!c.artifacts?.length) p(12, n.id, "notebook con `artifacts` vacío");

      const comprobado = new Date(c.checkedAt);
      if (Number.isNaN(comprobado.getTime())) {
        p(13, n.id, `notebook.checkedAt no es una fecha: "${c.checkedAt}"`);
      } else {
        const dias = Math.floor((ahora.getTime() - comprobado.getTime()) / 86_400_000);
        if (dias > DIAS_CADUCIDAD_CUADERNO) {
          p(
            13,
            n.id,
            `el cuaderno se comprobó hace ${dias} días (máximo ${DIAS_CADUCIDAD_CUADERNO})`,
          );
        }
      }
    }

    // --- Regla 14: todo eje puntuado tiene rama que lo declare ----------------------------------
    for (const eje of Object.keys(n.competencies ?? {})) {
      if (!ejes.has(eje as never)) {
        p(14, n.id, `el eje "${eje}" no lo declara ninguna rama: el radar dividiría por cero`);
      }
    }
  }

  // --- Regla 1: es un DAG ------------------------------------------------------------------------
  for (const ciclo of ciclos(grafo)) {
    p(1, ciclo.join(" → "), `ciclo: ${ciclo.join(" → ")}. El grafo no se puede recorrer`);
  }

  // --- Regla 5: todo nodo es alcanzable desde una raíz -------------------------------------------
  // Sólo tiene sentido preguntarlo si no hay ciclos: en un ciclo nada es alcanzable y el diagnóstico
  // útil ya lo dio la regla 1. Repetirlo aquí sería ruido encima del problema real.
  if (!problemas.some((x) => x.regla === 1)) {
    for (const id of inalcanzables(grafo)) {
      p(5, id, "no es alcanzable desde ningún nodo raíz");
    }
  }

  return problemas;
}

/** Los ciclos del grafo, cada uno como la lista de nodos implicados. */
export function ciclos(grafo: Grafo): string[][] {
  const porId = new Map(grafo.nodes.map((n) => [n.id, n]));
  const estado = new Map<string, 0 | 1 | 2>();
  const pila: string[] = [];
  const encontrados: string[][] = [];

  const visitar = (id: string) => {
    if (estado.get(id) === 2) return;
    if (estado.get(id) === 1) {
      // Cerramos el ciclo: recortamos la pila desde la primera aparición.
      const desde = pila.indexOf(id);
      if (desde >= 0) encontrados.push([...pila.slice(desde), id]);
      return;
    }
    estado.set(id, 1);
    pila.push(id);
    for (const pre of porId.get(id)?.prerequisites ?? []) {
      if (porId.has(pre)) visitar(pre);
    }
    pila.pop();
    estado.set(id, 2);
  };

  for (const n of grafo.nodes) visitar(n.id);
  return encontrados;
}

/** Nodos que no cuelgan de ninguna raíz. En un DAG finito sólo pasa si el grafo está roto. */
export function inalcanzables(grafo: Grafo): string[] {
  const porId = new Map(grafo.nodes.map((n) => [n.id, n]));
  const alcanzable = new Set<string>();

  const desdeRaiz = (id: string, visitando: Set<string>): boolean => {
    if (alcanzable.has(id)) return true;
    if (visitando.has(id)) return false;
    const n = porId.get(id);
    if (!n) return false;
    if (n.prerequisites.length === 0) {
      alcanzable.add(id);
      return true;
    }
    visitando.add(id);
    // Un nodo cuelga de una raíz si TODOS sus prerequisitos cuelgan de una: si le falta uno, ese
    // camino no se puede recorrer y el nodo es inalcanzable de verdad.
    const ok = n.prerequisites.every((pre) => desdeRaiz(pre, visitando));
    visitando.delete(id);
    if (ok) alcanzable.add(id);
    return ok;
  };

  return grafo.nodes.filter((n) => !desdeRaiz(n.id, new Set())).map((n) => n.id);
}

/**
 * Lo que un nodo desbloquea. **Se deriva de `prerequisites`, no se declara.**
 *
 * El contrato retiró el campo `unlocks` a propósito: dos listas describiendo la misma arista
 * divergen en cuanto alguien edita una.
 */
export function desbloqueaA(grafo: Grafo, id: string): string[] {
  return grafo.nodes.filter((n) => n.prerequisites.includes(id)).map((n) => n.id);
}

/**
 * El estado de cada nodo para un usuario.
 *
 * `available` **se deriva**, nunca se guarda: es función de los prerequisitos y del progreso, y
 * guardar un estado derivable garantiza que algún día la fila y la regla discrepen — y que gane la
 * fila.
 *
 * @param completados nodos que el usuario dio por hechos
 * @param enCurso     nodos que empezó y no terminó (opcional)
 */
export function estadoDe(
  grafo: Grafo,
  completados: ReadonlySet<string>,
  enCurso: ReadonlySet<string> = new Set(),
): Map<string, EstadoNodo> {
  const estados = new Map<string, EstadoNodo>();
  for (const n of grafo.nodes) {
    if (completados.has(n.id)) {
      estados.set(n.id, "done");
      continue;
    }
    const listo = n.prerequisites.every((pre) => completados.has(pre));
    if (!listo) estados.set(n.id, "locked");
    else estados.set(n.id, enCurso.has(n.id) ? "in_progress" : "available");
  }
  return estados;
}

/** Los nodos que se pueden empezar ahora mismo. Es la pregunta que hace la pantalla. */
export function disponibles(grafo: Grafo, completados: ReadonlySet<string>): Nodo[] {
  const estados = estadoDe(grafo, completados);
  return grafo.nodes.filter((n) => estados.get(n.id) === "available");
}

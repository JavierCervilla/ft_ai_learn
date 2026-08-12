import type { Eje, Grafo, Rama } from "./tipos.ts";

/**
 * Puntuación de un eje del radar, definida en `contrato_grafo_aprendizaje.md` §5.
 *
 *     score(eje) = min(100, 100 × puntos / target)
 *
 * El `min` no es defensivo: es deliberado. Las ramas de especialización suman al mismo eje sin
 * obligar a recorrerlas todas, así que los puntos disponibles pueden superar el objetivo.
 */
export function scoreEje(puntos: number, target: number): number {
  if (target <= 0) {
    // Un eje sin objetivo declarado es un radar dividiendo por cero. La regla 14 del contrato existe
    // para que esto no llegue aquí; si llega, se dice en alto en vez de devolver un número inventado.
    throw new Error(`target debe ser > 0 (recibido ${target})`);
  }
  return Math.min(100, Math.round((100 * puntos) / target));
}

/** Suma los puntos que aportan al eje los nodos ya completados. */
export function puntosDeEje(
  grafo: Grafo,
  eje: Eje,
  completados: ReadonlySet<string>,
): number {
  let total = 0;
  for (const nodo of grafo.nodes) {
    if (!completados.has(nodo.id)) continue;
    total += nodo.competencies[eje] ?? 0;
  }
  return total;
}

/** El radar entero: un porcentaje por rama declarada. */
export function radar(
  grafo: Grafo,
  completados: ReadonlySet<string>,
): Array<{ rama: Rama; puntos: number; score: number }> {
  return grafo.branches.map((rama) => {
    const puntos = puntosDeEje(grafo, rama.axis, completados);
    return { rama, puntos, score: scoreEje(puntos, rama.target) };
  });
}

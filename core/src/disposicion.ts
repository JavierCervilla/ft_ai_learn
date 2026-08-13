import type { Grafo, Nodo } from "./tipos.ts";

/**
 * Dónde va cada nodo en el mapa.
 *
 * **La posición se DERIVA del grafo, no se autora.** Es la misma decisión que hizo retirar `unlocks`
 * del contrato: una coordenada escrita a mano en el YAML del contenido sería un segundo sitio donde
 * vive la estructura, y divergiría en cuanto alguien moviera un prerequisito — sin que nada fallara,
 * que es la peor forma de divergir. Aquí la estructura manda: si cambias un prerequisito, la estrella
 * se mueve sola.
 *
 * Vive en `core/` y no en la webapp porque es una función **del grafo**, no de la pantalla. El
 * servidor, un futuro empaquetado nativo o una exportación a imagen la comparten sin copiar nada, que
 * es para lo que la spec §6.1 pone el núcleo portable como pieza central.
 *
 * **La forma es radial a propósito.** El dominio ya lo es —el Holy Graph de 42 es un círculo interior
 * con recorridos hacia fuera— y un layout de fuerzas daría una nube distinta en cada carga: bonita la
 * primera vez y desorientadora la segunda, porque la persona construye un mapa mental de dónde estaba
 * cada cosa. Aquí una rama siempre cae en su mismo sector y la profundidad siempre crece hacia fuera.
 */

/** Radio del anillo más interior, en unidades de `viewBox`. */
const RADIO_BASE = 120;

/** Cuánto se aleja cada nivel de prerequisitos. */
const PASO_ANILLO = 118;

/**
 * Fracción del sector que se usa para repartir nodos, dejando margen entre ramas vecinas.
 *
 * Sin este margen dos ramas contiguas se tocan por los bordes y el ojo las lee como una sola
 * constelación, que es justo la información que el sector existe para dar.
 */
const OCUPACION_SECTOR = 0.66;

export interface NodoDispuesto {
  nodo: Nodo;
  x: number;
  y: number;
  /** Cuántos prerequisitos encadenados hay que hacer antes que éste. Es el anillo. */
  profundidad: number;
}

export interface RamaDispuesta {
  id: string;
  name: string;
  /** Grados, con 0 a la derecha y creciendo en el sentido de las agujas del reloj (como en SVG). */
  anguloCentro: number;
  /** `false` cuando la rama no tiene ni un nodo: es cielo que aún no se ha explorado. */
  poblada: boolean;
}

export interface Disposicion {
  ramas: RamaDispuesta[];
  nodos: NodoDispuesto[];
}

/**
 * Cuántos prerequisitos encadenados hay antes de `id`.
 *
 * **Tolera ciclos** devolviendo 0 al reencontrar un nodo ya visitado. No es que se esperen: `validar`
 * y `ciclos` los detectan y el contenido no debería tenerlos. Pero el dibujo no puede depender de que
 * el contenido esté sano — un grafo malformado tiene que salir raro, no colgar la pestaña de quien lo
 * abre.
 */
function profundidadDe(
  id: string,
  porId: ReadonlyMap<string, Nodo>,
  visitando: Set<string>,
): number {
  if (visitando.has(id)) return 0;
  const nodo = porId.get(id);
  if (!nodo || nodo.prerequisites.length === 0) return 0;

  visitando.add(id);
  const mayor = Math.max(
    ...nodo.prerequisites.map((pre) => profundidadDe(pre, porId, visitando)),
  );
  visitando.delete(id);
  return 1 + mayor;
}

/**
 * Coloca el grafo entero.
 *
 * Es **pura y determinista**: mismo grafo, mismas coordenadas, sin `Math.random` ni relojes. Eso es lo
 * que permite probarla sin navegador y lo que hace que el mapa no se reorganice entre dos cargas.
 *
 * El orden es siempre por `id` —ramas y nodos— y no por el orden del fichero: el `id` es el único
 * campo que el contrato promete estable, así que reordenar el YAML no puede mover una estrella.
 */
export function disponer(grafo: Grafo): Disposicion {
  const porId = new Map(grafo.nodes.map((n) => [n.id, n]));
  const ramasOrdenadas = [...grafo.branches].sort((a, b) => a.id.localeCompare(b.id));
  const paso = 360 / Math.max(1, ramasOrdenadas.length);

  const ramas: RamaDispuesta[] = [];
  const nodos: NodoDispuesto[] = [];

  ramasOrdenadas.forEach((rama, indice) => {
    // `-90` pone el primer sector arriba: es donde el ojo empieza a leer.
    const anguloCentro = -90 + (indice + 0.5) * paso;

    const suyos = grafo.nodes
      .filter((n) => n.branch === rama.id)
      .sort((a, b) => a.id.localeCompare(b.id));

    ramas.push({ id: rama.id, name: rama.name, anguloCentro, poblada: suyos.length > 0 });

    // Un anillo por nivel de profundidad, para que «lo que puedes hacer antes» quede más cerca.
    const anillos = new Map<number, Nodo[]>();
    for (const nodo of suyos) {
      const d = profundidadDe(nodo.id, porId, new Set());
      const anillo = anillos.get(d);
      if (anillo) anillo.push(nodo);
      else anillos.set(d, [nodo]);
    }

    for (const [profundidad, enAnillo] of anillos) {
      const radio = RADIO_BASE + profundidad * PASO_ANILLO;
      const ancho = paso * OCUPACION_SECTOR;

      enAnillo.forEach((nodo, i) => {
        // Uno solo va al centro del sector; varios se reparten de borde a borde del ancho útil.
        const t = enAnillo.length === 1 ? 0.5 : i / (enAnillo.length - 1);
        const grados = anguloCentro - ancho / 2 + t * ancho;
        const rad = (grados * Math.PI) / 180;
        nodos.push({
          nodo,
          x: Math.cos(rad) * radio,
          y: Math.sin(rad) * radio,
          profundidad,
        });
      });
    }
  });

  return { ramas, nodos };
}

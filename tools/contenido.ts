import { parse } from "@std/yaml";
import type { Grafo } from "@ftai/core";

/**
 * Lectura del contenido de `content/`.
 *
 * Vive aquí y no en `core/` porque **el núcleo no hace E/S**: es lo que le permite correr igual en el
 * servidor y en el navegador. Y no vive en `db/` porque el validador y el comprobador de enlaces lo
 * necesitan sin arrastrar el ORM.
 */

export const DIR_CONTENIDO = new URL("../content/", import.meta.url);

/** Lee y funde todos los YAML de `content/` en un solo grafo. */
export async function leerContenido(dir: URL = DIR_CONTENIDO): Promise<Grafo> {
  const grafo: Grafo = { branches: [], nodes: [] };
  const ficheros: string[] = [];
  for await (const entrada of Deno.readDir(dir)) {
    if (entrada.isFile && (entrada.name.endsWith(".yaml") || entrada.name.endsWith(".yml"))) {
      ficheros.push(entrada.name);
    }
  }
  // Orden estable: si dos ficheros declararan la misma rama, el resultado no puede depender del
  // orden en que el sistema de ficheros los devuelva.
  ficheros.sort();

  for (const nombre of ficheros) {
    const crudo = await Deno.readTextFile(new URL(nombre, dir));
    const parte = parse(crudo) as Partial<Grafo> | null;
    if (!parte) continue;
    grafo.branches.push(...(parte.branches ?? []));
    grafo.nodes.push(...(parte.nodes ?? []));
  }
  return grafo;
}

/**
 * Valida `content/` contra las reglas duras del contrato. Gate de CI.
 *
 * No implementa ninguna regla: llama al **mismo `validar()` del núcleo** que usa el cargador y que
 * corre en los tests. Si esto tuviera su propia copia de las reglas, un contenido podría pasar el
 * gate y reventar al cargarse.
 *
 * La regla 9 (que las URLs resuelvan) NO está aquí: necesita red y vive en `verificar-enlaces.ts`.
 */
import { validar } from "@ftai/core";
import { leerContenido } from "./contenido.ts";

const grafo = await leerContenido();
const problemas = validar(grafo, new Date());

console.log(`contenido: ${grafo.branches.length} ramas, ${grafo.nodes.length} nodos`);

if (problemas.length === 0) {
  console.log(
    "sin problemas: cumple las reglas del contrato (salvo la 9, que mide `contenido:enlaces`)",
  );
  Deno.exit(0);
}

console.error(`\n${problemas.length} problema(s):`);
for (const p of problemas) {
  console.error(`  · regla ${p.regla} · ${p.donde}: ${p.mensaje}`);
}
Deno.exit(1);

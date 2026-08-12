import { describe, it } from "vitest";
import { casos } from "../../core/tests/casos.ts";

/**
 * **Criterio V3**: el núcleo da lo mismo en sus dos adaptadores.
 *
 * Este fichero no escribe ni una aserción propia: importa **los mismos casos** que corre Deno en
 * `core/tests/grafo_test.ts` y los ejecuta en el runtime de la webapp. Si escribiéramos aquí una
 * suite paralela probaríamos dos cosas parecidas, que es justo lo que la arquitectura de "un núcleo,
 * dos adaptadores" existe para evitar.
 *
 * Y prueba algo que hasta ahora sólo estaba afirmado: que `core/` es **importable de verdad** desde
 * el lado npm/Vite, no sólo desde Deno. Si esto se rompiera, el desbloqueo acabaría escrito dos veces
 * y divergiendo en silencio.
 */
describe("el núcleo portable, ejecutado desde la webapp", () => {
  for (const caso of casos) {
    it(caso.nombre, () => caso.ejecutar());
  }
});

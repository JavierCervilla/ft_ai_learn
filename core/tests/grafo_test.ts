import { casos } from "./casos.ts";

/**
 * El núcleo, ejecutado en Deno (el adaptador del servidor).
 *
 * Los casos viven en `casos.ts` y **los mismos** corre Vitest desde `webapp/`
 * (`webapp/tests/nucleo-portable.test.ts`). Ahí está el criterio V3: no es que las dos suites
 * comprueben cosas parecidas, es que ejecutan las mismas aserciones sobre el mismo código.
 */
for (const caso of casos) {
  Deno.test(caso.nombre, () => caso.ejecutar());
}

import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { comprobar } from "../enlaces.ts";

/**
 * La propiedad que hace usable a este comprobador no es que detecte enlaces muertos: es que **no
 * cuente como muerto lo que el entorno bloquea**. Un gate con falsos positivos enseña a ignorarlo.
 *
 * Los tres primeros usan un `fetch` simulado para que la suite sea determinista y no dependa de que
 * un tercero esté de pie hoy. El último sí sale a la red, porque el 403 del proxy es exactamente el
 * caso real que motivó la distinción y merece verse de verdad.
 */

const respuesta = (status: number) => () => Promise.resolve(new Response(null, { status }));

Deno.test("200 → vivo", async () => {
  const r = await comprobar(
    "https://ejemplo.test/a",
    "n/r",
    respuesta(200) as unknown as typeof fetch,
  );
  assertEquals(r.veredicto, "vivo");
});

Deno.test("404 → muerto", async () => {
  const r = await comprobar(
    "https://ejemplo.test/a",
    "n/r",
    respuesta(404) as unknown as typeof fetch,
  );
  assertEquals(r.veredicto, "muerto");
  assertEquals(r.detalle, "HTTP 404");
});

Deno.test("403 de un host cualquiera SÍ es muerto: no todo 403 es el proxy", async () => {
  const r = await comprobar(
    "https://ejemplo.test/a",
    "n/r",
    respuesta(403) as unknown as typeof fetch,
  );
  assertEquals(r.veredicto, "muerto");
});

Deno.test("403 de github.com → bloqueado, no muerto", async () => {
  const r = await comprobar(
    "https://github.com/x",
    "n/r",
    respuesta(403) as unknown as typeof fetch,
  );
  assertEquals(r.veredicto, "bloqueado");
});

Deno.test("una URL que no es URL se reporta como muerta y no revienta", async () => {
  const r = await comprobar("no-soy-una-url", "n/r");
  assertEquals(r.veredicto, "muerto");
  assertEquals(r.detalle, "no es una URL válida");
});

Deno.test({
  name: "contra la red real: github.com no se cuenta como muerto desde este entorno",
  // Sale a internet: es el caso que motivó todo esto y conviene verlo pasar de verdad.
  sanitizeResources: false,
  async fn() {
    const r = await comprobar("https://github.com/denoland/deno", "real");
    assertEquals(
      r.veredicto === "muerto",
      false,
      `github.com no debe contar como muerto: ${r.detalle}`,
    );
  },
});

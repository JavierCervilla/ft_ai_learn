import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { olvidarDesbordes } from "../src/admision.ts";
import { salud } from "../src/salud.ts";

Deno.test("todo arriba → ok", async () => {
  olvidarDesbordes();
  const s = await salud(() => Promise.resolve({ arriba: true, esquema: true }), "0.1.0");
  assertEquals(s, { ok: true, db: "up", schema: "ready", version: "0.1.0", registroDesbordes: 0 });
});

Deno.test("la base responde pero falta el esquema → NO ok", async () => {
  // El caso que un `200` hueco daría por bueno: proceso vivo, base viva, migraciones sin aplicar.
  const s = await salud(() => Promise.resolve({ arriba: true, esquema: false }), "0.1.0");
  assertEquals(s.ok, false);
  assertEquals(s.schema, "missing");
});

Deno.test("si la sonda lanza, eso ES el diagnóstico y no un 500 opaco", async () => {
  olvidarDesbordes();
  const s = await salud(() => Promise.reject(new Error("conexión rechazada")), "0.1.0");
  assertEquals(s, {
    ok: false,
    db: "down",
    schema: "unknown",
    version: "0.1.0",
    registroDesbordes: 0,
  });
});

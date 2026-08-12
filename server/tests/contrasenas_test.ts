import { assert, assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@^1.0.8";
import { COSTE, hash, verify } from "../src/contrasenas.ts";

const CLAVE = "una contraseña larga de prueba";

Deno.test("un hash verifica contra su propia contraseña", async () => {
  const h = await hash(CLAVE);
  assert(await verify({ hash: h, password: CLAVE }));
});

Deno.test("una contraseña equivocada no verifica", async () => {
  const h = await hash(CLAVE);
  assertEquals(await verify({ hash: h, password: CLAVE + "x" }), false);
  assertEquals(await verify({ hash: h, password: "" }), false);
});

Deno.test("dos hashes de la misma contraseña son distintos: hay sal", async () => {
  assertNotEquals(await hash(CLAVE), await hash(CLAVE));
});

Deno.test("el hash lleva dentro sus parámetros de coste", async () => {
  // Van dentro y no sólo en la constante para poder subirlos algún día sin invalidar lo ya guardado:
  // cada hash se verifica con el coste con el que se generó.
  assertMatch(
    await hash(CLAVE),
    new RegExp(`^argon2id\\$m=${COSTE.m},t=${COSTE.t},p=${COSTE.p}\\$`),
  );
});

Deno.test("un hash con coste distinto al actual sigue verificando", async () => {
  const [, , sal, _] = (await hash(CLAVE)).split("$");
  // Se fabrica a mano un hash "viejo" con menos memoria, como el que quedaría tras subir el coste.
  const { argon2id } = await import("@noble/hashes/argon2.js");
  const viejo = argon2id(new TextEncoder().encode(CLAVE), Buffer.from(sal!, "base64"), {
    m: 8 * 1024,
    t: 2,
    p: 1,
    dkLen: 32,
  });
  const guardado = `argon2id$m=${8 * 1024},t=2,p=1$${sal}$${Buffer.from(viejo).toString("base64")}`;
  assert(await verify({ hash: guardado, password: CLAVE }));
});

Deno.test("un hash corrupto es un login fallido, no una excepción", async () => {
  // Si esto lanzara, una fila corrupta distinguiría esa cuenta de las demás por el tipo de error.
  for (
    const roto of ["", "sin-dolares", "argon2id$m=1", "scrypt$m=1,t=1,p=1$c2Fs$aGFzaA", "$$$"]
  ) {
    assertEquals(
      await verify({ hash: roto, password: CLAVE }),
      false,
      `no debería aceptar: ${roto}`,
    );
  }
});

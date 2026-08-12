import { assert, assertEquals, assertThrows } from "jsr:@std/assert@^1.0.8";
import { cookiesSeguras, leerSecreto } from "../src/auth.ts";

const entorno = (valores: Record<string, string>) => ({
  get: (clave: string) => valores[clave],
});

Deno.test("el arranque se planta si falta el secreto de sesión", () => {
  assertThrows(() => leerSecreto(entorno({})), Error, "BETTER_AUTH_SECRET");
});

Deno.test("el arranque se planta con un secreto de juguete", () => {
  // Better Auth se limita a avisar por consola, y un aviso en un log de arranque no lo lee nadie.
  // Un servidor que firma sesiones con un secreto corto es peor que uno que no arranca.
  assertThrows(() => leerSecreto(entorno({ BETTER_AUTH_SECRET: "corto" })), Error);
});

Deno.test("un secreto de 32 caracteres o más vale", () => {
  const secreto = "x".repeat(32);
  assertEquals(leerSecreto(entorno({ BETTER_AUTH_SECRET: secreto })), secreto);
});

Deno.test("la cookie va Secure en HTTPS y no en el dev local", () => {
  // Las dos ramas tienen test porque es un fallo que no se ve mirando: incondicional rompe el dev
  // local por HTTP (la cookie no viaja y no hay login); olvidado en producción manda la sesión en
  // claro. Sólo una de las dos formas de equivocarse hace ruido al desarrollar.
  assert(cookiesSeguras("https://ftai.srcpad.pro"));
  assertEquals(cookiesSeguras("http://localhost:8000"), false);
});

/**
 * Recorrido adversario · A6 (input hostil) · FTAI-D
 *
 * HALLAZGO F1: `POST /api/registro` con `inviteCode` de tipo booleano (`true`) revienta con
 * HTTP 500 "Internal Server Error" en vez del 403 "invitación no válida" previsto.
 *
 * Causa observada (no es parte del criterio, sólo orienta): en `server/src/registro.ts` la primera
 * línea llama a `consumir(sql, peticion.inviteCode)` FUERA del try/catch. `consumir` hace
 * `if (!code) return null` —`true` es truthy, así que pasa— y ejecuta `where code = ${true}`, que en
 * Postgres es `text = boolean`: no existe el operador, la consulta lanza y el throw sube sin manejar
 * hasta Oak → 500. `false`, número y objeto sí caen en el 403 correcto; sólo el booleano `true`
 * (y cualquier truthy no-string que rompa el binding) cruza hasta el SQL.
 *
 * La promesa atacada: «el alta es sólo por invitación; no hay forma de crear una cuenta sin un código
 * válido» — aquí no se crea cuenta, pero el contrato de error se rompe: una entrada controlada por
 * quien llama tumba el endpoint con un 500 opaco en lugar de la respuesta de dominio.
 *
 * Determinista: no necesita estado previo ni concurrencia.
 *
 *   deno test -A tests/e2e/journeys/adversarial/a6-registro-500-tipo-hostil.spec.ts
 */
import { assertEquals } from "jsr:@std/assert";

const BASE = Deno.env.get("BASE_URL_TEST") ?? "http://localhost:8000";
const H = { "content-type": "application/json", origin: BASE };

Deno.test("A6 · inviteCode booleano no debe provocar 500 en /api/registro", async () => {
  const r = await fetch(`${BASE}/api/registro`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      email: `a6-${Date.now()}@ejemplo.test`,
      password: "contraseña-de-prueba-muy-larga",
      name: "A6",
      inviteCode: true, // tipo hostil
    }),
  });
  await r.body?.cancel();

  // Comportamiento CORRECTO: un código no válido (de cualquier tipo) es 403, nunca un 500.
  // Con el bug vivo esto recibe 500 y el test cae en rojo → nace el bundle.
  assertEquals(
    r.status,
    403,
    `se esperaba 403 (invitación no válida) y llegó ${r.status}: una entrada hostil no debe tumbar el endpoint`,
  );
});

/**
 * Recorrido adversario · A1/A3/A4 (concurrencia · fallo parcial · idempotencia) · FTAI-D
 *
 * HALLAZGO F2: la revocación de una invitación puede ser DERROTADA en silencio por una carrera, y
 * cuando lo es el cupo NO se devuelve y el código SIGUE VIVO creando cuentas.
 *
 * Mecánica del ataque:
 *  1. El host emite un código.
 *  2. Un tercero que conoce el código lanza altas que van a FALLAR TARDE: `name` con un byte NUL pasa
 *     la validación de Better Auth, se hashea la contraseña (Argon2id, ~285 ms) y sólo al final
 *     revienta el INSERT. Durante todo ese rato `consumir()` ya puso `used_at` y aún no corrió la
 *     compensación `liberar()`.
 *  3. El host revoca (DELETE) en esa ventana. `revocar()` (invitaciones.ts) filtra por
 *     `used_at is null`, no encuentra fila → devuelve `false` → 404 "no encontrado" — el MISMO
 *     mensaje que para un código inexistente (§12.4), así que el host cree que ya no existe. Como no
 *     hubo fila, tampoco se ejecutó el `remaining + 1`: el cupo NO se devuelve.
 *  4. La compensación `liberar()` deja el código otra vez `used_at = null`: sigue vivo. Alguien lo usa
 *     y crea una cuenta que el host creía haber cancelado.
 *
 * Promesas atacadas:
 *   #4 «el cupo se devuelve al revocar»            → NO se devuelve cuando la revocación cae en la ventana.
 *   #3 «un código se consume exactamente una vez / el host controla su ciclo» → el host pierde el
 *      control: revoca, se le dice "no encontrado", y el código crea una cuenta igualmente.
 *
 * Es una carrera de baja frecuencia (~pocos %/ronda), por eso el recorrido HAMMEREA muchas rondas con
 * concurrencia alta hasta cazarla. Empíricamente cae en rojo de sobra dentro de RONDAS con PARALELO=16
 * (observado ROTO 4–7 en 120 rondas por corrida). Si algún día deja de reproducirse, súbase RONDAS.
 *
 * SETUP: exige un host con sesión y cupo suficiente. Se pasa por entorno para no acoplar el recorrido
 * al mecanismo de bootstrap:
 *   COOKIE_HOST  — cookie de sesión del host (better-auth.session_token=...)
 *   RONDAS       — nº de rondas (por defecto 150)
 *   PARALELO     — altas doomed simultáneas por ronda (por defecto 16)
 *
 *   COOKIE_HOST='better-auth.session_token=...' \
 *     deno test -A tests/e2e/journeys/adversarial/a1-revocacion-derrotada-por-carrera.spec.ts
 */
import { assert } from "jsr:@std/assert";

const BASE = Deno.env.get("BASE_URL_TEST") ?? "http://localhost:8000";
const COOKIE_HOST = Deno.env.get("COOKIE_HOST") ?? "";
const RONDAS = Number(Deno.env.get("RONDAS") ?? 150);
const PARALELO = Number(Deno.env.get("PARALELO") ?? 16);
const H = { "content-type": "application/json", origin: BASE };
const NOMBRE_DOOMED = `a${String.fromCharCode(0)}b`; // NUL: falla TARDE, tras hashear

async function j(path: string, init: RequestInit = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  let body: unknown = null;
  try {
    body = JSON.parse(await r.text());
  } catch {
    // cuerpo vacío / no-JSON
  }
  return { status: r.status, body };
}

Deno.test("A1 · una carrera no debe derrotar la revocación ni quemar el cupo del host", async () => {
  assert(COOKIE_HOST, "falta COOKIE_HOST (cookie de sesión de un host con cupo)");

  const cupoInicial =
    ((await j("/api/invitations", { headers: { cookie: COOKIE_HOST } })).body as { cupo: number })
      .cupo;
  assert(cupoInicial >= RONDAS, `el host necesita cupo >= ${RONDAS}; tiene ${cupoInicial}`);

  let rotos = 0;
  const evidencia: string[] = [];

  for (let k = 0; k < RONDAS; k++) {
    const code =
      ((await j("/api/invitations", { method: "POST", headers: { cookie: COOKIE_HOST } }))
        .body as { code?: string }).code;
    if (!code) break;

    // Tercero: PARALELO altas que fallan tarde y mantienen `used_at` en vilo.
    const doomed = Array.from({ length: PARALELO }, (_, i) =>
      j("/api/registro", {
        method: "POST",
        body: JSON.stringify({
          email: `doomed-${Date.now()}-${k}-${i}@x.test`,
          password: "contraseña-de-prueba-muy-larga",
          name: NOMBRE_DOOMED,
          inviteCode: code,
        }),
      }));

    await new Promise((r) => setTimeout(r, 15)); // caer dentro de la ventana de hasheo
    const rev = await j(`/api/invitations/${code}`, {
      method: "DELETE",
      headers: { cookie: COOKIE_HOST },
    });
    await Promise.all(doomed);

    // El host intentó revocar. ¿Puede alguien usar el código igualmente?
    const alta = await j("/api/registro", {
      method: "POST",
      body: JSON.stringify({
        email: `superviviente-${Date.now()}-${k}@x.test`,
        password: "contraseña-de-prueba-muy-larga",
        name: "Superviviente",
        inviteCode: code,
      }),
    });

    // ROTO := el host NO logró revocar (rev != 200) Y el código creó una cuenta después (alta == 200).
    if (rev.status !== 200 && alta.status === 200) {
      rotos++;
      if (evidencia.length < 3) {
        evidencia.push(
          `ronda ${k}: revocar=${rev.status} (cupo NO devuelto) · alta-posterior=201/200 con el código "revocado"`,
        );
      }
    }
  }

  // Comportamiento CORRECTO: ninguna ronda debe terminar con una revocación derrotada que además
  // deje el código vivo. Con el bug, `rotos > 0` → rojo → nace el bundle.
  assert(
    rotos === 0,
    `revocación derrotada por carrera en ${rotos}/${RONDAS} rondas. ` +
      `El host recibió 404 "no encontrado", NO se le devolvió el cupo, y el código creó cuentas:\n  ` +
      evidencia.join("\n  "),
  );
});

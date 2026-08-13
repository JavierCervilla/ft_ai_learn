/**
 * Recorrido adversario · A5 (canal lateral) · FTAI-D.2
 *
 * ⚠️ **ESTE RECORRIDO ESTÁ ROJO A PROPÓSITO: el hallazgo NO está arreglado.**
 *
 * Se commitea rojo porque es la única reproducción de un fallo que **ya está vivo en producción**
 * —viene de `/api/registro`, que se mergeó en FTAI-D— y borrarlo para tener el árbol en verde sería
 * cambiar la evidencia por la apariencia. **No está enganchado a CI** (el paso del trinquete nombra
 * los ficheros uno a uno, y `deno test` no descubre `*.spec.ts` por su cuenta), así que no pone rojo
 * el PR de D.2 ni se cuela sin que alguien lo invoque.
 *
 * Va en su propia trayectoria, **FTAI-D.3**, porque el arreglo es de servidor y de seguridad —hacer
 * que los dos caminos cuesten lo mismo, con su medición— y no cabe honestamente en un PR de interfaz.
 * `qa-adversario` lo escaló al rol `seguridad`, y el veredicto de severidad es suyo, no mío.
 * Cuando se arregle, este fichero pasa a verde y se engancha al trinquete como los demás.
 *
 * HALLAZGO: el **oráculo de pertenencia que `seguridad` cerró en FTAI-D sigue abierto, por el reloj**.
 *
 * `registro.ts` unificó a propósito TODOS los desenlaces fallidos del alta en un 403 con el mismo
 * cuerpo (`{"error":"no se pudo completar el alta"}`) para que nadie pueda preguntarle a la API si
 * fulano está en el círculo. El rol `qa` verificó los cuatro caminos y son idénticos: mismo código,
 * mismo texto. Lo que nadie midió es **cuánto tarda cada uno**.
 *
 * LA SONDA (una sola invitación, reutilizable indefinidamente):
 *   POST /api/registro { email: <objetivo>, password: <válida>, name: "a\0b", inviteCode: <válido> }
 *
 *   El NUL en `name` hace que el alta esté condenada a fallar SIEMPRE, así que el desenlace visible
 *   es siempre el mismo 403 — y como un alta fallida **libera** el código (compensación de
 *   `registrar`), la misma invitación sirve para sondas ilimitadas. Lo único que cambia es el reloj:
 *
 *     · objetivo YA REGISTRADO   → Better Auth ve el usuario existente y corta ANTES de hashear.
 *     · objetivo DESCONOCIDO     → hashea la contraseña con Argon2id y revienta después, en el INSERT.
 *
 *   Medido en staging local: **~9 ms** frente a **~383 ms** (mediana de 6 sondas cada una). No es un
 *   sesgo estadístico que haya que promediar a lo largo de miles de peticiones: son dos poblaciones
 *   separadas por un factor 40 que se distinguen **con una sola petición**. Cualquiera con una
 *   invitación puede recorrer una lista de correos y saber quién está dentro, que es exactamente la
 *   pregunta que §12.4 prohíbe responder — y en un producto cuya premisa de privacidad ES el círculo
 *   cerrado, la pertenencia es el dato.
 *
 * ESCALADO al rol `seguridad`: la frontera que se cae es la misma que cerró el pase de seguridad de
 * FTAI-D (aquél por el código de estado, éste por la latencia). El veredicto de severidad no es del
 * pase adversario.
 *
 * ENTORNO (nunca contra producción):
 *   COOKIE_HOST  — cookie de sesión de un anfitrión con cupo (para acuñar la invitación de la sonda).
 *   SONDAS       — repeticiones por población (por defecto 7).
 *
 *   COOKIE_HOST='better-auth.session_token=…' BASE_URL_TEST=http://localhost:8010 \
 *     deno test -A tests/e2e/journeys/adversarial/a5-oraculo-de-pertenencia-por-tiempo.spec.ts
 */
import { assert } from "jsr:@std/assert";

const BASE = Deno.env.get("BASE_URL_TEST") ?? "http://localhost:8000";
const COOKIE_HOST = Deno.env.get("COOKIE_HOST") ?? "";
const SONDAS = Number(Deno.env.get("SONDAS") ?? 7);
const H = { "content-type": "application/json", origin: BASE };
const CLAVE = "contrasena-larga-de-prueba";

/** NUL en el nombre: pasa la validación y revienta en el INSERT, o sea SIEMPRE tras el hasheo. */
const NOMBRE_CONDENADO = `a${String.fromCharCode(0)}b`;

/** Umbral de indistinguibilidad: por debajo de esto el reloj no dice nada útil de una sola sonda. */
const RATIO_MAXIMO = 3;

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function sondar(email: string, code: string): Promise<{ estado: number; ms: number; cuerpo: string }> {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/registro`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password: CLAVE, name: NOMBRE_CONDENADO, inviteCode: code }),
  });
  const cuerpo = await r.text();
  return { estado: r.status, ms: performance.now() - t0, cuerpo };
}

Deno.test("A5 · el tiempo de respuesta del alta no debe delatar quién está en el círculo", async () => {
  assert(COOKIE_HOST, "falta COOKIE_HOST (cookie de sesión de un anfitrión con cupo)");

  // Un miembro de verdad al que preguntar por él, y una invitación con la que preguntar.
  const sello = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const nueva = async () => {
    const r = await fetch(`${BASE}/api/invitations`, {
      method: "POST",
      headers: { ...H, cookie: COOKIE_HOST },
      body: "{}",
    });
    assert(r.ok, `el anfitrión no pudo emitir (${r.status})`);
    return (await r.json() as { code: string }).code;
  };

  const miembro = `miembro-${sello}@ejemplo.test`;
  const alta = await fetch(`${BASE}/api/registro`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email: miembro, password: CLAVE, name: "Miembro", inviteCode: await nueva() }),
  });
  assert(alta.ok, `no se pudo crear el miembro objetivo (${alta.status})`);

  const codigoSonda = await nueva();

  const dentro: number[] = [];
  const fuera: number[] = [];
  const cuerpos = new Set<string>();
  const estados = new Set<number>();

  for (let i = 0; i < SONDAS; i++) {
    const a = await sondar(miembro, codigoSonda);
    const b = await sondar(`desconocido-${sello}-${i}@ejemplo.test`, codigoSonda);
    dentro.push(a.ms);
    fuera.push(b.ms);
    for (const r of [a, b]) {
      cuerpos.add(r.cuerpo);
      estados.add(r.estado);
    }
  }

  // Premisa del ataque: por lo que se VE, las dos poblaciones son la misma respuesta. Si esto fallara,
  // el hallazgo sería otro (el oráculo estaría en el texto, que es lo que `qa` ya comprobó que no).
  assert(
    cuerpos.size === 1 && estados.size === 1,
    `la sonda dejó de ser ciega: estados=${[...estados]} cuerpos=${[...cuerpos]}`,
  );

  // La invitación no se gasta: por eso el oráculo es ilimitado y no «un bit por invitación».
  const sigueViva = await fetch(`${BASE}/api/registro`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      email: `superviviente-${sello}@ejemplo.test`,
      password: CLAVE,
      name: "Superviviente",
      inviteCode: codigoSonda,
    }),
  });

  const mDentro = mediana(dentro);
  const mFuera = mediana(fuera);
  const ratio = Math.max(mDentro, mFuera) / Math.max(1, Math.min(mDentro, mFuera));

  assert(
    ratio < RATIO_MAXIMO,
    `oráculo de pertenencia por tiempo: un correo YA REGISTRADO responde en ${mDentro.toFixed(1)} ms ` +
      `y uno DESCONOCIDO en ${mFuera.toFixed(1)} ms (ratio ${ratio.toFixed(1)}×), con el MISMO 403 y ` +
      `el MISMO cuerpo. ${SONDAS * 2} sondas gastaron 0 invitaciones (el código seguía ` +
      `${sigueViva.ok ? "vivo" : "muerto"} al terminar): cualquiera con una invitación puede ` +
      "enumerar quién pertenece al círculo, que es justo lo que §12.4 cierra.",
  );
});

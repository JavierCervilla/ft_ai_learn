/**
 * Utilidades compartidas por los recorridos adversarios de la pantalla de acceso.
 *
 * Un anfitrión con cupo es el requisito de casi todos: sin alguien que acuñe códigos no hay nada que
 * atacar. Se consigue por DOS caminos, y admite los dos a propósito:
 *
 *  - `COOKIE_HOST` — cookie de sesión de un anfitrión ya existente (como en los recorridos
 *    adversarios de servidor, `tests/e2e/journeys/adversarial/`). Es lo que hay que usar cuando estos
 *    recorridos corren **junto a** `acceso.spec.ts`, porque el código de bootstrap es de un solo uso
 *    y aquél ya se lo gasta en su `beforeAll`.
 *  - `CODIGO_BOOTSTRAP` — se registra una cuenta raíz con él. Cómodo para correr este fichero solo.
 *
 * Sin ninguna de las dos, los recorridos se saltan: un rojo por falta de entorno no es un hallazgo.
 */
import { expect, type Page } from "@playwright/test";

export const BASE = process.env.BASE_URL_TEST ?? "http://localhost:8000";
export const CLAVE = "contraseña-de-prueba-muy-larga";

/** Un correo distinto por ejecución: la base sobrevive entre runs. */
export const sello = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

let cookieAnfitrion = "";

/** Cookie de un anfitrión con cupo, o `""` si el entorno no da ninguna de las dos vías. */
export async function anfitrion(): Promise<string> {
  if (cookieAnfitrion) return cookieAnfitrion;

  const deEntorno = process.env.COOKIE_HOST;
  if (deEntorno) {
    cookieAnfitrion = deEntorno;
    return cookieAnfitrion;
  }

  const codigo = process.env.CODIGO_BOOTSTRAP;
  if (!codigo) return "";

  const alta = await fetch(`${BASE}/api/registro`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({
      email: `anfitrion-adv-${sello()}@ejemplo.test`,
      name: "Anfitrión adversario",
      password: CLAVE,
      inviteCode: codigo,
    }),
  });
  if (!alta.ok) return "";
  cookieAnfitrion = (alta.headers.getSetCookie() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  return cookieAnfitrion;
}

/** Una invitación fresca del anfitrión. `email` la hace nominal. */
export async function invitacionDelAnfitrion(email?: string): Promise<string> {
  const cookie = await anfitrion();
  const r = await fetch(`${BASE}/api/invitations`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE, cookie },
    body: JSON.stringify(email ? { email } : {}),
  });
  if (!r.ok) throw new Error(`el anfitrión no pudo emitir (${r.status}); ¿se quedó sin cupo?`);
  return (await r.json() as { code: string }).code;
}

/** Da de alta a alguien **desde el navegador**, que es lo que esta trayectoria promete. */
export async function unirseDesdeElNavegador(
  page: Page,
  email: string,
  nombre = "Persona",
): Promise<void> {
  const codigo = await invitacionDelAnfitrion();
  await page.goto("/");
  await page.getByRole("button", { name: "Únete" }).click();
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Nombre").fill(nombre);
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByLabel("Código de invitación").fill(codigo);
  await page.getByRole("button", { name: "Unirse" }).click();
  // Desde FTAI-E.1 el alta deja en el mapa; el círculo se alcanza desde tu nombre. Estos recorridos
  // atacan las invitaciones, así que navegan hasta ahí y siguen atacando lo mismo que antes.
  await expect(page.getByRole("img", { name: "Mapa de competencias" })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: nombre }).click();
  await expect(page.getByRole("heading", { name: "Tu círculo" })).toBeVisible({ timeout: 15000 });
}

/** Las invitaciones que la API atribuye a una sesión concreta. */
export async function invitacionesDe(cookie: string) {
  const r = await fetch(`${BASE}/api/invitations`, { headers: { cookie } });
  return await r.json() as { cupo: number; invitaciones: { code: string }[] };
}

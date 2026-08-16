/**
 * Utilidades compartidas por los recorridos adversarios de **la hoja del nodo** (FTAI-E.2).
 *
 * El anfitrión y el alta se toman de `anfitrion.ts`, que ya resuelve las dos vías de entorno
 * (`COOKIE_HOST` / `CODIGO_BOOTSTRAP`) y el salto se hace igual: **un rojo por falta de entorno no es
 * un hallazgo**.
 *
 * Lo que se añade aquí es lo que hace falta para atacar el mapa y la hoja:
 *
 *  - `entrar()` — alta desde el navegador que **acaba en el mapa**, no en el círculo. Los recorridos
 *    de invitaciones necesitaban lo segundo; éstos necesitan lo primero.
 *  - `tocarEstrella()` — un toque **por coordenadas**. El halo de un nodo disponible late en bucle y
 *    la comprobación de estabilidad de Playwright no termina nunca sobre una animación infinita; un
 *    dedo de verdad tampoco espera a que se pare.
 *  - `puntoDe()` — el centro en pantalla de una estrella, para poder tocarla con **otros punteros**
 *    además del dedo. Uno de los hallazgos vive exactamente en esa diferencia.
 */
import { expect, type Page } from "@playwright/test";
import { CLAVE, invitacionDelAnfitrion, sello } from "./anfitrion";

/** La hoja abierta, sea del nodo que sea. */
export const HOJA = 'section[aria-label^="Nodo:"]';

/** El mapa, que es la pantalla de la que cuelga todo lo demás. */
export const MAPA = 'svg[aria-label="Mapa de competencias"]';

/** Un alta desde el navegador que deja a la persona **en el mapa**, mirando sus estrellas. */
export async function entrar(page: Page, nombre = "Adversaria"): Promise<string> {
  const codigo = await invitacionDelAnfitrion();
  await page.goto("/");
  await page.getByRole("button", { name: "Únete" }).click();
  await page.getByLabel("Correo").fill(`hoja-adv-${sello()}@ejemplo.test`);
  await page.getByLabel("Nombre").fill(nombre);
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByLabel("Código de invitación").fill(codigo);
  await page.getByRole("button", { name: "Unirse" }).click();
  await expect(page.locator(MAPA)).toBeVisible({ timeout: 15000 });
  // El primer encuadre llega en un efecto: sin esta espera las coordenadas son las del `viewBox`
  // provisional y los toques caen en el sitio equivocado.
  await page.waitForTimeout(700);
  return nombre;
}

/** El centro en pantalla del cuerpo de una estrella. */
export async function puntoDe(page: Page, id: string): Promise<{ x: number; y: number }> {
  const caja = await page.locator(`.mapa-nodo[data-id="${id}"] .cuerpo`).boundingBox();
  if (!caja) throw new Error(`la estrella "${id}" no tiene caja: el mapa no llegó a dibujarse`);
  return { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 };
}

/** Toca una estrella con el dedo, que es el puntero con el que el producto se diseñó. */
export async function tocarEstrella(page: Page, id: string): Promise<void> {
  const { x, y } = await puntoDe(page, id);
  await page.touchscreen.tap(x, y);
}

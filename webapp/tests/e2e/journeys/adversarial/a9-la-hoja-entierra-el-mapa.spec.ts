/**
 * Recorrido adversario · A9 (callejón sin salida) · FTAI-E.2
 *
 * PROMESA ATACADA:
 *   La hoja «**no es modal**: el mapa de detrás sigue vivo y tocar otra estrella cambia el contenido.
 *   Recorrer el mapa con la hoja abierta es el gesto natural». Si el mapa sigue vivo debajo, sus
 *   mandos tienen que seguir siendo alcanzables — si no, lo que hay no es un panel no-modal: es una
 *   pantalla completa que finge no serlo.
 *
 * EL ATAQUE: abrir una hoja y buscar el botón **«Centrar»**, que es la vuelta a casa del mapa. El
 * propio `Mapa.tsx` lo clasifica como *crítico* («dónde estoy»), no como decoración, y es lo único
 * que devuelve el encuadre después de acercarse a una estrella.
 *
 * LO QUE PASA: «Centrar» está en `fixed right-4 bottom-6 z-10`; la hoja es `fixed inset-x-0 bottom-0
 * z-20` y ocupa el 45 % de abajo (el 92 % en la altura alta). El botón queda **debajo de la hoja**,
 * en las dos alturas. Y lo peor para quien lea una suite: sigue *existiendo* y `isVisible()` sigue
 * diciendo `true` —no está oculto, está tapado—, así que un aserto de visibilidad pasaría con el
 * mando enterrado. Lo que no pasa es el toque: en las coordenadas del botón lo que hay es la hoja.
 *
 * EL CALLEJÓN: te acercas a una estrella (pellizco), la tocas, lees la hoja, y ahora quieres volver a
 * ver el mapa entero. Con la hoja abierta no puedes: el único mando de vuelta está debajo de ella.
 * Hay que cerrar la hoja para recuperar el encuadre — es decir, exactamente lo que la hoja promete
 * que **no** hace falta.
 *
 * CÓMO CORRERLO (staging efímero, ver la cabecera de `anfitrion.ts`):
 *   CODIGO_BOOTSTRAP=… BASE_URL_TEST=http://localhost:8030 npx playwright test a9-la-hoja-entierra
 */
import { expect, test } from "../../fixtures/qa-bundle";
import { anfitrion } from "./anfitrion";
import { entrar, HOJA, tocarEstrella } from "./hoja-del-nodo";

/** El producto es móvil primero, y sus recorridos también: mismo lienzo que `hoja.spec.ts`. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

/** Quién recibe de verdad un toque en el centro del botón: él, o lo que tenga encima. */
async function respondeAlToque(page: import("@playwright/test").Page, nombre: string) {
  const boton = page.getByRole("button", { name: nombre });
  const caja = await boton.boundingBox();
  if (!caja) return { alcanzable: false, encima: "no tiene caja" };
  return await page.evaluate(([x, y]) => {
    const arriba = document.elementFromPoint(x, y);
    const boton = arriba?.closest("button");
    return {
      alcanzable: !!boton && boton.textContent?.includes("Centrar") === true,
      encima: arriba ? `${arriba.tagName}.${(arriba.className ?? "").toString().slice(0, 40)}` : "nada",
    };
  }, [caja.x + caja.width / 2, caja.y + caja.height / 2] as const);
}

test("A9 · con la hoja abierta, el mapa conserva su vuelta a casa", async ({ page, qa }) => {
  qa.step("entrar y tocar una estrella");
  await entrar(page);
  await tocarEstrella(page, "f0-entorno");
  await expect(page.locator(HOJA)).toBeVisible();

  qa.step("«Centrar» sigue en pantalla —y `isVisible()` lo confirma, que es la trampa—");
  await expect(page.getByRole("button", { name: "Centrar" })).toBeVisible();

  qa.step("pero ¿quién recibe el toque en sus coordenadas?");
  const baja = await respondeAlToque(page, "Centrar");

  // Comportamiento CORRECTO: si el mapa sigue vivo debajo, su mando crítico se puede tocar. Que el
  // botón *exista* no basta: un objetivo táctil enterrado es un mando que no está.
  expect(
    baja.alcanzable,
    `con la hoja en la altura baja, en el centro de «Centrar» lo que hay es ${baja.encima}: la hoja ` +
      "(`z-20`, 45 % inferior) entierra el único mando que devuelve el encuadre del mapa (`z-10`, " +
      "`bottom-6`). Quien se acercó a una estrella y abrió su hoja ya no puede volver a ver el mapa " +
      "entero sin cerrarla — el panel que promete no ser modal se comporta como si lo fuera.",
  ).toBe(true);

  qa.step("y en la altura alta, donde la hoja ocupa el 92 %, todavía menos");
  await page.getByRole("button", { name: "Ampliar la hoja" }).click();
  await page.waitForTimeout(500);
  const alta = await respondeAlToque(page, "Centrar");
  expect(
    alta.alcanzable,
    `en la altura alta, en el centro de «Centrar» hay ${alta.encima}.`,
  ).toBe(true);
});

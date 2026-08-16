/**
 * Recorrido adversario · A12 (la promesa vs lo entregado) · FTAI-E.2
 *
 * A12 es la clase que se admite sin repro. Ésta **trae repro**, así que no es un juicio: es un hecho.
 *
 * PROMESA ATACADA, en sus cuatro primeras palabras:
 *   «**Tocas una estrella** y sabes qué hacer en quince minutos.»
 *
 * EL ATAQUE: tocarla con algo que no sea un dedo. Un ratón, un trackpad, un lápiz, el puntero de un
 * conmutador de accesibilidad. La app se sirve por web y se abre en el navegador que haya delante.
 *
 * LO QUE PASA: **no se abre nada**. Medido en este entorno, con un `click` de ratón en el centro
 * exacto del cuerpo de la estrella (el mismo punto que con el dedo sí funciona):
 *
 *   RATÓN → pointerup → svg…  ·  click → **svg**            · hojas abiertas: 0
 *   DEDO  → pointerup → svg…  ·  click → **circle.cuerpo**  · hojas abiertas: 1
 *
 * El `onPointerDown` del mapa llama a `setPointerCapture` en el `<svg>` para cada puntero (lo que
 * arregló el pellizco a dos dedos en E.1.2). Con un puntero de ratón, Chromium entrega el `click`
 * compatible **al elemento que tiene la captura** —el `<svg>`— y no al `<g role="button">` de la
 * estrella, así que su `onClick` no llega a ejecutarse nunca. Con un puntero táctil el `click` sí se
 * dirige al elemento golpeado y la hoja abre.
 *
 * POR QUÉ NADIE LO VIO: los ocho recorridos que dan esta hoja por buena tocan las estrellas con
 * `page.touchscreen.tap()` — con razón, porque el producto es móvil primero. Pero eso deja **una sola
 * modalidad de entrada** cubierta, y la promesa no dice «tocas una estrella con el dedo». En un
 * portátil el mapa es una constelación decorativa: las estrellas no hacen nada, y la persona no tiene
 * forma de saber que le falta un dedo. (El teclado sí funciona: `Tab` + `Enter` abre la hoja, así que
 * el nodo es alcanzable — sólo que por el camino que nadie prueba primero.)
 *
 * DÓNDE SE MANIFIESTA: `webapp/src/Mapa.tsx:246` (`e.currentTarget.setPointerCapture`). La captura es
 * de E.1.2 y esta trayectoria no la tocó; lo que E.2 añade es la promesa que se rompe encima.
 *
 * CÓMO CORRERLO (staging efímero, ver la cabecera de `anfitrion.ts`):
 *   CODIGO_BOOTSTRAP=… BASE_URL_TEST=http://localhost:8030 npx playwright test a12-la-estrella
 */
import { expect, test } from "../../fixtures/qa-bundle";
import { anfitrion } from "./anfitrion";
import { entrar, HOJA, puntoDe } from "./hoja-del-nodo";

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

/*
 * Los dos punteros van en bloques separados **a propósito**: el ratón se prueba en un lienzo de
 * escritorio (que es donde hay ratón) y el dedo en el de 390×844 del resto de la suite. Es la única
 * variable que cambia entre los dos tests, y es justo la que se está midiendo.
 */
test.describe("con el ratón, en un portátil", () => {
  test("A12 · tocar una estrella con el ratón abre su hoja", async ({ page, qa }) => {
    qa.step("entrar al mapa");
    await entrar(page);

    qa.step("apuntar al centro del cuerpo de la estrella y comprobar que ahí está ella");
    const { x, y } = await puntoDe(page, "f0-entorno");
    const encima = await page.evaluate(
      ([px, py]) => {
        const el = document.elementFromPoint(px, py);
        return el ? `${el.tagName}.${el.classList?.value ?? ""}` : "nada";
      },
      [x, y] as const,
    );
    expect(encima, "el punto elegido no es la estrella; el ataque no aplica").toContain("cuerpo");

    qa.step(`hacer clic con el ratón en (${Math.round(x)}, ${Math.round(y)})`);
    await page.mouse.click(x, y);
    await page.waitForTimeout(1200);

    // Comportamiento CORRECTO: tocar una estrella abre su hoja. Con el dedo, con el ratón, con el
    // lápiz. La promesa no lleva asterisco de puntero.
    await expect(
      page.locator(HOJA),
      "con el ratón, un clic en el centro de la estrella no abre nada: `setPointerCapture` en el " +
        "`<svg>` (`Mapa.tsx:246`) hace que Chromium entregue el `click` de ratón al svg y no al " +
        "`<g role=\"button\">` de la estrella, cuyo `onClick` no llega a correr. Con el dedo, el mismo " +
        "punto sí abre la hoja. En un portátil, el mapa entero es decorativo.",
    ).toBeVisible({ timeout: 3000 });
  });
});

test.describe("con el dedo, en el móvil (control)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("A12 · el dedo abre la misma estrella en el mismo punto (control)", async ({ page, qa }) => {
    qa.step("entrar al mapa");
    await entrar(page);

    qa.step("mismo punto, otro puntero: el dedo");
    const { x, y } = await puntoDe(page, "f0-entorno");
    await page.touchscreen.tap(x, y);

    // Este pasa. Está aquí para que el rojo de arriba no se pueda leer como «las coordenadas estaban
    // mal» ni como «el entorno no arrancó»: la diferencia es el puntero, y nada más.
    await expect(page.locator(HOJA)).toBeVisible({ timeout: 3000 });
  });
});

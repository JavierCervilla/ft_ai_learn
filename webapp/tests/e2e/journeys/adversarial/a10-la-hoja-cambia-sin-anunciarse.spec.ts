/**
 * Recorrido adversario · A10 (feedback ausente) · FTAI-E.2
 *
 * PROMESA ATACADA:
 *   «Tocas una estrella y **sabes** qué hacer en quince minutos» — también si lo que te lee la
 *   pantalla es un lector. La hoja lo tiene escrito como requisito propio: el bloque del título va
 *   con `aria-live="polite"` «porque con la hoja abierta se cambia de nodo tocando otra estrella:
 *   sin esto, quien usa lector de pantalla no se entera de que el contenido entero cambió bajo sus
 *   manos».
 *
 * EL ATAQUE: marcar el elemento que lleva el `aria-live`, tocar otra estrella y volver a buscarlo.
 *
 * LO QUE PASA: no está. `Dentro.tsx` remonta la hoja con `key={nodo.id}`, así que al cambiar de nodo
 * la región viva **se destruye y se crea otra nueva ya con su texto dentro**. Una región `aria-live`
 * anuncia los cambios que ocurren *dentro de una región que ya estaba*: una recién insertada con su
 * contenido no dispara anuncio (NVDA/VoiceOver/TalkBack la tratan como contenido nuevo del árbol, no
 * como una actualización), y la anterior ya no existe para poder cambiar. El mecanismo es inerte:
 * el atributo está puesto y no puede anunciar nada nunca.
 *
 * Es un aserto de la familia «pasaría con la feature rota» al revés: la marca de accesibilidad está
 * en el DOM —cualquier comprobación que busque `aria-live` la encuentra— y aun así el efecto que
 * justifica ponerla no ocurre. Quien navega con lector toca una estrella, sigue oyendo el nodo
 * anterior bajo el foco y no tiene ninguna señal de que la hoja habla ya de otra cosa.
 *
 * NOTA DE ALCANCE: esto se afirma sobre el DOM, que es lo que un recorrido puede medir; el
 * comportamiento del lector no se simula aquí. La condición que se exige abajo —que la región viva
 * **sobreviva** al cambio de contenido— es el requisito estándar para que un `aria-live` funcione.
 *
 * CÓMO CORRERLO (staging efímero, ver la cabecera de `anfitrion.ts`):
 *   CODIGO_BOOTSTRAP=… BASE_URL_TEST=http://localhost:8030 npx playwright test a10-la-hoja-cambia
 */
import { expect, test } from "../../fixtures/qa-bundle";
import { anfitrion } from "./anfitrion";
import { entrar, HOJA, tocarEstrella } from "./hoja-del-nodo";

/** El producto es móvil primero, y sus recorridos también: mismo lienzo que `hoja.spec.ts`. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

test("A10 · al cambiar de nodo, la región que anuncia el cambio sigue viva", async ({
  page,
  qa,
}) => {
  qa.step("entrar y abrir la hoja de un nodo");
  await entrar(page);
  await tocarEstrella(page, "f0-entorno");
  await expect(page.locator(HOJA)).toBeVisible();

  qa.step("marcar la región `aria-live` que la hoja pone para anunciar el cambio");
  const marcada = await page.evaluate((sel) => {
    const viva = document.querySelector(`${sel} [aria-live]`);
    if (!viva) return false;
    viva.setAttribute("data-marca-adversaria", "1");
    return true;
  }, HOJA);
  expect(marcada, "la hoja no tiene región `aria-live`: el ataque no aplica").toBe(true);

  qa.step("tocar otra estrella con la hoja abierta — el gesto que la región existe para cubrir");
  await tocarEstrella(page, "f0-hola-datos");
  await expect(page.locator(`${HOJA} h2`)).toHaveText("Hola, Datos");

  // Comportamiento CORRECTO: la región viva **persiste** y lo que cambia es su contenido; así es como
  // un `aria-live` anuncia. Si la región se destruye y se crea otra con el texto ya dentro, no hay
  // anuncio que dar y el atributo es decorativo.
  await expect(
    page.locator("[data-marca-adversaria]"),
    "la región `aria-live` no sobrevive al cambio de nodo: `key={nodo.id}` remonta la hoja entera, " +
      "así que la región vieja se destruye y la nueva nace con su contenido dentro. Un `aria-live` " +
      "así no anuncia nunca: quien usa lector no se entera de que la hoja pasó a hablar de otro " +
      "nodo, que es exactamente lo que el atributo se puso para evitar.",
  ).toBeAttached({ timeout: 3000 });
});

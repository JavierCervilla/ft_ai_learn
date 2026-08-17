/**
 * Recorrido adversario · A10 (feedback ausente) · FTAI-E.2
 *
 * PROMESA ATACADA:
 *   «**Un nodo sin cuaderno sigue siendo plenamente usable.**» Hoy *ningún* nodo de Fase 0 trae
 *   `notebook`, así que ese «sin cuaderno» no es un caso raro: **es el único que existe**. Y el único
 *   camino que la hoja ofrece entonces es «Crea el tuyo: copiar las fuentes». Si ese camino falla en
 *   silencio, la degradación V8 no es una degradación: es un botón que a veces miente.
 *
 * EL ATAQUE: que el navegador deniegue el portapapeles. No es hipotético —se ha comprobado en este
 * mismo entorno que abriendo la app por un origen **no seguro** (`http://<ip>:8030`, cualquier
 * despliegue en LAN o webview sin TLS) `navigator.clipboard` es literalmente `undefined`—, y Chrome
 * rechaza además con `NotAllowedError` cuando el documento no tiene el foco. Aquí se **inyecta** el
 * rechazo con `addInitScript` para que el recorrido sea determinista y no dependa del origen: la
 * rotura que se mide no es *por qué* falla, sino **qué se le cuenta a la persona cuando falla**.
 *
 * LO QUE PASA: nada. `copiarFuentes()` hace `catch { setCopiado(false) }`, y `false` es el estado en
 * el que ya estaba: **ni un carácter cambia en la hoja**. El botón sigue invitando a copiar y el
 * párrafo de debajo sigue diciendo «Con las fuentes en el portapapeles, crea un cuaderno en tu cuenta
 * y **pégalas**». La persona se va a su cuenta, pega lo que llevara antes en el portapapeles, y el
 * único camino que la app le deja para un nodo sin cuaderno se ha roto sin avisar. El comentario de
 * ese `catch` dice «no se finge que fue bien: se dice, que es la regla de esta app para cualquier
 * fallo» — la intención está escrita, el aviso no está en ningún sitio.
 *
 * CÓMO CORRERLO (staging efímero, ver la cabecera de `anfitrion.ts`):
 *   CODIGO_BOOTSTRAP=… BASE_URL_TEST=http://localhost:8030 npx playwright test a10-el-portapapeles
 */
import { expect, test } from "../../fixtures/qa-bundle";
import { anfitrion } from "./anfitrion";
import { entrar, HOJA, tocarEstrella } from "./hoja-del-nodo";

/** El producto es móvil primero, y sus recorridos también: mismo lienzo que `hoja.spec.ts`. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

test("A10 · si el portapapeles se deniega, la hoja lo dice", async ({ page, context, qa }) => {
  qa.step("el navegador deniega el portapapeles, como en un origen sin TLS o sin foco");
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")),
      },
    });
  });

  qa.step("entrar, abrir un nodo (ninguno de Fase 0 tiene cuaderno) y desplegar la altura alta");
  await entrar(page);
  await tocarEstrella(page, "f0-entorno");
  await expect(page.locator(HOJA)).toBeVisible();
  await page.getByRole("button", { name: "Ampliar la hoja" }).click();

  const copiar = page.getByRole("button", { name: /copiar las fuentes/i });
  await expect(copiar).toBeVisible();
  const antes = await page.locator(HOJA).innerText();

  qa.step("pulsar el único camino que la hoja ofrece para un nodo sin cuaderno");
  await copiar.click();
  await page.waitForTimeout(1000);
  const despues = await page.locator(HOJA).innerText();

  // Comportamiento CORRECTO: cuando la copia falla, **algo** cambia en la hoja. Da igual qué diga o
  // dónde lo diga; lo que no puede es quedarse exactamente igual mientras el párrafo de debajo sigue
  // dando por hecho que las fuentes están en el portapapeles.
  expect(
    despues,
    "el portapapeles falló y la hoja no cambió ni un carácter: `copiarFuentes()` traga el rechazo " +
      "en un `catch` que devuelve el botón al estado en el que ya estaba. El texto sigue diciendo " +
      "«Con las fuentes en el portapapeles… pégalas», así que la persona pega lo que llevara de " +
      "antes. En Fase 0 ningún nodo tiene cuaderno: éste es EL camino, no el de repuesto.",
  ).not.toBe(antes);
});

/**
 * Recorrido adversario · A9 (degradación / modo desconectado) · FTAI-D.2
 *
 * PROMESA ATACADA (§13.4, criterio 4 de la trayectoria):
 *   «La app sigue siendo instalable y **funciona offline de verdad**.»
 *
 * El rol `qa` comprobó que el service worker se registra y que el manifiesto responde 200. Eso mide
 * que la PWA es *instalable*, no que **sirva de algo sin cobertura**, que es el escenario principal
 * de la spec (§2.2: se usa en el metro). Aquí se corta la red de verdad y se mira la pantalla.
 *
 * Dos roturas, una por test:
 *
 * A9-1 · EN FRÍO: PANTALLA EN BLANCO.
 *   Tras instalar, el caché contiene exactamente `["/", "/index.html", "/manifest.webmanifest"]`
 *   (medido) — el bundle JS **no está**: los `assets/*` de la primera carga se pidieron antes de que
 *   el SW tomara el control, y la precarga de `install` no los incluye. Sin red, el SW sirve
 *   `/index.html` de caché, y para `/assets/index-*.js` cae al fallback `caches.match("/index.html")`:
 *   el `<script type="module">` recibe **text/html** y el navegador lo rechaza
 *   («Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of
 *   "text/html"»). `#root` se queda vacío: la app offline es una **página en blanco**.
 *
 * A9-2 · EN CALIENTE: «ESTÁS FUERA» EN VEZ DE «NO HAY RED».
 *   Con los assets ya cacheados, la app sí pinta — y le enseña el formulario de acceso a quien
 *   **tiene la sesión viva**. `sesionActual()` (`src/api.ts`) envuelve el fallo de red en
 *   `catch { return null }`, y `null` significa «no hay sesión». O sea que el cliente **disfraza un
 *   fallo de red de cierre de sesión**, justo lo que el comentario de cabecera de ese mismo fichero
 *   dice que no hay que hacer («Un fallo de red se dice; no se traga ni se disfraza»). La persona ve
 *   un login que offline no puede funcionar, y creerá que la app la ha echado.
 *
 * CÓMO CORRERLO (staging efímero, ver la cabecera de `anfitrion.ts`):
 *   COOKIE_HOST='better-auth.session_token=…' BASE_URL_TEST=http://localhost:8010 \
 *     npx playwright test a9-offline
 */
import { expect, test } from "../../fixtures/qa-bundle";
import { anfitrion, sello, unirseDesdeElNavegador } from "./anfitrion";

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

test("A9 · sin red y en frío, la app abre (y no una página en blanco)", async ({
  page,
  context,
  qa,
}) => {
  qa.step("entrar desde el navegador con una invitación");
  await unirseDesdeElNavegador(page, `a9-frio-${sello()}@ejemplo.test`, "Frío");

  qa.step("esperar a que el service worker tome el control (es lo que promete el modo offline)");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
    timeout: 15000,
  });

  qa.step("cortar la red — el escenario del metro");
  await context.setOffline(true);
  await page.reload({ waitUntil: "load" }).catch(() => {/* offline: la carga puede no completar */});
  await page.waitForTimeout(1500);

  qa.step("mirar si hay algo pintado");
  const raiz = await page.locator("#root").innerHTML();
  // Comportamiento CORRECTO: sin cobertura la app **abre**. Da igual qué enseñe (su cuenta, o un
  // aviso honesto de que no hay red): lo que no puede es no enseñar NADA.
  expect(
    raiz.trim(),
    "sin red la app se queda en blanco: el SW sirve index.html como respuesta al módulo JS y el " +
      "navegador lo rechaza por MIME. Una PWA que en el metro es una página en blanco no está " +
      "«funcionando offline», está instalada.",
  ).not.toBe("");
});

test("A9 · sin red y en caliente, no se le dice a quien tiene sesión que está fuera", async ({
  page,
  context,
  qa,
}) => {
  qa.step("entrar desde el navegador con una invitación");
  await unirseDesdeElNavegador(page, `a9-calor-${sello()}@ejemplo.test`, "Calor");

  qa.step("una recarga ONLINE con el SW ya al mando: ahora sí se cachean los assets");
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
    timeout: 15000,
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Tu círculo" })).toBeVisible({ timeout: 15000 });

  qa.step("cortar la red y recargar: la sesión NO ha caducado, sólo falta cobertura");
  await context.setOffline(true);
  await page.reload({ waitUntil: "load" }).catch(() => {/* offline */});
  await page.waitForTimeout(1500);

  // Comportamiento CORRECTO: un fallo de red no es un cierre de sesión. La pantalla de acceso —con
  // su botón «Entrar», que offline no puede funcionar— es una mentira sobre el estado de la cuenta.
  await expect(
    page.getByRole("button", { name: "Entrar", exact: true }),
    "sin red la app enseña el formulario de acceso a quien tiene la sesión viva: `sesionActual()` " +
      "traga el fallo de red y devuelve null, que el cliente lee como «no hay sesión».",
  ).toBeHidden();
});

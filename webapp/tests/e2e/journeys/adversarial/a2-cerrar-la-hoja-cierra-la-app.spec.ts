/**
 * Recorrido adversario · A2 (estado stale y botón atrás) · FTAI-E.2
 *
 * PROMESA ATACADA, literal:
 *   «**El botón atrás cierra la hoja, no la app.**»
 *
 * Ése es el motivo declarado de que exista `rutas.ts` entero. El rol `qa` lo comprobó por el camino
 * que lo inspiró: estás en el mapa, tocas una estrella (`pushState`), atrás → la hoja se cierra y
 * sigues dentro. Ese camino funciona. Los dos de abajo no.
 *
 * A2-1 · LA «X» DE UNA HOJA ABIERTA POR ENLACE **CIERRA LA APLICACIÓN**.
 *   `cerrarNodo()` es `history.back()` **incondicional**. Cuando la hoja se abre por navegación
 *   propia hay una entrada debajo y volver es correcto; cuando la hoja **es la primera entrada** de
 *   la pestaña, debajo no hay app: hay lo que hubiera antes. Y ése no es un caso rebuscado, es el
 *   caso de un `#/nodo/<id>`: un enlace compartido abierto en una pestaña nueva, un marcador, o
 *   simplemente entrar con el hash puesto (el formulario de acceso lo conserva). Medido aquí: tras
 *   pulsar la «×» de la hoja la pestaña acaba en `about:blank` — la persona pulsó *cerrar la hoja* y
 *   se le fue la aplicación. En el empaquetado para tiendas de §6.2 eso es la app cerrándose, que es
 *   textualmente lo que este módulo existe para impedir.
 *
 * A2-2 · DESDE TU CÍRCULO, EL ATRÁS SE COME UNA PULSACIÓN Y LA SIGUIENTE CIERRA LA APP.
 *   `Dentro.tsx` desmonta la hoja al ir a la cuenta (`pantalla === "cuenta"` corta antes), pero el
 *   nodo abierto **sigue en la URL**. Con la hoja abierta vas a tu círculo y pulsas atrás: se
 *   consume la entrada de la hoja —que ya no está en pantalla— y **no pasa nada visible**. La
 *   siguiente pulsación, la que la persona da precisamente porque la primera no hizo nada, sale de
 *   la app. Un atrás mudo es el que hace que el siguiente sea destructivo.
 *
 * CÓMO CORRERLO (staging efímero, ver la cabecera de `anfitrion.ts`):
 *   CODIGO_BOOTSTRAP=… BASE_URL_TEST=http://localhost:8030 npx playwright test a2-cerrar-la-hoja
 */
import { expect, test } from "../../fixtures/qa-bundle";
import { anfitrion } from "./anfitrion";
import { entrar, HOJA, MAPA, tocarEstrella } from "./hoja-del-nodo";

/** El producto es móvil primero, y sus recorridos también: mismo lienzo que `hoja.spec.ts`. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

test("A2 · la «×» de una hoja abierta por enlace cierra la hoja, no la app", async ({
  page,
  context,
  qa,
}) => {
  qa.step("entrar (la sesión vive en la cookie, así que vale para cualquier pestaña)");
  await entrar(page);

  qa.step("abrir el enlace del nodo en una pestaña NUEVA, como quien recibe un enlace compartido");
  const compartida = await context.newPage();
  await compartida.goto("/#/nodo/f0-entorno");
  await expect(compartida.locator(HOJA)).toBeVisible({ timeout: 15000 });

  qa.step("pulsar la «×» de la hoja: es el gesto de cerrar la hoja, no el de salir");
  await compartida.getByRole("button", { name: "Cerrar" }).click();
  await compartida.waitForTimeout(1000);

  // Comportamiento CORRECTO: cerrar la hoja te devuelve al mapa. Da igual cómo llegaste a ella.
  await expect(
    compartida.locator(MAPA),
    "tras pulsar la «×» la pestaña se va de la aplicación (aquí acaba en `about:blank`): " +
      "`cerrarNodo()` hace `history.back()` sin mirar si hay algo nuestro debajo, y en una hoja " +
      "abierta por enlace no lo hay. Cerrar la hoja cerró la app — justo lo que `rutas.ts` dice que " +
      "viene a evitar.",
  ).toBeVisible({ timeout: 5000 });
});

test("A2 · con la hoja abierta, ir a tu círculo no envenena el botón atrás", async ({
  page,
  qa,
}) => {
  qa.step("entrar y abrir una hoja tocando su estrella");
  const nombre = await entrar(page);
  await tocarEstrella(page, "f0-entorno");
  await expect(page.locator(HOJA)).toBeVisible();

  qa.step("con la hoja abierta, ir a tu círculo desde tu nombre");
  await page.getByRole("button", { name: nombre }).click();
  await expect(page.getByRole("heading", { name: "Tu círculo" })).toBeVisible();

  qa.step("primer atrás: consume la entrada de una hoja que ya no está en pantalla");
  await page.goBack();
  await page.waitForTimeout(600);

  qa.step("segundo atrás: el que la persona da porque el primero no hizo nada");
  await page.goBack().catch(() => {/* si sale de la app, la navegación puede ni resolver */});
  await page.waitForTimeout(800);

  // Comportamiento CORRECTO: dos pulsaciones de atrás desde dentro de la app pueden llevarte al mapa
  // o dejarte donde estabas, pero **no** sacarte de la aplicación. Aquí la segunda te saca: la
  // pestaña acaba fuera de nuestro documento y `#root` deja de existir.
  await expect(
    page.locator("#root"),
    `dos pulsaciones de atrás desde tu círculo (con una hoja abierta detrás) sacan de la app — la ` +
      `pestaña acabó en "${page.url()}". La primera gasta la entrada de la hoja sin efecto visible ` +
      "—`Dentro.tsx` la desmonta al ir a la cuenta, pero el id sigue en la URL— y la segunda se " +
      "lleva la pestaña fuera.",
  ).toBeAttached({ timeout: 5000 });
});

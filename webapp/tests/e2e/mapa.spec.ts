import { request } from "@playwright/test";
import { expect, test } from "./fixtures/qa-bundle";

/**
 * El mapa, recorrido en el móvil — criterios **G4, G5 y G6** de FTAI-E.1.
 *
 * Corre contra el servidor de verdad, como todo lo de este repo: lo que hay que probar es que el mapa
 * dibuja **el grafo que sirve la API**, y con un grafo de mentira estaríamos probando el mock.
 *
 * El viewport es 390×844 a propósito: es el dispositivo del humano y el escenario declarado de la spec
 * (§2.2, el metro). Un mapa que sólo funciona en escritorio no cumple nada de lo que promete.
 */

const CODIGO = process.env.CODIGO_BOOTSTRAP ?? "";
const CLAVE = "contraseña-de-prueba-muy-larga";
const BASE = process.env.BASE_URL_TEST ?? "http://localhost:8000";
const sello = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

// `hasTouch` no es decorativo: el fallo del recuadro blanco **sólo se manifiesta al tocar** —con ratón,
// Chrome no da el foco a un `<g>` al hacer clic— así que un recorrido sin táctil pasaría en verde con el
// bug delante. El dispositivo declarado de la spec es un móvil; que el recorrido lo sea también.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

/**
 * Quién invita al siguiente recorrido.
 *
 * **Es una cadena, no una raíz que reparte a todos**, y el motivo es el cupo: cada cuenta tiene tres
 * invitaciones y este fichero ya pide cuatro. Con la raíz como única anfitriona, el cuarto recorrido se
 * comía un 409 que no dice nada de lo que se está probando. Cada cuenta recién creada pasa a ser la
 * anfitriona de la siguiente, que además es exactamente cómo crece un círculo cerrado de verdad.
 *
 * Subir el cupo a mano en la base sería la otra salida, pero ataría el recorrido a tener credenciales de
 * Postgres — y entonces dejaría de correrse igual en local que en CI.
 */
let cookieAnfitriona = "";

test.beforeAll(async () => {
  test.skip(!CODIGO, "falta CODIGO_BOOTSTRAP");
  const api = await request.newContext({ baseURL: BASE });
  const alta = await api.post("/api/registro", {
    data: { email: `raiz-mapa-${sello()}@ejemplo.test`, name: "Raíz", password: CLAVE, inviteCode: CODIGO },
  });
  if (!alta.ok()) throw new Error(`no se pudo crear la cuenta raíz: ${alta.status()}`);
  cookieAnfitriona = (await api.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  await api.dispose();
});

/** Una cuenta nueva por recorrido, para que ninguno herede el estado del anterior. */
async function entrar(page: import("@playwright/test").Page) {
  const api = await request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { cookie: cookieAnfitriona, origin: BASE },
  });
  const r = await api.post("/api/invitations", { data: {} });
  if (!r.ok()) throw new Error(`no se pudo emitir la invitación: ${r.status()}`);
  const { code } = await r.json() as { code: string };
  await api.dispose();

  await page.goto("/");
  await page.getByRole("button", { name: "Únete" }).click();
  await page.getByLabel("Correo").fill(`mapa-${sello()}@ejemplo.test`);
  await page.getByLabel("Nombre").fill("Viajera");
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByLabel("Código de invitación").fill(code);
  await page.getByRole("button", { name: "Unirse" }).click();

  // La recién llegada hereda el papel de anfitriona: entra con su cupo intacto y le toca invitar al
  // siguiente recorrido. Se lee la cookie del contexto, que es donde acaba de dejarla el alta.
  await expect(page.getByRole("img", { name: "Mapa de competencias" })).toBeVisible();
  cookieAnfitriona = (await page.context().cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

test("G4 · al entrar se ve el mapa entero, sin desbordar los 390 px", async ({ page, qa }) => {
  qa.step("entrar con una invitación");
  await entrar(page);

  qa.step("la pantalla principal es el mapa, no la cuenta");
  const mapa = page.getByRole("img", { name: "Mapa de competencias" });
  await expect(mapa).toBeVisible();

  qa.step("los cinco nodos de Fase 0 están dibujados");
  // Por su nombre accesible, que incluye el estado: si algún día se dibujaran sin él, esto se pone
  // rojo — y sin nombre accesible el mapa sería inservible con lector de pantalla.
  await expect(page.getByRole("button", { name: /El entorno: Colab/ })).toBeVisible();
  await expect(page.locator(".mapa-nodo")).toHaveCount(5);

  qa.step("el encuadre inicial no recorta ninguna estrella");
  // El SVG ocupa el viewport; lo que se comprueba es que la página no se puede desplazar de lado,
  // que es como se manifiesta un encuadre que se sale.
  const desborde = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(desborde, "la página desborda horizontalmente en 390 px").toBeLessThanOrEqual(0);

  qa.step("y APROVECHA la pantalla, que no es lo mismo que no desbordarla");
  // El aserto que faltaba, y por eso esto llegó al móvil del humano: «no desborda» y «hay 5 nodos» eran
  // las dos ciertas mientras el grafo ocupaba el 52 % del ancho y flotaba en un vacío que parecía un
  // fallo de carga. Un encuadre se mide por lo que llena, no sólo por lo que no rompe.
  const ocupacion = await page.evaluate(() => {
    const nodos = [...document.querySelectorAll(".mapa-nodo")];
    const cajas = nodos.map((n) => n.getBoundingClientRect());
    const izq = Math.min(...cajas.map((c) => c.left));
    const der = Math.max(...cajas.map((c) => c.right));
    return (der - izq) / document.documentElement.clientWidth;
  });
  expect(
    ocupacion,
    `las estrellas ocupan el ${Math.round(ocupacion * 100)} % del ancho: el encuadre desperdicia pantalla`,
  ).toBeGreaterThanOrEqual(0.7);

  qa.step("se puede desplazar el mapa");
  const antes = await mapa.getAttribute("viewBox");
  await page.mouse.move(195, 400);
  await page.mouse.down();
  await page.mouse.move(120, 330, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => mapa.getAttribute("viewBox"), { message: "arrastrar no movió el encuadre" })
    .not.toBe(antes);
});

test("G5 · un nodo bloqueado se ve apagado y se distingue de uno disponible", async ({ page, qa }) => {
  qa.step("entrar y esperar al mapa");
  await entrar(page);
  await expect(page.getByRole("img", { name: "Mapa de competencias" })).toBeVisible();

  qa.step("sin nada completado, los que no tienen prerequisitos están disponibles");
  // `El entorno` y `El repositorio…` no tienen prerequisitos: son las dos puertas de entrada.
  await expect(page.getByRole("button", { name: /El entorno: Colab.*disponible/ })).toBeVisible();

  qa.step("y el proyecto, que depende de otros tres, está bloqueado");
  await expect(page.getByRole("button", { name: /Hola, Datos.*bloqueado/ })).toBeVisible();

  qa.step("el estado no se cuenta sólo con color: está en el nombre accesible");
  const apagados = page.locator('.mapa-nodo[data-estado="locked"]');
  await expect(apagados).not.toHaveCount(0);
});

test("G7 · tocar una estrella no pinta el recuadro del navegador, y el teclado sigue viendo el foco", async ({
  page,
  qa,
}) => {
  // Los dos sentidos en un solo recorrido a propósito: el arreglo obvio de «quitar el recuadro feo» es
  // `outline: none`, que cambia un fallo visible por uno invisible —dejar sin foco a quien navega con
  // teclado— y ningún test lo notaría. Aquí el segundo aserto es el que impide ese atajo.
  qa.step("entrar y esperar al mapa");
  await entrar(page);
  await expect(page.getByRole("img", { name: "Mapa de competencias" })).toBeVisible();

  qa.step("tocar con el dedo: no aparece el anillo por defecto");
  const estrella = page.locator(".mapa-nodo").first();
  // Toque por coordenadas, no `locator.tap()`. No es un atajo: el halo de un nodo disponible late en
  // bucle y Playwright, antes de tocar, exige que la caja del elemento se esté quieta dos fotogramas
  // seguidos — con una animación infinita esa espera no termina nunca y el recorrido muere en timeout
  // sin llegar a probar nada. Un dedo de verdad no espera a que nada se pare. Lo que este recorrido
  // mide es qué pinta el navegador tras un toque, así que el toque se da y punto.
  const caja = await estrella.locator(".cuerpo").boundingBox();
  if (!caja) throw new Error("la estrella no tiene caja: el mapa no se dibujó");
  await page.touchscreen.tap(caja.x + caja.width / 2, caja.y + caja.height / 2);
  const contorno = await estrella.evaluate((e) => getComputedStyle(e).outlineStyle);
  expect(contorno, "el navegador está pintando su propio recuadro al tocar").toBe("none");

  qa.step("llegar con el teclado: el indicador propio SÍ se ve");
  await page.keyboard.press("Tab");
  const visible = await page.evaluate(() => {
    const foco = document.activeElement;
    if (!foco?.classList.contains("mapa-nodo")) return null;
    const anillo = foco.querySelector(".foco");
    return anillo ? Number(getComputedStyle(anillo).opacity) : null;
  });
  expect(visible, "con el teclado no hay indicador de foco visible en la estrella").toBe(1);
});

test("G6 · tu círculo sigue alcanzable desde el mapa, y se vuelve", async ({ page, qa }) => {
  qa.step("entrar");
  await entrar(page);
  await expect(page.getByRole("img", { name: "Mapa de competencias" })).toBeVisible();

  qa.step("tu nombre lleva a tu círculo");
  await page.getByRole("button", { name: "Viajera" }).click();
  await expect(page.getByRole("heading", { name: "Tu círculo" })).toBeVisible();
  await expect(page.getByText(/\d+ por repartir/)).toBeVisible();

  qa.step("y se vuelve al mapa");
  await page.getByRole("button", { name: "Al mapa" }).click();
  await expect(page.getByRole("img", { name: "Mapa de competencias" })).toBeVisible();
});

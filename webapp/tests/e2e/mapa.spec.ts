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

test.use({ viewport: { width: 390, height: 844 } });

let cookieRaiz = "";

test.beforeAll(async () => {
  test.skip(!CODIGO, "falta CODIGO_BOOTSTRAP");
  const api = await request.newContext({ baseURL: BASE });
  const alta = await api.post("/api/registro", {
    data: { email: `raiz-mapa-${sello()}@ejemplo.test`, name: "Raíz", password: CLAVE, inviteCode: CODIGO },
  });
  if (!alta.ok()) throw new Error(`no se pudo crear la cuenta raíz: ${alta.status()}`);
  cookieRaiz = (await api.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  await api.dispose();
});

/** Una cuenta nueva por recorrido, para que ninguno herede el estado del anterior. */
async function entrar(page: import("@playwright/test").Page) {
  const api = await request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { cookie: cookieRaiz, origin: BASE },
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

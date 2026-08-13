import { request } from "@playwright/test";
import { expect, test } from "./fixtures/qa-bundle";

/**
 * Los recorridos de la pantalla de acceso — criterios **F3, F4 y F5** de FTAI-D.2.
 *
 * Existen porque hasta ahora la única forma de entrar era un `curl`: la API estaba probada de sobra
 * y la interfaz no existía. Un test de API no habría cazado el fallo que motivó esta hija, que era
 * justamente que **no había dónde pulsar**.
 *
 * El código de invitación llega por entorno (`CODIGO_BOOTSTRAP`), como en las sondas: acoplar el
 * recorrido al mecanismo de bootstrap lo haría frágil a cambios que no son suyos.
 */

const CODIGO = process.env.CODIGO_BOOTSTRAP ?? "";
const CLAVE = "contraseña-de-prueba-muy-larga";

/** Un correo distinto por ejecución: la base sobrevive entre runs y el email es único. */
const sello = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const BASE = process.env.BASE_URL_TEST ?? "http://localhost:8000";

/**
 * Cookie de la cuenta raíz, creada UNA vez con el código de bootstrap.
 *
 * Hace falta porque **el código de bootstrap es de un solo uso**: el primer recorrido lo gastaba y
 * los demás se quedaban sin poder darse de alta. En vez de encadenar los tests entre sí —que los
 * haría dependientes del orden— la raíz emite una invitación nueva para cada uno, que es justo lo
 * que hace un anfitrión de verdad.
 */
let cookieRaiz = "";

test.beforeAll(async () => {
  test.skip(!CODIGO, "falta CODIGO_BOOTSTRAP");
  const api = await request.newContext({ baseURL: BASE });
  const alta = await api.post("/api/registro", {
    data: {
      email: `raiz-${sello()}@ejemplo.test`,
      name: "Raíz",
      password: CLAVE,
      inviteCode: CODIGO,
    },
  });
  if (!alta.ok()) throw new Error(`no se pudo crear la cuenta raíz: ${alta.status()}`);
  cookieRaiz = (await api.storageState()).cookies
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  await api.dispose();
});

/** Una invitación fresca para el recorrido que la pida. Al portador: el alta la hace el navegador. */
async function invitacionNueva(): Promise<string> {
  const api = await request.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { cookie: cookieRaiz, origin: BASE },
  });
  const r = await api.post("/api/invitations", { data: {} });
  if (!r.ok()) throw new Error(`no se pudo emitir la invitación: ${r.status()}`);
  const { code } = await r.json() as { code: string };
  await api.dispose();
  return code;
}

test("F3 · unirse con una invitación deja dentro, y F4 · salir y volver a entrar", async ({
  page,
  qa,
}) => {
  const correo = `e2e-${sello()}@ejemplo.test`;
  const codigo = await invitacionNueva();

  qa.step("abrir la app sin sesión");
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();

  qa.step("cambiar al modo de alta");
  await page.getByRole("button", { name: "Únete" }).click();

  qa.step("rellenar el alta con la invitación");
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Nombre").fill("Prueba E2E");
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByLabel("Código de invitación").fill(codigo);
  await page.getByRole("button", { name: "Unirse" }).click();

  qa.step("aterrizar en la cuenta");
  await expect(page.getByRole("heading", { name: "Prueba E2E" })).toBeVisible();
  await expect(page.getByText(correo)).toBeVisible();

  qa.step("salir");
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();

  qa.step("volver a entrar con la contraseña");
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Prueba E2E" })).toBeVisible();

  qa.step("recargar: la sesión sobrevive y no se ve el formulario");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Prueba E2E" })).toBeVisible();
});

test("F5 · emitir y revocar invitaciones, con el cupo a la vista", async ({ page, qa }) => {
  const correo = `e2e-inv-${sello()}@ejemplo.test`;
  const codigo = await invitacionNueva();

  qa.step("entrar con una cuenta nueva");
  await page.goto("/");
  await page.getByRole("button", { name: "Únete" }).click();
  await page.getByLabel("Correo").fill(correo);
  await page.getByLabel("Nombre").fill("Anfitrión");
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByLabel("Código de invitación").fill(codigo);
  await page.getByRole("button", { name: "Unirse" }).click();
  await expect(page.getByRole("heading", { name: "Anfitrión" })).toBeVisible();

  qa.step("el cupo inicial está a la vista");
  await expect(page.getByText(/\d+ por repartir/)).toBeVisible();

  qa.step("emitir una invitación nominal");
  await page.getByPlaceholder("correo (opcional)").fill("alguien@ejemplo.test");
  await page.getByRole("button", { name: "Invitar" }).click();

  qa.step("el código sale a la vista una sola vez");
  await expect(page.getByText("Cópialo ahora: no se vuelve a mostrar.")).toBeVisible();
  await expect(page.getByText("alguien@ejemplo.test")).toBeVisible();
  await expect(page.getByText(/2 por repartir/)).toBeVisible();

  qa.step("revocarla devuelve el cupo");
  await page.getByRole("button", { name: "revocar" }).first().click();
  await expect(page.getByText(/3 por repartir/)).toBeVisible();
});

test("F3b · un código que no vale no dice POR QUÉ no vale", async ({ page, qa }) => {
  // El servidor unifica a propósito todos los fallos de alta en un 403 idéntico para no dar un
  // oráculo de pertenencia (§12.4). Este recorrido existe para que la interfaz no lo deshaga siendo
  // servicial: si algún día alguien traduce el 403 a «ese correo ya existe», esto se pone rojo.
  qa.step("intentar el alta con un código inventado");
  await page.goto("/");
  await page.getByRole("button", { name: "Únete" }).click();
  await page.getByLabel("Correo").fill(`e2e-malo-${sello()}@ejemplo.test`);
  await page.getByLabel("Nombre").fill("No entra");
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByLabel("Código de invitación").fill("codigo-que-no-existe-jamas");
  await page.getByRole("button", { name: "Unirse" }).click();

  qa.step("se queda fuera, con el mensaje genérico del servidor");
  const aviso = page.getByRole("alert");
  await expect(aviso).toBeVisible();
  await expect(aviso).toHaveText("no se pudo completar el alta");
  await expect(page.getByRole("button", { name: "Unirse" })).toBeVisible();
});

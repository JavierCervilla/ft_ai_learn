import { expect, test } from "../../fixtures/qa-bundle";
import { anfitrion, unirseDesdeElNavegador, sello } from "./anfitrion";

/**
 * Recorrido adversario · A9 (degradación) · encontrado diagnosticando el «ruido del entorno»
 *
 * PROMESA ATACADA:
 *   «Si tienes sesión, la app no te dice que estás fuera.»
 *
 * ROTURA: `/api/auth/get-session` puede devolver **429**. El límite de peticiones de Better Auth avisa
 * al arrancar de que **no puede resolver la IP del cliente** en este despliegue y cae a un **cubo
 * compartido por todo el mundo**; con `max: 20` por minuto, agotarlo no necesita un atacante — basta
 * gente usando la app a la vez, o una pestaña recargando. Cuando pasa, el cliente leía el 429 como «no
 * hay sesión» y enseñaba **el formulario de acceso a quien estaba dentro**.
 *
 * Es la misma familia que el A9 de FTAI-D.2 —un fallo que no es «no tienes sesión» leído como si lo
 * fuera— y la lección del proyecto ya estaba escrita: *un estado que el programa no puede distinguir es
 * un estado sobre el que va a mentir*.
 *
 * **Cómo apareció**: no lo encontró un pase adversario, lo encontró perseguir un fallo intermitente que
 * llevaba tres trayectorias contaminando la verificación local y que yo venía despachando como «ruido
 * del entorno». Lo era del entorno, sí — y también era un bug.
 *
 * El 429 se inyecta con `route()` para que el recorrido sea determinista: agotar el cubo de verdad
 * dependería del reloj y de qué más esté corriendo.
 */

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

test("A9 · un 429 al preguntar quién eres no es «te hemos echado»", async ({ page, qa }) => {
  qa.step("entrar con una invitación");
  await unirseDesdeElNavegador(page, `a9-429-${sello()}@ejemplo.test`, "Limitada");

  qa.step("el límite de peticiones responde 429 a partir de ahora");
  await page.route("**/api/auth/get-session", (ruta) =>
    ruta.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ message: "Too many requests" }),
    }));

  qa.step("recargar");
  await page.reload();
  await page.waitForTimeout(1500);

  // Comportamiento CORRECTO: la app admite que **no lo sabe**, y lo dice. Lo que no puede hacer es
  // afirmar que no hay sesión —con su botón «Entrar»— porque el servidor esté cargado.
  await expect(
    page.getByRole("button", { name: "Entrar", exact: true }),
    "con un 429 en `get-session` la app enseña el formulario de acceso a quien tiene la sesión viva: " +
      "lee «demasiadas peticiones» como «no eres nadie».",
  ).toHaveCount(0);

  await expect(page.getByText(/No hemos podido saber si tu sesión sigue viva/)).toBeVisible();

  qa.step("y cuando el límite pasa, reintentar te devuelve **donde estabas**");
  // Donde estabas, no «al mapa»: desde FTAI-E.2 la pantalla vive en la URL, así que recuperarse de un
  // fallo te deja en tu círculo si es ahí donde te pilló. Que la ruta sobreviva es el punto de tenerla.
  await page.unroute("**/api/auth/get-session");
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { name: "Tu círculo" })).toBeVisible({ timeout: 15000 });
});

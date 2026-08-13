/**
 * Recorrido adversario · A1 (concurrencia y doble envío) + A4 (fallo parcial) · FTAI-D.2
 *
 * PROMESA ATACADA (criterio 2 de la trayectoria):
 *   «Puedes emitir y revocar invitaciones desde la pantalla, con tu cupo a la vista.»
 *
 * Dos roturas del mismo sitio: `revocar()` en `src/Cuenta.tsx` **no tiene guarda de reentrada** (a
 * diferencia de `emitir()`, que sí tiene su `ocupado`) y **no refresca la lista cuando falla**.
 *
 * A1-1 · UN DOBLE CLIC CONVIERTE UN ÉXITO EN UN ERROR.
 *   El botón «revocar» nunca se deshabilita. Un doble clic —el gesto más ordinario que hay— manda
 *   DOS `DELETE`. El primero revoca de verdad y devuelve el cupo; el segundo ya no encuentra fila y
 *   la API responde su 404 deliberadamente ambiguo, «no encontrado» (el mismo que da para un código
 *   que no existe o que no es tuyo, §12.4). Ese texto acaba en el `role="alert"` de la pantalla. La
 *   persona ve un error rojo diciéndole que su propia invitación «no existe» **justo después de
 *   haberla revocado con éxito**. La ambigüedad que protege el círculo se convierte, del lado del
 *   cliente, en un mensaje que miente sobre lo que acaba de pasar.
 *
 * A1-2 · TRAS UN REVOCAR FALLIDO, LA LISTA SE QUEDA CONGELADA.
 *   Si alguien consume el código justo antes de que el anfitrión pulse «revocar», la API responde
 *   404 y el `catch` sólo pinta el error: **no llama a `recargar()`**. La fila sigue mostrándose como
 *   «al portador» y con su enlace «revocar», o sea como una invitación viva y cancelable, cuando en
 *   realidad ya hay alguien dentro gracias a ella. El anfitrión puede pulsar «revocar» para siempre y
 *   siempre se le dirá «no encontrado». Su cupo a la vista y su círculo a la vista son falsos
 *   exactamente en el caso que importa: cuando la invitación se ha usado.
 *
 * CÓMO CORRERLO:
 *   COOKIE_HOST='…' BASE_URL_TEST=http://localhost:8010 npx playwright test a1-revocar
 */
import { expect, test } from "../../fixtures/qa-bundle";
import { anfitrion, BASE, CLAVE, sello, unirseDesdeElNavegador } from "./anfitrion";

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

test("A1 · un doble clic en «revocar» no puede dejar un error en pantalla", async ({ page, qa }) => {
  qa.step("entrar y emitir una invitación");
  await unirseDesdeElNavegador(page, `a1-doble-${sello()}@ejemplo.test`, "Doble");
  await page.getByRole("button", { name: "Invitar" }).click();
  await expect(page.getByText("al portador")).toBeVisible({ timeout: 15000 });

  const borrados: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE") borrados.push(r.url());
  });

  qa.step("doble clic humano en «revocar» (el botón no se deshabilita en ningún momento)");
  await page.getByRole("button", { name: "revocar" }).dblclick();
  await expect(page.getByText("revocada")).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1000);

  qa.step(`la pantalla mandó ${borrados.length} DELETE`);

  // Comportamiento CORRECTO: la revocación funcionó (la fila dice «revocada» y el cupo volvió), así
  // que no puede quedar un `role="alert"` diciendo lo contrario.
  await expect(
    page.getByRole("alert"),
    `un doble clic mandó ${borrados.length} DELETE; el segundo recibió el 404 ambiguo de la API y la ` +
      "pantalla acabó enseñando «no encontrado» sobre una invitación que sí se revocó. `revocar()` " +
      "no tiene guarda de reentrada (`src/Cuenta.tsx`).",
  ).toBeHidden();
});

test("A1 · si el revocar falla, la lista no puede seguir enseñando la invitación como viva", async ({
  page,
  qa,
}) => {
  qa.step("entrar y emitir una invitación al portador");
  await unirseDesdeElNavegador(page, `a1-carrera-${sello()}@ejemplo.test`, "Carrera");
  await page.getByRole("button", { name: "Invitar" }).click();
  await expect(page.getByText("Cópialo ahora: no se vuelve a mostrar.")).toBeVisible({
    timeout: 15000,
  });
  const codigo = (await page.locator("code").innerText()).trim();

  qa.step("alguien de fuera consume el código antes de que el anfitrión lo revoque");
  const alta = await fetch(`${BASE}/api/registro`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({
      email: `consumidor-${sello()}@ejemplo.test`,
      password: CLAVE,
      name: "Consumidor",
      inviteCode: codigo,
    }),
  });
  expect(alta.status, "el tercero debía poder usar el código todavía").toBe(200);

  qa.step("el anfitrión pulsa «revocar» sin saberlo");
  await page.getByRole("button", { name: "revocar" }).click();
  await page.waitForTimeout(1500);

  // Comportamiento CORRECTO: el anfitrión tiene que acabar viendo la verdad de su círculo — que esa
  // invitación ya está usada. Seguir ofreciéndole el enlace «revocar» sobre una fila «al portador»
  // le hace creer que aún controla algo que ya no controla.
  await expect(
    page.getByRole("button", { name: "revocar" }),
    "tras el 404 la pantalla no refresca la lista (`revocar()` no llama a `recargar()` en el " +
      "`catch`): la invitación consumida sigue apareciendo como «al portador» y revocable.",
  ).toBeHidden();
});

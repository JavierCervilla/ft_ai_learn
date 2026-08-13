/**
 * Recorrido adversario · A2 (entradas hostiles / normalización) · FTAI-D.2
 *
 * Dos entradas que un humano teclea o pega sin querer, y que la pantalla no toca:
 *
 * A2-1 · EL CÓDIGO NO SE NORMALIZA — PROMESA 1 («puedes unirte con una invitación desde el
 *   navegador»). El campo «Código de invitación» manda al servidor exactamente lo que hay en el
 *   `value`. Un código **válido** pegado con un espacio al final —que es lo que pasa cuando se copia
 *   de un chat, de un correo o del propio `<code>` de la pantalla, que además avisa «Cópialo ahora:
 *   no se vuelve a mostrar»— se convierte en un 403 con el mismo «no se pudo completar el alta» que
 *   un código inventado. Y ese mensaje es indistinguible **por diseño** (§12.4), así que la persona
 *   invitada no tiene forma de saber que sólo le sobra un carácter invisible: se queda fuera del
 *   círculo con la invitación buena en la mano. El no-oráculo del servidor es correcto; lo que falla
 *   es que el cliente le da algo que no es lo que la persona quiso escribir.
 *
 * A2-2 · «PARA QUIÉN» ACEPTA CUALQUIER COSA — PROMESA 2 («emitir invitaciones… con tu cupo a la
 *   vista»). El `<input type="email">` de «correo (opcional)» es decorativo: no está dentro de un
 *   `<form>` y el botón es `type="button"`, así que la validación nativa del navegador **no se
 *   dispara nunca**. Se puede emitir una invitación nominal a `esto no es un correo`. El servidor la
 *   guarda tal cual, el cupo se gasta, y la pantalla la lista como una invitación normal — pero
 *   `consumir()` compara `lower(email)` contra el correo del alta, así que **no la podrá usar nadie
 *   jamás**. Es cupo quemado en una invitación muerta, presentada como viva.
 *
 * CÓMO CORRERLO:
 *   COOKIE_HOST='…' BASE_URL_TEST=http://localhost:8010 npx playwright test a2-entradas
 */
import { expect, test } from "../../fixtures/qa-bundle";
import {
  anfitrion,
  CLAVE,
  invitacionDelAnfitrion,
  sello,
  unirseDesdeElNavegador,
} from "./anfitrion";

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

test("A2 · un código válido pegado con un espacio final sigue siendo una invitación válida", async ({
  page,
  qa,
}) => {
  const codigo = await invitacionDelAnfitrion();

  qa.step("pegar el código con el espacio que arrastra cualquier copia desde un chat");
  await page.goto("/");
  await page.getByRole("button", { name: "Únete" }).click();
  await page.getByLabel("Correo").fill(`a2-espacio-${sello()}@ejemplo.test`);
  await page.getByLabel("Nombre").fill("Espacio");
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByLabel("Código de invitación").fill(`${codigo} `);
  await page.getByRole("button", { name: "Unirse" }).click();

  // Comportamiento CORRECTO: entrar. El código ES el suyo; el espacio no es parte de la invitación y
  // la pantalla es el único sitio donde se puede quitar sin tocar el no-oráculo del servidor.
  await expect(
    page.getByRole("heading", { name: "Tu círculo" }),
    "el alta se rechaza con el 403 mudo por un espacio al final: la persona invitada se queda fuera " +
      "con la invitación buena y sin ninguna pista de por qué.",
  ).toBeVisible({ timeout: 15000 });
});

test("A2 · «para quién» no puede gastar cupo en un correo que no es un correo", async ({
  page,
  qa,
}) => {
  qa.step("entrar con una invitación");
  await unirseDesdeElNavegador(page, `a2-correo-${sello()}@ejemplo.test`, "Correo");
  await expect(page.getByText("3 por repartir")).toBeVisible({ timeout: 15000 });

  qa.step("emitir una invitación nominal para «esto no es un correo»");
  await page.getByPlaceholder("correo (opcional)").fill("esto no es un correo");
  await page.getByRole("button", { name: "Invitar" }).click();
  await page.waitForTimeout(1500);

  // Comportamiento CORRECTO: el cupo sigue intacto, porque no se ha emitido nada usable. El
  // `type="email"` del campo promete una validación que nunca corre (el botón no envía un `<form>`).
  await expect(
    page.getByText("3 por repartir"),
    "la pantalla emitió una invitación nominal a «esto no es un correo»: gastó cupo en algo que " +
      "`consumir()` no podrá casar con ningún alta, y la lista lo enseña como una invitación normal.",
  ).toBeVisible();
});

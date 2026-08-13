/**
 * Recorrido adversario · A3 (máquina de estados del cliente) · FTAI-D.2
 *
 * PROMESA ATACADA (criterio 2 de la trayectoria):
 *   «Puedes emitir y revocar invitaciones desde la pantalla, **con tu cupo a la vista**.»
 *
 * ROTURA: la pantalla `Cuenta` guarda la sesión en un `useState` del arranque y **no vuelve a
 * preguntar quién eres**. La cookie, en cambio, es del navegador entero. Si en otra pestaña sales y
 * entras como otra persona —el gesto más normal del mundo en un móvil compartido, o simplemente al
 * probar la app con dos cuentas—, la primera pestaña sigue pintando el nombre, el correo y el cupo de
 * la persona anterior, pero **cada botón actúa contra la sesión nueva**.
 *
 * Consecuencia medida: la pantalla que dice «Alicia» acuña una invitación que la API atribuye a
 * **Berta**, gasta el cupo de Berta, y enseña el código bajo el nombre de Alicia. Quien use ese código
 * entra en el círculo de Berta, no en el de Alicia. En un producto cuya premisa es el círculo cerrado,
 * la línea de quién invitó a quién no es un detalle de presentación.
 *
 * No es el hallazgo H-2 de `qa` (aquél es «Salir» tragándose el fallo de red): aquí el `sign-out`
 * funciona perfectamente, y la pantalla superviviente sigue firmando con una identidad que ya no es
 * la suya.
 *
 * CÓMO CORRERLO:
 *   COOKIE_HOST='…' BASE_URL_TEST=http://localhost:8010 npx playwright test a3-identidad
 */
import { expect, test } from "../../fixtures/qa-bundle";
import {
  anfitrion,
  CLAVE,
  invitacionDelAnfitrion,
  invitacionesDe,
  sello,
  unirseDesdeElNavegador,
} from "./anfitrion";

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

test("A3 · la pantalla que muestra a Alicia no puede invitar en nombre de Berta", async ({
  page,
  context,
  qa,
}) => {
  const correoAlicia = `alicia-${sello()}@ejemplo.test`;
  const correoBerta = `berta-${sello()}@ejemplo.test`;

  qa.step("pestaña 1: entra Alicia");
  await unirseDesdeElNavegador(page, correoAlicia, "Alicia");

  qa.step("pestaña 2: Alicia sale y entra Berta (misma cookie, otro dueño)");
  const pestana2 = await context.newPage();
  await pestana2.goto("/");
  await expect(pestana2.getByRole("heading", { name: "Tu círculo" })).toBeVisible({
    timeout: 15000,
  });
  await pestana2.getByRole("button", { name: "Salir" }).click();
  await expect(pestana2.getByRole("button", { name: "Únete" })).toBeVisible({ timeout: 15000 });

  const codigo = await invitacionDelAnfitrion();
  await pestana2.getByRole("button", { name: "Únete" }).click();
  await pestana2.getByLabel("Correo").fill(correoBerta);
  await pestana2.getByLabel("Nombre").fill("Berta");
  await pestana2.getByLabel("Contraseña").fill(CLAVE);
  await pestana2.getByLabel("Código de invitación").fill(codigo);
  await pestana2.getByRole("button", { name: "Unirse" }).click();
  await expect(pestana2.getByRole("heading", { name: "Berta" })).toBeVisible({ timeout: 15000 });

  qa.step("pestaña 1: sigue diciendo «Alicia». Se pulsa Invitar ahí");
  await page.bringToFront();
  await expect(page.getByRole("heading", { name: "Alicia" })).toBeVisible();
  await page.getByRole("button", { name: "Invitar" }).click();

  // Aquí el recorrido original esperaba a que apareciera el código, porque con el bug **siempre**
  // aparecía. Ya no: al arreglarlo, la pantalla que descubre que la sesión es de otra persona deja de
  // enseñarlo y se re-dibuja como quien de verdad tiene la sesión. Esperar el código sin más
  // convertía el arreglo en un rojo, así que se espera **a que pase una de las dos cosas** — y el
  // aserto de abajo, que es lo que detecta el bug, se queda igual: si algún día vuelve a enseñarse un
  // código bajo el nombre equivocado, esto se pone rojo otra vez.
  const codigoALaVista = page.locator("code");
  await expect(async () => {
    const hayCodigo = await codigoALaVista.count() > 0;
    const sigueFirmandoComoAlicia = await page.getByRole("heading", { name: "Alicia" }).count() > 0;
    expect(hayCodigo || !sigueFirmandoComoAlicia).toBe(true);
  }).toPass({ timeout: 15000 });

  qa.step("¿de quién es esa invitación según la API?");
  const cookieViva = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const deBerta = await invitacionesDe(cookieViva);
  const codigoMostrado = await codigoALaVista.count() > 0
    ? (await codigoALaVista.innerText()).trim()
    : null;

  // Comportamiento CORRECTO: o la pantalla se entera de que la sesión cambió y deja de firmar como
  // Alicia, o el código que enseña bajo el nombre de Alicia es de Alicia. Las dos cosas a la vez, no.
  if (codigoMostrado !== null) {
    expect(
      deBerta.invitaciones.map((i) => i.code),
      `la pantalla de Alicia acuñó "${codigoMostrado}" y la API se lo apuntó a Berta: la interfaz ` +
        "atribuye a una persona una invitación que sale del cupo de otra, y quien la use entrará en " +
        "el círculo equivocado.",
    ).not.toContain(codigoMostrado);
  } else {
    // La otra salida buena: no hay código a la vista **y** la pantalla ya no dice Alicia.
    await expect(page.getByRole("heading", { name: "Alicia" })).toHaveCount(0);
  }
});

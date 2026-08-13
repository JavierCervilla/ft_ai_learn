import { expect, test } from "../../fixtures/qa-bundle";
import { anfitrion, CLAVE, sello } from "./anfitrion";

/**
 * Recorrido · el código mal pegado se avisa **sin preguntar al servidor** · FTAI-D.3
 *
 * No nace de un pase adversario sino de la primera invitación real del producto: llegó con **21
 * caracteres en vez de 22** porque empezaba por `-` y el guion se perdió al copiarla. El servidor
 * hizo lo correcto —su 403 es deliberadamente indistinguible, §12.4— y precisamente por eso la
 * persona invitada se quedó fuera **sin ninguna pista**, con la invitación buena en la mano.
 *
 * La comprobación que lo arregla es de **forma** y no de pertenencia, y esa distinción es lo que la
 * hace legítima: el formato es público, se ve en cualquier código, así que decir «esto no tiene forma
 * de código» no responde nada sobre quién está en el círculo. Este recorrido existe para fijar las
 * dos mitades: que **avisa**, y que **no pregunta** — si algún día alguien mueve la comprobación al
 * servidor, el aviso seguiría saliendo y el oráculo tendría una sonda gratis más.
 */

test.beforeAll(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

test("un código al que le falta un carácter se avisa en el cliente, sin tocar la API", async ({
  page,
  qa,
}) => {
  const peticiones: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/registro")) peticiones.push(r.url());
  });

  qa.step("abrir el alta");
  await page.goto("/");
  await page.getByRole("button", { name: "Únete" }).click();

  qa.step("pegar un código de 21 caracteres, como el que perdió su guion inicial");
  await page.getByLabel("Correo").fill(`mal-pegado-${sello()}@ejemplo.test`);
  await page.getByLabel("Nombre").fill("Mal Pegado");
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByLabel("Código de invitación").fill("gz_x7u2tSAIxO5u36J0pw"); // 21, le falta el `-`
  await page.getByRole("button", { name: "Unirse" }).click();

  qa.step("la app dice que el problema es la FORMA, no que no valga");
  const aviso = page.getByRole("alert");
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText("22 caracteres");

  qa.step("y no ha preguntado al servidor: el oráculo no gana una sonda por esto");
  expect(peticiones, "el cliente mandó el código malformado al servidor").toHaveLength(0);

  qa.step("el formulario sigue ahí para corregirlo");
  await expect(page.getByRole("button", { name: "Unirse" })).toBeVisible();
});

import { request } from "@playwright/test";
import { expect, test } from "./fixtures/qa-bundle";

/**
 * La hoja del nodo, en el móvil — criterios **K1-K8** de FTAI-E.2.
 *
 * Fichero propio y no dentro de `mapa.spec.ts` por la misma restricción de siempre: el código de
 * bootstrap es de un solo uso, cada fichero se lo gasta en su `beforeAll`, y correrlos juntos daría un
 * rojo **del entorno** y no de lo que se prueba. En CI va con su paso.
 *
 * Contra el servidor de verdad, con el contenido de verdad: lo que hay que probar es que la hoja
 * **enseña lo que sirve la API**, y con un grafo de mentira estaríamos probando el mock.
 */

const CODIGO = process.env.CODIGO_BOOTSTRAP ?? "";
const CLAVE = "contraseña-de-prueba-muy-larga";
const BASE = process.env.BASE_URL_TEST ?? "http://localhost:8000";
const sello = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

/** Cadena de anfitrionas: el cupo son tres y este fichero pide más. Ver `mapa.spec.ts`. */
let cookieAnfitriona = "";

test.beforeAll(async () => {
  test.skip(!CODIGO, "falta CODIGO_BOOTSTRAP");
  const api = await request.newContext({ baseURL: BASE });
  const alta = await api.post("/api/registro", {
    data: { email: `raiz-hoja-${sello()}@ejemplo.test`, name: "Raíz", password: CLAVE, inviteCode: CODIGO },
  });
  if (!alta.ok()) throw new Error(`no se pudo crear la cuenta raíz: ${alta.status()}`);
  cookieAnfitriona = (await api.storageState()).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  await api.dispose();
});

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
  await page.getByLabel("Correo").fill(`hoja-${sello()}@ejemplo.test`);
  await page.getByLabel("Nombre").fill("Lectora");
  await page.getByLabel("Contraseña").fill(CLAVE);
  await page.getByLabel("Código de invitación").fill(code);
  await page.getByRole("button", { name: "Unirse" }).click();
  await expect(page.getByRole("img", { name: "Mapa de competencias" })).toBeVisible();
  cookieAnfitriona = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Toca una estrella por su nombre accesible.
 *
 * Por coordenadas y no con `locator.tap()`: el halo de un nodo disponible late en bucle y Playwright
 * exige que la caja se esté quieta dos fotogramas antes de tocar, cosa que con una animación infinita
 * no pasa nunca. Un dedo de verdad no espera. (Misma razón que en `mapa.spec.ts`.)
 */
async function tocarEstrella(page: import("@playwright/test").Page, nombre: RegExp) {
  const estrella = page.getByRole("button", { name: nombre });
  const caja = await estrella.locator(".cuerpo").boundingBox();
  if (!caja) throw new Error(`la estrella ${nombre} no tiene caja: el mapa no se dibujó`);
  await page.touchscreen.tap(caja.x + caja.width / 2, caja.y + caja.height / 2);
}

const hoja = (page: import("@playwright/test").Page, titulo: string) =>
  page.getByRole("region", { name: `Nodo: ${titulo}` });

test("K1 · tocar una estrella abre su hoja, con el micro por delante", async ({ page, qa }) => {
  qa.step("entrar y tocar «El entorno»");
  await entrar(page);
  await tocarEstrella(page, /El entorno: Colab/);

  qa.step("la hoja sale con lo que haces en quince minutos");
  const panel = hoja(page, "El entorno: Colab en cinco minutos");
  await expect(panel).toBeVisible();
  // Se comprueba su texto real, no que «haya algo»: una hoja que abre vacía también abriría.
  await expect(panel.getByText(/Abrir Colab, crear un notebook/)).toBeVisible();

  qa.step("y va ANTES que el resumen, que es la decisión, no un detalle");
  // El orden obvio es el contrario. La sentada de quince minutos es la unidad del producto; el resumen
  // es la promesa, y la promesa la lee quien tiene tiempo. Sin este aserto, invertirlos no rompería
  // nada — y el aserto de arriba seguiría verde, que es exactamente la clase de gate que no mira.
  const orden = await panel.evaluate((el) => {
    const texto = el.textContent ?? "";
    return { micro: texto.indexOf("Abrir Colab"), resumen: texto.indexOf("Al terminar") };
  });
  expect(orden.micro, "no se encontró el micro en la hoja").toBeGreaterThanOrEqual(0);
  expect(orden.resumen, "no se encontró el resumen en la hoja").toBeGreaterThan(orden.micro);

  qa.step("y la URL nombra el nodo, que es lo que hace que el atrás funcione");
  expect(page.url()).toContain("#/nodo/f0-entorno");
});

test("K2 · el atrás del navegador cierra la hoja, NO la app", async ({ page, qa }) => {
  // El motivo entero por el que hay rutas. En Android el atrás es del sistema: sin entrada de
  // historial, quien está leyendo una hoja y hace «atrás» no cierra la hoja — cierra la aplicación.
  qa.step("entrar y abrir un nodo");
  await entrar(page);
  await tocarEstrella(page, /El entorno: Colab/);
  await expect(hoja(page, "El entorno: Colab en cinco minutos")).toBeVisible();

  qa.step("atrás");
  await page.goBack();

  qa.step("la hoja se cerró y seguimos DENTRO de la app, en el mapa");
  await expect(hoja(page, "El entorno: Colab en cinco minutos")).toBeHidden();
  await expect(page.getByRole("img", { name: "Mapa de competencias" })).toBeVisible();
  // `exact` porque el nombre accesible se busca **por subcadena**: sin él, «Centrar» —el botón del
  // mapa— cuenta como «Entrar» y el aserto falla acusando a la app de haber cerrado la sesión.
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toHaveCount(0);
});

test("K3 · un bloqueado dice qué le falta, y el prerequisito es navegable", async ({ page, qa }) => {
  qa.step("entrar y tocar el proyecto, que depende de otros tres");
  await entrar(page);
  await tocarEstrella(page, /Hola, Datos/);

  const panel = hoja(page, "Hola, Datos");
  await expect(panel).toBeVisible();

  qa.step("no dice «bloqueado» y se calla: dice qué falta");
  await expect(panel.getByText("Para empezar esto te falta:")).toBeVisible();
  const pendiente = panel.getByRole("button", { name: /Python, repaso ejecutable/ });
  await expect(pendiente).toBeVisible();

  qa.step("y el prerequisito lleva a su hoja");
  await pendiente.click();
  await expect(hoja(page, "Python, repaso ejecutable")).toBeVisible();
  expect(page.url()).toContain("#/nodo/f0-python");
});

test("K4 · cada recurso sale con su porqué a la vista", async ({ page, qa }) => {
  qa.step("entrar, abrir un nodo y ampliar la hoja");
  await entrar(page);
  await tocarEstrella(page, /El entorno: Colab/);
  const panel = hoja(page, "El entorno: Colab en cinco minutos");
  await panel.getByRole("button", { name: "Ampliar la hoja" }).click();

  qa.step("el enlace y **el porqué**, que es obligatorio en el contrato para que se lea");
  await expect(panel.getByRole("link", { name: /colab\.research\.google\.com/ })).toBeVisible();
  const porque = panel.getByText(/Quita de en medio la instalación/);
  await expect(porque).toBeVisible();

  qa.step("y se lee de verdad: no escondido en un `sr-only` ni en un tooltip");
  // `toBeVisible()` **no basta**: un `sr-only` está clipado a un píxel y Playwright lo da por visible,
  // así que esconder el porqué pasaba el aserto anterior en verde. La regla del contrato es que el
  // porqué **se lea**, y eso se mide con el sitio que ocupa. Comprobado saboteándolo.
  const caja = await porque.boundingBox();
  expect(caja?.width ?? 0, "el porqué está clipado: se cumple la letra del contrato y no la regla")
    .toBeGreaterThan(100);
  expect(caja?.height ?? 0).toBeGreaterThan(10);
});

test("K5 · la rúbrica es de los proyectos, y en un concepto no hay hueco", async ({ page, qa }) => {
  qa.step("entrar y abrir el proyecto");
  await entrar(page);
  await tocarEstrella(page, /Hola, Datos/);
  const proyecto = hoja(page, "Hola, Datos");
  await proyecto.getByRole("button", { name: "Ampliar la hoja" }).click();

  qa.step("el proyecto enseña cuándo está hecho, con cómo comprobarlo");
  await expect(proyecto.getByRole("heading", { name: "Cuándo está hecho" })).toBeVisible();
  await expect(proyecto.getByText(/Runtime → Restart and run all/)).toBeVisible();

  qa.step("y un concepto NO tiene esa sección: no hay hueco vacío");
  // **Dicho claro**: con el contenido de hoy este medio recorrido no puede fallar, porque ningún
  // concepto de Fase 0 trae rúbrica — la condición `type === "project"` del componente ni se ejercita.
  // Se deja igualmente como guarda para el día que alguien le ponga una rúbrica a un concepto, pero el
  // que de verdad muerde es el de arriba, y por eso es el que lleva contraprueba.
  await proyecto.getByRole("button", { name: "Cerrar" }).click();
  await tocarEstrella(page, /El entorno: Colab/);
  const concepto = hoja(page, "El entorno: Colab en cinco minutos");
  await concepto.getByRole("button", { name: "Ampliar la hoja" }).click();
  await expect(concepto.getByRole("heading", { name: "Cuándo está hecho" })).toHaveCount(0);
});

test("K6 · V8 · sin cuaderno no hay hueco vacío ni botón muerto", async ({ page, qa }) => {
  // Criterio V8 de la spec: un nodo SIN cuaderno tiene que seguir siendo un nodo útil, y ningún camino
  // de la interfaz puede exigir el cuaderno para avanzar. Hoy ningún nodo de Fase 0 trae `notebook`,
  // así que esto es lo único que se puede ejercitar con datos reales — y es justo el caso que importa.
  qa.step("entrar y ampliar la hoja de un nodo sin cuaderno");
  await entrar(page);
  await tocarEstrella(page, /El entorno: Colab/);
  const panel = hoja(page, "El entorno: Colab en cinco minutos");
  await panel.getByRole("button", { name: "Ampliar la hoja" }).click();

  qa.step("«Abrir el cuaderno» no existe — no está deshabilitado: no está");
  await expect(panel.getByRole("link", { name: "Abrir el cuaderno del nodo" })).toHaveCount(0);

  qa.step("y el segundo camino sigue vivo, porque las fuentes son dato nuestro");
  const copiar = panel.getByRole("button", { name: /Crea el tuyo/ });
  await expect(copiar).toBeVisible();
  await expect(copiar).toBeEnabled();
});

test("K7 · la estrella tocada no se queda debajo de la hoja", async ({ page, qa }) => {
  qa.step("entrar y buscar una estrella que caiga donde luego estará la hoja");
  await entrar(page);
  // **Dirigido por datos y no a una estrella fija**: la primera versión de este recorrido tocaba
  // `f0-entorno`, que con el encuadre actual ya queda arriba — así que pasaba en verde **con la cámara
  // desactivada**. Un aserto sobre un caso que no necesita el arreglo no prueba el arreglo. Se busca la
  // estrella que de verdad va a quedar tapada, y si no hay ninguna el recorrido lo dice en vez de
  // colarse en verde.
  const bajo = await page.evaluate(() => {
    const alto = document.documentElement.clientHeight;
    const nodos = [...document.querySelectorAll<SVGGElement>(".mapa-nodo")];
    const tapada = nodos.find((n) => {
      const c = n.querySelector(".cuerpo")?.getBoundingClientRect();
      return c && c.top > alto * 0.55; // la hoja baja ocupa el 45 % de abajo
    });
    const c = tapada?.querySelector(".cuerpo")?.getBoundingClientRect();
    return c ? { x: c.x + c.width / 2, y: c.y + c.height / 2, id: tapada?.dataset.id } : null;
  });
  expect(bajo, "ninguna estrella cae bajo la hoja: este recorrido no estaría probando nada").not
    .toBeNull();

  qa.step(`tocar «${bajo!.id}», que está en la franja que la hoja va a tapar`);
  await page.touchscreen.tap(bajo!.x, bajo!.y);
  const panel = page.getByRole("region", { name: /^Nodo: / });
  await expect(panel).toBeVisible();

  qa.step("la cámara la aparta de detrás del panel");
  // La hoja habla de un nodo: si el nodo queda tapado por la propia hoja, habla de algo que no ves.
  const arribaDeLaHoja = (await panel.boundingBox())?.y ?? 0;
  const estrella = await page.locator(`.mapa-nodo[data-id="${bajo!.id}"] .cuerpo`).boundingBox();
  expect(estrella, "la estrella dejó de dibujarse").not.toBeNull();
  expect(
    (estrella?.y ?? 0) + (estrella?.height ?? 0),
    "la estrella que la hoja está explicando quedó debajo de la hoja",
  ).toBeLessThan(arribaDeLaHoja);
});

test("K8 · con la hoja abierta, tocar otra estrella cambia el contenido", async ({ page, qa }) => {
  // La hoja **no es modal** a propósito: recorrer el mapa mientras lees es el gesto natural, y hacerla
  // modal lo prohibiría por nada.
  qa.step("entrar y abrir un nodo");
  await entrar(page);
  await tocarEstrella(page, /El entorno: Colab/);
  await expect(hoja(page, "El entorno: Colab en cinco minutos")).toBeVisible();

  qa.step("sin cerrar, tocar otra de las que SÍ se ven");
  // Se elige una estrella que quede por encima de la hoja, no una cualquiera: con la hoja abierta
  // tapando el 45 % de la pantalla, tocar las coordenadas de una estrella que está detrás le da el
  // toque **a la hoja**. Eso no es un fallo —el mapa se puede desplazar, que para eso la hoja no es
  // modal— pero un recorrido que lo ignore mide otra cosa. Cuál queda arriba depende del encuadre, así
  // que se busca en vez de darla por hecha.
  const arriba = (await hoja(page, "El entorno: Colab en cinco minutos").boundingBox())?.y ?? 0;
  const otra = await page.evaluate((limite) => {
    const nodos = [...document.querySelectorAll<SVGGElement>(".mapa-nodo")];
    const visible = nodos.find((n) => {
      const c = n.querySelector(".cuerpo")?.getBoundingClientRect();
      return c && c.bottom < limite && c.top > 0 && n.dataset.id !== "f0-entorno";
    });
    const c = visible?.querySelector(".cuerpo")?.getBoundingClientRect();
    return c ? { x: c.x + c.width / 2, y: c.y + c.height / 2, id: visible?.dataset.id } : null;
  }, arriba);
  expect(otra, "ninguna otra estrella queda visible sobre la hoja").not.toBeNull();
  await page.touchscreen.tap(otra!.x, otra!.y);

  qa.step("la hoja pasa a ser de la otra, y no se apilan dos");
  await expect(hoja(page, "El entorno: Colab en cinco minutos")).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^Nodo: / })).toHaveCount(1);

  qa.step("y el atrás sigue llevando al mapa, no a la hoja anterior");
  // Cambiar de nodo REEMPLAZA la entrada de historial: si cada estrella curioseada dejara la suya,
  // salir costaría tantos «atrás» como estrellas hubieras mirado.
  await page.goBack();
  await expect(page.getByRole("region", { name: /^Nodo: / })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Mapa de competencias" })).toBeVisible();
});

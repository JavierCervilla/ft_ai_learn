/**
 * Recorrido adversario · A6 (input hostil) con salida por A9 (callejón sin salida) · FTAI-E.2
 *
 * PROMESA ATACADA:
 *   «Tocas una estrella y sabes qué hacer en quince minutos… y el botón atrás cierra la hoja y no la
 *   app.» El nodo abierto **vive en la URL** (`#/nodo/<id>`), y `Dentro.tsx` deja escrito el criterio
 *   correcto — *«la URL es entrada de fuera, y no puede dar por hecho que nombra algo nuestro»*—.
 *   Ese criterio se aplica al **id**, pero no al **texto del hash** que lo transporta.
 *
 * EL ATAQUE: un hash con un escape por ciento mal formado. `#/nodo/%`, `#/nodo/%E0%A4%A`,
 * `#/nodo/f0-entorno%zz`. No hace falta un atacante: basta un enlace compartido que un chat, un
 * lector de correo o un QR haya recortado o re-codificado por su cuenta — y el hash es justamente lo
 * que se comparte.
 *
 * LO QUE PASA: `nodoDeLaUrl()` llama a `decodeURIComponent()` sin red debajo, y con un escape roto
 * eso **lanza** `URIError: URI malformed`. La llamada está dentro del inicializador de estado de
 * `useNodoAbierto()`, o sea **dentro del primer render**: React aborta el árbol entero y `#root` se
 * queda **vacío**. No hay mapa, no hay hoja, no hay mensaje de error, no hay botón de vuelta. Y como
 * el hash sigue en la barra, **recargar vuelve a estrellarla**: la única salida es editar la URL a
 * mano, que en el empaquetado para tiendas de §6.2 ni siquiera es una opción.
 *
 * Medido en este entorno (`webapp/src/rutas.ts:26`, `HojaNodo`/`Dentro` ni llegan a montarse):
 *   #/nodo/%E0%A4%A      → #root vacío, pageerror «URI malformed»
 *   #/nodo/%             → #root vacío, pageerror «URI malformed»
 *   #/nodo/f0-entorno%zz → #root vacío, pageerror «URI malformed»
 *
 * En caliente (la app ya abierta y el hash cambiando bajo ella) React sobrevive al throw del
 * manejador, pero el `pageerror` salta igual y la hoja no reacciona: la app se queda muda ante esa
 * URL. Lo que se afirma abajo es el caso frío, que es el que llega por un enlace.
 *
 * CÓMO CORRERLO (staging efímero, ver la cabecera de `anfitrion.ts`):
 *   CODIGO_BOOTSTRAP=… BASE_URL_TEST=http://localhost:8030 npx playwright test a6-url-de-nodo-hostil
 */
import { expect, test } from "../../fixtures/qa-bundle";
import { anfitrion } from "./anfitrion";
import { entrar, MAPA } from "./hoja-del-nodo";

/** El producto es móvil primero, y sus recorridos también: mismo lienzo que `hoja.spec.ts`. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async () => {
  test.skip(!(await anfitrion()), "falta COOKIE_HOST o CODIGO_BOOTSTRAP");
});

const HASHES_ROTOS = ["#/nodo/%E0%A4%A", "#/nodo/%", "#/nodo/f0-entorno%zz"];

for (const hash of HASHES_ROTOS) {
  test(`A6 · un enlace con el hash estropeado (${hash}) no deja la app en blanco`, async ({
    page,
    context,
    qa,
  }) => {
    qa.step("entrar una vez, para que la sesión no sea la variable en juego");
    await entrar(page);

    qa.step(`abrir el enlace compartido en una pestaña nueva, con su escape roto: ${hash}`);
    // **En frío y no cambiando el hash de la pestaña actual**: un enlace que llega por un chat abre
    // documento nuevo, y ahí el `decodeURIComponent` cae dentro del PRIMER render. Con la app ya
    // montada el throw ocurre en el manejador del `hashchange` y React sobrevive (la hoja se queda
    // muda, que es malo pero no es esto).
    const compartida = await context.newPage();
    const errores: string[] = [];
    compartida.on("pageerror", (e) => errores.push(e.message.split("\n")[0] ?? e.message));
    await compartida.goto(`/${hash}`);
    await compartida.waitForTimeout(2500);

    qa.step(`mirar si queda algo pintado (errores de página: ${JSON.stringify(errores)})`);
    const raiz = (await compartida.locator("#root").innerHTML()).trim();

    // Comportamiento CORRECTO: un id que la app no entiende **no abre nada**, exactamente como uno
    // que no existe — y deja el mapa detrás. Lo que no puede es tumbar la aplicación entera.
    expect(
      raiz,
      `el hash "${hash}" deja \`#root\` VACÍO: \`decodeURIComponent\` lanza «URI malformed» dentro ` +
        "del primer render (`rutas.ts:26`, en el inicializador de `useNodoAbierto`) y React aborta el " +
        "árbol. Pantalla en blanco, sin mensaje ni vuelta, y recargar repite el estrellón porque el " +
        "hash sigue ahí. Un enlace mal recortado brickea la app.",
    ).not.toBe("");

    qa.step("y el mapa —que es la pantalla de la que cuelga todo— tiene que seguir ahí");
    await expect(compartida.locator(MAPA)).toBeVisible({ timeout: 5000 });
  });
}

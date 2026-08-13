import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El color de marca vive en **un** sitio.
 *
 * `index.html` y `manifest.webmanifest` necesitan el color en hexadecimal: lo exige el formato, no
 * pueden leer una variable CSS. Eso los convierte en una segunda copia de la verdad — y el gate
 * anti-slop de interfaz **no los miraba** (`qa-adversario`, F9/A12: filtro de extensiones ciego a
 * anti-slop-allow: un test que comprueba un color de marca tiene que nombrarlo; es su objeto
 * `.html` y a `.webmanifest`, veredicto `criticos=0 · LIMPIO` con `#0b1020` a la vista en los tres
 * sitios). Se le enseñó a mirar el HTML; el manifiesto es JSON y no admite el comentario de escape,
 * así que no puede participar del mecanismo del gate.
 *
 * Este test cierra el hueco **por el lado fuerte**. El gate comprobaría que no hay un literal; esto
 * comprueba que el literal es exactamente `--color-fondo` convertido a sRGB. Si alguien retoca el
 * token, la barra del navegador y la pantalla de arranque de la PWA dejarían de casar con el fondo
 * de la app en silencio — y esto se pone rojo.
 */

const raiz = new URL("..", import.meta.url).pathname;
const css = readFileSync(`${raiz}src/index.css`, "utf8");
const html = readFileSync(`${raiz}index.html`, "utf8");
const manifiesto = JSON.parse(readFileSync(`${raiz}public/manifest.webmanifest`, "utf8"));

/**
 * OKLCH → sRGB hexadecimal.
 *
 * Las matrices son las de la especificación de Björn Ottosson (OKLab → LMS cúbico → sRGB lineal),
 * y el último paso es la codificación gamma de sRGB. Se implementa aquí, con sus doce constantes a
 * la vista, en vez de traerse una librería de color: es una función pura de diez líneas y añadir una
 * dependencia al árbol de un cliente que la spec §6.2 quiere empaquetable no sale a cuenta.
 */
function oklchAHex(L: number, C: number, h: number): string {
  const rad = (h * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;

  const lineal = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];

  return "#" + lineal
    .map((c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055))
    .map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0"))
    .join("");
}

function tokenFondo(): string {
  const m = css.match(/--color-fondo:\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/);
  if (!m) throw new Error("no se encontró --color-fondo como oklch() en index.css");
  return oklchAHex(Number(m[1]) / 100, Number(m[2]), Number(m[3]));
}

describe("el color de marca sale del token, no de tres literales sueltos", () => {
  it("la conversión OKLCH→sRGB es la que se espera", () => {
    // Control: si esta línea falla, lo roto es la conversión y no los ficheros de marca. Sin él, un
    // error en las matrices haría fallar los tres asertos de abajo y apuntaría al sitio equivocado.
    // anti-slop-allow: el valor esperado de la conversión; escribirlo es el test
    expect(oklchAHex(0.177, 0.034, 269.6)).toBe("#0b1020");
  });

  it("el theme-color del HTML es el token", () => {
    const m = html.match(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/);
    expect(m?.[1]?.toLowerCase()).toBe(tokenFondo());
  });

  it("el theme_color del manifiesto es el token", () => {
    expect(String(manifiesto.theme_color).toLowerCase()).toBe(tokenFondo());
  });

  it("el background_color del manifiesto es el token", () => {
    // Es el color de la pantalla de arranque de la PWA: si no casa con el fondo real, la app abre
    // con un destello de otro color antes de pintar.
    expect(String(manifiesto.background_color).toLowerCase()).toBe(tokenFondo());
  });
});

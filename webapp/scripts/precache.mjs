import { readdir, writeFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";

/**
 * Escribe `dist/precache.json`: la lista de lo que el service worker debe tener antes de perder la
 * red.
 *
 * **Por qué existe.** El SW cacheaba `["/", "/index.html", "/manifest.webmanifest"]` y nada más. Es
 * lo que hace falta para que la app *abra*, que no es lo mismo que para que *funcione*: los
 * `assets/index-<hash>.js` se piden en la primera carga **antes** de que el SW tome el control, así
 * que nunca entraban en caché. Sin red, el SW servía `index.html` de caché y para el bundle caía al
 * mismo fallback, con lo que el navegador recibía `text/html` donde esperaba un módulo y `#root` se
 * quedaba vacío. En el metro —el escenario declarado de la spec §2.2— la app era una página en
 * blanco. Reproducido por `qa-adversario` (F2/A9).
 *
 * **Por qué generada y no escrita a mano.** Los nombres llevan hash de contenido: cualquier lista
 * literal en `sw.ts` estaría mal en el commit siguiente, y estaría mal **en silencio**, que es la
 * peor forma de estarlo.
 *
 * Se excluyen `sw.js` (quien precarga no se precarga a sí mismo) y este propio fichero.
 */

const DIST = "dist";
const FUERA = new Set(["sw.js", "precache.json"]);

async function ficheros(dir) {
  const entradas = await readdir(dir, { withFileTypes: true });
  const salida = [];
  for (const e of entradas) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) salida.push(...await ficheros(ruta));
    else salida.push(ruta);
  }
  return salida;
}

const rutas = (await ficheros(DIST))
  .map((f) => "/" + relative(DIST, f).split(sep).join(posix.sep))
  .filter((r) => !FUERA.has(r.slice(1)))
  .sort();

// `/` va explícito: es la URL que pide el navegador al abrir la app, y no es un fichero de `dist`.
const lista = ["/", ...rutas];

await writeFile(join(DIST, "precache.json"), JSON.stringify(lista, null, 2) + "\n");
console.log(`precache.json — ${lista.length} recursos`);

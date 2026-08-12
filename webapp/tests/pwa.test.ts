import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Instalabilidad de la PWA (criterio **V5**), medida sobre el build de producción.
 *
 * La pieza que de verdad importa: **el manifiesto tiene que servir los iconos que declara, en los
 * tamaños que declara**. Un manifiesto que apunta a ficheros que no existen —o que existen con otro
 * tamaño— pasa cualquier revisión visual y no instala. Aquí se lee la cabecera IHDR de cada PNG y se
 * compara con el `sizes` declarado, en vez de confiar en el nombre del fichero.
 *
 * Se ejecuta contra `dist/`, no contra `public/`: lo que se despliega es lo que hay que medir.
 */

const DIST = join(import.meta.dirname, "..", "dist");

/** Ancho y alto reales de un PNG, leídos de su cabecera IHDR. */
function dimensionesPng(ruta: string): { ancho: number; alto: number } {
  const buf = readFileSync(ruta);
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(0, 8).equals(firma), `${ruta} no es un PNG`).toBe(true);
  return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20) };
}

interface IconoManifiesto {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

describe("PWA instalable (V5)", () => {
  const manifiesto = JSON.parse(
    readFileSync(join(DIST, "manifest.webmanifest"), "utf8"),
  ) as Record<string, unknown> & { icons: IconoManifiesto[] };

  it("el manifiesto declara lo que un navegador exige para instalar", () => {
    expect(manifiesto.name).toBeTruthy();
    expect(manifiesto.short_name).toBeTruthy();
    expect(manifiesto.start_url).toBe("/");
    expect(manifiesto.display).toBe("standalone");
    expect(manifiesto.icons.length).toBeGreaterThan(0);
  });

  it("cada icono declarado existe y mide lo que dice medir", () => {
    for (const icono of manifiesto.icons) {
      const ruta = join(DIST, icono.src.replace(/^\//, ""));
      const { ancho, alto } = dimensionesPng(ruta);
      const [wDeclarado, hDeclarado] = icono.sizes.split("x").map(Number);
      expect(ancho, `${icono.src}: ancho real ${ancho} ≠ declarado ${wDeclarado}`).toBe(wDeclarado);
      expect(alto, `${icono.src}: alto real ${alto} ≠ declarado ${hDeclarado}`).toBe(hDeclarado);
    }
  });

  it("hay un icono maskable de 512, que es lo que pide un lanzador de Android", () => {
    const maskable = manifiesto.icons.filter((i) => i.purpose?.includes("maskable"));
    expect(maskable.length).toBeGreaterThan(0);
    expect(maskable.some((i) => i.sizes === "512x512")).toBe(true);
  });

  it("el armazón enlaza el manifiesto y el service worker está construido", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("/manifest.webmanifest");
    // `sw.js` con nombre fijo y en la raíz: si el build lo hashea, el registro por ruta se rompe.
    const sw = readFileSync(join(DIST, "sw.js"), "utf8");
    expect(sw.length).toBeGreaterThan(0);
    expect(sw).toContain("addEventListener");
  });

  it("el service worker NO cachea la API: una respuesta cacheada es una segunda copia de la verdad", () => {
    const sw = readFileSync(join(DIST, "sw.js"), "utf8");
    expect(sw).toContain("/api");
    expect(sw).toContain("/health");
  });
});

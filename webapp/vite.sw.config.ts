import { defineConfig } from "vite";

/**
 * Build aparte del service worker.
 *
 * Va en su propia config —patrón heredado de Pokelock (`vite.sw.config.ts`)— porque el SW no es un
 * módulo de la app: necesita salir como **un único fichero en la raíz de `dist` y con nombre fijo**
 * (`sw.js`), sin hash y sin fragmentación, o el navegador no puede registrarlo por ruta estable.
 *
 * `emptyOutDir: false` es obligatorio: este build corre DESPUÉS del de la app y borraría su salida.
 */
export default defineConfig({
  build: {
    emptyOutDir: false,
    rollupOptions: {
      input: "src/sw.ts",
      output: { entryFileNames: "sw.js", format: "iife" },
    },
  },
});

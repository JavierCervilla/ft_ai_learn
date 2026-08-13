import { defineConfig, devices } from "@playwright/test";

/**
 * Recorridos de interfaz contra la app **entera**.
 *
 * `baseURL` apunta al servidor Deno (que sirve el bundle estático **y** la API), no a un `vite dev`
 * ni a un `serve dist`: lo que se está probando es que el formulario habla con la API de verdad,
 * contra una base de verdad. Un servidor de estáticos con la API mockeada probaría el mock.
 *
 * Sólo Chromium: el contenedor trae uno preinstalado en `PLAYWRIGHT_BROWSERS_PATH` y añadir motores
 * multiplicaría el tiempo de CI sin comprar nada — esto no verifica compatibilidad de navegador,
 * verifica cableado.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Los recorridos comparten una base de datos: en paralelo se pisarían el cupo de invitaciones.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL_TEST ?? "http://localhost:8000",
    // Traza sólo del intento fallido: en verde no sirve de nada y pesa.
    trace: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      launchOptions: {
        /**
         * En el contenedor del enjambre hay un Chromium preinstalado cuya build **no coincide** con
         * la que pide esta versión de Playwright, y bajarse otro está bloqueado. Con
         * `PLAYWRIGHT_CHROMIUM` apuntando al binario de aquí, los recorridos corren en local; en CI
         * la variable no está y Playwright usa el que instala él, que es el emparejado.
         */
        executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
      },
    },
  }],
});

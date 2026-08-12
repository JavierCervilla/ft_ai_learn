// `defineConfig` de vitest/config y no de vite: es el que conoce el bloque `test`.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // En desarrollo la API la sirve el backend Deno; el cliente siempre habla por HTTP con ella,
    // nunca comparte proceso. Es la regla del bundle (spec §6.2) puesta en el dev server.
    proxy: { "/health": "http://localhost:8000", "/api": "http://localhost:8000" },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});

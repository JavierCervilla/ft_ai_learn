// Config de ESLint de la webapp (Vite + React, NO Next).
//
// Se escribe a mano y ANTES de correr el scaffolder de la skill `code-anti-slop`: ese instalador,
// si no encuentra una config, genera una de **Next.js** (`next/core-web-vitals`), que aquí sería
// veneno. Encontrándola, la respeta y sólo añade el preset.
//
// El preset anti-slop trae `@typescript-eslint/no-explicit-any`, que en un proyecto Next lo aportaría
// `next/typescript`. Aquí lo aporta `typescript-eslint`, configurado abajo.
//
// Versiones, y no por gusto: `typescript-eslint` declara soporte de TypeScript `<6.1.0` (por eso el
// proyecto NO va con TS 7) y `eslint-plugin-import`, que el preset necesita para `import/no-cycle`,
// tope en ESLint ^9 (por eso NO va con ESLint 10).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import antiSlop from "./eslint.anti-slop.mjs";

export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // Los scripts de build corren en Node, no en el navegador: sin esto `console` es un `no-undef`.
    // Se listan a mano en vez de añadir el paquete `globals` — son dos, y una dependencia de
    // desarrollo también es superficie de suministro.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
  ...antiSlop,
];

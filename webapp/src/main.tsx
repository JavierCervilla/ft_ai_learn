import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

const raiz = document.getElementById("root");
if (!raiz) throw new Error("falta #root en index.html");

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// El service worker se registra sólo en producción: en desarrollo serviría un armazón cacheado por
// encima de lo que Vite acaba de recompilar, que es la forma más rápida de perder una tarde.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  globalThis.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.error("no se pudo registrar el service worker", e);
    });
  });
}

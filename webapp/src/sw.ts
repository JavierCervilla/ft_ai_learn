/**
 * Service worker.
 *
 * El escenario principal de la app es el metro (spec §2.2): se usa **sin cobertura**. En FTAI-B el
 * SW hace lo mínimo honesto —cachear el armazón para que la app abra offline— y nada más.
 *
 * Lo que NO hace, a propósito: **no cachea `/health` ni `/api`**. Una respuesta de la API servida
 * desde caché es una segunda copia de la verdad; el progreso encolado sin red es trabajo de FTAI-E,
 * con su propia cola, no un efecto colateral de un `fetch` interceptado.
 *
 * El `self` tipado se toma con un cast y no con `declare const self`: la lib `webworker` ya lo
 * declara y redeclararlo choca. Compila con `tsconfig.sw.json` (lib WebWorker, sin DOM).
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = "ftai-armazon-v1";
const ARMAZON = ["/", "/index.html", "/manifest.webmanifest"];

sw.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARMAZON)));
  sw.skipWaiting();
});

sw.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("fetch", (evento) => {
  const url = new URL(evento.request.url);
  if (evento.request.method !== "GET") return;
  if (url.pathname.startsWith("/api") || url.pathname === "/health") return;

  // Red primero, caché como red de seguridad: sin cobertura la app abre; con cobertura no sirve
  // nunca un armazón viejo.
  evento.respondWith(
    fetch(evento.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(evento.request, copia));
        return res;
      })
      .catch(async () => {
        const enCache = await caches.match(evento.request);
        return enCache ?? (await caches.match("/index.html")) ?? Response.error();
      }),
  );
});

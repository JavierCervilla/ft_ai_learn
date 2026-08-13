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

const CACHE = "ftai-armazon-v2";

/** El mínimo con el que la app abre, si `precache.json` no se pudiera leer. */
const ARMAZON = ["/", "/index.html", "/manifest.webmanifest"];

/**
 * Qué se precarga.
 *
 * `ARMAZON` a secas era **abrir**, no **funcionar**: los `assets/*` con hash se piden antes de que
 * este SW controle la página, así que nunca llegaban a la caché y sin red el navegador recibía el
 * `index.html` del fallback donde esperaba un módulo JS. `#root` vacío, página en blanco en el metro
 * (F2/A9 de `qa-adversario`). La lista la genera `scripts/precache.mjs` en cada build porque los
 * nombres llevan hash: escrita a mano estaría desactualizada al commit siguiente, y en silencio.
 *
 * Si `precache.json` falla se cae al armazón en vez de abortar la instalación: un SW instalado a
 * medias sigue sirviendo la app con red, y uno no instalado no sirve nada.
 */
async function aPrecargar(): Promise<string[]> {
  try {
    const res = await fetch("/precache.json", { cache: "no-cache" });
    if (!res.ok) return ARMAZON;
    const lista = await res.json();
    return Array.isArray(lista) && lista.length > 0 ? lista as string[] : ARMAZON;
  } catch {
    return ARMAZON;
  }
}

sw.addEventListener("install", (evento) => {
  evento.waitUntil(
    aPrecargar().then((lista) => caches.open(CACHE).then((c) => c.addAll(lista))),
  );
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
        if (enCache) return enCache;
        // El `index.html` sólo vale como red de seguridad para una **navegación**. Devolverlo para
        // un `assets/*.js` que falta le da al navegador `text/html` donde espera un módulo, y el
        // error que sale entonces habla de MIME types en vez de decir que falta el fichero.
        if (evento.request.mode === "navigate") {
          return (await caches.match("/index.html")) ?? Response.error();
        }
        return Response.error();
      }),
  );
});

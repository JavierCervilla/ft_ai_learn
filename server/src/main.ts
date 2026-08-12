import { Application, Router } from "@oak/oak";
import { crearCliente, sondaDe } from "./db.ts";
import { salud } from "./salud.ts";

/**
 * El servidor: la API y el servidor de estáticos del bundle de la webapp.
 *
 * **Regla del bundle** (spec §6.2): el cliente es un bundle estático que habla con esta API por
 * HTTPS. Nada se renderiza aquí. Es lo que mantiene el empaquetado para tiendas a una tarea de
 * distancia en vez de a una migración.
 */

const VERSION = "0.1.0";
const PUERTO = Number(Deno.env.get("PORT") ?? 8000);
const RAIZ_ESTATICOS = Deno.env.get("STATIC_ROOT") ?? "webapp/dist";

const urlDb = Deno.env.get("DATABASE_URL");
if (!urlDb) {
  console.error("falta DATABASE_URL (sólo por entorno; nunca en el repo)");
  Deno.exit(2);
}

const sql = crearCliente(urlDb);
const sonda = sondaDe(sql);

const router = new Router();
router.get("/health", async (ctx) => {
  const estado = await salud(sonda, VERSION);
  // 503 cuando algo está caído: un orquestador que sólo mira el código no puede dar por buena una
  // instancia que no llega a su base.
  ctx.response.status = estado.ok ? 200 : 503;
  ctx.response.body = estado;
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());

// Estáticos del bundle. Cualquier ruta desconocida cae en index.html porque el enrutado es del
// cliente (SPA); las rutas de la API ya se resolvieron arriba.
app.use(async (ctx) => {
  try {
    await ctx.send({ root: RAIZ_ESTATICOS, index: "index.html" });
  } catch {
    await ctx.send({ root: RAIZ_ESTATICOS, path: "index.html" });
  }
});

if (import.meta.main) {
  console.log(`escuchando en :${PUERTO} (estáticos desde ${RAIZ_ESTATICOS})`);
  await app.listen({ port: PUERTO });
}

export { app };

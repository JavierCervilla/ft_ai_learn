/**
 * Aplica las migraciones versionadas de `./migrations` contra `DATABASE_URL`.
 *
 * El SQL lo **genera** `deno task db:generate` y se **revisa en el PR** como cualquier otro código.
 * Nunca `drizzle-kit push`: escribe contra la base sin dejar nada que revisar, y puede tirar columnas
 * en silencio.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = Deno.env.get("DATABASE_URL");
if (!url) {
  console.error("falta DATABASE_URL (sólo por entorno; nunca en el repo)");
  Deno.exit(2);
}

// `max: 1` porque migrar en paralelo sobre varias conexiones es una carrera contra uno mismo.
// `onnotice` silencia los NOTICE de Postgres («schema drizzle already exists, skipping»): en una
// re-ejecución imprimen dos volcados con pinta de excepción justo antes del mensaje de éxito, y un
// error de verdad quedaría enterrado entre ellos. Se callan los avisos, no los fallos.
const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), {
    migrationsFolder: new URL("./migrations", import.meta.url).pathname,
  });
  console.log("migraciones aplicadas");
} finally {
  await client.end();
}

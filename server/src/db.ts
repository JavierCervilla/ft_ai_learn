import postgres from "postgres";
import type { SondaDb } from "./salud.ts";

/**
 * Conexión a Postgres. `DATABASE_URL` viene SIEMPRE del entorno: nunca del repo, nunca impresa.
 */
export function crearCliente(url: string) {
  return postgres(url, { max: 5, idle_timeout: 20 });
}

/**
 * Sonda del healthcheck: la base responde **y** la línea base de migraciones está aplicada.
 *
 * Se comprueba `app_meta` con `to_regclass` en vez de consultarla: preguntar por el catálogo no
 * lanza si la tabla no existe, así que "falta el esquema" se distingue de "la base está caída".
 */
export function sondaDe(sql: ReturnType<typeof crearCliente>): SondaDb {
  return async () => {
    const filas = await sql<{ existe: string | null }[]>`
      select to_regclass('public.app_meta')::text as existe
    `;
    return { arriba: true, esquema: filas[0]?.existe !== null };
  };
}

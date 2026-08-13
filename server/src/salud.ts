import { desbordesDelPiso } from "./admision.ts";

/**
 * El healthcheck.
 *
 * Responde por la cadena entera, no por sí mismo: consulta la base y comprueba que la línea base de
 * migraciones está aplicada. Un `200` que sólo prueba que el proceso arrancó es exactamente el tipo
 * de gate que no fija lo que dice fijar — el contenedor puede estar vivo con la base caída y el
 * orquestador daría el despliegue por bueno.
 */

export interface Salud {
  ok: boolean;
  /** `up` = la base responde. `down` = no. */
  db: "up" | "down";
  /** `ready` = la línea base de migraciones está aplicada. */
  schema: "ready" | "missing" | "unknown";
  version: string;
  /**
   * Cuántas respuestas del alta han **superado** su piso temporal (ver `admision.ts`).
   *
   * Es el canario de que el no-oráculo por tiempo se sostiene: mientras sea 0, todas las respuestas
   * de `/api/registro` han salido a la misma hora. Si sube, el piso no está sujetando —o el techo no
   * está apretando— y el canal se está reabriendo. Sin este número, «se sostiene» es una creencia.
   *
   * Es un contador y **nunca lleva correo ni código**: dice cuántas veces, no de quién.
   */
  registroDesbordes: number;
}

/** Sonda de la base. Se inyecta para poder probar el handler sin levantar Postgres. */
export type SondaDb = () => Promise<{ arriba: boolean; esquema: boolean }>;

export async function salud(sonda: SondaDb, version: string): Promise<Salud> {
  let arriba = false;
  let esquema = false;
  try {
    const r = await sonda();
    arriba = r.arriba;
    esquema = r.esquema;
  } catch {
    // Un fallo de la sonda ES el diagnóstico: se reporta como caída, no se propaga como 500 opaco.
    arriba = false;
  }
  return {
    ok: arriba && esquema,
    db: arriba ? "up" : "down",
    schema: arriba ? (esquema ? "ready" : "missing") : "unknown",
    version,
    registroDesbordes: desbordesDelPiso(),
  };
}

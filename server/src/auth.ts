import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import * as esquema from "@ftai/esquema";
import { hash, verify } from "./contrasenas.ts";

/**
 * La identidad: Better Auth sobre **nuestro** Postgres.
 *
 * La librería se lleva lo que es fácil hacer mal a mano —derivación lenta, ciclo de vida de la cookie,
 * invalidación de sesión— y nada más. Lo que ninguna librería de sesiones resuelve, la **autorización
 * por recurso** (spec §12.3), es nuestro y vive en `progreso.ts` e `invitaciones.ts`.
 *
 * El esquema lo declaramos nosotros en `db/schema.ts` y se migra con `drizzle-kit` como el resto: un
 * solo camino de migración, revisable en el diff del PR.
 *
 * **El alta por invitación NO se monta aquí** sino en `registro.ts`, como endpoint propio. Se probó
 * con los `databaseHooks` de la librería y se descartó: el hook `before` corre antes de que exista el
 * `id` del usuario y el `after` después, sin forma de pasar contexto entre ellos, así que ligar la
 * invitación a su usuario obligaba a **adivinar cuál era** con un `order by ... limit 1`. Eso es una
 * carrera con la concurrencia justa. Un endpoint explícito hace visible el orden de los pasos.
 */

const MINIMO_SECRETO = 32;

/** Cookies de sesión. `Secure` sólo donde hay HTTPS: en dev local (HTTP) no viajaría y no habría login. */
export function cookiesSeguras(baseUrl: string): boolean {
  return baseUrl.startsWith("https://");
}

/**
 * Lee el secreto de sesión del entorno y **se planta si no vale**.
 *
 * Better Auth se limita a avisar por consola con un secreto corto o de baja entropía, y un aviso en
 * un log de arranque es un aviso que nadie lee. Aquí es un fallo de arranque: un servidor que firma
 * sesiones con un secreto de juguete es peor que un servidor que no arranca.
 */
export function leerSecreto(entorno: { get(clave: string): string | undefined }): string {
  const secreto = entorno.get("BETTER_AUTH_SECRET");
  if (!secreto || secreto.length < MINIMO_SECRETO) {
    throw new Error(
      `falta BETTER_AUTH_SECRET o es más corto de ${MINIMO_SECRETO} caracteres. ` +
        "Genera uno con `openssl rand -base64 32`. Sólo por entorno; nunca en el repo.",
    );
  }
  return secreto;
}

export interface OpcionesAuth {
  sql: Sql;
  secreto: string;
  baseUrl: string;
}

export function crearAuth({ sql, secreto, baseUrl }: OpcionesAuth) {
  return betterAuth({
    database: drizzleAdapter(drizzle(sql), { provider: "pg", schema: esquema }),
    secret: secreto,
    baseURL: baseUrl,
    basePath: "/api/auth",
    emailAndPassword: {
      enabled: true,
      // Sin verificación por correo: no hay servicio de email en el proyecto y el alta ya está
      // cerrada por invitación, que es un control más fuerte que confirmar un buzón.
      requireEmailVerification: false,
      password: { hash, verify },
    },
    advanced: { useSecureCookies: cookiesSeguras(baseUrl) },
  });
}

export type Auth = ReturnType<typeof crearAuth>;

/**
 * Quién hace la petición, o `null`.
 *
 * **Es la única puerta de entrada de la identidad al resto del servidor.** Ningún manejador lee un
 * `userId` de la ruta, la query ni el cuerpo: sale de aquí o no sale. Así el fallo no puede ser «se
 * nos olvidó comprobar la pertenencia en un endpoint» — no hay dónde escribir esa comprobación
 * porque no hay otro sitio del que sacar la identidad.
 */
export async function usuarioDe(auth: Auth, cabeceras: Headers): Promise<string | null> {
  const sesion = await auth.api.getSession({ headers: cabeceras });
  return sesion?.user?.id ?? null;
}

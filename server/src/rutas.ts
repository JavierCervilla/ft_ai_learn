import type { Context, Router } from "@oak/oak";
import type { Sql } from "postgres";
import type { Grafo } from "@ftai/core";
import { type Auth, usuarioDe } from "./auth.ts";
import { cupoDe, emitir, listar, revocar } from "./invitaciones.ts";
import { type Marca, marcar, vistaDe } from "./progreso.ts";
import { registrar } from "./registro.ts";

/**
 * Las rutas que tienen dueño.
 *
 * Todas comparten la misma forma: la identidad sale de la **cookie de sesión** y de ningún otro
 * sitio. No hay `/api/users/:id/...` en este fichero y no debe haberlo: una ruta que aceptase un
 * usuario por parámetro convertiría un id en una capability, que es justo lo que §12.3 prohíbe.
 */

/** Respuesta única para «no existe» y «no es tuyo», que no se distinguen a propósito (§12.4). */
const NO_ENCONTRADO = { error: "no encontrado" };

/** Métodos que cambian estado y por tanto exigen `Origin` propio (los de lectura no lo necesitan). */
const METODOS_MUTANTES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Comprueba que una petición que cambia estado viene de nuestro propio origen.
 *
 * Better Auth trae esto para sus rutas, pero **las nuestras no pasan por su handler**. La primera
 * versión se apoyaba sólo en que la cookie es `SameSite`, y el pase de rol `seguridad` señaló el
 * error: **`SameSite` es por *sitio*, no por origen**. `ftai.srcpad.pro` convive con las demás apps
 * del enjambre bajo `srcpad.pro`, así que un XSS o un subdominio tomado en cualquier hermana forja
 * peticiones autenticadas contra esta API y el navegador **sí** manda la cookie. Medido: un `PUT` con
 * cookie válida y `Origin: https://evil.example` respondía 200.
 */
function origenPropio(ctx: Context, baseUrl: string): boolean {
  if (!METODOS_MUTANTES.has(ctx.request.method)) return true;
  const origen = ctx.request.headers.get("origin");
  // Sin `Origin` se rechaza: un navegador lo manda siempre en una petición que cambia estado, así que
  // su ausencia es o un cliente que no es un navegador o justo el ataque que esto viene a parar.
  if (!origen) return false;
  return origen === new URL(baseUrl).origin;
}

async function exigirSesion(
  auth: Auth,
  ctx: Context,
  baseUrl: string,
): Promise<string | null> {
  const userId = await usuarioDe(auth, ctx.request.headers);
  if (!userId) {
    ctx.response.status = 401;
    ctx.response.body = { error: "hace falta iniciar sesión" };
    return null;
  }
  // El origen se mira DESPUÉS de la sesión, y el orden importa para lo que significa cada código: una
  // petición sin sesión no puede hacer daño venga de donde venga, así que sigue siendo un 401 honesto.
  // El CSRF sólo es un problema cuando **sí** hay cookie, y ese caso es el que cae aquí.
  if (!origenPropio(ctx, baseUrl)) {
    ctx.response.status = 403;
    ctx.response.body = { error: "origen no permitido" };
    return null;
  }
  return userId;
}

/** Vuelca una `Response` de fetch en la respuesta de Oak, conservando **todas** las `Set-Cookie`. */
async function volcar(ctx: Context, respuesta: Response): Promise<void> {
  ctx.response.status = respuesta.status;
  for (const [clave, valor] of respuesta.headers) {
    if (clave.toLowerCase() !== "set-cookie") ctx.response.headers.set(clave, valor);
  }
  // `getSetCookie()` y no `get()`: un login puede mandar varias cookies y `get()` las junta en una
  // sola cabecera, que los navegadores no parsean igual.
  for (const cookie of respuesta.headers.getSetCookie()) {
    ctx.response.headers.append("set-cookie", cookie);
  }
  ctx.response.body = new Uint8Array(await respuesta.arrayBuffer());
}

export interface DepsRutas {
  sql: Sql;
  auth: Auth;
  /** Origen canónico de la app: lo que tiene que traer un `Origin` para que se le crea. */
  baseUrl: string;
  /** El grafo se lee por petición: el contenido puede recargarse sin reiniciar el servidor. */
  leerGrafo: () => Promise<Grafo>;
}

export function montarRutas(router: Router, { sql, auth, baseUrl, leerGrafo }: DepsRutas): void {
  // --- Identidad ---------------------------------------------------------------------------------

  /**
   * Todo lo de Better Auth salvo el registro: login, logout, sesión.
   *
   * `sign-up` se **bloquea** aquí. Si se dejara pasar, cualquiera crearía una cuenta sin invitación
   * llamando al endpoint de la librería directamente, y el círculo cerrado sería decorativo.
   */
  router.all("/api/auth/(.*)", async (ctx) => {
    if (ctx.request.url.pathname.includes("/sign-up")) {
      ctx.response.status = 404;
      ctx.response.body = { error: "el alta es sólo por invitación: usa POST /api/registro" };
      return;
    }
    const cuerpo = ctx.request.hasBody
      ? new Uint8Array(await ctx.request.body.arrayBuffer())
      : undefined;
    const peticion = new Request(ctx.request.url, {
      method: ctx.request.method,
      headers: ctx.request.headers,
      body: cuerpo,
    });
    await volcar(ctx, await auth.handler(peticion));
  });

  /** El alta con invitación. Ver `registro.ts` para el orden de los pasos y por qué es ese. */
  router.post("/api/registro", async (ctx) => {
    const cuerpo = await ctx.request.body.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    // Se exige que sean **cadenas**, no sólo que estén: el cuerpo es JSON de fuera y puede traer
    // booleanos, números u objetos en cualquier campo.
    const texto = (v: unknown) => typeof v === "string" && v !== "" ? v : null;
    const email = texto(cuerpo?.email);
    const password = texto(cuerpo?.password);
    const name = texto(cuerpo?.name);
    if (!email || !password || !name) {
      ctx.response.status = 400;
      ctx.response.body = { error: "faltan email, password o name" };
      return;
    }
    const resultado = await registrar({
      sql,
      auth,
      peticion: { email, password, name, inviteCode: cuerpo?.inviteCode },
    });
    ctx.response.status = resultado.estado;
    for (const cookie of resultado.cookies) ctx.response.headers.append("set-cookie", cookie);
    ctx.response.body = resultado.cuerpo;
  });

  // --- Progreso ----------------------------------------------------------------------------------

  router.get("/api/progress", async (ctx) => {
    const userId = await exigirSesion(auth, ctx, baseUrl);
    if (!userId) return;
    ctx.response.body = await vistaDe(sql, userId, await leerGrafo());
  });

  router.put("/api/progress/:nodeId", async (ctx) => {
    const userId = await exigirSesion(auth, ctx, baseUrl);
    if (!userId) return;

    const cuerpo = await ctx.request.body.json().catch(() => null) as { state?: string } | null;
    const marca = cuerpo?.state;
    if (marca !== "in_progress" && marca !== "done") {
      ctx.response.status = 400;
      ctx.response.body = { error: "`state` debe ser 'in_progress' o 'done'" };
      return;
    }

    const resultado = await marcar(
      sql,
      userId,
      ctx.params.nodeId ?? "",
      marca as Marca,
      await leerGrafo(),
    );
    if (!resultado.ok) {
      ctx.response.status = resultado.motivo === "bloqueado" ? 409 : 404;
      ctx.response.body = resultado.motivo === "bloqueado"
        ? { error: "el nodo está bloqueado: faltan prerequisitos" }
        : NO_ENCONTRADO;
      return;
    }
    ctx.response.body = resultado.fila;
  });

  // --- Invitaciones ------------------------------------------------------------------------------

  router.get("/api/invitations", async (ctx) => {
    const userId = await exigirSesion(auth, ctx, baseUrl);
    if (!userId) return;
    ctx.response.body = {
      cupo: await cupoDe(sql, userId),
      invitaciones: await listar(sql, userId),
    };
  });

  router.post("/api/invitations", async (ctx) => {
    const userId = await exigirSesion(auth, ctx, baseUrl);
    if (!userId) return;
    // `email` opcional: con él la invitación es **nominal** y sólo la puede usar esa persona; sin él
    // sigue siendo al portador, como eran todas antes. Se valida que sea cadena por lo mismo que en
    // el registro: el cuerpo es JSON de fuera y un booleano llegaría hasta el SQL.
    const cuerpo = await ctx.request.body.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    const email = typeof cuerpo?.email === "string" && cuerpo.email !== "" ? cuerpo.email : null;
    const invitacion = await emitir(sql, userId, email);
    if (!invitacion) {
      ctx.response.status = 409;
      ctx.response.body = { error: "sin cupo de invitaciones" };
      return;
    }
    ctx.response.status = 201;
    ctx.response.body = invitacion;
  });

  router.delete("/api/invitations/:code", async (ctx) => {
    const userId = await exigirSesion(auth, ctx, baseUrl);
    if (!userId) return;
    // `revocar` mete el `inviter_id` en el `WHERE`: revocar la de otro no falla por permisos, es que
    // no encuentra fila. Por eso la respuesta es la misma que para un código inexistente.
    const hecho = await revocar(sql, userId, ctx.params.code ?? "");
    if (!hecho) {
      ctx.response.status = 404;
      ctx.response.body = NO_ENCONTRADO;
      return;
    }
    ctx.response.body = { cupo: await cupoDe(sql, userId) };
  });
}

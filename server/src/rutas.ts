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

async function exigirSesion(auth: Auth, ctx: Context): Promise<string | null> {
  const userId = await usuarioDe(auth, ctx.request.headers);
  if (!userId) {
    ctx.response.status = 401;
    ctx.response.body = { error: "hace falta iniciar sesión" };
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
  /** El grafo se lee por petición: el contenido puede recargarse sin reiniciar el servidor. */
  leerGrafo: () => Promise<Grafo>;
}

export function montarRutas(router: Router, { sql, auth, leerGrafo }: DepsRutas): void {
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
      | Record<string, string>
      | null;
    if (!cuerpo?.email || !cuerpo?.password || !cuerpo?.name) {
      ctx.response.status = 400;
      ctx.response.body = { error: "faltan email, password o name" };
      return;
    }
    const resultado = await registrar({
      sql,
      auth,
      peticion: {
        email: cuerpo.email,
        password: cuerpo.password,
        name: cuerpo.name,
        inviteCode: cuerpo.inviteCode ?? "",
      },
    });
    ctx.response.status = resultado.estado;
    for (const cookie of resultado.cookies) ctx.response.headers.append("set-cookie", cookie);
    ctx.response.body = resultado.cuerpo;
  });

  // --- Progreso ----------------------------------------------------------------------------------

  router.get("/api/progress", async (ctx) => {
    const userId = await exigirSesion(auth, ctx);
    if (!userId) return;
    ctx.response.body = await vistaDe(sql, userId, await leerGrafo());
  });

  router.put("/api/progress/:nodeId", async (ctx) => {
    const userId = await exigirSesion(auth, ctx);
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
    const userId = await exigirSesion(auth, ctx);
    if (!userId) return;
    ctx.response.body = {
      cupo: await cupoDe(sql, userId),
      invitaciones: await listar(sql, userId),
    };
  });

  router.post("/api/invitations", async (ctx) => {
    const userId = await exigirSesion(auth, ctx);
    if (!userId) return;
    const invitacion = await emitir(sql, userId);
    if (!invitacion) {
      ctx.response.status = 409;
      ctx.response.body = { error: "sin cupo de invitaciones" };
      return;
    }
    ctx.response.status = 201;
    ctx.response.body = invitacion;
  });

  router.delete("/api/invitations/:code", async (ctx) => {
    const userId = await exigirSesion(auth, ctx);
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

/**
 * El cliente de la API. Sin dependencias: `fetch` y tipos.
 *
 * **La regla que gobierna este fichero**: el mensaje que se le enseña a la persona **sale del cuerpo
 * de la respuesta**, nunca de interpretar el código de estado. El servidor unificó a propósito todos
 * los fallos de alta en un 403 idéntico para no dar un oráculo de pertenencia (§12.4); una interfaz
 * servicial que dijera «ese email ya tiene cuenta» o «esa invitación no es para ti» **desharía ese
 * trabajo desde el cliente**, y encima sin que ningún test del servidor se enterase.
 */

import type { Grafo } from "../../core/src/mod.ts";

export interface Sesion {
  user: { id: string; email: string; name: string };
}

export interface Invitacion {
  code: string;
  email: string | null;
  createdAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  usedByUserId: string | null;
  /** De quién es, según el servidor. Ver el comentario de `emitir` en `Cuenta.tsx`. */
  inviterId: string;
}

export interface EstadoInvitaciones {
  cupo: number;
  invitaciones: Invitacion[];
}

/** Un fallo con el mensaje **que dio el servidor**, para no inventarlo aquí. */
export class ErrorApi extends Error {
  constructor(mensaje: string, readonly estado: number) {
    super(mensaje);
    this.name = "ErrorApi";
  }
}

const MENSAJE_SIN_RED = "No se pudo hablar con el servidor. Comprueba la conexión.";

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
  } catch {
    // Un fallo de red se dice; no se traga ni se disfraza de error del servidor (Aroma §13.4).
    throw new ErrorApi(MENSAJE_SIN_RED, 0);
  }

  const cuerpo = await respuesta.json().catch(() => null) as Record<string, unknown> | null;
  if (!respuesta.ok) {
    const delServidor = typeof cuerpo?.error === "string"
      ? cuerpo.error
      : typeof cuerpo?.message === "string"
      ? cuerpo.message
      : "No se pudo completar la operación.";
    throw new ErrorApi(delServidor, respuesta.status);
  }
  return cuerpo as T;
}

/** Un fallo de red, distinguible de cualquier respuesta del servidor. */
export const SIN_RED = 0;

/**
 * Los estados en los que **no sabemos** quién eres, que no es lo mismo que saber que no eres nadie.
 *
 * `SIN_RED` estaba desde D.2. El **429** se añadió tras diagnosticar el fallo intermitente que llevaba
 * tres trayectorias contaminando la verificación local y que yo venía llamando «ruido del entorno»: el
 * límite de peticiones de Better Auth **no puede resolver la IP del cliente** en este despliegue, así
 * que cae a un **cubo compartido por todo el mundo** (lo avisa él mismo en el arranque). Al agotarse,
 * `/api/auth/get-session` devuelve 429 y la app lo leía como «no hay sesión»: te enseñaba el formulario
 * de acceso **estando dentro**.
 *
 * Es exactamente la familia que vigila A9 —un fallo que no es «no tienes sesión» leído como si lo
 * fuera— y la regla del proyecto ya estaba escrita: *un estado que el programa no puede distinguir es
 * un estado sobre el que va a mentir*. Con el cubo compartido no hace falta ni un atacante: basta gente
 * usando la app a la vez.
 */
export const NO_SE_SABE = new Set<number>([SIN_RED, 429]);

/**
 * El grafo de aprendizaje.
 *
 * Es **público**: no lleva el progreso de nadie, así que no necesita sesión ni se puede filtrar por él.
 * Tu progreso vive aparte, en `/api/progress`, y lo trae FTAI-E.3 — separados porque tienen dueños y
 * duraciones distintas: el grafo es el mismo para todos y cambia con el contenido; el progreso es tuyo
 * y cambia contigo.
 */
export function grafo(): Promise<Grafo> {
  return pedir<Grafo>("/api/graph");
}

/**
 * Quién eres, o `null`. Es lo primero que pregunta la app al cargar.
 *
 * **Un fallo de red NO es «no tienes sesión»** y por eso se relanza. Tragarlo devolviendo `null` —que
 * es lo que hacía— le enseñaba el formulario de acceso a quien tenía la sesión perfectamente viva:
 * sin cobertura la app le decía que la había echado, y encima le ofrecía un botón «Entrar» que
 * offline tampoco podía funcionar. Reproducido por `qa-adversario` (F3/A9) en el escenario declarado
 * del producto, que es el metro.
 */
export async function sesionActual(): Promise<Sesion | null> {
  try {
    const s = await pedir<Sesion | null>("/api/auth/get-session");
    return s?.user ? s : null;
  } catch (fallo) {
    if (fallo instanceof ErrorApi && NO_SE_SABE.has(fallo.estado)) throw fallo;
    // Sin sesión la librería responde con un cuerpo vacío; eso no es un error que enseñar.
    return null;
  }
}

export function registrarse(datos: {
  email: string;
  name: string;
  password: string;
  inviteCode: string;
}): Promise<Sesion> {
  return pedir<Sesion>("/api/registro", { method: "POST", body: JSON.stringify(datos) });
}

export function entrar(datos: { email: string; password: string }): Promise<Sesion> {
  return pedir<Sesion>("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify(datos),
  });
}

/** El cuerpo `{}` no es decorativo: sin él Better Auth responde 400 «Invalid JSON». */
export function salir(): Promise<unknown> {
  return pedir("/api/auth/sign-out", { method: "POST", body: "{}" });
}

export function misInvitaciones(): Promise<EstadoInvitaciones> {
  return pedir<EstadoInvitaciones>("/api/invitations");
}

export function emitirInvitacion(email?: string): Promise<Invitacion> {
  return pedir<Invitacion>("/api/invitations", {
    method: "POST",
    body: JSON.stringify(email ? { email } : {}),
  });
}

/**
 * ¿Tiene forma de correo?
 *
 * Deliberadamente laxa —una expresión que persiga el RFC 5322 rechaza direcciones válidas— y sólo
 * sirve para lo que la motivó: `consumir()` compara `lower(email)` contra el correo del alta, así que
 * una invitación nominal emitida a algo que no es un correo **no la puede usar nadie jamás**, y sin
 * embargo se cobra el cupo y se enseña en la lista como una invitación viva (F8/A2). El
 * `<input type="email">` no la cazaba porque no vive dentro de un `<form>`: su validación nativa no
 * llega a correr nunca. La misma comprobación está en el servidor, que es donde manda.
 */
export function pareceCorreo(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Longitud exacta de un código: 16 bytes en base64url, sin relleno. */
export const LARGO_CODIGO = 22;

/**
 * ¿Tiene **forma** de código de invitación?
 *
 * Es una comprobación **sintáctica**, no de pertenencia, y esa distinción es la que la hace legítima:
 * el formato es público —se ve en cualquier código— así que decir «esto no tiene forma de código» no
 * responde nada sobre quién está en el círculo. El servidor sigue devolviendo su 403 indistinguible
 * para todo lo demás, y aquí no se toca.
 *
 * Existe porque a la primera invitación del producto le faltaba el guion inicial al copiarla, y el no
 * -oráculo —correcto frente a un desconocido— dejó a la persona invitada mirando un mensaje mudo sin
 * ninguna pista. Un código de 21 caracteres no hace falta mandarlo al servidor para saber que no vale.
 */
export function pareceCodigo(v: string): boolean {
  return new RegExp(`^[A-Za-z0-9_-]{${LARGO_CODIGO}}$`).test(v);
}

export function revocarInvitacion(code: string): Promise<{ cupo: number }> {
  return pedir<{ cupo: number }>(`/api/invitations/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
}

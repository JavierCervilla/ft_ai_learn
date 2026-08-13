/**
 * El cliente de la API. Sin dependencias: `fetch` y tipos.
 *
 * **La regla que gobierna este fichero**: el mensaje que se le enseña a la persona **sale del cuerpo
 * de la respuesta**, nunca de interpretar el código de estado. El servidor unificó a propósito todos
 * los fallos de alta en un 403 idéntico para no dar un oráculo de pertenencia (§12.4); una interfaz
 * servicial que dijera «ese email ya tiene cuenta» o «esa invitación no es para ti» **desharía ese
 * trabajo desde el cliente**, y encima sin que ningún test del servidor se enterase.
 */

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
    if (fallo instanceof ErrorApi && fallo.estado === SIN_RED) throw fallo;
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

export function revocarInvitacion(code: string): Promise<{ cupo: number }> {
  return pedir<{ cupo: number }>(`/api/invitations/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
}

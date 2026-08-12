import type { Sql } from "postgres";
import type { Auth } from "./auth.ts";
import { consumir, darCupoInicial, liberar, ligar } from "./invitaciones.ts";

/**
 * El alta, que **sólo existe con invitación** (spec §12).
 *
 * Los pasos están aquí a la vista y en este orden a propósito:
 *
 * 1. **Consumir el código** con un `UPDATE` condicional. Es el punto de exclusión mutua: si dos
 *    personas mandan el mismo código a la vez, sólo una pasa de aquí.
 * 2. **Crear el usuario** con Better Auth.
 * 3. **Ligar** la invitación al usuario creado y darle su cupo.
 *
 * Si el paso 2 falla se **libera** el código (compensación), porque si no una contraseña rechazada
 * quemaría la invitación de otro. Queda una ventana real: una caída entre el 1 y el 3 deja el código
 * consumido y sin dueño. Se acepta y se documenta porque falla del lado seguro —un código gastado de
 * más, nunca una cuenta de más— y cerrarla del todo exigiría que la librería escribiera dentro de
 * nuestra transacción, que no hace.
 */

export interface PeticionRegistro {
  email: string;
  password: string;
  name: string;
  inviteCode: string;
}

export interface ResultadoRegistro {
  estado: number;
  cuerpo: Record<string, unknown>;
  cookies: string[];
}

/** Lo que se le dice a quien trae un código que no vale. Nunca por qué: eso ayudaría a sondearlos. */
const INVITACION_NO_VALIDA = { error: "invitación no válida" };

export async function registrar(
  { sql, auth, peticion }: { sql: Sql; auth: Auth; peticion: PeticionRegistro },
): Promise<ResultadoRegistro> {
  const codigo = await consumir(sql, peticion.inviteCode ?? "");
  if (!codigo) return { estado: 403, cuerpo: INVITACION_NO_VALIDA, cookies: [] };

  let respuesta: Response;
  try {
    respuesta = await auth.api.signUpEmail({
      body: { email: peticion.email, password: peticion.password, name: peticion.name },
      asResponse: true,
    });
  } catch (e) {
    await liberar(sql, codigo);
    throw e;
  }

  if (!respuesta.ok) {
    await liberar(sql, codigo);
    return {
      estado: respuesta.status,
      cuerpo: await respuesta.json().catch(() => ({
        error: "no se pudo crear la cuenta",
      })) as Record<string, unknown>,
      cookies: [],
    };
  }

  const creado = await respuesta.json() as Record<string, unknown> & { user?: { id?: string } };
  const userId = creado.user?.id;
  if (userId) {
    await ligar(sql, codigo, userId);
    await darCupoInicial(sql, userId);
  }

  return {
    estado: 200,
    cuerpo: creado,
    cookies: respuesta.headers.getSetCookie(),
  };
}

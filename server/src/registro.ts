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
  /** `unknown` porque viene de JSON de fuera: lo valida `consumir`, no el tipo. */
  inviteCode: unknown;
}

export interface ResultadoRegistro {
  estado: number;
  cuerpo: Record<string, unknown>;
  cookies: string[];
}

/**
 * **La única respuesta a un alta fallida, sea cual sea el motivo.**
 *
 * Antes se distinguía «código no válido» (403) de «ese email ya tiene cuenta» (422, que venía de la
 * librería). El pase de rol `seguridad` demostró que eso es un **oráculo de pertenencia**: con un solo
 * código válido disparó doce sondas seguidas contra el mismo email y obtuvo doce `422` **sin gastar el
 * código**, porque un alta fallida lo libera. Cualquiera con una invitación podía preguntar
 * indefinidamente «¿está fulano en el círculo?».
 *
 * En un producto cuya premisa de privacidad **es** el círculo cerrado, la pertenencia es el dato que
 * hay que proteger, y §12.4 pide justamente errores que no distingan. Ahora el único desenlace
 * distinguible es el éxito, y ése **gasta el código**: como mucho un bit por invitación.
 */
const ALTA_RECHAZADA = { error: "no se pudo completar el alta" };

export async function registrar(
  { sql, auth, peticion }: { sql: Sql; auth: Auth; peticion: PeticionRegistro },
): Promise<ResultadoRegistro> {
  const codigo = await consumir(sql, peticion.inviteCode, peticion.email);
  if (!codigo) return { estado: 403, cuerpo: ALTA_RECHAZADA, cookies: [] };

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
    // El código se libera para no castigar a quien se equivoca (una contraseña corta no debe quemar
    // la invitación de nadie), y la respuesta se aplana al mismo 403 **sin leer el motivo de la
    // librería**: es ahí donde se escapaba el `USER_ALREADY_EXISTS` que delataba a los miembros.
    await liberar(sql, codigo);
    await respuesta.body?.cancel();
    return { estado: 403, cuerpo: ALTA_RECHAZADA, cookies: [] };
  }

  const creado = await respuesta.json() as Record<string, unknown> & { user?: { id?: string } };
  const userId = creado.user?.id;
  if (userId) {
    // `ligar` puede fallar: el anfitrión ha podido **revocar el código mientras esto hasheaba la
    // contraseña**. Si pierde esa carrera, la cuenta no debe existir — se borra, y el `on delete
    // cascade` del esquema se lleva su sesión y sus credenciales. Dejarla viva sería una cuenta
    // creada con una invitación cancelada, que es justo lo que revocar viene a impedir.
    if (!await ligar(sql, codigo, userId)) {
      await sql`delete from "user" where id = ${userId}`;
      return { estado: 403, cuerpo: ALTA_RECHAZADA, cookies: [] };
    }
    await darCupoInicial(sql, userId);
  }

  return {
    estado: 200,
    cuerpo: creado,
    cookies: respuesta.headers.getSetCookie(),
  };
}

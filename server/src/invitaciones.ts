import type { Sql } from "postgres";

/**
 * El círculo cerrado: invitaciones con cupo.
 *
 * Decisión del humano: **cualquiera invita, con un número limitado de invitaciones**. El cupo se
 * **descuenta al emitir** y se devuelve al revocar, no al consumirse la invitación — si se descontara
 * al consumir, cualquiera podría acuñar códigos sin límite y el cupo no limitaría nada.
 *
 * Autorización (spec §12.3): todas las funciones de este módulo reciben el `userId` **de la sesión**
 * y lo meten en el `WHERE`. No hay ninguna que acepte un usuario por parámetro desde fuera.
 */

/** Invitaciones con las que nace cada persona. */
export const CUPO_INICIAL = 3;

/** Bytes de aleatoriedad del código. 16 bytes en base64url ≈ 22 caracteres imposibles de adivinar. */
const BYTES_CODIGO = 16;

export interface Invitacion {
  code: string;
  createdAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  usedByUserId: string | null;
}

/** Código opaco y aleatorio. Nunca correlativo: un id adivinable es una invitación regalada (§12.4). */
export function generarCodigo(): string {
  const bytes = new Uint8Array(BYTES_CODIGO);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

/** Cuánto le queda por invitar a alguien. */
export async function cupoDe(sql: Sql, userId: string): Promise<number> {
  const filas = await sql<{ remaining: number }[]>`
    select remaining from user_invite_quota where user_id = ${userId}`;
  return filas[0]?.remaining ?? 0;
}

/** Le da su cupo inicial a un usuario recién creado. Idempotente. */
export async function darCupoInicial(sql: Sql, userId: string, cupo = CUPO_INICIAL): Promise<void> {
  await sql`
    insert into user_invite_quota (user_id, remaining) values (${userId}, ${cupo})
    on conflict (user_id) do nothing`;
}

/**
 * Emite una invitación descontando cupo.
 *
 * El descuento es un `UPDATE ... WHERE remaining > 0`, condicional y atómico: dos peticiones
 * simultáneas con un cupo de 1 no pueden pasar las dos, porque la segunda no encuentra fila que
 * cumpla la condición. Leer el cupo y luego restarlo daría dos invitaciones por el precio de una.
 */
export async function emitir(sql: Sql, userId: string): Promise<Invitacion | null> {
  return await sql.begin(async (tx) => {
    const descontado = await tx<{ remaining: number }[]>`
      update user_invite_quota set remaining = remaining - 1
      where user_id = ${userId} and remaining > 0
      returning remaining`;
    if (descontado.length === 0) return null;

    const filas = await tx<Invitacion[]>`
      insert into invitation (code, inviter_id) values (${generarCodigo()}, ${userId})
      returning code, created_at as "createdAt", used_at as "usedAt",
                revoked_at as "revokedAt", used_by_user_id as "usedByUserId"`;
    return filas[0] ?? null;
  }) as Invitacion | null;
}

/**
 * Revoca una invitación **propia** y sin usar, devolviendo el cupo.
 *
 * El `inviter_id = userId` del `WHERE` es la autorización: no hay una comprobación aparte que se
 * pueda olvidar. Y una invitación ya usada no se revoca — retirarle el acceso a alguien que ya entró
 * es otra operación distinta, y hoy no existe.
 */
export async function revocar(sql: Sql, userId: string, code: string): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const filas = await tx`
      update invitation set revoked_at = now()
      where code = ${code} and inviter_id = ${userId}
        and used_at is null and revoked_at is null
      returning code`;
    if (filas.length === 0) return false;
    await tx`update user_invite_quota set remaining = remaining + 1 where user_id = ${userId}`;
    return true;
  }) as boolean;
}

/** Las invitaciones de alguien. Sólo las suyas: el `WHERE` no admite otra cosa. */
export async function listar(sql: Sql, userId: string): Promise<Invitacion[]> {
  return await sql<Invitacion[]>`
    select code, created_at as "createdAt", used_at as "usedAt",
           revoked_at as "revokedAt", used_by_user_id as "usedByUserId"
    from invitation where inviter_id = ${userId} order by created_at desc`;
}

/**
 * Marca un código como consumido, **si estaba libre**.
 *
 * Este `UPDATE` condicional es el punto de exclusión mutua de todo el registro: dos altas simultáneas
 * con el mismo código sólo pueden ganar una, porque `used_at is null` deja de cumplirse en cuanto la
 * primera confirma. Comprobar primero y escribir después daría dos cuentas por el mismo código.
 *
 * Devuelve el código consumido, o `null` si no valía. Ligarlo a su usuario es un paso aparte
 * (`ligarInvitacion`) porque el `id` todavía no existe.
 */
export async function consumir(sql: Sql, code: string): Promise<string | null> {
  if (!code) return null;
  const filas = await sql<{ code: string }[]>`
    update invitation set used_at = now()
    where code = ${code} and used_at is null and revoked_at is null
    returning code`;
  return filas[0]?.code ?? null;
}

/** Deshace un `consumir` cuando el alta que venía detrás falló. */
export async function liberar(sql: Sql, code: string): Promise<void> {
  await sql`update invitation set used_at = null where code = ${code} and used_by_user_id is null`;
}

/** Cierra la invitación contra el usuario que acabó creándose. */
export async function ligar(sql: Sql, code: string, userId: string): Promise<void> {
  await sql`update invitation set used_by_user_id = ${userId} where code = ${code}`;
}

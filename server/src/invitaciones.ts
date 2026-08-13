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
  /** A quién va dirigida. `null` = al portador. */
  email: string | null;
  createdAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  usedByUserId: string | null;
  /**
   * De quién es esta invitación, **según el servidor**.
   *
   * No es información nueva —siempre eres tú, porque la identidad sale de tu cookie y sólo se listan
   * las tuyas— pero decirlo en voz alta permite al cliente comprobar que la respuesta corresponde a
   * quien él cree ser. La cookie es del navegador entero: si en otra pestaña sale una persona y entra
   * otra, la pantalla vieja seguía firmando como el anterior mientras la API atendía al nuevo, y el
   * código que aparecía bajo un nombre salía del cupo del otro (F4/A3 de `qa-adversario`). Preguntar
   * «¿quién soy?» por separado no lo arregla: entre la pregunta y la escritura hay una carrera que se
   * pierde. Que la propia respuesta diga de quién es la cierra sin carrera.
   */
  inviterId: string;
}

/**
 * Código opaco y aleatorio. Nunca correlativo: un id adivinable es una invitación regalada (§12.4).
 *
 * **No empieza nunca por `-`.** El alfabeto base64url lo incluye, y un guion inicial es una trampa de
 * usabilidad con consecuencias reales: se lo comen la selección al copiar, los clientes de correo que
 * lo interpretan como viñeta, y cualquier terminal que lo lea como una opción. Le pasó a la primera
 * invitación del producto —llegó con 21 caracteres en vez de 22— y el 403 deliberadamente
 * indistinguible del alta hizo que no hubiera forma de saber por qué no entraba: la protección
 * correcta frente a un desconocido deja a la persona invitada sin ninguna pista.
 *
 * Se reintenta en vez de mapear el primer carácter a otra cosa: mapearlo sesgaría la distribución del
 * primer byte, y aquí lo que se está gastando es entropía. La probabilidad de repetir es 1/64 por
 * intento, así que el bucle termina enseguida; el tope existe sólo para que no pueda ser infinito si
 * algún día alguien rompe el generador de aleatorios.
 *
 * Los códigos **ya emitidos siguen valiendo**: esto sólo cambia lo que se acuña a partir de ahora.
 */
export function generarCodigo(): string {
  for (let intento = 0; intento < 8; intento++) {
    const bytes = new Uint8Array(BYTES_CODIGO);
    crypto.getRandomValues(bytes);
    const codigo = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_")
      .replaceAll("=", "");
    if (!codigo.startsWith("-")) return codigo;
  }
  throw new Error("no se pudo generar un código utilizable");
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
export async function emitir(
  sql: Sql,
  userId: string,
  email?: string | null,
): Promise<Invitacion | null> {
  return await sql.begin(async (tx) => {
    const descontado = await tx<{ remaining: number }[]>`
      update user_invite_quota set remaining = remaining - 1
      where user_id = ${userId} and remaining > 0
      returning remaining`;
    if (descontado.length === 0) return null;

    const filas = await tx<Invitacion[]>`
      insert into invitation (code, inviter_id, email)
      values (${generarCodigo()}, ${userId}, ${email ?? null})
      returning code, email, created_at as "createdAt", used_at as "usedAt",
                revoked_at as "revokedAt", used_by_user_id as "usedByUserId",
                inviter_id as "inviterId"`;
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
    // La condición es **`used_by_user_id is null`**, no `used_at is null`, y esa diferencia es un
    // hallazgo del pase adversario. `used_at` se pone al RESERVAR el código, al principio de un alta
    // que todavía puede fallar (y que tarda ~285 ms hashando la contraseña). Con la condición
    // anterior, un tercero que lanzara altas condenadas a fallar mantenía el código «en vuelo» de
    // forma indefinida, y durante esa ventana la revocación **no encontraba fila**: devolvía el mismo
    // 404 que para un código inexistente —así que el anfitrión creía haberlo revocado—, no devolvía
    // el cupo, y la compensación `liberar()` dejaba el código vivo para usarlo después.
    //
    // Ahora manda la intención del anfitrión: se puede revocar todo lo que **aún no es de nadie**.
    // Un alta en vuelo que pierda esta carrera se cae en `ligar()`, que es donde debe caerse.
    const filas = await tx`
      update invitation set revoked_at = now()
      where code = ${code} and inviter_id = ${userId}
        and used_by_user_id is null and revoked_at is null
      returning code`;
    if (filas.length === 0) return false;
    await tx`update user_invite_quota set remaining = remaining + 1 where user_id = ${userId}`;
    return true;
  }) as boolean;
}

/** Las invitaciones de alguien. Sólo las suyas: el `WHERE` no admite otra cosa. */
export async function listar(sql: Sql, userId: string): Promise<Invitacion[]> {
  return await sql<Invitacion[]>`
    select code, email, created_at as "createdAt", used_at as "usedAt",
           revoked_at as "revokedAt", used_by_user_id as "usedByUserId",
           inviter_id as "inviterId"
    from invitation where inviter_id = ${userId} order by created_at desc`;
}

/**
 * Marca un código como consumido, **si estaba libre**.
 *
 * Este `UPDATE` condicional es el punto de exclusión mutua de todo el registro: dos altas simultáneas
 * con el mismo código sólo pueden ganar una, porque `used_at is null` deja de cumplirse en cuanto la
 * primera confirma. Comprobar primero y escribir después daría dos cuentas por el mismo código.
 *
 * **El email va DENTRO de este mismo `UPDATE`**, nunca en un `if` previo. Una invitación nominal sólo
 * la consume su destinatario, y comprobarlo antes con un `select` reabriría la carrera que el pase
 * adversario ya explotó una vez: entre mirar y escribir cabe otra petición. `email is null` significa
 * **al portador**, que es lo que eran todas las invitaciones antes de FTAI-D.1.
 *
 * La comparación ignora mayúsculas porque nadie recuerda cómo escribió su correo al registrarse.
 *
 * Devuelve el código consumido, o `null` si no valía — y **`null` no distingue** «código inexistente»
 * de «no es tu invitación». Es deliberado (§12.4): si se distinguieran, cualquiera con un código
 * podría preguntar quién está invitado, que es el oráculo de pertenencia que `seguridad` ya cerró una
 * vez en este mismo flujo. Ligarlo a su usuario es un paso aparte (`ligar`) porque el `id` no existe
 * todavía.
 */
export async function consumir(sql: Sql, code: unknown, email: string): Promise<string | null> {
  // `unknown` y no `string` a propósito: el cuerpo de una petición HTTP es JSON, y JSON trae
  // booleanos. El pase adversario mandó `inviteCode: true`, que es truthy —así que un `if (!code)`
  // lo dejaba pasar— y acababa en `where code = true`, o sea `text = boolean` en Postgres: operador
  // inexistente, excepción sin manejar y **500 opaco** donde tocaba un 403 de dominio. Tipar el
  // parámetro como `string` no protegía de nada: TypeScript no está en la frontera, esto sí.
  if (typeof code !== "string" || code === "") return null;
  const filas = await sql<{ code: string }[]>`
    update invitation set used_at = now()
    where code = ${code} and used_at is null and revoked_at is null
      and (email is null or lower(email) = lower(${email}))
    returning code`;
  return filas[0]?.code ?? null;
}

/** Deshace un `consumir` cuando el alta que venía detrás falló. */
export async function liberar(sql: Sql, code: string): Promise<void> {
  await sql`update invitation set used_at = null where code = ${code} and used_by_user_id is null`;
}

/**
 * Cierra la invitación contra el usuario que acabó creándose.
 *
 * **Condicionada a que no la hayan revocado mientras tanto**, y devuelve si lo consiguió. Es el otro
 * lado de la carrera que arregla `revocar`: si el anfitrión revocó el código mientras esta alta
 * hasheaba la contraseña, aquí no hay fila que cerrar y el alta debe deshacerse. Un `update`
 * incondicional daría una cuenta creada con una invitación ya cancelada.
 */
export async function ligar(sql: Sql, code: string, userId: string): Promise<boolean> {
  const filas = await sql`
    update invitation set used_by_user_id = ${userId}
    where code = ${code} and revoked_at is null
    returning code`;
  return filas.length > 0;
}

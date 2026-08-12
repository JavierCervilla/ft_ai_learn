import postgres from "postgres";
import { generarCodigo } from "@ftai/server-invitaciones";

/**
 * Acuña **la primera invitación**, la única que no emite un humano.
 *
 * El alta es sólo por invitación, así que sin esto no habría forma de entrar en una base recién
 * migrada. Las alternativas eran peores: dejar abierto el registro «sólo para el primero» (una puerta
 * que alguien olvida cerrar) o meter un usuario administrador por variable de entorno (un secreto que
 * vive para siempre y hay que rotar). Esto es un código de un solo uso que además caduca solo, porque
 * **se niega a correr si ya hay alguien**: una vez existe el círculo, la puerta de servicio no vuelve
 * a abrirse.
 *
 * Acepta un **email opcional**: con él la invitación es nominal y sólo la puede usar esa persona, que
 * es lo que permite entregar el código por un canal que quede escrito sin regalarle la primera cuenta
 * a quien lo lea antes. Sin email, sigue siendo al portador.
 *
 *   deno task invitar:bootstrap [email]
 */

const urlDb = Deno.env.get("DATABASE_URL");
if (!urlDb) {
  console.error("falta DATABASE_URL (sólo por entorno; nunca en el repo)");
  Deno.exit(2);
}

const sql = postgres(urlDb, { max: 1, onnotice: () => {} });

try {
  const filas = await sql<{ count: number }[]>`select count(*)::int as count from "user"`;
  const count = filas[0]?.count ?? 0;
  if (count > 0) {
    console.error(
      `ya hay ${count} usuario(s): el bootstrap no vuelve a abrirse.\n` +
        "Para invitar a alguien más, usa POST /api/invitations con tu sesión.",
    );
    Deno.exit(1);
  }

  const email = Deno.args[0]?.trim() || null;
  const codigo = generarCodigo();
  await sql`insert into invitation (code, inviter_id, email) values (${codigo}, null, ${email})`;
  if (email) console.error(`(invitación nominal: sólo la puede usar ${email})`);

  // Se imprime porque es la única vez que se puede ver, y porque quien lanza esta tarea es quien va
  // a usarlo. No es un secreto de larga vida: se gasta en el primer registro.
  console.log(codigo);
} finally {
  await sql.end();
}

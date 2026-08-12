import { assertEquals } from "@std/assert";
import { getTableColumns } from "drizzle-orm";
import { getAuthTables } from "better-auth/db";
import { account, session, user, verification } from "../schema.ts";

/**
 * **El esquema que declaramos es el que Better Auth espera.**
 *
 * Este test existe por una decisión concreta: las tablas de la librería las declaramos nosotros en
 * `schema.ts` y las migramos con `drizzle-kit`, para tener **un solo camino de migración** revisable
 * en el diff del PR. El precio de esa decisión es que una versión nueva de la librería puede añadir
 * un campo y nuestra migración no enterarse.
 *
 * Sin esta comprobación, esa divergencia se descubriría **en el primer registro real en producción**:
 * la migración aplica limpia, el servidor arranca, y el `signUp` falla. Es exactamente la forma del
 * fallo que tumbó el despliegue de FTAI-C —algo probado en dos sitios de tres— y se combate igual:
 * preguntándole a la fuente en vez de suponer.
 *
 * Se compara contra `getAuthTables()`, que es de dónde la propia librería saca lo que necesita. Si
 * esto se rompe al actualizar, la respuesta es **regenerar la migración**, nunca relajar el test.
 */

const NUESTRAS = { user, session, account, verification } as const;

/** Todas las tablas llevan `id`; `getAuthTables()` no lo lista porque lo da por hecho. */
const IMPLICITAS = ["id"];

Deno.test("el esquema declarado cubre todos los campos que exige Better Auth", () => {
  const exigidas = getAuthTables({ emailAndPassword: { enabled: true } } as never);

  for (const [modelo, tabla] of Object.entries(NUESTRAS)) {
    const definicion = exigidas[modelo] as { fields: Record<string, unknown> } | undefined;
    if (!definicion) throw new Error(`Better Auth ya no pide el modelo "${modelo}"`);

    const nuestros = new Set([...Object.keys(getTableColumns(tabla)), ...IMPLICITAS]);
    const faltan = Object.keys(definicion.fields).filter((campo) => !nuestros.has(campo));

    assertEquals(
      faltan,
      [],
      `a la tabla "${modelo}" le faltan campos que Better Auth exige: ${faltan.join(", ")}.\n` +
        "Añádelos a db/schema.ts y regenera la migración con `deno task db:generate`.",
    );
  }
});

Deno.test("no declaramos modelos de auth que la librería ya no use", () => {
  const exigidas = getAuthTables({ emailAndPassword: { enabled: true } } as never);
  const sobran = Object.keys(NUESTRAS).filter((modelo) => !(modelo in exigidas));
  assertEquals(sobran, [], `estas tablas ya no las pide Better Auth: ${sobran.join(", ")}`);
});

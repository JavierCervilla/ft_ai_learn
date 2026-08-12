import { boolean, date, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Esquema de la base de datos.
 *
 * Tablas normalizadas y no un blob JSON: así **el esquema sostiene reglas del contrato** en vez de
 * dejárselas todas al validador. Las columnas `NOT NULL` de `resource` son la regla 8; las de
 * `rubric_criterion`, la 7; la clave de `node_competency` contra un eje declarado, la 14.
 *
 * Formato y reglas: `contrato_grafo_aprendizaje.md` en el vault del framework.
 */

/** Metadatos de la aplicación. Línea base de migraciones; la mira el healthcheck. */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Rama del grafo. Trae el `target` del radar: el denominador DECLARADO (contrato §5.1). */
export const branch = pgTable("branch", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isSpecialization: boolean("is_specialization").notNull().default(false),
  axis: text("axis").notNull(),
  target: integer("target").notNull(),
});

/**
 * Un nodo del grafo.
 *
 * `id` es texto y lo pone el contenido, no la base: es la clave de la que colgará el progreso de cada
 * persona, así que **no se renombra nunca** (regla 4). Un nodo que deja de valer se marca
 * `deprecated` y se queda; borrarlo vaciaría el avance de quien lo hubiera completado.
 */
export const node = pgTable("node", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  /** `concept` | `project`. */
  type: text("type").notNull(),
  branchId: text("branch_id").notNull().references(() => branch.id),
  difficulty: integer("difficulty").notNull(),
  estMinutes: integer("est_minutes").notNull(),
  /** Qué haces en UNA sentada de quince minutos. Obligatorio (regla 11). */
  micro: text("micro").notNull(),
  extended: text("extended"),
  stub: boolean("stub").notNull().default(false),
  deprecated: boolean("deprecated").notNull().default(false),
});

/**
 * La arista `nodo → prerequisito`.
 *
 * **Se declara una sola vez y en esta dirección.** No hay tabla de "desbloquea": eso se deriva en el
 * núcleo. Dos tablas describiendo la misma arista divergen en cuanto alguien escribe en una.
 */
export const nodePrereq = pgTable("node_prereq", {
  nodeId: text("node_id").notNull().references(() => node.id),
  prereqId: text("prereq_id").notNull().references(() => node.id),
}, (t) => [primaryKey({ columns: [t.nodeId, t.prereqId] })]);

/** Fuente de un nodo. `why` es `NOT NULL` a propósito: un recurso sin razón es un enlace acumulado. */
export const resource = pgTable("resource", {
  nodeId: text("node_id").notNull().references(() => node.id),
  id: text("id").notNull(),
  url: text("url").notNull(),
  format: text("format").notNull(),
  lang: text("lang").notNull(),
  minutes: integer("minutes").notNull(),
  why: text("why").notNull(),
}, (t) => [primaryKey({ columns: [t.nodeId, t.id] })]);

/** Criterio de la rúbrica. `how_to_check` `NOT NULL`: si no se puede ejecutar, no es un criterio. */
export const rubricCriterion = pgTable("rubric_criterion", {
  nodeId: text("node_id").notNull().references(() => node.id),
  id: text("id").notNull(),
  criterion: text("criterion").notNull(),
  howToCheck: text("how_to_check").notNull(),
}, (t) => [primaryKey({ columns: [t.nodeId, t.id] })]);

/**
 * Cuaderno público del nodo (Gemini Notebook). Opcional 1:1.
 *
 * `checked_at` caduca a los 90 días (regla 13): un enlace a un tercero se pudre en silencio.
 */
export const notebook = pgTable("notebook", {
  nodeId: text("node_id").primaryKey().references(() => node.id),
  url: text("url").notNull(),
  /** Qué cuenta lo publica. **Cuál** es esa cuenta no se escribe en el repo. */
  account: text("account").notNull(),
  artifacts: text("artifacts").array().notNull(),
  checkedAt: date("checked_at").notNull(),
});

/**
 * Puntos que un nodo aporta a un eje del radar.
 *
 * Normalizado en vez de un JSON dentro de `node`: así **la clave foránea contra `branch.axis` hace
 * cumplir la regla 14** —todo eje puntuado tiene una rama que declara su `target`— y el radar deja de
 * poder dividir por cero por un descuido de contenido.
 */
export const nodeCompetency = pgTable("node_competency", {
  nodeId: text("node_id").notNull().references(() => node.id),
  axis: text("axis").notNull(),
  points: integer("points").notNull(),
}, (t) => [primaryKey({ columns: [t.nodeId, t.axis] })]);

// =================================================================================================
// Identidad (FTAI-D)
//
// Las cuatro tablas de abajo **las exige Better Auth**, pero se declaran AQUÍ y salen por
// `drizzle-kit generate` como cualquier otra. Es deliberado: el contenedor arranca `migrate` →
// `cargar` → servir, un solo camino de migración que se revisa en el diff del PR. Dejar que la
// librería llevara su propio migrador metería un estado en la base que nadie mira al revisar.
//
// El precio de esa decisión es que el esquema y lo que la librería espera pueden **divergir en
// silencio** al actualizarla. Por eso `server/tests/esquema_auth_test.ts` compara estas tablas
// contra `getAuthTables()` de la propia librería: si una versión nueva añade una columna, falla CI
// en vez de fallar el primer registro en producción.
//
// Las claves TS van en camelCase porque es como Better Auth nombra sus campos; las columnas van en
// snake_case como el resto del repo. Comprobado que el adaptador de Drizzle mapea entre las dos.
// =================================================================================================

/** Persona. El alta es sólo por invitación (spec §12); esta tabla no la crea nadie a mano. */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
    .defaultNow(),
});

/** Sesión activa. `token` viaja en cookie `HttpOnly`; nunca en `localStorage` (spec §12.2). */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
    .defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, {
    onDelete: "cascade",
  }),
});

/** Credenciales. `password` guarda el Argon2id con sus parámetros (ver `server/src/contrasenas.ts`). */
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, {
    onDelete: "cascade",
  }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
    .defaultNow(),
});

/** Tokens de verificación de Better Auth. Sin uso hoy (no hay email), pero la librería la exige. */
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
    .defaultNow(),
});

/**
 * El progreso de una persona en un nodo.
 *
 * **`available` no está y no va a estar**: es función de los prerequisitos y de lo completado, y se
 * deriva con `estadoDe()` del núcleo —la misma función que ejecuta el navegador—. Guardar un estado
 * derivable garantiza que algún día la fila y la regla discrepen, y que gane la fila (spec §5).
 *
 * Sólo se guarda lo que **no** se puede derivar: que alguien lo empezó o lo dio por hecho, y cuándo.
 */
export const userProgress = pgTable("user_progress", {
  userId: text("user_id").notNull().references(() => user.id, {
    onDelete: "cascade",
  }),
  nodeId: text("node_id").notNull().references(() => node.id),
  /** `in_progress` | `done`. Un nodo sin fila no está empezado. */
  state: text("state").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull()
    .defaultNow(),
  doneAt: timestamp("done_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.userId, t.nodeId] })]);

/**
 * Una invitación al círculo cerrado.
 *
 * El `code` es la clave: opaco y aleatorio, nunca correlativo (spec §12.4). Una invitación no se
 * borra —se **revoca**—, para que quede quién invitó a quién y no se pueda reciclar un código.
 *
 * `inviter_id` es **nullable a propósito**: la primera invitación de todas no la puede emitir nadie,
 * porque no hay nadie todavía. Una fila con `inviter_id` nulo es la del bootstrap
 * (`deno task invitar:bootstrap`), y es la única forma de entrar sin que te invite un humano. El
 * `where inviter_id = <sesión>` de las consultas nunca casa con `NULL`, así que esa invitación no
 * sale en la lista de nadie ni la puede revocar nadie.
 */
export const invitation = pgTable("invitation", {
  code: text("code").primaryKey(),
  inviterId: text("inviter_id").references(() => user.id, {
    onDelete: "cascade",
  }),
  usedByUserId: text("used_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/**
 * Cuánto puede invitar cada persona.
 *
 * El cupo se **descuenta al emitir** y se devuelve al revocar, no al consumirse la invitación: si se
 * descontara al consumir, cualquiera podría acuñar códigos sin límite y el cupo no limitaría nada.
 */
export const userInviteQuota = pgTable("user_invite_quota", {
  userId: text("user_id").primaryKey().references(() => user.id, {
    onDelete: "cascade",
  }),
  remaining: integer("remaining").notNull(),
});

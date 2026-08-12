import { boolean, date, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

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

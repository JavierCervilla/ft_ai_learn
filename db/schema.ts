import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * Esquema de la base de datos.
 *
 * En FTAI-B sólo existe la tabla de metadatos: es la línea base que prueba que el runner de
 * migraciones funciona de punta a punta. **Las tablas del dominio —nodos, ramas, prerequisitos,
 * progreso, evidencia— las añade FTAI-C** desde `contrato_grafo_aprendizaje.md`; sembrarlas aquí
 * sería adivinar el trabajo de la hija siguiente.
 */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

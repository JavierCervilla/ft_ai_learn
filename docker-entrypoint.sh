#!/bin/sh
# Arranque del contenedor: migrar y luego servir.
#
# Las migraciones corren ANTES del servidor y con `set -e`: si fallan, el contenedor muere en vez de
# levantar una instancia contra un esquema que no es el que el código espera. Un arranque que se
# traga el fallo de migración deja el healthcheck en `schema: missing` y a alguien buscando el motivo.
#
# `--node-modules-dir=none` porque `db/deno.json` pide `auto` para que `drizzle-kit` funcione en
# desarrollo; en producción sólo se ejecuta el runner, que resuelve por especificadores npm: y no
# necesita escribir un node_modules en el contenedor.
set -e

echo "[arranque] aplicando migraciones…"
deno run -A --node-modules-dir=none db/migrate.ts

echo "[arranque] sirviendo en :${PORT:-8000}"
exec deno run -A server/src/main.ts

# Imagen de despliegue: el bundle estático de la webapp servido por el backend Deno.
#
# Dos etapas porque son dos toolchains distintos y sólo una tiene que llegar a producción: Node
# construye el bundle y se queda fuera; la imagen final sólo lleva Deno y ficheros ya compilados.

FROM node:22-alpine AS webapp
WORKDIR /build
COPY webapp/package.json webapp/package-lock.json ./webapp/
RUN cd webapp && npm ci --no-audit --no-fund
COPY scripts ./scripts
COPY webapp ./webapp
RUN cd webapp && npm run build

FROM denoland/deno:alpine-2.9.5
WORKDIR /app

COPY deno.json deno.lock* ./
COPY core ./core
COPY server ./server
COPY db ./db
COPY tools ./tools
COPY content ./content
COPY --from=webapp /build/webapp/dist ./webapp/dist

# Precalentar la caché de módulos en build: si una dependencia no se puede resolver, es mejor
# enterarse aquí que en el primer arranque en producción.
RUN deno cache server/src/main.ts \
  && deno cache --node-modules-dir=none db/migrate.ts db/cargar.ts

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV STATIC_ROOT=/app/webapp/dist \
    PORT=8000
EXPOSE 8000

# Healthcheck propio: consulta el endpoint que mira la base, no el puerto. Un contenedor que escucha
# con la base caída no está sano.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD deno eval "const r = await fetch('http://localhost:8000/health'); Deno.exit(r.ok ? 0 : 1)"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

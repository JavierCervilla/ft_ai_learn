# ft_ai_learn — Holy Graph de IA

Un **mapa de competencias de IA recorrible en sentadas de quince minutos**, donde cada nodo se aprueba
con **evidencia en Git** y no marcándolo, desbloquea los siguientes, y trae **un cuaderno ya montado**
con sus fuentes para que estudiar empiece en un clic.

> **La SoT de producto no vive aquí.** Está en el vault del framework:
> `Contexto_Base_SRE/01_Espec_y_Contratos/spec_ft_ai_learn.md` (diseño, criterios V1..V10) y
> `contrato_grafo_aprendizaje.md` (formato del contenido y las 14 reglas duras del grafo).
> Nada se implementa aquí que no trace a esa spec.

## Estructura

```
core/      TypeScript puro, sin E/S: las reglas del grafo. Servidor y navegador son dos
           ADAPTADORES del mismo núcleo, para que el desbloqueo optimista del cliente y el
           autoritativo del servidor no puedan discrepar.
server/    Deno 2 + Oak. La API y el servidor de estáticos del bundle.
webapp/    Vite + React + TypeScript + Tailwind. PWA instalable.
db/        Esquema Drizzle + migraciones SQL versionadas + su runner.
content/   El grafo en YAML (lo siembra FTAI-C desde el contrato).
```

**Regla del bundle**: el cliente es un bundle estático que habla con la API por HTTPS; nada
renderizado en servidor en el camino crítico. Es lo que mantiene el empaquetado para tiendas
(Capacitor) a una tarea de distancia en vez de a una migración.

## Arrancar en local

```bash
docker compose up -d                 # Postgres en :5433
cp .env.example .env
deno task db:migrate                 # aplica las migraciones
deno task dev                        # API en :8000
cd webapp && npm install && npm run dev   # webapp en :5173, con proxy a la API
```

## Verificación

```bash
deno task check && deno task lint && deno task fmt && deno task test   # núcleo y servidor
cd webapp && npm run lint && npm run build && npm run test             # webapp y PWA
```

### Dónde está cada gate, y dónde NO

| Área | Qué la cubre |
|---|---|
| `webapp/` | Hook `anti-slop-gate.sh` en el commit **y** el job `webapp` de CI |
| `core/`, `server/`, `db/` | **Sólo el job `deno` de CI** |

Esto último no es un descuido y conviene saberlo antes de tocar el workflow: el hook anti-slop del
framework localiza el proyecto **subiendo hasta un `package.json`**, y un directorio Deno
(`deno.json`) no lo encuentra, así que lo deja pasar sin exigir nada. **Si el job `deno` se cae o se
vuelve opcional, `core/` y `server/` se quedan sin gate.**

## Decisiones de stack, con su evidencia

- **No Next.js.** Con `output: 'export'` —lo único que Capacitor puede empaquetar— no está soportado
  `cookies()`, que es el modelo de sesión de la casa. Detalle en la spec §6.4.
- **Drizzle sobre Deno, sí, con truco.** `drizzle-kit` necesita un `node_modules` real: con sólo
  especificadores `npm:` falla con *«Please install latest version of drizzle-orm»*. Se resuelve con
  `nodeModulesDir: "auto"` en `db/deno.json`, sin `package.json`. **Nunca `drizzle-kit push`**: el SQL
  se genera, se revisa en el PR y se aplica con el runner.
- **TypeScript 5.9 y ESLint 9, no las últimas.** `typescript-eslint` declara soporte de TS `<6.1.0`
  (fuera TS 7) y `eslint-plugin-import`, que el preset anti-slop necesita para `import/no-cycle`,
  tope en ESLint `^9`.
- **Better Auth funciona en Deno** (comprobado: carga y su handler responde 200). Lo cablea FTAI-D.

## Secretos

Sólo por entorno (`DATABASE_URL` y compañía). Nunca en el repo, nunca impresos. Ver `.env.example`.

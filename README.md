# ft_ai_learn — Holy Graph de IA

Un **mapa de competencias de IA recorrible en sentadas de quince minutos**, donde cada nodo se aprueba
con **evidencia en Git** y no marcándolo, desbloquea los siguientes, y trae **un cuaderno ya montado**
con sus fuentes para que estudiar empiece en un clic.

> **La SoT de producto no vive aquí.** Está en el vault del framework:
> `Contexto_Base_SRE/01_Espec_y_Contratos/spec_ft_ai_learn.md` (diseño) y
> `contrato_grafo_aprendizaje.md` (formato del contenido y las reglas duras del grafo).
> Nada se implementa en este repo que no trace a esa spec.

## Estado

**En construcción.** Esta es la semilla del repositorio: existe para que haya una rama por defecto
contra la que abrir pull requests. El esqueleto (núcleo, servidor, webapp, base de datos, CI y
despliegue) llega en la trayectoria **FTAI-B**.

## Stack

- **`core/`** — TypeScript puro, sin E/S: las reglas del grafo (DAG, desbloqueo, radar). Servidor y
  navegador son **dos adaptadores del mismo núcleo**, para que el desbloqueo optimista del cliente y
  el autoritativo del servidor no puedan discrepar.
- **`server/`** — Deno 2 + Oak sobre PostgreSQL con migraciones versionadas.
- **`webapp/`** — Vite + React + TypeScript + Tailwind, como PWA instalable.

**Regla del bundle**: el cliente es un bundle estático que habla con la API por HTTPS; nada
renderizado en servidor en el camino crítico. Es lo que mantiene el empaquetado para tiendas
(Capacitor) a una tarea de distancia en vez de a una migración.

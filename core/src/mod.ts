/**
 * El núcleo portable: reglas del grafo, sin E/S y sin dependencias.
 *
 * Servidor y navegador lo importan los dos. Es lo que hace que el desbloqueo optimista del cliente
 * (necesario para que la app responda sin red) y el autoritativo del servidor no puedan discrepar.
 *
 * Contiene los tipos del contenido, las reglas del grafo (validación, ciclos, alcanzabilidad y las
 * derivaciones de estado) y el radar. Lo único que NO vive aquí es la regla 9 del contrato —que las
 * URLs resuelvan—, porque es E/S: vive en `scripts/verificar-enlaces.ts`.
 */
export * from "./tipos.ts";
export * from "./radar.ts";
export * from "./grafo.ts";
export * from "./disposicion.ts";

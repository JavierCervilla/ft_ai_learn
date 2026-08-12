/**
 * El núcleo portable: reglas del grafo, sin E/S y sin dependencias.
 *
 * Servidor y navegador lo importan los dos. Es lo que hace que el desbloqueo optimista del cliente
 * (necesario para que la app responda sin red) y el autoritativo del servidor no puedan discrepar.
 *
 * En FTAI-B esto es el suelo: los tipos y el radar. Las reglas del DAG —validez, desbloqueo,
 * alcanzabilidad— las escribe FTAI-C, aquí y no en dos sitios.
 */
export * from "./tipos.ts";
export * from "./radar.ts";

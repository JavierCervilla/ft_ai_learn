/**
 * Control de admisión de `POST /api/registro`.
 *
 * Existe por un hallazgo del pase adversario que el rol `seguridad` confirmó y agravó: el alta
 * devuelve **el mismo 403 con el mismo cuerpo** a todos sus fallos —eso es deliberado, §12.4— pero
 * **tarda cosas distintas**, y el reloj desmentía la respuesta:
 *
 *   · código inválido .................  ~2 ms   (muere en `consumir`, antes de tocar nada caro)
 *   · correo YA MIEMBRO ..............   ~8 ms   (Better Auth ve el usuario y corta ANTES de hashear)
 *   · correo desconocido .............  ~320 ms  (hashea Argon2id y revienta después)
 *
 * Las poblaciones **no solapan** (max del rápido 24 ms, min del lento 300 ms): no es un sesgo que
 * haya que promediar, es un clasificador determinista **de una sola petición**. Cualquiera con una
 * invitación podía recorrer una lista de correos y saber quién está dentro — la pregunta que §12.4
 * prohíbe responder, en un producto cuya premisa de privacidad **es** el círculo cerrado. Y con una
 * invitación **nominal** ajena el mismo canal revela además **a quién iba dirigida**.
 *
 * La causa es incómoda: **la defensa crea el canal.** Argon2id cuesta ~300 ms a propósito, y el
 * camino que no llega a hashear se delata solo. Por eso no se arregla «pagando siempre el hash»: el
 * camino que sí hashea lo pagaría dos veces y volvería a separarse. El coste no se compensa sumando,
 * se compensa **fijando el techo**.
 *
 * Tres piezas, y las tres hacen falta:
 *
 * 1. **Piso** (`conPiso`) — ninguna respuesta de la ruta sale antes de `PISO_MS`.
 * 2. **Techo** (`Semaforo`) — un tope duro de altas en vuelo, **con descarte y no con cola**, porque
 *    encolar mete la espera dentro de la respuesta y vuelve a desbordar el piso.
 * 3. **Límite por IP** (`LimitePorIp`) — el `rateLimit` de Better Auth es middleware de su handler y
 *    `/api/registro` es ruta nuestra que llama a la librería por dentro: medido, 40 altas seguidas sin
 *    un solo 429. Era el único endpoint de la app sin límite.
 *
 * El piso **sin** el techo no sostiene: `seguridad` midió que con 8 sondas concurrentes el camino
 * lento se va a 1199 ms —Argon2id es JS síncrono y bloquea el isolate— así que un piso fijo de 800 ms
 * se desborda **cuando el atacante quiere**, y el canal se reabre con el criterio «¿pasó de 800?».
 */

/**
 * Piso temporal, en milisegundos.
 *
 * Regla para fijarlo: `PISO_MS ≥ 1.5 × p99` del camino con hasheo a la concurrencia esperada. Medido
 * en staging, p99 ≈ 550 ms → 800 ms. **No se pone justo**: un piso apretado es un piso que se
 * desborda, y desbordarlo *es* el fallo. Es una constante y no una variable de entorno a propósito —
 * una protección que depende del ambiente es una protección que desaparece sin cambiar una línea.
 */
export const PISO_MS = 800;

/** Altas en vuelo a la vez. Cada una cuesta 19 MiB y ~300 ms de CPU **bloqueante**. */
export const ALTAS_EN_VUELO = 2;

/** Ventana del límite por IP, en segundos. */
export const VENTANA_S = 60;

/**
 * Altas por IP y ventana. **Configurable por entorno**, con un valor por defecto estricto.
 *
 * Se puede aflojar porque el propio trinquete que verifica todo esto emite 54 sondas desde una sola
 * IP y si no se bloquearía a sí mismo. Un gate que sólo puede correr desactivando la defensa que
 * valida es un gate que alguien borra al mes; uno que la afloja **de forma visible en el workflow**
 * se lee y se entiende.
 */
export const MAX_POR_IP = Number(Deno.env.get("REGISTRO_MAX_POR_IP") ?? 10);

/**
 * Cuántas respuestas han **superado** el piso.
 *
 * Es el canario de que la propiedad se sostiene: si esto sube en producción, el piso no está
 * sujetando —o el techo no está apretando— y hay que revisarlo. Sin contador, «las respuestas salen
 * todas a la vez» es una creencia y no un hecho. Se expone en `/health`; nunca lleva correo ni código.
 */
let desbordes = 0;

export function desbordesDelPiso(): number {
  return desbordes;
}

/** Sólo para los tests: devuelve el contador a cero. */
export function olvidarDesbordes(): void {
  desbordes = 0;
}

/**
 * Corre `fn` y **no deja que su respuesta salga antes de `ms`**.
 *
 * Va en `finally` y envolviendo la ruta entera, no repartido por sus `return`. Tres esperas sembradas
 * en los puntos de salida se olvidan al cuarto `return` que alguien añada — y además no cubrirían el
 * 500: si el manejador lanza, el servidor respondería rápido y aparecería un camino veloz nuevo. Así
 * la propiedad es una invariante de la ruta y no una lista de sitios que hay que recordar.
 *
 * Reloj **monótono** (`performance.now`), nunca `Date.now`: un ajuste de hora del sistema no puede
 * convertir el piso en un salto ni en una espera eterna.
 */
export async function conPiso<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    const resto = ms - (performance.now() - t0);
    if (resto > 0) {
      await new Promise((listo) => setTimeout(listo, resto));
    } else {
      desbordes++;
    }
  }
}

/**
 * Tope de trabajo en vuelo, **con descarte**.
 *
 * `intentar()` no espera: o hay hueco o no lo hay. Encolar sería peor que no tener techo, porque la
 * espera de la cola se suma a la respuesta y desborda el piso, que es justo lo que el techo viene a
 * impedir. Con descarte, bajo ataque la ruta converge a «todo contesta igual y a la misma hora»:
 * uniforme **por construcción**, y de paso el DoS se apaga solo.
 */
export class Semaforo {
  #libres: number;

  constructor(plazas: number) {
    this.#libres = plazas;
  }

  intentar(): boolean {
    if (this.#libres <= 0) return false;
    this.#libres--;
    return true;
  }

  soltar(): void {
    this.#libres++;
  }
}

/**
 * Contador de peticiones por IP en ventanas fijas.
 *
 * **Por IP y nunca por correo ni por código.** Limitar por correo convertiría el propio 429 en el
 * oráculo que todo este fichero viene a cerrar: «este correo está limitado, luego alguien lo está
 * sondeando». La clave del cubo no puede ser el dato que se protege.
 */
export class LimitePorIp {
  #cubos = new Map<string, { desde: number; cuenta: number }>();

  constructor(private max: number, private ventanaMs: number) {}

  admite(ip: string, ahora = performance.now()): boolean {
    const cubo = this.#cubos.get(ip);
    if (!cubo || ahora - cubo.desde >= this.ventanaMs) {
      this.#cubos.set(ip, { desde: ahora, cuenta: 1 });
      this.#purgar(ahora);
      return true;
    }
    cubo.cuenta++;
    return cubo.cuenta <= this.max;
  }

  /** Sin esto el mapa crece con cada IP que pase por aquí: una fuga lenta pero segura. */
  #purgar(ahora: number): void {
    for (const [ip, cubo] of this.#cubos) {
      if (ahora - cubo.desde >= this.ventanaMs * 2) this.#cubos.delete(ip);
    }
  }
}

/**
 * De qué IP viene la petición.
 *
 * Detrás de Traefik el socket siempre trae la IP del proxy, así que sin mirar `X-Forwarded-For` el
 * límite tendría **un solo cubo para todo el mundo** y el primer atacante dejaría fuera a todos los
 * demás. Mirarla significa que alguien puede falsificarla y saltarse el límite; se acepta **porque el
 * límite no es la defensa que sostiene la propiedad** —esa es el techo, que no depende de la IP— sino
 * una segunda capa contra el volumen de enumeración.
 */
export function ipDe(cabeceras: Headers, delSocket: string): string {
  const reenviada = cabeceras.get("x-forwarded-for")?.split(",")[0]?.trim();
  return reenviada || delSocket;
}

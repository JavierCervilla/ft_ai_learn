import { argon2id } from "@noble/hashes/argon2.js";
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Derivación de contraseñas: **Argon2id con parámetros de coste explícitos** (spec §12.1).
 *
 * Better Auth trae scrypt por defecto, que también es lento, salado y memory-hard. Se sustituye
 * igualmente porque la spec nombra Argon2id o bcrypt, y porque el coste de cambiarlo es este fichero:
 * `@noble/hashes` **ya está en el árbol** como dependencia transitiva de la propia librería (viene con
 * `@noble/ciphers`), así que adoptar Argon2id no añade superficie de suministro nueva.
 *
 * Los parámetros van **dentro del hash**, no sólo en esta constante. Es lo que permite subirlos algún
 * día sin invalidar las contraseñas ya guardadas: cada hash sabe con qué coste se generó, y se
 * verifica con el suyo.
 */

/** Recomendación OWASP 2024 para Argon2id: 19 MiB de memoria, 2 pasadas, 1 hilo. */
export const COSTE = { m: 19 * 1024, t: 2, p: 1, dkLen: 32 } as const;

const SAL_BYTES = 16;
const ETIQUETA = "argon2id";

/** Deriva un hash nuevo con sal aleatoria. El formato es `argon2id$m=..,t=..,p=..$sal$hash`. */
export function hash(clave: string): Promise<string> {
  const sal = randomBytes(SAL_BYTES);
  const derivado = argon2id(new TextEncoder().encode(clave), sal, COSTE);
  const params = `m=${COSTE.m},t=${COSTE.t},p=${COSTE.p}`;
  return Promise.resolve(
    [
      ETIQUETA,
      params,
      Buffer.from(sal).toString("base64"),
      Buffer.from(derivado).toString("base64"),
    ]
      .join("$"),
  );
}

/**
 * Comprueba una contraseña contra un hash guardado.
 *
 * Devuelve `false` ante cualquier hash que no entienda en vez de lanzar: un registro corrupto en la
 * base tiene que ser un login fallido, no una excepción que tumbe la petición y distinga esa cuenta
 * de las demás por el tipo de error.
 */
export function verify({ hash: guardado, password }: { hash: string; password: string }): Promise<
  boolean
> {
  const partes = guardado.split("$");
  if (partes.length !== 4) return Promise.resolve(false);
  const [etiqueta, params, salB64, hashB64] = partes as [string, string, string, string];
  if (etiqueta !== ETIQUETA) return Promise.resolve(false);

  const m = Number(/m=(\d+)/.exec(params)?.[1]);
  const t = Number(/t=(\d+)/.exec(params)?.[1]);
  const p = Number(/p=(\d+)/.exec(params)?.[1]);
  if (!(m > 0) || !(t > 0) || !(p > 0)) return Promise.resolve(false);

  const esperado = Buffer.from(hashB64, "base64");
  if (esperado.length === 0) return Promise.resolve(false);

  const calculado = Buffer.from(
    argon2id(new TextEncoder().encode(password), Buffer.from(salB64, "base64"), {
      m,
      t,
      p,
      dkLen: esperado.length,
    }),
  );
  // Comparación en tiempo constante: comparar con `===` filtra por cuánto tarda en diferir.
  return Promise.resolve(
    esperado.length === calculado.length && timingSafeEqual(esperado, calculado),
  );
}

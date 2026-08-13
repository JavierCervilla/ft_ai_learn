/**
 * Recorrido adversario · A5 (canal lateral) · FTAI-D.2 → arreglado en FTAI-D.3
 *
 * PROMESA ATACADA (§12.4): «todos los desenlaces fallidos del alta son indistinguibles».
 *
 * HALLAZGO ORIGINAL: lo eran **por lo que se ve** —mismo 403, mismos 40 bytes, mismas cabeceras— y no
 * por lo que se tarda. `registro.ts` tenía tres caminos con costes de otro orden de magnitud:
 *
 *   · código inválido ........  ~2 ms   muere en `consumir`, antes de tocar nada caro
 *   · correo YA MIEMBRO ......  ~8 ms   Better Auth ve el usuario y corta ANTES de hashear
 *   · correo DESCONOCIDO ..... ~320 ms  hashea Argon2id y revienta después, en el INSERT
 *
 * Las poblaciones **no solapaban** (max del rápido 24 ms, min del lento 300 ms): no es un sesgo que
 * haya que promediar sino un clasificador determinista **de una sola petición**. Y las sondas eran
 * ilimitadas, porque un alta fallida libera el código.
 *
 * UMBRAL: lo fija el rol `seguridad`, no este fichero. Rechazó el `RATIO_MAXIMO=3` que traía el pase
 * adversario por dos motivos que conviene no volver a discutir:
 *
 *   1. **Laxo donde importa.** Con el piso en 800 ms, un ratio de 3 admite 1600 ms de diferencia. La
 *      señal que estamos matando son 300 ms: el test pasaría con el fallo intacto.
 *   2. **Forma equivocada de medida.** Un cociente entre magnitudes de milisegundos es ruido: 2,2 vs
 *      7,5 ms ya da 3,4× por una diferencia de 5 ms que a través de internet es irresoluble. El
 *      criterio principal tiene que ser un **tamaño de efecto absoluto**, no una significancia — un
 *      test estadístico declara «significativos» 3 ms consistentes, y eso es una fábrica de rojos
 *      intermitentes, que acaban en `continue-on-error`.
 *
 * Criterio aceptado: **d ≤ 50 ms** entre la mediana mayor y la menor de las TRES poblaciones, y como
 * red secundaria **r ≤ 1,5** con guarda de 10 ms —que cubre el caso de «igualar hacia abajo» (8 vs
 * 30 ms pasaría por `d` y no por `r`) sin que el cociente muerda cuando las medianas son diminutas—.
 * 50 ms deja entre 2× y 10× de margen sobre el ruido de un runner compartido y sigue estando 6× por
 * debajo de la señal a matar.
 *
 * TRES poblaciones y no dos: la versión anterior sólo comparaba miembro↔desconocido, y **habría dado
 * verde con el oráculo del destinatario de una invitación nominal abierto** (que es la separación
 * A↔B/C). El arreglo aplana las tres y el gate tiene que verlas.
 *
 * ENTORNO (nunca contra producción):
 *   COOKIE_HOST  — cookie de sesión de un anfitrión con cupo (para acuñar la invitación de la sonda).
 *   SONDAS       — repeticiones por población (por defecto 15).
 *   REGISTRO_MAX_POR_IP — **en el servidor**: este recorrido emite ~54 altas desde una sola IP y el
 *                  límite por defecto (10/min) lo bloquearía. El paso de CI lo afloja de forma
 *                  explícita y visible. Un gate que sólo puede correr desactivando en silencio la
 *                  defensa que valida es un gate que alguien borra al mes.
 *
 *   COOKIE_HOST='better-auth.session_token=…' BASE_URL_TEST=http://localhost:8010 \
 *     deno test -A tests/e2e/journeys/adversarial/a5-oraculo-de-pertenencia-por-tiempo.spec.ts
 */
import { assert } from "jsr:@std/assert";

const BASE = Deno.env.get("BASE_URL_TEST") ?? "http://localhost:8000";
const COOKIE_HOST = Deno.env.get("COOKIE_HOST") ?? "";
const SONDAS = Number(Deno.env.get("SONDAS") ?? 15);
const CALENTAMIENTO = 3;
const H = { "content-type": "application/json", origin: BASE };
const CLAVE = "contrasena-larga-de-prueba";

/** NUL en el nombre: pasa la validación y revienta en el INSERT, o sea SIEMPRE tras el hasheo. */
const NOMBRE_CONDENADO = `a${String.fromCharCode(0)}b`;

/** Diferencia máxima entre medianas, en ms. Criterio **principal**: tamaño de efecto, no significancia. */
const DIFERENCIA_MAXIMA_MS = 50;
/** Red secundaria contra «igualar hacia abajo», con su guarda para que el cociente no muerda en el ruido. */
const RATIO_MAXIMO = 1.5;
const GUARDA_RATIO_MS = 10;

function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function sondar(
  email: string,
  code: string,
): Promise<{ estado: number; ms: number; cuerpo: string }> {
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/registro`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, password: CLAVE, name: NOMBRE_CONDENADO, inviteCode: code }),
  });
  const cuerpo = await r.text();
  return { estado: r.status, ms: performance.now() - t0, cuerpo };
}

Deno.test("A5 · el tiempo de respuesta del alta no debe delatar quién está en el círculo", async () => {
  assert(COOKIE_HOST, "falta COOKIE_HOST (cookie de sesión de un anfitrión con cupo)");

  const sello = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const nueva = async () => {
    const r = await fetch(`${BASE}/api/invitations`, {
      method: "POST",
      headers: { ...H, cookie: COOKIE_HOST },
      body: "{}",
    });
    assert(r.ok, `el anfitrión no pudo emitir (${r.status})`);
    return (await r.json() as { code: string }).code;
  };

  // Un miembro de verdad por el que preguntar, y una invitación con la que preguntar.
  const miembro = `miembro-${sello}@ejemplo.test`;
  const alta = await fetch(`${BASE}/api/registro`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      email: miembro,
      password: CLAVE,
      name: "Miembro",
      inviteCode: await nueva(),
    }),
  });
  assert(alta.ok, `no se pudo crear el miembro objetivo (${alta.status})`);

  const codigoSonda = await nueva();

  /**
   * Las tres poblaciones. Las tres con el nombre condenado, así que **por lo que se ve** son la misma
   * respuesta: si alguna dejara de serlo, el hallazgo sería otro y este recorrido no lo mide.
   */
  const poblaciones = [
    {
      nombre: "código inválido",
      sondar: (i: number) =>
        sondar(`quienquiera-${sello}-${i}@ejemplo.test`, "codigo-que-no-existe-jamas"),
    },
    { nombre: "correo YA MIEMBRO", sondar: (_i: number) => sondar(miembro, codigoSonda) },
    {
      nombre: "correo DESCONOCIDO",
      sondar: (i: number) => sondar(`desconocido-${sello}-${i}@ejemplo.test`, codigoSonda),
    },
  ];

  const muestras: number[][] = poblaciones.map(() => []);
  const cuerpos = new Set<string>();
  const estados = new Set<number>();

  // **En rotación**, no en bloques: cualquier deriva de la máquina (otro job, un GC, el planificador)
  // afecta por igual a las tres poblaciones. Medir A entera y luego C entera regala la deriva a una.
  for (let i = 0; i < CALENTAMIENTO + SONDAS; i++) {
    for (const [p, poblacion] of poblaciones.entries()) {
      const r = await poblacion.sondar(i);
      // El calentamiento se descarta: la primera invocación de Argon2 paga compilación JIT y la
      // primera petición paga la conexión. Medirlas sería medir el arranque, no el canal.
      if (i >= CALENTAMIENTO) muestras[p]!.push(r.ms);
      cuerpos.add(r.cuerpo);
      estados.add(r.estado);
    }
  }

  // Premisa del ataque: por lo que se VE, las tres son la misma respuesta. Si esto falla, el hallazgo
  // sería otro (el oráculo estaría en el texto, que es lo que `qa` ya comprobó que no).
  assert(
    cuerpos.size === 1 && estados.size === 1,
    `la sonda dejó de ser ciega: estados=${[...estados]} cuerpos=${[...cuerpos]}`,
  );

  const medianas = muestras.map(mediana);
  const alta_ = Math.max(...medianas);
  const baja = Math.min(...medianas);
  const diferencia = alta_ - baja;
  const ratio = alta_ / Math.max(1, baja);

  // Si algún día parpadea, hay que poder decidir si fue ruido o señal **sin volver a montar nada**.
  const detalle = poblaciones
    .map((p, i) =>
      `  ${p.nombre}: mediana ${medianas[i]!.toFixed(1)} ms · ${
        muestras[i]!.map((m) => m.toFixed(0)).join(",")
      }`
    )
    .join("\n");

  assert(
    diferencia <= DIFERENCIA_MAXIMA_MS,
    `oráculo de pertenencia por TIEMPO: las medianas se separan ${diferencia.toFixed(1)} ms ` +
      `(máximo ${DIFERENCIA_MAXIMA_MS}) con el MISMO estado y el MISMO cuerpo en las tres poblaciones. ` +
      `Cualquiera con una invitación puede preguntar si un correo está en el círculo, que es justo lo ` +
      `que §12.4 cierra.\n${detalle}`,
  );

  assert(
    ratio <= RATIO_MAXIMO || diferencia <= GUARDA_RATIO_MS,
    `las medianas difieren ${ratio.toFixed(2)}× (máximo ${RATIO_MAXIMO}) con ${
      diferencia.toFixed(1)
    } ms ` +
      `de separación: alguien ha «igualado hacia abajo» y el canal sigue abierto en magnitudes ` +
      `pequeñas.\n${detalle}`,
  );
});

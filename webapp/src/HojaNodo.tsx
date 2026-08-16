import { useState } from "react";
import { type EstadoNodo, faltanPara, type Grafo, type Nodo } from "../../core/src/mod.ts";

/**
 * La hoja del nodo: lo que sale al tocar una estrella.
 *
 * **Hoja inferior y no pantalla completa**, porque el mapa es el mundo y sustituirlo por un documento
 * pierde el sitio. Con la hoja abajo, la estrella que tocaste sigue viéndose arriba y la cámara la
 * aparta de detrás del panel — movimiento de UI de juego, no de sitio web. En 390 px un panel lateral
 * sería una pantalla completa con peor nombre, y una pantalla completa obliga a un «volver» que
 * convierte recorrer el mapa en navegar.
 *
 * **No es modal**: el mapa de detrás sigue vivo y tocar otra estrella cambia el contenido de la hoja.
 * Recorrer el mapa con la hoja abierta es el gesto natural; hacerla modal lo prohibiría por nada.
 *
 * **Las dos alturas se cambian tocando la cabecera, no arrastrando.** Un arrastre vertical aquí sería
 * un tercer gesto conviviendo con el desplazamiento y el pellizco del mapa que hay literalmente debajo,
 * y las dos últimas roturas de este proyecto fueron exactamente de gestos táctiles pisándose. Se
 * conserva lo que la altura baja compra —ver el mapa mientras lees— sin comprar el conflicto.
 */

/** Cuánto de la pantalla ocupa la hoja en cada altura. Lo lee también el mapa, para reencuadrar. */
export const ALTURA_HOJA = { baja: 0.45, alta: 0.92 } as const;

const NOMBRE_TIPO: Record<Nodo["type"], string> = { concept: "concepto", project: "proyecto" };

export function HojaNodo({
  grafo,
  nodo,
  estado,
  completados,
  alta,
  alAbrirOtro,
  alCerrar,
  alCambiarAltura,
}: {
  grafo: Grafo;
  nodo: Nodo;
  estado: EstadoNodo;
  completados: ReadonlySet<string>;
  /**
   * En qué altura está. **Vive en `Dentro` y no aquí** por dos motivos que resultaron ser el mismo:
   * al cambiar de nodo hay que volver a la baja, y hacerlo remontando la hoja con `key` destruía la
   * región `aria-live` —una región que nace con su contenido dentro **no anuncia nada**, así que el
   * atributo estaba puesto y el efecto que lo justifica no ocurría nunca. Lo midió `qa-adversario`.
   * Con la altura arriba, la hoja no se remonta, la región vive y el reseteo pasa a ser lo que
   * siempre debió ser: una línea en el manejador que abre el nodo.
   */
  alta: boolean;
  alAbrirOtro: (id: string) => void;
  alCerrar: () => void;
  alCambiarAltura: (alta: boolean) => void;
}) {
  const faltan = faltanPara(grafo, nodo.id, completados);
  const bloqueado = estado === "locked";

  return (
    <section
      className={`fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-2xl border-t border-[var(--color-borde)] bg-[var(--color-panel)] ${
        alta ? "h-[92%]" : "h-[45%]"
      }`}
      aria-label={`Nodo: ${nodo.title}`}
    >
      {/*
        La cabecera es el mando de la altura. Es un botón de verdad —no un `div` con `onClick`— para
        que llegue por teclado y lo anuncie el lector de pantalla; `aria-expanded` dice en cuál está.
      */}
      <button
        type="button"
        onClick={() => alCambiarAltura(!alta)}
        aria-expanded={alta}
        className="flex w-full items-center justify-center px-6 pt-3 pb-1"
      >
        <span className="h-1 w-10 rounded-full bg-[var(--color-borde)]" />
        <span className="sr-only">{alta ? "Encoger la hoja" : "Ampliar la hoja"}</span>
      </button>

      <div className="flex items-start justify-between gap-3 px-6 pt-1">
        {/*
          `aria-live` porque con la hoja abierta se cambia de nodo tocando otra estrella: sin esto, quien
          usa lector de pantalla no se entera de que el contenido entero cambió bajo sus manos.
        */}
        <div aria-live="polite">
          <h2 className="font-[family-name:var(--font-display)] text-2xl leading-tight">
            {nodo.title}
          </h2>
          <p className="mt-1 text-xs text-[var(--color-tenue)]">
            {NOMBRE_TIPO[nodo.type]} · {nodo.estMinutes} min
          </p>
        </div>
        <button
          type="button"
          onClick={alCerrar}
          className="-mr-2 min-h-11 min-w-11 text-2xl leading-none text-[var(--color-tenue)]"
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>

      <div key={nodo.id} className="flex-1 overflow-y-auto px-6 pt-4 pb-8">
        {bloqueado
          ? (
            /*
              Un bloqueado **explica**, y sus prerequisitos son navegables. Un `locked` que no responde
              al toque es el bug de usabilidad más común de un árbol de habilidades, y aquí encima sería
              mentira: el núcleo sabe qué falta. Se enseña sólo el paso directo — la cadena entera es
              ruido, y quien quiera tirar del hilo toca el prerequisito y ve los suyos.
            */
            <div className="flex flex-col gap-3">
              <p className="text-sm text-[var(--color-tenue)]">
                Para empezar esto te falta:
              </p>
              <ul className="flex flex-col gap-2">
                {faltan.map((pre) => (
                  <li key={pre.id}>
                    <button
                      type="button"
                      onClick={() => alAbrirOtro(pre.id)}
                      className="min-h-11 text-left text-[var(--color-acento)] underline underline-offset-4"
                    >
                      {pre.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )
          : (
            <>
              {/*
                `micro` va PRIMERO, antes que el resumen. La sentada de quince minutos es la unidad del
                producto; el resumen es la promesa, y la promesa la lee quien tiene tiempo. El orden
                obvio sería el contrario y por eso está escrito aquí.
              */}
              <p className="text-base leading-relaxed">{nodo.micro}</p>
              <p className="mt-4 text-sm leading-relaxed text-[var(--color-tenue)]">
                Al terminar: {nodo.summary}
              </p>
            </>
          )}

        {/* Lo consultable vive en la altura alta: se pide, no se impone. */}
        {alta && (
          <div className="mt-8 flex flex-col gap-8">
            {nodo.resources.length > 0 && (
              <section className="flex flex-col gap-3">
                <h3 className="text-sm tracking-wide text-[var(--color-tenue)] uppercase">
                  Con qué
                </h3>
                {nodo.resources.map((r) => (
                  <article key={r.id} className="flex flex-col gap-1">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-h-11 text-[var(--color-acento)] underline underline-offset-4"
                    >
                      {r.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                    {/*
                      El `why` va VISIBLE, no en un tooltip. Es obligatorio en el contrato precisamente
                      para que se lea: esconderlo anula la regla que lo exige.
                    */}
                    <p className="text-sm leading-relaxed text-[var(--color-tenue)]">{r.why}</p>
                    <p className="text-xs text-[var(--color-tenue)]">
                      {r.format} · {r.lang} · {r.minutes} min
                    </p>
                  </article>
                ))}
              </section>
            )}

            {/* La rúbrica es de los proyectos. En un concepto no hay hueco: sencillamente no está. */}
            {nodo.type === "project" && nodo.rubric && nodo.rubric.length > 0 && (
              <section className="flex flex-col gap-3">
                <h3 className="text-sm tracking-wide text-[var(--color-tenue)] uppercase">
                  Cuándo está hecho
                </h3>
                {nodo.rubric.map((c) => (
                  <article key={c.id} className="flex flex-col gap-1">
                    <p className="text-sm leading-relaxed">{c.criterion}</p>
                    <p className="text-xs leading-relaxed text-[var(--color-tenue)]">
                      Cómo comprobarlo: {c.howToCheck}
                    </p>
                  </article>
                ))}
              </section>
            )}

            <Cuaderno nodo={nodo} />
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Los dos caminos del cuaderno, con su **degradación obligatoria** (spec §7.2, criterio V8).
 *
 * El cuaderno es de un tercero: puede revocarse, cambiar o rebautizarse. Cuando no está, **no hay hueco
 * vacío ni botón deshabilitado** — «Abrir el cuaderno» sencillamente no existe. El segundo camino sigue
 * estando siempre, porque las fuentes son dato nuestro. Ningún camino de la interfaz puede exigir el
 * cuaderno para avanzar.
 *
 * **Dicho en voz alta**: hoy *ningún* nodo de Fase 0 trae `notebook`, así que el único camino que se
 * puede ejercitar con datos reales es el degradado. V8 se prueba solo; el otro no se puede verificar
 * hasta que el contenido traiga un cuaderno.
 */
function Cuaderno({ nodo }: { nodo: Nodo }) {
  const [copia, setCopia] = useState<"quieto" | "hecho" | "fallo">("quieto");
  const fuentes = nodo.resources.map((r) => r.url).join("\n");

  /**
   * Si el portapapeles no está, **se dice y se enseñan las fuentes**.
   *
   * Antes el `catch` hacía `setCopiado(false)` — devolver el botón al estado en el que ya estaba, o
   * sea **no cambiar ni un carácter de la pantalla** mientras el párrafo seguía diciendo «con las
   * fuentes en el portapapeles… pégalas». `qa-adversario` lo reprodujo y midió que el escenario es
   * real: sobre un origen sin TLS `navigator.clipboard` ni existe. Y como en Fase 0 **ningún nodo tiene
   * cuaderno**, éste no es el camino de repuesto: es *el* camino, así que fallar en silencio tumba
   * entero el «un nodo sin cuaderno sigue siendo plenamente usable».
   */
  const copiarFuentes = async () => {
    try {
      await navigator.clipboard.writeText(fuentes);
      setCopia("hecho");
    } catch {
      setCopia("fallo");
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm tracking-wide text-[var(--color-tenue)] uppercase">El cuaderno</h3>
      {nodo.notebook && (
        <a
          href={nodo.notebook.url}
          target="_blank"
          rel="noreferrer"
          className="min-h-11 text-[var(--color-acento)] underline underline-offset-4"
        >
          Abrir el cuaderno del nodo
        </a>
      )}
      <button
        type="button"
        onClick={copiarFuentes}
        disabled={nodo.resources.length === 0}
        className="min-h-11 self-start rounded-md border border-[var(--color-borde)] px-4 text-sm"
      >
        {copia === "hecho" ? "Fuentes copiadas" : "Crea el tuyo: copiar las fuentes"}
      </button>
      {copia === "fallo"
        ? (
          <div role="alert" className="flex flex-col gap-2">
            <p className="text-sm leading-relaxed text-[var(--color-alerta)]">
              Tu navegador no ha dejado copiar. Aquí las tienes para copiarlas a mano:
            </p>
            {/* La salida honesta: si la máquina no puede copiar, que al menos se pueda seleccionar. */}
            <pre className="overflow-x-auto rounded-md border border-[var(--color-borde)] p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed">
              {fuentes}
            </pre>
          </div>
        )
        : (
          <p className="text-xs leading-relaxed text-[var(--color-tenue)]">
            Con las fuentes en el portapapeles, crea un cuaderno en tu cuenta y pégalas: es tuyo, con tu
            cuota, y puedes añadir lo que quieras encima.
          </p>
        )}
    </section>
  );
}

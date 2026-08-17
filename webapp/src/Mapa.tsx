import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cajaEtiqueta,
  disponer,
  type EstadoNodo,
  estadoDe,
  etiquetaDe,
  type Grafo,
  type NodoDispuesto,
  RADIO_NODO,
} from "../../core/src/mod.ts";

/**
 * El mapa.
 *
 * **El grafo es el mundo, no la interfaz.** Por eso ocupa la pantalla entera y el HUD se queda casi
 * vacío: quien abre la app tiene que ver su cielo, no un panel de control con un grafo dentro. Es la
 * jerarquía que pide `game-ui-web` — crítico (dónde estoy y qué puedo hacer) en el mundo, y lo
 * consultable fuera de la vista hasta que se pide.
 *
 * **Se dibuja en SVG y no con una librería de diagramas.** Se evaluó `@xyflow/react`: es un motor de
 * diagramas *editables* —arrastrar nodos, crear aristas, `handles`— y aquí ninguna de esas tres cosas
 * debe existir, así que traería un modelo de interacción entero para apagarlo, con dos dependencias en
 * el camino crítico de una app que tiene que abrir sin red. Y se evaluó el stack 3D de la vista
 * estelar del Dashboard (Three.js + react-force-graph): siete paquetes, y su brillo es un
 * post-proceso de WebGL que aquí se aproxima con `feGaussianBlur`. La decisión se tomó **enseñándole
 * un prototipo al humano en su móvil**, no discutiéndola: ver `design_grafo_en_pantalla.md` §1.1.
 *
 * El SVG además sale gratis en lo que un canvas cuesta: texto real, foco, lectores de pantalla y
 * `prefers-reduced-motion`.
 */

/**
 * Margen alrededor del grafo al encuadrar, **proporcional a lo que ocupa el grafo**.
 *
 * Era una constante de 110 unidades, y con el contenido real de Fase 0 —una sola de las siete ramas
 * poblada, un racimo de 243×135 unidades— el margen fijo se comía casi la mitad del encuadre: las
 * estrellas salían al 52 % del ancho, flotando en un vacío que parecía un fallo de carga. Lo vio el
 * humano en su móvil; ningún test lo miraba, porque G4 comprobaba «no desborda» y no «se aprovecha».
 *
 * El mínimo existe para el caso contrario: con un grafo diminuto —o uno solo— un margen proporcional
 * tendería a cero y la estrella tocaría el borde.
 */
const MARGEN_MINIMO = 40;
const MARGEN_FRACCION = 0.12;

/**
 * Lo más cerca que se puede llegar, en anchura de `viewBox`. Menos es más cerca.
 *
 * Lo **lejos** no es una constante: se deriva del encuadre inicial (`LEJOS_VECES`), porque un tope
 * fijo de 1800 unidades con un grafo de 440 dejaba alejar cuatro veces hasta convertirlo en una mota
 * en mitad de la nada — parte del «se pierde el grafo» que reportó el humano. Atado al grafo, alejar
 * del todo sigue enseñando el grafo, y el día que el contenido crezca el tope crece con él.
 */
const ZOOM_CERCA = 180;
const LEJOS_VECES = 2.5;

/**
 * Cuánto se puede arrastrar más allá del contenido, en fracciones de la vista.
 *
 * Es lo que impide perder el grafo: sin tope, arrastrar es infinito y se acaba mirando cielo negro sin
 * ninguna forma de volver. Con 0,35 siempre queda casi dos tercios de pantalla con algo dentro.
 */
const HOLGURA_ARRASTRE = 0.35;

interface Vista {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ETIQUETA_ESTADO: Record<EstadoNodo, string> = {
  locked: "bloqueado",
  available: "disponible",
  in_progress: "en curso",
  done: "hecho",
};

export function Mapa({
  grafo,
  completados,
  alTocarNodo,
  enfocado = null,
  tapado = 0,
}: {
  grafo: Grafo;
  completados: ReadonlySet<string>;
  alTocarNodo: (id: string) => void;
  /** Nodo que la hoja está mostrando, si hay alguna abierta. */
  enfocado?: string | null;
  /** Fracción de la pantalla que tapa la hoja, de 0 a 1. */
  tapado?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [vista, setVista] = useState<Vista | null>(null);

  // `disponer` es pura y determinista, así que memorizarla por grafo es exacto: no hay nada que se
  // mueva entre renders. Ver `core/src/disposicion.ts` para por qué la posición se deriva.
  const { ramas, nodos } = useMemo(() => disponer(grafo), [grafo]);
  const estados = useMemo(() => estadoDe(grafo, completados), [grafo, completados]);
  const porId = useMemo(() => new Map(nodos.map((n) => [n.nodo.id, n])), [nodos]);

  /**
   * La caja que ocupa el grafo dibujado.
   *
   * Se calcula una vez y la comparten los tres que la necesitan: el encuadre, el tope del arrastre y
   * el límite de alejar. Tenerla en un sitio es lo que hace que las tres cosas hablen del mismo grafo.
   *
   * Incluye los rótulos y no sólo los centros: una etiqueta larga sobresale bastante más que su
   * estrella, y encuadrar por los centros la dejaba medio fuera por el lado corto.
   */
  const limites = useMemo(() => {
    if (nodos.length === 0) return null;
    const cajas = nodos.map((n) => {
      const r = RADIO_NODO[n.nodo.type];
      const etiqueta = cajaEtiqueta(n);
      return {
        x0: Math.min(n.x - r, etiqueta.x0),
        x1: Math.max(n.x + r, etiqueta.x1),
        y0: Math.min(n.y - r, etiqueta.y0),
        y1: Math.max(n.y + r, etiqueta.y1),
      };
    });
    return {
      x0: Math.min(...cajas.map((c) => c.x0)),
      x1: Math.max(...cajas.map((c) => c.x1)),
      y0: Math.min(...cajas.map((c) => c.y0)),
      y1: Math.max(...cajas.map((c) => c.y1)),
    };
  }, [nodos]);

  /** Anchura del encuadre inicial: de ahí sale lo lejos que se deja alejar. */
  const anchoInicial = useRef(0);

  /**
   * Encuadra el grafo entero.
   *
   * Se ajusta por el lado que **falte**, no por el que sobre: encuadrar por el lado corto recortaría
   * estrellas, y un mapa que esconde parte del mapa la primera vez que lo abres no es un mapa.
   */
  const encuadrar = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !limites) return;
    const margen = Math.max(
      MARGEN_MINIMO,
      MARGEN_FRACCION * Math.max(limites.x1 - limites.x0, limites.y1 - limites.y0),
    );
    const x0 = limites.x0 - margen;
    const y0 = limites.y0 - margen;
    const w = limites.x1 - limites.x0 + margen * 2;
    const h = limites.y1 - limites.y0 + margen * 2;
    const rel = svg.clientWidth / Math.max(1, svg.clientHeight);
    const W = w / h > rel ? w : h * rel;
    const H = w / h > rel ? w / rel : h;
    anchoInicial.current = W;
    setVista({ x: x0 + w / 2 - W / 2, y: y0 + h / 2 - H / 2, w: W, h: H });
  }, [limites]);

  /**
   * Acota una vista para que el grafo **no se pueda perder**.
   *
   * El centro del encuadre se queda dentro de la caja del contenido con una holgura; sin esto,
   * arrastrar es infinito y quien se pasa acaba mirando cielo negro sin forma de volver. No sustituye
   * al botón de centrar —eso es la vuelta a casa tras acercarse mucho— sino que evita hacer falta.
   */
  const acotar = useCallback((v: Vista): Vista => {
    if (!limites) return v;
    const cx = Math.min(
      Math.max(v.x + v.w / 2, limites.x0 - v.w * HOLGURA_ARRASTRE),
      limites.x1 + v.w * HOLGURA_ARRASTRE,
    );
    const cy = Math.min(
      Math.max(v.y + v.h / 2, limites.y0 - v.h * HOLGURA_ARRASTRE),
      limites.y1 + v.h * HOLGURA_ARRASTRE,
    );
    return { ...v, x: cx - v.w / 2, y: cy - v.h / 2 };
  }, [limites]);

  /**
   * Escala la vista **anclando un punto de la pantalla**, que es lo que hace que el zoom se sienta
   * bien: lo que había bajo tus dedos (o bajo el cursor) sigue estando ahí después.
   *
   * Lo comparten el pellizco y la rueda. Antes sólo existía para la rueda y anclaba en el centro de la
   * pantalla, que es lo que hace que acercarse «se vaya» hacia donde no mirabas.
   */
  const conZoom = useCallback((v: Vista, factor: number, ancla: { x: number; y: number }): Vista => {
    const svg = svgRef.current;
    if (!svg) return v;
    const caja = svg.getBoundingClientRect();
    const lejos = (anchoInicial.current || v.w) * LEJOS_VECES;
    const w = Math.min(lejos, Math.max(ZOOM_CERCA, v.w * factor));
    const h = v.h * (w / v.w);
    // Fracción de pantalla donde está el ancla; el punto del grafo que hay debajo no se mueve.
    const fx = (ancla.x - caja.left) / Math.max(1, caja.width);
    const fy = (ancla.y - caja.top) / Math.max(1, caja.height);
    return { x: v.x + fx * (v.w - w), y: v.y + fy * (v.h - h), w, h };
  }, []);

  useEffect(() => {
    encuadrar();
    globalThis.addEventListener("resize", encuadrar);
    return () => globalThis.removeEventListener("resize", encuadrar);
  }, [encuadrar]);

  /**
   * La cámara aparta al sujeto de detrás del panel.
   *
   * Cuando se abre la hoja, la estrella que tocaste puede quedar justo debajo — y entonces la hoja
   * habla de algo que no ves. Es el movimiento de cámara de cualquier juego al abrir un panel, y aquí
   * cuesta cuatro líneas porque el encuadre ya es un estado.
   *
   * Se desplaza **sólo si hace falta**: si la estrella ya está en la franja libre, moverla sería quitar
   * a la persona el mapa mental que acaba de hacerse. Y pasa por `acotar()`, que es lo que impide que
   * apartar la estrella se lleve el grafo fuera de la pantalla.
   */
  useEffect(() => {
    const svg = svgRef.current;
    const puesto = enfocado ? porId.get(enfocado) : null;
    if (!svg || !puesto || tapado <= 0) return;
    setVista((v) => {
      if (!v) return v;
      const libre = 1 - tapado;
      // Dónde cae la estrella dentro del encuadre, en fracción de alto (0 arriba, 1 abajo).
      const donde = (puesto.y - v.y) / v.h;
      const objetivo = libre / 2;
      if (donde > 0.06 && donde < libre - 0.06) return v;
      return acotar({ ...v, y: puesto.y - objetivo * v.h });
    });
  }, [enfocado, tapado, porId, acotar]);

  // --- Desplazar y acercar ----------------------------------------------------------------------

  /**
   * Los dedos (o el ratón) que hay encima ahora mismo, con su última posición.
   *
   * Era **un solo puntero**, y por eso el mapa estaba roto en un móvil: al apoyar el segundo dedo, su
   * `pointerdown` pisaba la posición del primero y el siguiente movimiento se calculaba entre dedos
   * distintos — el mapa pegaba un salto. Intentar pellizcar no es que no hiciera zoom: es que perdía
   * el grafo. Con un mapa por `pointerId` cada dedo tiene su historia y el gesto se decide por cuántos
   * hay: uno desplaza, dos pellizcan.
   */
  const punteros = useRef(new Map<number, { x: number; y: number }>());

  /**
   * A partir de cuántos píxeles un puntero deja de ser un toque y pasa a ser un arrastre.
   *
   * Existe por un fallo que encontró `qa-adversario` y que ningún recorrido veía: capturar el puntero
   * en el `pointerdown` hace que Chromium entregue el **click de compatibilidad** al elemento que tiene
   * la captura —el `<svg>`— y no al `<g role="button">` de la estrella. Con el dedo daba igual, porque
   * el toque genera su propio camino; **con el ratón, tocar una estrella no abría nada**: en un portátil
   * el mapa entero era decorativo. Invisible para la suite porque los ocho recorridos tocaban sólo con
   * `touchscreen.tap()` — la misma familia de aserto que no mira.
   *
   * Capturar sólo cuando el puntero **ya se ha movido** conserva lo que la captura compra (que el
   * arrastre siga funcionando si el dedo se sale del SVG) y devuelve el click a quien le toca.
   */
  const UMBRAL_ARRASTRE = 4;

  const alBajar = (e: React.PointerEvent<SVGSVGElement>) => {
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const alMover = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !vista || !punteros.current.has(e.pointerId)) return;

    const antes = [...punteros.current.values()];
    const previo = punteros.current.get(e.pointerId)!;
    if (
      !e.currentTarget.hasPointerCapture(e.pointerId) &&
      Math.hypot(e.clientX - previo.x, e.clientY - previo.y) < UMBRAL_ARRASTRE &&
      punteros.current.size < 2
    ) {
      return; // todavía es un toque, no un arrastre: no se captura ni se mueve el encuadre
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const ahora = [...punteros.current.values()];

    // La conversión de píxeles a unidades del `viewBox` es lo que hace que arrastrar se sienta igual
    // de rápido esté donde esté el zoom.
    const k = vista.w / Math.max(1, svg.clientWidth);

    const [a0, a1] = antes;
    const [b0, b1] = ahora;
    if (!a0 || !b0) return;

    if (!a1 || !b1) {
      setVista(acotar({ ...vista, x: vista.x - (b0.x - a0.x) * k, y: vista.y - (b0.y - a0.y) * k }));
      return;
    }

    // Dos dedos: la separación manda el zoom y el punto medio manda el desplazamiento. Se hacen las
    // dos cosas porque un pellizco de verdad casi nunca es sólo una: los dedos también se mueven.
    const separacionAntes = Math.hypot(a0.x - a1.x, a0.y - a1.y);
    const separacionAhora = Math.hypot(b0.x - b1.x, b0.y - b1.y);
    if (separacionAntes < 1 || separacionAhora < 1) return;

    const medioAntes = { x: (a0.x + a1.x) / 2, y: (a0.y + a1.y) / 2 };
    const medioAhora = { x: (b0.x + b1.x) / 2, y: (b0.y + b1.y) / 2 };
    const desplazada: Vista = {
      ...vista,
      x: vista.x - (medioAhora.x - medioAntes.x) * k,
      y: vista.y - (medioAhora.y - medioAntes.y) * k,
    };
    // Separar los dedos agranda la separación y encoge el `viewBox`: por eso el cociente va al revés.
    setVista(acotar(conZoom(desplazada, separacionAntes / separacionAhora, medioAhora)));
  };

  const alSoltar = (e: React.PointerEvent<SVGSVGElement>) => {
    punteros.current.delete(e.pointerId);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // La rueda se escucha aquí y no con `onWheel` porque React registra los eventos de rueda como
    // pasivos, y un listener pasivo no puede llamar a `preventDefault()`: sin eso, acercar el mapa
    // también haría scroll de la página.
    const alRodar = (e: WheelEvent) => {
      e.preventDefault();
      setVista((v) =>
        v ? acotar(conZoom(v, e.deltaY > 0 ? 1.12 : 1 / 1.12, { x: e.clientX, y: e.clientY })) : v
      );
    };
    svg.addEventListener("wheel", alRodar, { passive: false });
    return () => svg.removeEventListener("wheel", alRodar);
  }, [acotar, conZoom]);

  return (
    <>
      {/*
        La vuelta a casa. Con el tope del arrastre puesto el grafo ya no se puede perder, pero después
        de acercarse a una estrella hace falta poder volver a verlo entero sin pelearse con el gesto —
        `game-ui-web` lo cuenta como *crítico* («dónde estoy»), no como decoración. Llama a
        `encuadrar()`, que es la función que ya hacía exactamente esto y no estaba cableada a nada.
      */}
      {/*
        Sube por encima de la hoja cuando hay una abierta. `qa-adversario` reprodujo que la hoja lo
        enterraba en sus dos alturas: `isVisible()` seguía diciendo `true` —no estaba oculto, estaba
        tapado— y el toque caía en la hoja. Resultado: tras acercarte a una estrella y abrir su hoja, la
        única vuelta al encuadre exigía cerrarla, y el panel que promete no ser modal se comportaba como
        si lo fuera. El desplazamiento va en una clase acotada y no en un `style` en línea, que el gate
        veta con razón.
      */}
      <button
        type="button"
        onClick={encuadrar}
        className={`fixed z-30 min-h-11 min-w-11 rounded-full border border-[var(--color-borde)] bg-[var(--color-panel)]/80 px-4 text-sm text-[var(--color-tenue)] ${
          // Con la hoja alta se va **a la izquierda**: arriba a la derecha vive la «×» de la hoja, y el
          // primer intento de este arreglo la tapaba — cambiar un control enterrado por otro enterrado
          // no es arreglarlo. Lo cazaron los propios recorridos K5/K6 al no poder cerrar la hoja.
          tapado > 0.6
            ? "top-20 left-4"
            : tapado > 0
            ? "right-4 bottom-[calc(45%+1.5rem)]"
            : "right-4 bottom-6"
        }`}
      >
        Centrar
      </button>
      <svg
        ref={svgRef}
        className="fixed inset-0 h-full w-full touch-none"
        viewBox={vista ? `${vista.x} ${vista.y} ${vista.w} ${vista.h}` : "-300 -300 600 600"}
        onPointerDown={alBajar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        aria-label="Mapa de competencias"
      >
      <defs>
        {/*
          El brillo de las estrellas. Es la **intención** del bloom de un post-proceso 3D, conseguida
          con un desenfoque que se suma dos veces sobre el original — no es lo mismo y no se vende como
          tal; se enseñó y se aprobó así.
        */}
        <filter id="brillo" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="brillo-tenue" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="estrella">
          <stop offset="0%" stopColor="var(--color-tinta)" />
          <stop offset="45%" stopColor="var(--color-acento)" />
          <stop offset="100%" stopColor="var(--color-acento)" stopOpacity=".25" />
        </radialGradient>
      </defs>

      {/*
        Los sectores de las ramas. Seis de las siete no tienen contenido en Fase 0, y se dibujan igual:
        leídas como cielo que aún no se ha explorado dicen más que esconderlas, que haría creer que el
        mapa es sólo esto.
      */}
      <g className="mapa-sectores">
        {ramas.map((r) => {
          const a = (r.anguloCentro * Math.PI) / 180;
          const L = 470;
          const cos = Math.cos(a);
          return (
            <g key={r.id}>
              <line x1={0} y1={0} x2={cos * L} y2={Math.sin(a) * L} />
              <text
                x={cos * (L + 16)}
                y={Math.sin(a) * (L + 16)}
                textAnchor={cos < -0.2 ? "end" : cos > 0.2 ? "start" : "middle"}
              >
                {r.name}
              </text>
            </g>
          );
        })}
      </g>

      <g className="mapa-aristas">
        {nodos.flatMap((n) =>
          n.nodo.prerequisites.map((pre) => {
            const desde = porId.get(pre);
            if (!desde) return null;
            const abierta = completados.has(pre);
            return (
              <path
                key={`${pre}->${n.nodo.id}`}
                className={abierta ? "abierta" : ""}
                // Curva hacia el centro: una recta entre dos estrellas parece un diagrama; una curva,
                // una constelación. Es la misma información con otro idioma.
                d={`M ${desde.x} ${desde.y} Q ${((desde.x + n.x) / 2) * 0.72} ${
                  ((desde.y + n.y) / 2) * 0.72
                } ${n.x} ${n.y}`}
                pathLength={1}
                filter={abierta ? "url(#brillo-tenue)" : undefined}
              />
            );
          })
        )}
      </g>

      <g>
        {nodos.map((n) => (
          <Estrella
            key={n.nodo.id}
            puesto={n}
            estado={estados.get(n.nodo.id) ?? "locked"}
            alTocar={alTocarNodo}
          />
        ))}
      </g>
      </svg>
    </>
  );
}

function Estrella({
  puesto,
  estado,
  alTocar,
}: {
  puesto: NodoDispuesto;
  estado: EstadoNodo;
  alTocar: (id: string) => void;
}) {
  const { nodo, x, y } = puesto;
  const r = RADIO_NODO[nodo.type];
  const apagada = estado === "locked";

  return (
    <g
      className="mapa-nodo"
      data-estado={estado}
      data-id={nodo.id}
      tabIndex={0}
      role="button"
      // El estado va en el nombre accesible y no sólo en el color: quien no distingue el halo del
      // apagado tiene que poder saber si un nodo se puede empezar.
      aria-label={`${nodo.title}. ${ETIQUETA_ESTADO[estado]}`}
      onClick={() => alTocar(nodo.id)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        alTocar(nodo.id);
      }}
    >
      {/*
        El foco se DIBUJA aquí en vez de dejárselo al `outline` del navegador. Dos motivos, y el
        segundo es el que lo hizo urgente: un `outline` sobre este `<g>` encuadra su caja entera
        —estrella *y* rótulo—, que en el móvil salía como un recuadro blanco enorme; y el anillo del
        navegador aparece al **tocar** con el dedo, porque Chrome en Android no aplica `:focus-visible`
        a un `<g role="button">`. Con el indicador propio, el toque no pinta nada y el teclado sí.
      */}
      <circle className="foco" cx={x} cy={y} r={r + 9} />
      {!apagada && <circle className="halo" cx={x} cy={y} r={r * 2.5} />}
      <circle
        className="cuerpo"
        cx={x}
        cy={y}
        r={r}
        filter={apagada ? undefined : "url(#brillo)"}
      />
      {/* El anillo distingue un proyecto de un concepto sin depender del color, que ya lleva el estado. */}
      {nodo.type === "project" && <circle className="anillo" cx={x} cy={y} r={r + 7} />}
      {/*
        El lado lo decide `disponer()`, no el render: con una sola rama poblada dos rótulos vecinos se
        pisaban, y de qué lado cabe una etiqueta es una función de dónde están las demás — o sea, del
        grafo. Aquí sólo se lee el resultado. Ver `core/src/disposicion.ts`.
      */}
      <text
        className="etiqueta"
        x={x}
        y={puesto.ladoEtiqueta === "abajo" ? y + r + 15 : y - r - 15}
        textAnchor="middle"
      >
        {etiquetaDe(nodo)}
      </text>
    </g>
  );
}

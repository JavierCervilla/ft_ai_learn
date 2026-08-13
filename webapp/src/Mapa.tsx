import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  disponer,
  type EstadoNodo,
  estadoDe,
  type Grafo,
  type NodoDispuesto,
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

/** Radio dibujado de cada tipo de nodo, en unidades de `viewBox`. */
const RADIO = { concept: 9, project: 13 } as const;

/** Margen alrededor del grafo al encuadrar, para que ninguna etiqueta toque el borde. */
const MARGEN = 110;

/** Límites del zoom, en anchura de `viewBox`: menos es más cerca. */
const ZOOM = { cerca: 220, lejos: 1800 } as const;

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
}: {
  grafo: Grafo;
  completados: ReadonlySet<string>;
  alTocarNodo: (id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [vista, setVista] = useState<Vista | null>(null);

  // `disponer` es pura y determinista, así que memorizarla por grafo es exacto: no hay nada que se
  // mueva entre renders. Ver `core/src/disposicion.ts` para por qué la posición se deriva.
  const { ramas, nodos } = useMemo(() => disponer(grafo), [grafo]);
  const estados = useMemo(() => estadoDe(grafo, completados), [grafo, completados]);
  const porId = useMemo(() => new Map(nodos.map((n) => [n.nodo.id, n])), [nodos]);

  /**
   * Encuadra el grafo entero.
   *
   * Se ajusta por el lado que **falte**, no por el que sobre: encuadrar por el lado corto recortaría
   * estrellas, y un mapa que esconde parte del mapa la primera vez que lo abres no es un mapa.
   */
  const encuadrar = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || nodos.length === 0) return;
    const xs = nodos.map((n) => n.x);
    const ys = nodos.map((n) => n.y);
    const x0 = Math.min(...xs) - MARGEN;
    const x1 = Math.max(...xs) + MARGEN;
    const y0 = Math.min(...ys) - MARGEN;
    const y1 = Math.max(...ys) + MARGEN;
    const w = x1 - x0;
    const h = y1 - y0;
    const rel = svg.clientWidth / Math.max(1, svg.clientHeight);
    const W = w / h > rel ? w : h * rel;
    const H = w / h > rel ? w / rel : h;
    setVista({ x: x0 + w / 2 - W / 2, y: y0 + h / 2 - H / 2, w: W, h: H });
  }, [nodos]);

  useEffect(() => {
    encuadrar();
    globalThis.addEventListener("resize", encuadrar);
    return () => globalThis.removeEventListener("resize", encuadrar);
  }, [encuadrar]);

  // --- Desplazar y acercar ----------------------------------------------------------------------
  const arrastre = useRef<{ x: number; y: number } | null>(null);

  const alBajar = (e: React.PointerEvent<SVGSVGElement>) => {
    arrastre.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const alMover = (e: React.PointerEvent<SVGSVGElement>) => {
    const desde = arrastre.current;
    const svg = svgRef.current;
    if (!desde || !svg || !vista) return;
    // La conversión de píxeles a unidades del `viewBox` es lo que hace que arrastrar se sienta igual
    // de rápido esté donde esté el zoom.
    const k = vista.w / Math.max(1, svg.clientWidth);
    setVista({
      ...vista,
      x: vista.x - (e.clientX - desde.x) * k,
      y: vista.y - (e.clientY - desde.y) * k,
    });
    arrastre.current = { x: e.clientX, y: e.clientY };
  };

  const alSoltar = () => {
    arrastre.current = null;
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // La rueda se escucha aquí y no con `onWheel` porque React registra los eventos de rueda como
    // pasivos, y un listener pasivo no puede llamar a `preventDefault()`: sin eso, acercar el mapa
    // también haría scroll de la página.
    const alRodar = (e: WheelEvent) => {
      e.preventDefault();
      setVista((v) => {
        if (!v) return v;
        const f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const w = Math.min(ZOOM.lejos, Math.max(ZOOM.cerca, v.w * f));
        const k = w / v.w;
        const h = v.h * k;
        return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
      });
    };
    svg.addEventListener("wheel", alRodar, { passive: false });
    return () => svg.removeEventListener("wheel", alRodar);
  }, []);

  return (
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
  const r = RADIO[nodo.type];
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
      <text className="etiqueta" x={x} y={y + r + 15} textAnchor="middle">
        {nodo.title.length > 26 ? `${nodo.title.slice(0, 24)}…` : nodo.title}
      </text>
    </g>
  );
}

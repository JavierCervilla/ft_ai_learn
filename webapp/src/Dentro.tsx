import { useEffect, useMemo, useState } from "react";
import { estadoDe, type Grafo } from "../../core/src/mod.ts";
import { grafo as pedirGrafo, type Sesion } from "./api.ts";
import { Mapa } from "./Mapa.tsx";
import { Cuenta } from "./Cuenta.tsx";
import { ALTURA_HOJA, HojaNodo } from "./HojaNodo.tsx";
import { abrirNodo, cerrarNodo, useNodoAbierto } from "./rutas.ts";

/**
 * El progreso llega en **E.3**. Hasta entonces el mapa y la hoja dibujan el estado inicial de verdad —
 * nada completado— en vez de inventarse uno de mentira para que se vea bonito.
 *
 * Es una constante del módulo y no un `new Set()` en línea porque un conjunto nuevo en cada render
 * invalidaría los `useMemo` que dependen de él, y entonces el mapa recalcularía la disposición entera
 * cada vez que se abre una hoja.
 */
const COMPLETADOS: ReadonlySet<string> = new Set();

/**
 * Lo que ves cuando estás dentro.
 *
 * **La pantalla principal es el mapa**, no la cuenta. Hasta FTAI-E.1 lo era la cuenta porque no había
 * mapa; ahora el orden lo dicta lo que la persona viene a hacer, que es recorrer su grafo. Tu círculo
 * pasa a ser lo *consultable* —la tercera categoría de `game-ui-web`— y se alcanza desde tu nombre.
 *
 * Los dos son estados de este componente y no rutas: las rutas de verdad llegan en E.2 (`#/nodo/<id>`)
 * y tienen un motivo concreto —sin entrada de historial, el botón atrás de Android cierra la app en
 * vez de cerrar lo que tengas abierto—. Añadirlas aquí sería adelantar trabajo sin su razón.
 */
type Pantalla = { donde: "mapa" } | { donde: "cuenta" };

export function Dentro({ sesion, alSalir, alCambiarSesion }: {
  sesion: Sesion;
  alSalir: () => void;
  /**
   * «La sesión que hay ahora no es la que tenías». Se pasa **entero** hacia arriba en vez de
   * traducirlo aquí a «te has ido»: cuando la cookie pasa a ser de otra persona el argumento no es
   * `null`, y colapsar los dos casos dejaba la pantalla firmando indefinidamente con el nombre
   * anterior mientras cada botón actuaba contra la sesión nueva. Es exactamente el fallo que el
   * trinquete A3 existe para impedir, y lo volvió a cazar al cablear esta pantalla.
   */
  alCambiarSesion: (s: Sesion | null) => void;
}) {
  const [pantalla, setPantalla] = useState<Pantalla>({ donde: "mapa" });
  // El nodo abierto vive en la URL, no en un `useState`: ver `rutas.ts` para por qué (el atrás de
  // Android). `tapado` es cuánto de la pantalla ocupa la hoja, que es lo que el mapa necesita saber
  // para apartar la estrella de detrás.
  const abierto = useNodoAbierto();
  const [tapado, setTapado] = useState<number>(ALTURA_HOJA.baja);
  const [grafo, setGrafo] = useState<Grafo | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);

  const estados = useMemo(
    () => (grafo ? estadoDe(grafo, COMPLETADOS) : new Map()),
    [grafo],
  );
  // Un id en la URL que no existe en el grafo **no abre nada**: la URL es entrada de fuera, y no puede
  // dar por hecho que nombra algo nuestro.
  const nodo = grafo && abierto ? grafo.nodes.find((n) => n.id === abierto) ?? null : null;

  useEffect(() => {
    let vivo = true;
    pedirGrafo()
      .then((g) => vivo && setGrafo(g))
      // El mensaje sale del cuerpo de la respuesta, como en toda la app: aquí sólo se decide que hubo
      // un fallo, no qué decir.
      .catch((e: unknown) => vivo && setFallo(e instanceof Error ? e.message : "No se pudo cargar el mapa."));
    return () => {
      vivo = false;
    };
  }, []);

  if (pantalla.donde === "cuenta") {
    return (
      <div className="flex min-h-full flex-col">
        <button
          type="button"
          onClick={() => setPantalla({ donde: "mapa" })}
          className="self-start px-6 py-4 text-sm text-[var(--color-tenue)] underline underline-offset-4"
        >
          ← Al mapa
        </button>
        <Cuenta sesion={sesion} alSalir={alSalir} alCambiarSesion={alCambiarSesion} />
      </div>
    );
  }

  return (
    <>
      {/*
        El HUD, casi vacío a propósito. No lleva contador de nodos disponibles: los halos ya lo dicen,
        y mejor. Lo que sí lleva es quién eres, porque es la puerta a tu círculo.
      */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-baseline justify-between gap-4 px-5 py-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl leading-none">
          Holy Graph<span className="text-[var(--color-acento)]">.</span>
        </h1>
        <button
          type="button"
          onClick={() => setPantalla({ donde: "cuenta" })}
          className="pointer-events-auto min-h-11 px-2 text-sm text-[var(--color-tenue)] underline underline-offset-4"
        >
          {sesion.user.name}
        </button>
      </header>

      {grafo
        ? (
          <>
            <Mapa
              grafo={grafo}
              completados={COMPLETADOS}
              alTocarNodo={(id) => abrirNodo(id, abierto !== null)}
              enfocado={abierto}
              tapado={nodo ? tapado : 0}
            />
            {nodo && (
              <HojaNodo
                key={nodo.id}
                grafo={grafo}
                nodo={nodo}
                estado={estados.get(nodo.id) ?? "locked"}
                completados={COMPLETADOS}
                alAbrirOtro={(id) => abrirNodo(id, true)}
                alCerrar={cerrarNodo}
                alCambiarAltura={setTapado}
              />
            )}
          </>
        )
        : (
          <main className="flex min-h-full items-center justify-center px-6 text-center">
            <p className="text-[var(--color-tenue)]">{fallo ?? "…"}</p>
          </main>
        )}
    </>
  );
}

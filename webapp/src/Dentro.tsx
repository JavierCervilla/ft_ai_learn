import { useEffect, useMemo, useState } from "react";
import { estadoDe, type Grafo } from "../../core/src/mod.ts";
import { grafo as pedirGrafo, type Sesion } from "./api.ts";
import { Mapa } from "./Mapa.tsx";
import { Cuenta } from "./Cuenta.tsx";
import { ALTURA_HOJA, HojaNodo } from "./HojaNodo.tsx";
import { irA, useRuta, volver } from "./rutas.ts";

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
  // **Las tres pantallas viven en la URL**, no en un `useState`. Ver `rutas.ts`: si algo se abre y no
  // deja entrada de historial, el atrás de Android no lo cierra — cierra la app. Al principio sólo la
  // hoja era ruta y la cuenta no, y `qa-adversario` reprodujo que media solución en una pila de
  // historial es una pila incoherente.
  const ruta = useRuta();
  const abierto = ruta.donde === "nodo" ? ruta.id : null;
  // La altura vive aquí y no en la hoja: así la hoja no se remonta al cambiar de nodo y su región
  // `aria-live` sobrevive para poder anunciar. Ver el comentario de `alta` en `HojaNodo.tsx`.
  const [alta, setAlta] = useState(false);

  /** Abrir un nodo **siempre** vuelve a la altura baja: la hoja es del nodo que estás mirando. */
  const abrir = (id: string) => {
    setAlta(false);
    irA({ donde: "nodo", id });
  };
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

  if (ruta.donde === "cuenta") {
    return (
      <div className="flex min-h-full flex-col">
        <button
          type="button"
          onClick={volver}
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
          onClick={() => irA({ donde: "cuenta" })}
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
              alTocarNodo={abrir}
              enfocado={abierto}
              tapado={nodo ? (alta ? ALTURA_HOJA.alta : ALTURA_HOJA.baja) : 0}
            />
            {nodo && (
              <HojaNodo
                grafo={grafo}
                nodo={nodo}
                estado={estados.get(nodo.id) ?? "locked"}
                completados={COMPLETADOS}
                alta={alta}
                alAbrirOtro={abrir}
                alCerrar={volver}
                alCambiarAltura={setAlta}
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

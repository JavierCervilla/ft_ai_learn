import { useEffect, useState } from "react";

/**
 * Las rutas de la app: **un hash, tres pantallas, ninguna librería**.
 *
 * `App.tsx` dejó escrito el criterio en FTAI-D.2 — *«cuando el grafo traiga rutas de verdad se añadirá
 * con un motivo, no por costumbre»*. El motivo llegó, y **no es poder compartir un enlace**:
 *
 * **El botón atrás tiene que cerrar lo que tengas abierto, no la app.** En Android el gesto de volver
 * es del sistema. Si abrir algo no deja una entrada en el historial, quien lo cierra con «atrás» no
 * cierra eso: **cierra la aplicación**. En el empaquetado para tiendas que protege la spec §6.2 es peor
 * todavía.
 *
 * **Por qué la cuenta también es una ruta**: al principio sólo lo era la hoja del nodo, y `qa-adversario`
 * reprodujo que eso no bastaba — desde tu círculo el atrás seguía sacando de la app, porque la cuenta
 * era estado de componente y no tenía entrada. Media solución en un problema de pila de historial es una
 * pila incoherente. Si algo se abre, se apila.
 *
 * **Hash y no ruta con barra** porque el destino declarado es un bundle empaquetable, donde el origen
 * puede ser `file://` y una ruta con barra deja de resolver contra el servidor que no hay.
 *
 * **Sin `react-router`**: compraría anidamiento, `loaders` y `guards` que aquí no existen, sobre un
 * bundle que tiene que abrir sin red.
 */

const PREFIJO_NODO = "#/nodo/";
const RUTA_CUENTA = "#/cuenta";

export type Ruta =
  | { donde: "mapa" }
  | { donde: "cuenta" }
  | { donde: "nodo"; id: string };

/**
 * La ruta que dice la URL.
 *
 * **`decodeURIComponent` lanza con un porcentaje mal escrito** (`#/nodo/%`, `#/nodo/f0-entorno%zz`), y
 * esto se ejecuta en el **primer render**: sin el `try`, React abortaba el árbol entero y la app se
 * quedaba **en blanco**, sin mapa, sin mensaje y sin vuelta — recargar repetía el estrellón, porque el
 * hash seguía en la barra. Lo reprodujo `qa-adversario`, y es la peor clase de fallo: un enlace mal
 * pegado deja la aplicación muerta para quien lo abre. Un hash que no se puede decodificar **no nombra
 * ningún nodo**, así que la respuesta honesta es «estás en el mapa».
 */
export function rutaDeLaUrl(hash: string = globalThis.location?.hash ?? ""): Ruta {
  if (hash === RUTA_CUENTA) return { donde: "cuenta" };
  if (!hash.startsWith(PREFIJO_NODO)) return { donde: "mapa" };
  try {
    const id = decodeURIComponent(hash.slice(PREFIJO_NODO.length));
    return id.length > 0 ? { donde: "nodo", id } : { donde: "mapa" };
  } catch {
    return { donde: "mapa" };
  }
}

const urlDe = (r: Ruta): string =>
  r.donde === "cuenta"
    ? RUTA_CUENTA
    : r.donde === "nodo"
    ? `${PREFIJO_NODO}${encodeURIComponent(r.id)}`
    : globalThis.location.pathname;

/**
 * Va a una ruta **apilando** una entrada, que es justo el punto de todo esto.
 *
 * Salvo cuando ya estás en una pantalla del mismo tipo: cambiar de nodo a nodo **reemplaza**, porque si
 * cada estrella curioseada dejara su entrada, salir costaría tantos «atrás» como estrellas hubieras
 * mirado. La pila cuenta *dónde estás*, no cada cosa que miraste.
 *
 * `history.state.nuestra` marca las entradas que apilamos nosotros: es lo que le permite a `volver()`
 * saber si debajo hay app a la que regresar o si esto es lo primero que abrió la pestaña.
 */
export function irA(ruta: Ruta): void {
  const actual = rutaDeLaUrl();
  const url = urlDe(ruta);
  const reemplaza = actual.donde === ruta.donde && ruta.donde !== "mapa";
  if (reemplaza) globalThis.history.replaceState({ nuestra: true }, "", url);
  else globalThis.history.pushState({ nuestra: true }, "", url);
  globalThis.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * Cierra lo que haya abierto: **atrás si fuimos nosotros los que apilamos**, y si no, al mapa.
 *
 * `history.back()` a secas cerraba la aplicación cuando la pantalla era lo primero de la pestaña —un
 * enlace compartido, un marcador, o entrar con el hash puesto tras el formulario de acceso—: debajo no
 * había app, y la «×» llevaba a `about:blank`. Es exactamente lo que este módulo existe para impedir,
 * por el camino que no probaba nadie; lo reprodujo `qa-adversario`.
 */
export function volver(): void {
  if (globalThis.history.state?.nuestra) {
    globalThis.history.back();
    return;
  }
  globalThis.history.replaceState(null, "", globalThis.location.pathname);
  globalThis.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * Devuelve la ruta al mapa **sin apilar**, para cuando cambia quién eres.
 *
 * Entrar y salir tienen que dejar la app en su sitio. Sin esto, el hash de la sesión anterior sobrevive
 * al cierre de sesión y **la siguiente persona que entra aterriza donde estuvo la anterior** — se ve
 * enseguida en el trinquete A3, que sale y entra con otra cuenta en la misma pestaña. Es la misma
 * familia que A3 vigila: estado de una identidad filtrándose a la siguiente.
 */
export function reiniciarRuta(): void {
  if (rutaDeLaUrl().donde === "mapa") return;
  globalThis.history.replaceState(null, "", globalThis.location.pathname);
  globalThis.dispatchEvent(new HashChangeEvent("hashchange"));
}

/** La ruta actual, reactiva: al `hashchange` y al `popstate` (el atrás del sistema). */
export function useRuta(): Ruta {
  const [ruta, setRuta] = useState<Ruta>(() => rutaDeLaUrl());

  useEffect(() => {
    const releer = () => setRuta(rutaDeLaUrl());
    globalThis.addEventListener("hashchange", releer);
    // `popstate` además de `hashchange` porque el atrás entre dos entradas con el MISMO hash no dispara
    // `hashchange`, y ahí es donde vive el caso que motiva el módulo entero.
    globalThis.addEventListener("popstate", releer);
    return () => {
      globalThis.removeEventListener("hashchange", releer);
      globalThis.removeEventListener("popstate", releer);
    };
  }, []);

  return ruta;
}

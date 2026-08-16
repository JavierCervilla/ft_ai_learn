import { useEffect, useState } from "react";

/**
 * Las rutas de la app: **un hash, dos estados, ninguna librería**.
 *
 * `App.tsx` dejó escrito el criterio en FTAI-D.2 — *«cuando el grafo traiga rutas de verdad se añadirá
 * con un motivo, no por costumbre»*. El motivo llegó, y **no es poder compartir un enlace**:
 *
 * **El botón atrás tiene que cerrar la hoja, no la app.** En Android el gesto de volver es del sistema.
 * Si abrir un nodo no deja una entrada en el historial, quien está leyendo una hoja y hace «atrás» no
 * cierra la hoja: **cierra la aplicación**. Eso no es una comodidad que falte, es la app cerrándose en
 * la cara de la persona — y en el empaquetado para tiendas que protege la spec §6.2 es peor todavía.
 *
 * **Hash y no ruta con barra** porque el destino declarado es un bundle empaquetable, donde el origen
 * puede ser `file://` y una ruta con barra deja de resolver contra el servidor que no hay.
 *
 * **Sin `react-router`**: compraría anidamiento, `loaders` y `guards` que aquí no existen, sobre un
 * bundle que tiene que abrir sin red. Esto es lo que hace falta y nada más.
 */

const PREFIJO = "#/nodo/";

/** El nodo abierto según la URL, o `null` si no hay ninguno. */
export function nodoDeLaUrl(hash: string = globalThis.location?.hash ?? ""): string | null {
  if (!hash.startsWith(PREFIJO)) return null;
  const id = decodeURIComponent(hash.slice(PREFIJO.length));
  return id.length > 0 ? id : null;
}

/**
 * Abre un nodo **añadiendo** una entrada de historial, que es justo el punto de todo esto.
 *
 * Cambiar de un nodo a otro **reemplaza** en vez de apilar: si cada estrella tocada con la hoja abierta
 * dejara su entrada, salir de la hoja costaría tantos «atrás» como estrellas hubieras curioseado. La
 * pila de historial debe contar la historia de *dónde estás*, no la de cada cosa que miraste.
 */
export function abrirNodo(id: string, veniaDeOtroNodo: boolean): void {
  const url = `${PREFIJO}${encodeURIComponent(id)}`;
  if (veniaDeOtroNodo) globalThis.history.replaceState(null, "", url);
  else globalThis.history.pushState(null, "", url);
  globalThis.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * Cierra la hoja **volviendo atrás**, no borrando el hash.
 *
 * Es lo que mantiene coherente la pila: cerrar con la «X» y cerrar con el botón del sistema tienen que
 * dejar el historial en el mismo sitio. Si la «X» hiciera `replaceState`, un «atrás» posterior sacaría
 * a la persona de la app aunque ella creyera haber vuelto ya.
 */
export function cerrarNodo(): void {
  globalThis.history.back();
}

/** El nodo abierto, reactivo a la URL: al `hashchange` y al `popstate` (el atrás del sistema). */
export function useNodoAbierto(): string | null {
  const [id, setId] = useState<string | null>(() => nodoDeLaUrl());

  useEffect(() => {
    const releer = () => setId(nodoDeLaUrl());
    globalThis.addEventListener("hashchange", releer);
    // `popstate` además de `hashchange` porque el atrás entre dos entradas con el MISMO hash no dispara
    // `hashchange`, y ahí es donde vive el caso que motiva el módulo entero.
    globalThis.addEventListener("popstate", releer);
    return () => {
      globalThis.removeEventListener("hashchange", releer);
      globalThis.removeEventListener("popstate", releer);
    };
  }, []);

  return id;
}

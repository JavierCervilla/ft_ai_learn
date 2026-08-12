/**
 * Clasificación de un enlace: vivo, muerto o **no comprobable desde aquí**.
 *
 * La tercera categoría es la razón de que este módulo exista aparte. Desde el contenedor del enjambre
 * el proxy de egress devuelve **403 para `github.com`** aunque la URL sea perfectamente válida. Un
 * comprobador que lo cuente como rojo produce falsos positivos, y un gate con falsos positivos enseña
 * a la gente a ignorarlo — que es peor que no tenerlo.
 */

export type Veredicto = "vivo" | "muerto" | "bloqueado";

export interface Comprobacion {
  url: string;
  donde: string;
  veredicto: Veredicto;
  detalle: string;
}

/** Hosts que el entorno bloquea con 403 aunque el sitio esté perfectamente vivo. */
export const BLOQUEADOS_POR_EL_ENTORNO = ["github.com", "www.github.com"];

export async function comprobar(
  url: string,
  donde: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Comprobacion> {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return { url, donde, veredicto: "muerto", detalle: "no es una URL válida" };
  }
  const bloqueable = BLOQUEADOS_POR_EL_ENTORNO.includes(host);

  try {
    // GET y no HEAD: bastantes sitios responden 405 a HEAD y 200 a GET, y un comprobador que use
    // HEAD los daría por muertos.
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "ftai-verificador-de-enlaces" },
      signal: AbortSignal.timeout(25_000),
    });
    await res.body?.cancel();

    if (res.ok) return { url, donde, veredicto: "vivo", detalle: String(res.status) };
    if (res.status === 403 && bloqueable) {
      return {
        url,
        donde,
        veredicto: "bloqueado",
        detalle: "403 del proxy del entorno, no del sitio",
      };
    }
    return { url, donde, veredicto: "muerto", detalle: `HTTP ${res.status}` };
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    if (bloqueable) {
      return {
        url,
        donde,
        veredicto: "bloqueado",
        detalle: `bloqueado por el entorno (${mensaje})`,
      };
    }
    return { url, donde, veredicto: "muerto", detalle: mensaje };
  }
}

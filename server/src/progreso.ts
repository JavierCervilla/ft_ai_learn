import type { Sql } from "postgres";
import { estadoDe } from "@ftai/core";
import type { EstadoNodo, Grafo } from "@ftai/core";

/**
 * El progreso de cada persona.
 *
 * **Ninguna función de este módulo acepta un `userId` que venga de fuera de la sesión.** No es una
 * convención: es la forma de la API. El manejador saca la identidad de `usuarioDe()` y la pasa aquí,
 * y el `userId` entra siempre en el `WHERE`. Así el bug clásico —«se nos olvidó comprobar la
 * pertenencia en este endpoint»— no se puede escribir, porque no hay otro sitio del que sacar el
 * usuario. Es más fuerte que comprobar `url.userId === sesion.userId` en cada manejador, que es
 * exactamente la comprobación que algún día falta en uno.
 */

export type Marca = "in_progress" | "done";

export interface FilaProgreso {
  nodeId: string;
  state: Marca;
  startedAt: Date;
  doneAt: Date | null;
}

/** Lo que la pantalla necesita: qué hay guardado y qué estado tiene cada nodo del grafo. */
export interface VistaProgreso {
  progreso: FilaProgreso[];
  estados: Record<string, EstadoNodo>;
}

export async function leerProgreso(sql: Sql, userId: string): Promise<FilaProgreso[]> {
  return await sql<FilaProgreso[]>`
    select node_id as "nodeId", state, started_at as "startedAt", done_at as "doneAt"
    from user_progress where user_id = ${userId} order by node_id`;
}

/**
 * El progreso más el estado derivado de cada nodo.
 *
 * `available` **se calcula**, no se lee: con `estadoDe()` del núcleo, que es **la misma función que
 * ejecuta el navegador** para desbloquear de forma optimista. Si esto se calculara aquí de otra
 * manera, cliente y servidor discreparían en silencio y ganaría el que respondiera antes.
 */
export async function vistaDe(sql: Sql, userId: string, grafo: Grafo): Promise<VistaProgreso> {
  const progreso = await leerProgreso(sql, userId);
  const completados = new Set(progreso.filter((f) => f.state === "done").map((f) => f.nodeId));
  const enCurso = new Set(progreso.filter((f) => f.state === "in_progress").map((f) => f.nodeId));
  return {
    progreso,
    estados: Object.fromEntries(estadoDe(grafo, completados, enCurso)),
  };
}

export type ResultadoMarca =
  | { ok: true; fila: FilaProgreso }
  | { ok: false; motivo: "nodo-desconocido" | "bloqueado" };

/**
 * Marca un nodo como empezado o hecho.
 *
 * **Idempotente**: reenviar la misma marca deja la misma fila. Lo necesita FTAI-E, que tiene que poder
 * encolar marcas sin red y reenviarlas al volver (criterio V6); un `POST` que duplicase o fallase al
 * repetirse convertiría una reconexión en un bug.
 *
 * `startedAt` y `doneAt` **no se pisan** al repetir: la primera vez que algo se empezó o se terminó es
 * un hecho histórico, y sobreescribirlo al reenviar una marca encolada falsearía la fecha.
 *
 * El desbloqueo se comprueba **aquí**, en el servidor, aunque el cliente ya lo haya calculado: el
 * cálculo del cliente es optimista y una petición puede llegar a mano.
 */
export async function marcar(
  sql: Sql,
  userId: string,
  nodeId: string,
  marca: Marca,
  grafo: Grafo,
): Promise<ResultadoMarca> {
  if (!grafo.nodes.some((n) => n.id === nodeId)) return { ok: false, motivo: "nodo-desconocido" };

  const previo = await leerProgreso(sql, userId);
  const completados = new Set(previo.filter((f) => f.state === "done").map((f) => f.nodeId));
  const estados = estadoDe(grafo, completados);
  // Un nodo ya hecho sigue siendo marcable (idempotencia); uno bloqueado no, ni con una petición
  // a mano: el servidor es la autoridad del desbloqueo.
  if (estados.get(nodeId) === "locked") return { ok: false, motivo: "bloqueado" };

  const filas = await sql<FilaProgreso[]>`
    insert into user_progress (user_id, node_id, state, done_at)
    values (${userId}, ${nodeId}, ${marca}, ${marca === "done" ? sql`now()` : null})
    on conflict (user_id, node_id) do update set
      state = excluded.state,
      done_at = case
        when user_progress.done_at is not null then user_progress.done_at
        when excluded.state = 'done' then now()
        else null
      end
    returning node_id as "nodeId", state, started_at as "startedAt", done_at as "doneAt"`;

  const fila = filas[0];
  if (!fila) throw new Error(`el upsert de progreso no devolvió fila para ${nodeId}`);
  return { ok: true, fila };
}

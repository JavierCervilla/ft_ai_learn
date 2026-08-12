/**
 * Regla 9 del contrato: **toda `url` del contenido resuelve**. Job de CI.
 *
 * Vive fuera del núcleo porque necesita red, y fuera del gate de contenido porque un enlace muerto y
 * un contenido mal escrito son problemas distintos que se arreglan en momentos distintos.
 *
 * La clasificación —y la distinción entre *muerto* y *bloqueado por el entorno*— está en
 * `enlaces.ts`, que sí tiene tests. Esto es sólo el recorrido y el informe.
 *
 * Uso: `deno task contenido:enlaces`. Sale 1 **sólo si hay enlaces muertos**.
 */
import { comprobar, type Veredicto } from "./enlaces.ts";
import { leerContenido } from "./contenido.ts";

const grafo = await leerContenido();

const pendientes = grafo.nodes.flatMap((n) =>
  (n.resources ?? []).map((r) => ({ url: r.url, donde: `${n.id}/${r.id}` }))
);
// Los cuadernos también son enlaces a terceros y también se pudren.
for (const n of grafo.nodes) {
  if (n.notebook) pendientes.push({ url: n.notebook.url, donde: `${n.id}/notebook` });
}

const resultados = await Promise.all(pendientes.map((p) => comprobar(p.url, p.donde)));

const iconos: Record<Veredicto, string> = { vivo: "✓", muerto: "✗", bloqueado: "~" };
for (const r of resultados) {
  console.log(`  ${iconos[r.veredicto]} ${r.donde.padEnd(34)} ${r.detalle.padEnd(30)} ${r.url}`);
}

const muertos = resultados.filter((r) => r.veredicto === "muerto");
const bloqueados = resultados.filter((r) => r.veredicto === "bloqueado");
console.log(
  `\n${resultados.length} enlaces · ${
    resultados.length - muertos.length - bloqueados.length
  } vivos · ` +
    `${bloqueados.length} no comprobables desde aquí · ${muertos.length} muertos`,
);
if (bloqueados.length > 0) {
  console.log(
    "los marcados con ~ los bloquea el entorno, no el sitio: NO cuentan como rojo. Compruébalos a mano si dudas.",
  );
}

Deno.exit(muertos.length > 0 ? 1 : 0);

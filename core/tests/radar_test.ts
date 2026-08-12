import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.0";
import { puntosDeEje, radar, scoreEje } from "../src/radar.ts";
import type { Grafo } from "../src/tipos.ts";

const grafo: Grafo = {
  branches: [
    {
      id: "fundamentos",
      name: "Fundamentos",
      isSpecialization: false,
      axis: "fundamentos",
      target: 12,
    },
    {
      id: "ingenieria_sw",
      name: "Ingeniería de software",
      isSpecialization: false,
      axis: "ingenieria_sw",
      target: 20,
    },
  ],
  nodes: [
    {
      id: "f0-entorno",
      title: "El entorno",
      summary: "…",
      type: "concept",
      branch: "fundamentos",
      difficulty: 1,
      estMinutes: 15,
      micro: "Abrir Colab.",
      prerequisites: [],
      competencies: { fundamentos: 1 },
      resources: [],
    },
    {
      id: "f0-portfolio",
      title: "El repositorio",
      summary: "…",
      type: "concept",
      branch: "fundamentos",
      difficulty: 1,
      estMinutes: 30,
      micro: "Crear el repo.",
      prerequisites: [],
      competencies: { fundamentos: 1, ingenieria_sw: 1 },
      resources: [],
    },
  ],
};

Deno.test("scoreEje redondea y tapa en 100", () => {
  assertEquals(scoreEje(11, 12), 92);
  assertEquals(scoreEje(0, 12), 0);
  // Las ramas de especialización suman al mismo eje: pasarse del objetivo es esperable, no un error.
  assertEquals(scoreEje(30, 20), 100);
});

Deno.test("un eje sin objetivo declarado grita en vez de inventarse un número", () => {
  assertThrows(() => scoreEje(3, 0), Error, "target debe ser > 0");
});

Deno.test("sólo cuentan los nodos completados, y un nodo puede alimentar varios ejes", () => {
  const completados = new Set(["f0-portfolio"]);
  assertEquals(puntosDeEje(grafo, "fundamentos", completados), 1);
  assertEquals(puntosDeEje(grafo, "ingenieria_sw", completados), 1);
  assertEquals(puntosDeEje(grafo, "ml", completados), 0);
});

Deno.test("añadir nodos al grafo NO baja el radar de nadie", () => {
  // Es la propiedad que justifica el `target` declarado (contrato §5.1): el fallo que sólo se ve
  // el día que se siembra una fase nueva.
  const completados = new Set(["f0-entorno", "f0-portfolio"]);
  const antes = radar(grafo, completados);

  const conFaseNueva: Grafo = {
    branches: grafo.branches,
    nodes: [
      ...grafo.nodes,
      {
        id: "f1-algebra",
        title: "Álgebra lineal",
        summary: "…",
        type: "concept",
        branch: "fundamentos",
        difficulty: 2,
        estMinutes: 60,
        micro: "Un vídeo.",
        prerequisites: [],
        competencies: { fundamentos: 5 },
        resources: [],
      },
    ],
  };
  const despues = radar(conFaseNueva, completados);

  for (const fila of antes) {
    const posterior = despues.find((d) => d.rama.axis === fila.rama.axis);
    assertEquals(posterior !== undefined, true, `desapareció el eje ${fila.rama.axis}`);
    assertEquals(posterior!.score >= fila.score, true, `bajó el eje ${fila.rama.axis}`);
  }
});

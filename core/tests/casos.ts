/**
 * Casos de prueba del núcleo, **agnósticos del runner**.
 *
 * Existen así por el criterio V3: el núcleo tiene que dar lo mismo en sus dos adaptadores, y la única
 * forma honesta de probarlo es **ejecutar las mismas aserciones en los dos runtimes** — Deno
 * (`core/tests/grafo_test.ts`) y el navegador vía Vitest (`webapp/tests/nucleo-portable.test.ts`).
 * Dos suites escritas por separado probarían dos cosas parecidas, que no es lo mismo.
 *
 * Por eso aquí no se importa `jsr:@std/assert` ni `vitest`: sólo TypeScript y un par de aserciones
 * propias. Cada caso lanza si falla.
 */
import type { Grafo, Nodo } from "../src/tipos.ts";
import {
  ciclos,
  desbloqueaA,
  estadoDe,
  inalcanzables,
  type Problema,
  validar,
} from "../src/grafo.ts";
import { radar, scoreEje } from "../src/radar.ts";

// --- Aserciones mínimas -------------------------------------------------------------------------

export function afirmar(condicion: boolean, mensaje: string): void {
  if (!condicion) throw new Error(`aserción fallida: ${mensaje}`);
}

export function igual<T>(real: T, esperado: T, mensaje: string): void {
  if (real !== esperado) {
    throw new Error(`${mensaje}: esperaba ${String(esperado)}, hubo ${String(real)}`);
  }
}

/** Comprueba que la validación reporta esa regla, y **sólo** informa de las que hay. */
function tieneRegla(problemas: Problema[], regla: number, contexto: string): Problema {
  const encontradas = problemas.map((p) => p.regla).sort((a, b) => a - b);
  const hallado = problemas.find((p) => p.regla === regla);
  afirmar(
    hallado !== undefined,
    `${contexto}: esperaba un problema de la regla ${regla}; hubo [${encontradas.join(", ")}]`,
  );
  return hallado as Problema;
}

/**
 * Busca un nodo por id en vez de indexar por posición.
 *
 * No es manía: `webapp/tsconfig.json` lleva `noUncheckedIndexedAccess`, así que `g.nodes[0]` es
 * `Nodo | undefined` en ese adaptador aunque en Deno no lo fuera. Alinear las dos severidades (ver
 * `deno.json`) destapó que la fixtura indexaba a ciegas. Buscar por id, además, aguanta que la
 * fixtura crezca.
 */
function nodoDe(g: Grafo, id: string): Nodo {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`la fixtura no tiene el nodo "${id}"`);
  return n;
}

// --- Fixtura ------------------------------------------------------------------------------------

/** Fecha fija: la caducidad de cuadernos se mide contra ella y así los tests no caducan solos. */
export const AHORA = new Date("2026-08-12T00:00:00Z");

function nodo(parcial: Partial<Nodo> & Pick<Nodo, "id">): Nodo {
  return {
    title: "Título",
    summary: "Resumen",
    type: "concept",
    branch: "fundamentos",
    difficulty: 1,
    estMinutes: 15,
    micro: "Algo de quince minutos.",
    prerequisites: [],
    competencies: { fundamentos: 1 },
    resources: [],
    ...parcial,
  };
}

/** Un grafo pequeño y VÁLIDO. Cada caso lo rompe de una forma concreta. */
export function grafoValido(): Grafo {
  return {
    branches: [
      {
        id: "fundamentos",
        name: "Fundamentos",
        isSpecialization: false,
        axis: "fundamentos",
        target: 10,
      },
    ],
    nodes: [
      nodo({ id: "a" }),
      nodo({ id: "b", prerequisites: ["a"] }),
      nodo({
        id: "c",
        type: "project",
        prerequisites: ["b"],
        estMinutes: 30,
        rubric: [{ id: "corre", criterion: "Corre entero.", howToCheck: "Restart and run all." }],
        resources: [
          {
            id: "r1",
            url: "https://example.org",
            format: "doc",
            lang: "es",
            minutes: 15,
            why: "Porque sí.",
          },
        ],
      }),
    ],
  };
}

// --- Los casos ----------------------------------------------------------------------------------

export interface Caso {
  nombre: string;
  ejecutar(): void;
}

export const casos: Caso[] = [
  {
    nombre: "un grafo válido no da ni un problema",
    ejecutar() {
      igual(validar(grafoValido(), AHORA).length, 0, "el grafo de la fixtura debería estar limpio");
    },
  },

  // --- Una regla, un caso, un grafo roto a propósito ----------------------------------------------
  {
    nombre: "regla 1 · detecta el ciclo y nombra a los implicados",
    ejecutar() {
      const g = grafoValido();
      nodoDe(g, "a").prerequisites = ["c"]; // a → c → b → a
      const problemas = validar(g, AHORA);
      tieneRegla(problemas, 1, "ciclo a→c→b→a");
      afirmar(ciclos(g).length > 0, "ciclos() debería encontrarlo");
      const texto = tieneRegla(problemas, 1, "ciclo").mensaje;
      for (const id of ["a", "b", "c"]) {
        afirmar(texto.includes(id), `el mensaje del ciclo debería nombrar a "${id}": ${texto}`);
      }
    },
  },
  {
    nombre: "regla 2 · prerequisito huérfano",
    ejecutar() {
      const g = grafoValido();
      nodoDe(g, "b").prerequisites = ["no-existe"];
      tieneRegla(validar(g, AHORA), 2, "prerequisito inexistente");
    },
  },
  {
    nombre: "regla 3 · ids duplicados",
    ejecutar() {
      const g = grafoValido();
      nodoDe(g, "b").id = "a";
      tieneRegla(validar(g, AHORA), 3, "id repetido");
    },
  },
  {
    nombre: "regla 5 · nodo inalcanzable",
    ejecutar() {
      const g = grafoValido();
      // Dos nodos que se necesitan mutuamente PERO sin ciclo con el resto: quedan sin raíz.
      g.nodes.push(
        nodo({ id: "x", prerequisites: ["y"] }),
        nodo({ id: "y", prerequisites: ["x"] }),
      );
      const problemas = validar(g, AHORA);
      // Es un ciclo, así que la regla 1 habla y la 5 se calla para no duplicar el diagnóstico.
      tieneRegla(problemas, 1, "x↔y es un ciclo");
      afirmar(
        !problemas.some((p) => p.regla === 5),
        "con un ciclo presente, la regla 5 no debe añadir ruido",
      );
      // Sin ciclo pero colgando de un prerequisito que no existe: ahí sí es inalcanzable de verdad.
      const g2 = grafoValido();
      g2.nodes.push(nodo({ id: "z", prerequisites: ["fantasma"] }));
      afirmar(inalcanzables(g2).includes("z"), "z no cuelga de ninguna raíz");
    },
  },
  {
    nombre: "regla 6 · nodo-proyecto sin rúbrica",
    ejecutar() {
      const g = grafoValido();
      nodoDe(g, "c").rubric = [];
      tieneRegla(validar(g, AHORA), 6, "project sin rúbrica");
    },
  },
  {
    nombre: "regla 7 · criterio sin howToCheck",
    ejecutar() {
      const g = grafoValido();
      nodoDe(g, "c").rubric = [{ id: "vago", criterion: "Está limpio.", howToCheck: "" }];
      tieneRegla(validar(g, AHORA), 7, "criterio no comprobable");
    },
  },
  {
    nombre: "regla 8 · recurso sin el porqué",
    ejecutar() {
      const g = grafoValido();
      const recurso = nodoDe(g, "c").resources[0];
      if (!recurso) throw new Error("la fixtura perdió el recurso de c");
      recurso.why = "  ";
      tieneRegla(validar(g, AHORA), 8, "recurso sin why");
    },
  },
  {
    nombre: "regla 10 · estMinutes que no es múltiplo de 15",
    ejecutar() {
      const g = grafoValido();
      nodoDe(g, "a").estMinutes = 20;
      tieneRegla(validar(g, AHORA), 10, "20 no es múltiplo de 15");
      const g2 = grafoValido();
      nodoDe(g2, "a").estMinutes = 0;
      tieneRegla(validar(g2, AHORA), 10, "cero minutos");
    },
  },
  {
    nombre: "regla 11 · nodo sin micro",
    ejecutar() {
      const g = grafoValido();
      nodoDe(g, "a").micro = "";
      tieneRegla(validar(g, AHORA), 11, "sin micro");
    },
  },
  {
    nombre: "regla 12 · cuaderno incompleto",
    ejecutar() {
      const g = grafoValido();
      nodoDe(g, "a").notebook = {
        url: "https://x",
        account: "",
        artifacts: ["mind_map"],
        checkedAt: "2026-08-01",
      };
      tieneRegla(validar(g, AHORA), 12, "notebook sin account");
      const g2 = grafoValido();
      nodoDe(g2, "a").notebook = {
        url: "https://x",
        account: "ed",
        artifacts: [],
        checkedAt: "2026-08-01",
      };
      tieneRegla(validar(g2, AHORA), 12, "notebook sin artefactos");
    },
  },
  {
    nombre: "regla 13 · cuaderno caducado, y el del límite no lo está",
    ejecutar() {
      const g = grafoValido();
      nodoDe(g, "a").notebook = {
        url: "https://x",
        account: "ed",
        artifacts: ["mind_map"],
        checkedAt: "2026-01-01", // muy anterior a AHORA
      };
      tieneRegla(validar(g, AHORA), 13, "cuaderno de hace más de 90 días");

      // Justo en el límite (90 días) todavía vale: la frontera se prueba, no se supone.
      const g2 = grafoValido();
      const limite = new Date(AHORA.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
      nodoDe(g2, "a").notebook = {
        url: "https://x",
        account: "ed",
        artifacts: ["mind_map"],
        checkedAt: limite,
      };
      afirmar(
        !validar(g2, AHORA).some((p) => p.regla === 13),
        `un cuaderno comprobado hace exactamente 90 días (${limite}) no debe estar caducado`,
      );
    },
  },
  {
    nombre: "regla 14 · eje puntuado sin rama que declare su target",
    ejecutar() {
      const g = grafoValido();
      nodoDe(g, "a").competencies = { fundamentos: 1, mlops: 3 };
      tieneRegla(validar(g, AHORA), 14, "mlops sin rama");
      const g2 = grafoValido();
      const rama = g2.branches.find((b) => b.id === "fundamentos");
      if (!rama) throw new Error("la fixtura perdió la rama fundamentos");
      rama.target = 0;
      tieneRegla(validar(g2, AHORA), 14, "target cero");
    },
  },

  // --- Derivaciones -------------------------------------------------------------------------------
  {
    nombre: "el estado se deriva: locked hasta que caen los prerequisitos",
    ejecutar() {
      const g = grafoValido();
      let e = estadoDe(g, new Set());
      igual(e.get("a"), "available", "a no tiene prerequisitos");
      igual(e.get("b"), "locked", "b depende de a");
      igual(e.get("c"), "locked", "c depende de b");

      e = estadoDe(g, new Set(["a"]));
      igual(e.get("a"), "done", "a completado");
      igual(e.get("b"), "available", "b se desbloquea al caer a");
      igual(e.get("c"), "locked", "c sigue esperando a b");

      e = estadoDe(g, new Set(["a", "b"]), new Set(["c"]));
      igual(e.get("c"), "in_progress", "c empezado");
    },
  },
  {
    nombre: "lo que un nodo desbloquea se deriva de las aristas, no se declara",
    ejecutar() {
      const g = grafoValido();
      igual(desbloqueaA(g, "a").join(","), "b", "a desbloquea b");
      igual(desbloqueaA(g, "c").length, 0, "c es hoja");
    },
  },

  // --- Radar (V4) ---------------------------------------------------------------------------------
  {
    nombre: "el radar tapa en 100 y añadir nodos no baja el de nadie",
    ejecutar() {
      igual(scoreEje(11, 12), 92, "11/12");
      igual(scoreEje(30, 20), 100, "se tapa en 100");

      const g = grafoValido();
      const completados = new Set(["a", "b"]);
      const antes = radar(g, completados);
      g.nodes.push(nodo({ id: "nuevo", competencies: { fundamentos: 5 } }));
      const despues = radar(g, completados);
      for (const fila of antes) {
        const posterior = despues.find((d) => d.rama.axis === fila.rama.axis);
        if (!posterior) throw new Error(`desapareció el eje ${fila.rama.axis}`);
        afirmar(
          posterior.score >= fila.score,
          `sembrar un nodo bajó el eje ${fila.rama.axis}: ${fila.score} → ${posterior.score}`,
        );
      }
    },
  },
];

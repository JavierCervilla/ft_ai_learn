/**
 * Los tipos del grafo de aprendizaje.
 *
 * Trazan campo a campo a `contrato_grafo_aprendizaje.md` §2-§3 del vault, que es la SoT del formato.
 * Viven aquí —y no en el servidor ni en la webapp— porque servidor y navegador son **dos adaptadores
 * del mismo núcleo**: transcribir estos tipos en un segundo sitio los ensancharía (las uniones acaban
 * en `string`) y el compilador dejaría de mirar justo donde más falta hace.
 */

/** Un nodo es un concepto que se estudia o un proyecto que se entrega y se aprueba. */
export type TipoNodo = "concept" | "project";

/** Los siete ejes del radar de competencias (contrato §5). */
export type Eje =
  | "fundamentos"
  | "matematicas"
  | "ml"
  | "dl"
  | "llms"
  | "mlops"
  | "ingenieria_sw";

export type FormatoRecurso =
  | "video"
  | "book"
  | "course"
  | "doc"
  | "paper"
  | "interactive";

/** Estado de un nodo **para un usuario**. `available` se DERIVA, nunca se guarda (contrato §6). */
export type EstadoNodo = "locked" | "available" | "in_progress" | "done";

export interface Recurso {
  id: string;
  url: string;
  format: FormatoRecurso;
  /** ISO 639-1. */
  lang: string;
  minutes: number;
  /** Por qué ESTE recurso y no otro. Obligatorio: sin razón escrita es un enlace acumulado. */
  why: string;
}

export interface CriterioRubrica {
  id: string;
  criterion: string;
  /** Tiene que poder ejecutarlo otra persona sin juicio propio (contrato §2.2). */
  howToCheck: string;
}

/** Cuaderno público del nodo. Opcional: un nodo sin cuaderno es un nodo válido y útil. */
export interface Cuaderno {
  url: string;
  /** Qué cuenta lo publica. Cuál es esa cuenta NO se escribe en el repo. */
  account: string;
  artifacts: string[];
  /** Última comprobación de que el enlace abre. Caduca a los 90 días (contrato §4.5). */
  checkedAt: string;
}

export interface Rama {
  id: string;
  name: string;
  isSpecialization: boolean;
  axis: Eje;
  /**
   * Puntos para dar el eje por cubierto. Es un objetivo DECLARADO, no la suma de los nodos que
   * existan: con denominador dinámico, sembrar una fase nueva le desplomaría el radar a quien no ha
   * estudiado menos (contrato §5.1).
   */
  target: number;
}

export interface Nodo {
  id: string;
  title: string;
  summary: string;
  type: TipoNodo;
  branch: string;
  difficulty: number;
  /** Múltiplo de 15: la unidad del producto es la sentada de quince minutos. */
  estMinutes: number;
  /** Qué haces en UNA sentada. Obligatorio en todo nodo. */
  micro: string;
  extended?: string;
  /**
   * La arista se declara UNA sola vez y en esta dirección. No existe `unlocks`: dos listas que
   * describen la misma arista divergen en silencio en cuanto alguien edita una.
   */
  prerequisites: string[];
  competencies: Partial<Record<Eje, number>>;
  resources: Recurso[];
  rubric?: CriterioRubrica[];
  notebook?: Cuaderno;
  /** Nodo-título de una fase aún sin sembrar: se tolera sin recursos ni rúbrica. */
  stub?: boolean;
  /** Un nodo que deja de valer se marca; nunca se borra ni se recicla su `id`. */
  deprecated?: boolean;
}

export interface Grafo {
  branches: Rama[];
  nodes: Nodo[];
}

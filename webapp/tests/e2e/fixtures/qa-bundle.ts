import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// =============================================================================
// Fixture `qa` — FAILURE BUNDLE determinista y local (skill `qa-staging`).
//
// Cuando un test falla, deja en disco UN bundle autoconsistente con todo lo que hace falta para
// diagnosticar sin volver a correr nada: qué se hizo (en orden), la captura, el DOM, los errores de
// consola, las peticiones caídas y el error del assert. **Todos los artefactos comparten un mismo
// `snapshotId`**, así que es imposible mezclar el paso fallido de un run con el DOM de otro — que es
// justo el fallo silencioso que hace inútil una carpeta de capturas sueltas.
//
// SIN CLOUD: nada sale del entorno. El veredicto es un artefacto repetible en CI, no una caja negra
// (ver `doctrina_guardian.md` §Principio rector). Es la respuesta del framework al hueco que nombra
// TestSprite, sin pagar el precio de mandarle el código y el DOM a un tercero.
//
// USO en un spec:
//   import { test, expect } from "../fixtures/qa-bundle";
//   test("...", async ({ page, qa }) => { qa.step("abrir la lista"); await page.goto("/"); });
//
// El fixture es `auto: true`: un test que NO nombre `qa` produce bundle igualmente al fallar. El
// coste es que depende de `page`, así que fuerza un navegador incluso en un test que no lo use — en
// una suite de UI eso ya se paga siempre; si añades tests de API pura, muévelos a otro project.
//
// ENV:
//   QA_BUNDLE_DIR  raíz donde escribir los bundles (default `qa-bundles/`, relativo al cwd).
//   QA_RUN_ID      id del run; si no se da, se deriva del arranque del proceso.
// =============================================================================

const BUNDLE_ROOT = process.env.QA_BUNDLE_DIR || "qa-bundles";
const RUN_ID = process.env.QA_RUN_ID || `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;

// Tope de eventos por bundle: una página con un bucle de errores de consola puede emitir miles y el
// bundle dejaría de ser legible (y de caber en un comentario de PR). Se conservan los PRIMEROS: el
// origen de un fallo en cascada está al principio, no al final.
const MAX_EVENTS = 500;

export type QaEventKind = "step" | "navigation" | "console" | "pageerror" | "requestfailed" | "httperror";

export type QaEvent = {
  /** ms desde el arranque del test (no epoch: lo que importa es el orden y el hueco entre pasos). */
  at: number;
  kind: QaEventKind;
  text: string;
  detail?: string;
};

export type QaBundle = {
  snapshotId: string;
  runId: string;
  test: { title: string; file: string; line: number; retry: number; project: string };
  status: string;
  expectedStatus: string;
  durationMs: number;
  urlAtFailure?: string;
  error?: { message: string; stack?: string };
  events: QaEvent[];
  eventsTruncated: boolean;
  /** nombre lógico → fichero dentro del directorio del bundle. */
  artifacts: Record<string, string>;
  /** Qué NO se pudo capturar y por qué (la página pudo cerrarse o crashear). */
  captureErrors: string[];
};

function shortHash(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Playwright colorea el mensaje del assert con secuencias ANSI. En una terminal se ven bien; dentro
// de un .md (o de un comentario de PR) quedan como basura `[2m[31m` que estorba justo donde hay que
// leer con atención. Se construye con fromCharCode para no meter un carácter de control literal.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/** Escapa `|` y saltos de línea para que una celda no rompa la tabla del digest. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ⏎ ");
}

/**
 * Graba la narrativa del test (pasos declarados + lo que la página fue contando por su cuenta) y,
 * si el test falla, escribe el bundle. Un único `snapshotId` sella todos los artefactos.
 */
export class QaRecorder {
  private readonly events: QaEvent[] = [];
  private readonly t0 = Date.now();
  private truncated = false;

  constructor(private readonly page: Page) {
    page.on("console", (msg) => {
      const type = msg.type();
      if (type !== "error" && type !== "warning") return;
      this.push("console", `[${type}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => this.push("pageerror", err.message, err.stack));
    page.on("requestfailed", (req) =>
      this.push("requestfailed", `${req.method()} ${req.url()}`, req.failure()?.errorText),
    );
    page.on("response", (res) => {
      if (res.status() < 400) return;
      this.push("httperror", `HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
    });
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      this.push("navigation", frame.url());
    });
  }

  /** Declara un paso de la narrativa. Es lo que convierte un stack trace en un relato legible. */
  step(text: string): void {
    this.push("step", text);
  }

  private push(kind: QaEventKind, text: string, detail?: string): void {
    if (this.events.length >= MAX_EVENTS) {
      this.truncated = true;
      return;
    }
    this.events.push({ at: Date.now() - this.t0, kind, text, ...(detail ? { detail } : {}) });
  }

  /** Escribe el bundle. Devuelve el directorio, o null si no se pudo escribir nada. */
  async write(testInfo: TestInfo): Promise<string | null> {
    const snapshotId = shortHash(`${RUN_ID}|${testInfo.titlePath.join(" > ")}|${testInfo.retry}`);
    const dir = path.resolve(BUNDLE_ROOT, snapshotId);
    const captureErrors: string[] = [];
    const artifacts: Record<string, string> = {};

    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      // Sin directorio no hay bundle. Fail-open: el test ya falló, no lo tapamos con un error nuestro.
      console.error(`qa-bundle: no se pudo crear ${dir}: ${messageOf(err)}`);
      return null;
    }

    // La captura y el DOM se piden ANTES de que Playwright cierre la página (estamos en el teardown
    // del fixture, que corre con la página todavía viva). Si la página crasheó, se anota el motivo
    // en vez de propagar: un bundle incompleto sigue siendo mejor que ninguno.
    try {
      await this.page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true });
      artifacts.screenshot = "screenshot.png";
    } catch (err) {
      captureErrors.push(`screenshot: ${messageOf(err)}`);
    }

    try {
      fs.writeFileSync(path.join(dir, "dom.html"), await this.page.content(), "utf8");
      artifacts.dom = "dom.html";
    } catch (err) {
      captureErrors.push(`dom: ${messageOf(err)}`);
    }

    let urlAtFailure: string | undefined;
    try {
      urlAtFailure = this.page.url();
    } catch (err) {
      captureErrors.push(`url: ${messageOf(err)}`);
    }

    fs.writeFileSync(
      path.join(dir, "events.jsonl"),
      this.events.map((e) => JSON.stringify(e)).join("\n") + (this.events.length ? "\n" : ""),
      "utf8",
    );
    artifacts.events = "events.jsonl";

    const bundle: QaBundle = {
      snapshotId,
      runId: RUN_ID,
      test: {
        title: testInfo.titlePath.join(" > "),
        file: testInfo.file,
        line: testInfo.line,
        retry: testInfo.retry,
        project: testInfo.project.name,
      },
      status: testInfo.status ?? "unknown",
      expectedStatus: testInfo.expectedStatus,
      durationMs: testInfo.duration,
      ...(urlAtFailure ? { urlAtFailure } : {}),
      ...(testInfo.error
        ? {
            error: {
              message: stripAnsi(testInfo.error.message ?? "(sin mensaje)"),
              ...(testInfo.error.stack ? { stack: stripAnsi(testInfo.error.stack) } : {}),
            },
          }
        : {}),
      events: this.events,
      eventsTruncated: this.truncated,
      artifacts,
      captureErrors,
    };

    fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify(bundle, null, 2), "utf8");
    artifacts.bundle = "bundle.json";
    fs.writeFileSync(path.join(dir, "FAILURE.md"), renderDigest(bundle), "utf8");

    // Adjuntar al reporte de Playwright: el bundle viaja también en el HTML report del CI.
    try {
      await testInfo.attach(`qa-bundle-${snapshotId}`, {
        path: path.join(dir, "bundle.json"),
        contentType: "application/json",
      });
    } catch (err) {
      captureErrors.push(`attach: ${messageOf(err)}`);
    }

    console.log(`qa-bundle: fallo sellado como ${snapshotId} → ${dir}/FAILURE.md`);
    return dir;
  }
}

/** El digest que lee un humano (o un agente) sin abrir cinco ficheros. */
export function renderDigest(b: QaBundle): string {
  const lines: string[] = [];
  lines.push(`# Fallo de recorrido — ${b.test.title}`);
  lines.push("");
  lines.push(`- **snapshotId:** \`${b.snapshotId}\` — lo comparten TODOS los artefactos de este bundle.`);
  lines.push(`- **runId:** \`${b.runId}\``);
  lines.push(`- **Test:** \`${b.test.file}:${b.test.line}\` (project \`${b.test.project}\`, intento ${b.test.retry})`);
  lines.push(`- **Estado:** ${b.status} (se esperaba ${b.expectedStatus}) en ${b.durationMs} ms`);
  if (b.urlAtFailure) lines.push(`- **URL al fallar:** ${b.urlAtFailure}`);
  lines.push("");

  lines.push("## Qué se hizo, en orden");
  lines.push("");
  if (b.events.length === 0) {
    lines.push("_Sin eventos registrados._");
  } else {
    lines.push("| t (ms) | tipo | qué |");
    lines.push("|-------:|------|-----|");
    for (const e of b.events) {
      const detail = e.detail ? ` — ${cell(e.detail)}` : "";
      lines.push(`| ${e.at} | ${e.kind} | ${cell(e.text)}${detail} |`);
    }
    if (b.eventsTruncated) {
      lines.push("");
      lines.push(`> Truncado: se conservan los primeros ${b.events.length} eventos (los del origen del fallo).`);
    }
  }
  lines.push("");

  lines.push("## El error");
  lines.push("");
  if (b.error) {
    lines.push("```");
    lines.push(b.error.stack || b.error.message);
    lines.push("```");
  } else {
    lines.push("_El test falló sin error asociado (timeout del runner o proceso caído)._");
  }
  lines.push("");

  lines.push("## Artefactos");
  lines.push("");
  for (const [name, file] of Object.entries(b.artifacts)) {
    lines.push(`- **${name}** → \`${file}\``);
  }
  if (b.captureErrors.length > 0) {
    lines.push("");
    lines.push("**No se pudo capturar:**");
    for (const err of b.captureErrors) lines.push(`- ${err}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * `test` extendido con el fixture `qa`. Importa de aquí (no de `@playwright/test`) en los specs que
 * quieras que dejen bundle al fallar.
 */
export const test = base.extend<{ qa: QaRecorder }>({
  qa: [
    async ({ page }, use, testInfo) => {
      const recorder = new QaRecorder(page);
      await use(recorder);
      if (testInfo.status !== testInfo.expectedStatus) {
        await recorder.write(testInfo);
      }
    },
    { auto: true },
  ],
});

export { expect };

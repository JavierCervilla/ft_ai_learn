/**
 * Sonda de reglas — los criterios **D3 a D6** contra un servidor de verdad.
 *
 * Separada de `sonda-autorizacion.ts` a propósito: aquella comprueba que nadie alcanza lo ajeno y es
 * la que audita el rol `seguridad`; ésta comprueba que las reglas del producto se cumplen —el cupo,
 * el consumo único, la idempotencia, el desbloqueo—. Mezclarlas haría que un fallo de negocio
 * pareciera un fallo de seguridad y al revés.
 *
 *   deno run -A tools/sonda-reglas.ts [http://localhost:8000]
 */

const BASE = Deno.args[0] ?? "http://localhost:8000";
const CLAVE = "contraseña-de-prueba-muy-larga";

let fallos = 0;
let comprobaciones = 0;

function comprobar(condicion: boolean, descripcion: string, detalle = ""): void {
  comprobaciones++;
  if (condicion) console.log(`  ok   ${descripcion}`);
  else {
    fallos++;
    console.error(`  FALLO ${descripcion}${detalle ? ` — ${detalle}` : ""}`);
  }
}

function cookieDe(r: Response): string {
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function registrar(codigo: string, email: string): Promise<Response> {
  return await fetch(`${BASE}/api/registro`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email, password: CLAVE, name: email, inviteCode: codigo }),
  });
}

const conSesion = (cookie: string, ruta: string, init: RequestInit = {}) =>
  fetch(`${BASE}${ruta}`, {
    ...init,
    headers: { "content-type": "application/json", origin: BASE, cookie, ...init.headers },
  });

const codigoBootstrap = Deno.env.get("CODIGO_BOOTSTRAP");
if (!codigoBootstrap) {
  console.error("falta CODIGO_BOOTSTRAP (sale de `deno task invitar:bootstrap`)");
  Deno.exit(2);
}

console.log(`sonda de reglas contra ${BASE}`);
const sello = crypto.randomUUID().slice(0, 8);

const alta = await registrar(codigoBootstrap, `r-${sello}@ejemplo.test`);
if (!alta.ok) {
  console.error(`no se pudo registrar al primero: ${alta.status} ${await alta.text()}`);
  Deno.exit(1);
}
const cookie = cookieDe(alta);

// --- D3: un código se consume UNA vez, aunque lleguen dos a la vez ------------------------------

console.log("\nD3 · consumo único del código:");
const paraCarrera = await (await conSesion(cookie, "/api/invitations", { method: "POST" }))
  .json() as { code: string };

// A la vez de verdad: las dos peticiones salen antes de que ninguna termine. Es donde se rompe un
// «comprobar y luego escribir», que aquí no existe porque el consumo es un UPDATE condicional.
const carrera = await Promise.all([
  registrar(paraCarrera.code, `c1-${sello}@ejemplo.test`),
  registrar(paraCarrera.code, `c2-${sello}@ejemplo.test`),
]);
const exitos = carrera.filter((r) => r.ok).length;
await Promise.all(carrera.map((r) => r.body?.cancel()));
comprobar(
  exitos === 1,
  "dos altas simultáneas con el mismo código: entra exactamente una",
  `entraron ${exitos}`,
);

// --- D4: el cupo se respeta y se devuelve --------------------------------------------------------

console.log("\nD4 · cupo de invitaciones:");
const estado = await (await conSesion(cookie, "/api/invitations")).json() as { cupo: number };
const emitidas: string[] = [];
let agotado = 0;
for (let i = 0; i < estado.cupo + 2; i++) {
  const r = await conSesion(cookie, "/api/invitations", { method: "POST" });
  if (r.ok) emitidas.push(((await r.json()) as { code: string }).code);
  else {
    agotado = r.status;
    await r.body?.cancel();
  }
}
comprobar(agotado === 409, "al agotar el cupo, emitir responde 409", `hubo ${agotado}`);
comprobar(
  emitidas.length === estado.cupo,
  `se emitieron exactamente las ${estado.cupo} que quedaban`,
  `fueron ${emitidas.length}`,
);

const aRevocar = emitidas[0];
if (aRevocar) {
  await conSesion(cookie, `/api/invitations/${aRevocar}`, { method: "DELETE" });
  const tras = await (await conSesion(cookie, "/api/invitations")).json() as { cupo: number };
  comprobar(
    tras.cupo === 1,
    "revocar una invitación sin usar devuelve el cupo",
    `cupo=${tras.cupo}`,
  );

  const otraVez = await conSesion(cookie, `/api/invitations/${aRevocar}`, { method: "DELETE" });
  await otraVez.body?.cancel();
  comprobar(
    otraVez.status === 404,
    "revocar dos veces no duplica el cupo",
    `HTTP ${otraVez.status}`,
  );
}

// --- D6: no se puede marcar `done` saltándose prerequisitos --------------------------------------

console.log("\nD6 · el desbloqueo lo manda el servidor:");
// `f0-hola-datos` cuelga de tres nodos; recién registrado no hay ninguno hecho.
const bloqueado = await conSesion(cookie, "/api/progress/f0-hola-datos", {
  method: "PUT",
  body: JSON.stringify({ state: "done" }),
});
await bloqueado.body?.cancel();
comprobar(
  bloqueado.status === 409,
  "marcar un nodo bloqueado se rechaza",
  `HTTP ${bloqueado.status}`,
);

const inventado = await conSesion(cookie, "/api/progress/no-existe-este-nodo", {
  method: "PUT",
  body: JSON.stringify({ state: "done" }),
});
await inventado.body?.cancel();
comprobar(
  inventado.status === 404,
  "marcar un nodo inexistente es 404",
  `HTTP ${inventado.status}`,
);

// --- D5: marcar es idempotente -------------------------------------------------------------------

console.log("\nD5 · idempotencia de la marca:");
const primera = await (await conSesion(cookie, "/api/progress/f0-entorno", {
  method: "PUT",
  body: JSON.stringify({ state: "done" }),
})).json() as { doneAt: string; startedAt: string };

for (let i = 0; i < 3; i++) {
  await (await conSesion(cookie, "/api/progress/f0-entorno", {
    method: "PUT",
    body: JSON.stringify({ state: "done" }),
  })).body?.cancel();
}
const vista = await (await conSesion(cookie, "/api/progress")).json() as {
  progreso: { nodeId: string; doneAt: string; startedAt: string }[];
};
const filas = vista.progreso.filter((f) => f.nodeId === "f0-entorno");
comprobar(filas.length === 1, "reenviar la misma marca no duplica filas", `hay ${filas.length}`);
comprobar(
  filas[0]?.doneAt === primera.doneAt && filas[0]?.startedAt === primera.startedAt,
  "reenviarla no pisa las fechas: cuándo se hizo algo es un hecho histórico",
  `antes ${primera.doneAt} / ahora ${filas[0]?.doneAt}`,
);

// Y con el prerequisito hecho, lo que estaba bloqueado se abre — el desbloqueo se deriva de verdad.
const derivado = await (await conSesion(cookie, "/api/progress")).json() as {
  estados: Record<string, string>;
};
comprobar(
  derivado.estados["f0-python"] === "available",
  "hecho el prerequisito, el siguiente pasa a `available` (derivado, no guardado)",
  `f0-python está ${derivado.estados["f0-python"]}`,
);

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones en verde`);
if (fallos > 0) {
  console.error(`${fallos} fallo(s) de reglas`);
  Deno.exit(1);
}

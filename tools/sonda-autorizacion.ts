/**
 * Sonda de autorización — el gate del criterio **V7**.
 *
 * Corre contra un servidor **de verdad** con una base migrada y el contenido cargado, crea dos
 * personas y comprueba que ninguna alcanza lo de la otra. No usa mocks a propósito: lo que se está
 * probando es la composición —sesión, router, consultas— y un mock de la sesión probaría el mock.
 *
 * La forma de atacar importa. No basta con «B no ve los datos de A» por la ruta normal: se intenta
 * **colar el `userId` de A** por query y por cuerpo, que es como se rompen de verdad estas APIs
 * cuando alguien añade un endpoint que acepta identidad de fuera. Si un día alguien introduce ese
 * parámetro, esta sonda se pone roja aunque el resto de la suite siga verde.
 *
 *   deno run -A tools/sonda-autorizacion.ts [http://localhost:8000]
 */

const BASE = Deno.args[0] ?? "http://localhost:8000";

let fallos = 0;
let comprobaciones = 0;

function comprobar(condicion: boolean, descripcion: string, detalle = ""): void {
  comprobaciones++;
  if (condicion) {
    console.log(`  ok   ${descripcion}`);
  } else {
    fallos++;
    console.error(`  FALLO ${descripcion}${detalle ? ` — ${detalle}` : ""}`);
  }
}

interface Persona {
  email: string;
  cookie: string;
  /** Las `Set-Cookie` enteras, con sus atributos: hacen falta para auditar `SameSite`/`HttpOnly`. */
  cookiesCrudas: string[];
  id: string;
}

/** Extrae la cookie de sesión de una respuesta, lista para reenviar. */
function cookieDe(respuesta: Response): string {
  return respuesta.headers.getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function registrar(codigo: string, email: string): Promise<Persona> {
  const respuesta = await fetch(`${BASE}/api/registro`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      password: "contraseña-de-prueba-muy-larga",
      name: email,
      inviteCode: codigo,
    }),
  });
  if (!respuesta.ok) {
    throw new Error(
      `no se pudo registrar a ${email}: ${respuesta.status} ${await respuesta.text()}`,
    );
  }
  const cuerpo = await respuesta.json() as { user?: { id?: string } };
  return {
    email,
    cookie: cookieDe(respuesta),
    cookiesCrudas: respuesta.headers.getSetCookie(),
    id: cuerpo.user?.id ?? "",
  };
}

async function comoPersona(
  persona: Persona,
  ruta: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetch(`${BASE}${ruta}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie: persona.cookie,
      // Un navegador manda `Origin` en toda petición que cambia estado; este `fetch` de servidor no
      // lo haría solo. Sin él, Better Auth rechaza con `MISSING_OR_NULL_ORIGIN` — que es su defensa
      // anti-CSRF funcionando, no un fallo. Se comprueba aparte, más abajo.
      origin: BASE,
      ...init.headers,
    },
  });
}

// --- Montaje ---------------------------------------------------------------------------------

const codigoBootstrap = Deno.env.get("CODIGO_BOOTSTRAP");
if (!codigoBootstrap) {
  console.error("falta CODIGO_BOOTSTRAP (sale de `deno task invitar:bootstrap`)");
  Deno.exit(2);
}

console.log(`sonda de autorización contra ${BASE}`);

const sello = crypto.randomUUID().slice(0, 8);
const a = await registrar(codigoBootstrap, `a-${sello}@ejemplo.test`);

// B entra con una invitación emitida por A: de paso queda probado el camino normal del cupo.
const emitida = await comoPersona(a, "/api/invitations", { method: "POST" });
const invitacionDeA = await emitida.json() as { code: string };
const b = await registrar(invitacionDeA.code, `b-${sello}@ejemplo.test`);

console.log(`  (A=${a.id.slice(0, 8)}… B=${b.id.slice(0, 8)}…)`);

// A deja rastro: marca un nodo raíz que existe en Fase 0.
const NODO_RAIZ = "f0-entorno";
const marcado = await comoPersona(a, `/api/progress/${NODO_RAIZ}`, {
  method: "PUT",
  body: JSON.stringify({ state: "done" }),
});
comprobar(marcado.ok, "A puede marcar su propio progreso", `HTTP ${marcado.status}`);

// --- Sin sesión no se entra ------------------------------------------------------------------

console.log("\nsin sesión:");
for (
  const [ruta, init] of [
    ["/api/progress", {}],
    [`/api/progress/${NODO_RAIZ}`, { method: "PUT", body: JSON.stringify({ state: "done" }) }],
    ["/api/invitations", {}],
    ["/api/invitations", { method: "POST" }],
  ] as [string, RequestInit][]
) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    ...init,
    headers: { "content-type": "application/json" },
  });
  comprobar(
    respuesta.status === 401,
    `${init.method ?? "GET"} ${ruta} → 401`,
    `hubo ${respuesta.status}`,
  );
}

// --- B no alcanza lo de A --------------------------------------------------------------------

console.log("\nB contra los datos de A:");

const progresoDeB = await comoPersona(b, "/api/progress");
const vistaB = await progresoDeB.json() as { progreso: { nodeId: string }[] };
comprobar(
  vistaB.progreso.length === 0,
  "el progreso de B está vacío pese a que A marcó un nodo",
  `B ve ${vistaB.progreso.length} fila(s)`,
);

// El ataque que importa: colar la identidad de A por donde se pueda.
for (
  const ruta of [
    `/api/progress?userId=${a.id}`,
    `/api/progress?user_id=${a.id}`,
    `/api/progress?id=${a.id}`,
  ]
) {
  const respuesta = await comoPersona(b, ruta);
  const cuerpo = await respuesta.json() as { progreso: { nodeId: string }[] };
  comprobar(
    cuerpo.progreso.length === 0,
    `colar el id de A por query (${ruta.split("?")[1]}) no devuelve su progreso`,
    `devolvió ${cuerpo.progreso.length} fila(s)`,
  );
}

const porCuerpo = await comoPersona(b, `/api/progress/${NODO_RAIZ}`, {
  method: "PUT",
  body: JSON.stringify({ state: "done", userId: a.id, user_id: a.id }),
});
comprobar(porCuerpo.ok, "colar el id de A en el cuerpo no falla…", `HTTP ${porCuerpo.status}`);
const progresoDeATrasAtaque = await comoPersona(a, "/api/progress");
const vistaA = await progresoDeATrasAtaque.json() as {
  progreso: { nodeId: string; state: string }[];
};
comprobar(
  vistaA.progreso.length === 1,
  "…y escribe en el progreso de B, no en el de A",
  `A tiene ${vistaA.progreso.length} fila(s)`,
);

// --- Invitaciones ------------------------------------------------------------------------------

console.log("\ninvitaciones:");

const listaDeB = await comoPersona(b, "/api/invitations");
const cuerpoB = await listaDeB.json() as { invitaciones: { code: string }[] };
comprobar(
  !cuerpoB.invitaciones.some((i) => i.code === invitacionDeA.code),
  "B no ve la invitación que emitió A",
);

const revocada = await comoPersona(b, `/api/invitations/${invitacionDeA.code}`, {
  method: "DELETE",
});
comprobar(
  revocada.status === 404,
  "B no puede revocar una invitación de A",
  `HTTP ${revocada.status}`,
);

const inexistente = await comoPersona(b, "/api/invitations/no-existe-este-codigo", {
  method: "DELETE",
});
comprobar(
  inexistente.status === revocada.status,
  "revocar algo ajeno y algo inexistente responden igual (§12.4)",
  `ajeno ${revocada.status} vs inexistente ${inexistente.status}`,
);

// --- La sesión se invalida de verdad -----------------------------------------------------------

console.log("\ncierre de sesión:");
// Con `content-type: application/json` y sin cuerpo, Better Auth responde 400 («Invalid JSON»). El
// proxy de `/api/auth/*` reenvía **exactamente** lo que recibe y no le inventa un `{}`: un proxy que
// fabrica cuerpos taparía un cuerpo malformado de verdad en cualquier otro endpoint. Así que la sonda
// manda el cuerpo vacío que manda un cliente real.
const salida = await comoPersona(b, "/api/auth/sign-out", { method: "POST", body: "{}" });
comprobar(salida.ok, "B cierra sesión", `HTTP ${salida.status}`);
const trasSalir = await comoPersona(b, "/api/progress");
comprobar(
  trasSalir.status === 401,
  "la cookie de B ya no vale tras cerrar sesión",
  `HTTP ${trasSalir.status}`,
);

// --- CSRF ----------------------------------------------------------------------------------------

console.log("\nCSRF:");
// Dos defensas distintas y las dos importan, porque cubren mitades distintas de la API.
//
// 1. Better Auth exige `Origin` en lo que cambia estado: una petición con la cookie de la víctima
//    pero sin Origin es exactamente la forma de un ataque CSRF, y la rechaza.
const sinOrigen = await fetch(`${BASE}/api/auth/sign-out`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: a.cookie },
  body: "{}",
});
comprobar(
  sinOrigen.status === 403,
  "una petición con cookie y sin Origin se rechaza (anti-CSRF)",
  `HTTP ${sinOrigen.status}`,
);

// 2. Nuestros endpoints no llevan esa comprobación, y no la necesitan: la cookie es `SameSite`, así
//    que el navegador **no la manda** en una petición cross-site. Si algún día alguien la aflojara a
//    `None`, este check se pone rojo antes de que el agujero llegue a producción.
comprobar(
  /SameSite=(Lax|Strict)/i.test(a.cookiesCrudas.join("; ")),
  "la cookie de sesión es SameSite: sin eso, nuestros PUT/POST quedarían expuestos a CSRF",
  a.cookiesCrudas.join(" | ") || "(sin cookies)",
);

// --- El alta directa de la librería está cerrada -------------------------------------------------

console.log("\nel alta sin invitación:");
const directa = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: `colado-${sello}@ejemplo.test`,
    password: "contraseña-de-prueba-muy-larga",
    name: "colado",
  }),
});
comprobar(
  directa.status === 404,
  "el sign-up de la librería no está expuesto",
  `HTTP ${directa.status}`,
);
const sinCodigo = await fetch(`${BASE}/api/registro`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: `sincodigo-${sello}@ejemplo.test`,
    password: "contraseña-de-prueba-muy-larga",
    name: "sin código",
  }),
});
comprobar(sinCodigo.status === 403, "registrarse sin código es 403", `HTTP ${sinCodigo.status}`);

// --- Veredicto -----------------------------------------------------------------------------------

console.log(`\n${comprobaciones - fallos}/${comprobaciones} comprobaciones en verde`);
if (fallos > 0) {
  console.error(`${fallos} fallo(s) de autorización: V7 NO se cumple`);
  Deno.exit(1);
}

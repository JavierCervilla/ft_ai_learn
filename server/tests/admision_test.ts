import { assert, assertEquals } from "jsr:@std/assert@^1.0.0";
import {
  conPiso,
  desbordesDelPiso,
  ipDe,
  LimitePorIp,
  olvidarDesbordes,
  Semaforo,
} from "../src/admision.ts";
import { generarCodigo } from "../src/invitaciones.ts";

/**
 * Las piezas del control de admisión, probadas **sin servidor**.
 *
 * La propiedad de seguridad de verdad —que las tres poblaciones de fallo del alta tarden lo mismo—
 * se mide contra un servidor real en `tests/e2e/journeys/adversarial/a5-…`, porque medir tiempo es
 * medir un sistema entero. Lo de aquí es lo que sí se puede afirmar de forma determinista: que cada
 * pieza hace lo que dice, para que cuando el recorrido de tiempo parpadee se sepa que el problema es
 * la máquina y no la lógica.
 */

Deno.test("el piso no deja salir antes de tiempo, y no cuenta desborde", async () => {
  olvidarDesbordes();
  const t0 = performance.now();
  const valor = await conPiso(120, () => Promise.resolve("listo"));
  const transcurrido = performance.now() - t0;

  assertEquals(valor, "listo");
  // Margen hacia abajo: los temporizadores pueden disparar un pelo antes por redondeo del reloj.
  assert(transcurrido >= 115, `salió en ${transcurrido.toFixed(1)} ms, antes del piso de 120`);
  assertEquals(desbordesDelPiso(), 0);
});

Deno.test("el piso también sujeta cuando el manejador lanza", async () => {
  olvidarDesbordes();
  const t0 = performance.now();
  let lanzo = false;
  try {
    await conPiso(120, () => Promise.reject(new Error("revienta")));
  } catch {
    lanzo = true;
  }
  const transcurrido = performance.now() - t0;

  // Es el caso que un piso repartido por los `return` no cubriría: si el manejador lanza, el servidor
  // respondería rápido y aparecería un camino veloz **nuevo**, justo el que esto viene a cerrar.
  assert(lanzo, "el error tiene que seguir propagándose");
  assert(transcurrido >= 115, `el fallo salió en ${transcurrido.toFixed(1)} ms, sin piso`);
});

Deno.test("una respuesta más lenta que el piso cuenta como desborde", async () => {
  olvidarDesbordes();
  await conPiso(10, () => new Promise((listo) => setTimeout(listo, 60)));
  // El canario: si esto sube en producción, el piso no está sujetando y el canal se reabre.
  assertEquals(desbordesDelPiso(), 1);
});

Deno.test("el techo descarta en vez de encolar", () => {
  const s = new Semaforo(2);
  assert(s.intentar());
  assert(s.intentar());
  // La tercera NO espera: encolar metería la espera dentro de la respuesta y desbordaría el piso,
  // que es exactamente lo que el techo existe para impedir.
  assertEquals(s.intentar(), false);
  s.soltar();
  assert(s.intentar());
});

Deno.test("el límite por IP cuenta por IP y la ventana lo reinicia", () => {
  const limite = new LimitePorIp(3, 1000);
  for (let i = 0; i < 3; i++) {
    assert(limite.admite("1.2.3.4", 0), `la petición ${i + 1} debía pasar`);
  }
  assertEquals(limite.admite("1.2.3.4", 0), false);

  // Otra IP no hereda el castigo de la primera.
  assert(limite.admite("5.6.7.8", 0));

  // Pasada la ventana, se vuelve a empezar.
  assert(limite.admite("1.2.3.4", 1000));
});

Deno.test("la IP sale de X-Forwarded-For cuando la hay, y del socket cuando no", () => {
  // Detrás de Traefik el socket siempre trae la IP del proxy: sin mirar la cabecera habría un solo
  // cubo para todo el mundo y el primer atacante dejaría fuera a los demás.
  const conProxy = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  assertEquals(ipDe(conProxy, "10.0.0.1"), "203.0.113.7");
  assertEquals(ipDe(new Headers(), "198.51.100.4"), "198.51.100.4");
});

Deno.test("ningún código de invitación empieza por guion", () => {
  // La probabilidad de que un código empiece por `-` es 1/64, así que con 500 muestras un generador
  // sin la guarda saldría rojo prácticamente siempre (p ≈ 1 − (63/64)^500 ≈ 0,9996).
  const muestras = 500;
  for (let i = 0; i < muestras; i++) {
    const codigo = generarCodigo();
    assert(!codigo.startsWith("-"), `"${codigo}" empieza por guion: se pierde al copiarlo`);
    assertEquals(codigo.length, 22, `"${codigo}" no mide 22 caracteres`);
    assert(/^[A-Za-z0-9_-]+$/.test(codigo), `"${codigo}" no es base64url`);
  }
});

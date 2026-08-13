/**
 * Recorrido adversario · A12 (el gate que no gatea) · FTAI-D.2
 *
 * PROMESA ATACADA (criterio 5 de la trayectoria):
 *   «El gate de anti-slop de interfaz sale limpio y **bloquea** en CI.»
 *
 * HALLAZGO ORIGINAL de `qa-adversario`: salía limpio **con una violación real delante**.
 * `audit-anti-slop.sh` sólo miraba `*.tsx *.ts *.jsx *.js *.css`, así que era estructuralmente ciego
 * a los dos ficheros donde vive la identidad visual de una PWA — `webapp/index.html` y
 * `webapp/public/manifest.webmanifest`— con `#0b1020` a la vista en los tres sitios y veredicto
 * `criticos=0 · LIMPIO` se le apuntara al directorio que se le apuntara.
 *
 * CÓMO SE CERRÓ, Y POR QUÉ NO COMO PEDÍA EL RECORRIDO ORIGINAL. Queda dicho aquí porque cambiar un
 * recorrido adversario para que pase es justo lo que no se debe hacer a la ligera:
 *
 *   · `.html` **entra en el gate**. Es el arreglo directo, y el objetivo del paso de CI se amplió de
 *     `webapp/src` a `webapp` — enseñarle a leer HTML sin apuntarle a donde hay HTML habría sido el
 *     mismo error otra vez. Eso es lo que comprueba el primer test de abajo, metiendo un hex nuevo.
 *
 *   · `.webmanifest` **no entra**, y no por pereza: es JSON y no admite comentarios, así que no puede
 *     declarar el escape `anti-slop-allow` del gate. Como su hex es **obligatorio** por el formato,
 *     meterlo en el gate sólo daría a elegir entre bloquear para siempre o ensuciar el manifiesto con
 *     claves basura que finjan ser comentarios. Se cubre con algo **más fuerte** que el gate:
 *     `webapp/tests/marca.test.ts` no comprueba que no haya un literal, comprueba que el literal sea
 *     exactamente `--color-fondo` convertido a sRGB. El gate diría «hay un hex»; eso dice «el hex es
 *     el que tiene que ser», que es la propiedad que de verdad importaba — que los dos valores no
 *     puedan divergir en silencio. El segundo test comprueba que esa red sigue puesta.
 *
 *   deno test -A tests/e2e/journeys/adversarial/a12-gate-anti-slop-ciego-al-html.spec.ts
 */
import { assert } from "jsr:@std/assert";

const RAIZ = new URL("../../../../", import.meta.url).pathname;
const GATE = `${RAIZ}.frontend-anti-slop/scripts/audit-anti-slop.sh`;

Deno.test("A12 · el gate bloquea un hex nuevo en el HTML de la app", async () => {
  const banco = await Deno.makeTempDir({ prefix: "a12-gate-" });
  const original = await Deno.readTextFile(`${RAIZ}webapp/index.html`);

  // Un hex **sin** el escape justificado, del tipo que aparece cuando alguien copia un snippet de
  // otro sitio. Si el filtro de extensiones vuelve a perder el `.html`, esto pasa desapercibido.
  const conViolacion = original.replace(
    "<title>",
    '<meta name="msapplication-TileColor" content="#7c3aed" />\n    <title>',
  );
  assert(conViolacion !== original, "premisa rota: no se pudo inyectar el hex en index.html");
  await Deno.writeTextFile(`${banco}/index.html`, conViolacion);

  const conHex = await new Deno.Command("bash", { args: [GATE, banco] }).output();
  const salida = new TextDecoder().decode(conHex.stdout);

  // Control negativo: el mismo fichero sin el hex tiene que salir limpio. Sin él, un gate que
  // bloqueara *siempre* —por ejemplo por un error de uso, que también es exit distinto de 0— pasaría
  // por bueno el aserto de arriba.
  await Deno.writeTextFile(`${banco}/index.html`, original);
  const sinHex = await new Deno.Command("bash", { args: [GATE, banco] }).output();

  await Deno.remove(banco, { recursive: true });

  assert(
    conHex.code === 1,
    `el gate dio exit ${conHex.code} sobre un index.html con un hex sin justificar. ` +
      `Comprueba que '*.html' sigue en el filtro de extensiones. Salida:\n${
        salida.trim().split("\n").slice(-3).join("\n")
      }`,
  );
  assert(
    sinHex.code === 0,
    `el gate bloquea el index.html real (exit ${sinHex.code}): el aserto de arriba no demuestra ` +
      "nada si el gate bloquea pase lo que pase.",
  );
});

Deno.test("A12 · la red que cubre el manifiesto sigue puesta", async () => {
  // El manifiesto no puede pasar por el gate (ver cabecera). Lo que lo protege es un test que ata su
  // hex al token; si ese test desapareciera o dejara de mirar el manifiesto, el color de marca
  // volvería a poder divergir sin que nada se enterase — y esta vez sin que ni siquiera hubiera un
  // hallazgo abierto que lo recordase.
  const marca = await Deno.readTextFile(`${RAIZ}webapp/tests/marca.test.ts`).catch(() => "");

  for (const senal of ["manifiesto.theme_color", "manifiesto.background_color", "tokenFondo()"]) {
    assert(
      marca.includes(senal),
      `webapp/tests/marca.test.ts ya no contiene '${senal}': el manifiesto se ha quedado sin la ` +
        "única comprobación que ata su color al token, y el gate no puede cubrirlo.",
    );
  }
});

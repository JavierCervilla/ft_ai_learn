# Gate anti-slop de interfaz (vendorizado)

Copia **pinneada** de `frontend-anti-slop` del framework: el script y sus tres listas de patrones.

La estructura `scripts/` + `data/` **se respeta tal cual**: el script resuelve sus listas como
`$(dirname $0)/../data`, así que aplanarla lo rompe con exit 2. Se replica en vez de parchear el
script — un vendorizado que diverge del original deja de ser una copia.

Se vendoriza por lo mismo que el ruleset de semgrep en `.security-gate-presets/`: el veredicto tiene
que ser **reproducible sin red** y no puede cambiar porque alguien edite una skill fuera del repo.

Entró en FTAI-D.2 y no antes, y eso es el hallazgo: el script existía en el framework desde el
principio, la webapp nunca lo invocó, y el job de CI se llamaba «Webapp · tsc + **anti-slop** + build
+ PWA» — pero ese anti-slop era el de **código** (ESLint + sonarjs), no el de interfaz. Al enchufarlo
salieron 6 violaciones duras en los tokens de la semilla.

    bash .frontend-anti-slop/scripts/audit-anti-slop.sh webapp/src

Exit 0 limpio · 1 con violaciones duras · 2 error de uso. El escape por línea es
`anti-slop-allow: <razón>`, y queda trazado en el diff.

Para actualizarlo, se recopia del framework a propósito: `.claude/skills/frontend-anti-slop/`.

## `*.html` (añadido en D.2 tras el pase adversario)

El filtro de extensiones original —`.tsx .ts .jsx .js .css`— era **estructuralmente ciego a los dos
ficheros donde vive la identidad visual de una PWA**: `index.html` y el manifiesto. `qa-adversario`
lo reprodujo (F9/A12): con `#0b1020` a la vista en los tres sitios, el gate decía `criticos=0 ·
LIMPIO`, y **ni apuntándolo a `webapp/` entero** saltaba. Un gate que no mira un fichero no es
permisivo con él: es que no existe para él.

Se añade `*.html`. **El mismo cambio está hecho en la skill original del framework**, para que esto
siga siendo una copia y no una bifurcación — hasta que ese cambio esté en `main` de AgenticFramework,
esta copia va un commit por delante, y queda dicho aquí para que nadie lo descubra por un diff.

El `.webmanifest` **no** entra, y no por olvido: es JSON, no admite comentarios, y el escape del gate
(`anti-slop-allow: <razón>`) es una línea de comentario. Un fichero que no puede declarar una
excepción sólo puede pasar o bloquear para siempre, y su hex es **obligatorio** por el formato. Ese
caso lo cubre `webapp/tests/marca.test.ts`, que es más fuerte que el gate: no comprueba que no haya
un literal, comprueba que el literal **sea exactamente el token** convertido a sRGB.

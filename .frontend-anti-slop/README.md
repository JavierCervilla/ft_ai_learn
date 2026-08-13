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

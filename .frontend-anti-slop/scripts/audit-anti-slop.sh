#!/usr/bin/env bash
#
# audit-anti-slop.sh — linter DETERMINISTA anti-slop de frontend (solo bash + grep, SIN LLM).
# Parte de la skill `frontend-anti-slop`. Reproducible en local y en CI/verificador.
#
set -u

# --- Compat Bash 3.2 (macOS): re-exec con un bash>=4 si está disponible (brew). --------------------
# `mapfile`/`readarray` son Bash 4+; el /bin/bash de macOS es 3.2. Si hay un bash moderno,
# re-ejecutamos con él (centinela para evitar bucle infinito). Si no, la lógica de abajo ya
# usa `while read` compatible con 3.2.
if [ -z "${_SLOP_REEXEC:-}" ] && [ "${BASH_VERSINFO:-0}" -lt 4 ]; then
  for _b in /opt/homebrew/bin/bash /usr/local/bin/bash; do
    [ -x "$_b" ] && { export _SLOP_REEXEC=1; exec "$_b" "$0" "$@"; }
  done
fi

# --- Resolución de rutas (la skill es autocontenida) ---------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATA_DIR="${SKILL_DIR}/data"

FONTS_FILE="${DATA_DIR}/banned-fonts.txt"
COLOR_FILE="${DATA_DIR}/banned-color-patterns.txt"
CODE_FILE="${DATA_DIR}/banned-code-patterns.txt"

ESCAPE_TAG="anti-slop-allow:"

usage() {
  cat <<'EOF'
audit-anti-slop.sh — linter determinista anti-slop de frontend (bash + grep, sin LLM)

USO:
  audit-anti-slop.sh [--help] [<dir>]

  <dir>     Directorio a escanear (por defecto: directorio actual).
            Se escanean recursivamente ficheros *.tsx *.ts *.jsx *.js *.css *.html.

DESCRIPCION:
  Veta "slop" de frontend de forma objetiva, leyendo patrones grep de:
    data/banned-fonts.txt           (eje Tipografia)
    data/banned-color-patterns.txt  (eje Color)
    data/banned-code-patterns.txt   (eje Codigo)
  Cada fichero: 1 patron grep (ERE) por linea; lineas vacias y las que
  empiezan por '#' se ignoran.

  Reporta violaciones agregadas (eje, severidad, fichero:linea, sugerencia).
  No vuelca ficheros enteros.

ESCAPE (excepcion trazada):
  Una linea con el comentario "anti-slop-allow: <razon>" exime la coincidencia
  de ESA linea (si el tag esta en la misma linea o en la inmediatamente anterior).
  Las excepciones NO bloquean: se reportan como justificadas.

EXIT CODES:
  0   Limpio, o solo excepciones justificadas.        (verde para CI/verificador)
  1   Al menos una violacion dura (PROHIBIDO).         (bloquea)
  2   Error de uso (dir inexistente, falta data/...).  (no es veredicto de calidad)
EOF
}

# --- Parseo de argumentos ------------------------------------------------------------------------
TARGET_DIR="."
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    -*) echo "ERROR: opcion desconocida: $arg" >&2; usage >&2; exit 2 ;;
    *)  TARGET_DIR="$arg" ;;
  esac
done

# --- Validaciones (exit 2 = error de uso) --------------------------------------------------------
if [[ ! -d "$TARGET_DIR" ]]; then
  echo "ERROR: directorio inexistente: $TARGET_DIR" >&2
  exit 2
fi
for f in "$FONTS_FILE" "$COLOR_FILE" "$CODE_FILE"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: falta fichero de patrones: $f" >&2
    exit 2
  fi
done

# --- Recolección de ficheros a escanear ----------------------------------------------------------
#
# Se PODAN los directorios que no son nuestros. Sin esto, apuntar el linter a la raíz de un proyecto
# —que es lo natural— escanea `node_modules` y devuelve miles de "violaciones duras" ajenas: medido en
# Pokelock, 5658 críticos, TODOS de dependencias y ninguno del código propio. El veredicto resultante
# es un BLOQUEADO falso, y un gate que da un falso bloqueo por defecto es un gate que se aprende a
# ignorar. Se poda con `-prune`, no filtrando después: así `find` ni siquiera entra, y la pasada baja
# de minutos a segundos.
#
# `dist`/`build`/`.next`/`coverage` son salidas del compilador: código generado, no escrito, y
# juzgarlo por criterios de artesanía no significa nada.
PRUNE_DIRS=(node_modules .git dist build .next out coverage vendor .venv __pycache__ .turbo .cache \
            test-results playwright-report qa-bundles)
_prune=()
for _d in "${PRUNE_DIRS[@]}"; do
  [ ${#_prune[@]} -eq 0 ] || _prune+=(-o)
  _prune+=(-name "$_d")
done

FILES=()
while IFS= read -r _l; do FILES+=("$_l"); done < <(find "$TARGET_DIR" \
  \( -type d \( "${_prune[@]}" \) -prune \) -o \
  \( -type f \( -name '*.tsx' -o -name '*.ts' -o -name '*.jsx' -o -name '*.js' -o -name '*.css' \
     -o -name '*.html' \) \
  -print \) \
  2>/dev/null | sort)

# --- Estado global -------------------------------------------------------------------------------
VIOLATIONS=0
EXCEPTIONS=0

# Carga los patrones activos (sin comentarios ni lineas vacias) de un fichero de datos.
load_patterns() {
  local file="$1"
  grep -vE '^[[:space:]]*(#|$)' "$file"
}

# Sugerencia por eje.
suggest_for() {
  case "$1" in
    Tipografia) echo "usa una fuente display con caracter + una de texto legible (no genericas de marca)";;
    Color)      echo "usa tokens OKLCH (text-accent, bg-surface...), no hex/rgb/hsl ni gradiente cliche";;
    Codigo)     echo "usa clases utilitarias sobre tokens; evita estilos inline, !important, console.log y ': any'";;
    *)          echo "revisa el checklist anti-slop (SKILL.md 2.3)";;
  esac
}

# Escanea un eje completo (un fichero de datos) sobre todos los ficheros objetivo.
# $1 = etiqueta del eje, $2 = fichero de patrones.
scan_axis() {
  local axis="$1" pattern_file="$2"
  local suggestion; suggestion="$(suggest_for "$axis")"

  # Patrones activos del eje.
  local -a patterns=()
  local _l
  while IFS= read -r _l; do patterns+=("$_l"); done < <(load_patterns "$pattern_file")
  [[ ${#patterns[@]} -eq 0 ]] && return 0

  local file pat
  for file in "${FILES[@]}"; do
    # Lee el fichero en un array indexado por nº de linea (1-based).
    local -a lines=()
    # Bash-3.2 compat: array base-1 (índice = nº de línea, como `mapfile -t -O 1`).
    local _i=1 _l
    while IFS= read -r _l || [ -n "$_l" ]; do lines[$_i]="$_l"; _i=$((_i+1)); done < "$file"

    for pat in "${patterns[@]}"; do
      # Coincidencias: "linea:contenido"
      local hit lineno
      while IFS= read -r hit; do
        [[ -z "$hit" ]] && continue
        lineno="${hit%%:*}"

        # ¿Exenta por anti-slop-allow (misma linea o la anterior)?
        local cur="${lines[$lineno]:-}"
        local prev=""
        if [[ "$lineno" -gt 1 ]]; then prev="${lines[$((lineno-1))]:-}"; fi

        if [[ "$cur" == *"$ESCAPE_TAG"* || "$prev" == *"$ESCAPE_TAG"* ]]; then
          # Extrae la razon (lo que sigue al tag en la linea que lo contiene).
          local src="$cur"
          [[ "$cur" != *"$ESCAPE_TAG"* ]] && src="$prev"
          local reason="${src#*$ESCAPE_TAG}"
          reason="${reason%%\*/*}"           # corta cierre de comentario /* */
          reason="$(echo "$reason" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
          [[ -z "$reason" ]] && reason="(sin razon)"
          echo "EXCEPCION [${axis}] ${file}:${lineno} — justificada: ${reason}"
          EXCEPTIONS=$((EXCEPTIONS+1))
        else
          echo "VIOLACION [${axis}] severidad=dura ${file}:${lineno}"
          echo "    sugerencia: ${suggestion}"
          VIOLATIONS=$((VIOLATIONS+1))
        fi
      done < <(grep -nE -e "$pat" "$file" 2>/dev/null)
    done
  done
}

echo "== audit-anti-slop :: escaneando '${TARGET_DIR}' (${#FILES[@]} fichero(s) UI) =="

if [[ ${#FILES[@]} -gt 0 ]]; then
  scan_axis "Tipografia" "$FONTS_FILE"
  scan_axis "Color"      "$COLOR_FILE"
  scan_axis "Codigo"     "$CODE_FILE"
fi

# --- Resumen contable (datos agregados, sin volcar ficheros) -------------------------------------
echo "-------------------------------------------------------------"
echo "RESUMEN: criticos=${VIOLATIONS} | excepciones justificadas=${EXCEPTIONS}"

if [[ "$VIOLATIONS" -gt 0 ]]; then
  echo "VEREDICTO: BLOQUEADO (hay violaciones duras)."
  exit 1
fi
echo "VEREDICTO: LIMPIO."
exit 0

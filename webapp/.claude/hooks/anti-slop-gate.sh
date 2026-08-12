#!/usr/bin/env bash
# PreToolUse gate — anti-slop determinista ENFORCED en todos los proyectos (T-044-C).
#
# La doctrina anti-slop (doctrina_anti_slop.md) no debe depender de que el agente SE ACUERDE.
# Este hook lo FUERZA en el límite real: cuando código de producción va a entrar al repo.
# Dos comprobaciones, ambas deterministas y fail-open:
#   (1) PRESENCIA: si hay ficheros de código staged dentro de un proyecto JS/TS (tiene package.json)
#       que NO lleva el gate anti-slop (.anti-slop-gate o eslint.anti-slop.mjs) → BLOQUEA y pide
#       instalarlo con el scaffolder de la skill code-anti-slop.
#   (2) ESCANEO: corre el linter bash de la skill (code-anti-slop.sh) sobre los ficheros de código
#       staged; si hay violación dura → BLOQUEA.
# El pass/fail exhaustivo (ESLint+sonarjs) queda en CI (gate duro de merge); aquí van los "dientes"
# rápidos al commit.
#
# Entrada (stdin, JSON PreToolUse): { tool_name, tool_input:{ command }, ... }
# Bloqueo: { hookSpecificOutput:{ ..., permissionDecision:"deny", permissionDecisionReason } } (exit 0).
#
# Filosofía SRE: **fail-open**. Sin jq/git, ante duda o error de uso → DEJA PASAR. Solo bloquea cuando
# determina POSITIVAMENTE el problema. Escape: [skip-traj] en el mensaje del commit; por línea:
# `anti-slop-allow: <razón>`.

# Bash 3.2-safe: macOS trae /bin/bash 3.2.57 (GPLv3, congelado). Si corremos bajo <4 y hay un bash 4+
# (Homebrew), re-ejecutamos con él. `exec` preserva stdin (el JSON del hook no se pierde). Centinela
# `_GATE_REEXEC` evita bucle infinito. Si no hay bash 4+, seguimos: la lógica de abajo es 3.2-safe.
if [ -z "${_GATE_REEXEC:-}" ] && [ "${BASH_VERSINFO:-0}" -lt 4 ]; then
  for _b in /opt/homebrew/bin/bash /usr/local/bin/bash; do
    if [ -x "$_b" ]; then export _GATE_REEXEC=1; exec "$_b" "$0" "$@"; fi
  done
fi

set -u

input="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0
tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"
[ "$tool" = "Bash" ] || exit 0
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
printf '%s' "$cmd" | grep -Eq '(^|[^a-zA-Z])git[[:space:]]+commit($|[^a-zA-Z])' || exit 0
printf '%s' "$cmd" | grep -q '\[skip-traj\]' && exit 0

command -v git >/dev/null 2>&1 || exit 0
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -n "$root" ] || exit 0

staged="$(git -C "$root" diff --cached --name-only 2>/dev/null)" || exit 0
[ -n "$staged" ] || exit 0

# Solo ficheros de código (familia TS/JS/back) que existan en disco. (Los .sh los cubre shellcheck.)
code_files=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.py|*.go|*.rb|*.rs|*.java) ;;
    *) continue ;;
  esac
  [ -f "$root/$f" ] || continue
  code_files+=("$f")
done <<EOF
$staged
EOF
[ "${#code_files[@]}" -eq 0 ] && exit 0

# Sube por los ancestros buscando package.json (raíz del proyecto). Imprime la raíz o falla.
find_project() {
  local d="$1" parent
  while :; do
    [ -f "$d/package.json" ] && { printf '%s' "$d"; return 0; }
    [ "$d" = "$root" ] && return 1
    parent="$(dirname "$d")"
    [ "$parent" = "$d" ] && return 1
    d="$parent"
  done
}

# --- (1) Presencia del gate por proyecto ---
ungated=""
seen_proj=""   # set bash-3.2-safe: proyectos vistos como "|<ruta>|…" (evita declare -A, Bash 4+)
for f in "${code_files[@]}"; do
  proj="$(find_project "$(dirname "$root/$f")")" || continue   # fuera de un proyecto JS/TS → no exige gate
  case "$seen_proj" in *"|$proj|"*) continue ;; esac            # ¿ya visto?
  seen_proj="${seen_proj}|$proj|"                               # marcar visto
  if [ ! -f "$proj/.anti-slop-gate" ] && [ ! -f "$proj/eslint.anti-slop.mjs" ]; then
    ungated="${ungated} ${proj#"${root}/"}"
  fi
done

if [ -n "${ungated# }" ]; then
  jq -n --arg p "${ungated# }" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: (
        "Vas a commitear código en un proyecto SIN el gate anti-slop:" + $p + ". "
        + "En este repo el gate anti-slop determinista es parte del DoD en TODOS los proyectos "
        + "(doctrina_anti_slop.md). Instálalo: bash .claude/skills/code-anti-slop/scripts/install.sh <proyecto>  "
        + "(añade el preset ESLint+sonarjs, el paso de lint en CI y este hook). Luego repite el commit. "
        + "Excepción legítima: añade [skip-traj] al mensaje del commit."
      )
    }
  }'
  exit 0
fi

# --- (2) Escaneo bash rápido sobre los ficheros staged (fallback determinista) ---
scanner="$root/.claude/skills/code-anti-slop/scripts/code-anti-slop.sh"
[ -f "$scanner" ] || exit 0   # skill no presente → fail-open (CI es el gate duro)

abs=()
for f in "${code_files[@]}"; do abs+=("$root/$f"); done
scan_out="$(bash "$scanner" "${abs[@]}" 2>/dev/null)"; rc=$?
[ "$rc" -eq 1 ] || exit 0      # rc 0 = limpio; rc 2 = error de uso → fail-open

sample="$(printf '%s' "$scan_out" | grep -E '^VIOLACION' | head -3 | tr '\n' ' ')"
jq -n --arg v "$sample" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: (
      "Anti-slop: hay patrones de slop en el código staged (" + $v + "…). "
      + "Límpialos (escapes de tipo any, console.log/debugger, FIXME/XXX, eslint-disable sin razón) "
      + "o, si es intencional, añade en la línea `// anti-slop-allow: <razón>`. "
      + "Corre el detalle: bash .claude/skills/code-anti-slop/scripts/code-anti-slop.sh <ficheros>. "
      + "Excepción global: [skip-traj] en el mensaje del commit."
    )
  }
}'
exit 0

#!/usr/bin/env bash
# PreToolUse gate — seguridad determinista ENFORCED en todos los proyectos (T-061-B).
#
# Espejo EXACTO de anti-slop-gate.sh. La doctrina del Guardián (doctrina_guardian.md) no debe
# depender de que el agente SE ACUERDE: este hook la FUERZA en el límite real, cuando código de
# producción va a entrar al repo. Dos comprobaciones, ambas deterministas y fail-open:
#   (1) PRESENCIA: si hay ficheros de código staged dentro de un proyecto JS/TS (tiene package.json)
#       que NO lleva el gate de seguridad (.security-gate) → BLOQUEA y pide instalarlo con el
#       scaffolder de la skill security-gate.
#   (2) ESCANEO LIGERO (opcional, fail-open): si gitleaks está presente, corre un
#       `gitleaks git --staged` rápido; bloquea SOLO ante secreto. Si gitleaks no está, NO bloquea.
# El pass/fail exhaustivo (secretos+SAST+deps) queda en CI (gate duro de merge); aquí van los
# "dientes" rápidos al commit (presencia + secreto staged).
#
# Entrada (stdin, JSON PreToolUse): { tool_name, tool_input:{ command }, ... }
# Bloqueo: { hookSpecificOutput:{ ..., permissionDecision:"deny", permissionDecisionReason } } (exit 0).
#
# Filosofía SRE: **fail-open**. Sin jq/git, ante duda o error de uso → DEJA PASAR. Solo bloquea cuando
# determina POSITIVAMENTE el problema. Escape: [skip-traj] en el mensaje del commit; por línea:
# `gitleaks:allow` (secreto) o `// nosemgrep: <id>` (SAST en CI).

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
  if [ ! -f "$proj/.security-gate" ]; then
    ungated="${ungated} ${proj#"${root}/"}"
  fi
done

if [ -n "${ungated# }" ]; then
  jq -n --arg p "${ungated# }" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: (
        "Vas a commitear código en un proyecto SIN el gate de seguridad:" + $p + ". "
        + "En este repo el gate de seguridad determinista es parte del DoD en TODOS los proyectos "
        + "(doctrina_guardian.md). Instálalo: bash .claude/skills/security-gate/scripts/install.sh <proyecto>  "
        + "(añade el preset SAST/secretos/deps, el paso de CI y este hook). Luego repite el commit. "
        + "Excepción legítima: añade [skip-traj] al mensaje del commit."
      )
    }
  }'
  exit 0
fi

# --- (2) Escaneo ligero de secretos staged (opcional, fail-open) ---
# Solo si gitleaks está presente; si no, NO bloquea (la red dura es CI). gitleaks v8: `git --staged`.
command -v gitleaks >/dev/null 2>&1 || exit 0
gl_cfg=()
preset_cfg="$root/.claude/skills/security-gate/presets/gitleaks.toml"
[ -f "$preset_cfg" ] && gl_cfg=(-c "$preset_cfg")
gitleaks git "$root" --staged "${gl_cfg[@]}" --no-banner --redact --exit-code 1 >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && exit 0   # sin secreto → pasa; error de ejecución (rc>1 improbable aquí) → fail-open lo cubre abajo
# rc 1 = secreto detectado → BLOQUEA. (gitleaks redacta; nunca imprimimos el secreto.)
[ "$rc" -eq 1 ] || exit 0
jq -n '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: (
      "Seguridad: gitleaks detectó un SECRETO en el diff staged (salida redactada). "
      + "ROTA de inmediato la credencial y quítala del commit/historial. "
      + "Detalle: bash .claude/skills/security-gate/scripts/security-gate.sh --staged. "
      + "Si es un falso positivo intencional, añade `gitleaks:allow` en la línea. "
      + "Excepción global: [skip-traj] en el mensaje del commit."
    )
  }
}'
exit 0

#!/usr/bin/env bash
# guard-skill — PreToolUse(Skill). Barra invocação de estágio fora da lista do papel
# (README §2, §15). Espelho de guard-skill.ps1.
# Uso: guard-skill.sh --role po

. "$(dirname "$0")/_lib.sh"

ROLE=""
case "$1" in --role|-Role) ROLE="$2" ;; esac
[ -n "$ROLE" ] || exit 0

require_jq
input=$(cat)
skill=$(printf '%s' "$input" | jq -r '.tool_input.skill // empty' 2>/dev/null)
[ -n "$skill" ] || exit 0
name="${skill#claude-factory:}"

role_of=$(stage_field "$name" '.role')
[ -n "$role_of" ] || exit 0   # skill que não é estágio: livre

allowed=$(jq -r ".roles[\"$ROLE\"][]? // empty" "$(stage_map_path)" 2>/dev/null)
if ! printf '%s\n' "$allowed" | grep -qx "$name"; then
  deny "guard-skill: o papel '$ROLE' não invoca /$name. Skills do papel: $(printf '%s' "$allowed" | tr '\n' ' ') (README §2)."
fi
exit 0

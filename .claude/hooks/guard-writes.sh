#!/usr/bin/env bash
# guard-writes — PreToolUse(Edit|Write|NotebookEdit). Single-writer durante o estágio (README §14, §15).
# Uso: guard-writes.sh --stage design   (skill)
#      guard-writes.sh --role po        (perfil: UNIÃO dos write-sets dos estágios do papel)
#      guard-writes.sh --allow "docs/proposals/**"
# Aceita também as grafias PowerShell (-Stage/-Role/-Allow) — tolerância à tradução do /setup.

. "$(dirname "$0")/_lib.sh"

STAGE=""; ALLOW=""; ROLE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --stage|-Stage) STAGE="$2"; shift 2 ;;
    --allow|-Allow) ALLOW="$2"; shift 2 ;;
    --role|-Role)   ROLE="$2";  shift 2 ;;
    *) shift ;;
  esac
done

require_jq
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
[ -n "$file" ] || exit 0

globs=()
if [ -n "$ALLOW" ]; then
  IFS=',' read -r -a globs <<< "$ALLOW"
elif [ -n "$STAGE" ]; then
  # estágio desconhecido = não é da factory; estágio com writes vazio (sync) BLOQUEIA tudo
  [ -n "$(stage_field "$STAGE" '.role')" ] || exit 0
  while IFS= read -r g; do [ -n "$g" ] && globs+=("$g"); done < <(stage_field "$STAGE" '.writes[]?')
elif [ -n "$ROLE" ]; then
  stages=$(jq -r ".roles[\"$ROLE\"][]? // empty" "$(stage_map_path)" 2>/dev/null)
  [ -n "$stages" ] || exit 0
  while IFS= read -r st; do
    [ -n "$st" ] || continue
    while IFS= read -r g; do [ -n "$g" ] && globs+=("$g"); done < <(stage_field "$st" '.writes[]?')
  done <<< "$stages"
else
  exit 0
fi
globs+=('.claude/agent-memory/**')

if ! matches_globs "$file" "${globs[@]}"; then
  if [ -n "$STAGE" ]; then who="/$STAGE"; elif [ -n "$ROLE" ]; then who="o papel '$ROLE'"; else who="este papel"; fi
  deny "single-writer: $who só escreve em: ${globs[*]}. Caminho bloqueado: $(rel_path "$file") (README §14)."
fi
exit 0

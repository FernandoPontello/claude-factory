#!/usr/bin/env bash
# Biblioteca comum dos hooks da factory (variante POSIX/bash). Requer jq.
# Source: . "$(dirname "$0")/_lib.sh"

project_root() { printf '%s' "${CLAUDE_PROJECT_DIR:-$PWD}"; }

stage_map_path() { printf '%s' "$(project_root)/.claude/hooks/stage-map.json"; }

deny() { printf '%s\n' "$1" >&2; exit 2; }

# Guards falham FECHADOS: sem jq não há como validar — bloquear é a direção segura
# ("na dúvida, mais prompts, nunca menos segurança" — README §1).
require_jq() {
  command -v jq >/dev/null 2>&1 || \
    deny "hooks da factory: 'jq' ausente — os guards POSIX dependem dele e falham fechados por desenho. Instale jq e tente de novo."
}

# glob -> regex: ** cruza /, * não cruza.
glob_to_regex() {
  local g="$1"
  g="${g//\\//}"
  g=$(printf '%s' "$g" | sed -E 's/[][().+?^${}|]/\\&/g')
  g="${g//'**/'/$'\x01'}"
  g="${g//'**'/$'\x02'}"
  g="${g//'*'/[^/]*}"
  g="${g//$'\x01'/(.*\/)?}"
  g="${g//$'\x02'/.*}"
  printf '^%s$' "$g"
}

rel_path() {
  local p="${1//\\//}" root
  root="$(project_root)"; root="${root//\\//}"
  case "$p" in "$root"/*) p="${p#"$root"/}";; esac
  p="${p#./}"
  printf '%s' "$p"
}

# matches_globs <path> <glob>... -> 0 se algum glob casa
matches_globs() {
  local p g rx
  p=$(rel_path "$1"); shift
  for g in "$@"; do
    [ -n "$g" ] || continue
    rx=$(glob_to_regex "$g")
    if printf '%s' "$p" | grep -Eq "$rx"; then return 0; fi
  done
  return 1
}

# paths sujos do working tree; renames contam os dois lados
# -uall: diretórios untracked viriam colapsados ("?? src/") e furariam o match de glob
dirty_paths() {
  git status --porcelain -uall 2>/dev/null | while IFS= read -r line; do
    [ -n "$line" ] || continue
    local p="${line:3}"
    p="${p%\"}"; p="${p#\"}"
    case "$p" in
      *" -> "*) printf '%s\n' "${p%% -> *}"; printf '%s\n' "${p##* -> }" ;;
      *) printf '%s\n' "$p" ;;
    esac
  done
}

# stage_field <estágio> <campo-jq>  ex: stage_field design '.writes[]'
stage_field() {
  jq -r ".stages[\"$1\"]$2 // empty" "$(stage_map_path)" 2>/dev/null
}

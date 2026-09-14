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
# .claude/.factory/** é rastro de runtime, nunca verdade — fora do scan (defesa em profundidade;
# o /setup garante o gitignore no projeto)
dirty_paths() {
  git status --porcelain -uall 2>/dev/null | while IFS= read -r line; do
    [ -n "$line" ] || continue
    local p="${line:3}"
    p="${p%\"}"; p="${p#\"}"
    case "$p" in
      *" -> "*) printf '%s\n' "${p%% -> *}"; printf '%s\n' "${p##* -> }" ;;
      *) printf '%s\n' "$p" ;;
    esac
  done | grep -Ev '^\.claude/\.factory/' || true
}

# stage_field <estágio> <campo-jq>  ex: stage_field design '.writes[]'
stage_field() {
  jq -r ".stages[\"$1\"]$2 // empty" "$(stage_map_path)" 2>/dev/null
}

# ── Write-set ciente de run de autopilot (README §17) ─────────────────────────
# Espelho de _lib.ps1. Hooks PreToolUse/Stop de skill ACUMULAM: invocar /tasks não desativa
# o guard de /design, e hooks compõem por AND — write-sets diferentes intersectam em VAZIO e
# nenhum estágio invocado por um run consegue escrever. Dentro de um run, todo hook acumulado
# resolve o MESMO conjunto: o write-set do estágio em curso na sentinela, sempre dentro de
# teto ∩ escopo (aritmética do guard-autopilot — sentinela é runtime e não amplia o contrato).

sentinel_path() { printf '%s' "$(project_root)/.claude/.factory/autopilot/active.json"; }

# escopo efetivo do run = sentinela.stages ∩ stages.autopilot.orchestrates; vazio = sem run.
# Sentinela ilegível degrada para "sem run": o fallback é o write-set do estágio ISOLADO, o
# conjunto mais estreito — degradar aqui aperta a guarda, não a afrouxa.
autopilot_scope() {
  local s ceiling scope st
  s="$(sentinel_path)"
  [ -f "$s" ] || return 0
  jq -e . "$s" >/dev/null 2>&1 || return 0
  ceiling=$(jq -r '.stages.autopilot.orchestrates[]? // empty' "$(stage_map_path)" 2>/dev/null)
  [ -n "$ceiling" ] || return 0
  scope=$(jq -r '.stages[]? // empty' "$s" 2>/dev/null)
  for st in $scope; do
    printf '%s\n' "$ceiling" | grep -qx "$st" && printf '%s\n' "$st"
  done
  return 0
}

# estágio em curso segundo a sentinela (item com state 'em-curso'); vazio se não houver
autopilot_current_stage() {
  local s cur
  s="$(sentinel_path)"
  [ -f "$s" ] || return 0
  cur=$(jq -r '[.queue[]? | select(.state == "em-curso") | .stage // empty][0] // empty' "$s" 2>/dev/null)
  [ -n "$cur" ] || return 0
  autopilot_scope | grep -qx "$cur" || return 0
  printf '%s\n' "$cur"
  return 0
}

# autopilot_write_globs <estágio> -> imprime o write-set do run, uma glob por linha;
# retorna 1 quando não há run aplicável a esse estágio (caller usa o write-set isolado)
autopilot_write_globs() {
  local stage="$1" scope cur st g
  local globs=()
  scope=$(autopilot_scope)
  [ -n "$scope" ] || return 1
  # estágio fora do escopo do run (ex.: /promote digitado pelo operador) segue guardado pelo
  # write-set dele; 'autopilot' entra sempre — é o dono da sentinela
  if [ "$stage" != "autopilot" ] && ! printf '%s\n' "$scope" | grep -qx "$stage"; then return 1; fi

  cur=$(autopilot_current_stage)
  if [ -n "$cur" ]; then
    while IFS= read -r g; do [ -n "$g" ] && globs+=("$g"); done < <(stage_field "$cur" '.writes[]?')
  else
    # sentinela sem posição legível: união do escopo — mais largo, ainda sob o teto
    while IFS= read -r st; do
      [ -n "$st" ] || continue
      while IFS= read -r g; do [ -n "$g" ] && globs+=("$g"); done < <(stage_field "$st" '.writes[]?')
    done <<< "$scope"
  fi
  # o manifesto do run entra sempre: o orquestrador atualiza a sentinela a cada transição,
  # com o guard do estágio filho já acumulado na sessão
  while IFS= read -r g; do [ -n "$g" ] && globs+=("$g"); done < <(stage_field autopilot '.writes[]?')

  [ ${#globs[@]} -gt 0 ] || return 1
  printf '%s\n' "${globs[@]}"
  return 0
}

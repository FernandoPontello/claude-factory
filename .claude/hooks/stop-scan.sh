#!/usr/bin/env bash
# stop-scan — Stop (frontmatter de skill de estágio). Scan de single-writer (README §15).
# Cobre a brecha de escrita via Bash e a de sub-agents genéricos (sem frontmatter, sem
# guard in-flight). Espelho de stop-scan.ps1.
# DENTRO de um run de autopilot (§17) o write-set é o do estágio em curso na sentinela, não o
# do estágio que registrou este hook — hooks de Stop acumulam igual aos de PreToolUse
# (ver autopilot_write_globs em _lib.sh).
# Uso: stop-scan.sh --stage design

. "$(dirname "$0")/_lib.sh"

STAGE=""
case "$1" in --stage|-Stage) STAGE="$2" ;; esac
[ -n "$STAGE" ] || exit 0
require_jq

# estágio desconhecido = não é da factory; write-set vazio (sync) segue e bloqueia tudo
[ -n "$(stage_field "$STAGE" '.role')" ] || exit 0
writes=()
RUN_STAGE=""
if run_globs=$(autopilot_write_globs "$STAGE"); then
  RUN_STAGE=$(autopilot_current_stage)
  while IFS= read -r g; do [ -n "$g" ] && writes+=("$g"); done <<< "$run_globs"
else
  while IFS= read -r g; do [ -n "$g" ] && writes+=("$g"); done < <(stage_field "$STAGE" '.writes[]?')
fi
writes+=('.claude/agent-memory/**')

foreign=""
while IFS= read -r p; do
  [ -n "$p" ] || continue
  matches_globs "$p" "${writes[@]}" || foreign="$foreign
  $p"
done < <(dirty_paths)

if [ -n "$foreign" ]; then
  alvo="/$STAGE"
  [ -z "$RUN_STAGE" ] || alvo="/$RUN_STAGE (estágio em curso no run de autopilot)"
  deny "stop-scan: escrita fora do write-set de $alvo detectada no working tree:$foreign
Single-writer (§14): reverta esses paths ou explique ao operador por que a exceção se justifica antes de encerrar."
fi
exit 0

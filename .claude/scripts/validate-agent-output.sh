#!/usr/bin/env bash
# validate-agent-output — valida a saída estruturada de sub-agents (README §15).
# Espelho de validate-agent-output.ps1. Requer jq.
#
# Uso:  <saída> | validate-agent-output.sh --required "completed,failed,patch"
#       validate-agent-output.sh --file saida.json --required "epics"

FILE=""; REQUIRED=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) FILE="$2"; shift 2 ;;
    --required) REQUIRED="$2"; shift 2 ;;
    *) shift ;;
  esac
done
[ -n "$REQUIRED" ] || { echo "validate-agent-output: --required é obrigatório" >&2; exit 1; }

if [ -n "$FILE" ]; then raw=$(cat "$FILE" 2>/dev/null); else raw=$(cat); fi
if [ -z "$(printf '%s' "$raw" | tr -d '[:space:]')" ]; then
  echo "validate-agent-output: saída VAZIA — o agent não devolveu nada. Falhando ruidosamente (§15)." >&2
  exit 1
fi

# tolera cerca de markdown ```json ... ```
clean=$(printf '%s' "$raw" | sed -E '1s/^```(json)?$//; $s/^```$//')

if ! printf '%s' "$clean" | jq -e . >/dev/null 2>&1; then
  echo "validate-agent-output: saída não é JSON válido. Primeiros 200 chars:" >&2
  printf '%s' "$clean" | head -c 200 >&2; echo >&2
  exit 1
fi

missing=""
IFS=',' read -r -a keys <<< "$REQUIRED"
for k in "${keys[@]}"; do
  k=$(printf '%s' "$k" | tr -d '[:space:]')
  [ -n "$k" ] || continue
  printf '%s' "$clean" | jq -e --arg k "$k" 'has($k)' >/dev/null 2>&1 || missing="$missing $k"
done

if [ -n "$missing" ]; then
  echo "validate-agent-output: chaves obrigatórias ausentes:$missing. O estágio deve re-instruir o agent, não prosseguir com saída parcial (§15)." >&2
  exit 1
fi
exit 0

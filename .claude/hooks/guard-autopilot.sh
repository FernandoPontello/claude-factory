#!/usr/bin/env bash
# guard-autopilot — PreToolUse(Skill). A porta da autonomia (README §17).
# Espelho de guard-autopilot.ps1.
#
# Os cinco estágios orquestráveis perderam `disable-model-invocation`, então a invariante 9
# ("estágios não invocam estágios") passou a depender DESTE hook. Autoriza invocação-pelo-modelo
# só na interseção de: sentinela de run ativa ∩ teto do stage-map ∩ escopo do run.
# O próprio /autopilot nunca é invocável pelo modelo: iniciar um run é ato do operador.
#
# Uso (projeto, settings.json): guard-autopilot.sh

. "$(dirname "$0")/_lib.sh"

input=$(cat)
# payload sem skill: condição benigna, não é a vez deste hook
printf '%s' "$input" | grep -Eq '"skill"' || exit 0
require_jq
skill=$(printf '%s' "$input" | jq -r '.tool_input.skill // empty' 2>/dev/null)
[ -n "$skill" ] || exit 0
name="${skill#claude-factory:}"

# ── é estágio da factory? ─────────────────────────────────────────────────────
# DIVERGÊNCIA DELIBERADA dos hooks irmãos, que saem 0 com stage-map ilegível: aqui isso seria
# buraco novo (mapa corrompido + flag removida = autonomia ambiente sem pré-condição, e antes
# da §17 a flag era o backstop). Mapa ilegível degrada para a lista de fallback, nunca para
# "livre". Estágio orquestrável novo entra AQUI também.
FALLBACK="design tasks code close sync"

ceiling=""
if [ -f "$(stage_map_path)" ]; then
  role_of=$(stage_field "$name" '.role')
  [ -n "$role_of" ] || exit 0          # skill que não é estágio: livre
  ceiling=$(jq -r '.stages.autopilot.orchestrates[]? // empty' "$(stage_map_path)" 2>/dev/null | tr '\n' ' ')
  [ -n "$(printf '%s' "$ceiling" | tr -d '[:space:]')" ] || ceiling="$FALLBACK"
else
  if [ "$name" != "autopilot" ] && ! printf '%s\n' $FALLBACK | grep -qx "$name"; then exit 0; fi
  ceiling="$FALLBACK"
fi

# ── o orquestrador não se invoca ──────────────────────────────────────────────
if [ "$name" = "autopilot" ]; then
  deny "guard-autopilot: /autopilot não é invocável pelo modelo — iniciar um run é ato do operador (README §17). É no ato de iniciar que ele pré-delega as decisões do run; um estágio que se auto-inicia seria autonomia se autoconcedendo. Peça ao operador que digite /autopilot."
fi

# ── 1. teto versionado ────────────────────────────────────────────────────────
# ANTES da sentinela, de propósito: estágio fora do teto nunca é liberável por run nenhum, e
# dizer "sem run ativo" para ele seria mensagem enganosa — sugere que um run resolveria.
# Ex.: /promote é faixa PO, fora do teto; a resposta correta é "fora do teto", não "sem run".
if ! printf '%s\n' $ceiling | grep -qx "$name"; then
  deny "guard-autopilot: /$name não é orquestrável — está fora de stages.autopilot.orchestrates ($ceiling). Nenhum run de autopilot libera este estágio: comandos de estágio fora do teto são do operador (invariante 9). O teto é contrato versionado — ampliá-lo é mudança de factory, revisada e commitada (README §17)."
fi

# ── 2. sentinela existe? ──────────────────────────────────────────────────────
sentinel="$(project_root)/.claude/.factory/autopilot/active.json"
if [ ! -f "$sentinel" ]; then
  deny "guard-autopilot: /$name não é invocável pelo modelo sem run de autopilot ativo — estágios não invocam estágios (invariante 9). Comandos de estágio são do operador: informe o próximo passo e devolva a decisão, não o execute. Para execução autônoma, o operador inicia um run com /autopilot (README §17)."
fi

# Sentinela ilegível FALHA FECHADA — ao contrário do payload do hook. Ela é o insumo que
# concede autonomia: na dúvida, mais prompts, nunca menos segurança (§1).
if ! jq -e . "$sentinel" >/dev/null 2>&1; then
  deny "guard-autopilot: a sentinela de run existe mas está ilegível ($sentinel) — negando /$name. Sentinela é o que concede autonomia: ilegível não vira permissiva. Remova-a e re-inicie o run com /autopilot."
fi

# ── 3. escopo deste run ───────────────────────────────────────────────────────
scope=$(jq -r '.stages[]? // empty' "$sentinel" 2>/dev/null | tr '\n' ' ')
if [ -z "$(printf '%s' "$scope" | tr -d '[:space:]')" ]; then
  deny "guard-autopilot: a sentinela de run não declara o campo 'stages' — negando /$name. Run sem escopo explícito seria escopo ilimitado. Re-inicie com /autopilot, que grava o escopo do run."
fi
if ! printf '%s\n' $scope | grep -qx "$name"; then
  deny "guard-autopilot: /$name está fora do escopo DESTE run (sentinela stages: $scope). O run declara o que vai executar; ampliar no meio é decisão do operador — encerre e re-inicie com /autopilot."
fi

exit 0

#!/usr/bin/env bash
# gate-stage — UserPromptExpansion. Pré-condições de estágio antes de o modelo ver o prompt
# (README §5, §15). Espelho de gate-stage.ps1.
# Uso: gate-stage.sh            (projeto)
#      gate-stage.sh --role po  (perfil de papel)

. "$(dirname "$0")/_lib.sh"

ROLE=""
case "$1" in --role|-Role) ROLE="$2" ;; esac

input=$(cat)
# pré-filtro cru: se nem parece comando de estágio, não exige jq (gate roda em TODO prompt)
printf '%s' "$input" | grep -Eq '/(claude-factory:)?(vision|blueprint|ground|propose|promote|bug|design|tasks|code|close|setup|sync)' || exit 0
require_jq
prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null)
[ -n "$prompt" ] || exit 0

stage=$(printf '%s' "$prompt" | sed -nE 's@^[[:space:]]*/(claude-factory:)?([a-z][a-z-]*).*@\2@p' | head -1)
[ -n "$stage" ] || exit 0

[ -f "$(stage_map_path)" ] || exit 0
role_of=$(stage_field "$stage" '.role')
[ -n "$role_of" ] || exit 0   # não é estágio da factory

# ── 1. papel ──────────────────────────────────────────────────────────────────
if [ -n "$ROLE" ]; then
  allowed=$(jq -r ".roles[\"$ROLE\"][]? // empty" "$(stage_map_path)" 2>/dev/null)
  if [ -n "$allowed" ] && ! printf '%s\n' "$allowed" | grep -qx "$stage"; then
    deny "gate-stage: o papel '$ROLE' não roda /$stage. Comandos do papel: $(printf '%s' "$allowed" | tr '\n' ' '). Papel é perfil, não prefixo (README §2)."
  fi
fi

# ── 2. working tree limpa ou suja só no próprio write-set (retomada, §5) ──────
# /code: o write-set real é o Toca das tasks — a retomada é julgada pelo check-toca (§10)
if [ "$stage" = "code" ]; then
  "$(dirname "$0")/check-toca.sh" </dev/null || exit 2
fi
writes=()
while IFS= read -r g; do writes+=("$g"); done < <(stage_field "$stage" '.writes[]')
writes+=('.claude/agent-memory/**')

foreign=""
while IFS= read -r p; do
  [ -n "$p" ] || continue
  matches_globs "$p" "${writes[@]}" || foreign="$foreign $p"
done < <(dirty_paths)

if [ -n "$foreign" ]; then
  deny "gate-stage: working tree suja fora do write-set de /$stage — tripwire: estágio anterior não terminou (commit faltando) ou edição por fora da factory (§5). Paths:$foreign. Resolva antes de rodar /$stage."
fi

# ── 3. artefatos requeridos ───────────────────────────────────────────────────
root="$(project_root)"
while IFS= read -r req; do
  [ -n "$req" ] || continue
  if ! compgen -G "$root/$req" >/dev/null; then
    deny "gate-stage: /$stage requer '$req' e ele não existe. Rode antes o estágio que o gera (README §3, §13)."
  fi
done < <(stage_field "$stage" '.requires[]?')

# ── 4. frescor de docs/** (§5) ───────────────────────────────────────────────
consumes=$(stage_field "$stage" '.consumesDocs')
if [ "$consumes" = "true" ] && [ -n "$(git remote 2>/dev/null)" ]; then
  # nunca pendurar em prompt de credencial: o gate é não-interativo — falhe rápido e DIGA a causa
  errf=$(mktemp 2>/dev/null || echo "/tmp/factory-fetch-$$.err")
  start=$(date +%s)
  if command -v timeout >/dev/null 2>&1; then
    GIT_TERMINAL_PROMPT=0 timeout 8 git -c credential.interactive=never fetch --quiet 2>"$errf"
  else
    GIT_TERMINAL_PROMPT=0 git -c credential.interactive=never fetch --quiet 2>"$errf"
  fi
  fetch_rc=$?
  dur=$(( $(date +%s) - start ))
  if [ "$fetch_rc" -eq 0 ]; then
    rm -f "$errf" "$(project_root)/.claude/.factory/fetch-last-cause"
    # comparação contra o TRUNK remoto, nunca o upstream da branch: docs/** é trunk-based (§5) —
    # branch antiga "em dia consigo mesma" também é verdade vencida
    trunk=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
    if [ -z "$trunk" ]; then
      for cand in origin/main origin/master; do
        if git rev-parse --verify --quiet "$cand" >/dev/null 2>&1; then trunk="$cand"; break; fi
      done
    fi
    if [ -n "$trunk" ]; then
      # estágios que projetam o board inteiro só rodam NO trunk (stage-map: requiresTrunk):
      # branch com docs próprios projetaria verdade que talvez nunca chegue ao trunk;
      # ahead na main é legítimo (done = closure commitado pré-push)
      if [ "$(stage_field "$stage" '.requiresTrunk')" = "true" ]; then
        cur_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
        upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
        trunk_local="${trunk#*/}"
        if [ "$cur_branch" = "HEAD" ] || { [ "$cur_branch" != "$trunk_local" ] && [ "$upstream" != "$trunk" ]; }; then
          deny "gate-stage: /$stage projeta o board compartilhado inteiro e só roda no TRUNK ($trunk_local, rastreando $trunk) — você está em '$cur_branch'. Branch fora do trunk pode carregar docs/** que nunca chegarão ao trunk: projetá-los dessincronizaria todos os operadores. Vá ao trunk atualizado (atos do operador — o modelo não troca de branch) e re-rode."
        fi
      fi
      behind=$(git rev-list --count "HEAD..$trunk" -- docs/ 2>/dev/null)
      if [ -n "$behind" ] && [ "$behind" -gt 0 ] 2>/dev/null; then
        deny "gate-stage: docs/** está $behind commit(s) atrás do trunk remoto ($trunk) — consumir verdade vencida é o mesmo bug que tree suja, só que silencioso (§5). Reconcilie (atos do operador — o modelo não troca de branch): no trunk, git pull --ff-only; se você está numa branch antiga, volte ao trunk atualizado antes."
      fi
    else
      echo "aviso gate-stage: não consegui resolver o trunk remoto (origin/HEAD, origin/main, origin/master) — frescor de docs/** não confirmado; prosseguindo (§5)."
    fi
  else
    cause="exit $fetch_rc"
    [ "$fetch_rc" -eq 124 ] && cause="timeout 8s"
    errtail=$(tail -3 "$errf" 2>/dev/null | tr '\n' ' ')
    rm -f "$errf"
    # o diagnóstico sobrevive à paráfrase do modelo: toda falha vai para o log
    diag="$(project_root)/.claude/.factory"
    mkdir -p "$diag"
    printf '%s | %s, %ss%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$cause" "$dur" "${errtail:+ — stderr: $errtail}" >> "$diag/fetch-failures.log"
    # causa repetida = uma linha curta; causa nova/mudada = aviso completo
    last=""
    [ -f "$diag/fetch-last-cause" ] && last=$(cat "$diag/fetch-last-cause" 2>/dev/null)
    if [ "$last" = "$cause" ]; then
      echo "aviso gate-stage: git fetch segue falhando ($cause) — detalhes em .claude/.factory/fetch-failures.log; prosseguindo (§5)."
    else
      printf '%s' "$cause" > "$diag/fetch-last-cause"
      echo "aviso gate-stage: git fetch falhou ($cause, ${dur}s)${errtail:+ — stderr: $errtail} — prosseguindo sem confirmação de frescor de docs/** (§5). Diagnóstico completo em .claude/.factory/fetch-failures.log. O gate roda sem prompt de credencial (GIT_TERMINAL_PROMPT=0): se a causa é autenticação, rode 'git fetch' manualmente uma vez e a credencial ficará em cache."
    fi
  fi
fi

exit 0

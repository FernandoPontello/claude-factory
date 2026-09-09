# guard-autopilot — PreToolUse(Skill). A porta da autonomia (README §17).
#
# Antes do modo autopilot, "estágios não invocam estágios" (invariante 9) era garantido por
# `disable-model-invocation: true` no frontmatter de TODA skill de estágio. Os cinco estágios
# orquestráveis (design, tasks, code, close, sync) perderam a flag — logo o invariante passou a
# depender DESTE hook. Ele é o que mantém a invariante 9 literalmente verdadeira fora de um run.
#
# Autoriza invocação-pelo-modelo de um estágio SOMENTE se, cumulativamente:
#   1. existe a sentinela .claude/.factory/autopilot/active.json (run ativo, iniciado pelo operador)
#   2. o estágio está no TETO versionado — stages.autopilot.orchestrates do stage-map
#   3. o estágio está no escopo DESTE run — campo `stages` da sentinela
# Teto ∩ escopo, nunca união: a sentinela é arquivo de runtime, o stage-map é contrato
# versionado. Sentinela forjada não amplia o que o stage-map não declarou.
#
# O próprio /autopilot NUNCA é invocável pelo modelo: iniciar um run é ato do operador — é o
# ponto em que ele pré-delega as decisões (§17). Estágio que se auto-inicia seria autonomia
# se autoconcedendo.
#
# Uso (projeto, settings.json): guard-autopilot.ps1

. "$PSScriptRoot\_lib.ps1"

$in = Read-HookInput
if (-not $in) { exit 0 }                      # payload ilegível: condição benigna (hooks/README)
$skill = [string]$in.tool_input.skill
if (-not $skill) { exit 0 }
$name = $skill -replace '^claude-factory:', ''

# ── é estágio da factory? ────────────────────────────────────────────────────
# DIVERGÊNCIA DELIBERADA dos hooks irmãos: gate-stage, guard-skill, guard-writes e stop-scan
# saem 0 quando o stage-map é ilegível. Aqui isso seria um buraco novo — stage-map corrompido
# + flag removida = autonomia ambiente com zero pré-condição, e antes da §17 a flag era o
# backstop. Então há uma lista de fallback: mapa ilegível degrada para ela, nunca para "livre".
# Duplicação assumida (o pré-filtro do gate-stage.sh já assume a mesma) — estágio orquestrável
# novo entra AQUI também. Divergir para menos é falso-negativo de segurança; divergir para mais
# só custa um Deny explicável.
$FALLBACK_ORCHESTRABLE = @('design', 'tasks', 'code', 'close', 'sync')

$map = Get-StageMap
if ($map) {
    if (-not $map.stages.$name) { exit 0 }    # skill que não é estágio: livre
    $ceiling = @($map.stages.autopilot.orchestrates)
    if ($ceiling.Count -eq 0) { $ceiling = $FALLBACK_ORCHESTRABLE }
} else {
    if ($FALLBACK_ORCHESTRABLE -notcontains $name -and $name -ne 'autopilot') { exit 0 }
    $ceiling = $FALLBACK_ORCHESTRABLE
}

# ── o orquestrador não se invoca ─────────────────────────────────────────────
if ($name -eq 'autopilot') {
    Deny ("guard-autopilot: /autopilot não é invocável pelo modelo — iniciar um run é ato do operador (README §17).`n" +
          "É no ato de iniciar que ele pré-delega as decisões do run; um estágio que se auto-inicia seria autonomia se autoconcedendo. Peça ao operador que digite /autopilot.")
}

# ── 1. teto versionado ───────────────────────────────────────────────────────
# ANTES da sentinela, de propósito: estágio fora do teto nunca é liberável por run nenhum, e
# dizer "sem run ativo" para ele seria mensagem enganosa — sugere que um run resolveria.
# Ex.: /promote é faixa PO, fora do teto; a resposta correta é "fora do teto", não "sem run".
if ($ceiling -notcontains $name) {
    Deny ("guard-autopilot: /$name não é orquestrável — está fora de stages.autopilot.orchestrates ($($ceiling -join ', ')).`n" +
          "Nenhum run de autopilot libera este estágio: comandos de estágio fora do teto são do operador (invariante 9). O teto é contrato versionado — ampliá-lo é mudança de factory, revisada e commitada (README §17).")
}

# ── 2. sentinela existe? ─────────────────────────────────────────────────────
$sentinelPath = Join-Path (Get-ProjectRoot) '.claude/.factory/autopilot/active.json'
if (-not (Test-Path $sentinelPath)) {
    Deny ("guard-autopilot: /$name não é invocável pelo modelo sem run de autopilot ativo — estágios não invocam estágios (invariante 9).`n" +
          "Comandos de estágio são do operador: informe o próximo passo e devolva a decisão, não o execute. Para execução autônoma, o operador inicia um run com /autopilot (README §17).")
}

# Sentinela ilegível FALHA FECHADA — ao contrário do payload do hook. Ela é o insumo que
# concede autonomia: na dúvida, mais prompts, nunca menos segurança (§1).
try {
    $sentinel = Get-Content $sentinelPath -Raw -ErrorAction Stop | ConvertFrom-Json
} catch {
    Deny ("guard-autopilot: a sentinela de run existe mas está ilegível ($sentinelPath) — negando /$name.`n" +
          "Sentinela é o que concede autonomia: ilegível não vira permissiva. Remova-a e re-inicie o run com /autopilot.")
}

# ── 3. escopo deste run ──────────────────────────────────────────────────────
$scope = @($sentinel.stages)
if ($scope.Count -eq 0) {
    Deny ("guard-autopilot: a sentinela de run não declara o campo 'stages' — negando /$name.`n" +
          "Run sem escopo explícito seria escopo ilimitado. Re-inicie com /autopilot, que grava o escopo do run.")
}
if ($scope -notcontains $name) {
    Deny ("guard-autopilot: /$name está fora do escopo DESTE run (sentinela stages: $($scope -join ', ')).`n" +
          "O run declara o que vai executar; ampliar no meio é decisão do operador — encerre e re-inicie com /autopilot.")
}

exit 0

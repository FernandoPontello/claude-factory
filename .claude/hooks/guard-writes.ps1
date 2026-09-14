# guard-writes — PreToolUse(Edit|Write|NotebookEdit). Single-writer durante o estágio (README §14, §15).
#
# Uso (frontmatter de skill):    guard-writes.ps1 -Stage design
# Uso (perfil de papel, ex. PO): guard-writes.ps1 -Role po
#                                (-Role libera a UNIÃO dos write-sets dos estágios do papel —
#                                 o -Stage da skill ativa aperta para o write-set do estágio)
# Uso (allow explícito):         guard-writes.ps1 -Allow "docs/proposals/**"
#
# O write-set por estágio vem de .claude/hooks/stage-map.json (fonte única).
# .claude/agent-memory/** é sempre liberado (memória institucional dos agents, §15).
#
# DENTRO de um run de autopilot (§17) o -Stage resolve para o write-set do estágio que a
# sentinela declara em curso, não para o do estágio que registrou o hook: hooks de skill
# acumulam e compõem por AND, então write-sets diferentes intersectariam em vazio
# (ver Get-AutopilotWriteGlobs em _lib.ps1).

param(
    [string]$Stage,
    [string]$Allow,
    [string]$Role
)

. "$PSScriptRoot\_lib.ps1"

$in = Read-HookInput
if (-not $in) { exit 0 }
$file = $in.tool_input.file_path
if (-not $file) { $file = $in.tool_input.notebook_path }
if (-not $file) { exit 0 }

$globs = @()
$runStage = ''
$inRun = $false
if ($Allow) {
    $globs = @($Allow -split ',')
} elseif ($Stage) {
    $map = Get-StageMap
    if (-not $map -or -not $map.stages.$Stage) { exit 0 }
    $runGlobs = Get-AutopilotWriteGlobs $map $Stage
    if ($runGlobs) {
        $inRun = $true
        $runStage = Get-AutopilotCurrentStage $map
        $globs = $runGlobs
    } else {
        $globs = @($map.stages.$Stage.writes)
    }
} elseif ($Role) {
    $map = Get-StageMap
    if (-not $map -or -not $map.roles.$Role) { exit 0 }
    foreach ($st in @($map.roles.$Role)) {
        $globs += @($map.stages.$st.writes)
    }
} else {
    exit 0
}
$globs += '.claude/agent-memory/**'

$rel = ConvertTo-RelPath $file
if (-not (Test-MatchesGlobs $rel $globs)) {
    $who = if ($Stage) { "/$Stage" } elseif ($Role) { "o papel '$Role'" } else { 'este papel' }
    $ctx = ''
    if ($inRun -and $runStage) {
        $ctx = " (run de autopilot: o write-set ativo é o de /$runStage, estágio em curso na sentinela" +
               $(if ($runStage -ne $Stage) { " — se o run já avançou, atualize a posição em .claude/.factory/autopilot/active.json antes de escrever)" } else { ")" })
    } elseif ($inRun) {
        $ctx = " (run de autopilot: sentinela sem posição em curso — o write-set ativo é a união do escopo do run)"
    }
    Deny "single-writer: $who$ctx só escreve em: $(($globs | Select-Object -SkipLast 1) -join ', '). Caminho bloqueado: $rel (README §14)."
}
exit 0

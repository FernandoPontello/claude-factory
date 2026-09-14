# stop-scan — Stop (frontmatter de skill de estágio). Scan de single-writer (README §15).
#
# Cobre a brecha de escrita via Bash e a de sub-agents genéricos: o guard-writes
# intercepta Edit|Write na sessão, mas um `echo > arquivo` — ou a escrita de um sub-agent
# sem frontmatter, que não tem guard in-flight — passa por baixo. No Stop, qualquer path
# sujo fora do write-set do estágio bloqueia com feedback — o modelo reverte ou justifica.
#
# Sujeira DENTRO do write-set não bloqueia: estágios de discussão param várias vezes
# antes do commit final. O que este hook vigia é fronteira, não conclusão.
#
# DENTRO de um run de autopilot (§17) o write-set é o do estágio em curso na sentinela, e não
# o do estágio que registrou este hook — hooks de Stop acumulam igual aos de PreToolUse
# (ver Get-AutopilotWriteGlobs em _lib.ps1).
#
# Uso: stop-scan.ps1 -Stage design

param([Parameter(Mandatory = $true)][string]$Stage)

. "$PSScriptRoot\_lib.ps1"

$map = Get-StageMap
if (-not $map -or -not $map.stages.$Stage) { exit 0 }
$runGlobs = Get-AutopilotWriteGlobs $map $Stage
$runStage = ''
if ($runGlobs) {
    $runStage = Get-AutopilotCurrentStage $map
    $globs = @($runGlobs) + '.claude/agent-memory/**'
} else {
    $globs = @($map.stages.$Stage.writes) + '.claude/agent-memory/**'
}

$dirty = Get-DirtyPaths
$foreign = @($dirty | Where-Object { -not (Test-MatchesGlobs $_ $globs) })

if ($foreign.Count -gt 0) {
    $alvo = if ($runStage) { "/$runStage (estágio em curso no run de autopilot)" } else { "/$Stage" }
    Deny ("stop-scan: escrita fora do write-set de $alvo detectada no working tree:`n" +
          "  $($foreign -join "`n  ")`n" +
          "Single-writer (§14): reverta esses paths (git rm/restauração manual do conteúdo original) ou explique ao operador por que a exceção se justifica antes de encerrar.")
}
exit 0

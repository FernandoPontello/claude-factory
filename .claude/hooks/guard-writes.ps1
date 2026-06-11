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
if ($Allow) {
    $globs = @($Allow -split ',')
} elseif ($Stage) {
    $map = Get-StageMap
    if (-not $map -or -not $map.stages.$Stage) { exit 0 }
    $globs = @($map.stages.$Stage.writes)
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
    Deny "single-writer: $who só escreve em: $(($globs | Select-Object -SkipLast 1) -join ', '). Caminho bloqueado: $rel (README §14)."
}
exit 0

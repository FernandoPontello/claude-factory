# guard-skill — PreToolUse(Skill). Barra invocação de estágio fora da lista do papel (README §2, §15).
#
# É a segunda porta de entrada: gate-stage barra o comando digitado; este hook barra a
# invocação pelo modelo. Estágios também carregam disable-model-invocation — defesa em
# profundidade para o dia em que alguém relaxar o frontmatter.
#
# Uso (frontmatter do perfil): guard-skill.ps1 -Role po

param([Parameter(Mandatory = $true)][string]$Role)

. "$PSScriptRoot\_lib.ps1"

$in = Read-HookInput
if (-not $in) { exit 0 }
$skill = [string]$in.tool_input.skill
if (-not $skill) { exit 0 }
$name = $skill -replace '^claude-factory:', ''

$map = Get-StageMap
if (-not $map -or -not $map.stages.$name) { exit 0 }   # skill que não é estágio: livre

$allowed = @($map.roles.$Role)
if ($allowed -notcontains $name) {
    Deny "guard-skill: o papel '$Role' não invoca /$name. Skills do papel: $($allowed -join ', ') (README §2)."
}
exit 0

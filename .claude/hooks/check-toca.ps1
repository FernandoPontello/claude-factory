# check-toca — Stop do /code. O `Toca` é contrato verificado, não declaração (README §10).
#
# Compara git status --porcelain contra a união dos write-sets (`## Toca`) declarados nas
# tasks dos épicos ativos. Divergência bloqueia com feedback: o modelo justifica e reverte,
# ou o desvio vira candidato a pendência no fechamento. É o que valida empiricamente a
# premissa de disjunção antes de qualquer execução concorrente confiar nela.

. "$PSScriptRoot\_lib.ps1"

# Acumulação de hooks num run de autopilot (§17): o Stop do /code continua registrado depois
# que o estágio termina. O /close ou o /design seguinte para com a tree suja DELE, e este hook
# acusaria paths que não pertencem a task nenhuma — bloqueio sem defeito real. Quando a
# sentinela declara OUTRO estágio em curso, quem vigia a fronteira é o stop-scan daquele
# estágio, que já resolve o write-set pela mesma posição. Aqui, no-op.
# Sentinela ausente, ilegível ou sem posição legível NÃO silencia: degradar aqui é continuar
# checando. E a posição só vale dentro de teto ∩ escopo (Get-AutopilotCurrentStage).
$currentStage = Get-AutopilotCurrentStage (Get-StageMap)
if ($currentStage -and $currentStage -ne 'code') { exit 0 }

$dirty = Get-DirtyPaths
if ($dirty.Count -eq 0) { exit 0 }

$root = Get-ProjectRoot

# Write-set sempre permitido ao /code: as próprias tasks (Status, ## Tempo).
$allowed = @('docs/epics/*/tasks/*.md')

# Une o `## Toca` das tasks EM VOO: Status pendente, ou o próprio task.md sujo no tree.
# Task concluída e commitada fecha seu write-set — o Toca dela não fica aberto para sempre.
$dirtySet = @{}
foreach ($d in $dirty) { $dirtySet[(ConvertTo-RelPath $d)] = $true }

$taskFiles = @(Get-ChildItem -Path (Join-Path $root 'docs/epics/*/tasks/*.md') -ErrorAction SilentlyContinue)
foreach ($tf in $taskFiles) {
    $content = Get-Content $tf.FullName -Raw -ErrorAction SilentlyContinue
    if (-not $content) { continue }
    $isPending = $content -match '(?ms)^##\s+Status\s*\r?\n\s*pendente'
    $isDirty = $dirtySet.ContainsKey((ConvertTo-RelPath $tf.FullName))
    if (-not ($isPending -or $isDirty)) { continue }
    $m = [Regex]::Match($content, '(?ms)^##\s+Toca\s*\r?\n(.*?)(?=^##\s|\z)')
    if (-not $m.Success) { continue }
    foreach ($line in ($m.Groups[1].Value -split "`r?`n")) {
        $entry = $line.Trim() -replace '^[-*]\s*', ''
        if (-not $entry) { continue }
        if ($entry.StartsWith('<!--') -or $entry.StartsWith('[')) { continue }   # placeholder de template
        # entradas podem vir com comentário após " — " ou " #"
        $entry = ($entry -split '\s+—\s+|\s+#')[0].Trim()
        if ($entry) { $allowed += $entry }
    }
}

$violations = @($dirty | Where-Object { -not (Test-MatchesGlobs $_ $allowed) })

if ($violations.Count -gt 0) {
    Deny ("check-toca: o diff real diverge do `Toca` declarado (§10). Paths fora de qualquer write-set de task:`n" +
          "  $($violations -join "`n  ")`n" +
          "Opções: (a) reverta o desvio; (b) se a escrita é legítima, justifique ao operador — o desvio vira candidato a pendência no /close. Nunca commite por cima da divergência em silêncio.")
}
exit 0

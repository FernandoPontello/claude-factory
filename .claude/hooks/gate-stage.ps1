# gate-stage — UserPromptExpansion. Pré-condições de estágio ANTES de o modelo ver o prompt (README §5, §15).
#
# Valida, na ordem:
#   1. papel (se -Role): o estágio pertence à lista do papel (§2)
#   2. working tree limpa OU suja só dentro do write-set do próprio estágio (retomada, §5)
#   3. artefatos requeridos existem (§3)
#   4. frescor: git fetch (timeout curto) e bloqueio se docs/** está behind do origin (§5)
#      — behind confirmado = bloqueio e instrução do ff-only; fetch falho = aviso e prossegue.
#
# Uso (projeto, settings.json):   gate-stage.ps1
# Uso (perfil de papel, ex. PO):  gate-stage.ps1 -Role po

param([string]$Role)

. "$PSScriptRoot\_lib.ps1"

$in = Read-HookInput
if (-not $in) { exit 0 }
$prompt = [string]$in.prompt
if (-not $prompt) { exit 0 }
if ($prompt -notmatch '^\s*/(?:claude-factory:)?([a-z][a-z-]*)') { exit 0 }
$stageName = $Matches[1]

$map = Get-StageMap
if (-not $map) { exit 0 }
$stage = $map.stages.$stageName
if (-not $stage) { exit 0 }   # não é estágio da factory — segue

# ── 1. papel ─────────────────────────────────────────────────────────────────
if ($Role) {
    $allowed = @($map.roles.$Role)
    if ($allowed.Count -gt 0 -and $allowed -notcontains $stageName) {
        Deny "gate-stage: o papel '$Role' não roda /$stageName. Comandos do papel: $($allowed -join ', '). Papel é perfil, não prefixo (README §2)."
    }
}

# ── 2. working tree ──────────────────────────────────────────────────────────
if ($stageName -eq 'code') {
    # o write-set real do /code é o Toca das tasks — a retomada é julgada pelo check-toca (§10),
    # senão writes:["**"] deixaria o /code herdar qualquer sujeira alheia
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'check-toca.ps1')
    if ($LASTEXITCODE -eq 2) { exit 2 }
}
$dirty = if ($stageName -eq 'code') { @() } else { Get-DirtyPaths }
if ($dirty.Count -gt 0) {
    $foreign = @($dirty | Where-Object { -not (Test-MatchesGlobs $_ (@($stage.writes) + '.claude/agent-memory/**')) })
    if ($foreign.Count -gt 0) {
        Deny ("gate-stage: working tree suja fora do write-set de /$stageName — tripwire: estágio anterior não terminou (commit faltando) ou edição por fora da factory (§5).`n" +
              "Paths: $($foreign -join ', ')`nResolva (commite pelo estágio dono, ou descarte deliberadamente) antes de rodar /$stageName.")
    }
    # suja só no próprio write-set = retomada de estágio interrompido — segue (§5)
}

# ── 3. artefatos requeridos ──────────────────────────────────────────────────
foreach ($req in @($stage.requires)) {
    if (-not $req) { continue }
    $found = Get-ChildItem -Path (Join-Path (Get-ProjectRoot) $req) -ErrorAction SilentlyContinue
    if (-not $found) {
        Deny "gate-stage: /$stageName requer '$req' e ele não existe. Rode antes o estágio que o gera (README §3, §13)."
    }
}

# ── 4. frescor de docs/** ────────────────────────────────────────────────────
if ($stage.consumesDocs) {
    $remotes = @(git remote 2>$null)
    if ($LASTEXITCODE -eq 0 -and $remotes.Count -gt 0) {
        # nunca pendurar em prompt de credencial: o gate é não-interativo — falhe rápido e DIGA a causa
        $env:GIT_TERMINAL_PROMPT = '0'
        $fetchOk = $false; $cause = ''
        $errFile = Join-Path $env:TEMP ("factory-fetch-" + [Guid]::NewGuid().ToString('N') + '.err')
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $proc = Start-Process -FilePath 'git' `
                -ArgumentList '-c', 'credential.interactive=never', 'fetch', '--quiet' `
                -NoNewWindow -PassThru -WorkingDirectory (Get-ProjectRoot) `
                -RedirectStandardError $errFile
            $null = $proc.Handle   # PS 5.1: sem tocar o Handle, ExitCode vem nulo após WaitForExit(ms)
            if ($proc.WaitForExit(8000)) {
                $fetchOk = ($proc.ExitCode -eq 0)
                if (-not $fetchOk) { $cause = "exit $($proc.ExitCode)" }
            } else {
                try { $proc.Kill() } catch {}
                $cause = 'timeout 8s'
            }
        } catch { $cause = "exceção: $($_.Exception.Message)" }
        $sw.Stop()
        $stderrTail = ''
        if (Test-Path $errFile) {
            $stderrTail = ((Get-Content $errFile -ErrorAction SilentlyContinue | Select-Object -Last 3) -join ' | ')
            Remove-Item $errFile -Force -ErrorAction SilentlyContinue
        }

        if ($fetchOk) {
            # causa anterior resolvida: a próxima falha volta a avisar verboso
            Remove-Item (Join-Path (Get-ProjectRoot) '.claude/.factory/fetch-last-cause') -Force -ErrorAction SilentlyContinue
            $behind = git rev-list --count 'HEAD..@{upstream}' -- docs/ 2>$null
            if ($LASTEXITCODE -eq 0 -and $behind -and [int]$behind -gt 0) {
                Deny ("gate-stage: docs/** está $behind commit(s) atrás do origin — consumir verdade vencida é o mesmo bug que tree suja, só que silencioso (§5).`n" +
                      "Reconcilie com: git pull --ff-only")
            }
        } else {
            # origin inacessível não paralisa trabalho local — try-reporta-prossegue aplicado ao git (§5)
            $detail = "$cause, $([int]$sw.Elapsed.TotalMilliseconds)ms"
            if ($stderrTail) { $detail += " — stderr: $stderrTail" }
            # o diagnóstico sobrevive à paráfrase do modelo: toda falha vai para o log
            $diagDir = Join-Path (Get-ProjectRoot) '.claude/.factory'
            New-Item -ItemType Directory -Force -Path $diagDir | Out-Null
            Add-Content -Path (Join-Path $diagDir 'fetch-failures.log') `
                -Value "$((Get-Date).ToUniversalTime().ToString('o')) | $detail" -Encoding utf8
            # causa repetida = uma linha curta; causa nova/mudada = aviso completo
            $causeFile = Join-Path $diagDir 'fetch-last-cause'
            $lastCause = if (Test-Path $causeFile) { (Get-Content $causeFile -Raw -ErrorAction SilentlyContinue).Trim() } else { '' }
            if ($lastCause -eq $cause) {
                Write-Output "aviso gate-stage: git fetch segue falhando ($cause) — detalhes em .claude/.factory/fetch-failures.log; prosseguindo (§5)."
            } else {
                Set-Content -Path $causeFile -Value $cause -Encoding utf8
                Write-Output ("aviso gate-stage: git fetch falhou ($detail) — prosseguindo sem confirmação de frescor de docs/** (§5). " +
                              "Diagnóstico completo em .claude/.factory/fetch-failures.log. O gate roda sem prompt de credencial (GIT_TERMINAL_PROMPT=0): se a causa é autenticação, rode 'git fetch' manualmente uma vez e a credencial ficará em cache.")
            }
        }
    }
}

exit 0

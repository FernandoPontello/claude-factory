# Biblioteca comum dos hooks da factory (variante PowerShell).
# Dot-source: . "$PSScriptRoot\_lib.ps1"

function Read-HookInput {
    $raw = [Console]::In.ReadToEnd()
    if (-not $raw) { return $null }
    try { return $raw | ConvertFrom-Json } catch { return $null }
}

function Get-ProjectRoot {
    if ($env:CLAUDE_PROJECT_DIR) { return $env:CLAUDE_PROJECT_DIR }
    return (Get-Location).Path
}

function Get-StageMap {
    $path = Join-Path (Get-ProjectRoot) '.claude/hooks/stage-map.json'
    if (-not (Test-Path $path)) { return $null }
    try { return Get-Content $path -Raw | ConvertFrom-Json } catch { return $null }
}

function Convert-GlobToRegex([string]$Glob) {
    $g = $Glob -replace '\\', '/'
    $esc = [Regex]::Escape($g)
    $esc = $esc -replace '\\\*\\\*/', '(?:.*/)?'   # **/ -> zero ou mais diretórios
    $esc = $esc -replace '\\\*\\\*', '.*'          # **  -> qualquer profundidade
    $esc = $esc -replace '\\\*', '[^/]*'           # *   -> dentro de um segmento
    return "^$esc$"
}

function ConvertTo-RelPath([string]$Path) {
    $p = $Path -replace '\\', '/'
    $root = (Get-ProjectRoot) -replace '\\', '/'
    if ($root -and $p.ToLower().StartsWith($root.ToLower())) {
        $p = $p.Substring($root.Length).TrimStart('/')
    }
    if ($p.StartsWith('./')) { $p = $p.Substring(2) }
    return $p
}

function Test-MatchesGlobs([string]$Path, [string[]]$Globs) {
    $p = ConvertTo-RelPath $Path
    foreach ($g in $Globs) {
        if (-not $g) { continue }
        if ($p -match (Convert-GlobToRegex $g.Trim())) { return $true }
    }
    return $false
}

function Get-DirtyPaths {
    # Paths sujos do working tree (porcelain). Renames contam os dois lados.
    # -uall: diretórios untracked viriam colapsados ("?? src/") e furariam o match de glob.
    # .claude/.factory/** é rastro de runtime (logs de diagnóstico), nunca verdade — fora do scan
    # mesmo onde o projeto não o gitignorou (o /setup garante o gitignore; isto é defesa em profundidade).
    $lines = @(git status --porcelain -uall 2>$null)
    if ($LASTEXITCODE -ne 0) { return @() }
    $paths = @()
    foreach ($line in $lines) {
        if (-not $line -or -not $line.Trim()) { continue }
        $p = $line.Substring(3).Trim().Trim('"')
        if ($p -match '\s->\s') {
            foreach ($side in ($p -split '\s->\s')) { $paths += $side.Trim().Trim('"') }
        } else {
            $paths += $p
        }
    }
    return @($paths | Where-Object { ($_ -replace '\\', '/') -notmatch '^\.claude/\.factory/' })
}

# ── Write-set ciente de run de autopilot (README §17) ────────────────────────
#
# Hooks PreToolUse/Stop de skill ACUMULAM: invocar /tasks não desativa o guard-writes de
# /design — soma-se a ele. Como hooks compõem por AND, dois write-sets diferentes
# intersectam em VAZIO e nenhum estágio invocado por um run consegue escrever nada.
# Dentro de um run, portanto, todo hook acumulado tem de resolver o MESMO conjunto: o
# write-set do estágio que a sentinela declara em curso — sempre dentro de teto ∩ escopo,
# a mesma aritmética do guard-autopilot (sentinela é runtime; não amplia o que o
# stage-map, contrato versionado, não declarou).

function Get-AutopilotSentinel {
    $path = Join-Path (Get-ProjectRoot) '.claude/.factory/autopilot/active.json'
    if (-not (Test-Path $path)) { return $null }
    # Sentinela ilegível degrada para "sem run" — ao contrário do guard-autopilot, que
    # falha fechado negando. Aqui o fallback é o write-set do estágio ISOLADO, o conjunto
    # mais estreito: degradar é apertar a guarda, não afrouxá-la.
    try { return Get-Content $path -Raw -ErrorAction Stop | ConvertFrom-Json } catch { return $null }
}

# Escopo efetivo do run = sentinela.stages ∩ stages.autopilot.orchestrates. Vazio = sem run.
function Get-AutopilotScope([object]$Map) {
    if (-not $Map) { return @() }
    $sentinel = Get-AutopilotSentinel
    if (-not $sentinel) { return @() }
    $ceiling = @($Map.stages.autopilot.orchestrates)
    if ($ceiling.Count -eq 0) { return @() }
    return @(@($sentinel.stages) | Where-Object { $ceiling -contains $_ })
}

# Estágio em curso segundo a sentinela (item com state 'em-curso'), '' se não houver.
function Get-AutopilotCurrentStage([object]$Map) {
    $sentinel = Get-AutopilotSentinel
    if (-not $sentinel) { return '' }
    $scope = Get-AutopilotScope $Map
    $cur = @(@($sentinel.queue) |
             Where-Object { $_.state -eq 'em-curso' } |
             ForEach-Object { [string]$_.stage } |
             Where-Object { $_ })
    if ($cur.Count -gt 0 -and $scope -contains $cur[0]) { return $cur[0] }
    return ''
}

# Write-set efetivo de $Stage durante um run; $null quando não há run aplicável a ele.
function Get-AutopilotWriteGlobs([object]$Map, [string]$Stage) {
    $scope = Get-AutopilotScope $Map
    if ($scope.Count -eq 0) { return $null }
    # Estágio fora do escopo do run (ex.: /promote digitado pelo operador com run ativo)
    # continua guardado pelo write-set dele. 'autopilot' entra sempre: é o dono da sentinela.
    if ($Stage -ne 'autopilot' -and $scope -notcontains $Stage) { return $null }

    $globs = @()
    $current = Get-AutopilotCurrentStage $Map
    if ($current) {
        $globs = @($Map.stages.$current.writes)
    } else {
        # Sentinela sem posição legível: união do escopo — mais largo, ainda sob o teto.
        foreach ($st in $scope) { $globs += @($Map.stages.$st.writes) }
    }
    # O manifesto do run entra sempre: o orquestrador atualiza a sentinela a cada transição,
    # com o guard do estágio filho já acumulado na sessão.
    $globs += @($Map.stages.autopilot.writes)
    return @($globs | Where-Object { $_ } | Select-Object -Unique)
}

function Deny([string]$Message) {
    [Console]::Error.WriteLine($Message)
    exit 2
}

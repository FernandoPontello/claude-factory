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
    return $paths
}

function Deny([string]$Message) {
    [Console]::Error.WriteLine($Message)
    exit 2
}

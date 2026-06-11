# inject-invariants — SessionStart(matcher: compact). Reinjeta os invariantes da factory
# após cada compactação (README §10, §15): sessões de batch compactam, e as regras
# inegociáveis precisam sobreviver à compaction.

$root = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
$path = Join-Path $root '.claude/rules/factory/invariants.md'
if (Test-Path $path) {
    Get-Content $path -Raw | Write-Output
}
exit 0

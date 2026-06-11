# board-log-failure — PostToolUseFailure(mcp__*) no frontmatter do board-writer (README §11).
#
# Captura estruturada: registra qual verbo/tool falhou e por quê em
# .claude/.factory/board-failures.jsonl — em vez de depender do relato textual do agent.
# O /sync consome esse rastro ao reparar a projeção.

$raw = [Console]::In.ReadToEnd()
$payload = $null
if ($raw) { try { $payload = $raw | ConvertFrom-Json } catch {} }

$root = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
$dir = Join-Path $root '.claude/.factory'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$entry = @{
    ts    = (Get-Date).ToUniversalTime().ToString('o')
    tool  = if ($payload) { $payload.tool_name } else { $null }
    input = if ($payload) { $payload.tool_input } else { $null }
    error = if ($payload) { $payload.error } else { 'payload ilegível' }
} | ConvertTo-Json -Compress -Depth 6

Add-Content -Path (Join-Path $dir 'board-failures.jsonl') -Value $entry -Encoding utf8
exit 0

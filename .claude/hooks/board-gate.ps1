# board-gate — PreToolUse(mcp__*) no frontmatter do board-writer (README §5, §15).
#
# O board só projeta verdade commitada. Board ok + commit perdido = verdade perdida,
# irreparável — a direção de falha que precisa ser IMPOSSÍVEL. Working tree suja
# bloqueia fisicamente qualquer escrita no board.

# .claude/.factory/** é rastro de runtime (diagnóstico dos próprios hooks), nunca verdade a projetar
$dirty = @(git status --porcelain 2>$null | Where-Object { $_ -and $_.Trim() -and (($_.Substring(3) -replace '\\', '/') -notmatch '^"?\.claude/\.factory/') })
if ($LASTEXITCODE -eq 0 -and $dirty.Count -gt 0) {
    $sample = ($dirty | Select-Object -First 5) -join "`n  "
    [Console]::Error.WriteLine("board-gate: working tree suja — o board só projeta verdade commitada (§5). Commite primeiro (factory(<estágio>): ...) e tente de novo.`n  $sample")
    exit 2
}
exit 0

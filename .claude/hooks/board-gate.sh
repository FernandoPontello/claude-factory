#!/usr/bin/env bash
# board-gate — PreToolUse(mcp__*) no frontmatter do board-writer (README §5, §15).
# O board só projeta verdade commitada: tree suja bloqueia fisicamente a escrita.

# .claude/.factory/** é rastro de runtime (diagnóstico dos próprios hooks), nunca verdade a projetar
dirty=$(git status --porcelain 2>/dev/null | grep -Ev '^.{3}"?\.claude/\.factory/')
if [ -n "$dirty" ]; then
  sample=$(printf '%s\n' "$dirty" | head -5)
  printf 'board-gate: working tree suja — o board só projeta verdade commitada (§5). Commite primeiro (factory(<estágio>): ...) e tente de novo.\n%s\n' "$sample" >&2
  exit 2
fi
exit 0

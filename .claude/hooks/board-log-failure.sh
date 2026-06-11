#!/usr/bin/env bash
# board-log-failure — PostToolUseFailure(mcp__*) no frontmatter do board-writer (README §11).
# Registra estruturadamente qual verbo/tool falhou e por quê.

root="${CLAUDE_PROJECT_DIR:-$PWD}"
dir="$root/.claude/.factory"
mkdir -p "$dir"

input=$(cat)
printf '%s' "$input" | jq -c \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{ts: $ts, tool: (.tool_name // null), input: (.tool_input // null), error: (.error // "payload ilegível")}' \
  >> "$dir/board-failures.jsonl" 2>/dev/null \
  || printf '{"ts":"%s","error":"payload ilegível"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$dir/board-failures.jsonl"
exit 0

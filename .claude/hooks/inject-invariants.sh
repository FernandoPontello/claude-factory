#!/usr/bin/env bash
# inject-invariants — SessionStart(matcher: compact). Reinjeta os invariantes da factory
# após cada compactação (README §10, §15).

root="${CLAUDE_PROJECT_DIR:-$PWD}"
f="$root/.claude/rules/factory/invariants.md"
[ -f "$f" ] && cat "$f"
exit 0

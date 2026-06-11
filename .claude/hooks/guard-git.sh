#!/usr/bin/env bash
# guard-git — PreToolUse(Bash). Bloqueia operações git proibidas (README §5, §15).
# Espelho de guard-git.ps1 — ver lá a política completa.

. "$(dirname "$0")/_lib.sh"

# --worker (frontmatter do coder): nega também push/fetch/pull — ver guard-git.ps1
WORKER=""
case "$1" in --worker|-Worker) WORKER=1 ;; esac

input=$(cat)
case "$input" in *git*) ;; *) exit 0 ;; esac
require_jq
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
[ -n "$cmd" ] || exit 0
case "$cmd" in *git*) ;; *) exit 0 ;; esac

git_subcommand() {
  printf '%s\n' "$1" | awk '{
    for (i = 1; i <= NF; i++) {
      if ($i == "git" || $i == "git.exe") {
        for (j = i + 1; j <= NF; j++) {
          if ($j == "-C" || $j == "-c" || $j == "--git-dir" || $j == "--work-tree" || $j == "--exec-path" || $j == "--namespace") { j++; continue }
          if ($j ~ /^-/) continue
          print $j; exit
        }
      }
    }
  }'
}

segs=$(printf '%s\n' "$cmd" | sed -E 's/\|\|/\n/g; s/&&/\n/g; s/;/\n/g; s/\|/\n/g')
while IFS= read -r seg; do
  [ -n "$seg" ] || continue
  sub=$(git_subcommand "$seg" | tr '[:upper:]' '[:lower:]')
  [ -n "$sub" ] || continue
  if [ -n "$WORKER" ]; then
    case "$sub" in
      push|fetch|pull) deny "guard-git (worker): 'git $sub' é proibido no runtime de workflow — sincronização e publicação são da sessão principal (§10)." ;;
    esac
  fi
  case "$sub" in
    merge)         deny "guard-git: 'git merge' é proibido — integração paralela é diff+apply (§10); reconciliação é git pull --ff-only (§5)." ;;
    rebase)        deny "guard-git: 'git rebase' é proibido — sem reescrita de histórico (§5)." ;;
    reset)         deny "guard-git: 'git reset' é destrutivo — checkpoints e commits por task são a rede de undo (§10)." ;;
    checkout)      deny "guard-git: 'git checkout' é proibido pelo guard — worktrees são geridos pela plataforma (§10)." ;;
    switch)        deny "guard-git: 'git switch' é proibido pelo guard (§15)." ;;
    restore)       deny "guard-git: 'git restore' descarta trabalho do working tree (§15)." ;;
    clean)         deny "guard-git: 'git clean' é destrutivo (§15)." ;;
    stash)         deny "guard-git: 'git stash' — estado fora do commit é verdade volátil (§5)." ;;
    cherry-pick)   deny "guard-git: 'git cherry-pick' — integração é diff+apply em ordem topológica (§10)." ;;
    filter-branch|filter-repo) deny "guard-git: reescrita de histórico é proibida (§5)." ;;
    update-ref)    deny "guard-git: manipulação direta de refs é proibida (§15)." ;;
    reflog)        deny "guard-git: manipulação de reflog é proibida (§15)." ;;
    worktree)      deny "guard-git: worktrees são criados e limpos pela plataforma, não manualmente (§10)." ;;
    pull)
      printf '%s' "$seg" | grep -q -- '--ff-only' || \
        deny "guard-git: 'git pull' só é liberado como 'git pull --ff-only' (fast-forward puro, inofensivo por construção — §5)." ;;
    push)
      printf '%s' "$seg" | grep -Eq '(^|[[:space:]])(--force|--force-with-lease|-f|--delete|--mirror)([[:space:]]|$)' && \
        deny "guard-git: push destrutivo (--force/--delete) é proibido (§5, §15)." ;;
    commit)
      printf '%s' "$seg" | grep -q -- '--amend' && \
        deny "guard-git: 'git commit --amend' reescreve histórico — crie um commit novo (§5)." ;;
    branch)
      printf '%s' "$seg" | grep -Eq '(^|[[:space:]])(-D|-d|-m|-M)([[:space:]]|$)' && \
        deny "guard-git: deletar/renomear branch é intervenção de operador, não da factory (§15)." ;;
    add)
      printf '%s' "$seg" | grep -Eq '(^|[[:space:]])(\.|-A|--all|-u|--update)([[:space:]]|$)' && \
        deny "guard-git: git add é NOMINAL — adicione por path explícito, nunca '.', '-A' ou '-u' (rules/factory/git.md)." ;;
  esac
done <<EOF
$segs
EOF

exit 0

# guard-git — PreToolUse(Bash). Bloqueia operações git proibidas (README §5, §15).
#
# Liberadas: status, log, diff, show, add (nominal), commit (canônico), fetch,
#            pull --ff-only, mv, rm, apply, ls-files, rev-parse, rev-list, remote, push.
# Bloqueadas: merge, rebase, reset, checkout, switch, restore, clean, stash,
#             cherry-pick, filter-branch/-repo, update-ref, reflog, worktree,
#             branch -D/-d/-m, push --force/--delete, pull sem --ff-only,
#             commit --amend, add ./-A/--all/-u (add é nominal, por path explícito).
#
# git push simples NÃO é pré-aprovado por allowed-tools fora de /promote e /bug —
# o prompt de permissão é o ato deliberado do operador (§5).
#
# -Worker (frontmatter do coder): nega TAMBÉM push, fetch e pull — no runtime de workflow
# não há prompt de permissão garantido (acceptEdits herdando allowlist, §10), e sincronização
# e publicação são da sessão principal. É o mecanismo do "push fora de hora" do §15.

param([switch]$Worker)

. "$PSScriptRoot\_lib.ps1"

$in = Read-HookInput
if (-not $in) { exit 0 }
$cmd = [string]$in.tool_input.command
if (-not $cmd -or $cmd -notmatch '\bgit(\.exe)?\b') { exit 0 }

# Extrai cada invocação de git (suporta encadeamento com ; && || |) e o subcomando real.
$invocations = @()
foreach ($seg in [Regex]::Split($cmd, '\|\||&&|;|\|')) {
    $tokens = @($seg.Trim() -split '\s+' | Where-Object { $_ })
    for ($i = 0; $i -lt $tokens.Count; $i++) {
        if ($tokens[$i] -notmatch '^(git|git\.exe)$') { continue }
        $j = $i + 1
        while ($j -lt $tokens.Count) {
            $t = $tokens[$j]
            if ($t -in @('-C', '-c', '--git-dir', '--work-tree', '--exec-path', '--namespace')) { $j += 2; continue }
            if ($t.StartsWith('-')) { $j += 1; continue }
            $invocations += , @{ sub = $t.ToLower(); rest = ($tokens[$j..($tokens.Count - 1)] -join ' ') }
            break
        }
        break
    }
}

$blockedSubs = @{
    'merge'         = 'integração paralela é diff+apply (§10); reconciliação é git pull --ff-only (§5)'
    'rebase'        = 'sem reescrita de histórico (§5)'
    'reset'         = 'destrutivo — checkpoints e commits por task são a rede de undo (§10)'
    'checkout'      = 'proibido pelo guard — worktrees são geridos pela plataforma (§10)'
    'switch'        = 'proibido pelo guard (§15)'
    'restore'       = 'descarta trabalho do working tree (§15)'
    'clean'         = 'destrutivo (§15)'
    'stash'         = 'estado fora do commit é verdade volátil (§5)'
    'cherry-pick'   = 'integração é diff+apply em ordem topológica (§10)'
    'filter-branch' = 'reescrita de histórico (§5)'
    'filter-repo'   = 'reescrita de histórico (§5)'
    'update-ref'    = 'manipulação direta de refs (§15)'
    'reflog'        = 'manipulação de reflog (§15)'
    'worktree'      = 'worktrees são criados e limpos pela plataforma, não manualmente (§10)'
}

foreach ($inv in $invocations) {
    $sub = $inv.sub; $rest = $inv.rest

    if ($Worker -and $sub -in @('push', 'fetch', 'pull')) {
        Deny "guard-git (worker): 'git $sub' é proibido no runtime de workflow — sincronização e publicação são da sessão principal (§10)."
    }
    if ($blockedSubs.ContainsKey($sub)) {
        Deny "guard-git: 'git $sub' é proibido — $($blockedSubs[$sub]). Operações de sincronização liberadas: git fetch e git pull --ff-only."
    }
    if ($sub -eq 'pull' -and $rest -notmatch '--ff-only') {
        Deny "guard-git: 'git pull' só é liberado como 'git pull --ff-only' (fast-forward puro, inofensivo por construção — §5)."
    }
    if ($sub -eq 'push' -and $rest -match '(\s|^)(--force|--force-with-lease|-f|--delete|--mirror)(\s|$)') {
        Deny "guard-git: push destrutivo (--force/--delete) é proibido (§5, §15)."
    }
    if ($sub -eq 'commit' -and $rest -match '--amend') {
        Deny "guard-git: 'git commit --amend' reescreve histórico — crie um commit novo (§5)."
    }
    if ($sub -eq 'branch' -and $rest -match '(\s|^)(-D|-d|-m|-M)(\s|$)') {
        Deny "guard-git: deletar/renomear branch é intervenção de operador, não da factory (§15)."
    }
    if ($sub -eq 'add' -and $rest -match '(\s|^)(\.|-A|--all|-u|--update)(\s|$)') {
        Deny "guard-git: git add é NOMINAL — adicione por path explícito, nunca '.', '-A' ou '-u' (rules/factory/git.md)."
    }
}

exit 0

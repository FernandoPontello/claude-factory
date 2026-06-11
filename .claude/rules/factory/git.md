# Convenções de git da factory

## Working tree

- Comece estágio com tree limpa — ou suja **apenas** dentro do write-set do próprio estágio
  (retomada de estágio interrompido). Tree suja fora disso é tripwire: estágio anterior sem
  commit, ou edição por fora da factory. Não "arrume" sujeira alheia: reporte ao operador.
- Antes de consumir `docs/**`, a verdade é **puxada**: o gate roda `git fetch` e bloqueia se
  o local está behind do origin. A reconciliação sancionada é `git pull --ff-only`.

## Commit

- Todo estágio fecha em commit, como **último ato**, com mensagem canônica:
  `factory(<estágio>): <épico ou alvo> — <resumo>`
  Ex.: `factory(promote): checkout — 2 PRDs promovidos`.
- `git add` é **nominal**: por path explícito, arquivo a arquivo. Nunca `git add .`, `-A`,
  `--all` ou `-u`. Você adiciona o que o estágio escreveu — nada mais.
- Um commit por task no `/code`; o corpo do commit carrega o aprendizado cross-task.
- Commits sem o prefixo `factory(` são, por definição, mudança externa (drift) — é assim
  que o `/design` as detecta.

## Operações proibidas (bloqueadas pelo guard-git)

`merge`, `rebase`, `reset`, `checkout`, `switch`, `restore`, `clean`, `stash`,
`cherry-pick`, `commit --amend`, `push --force/--delete`, `branch -D/-d/-m`,
`filter-branch`, `update-ref`, `reflog`, `worktree` manual.
As **únicas** sincronizações liberadas: `git fetch` e `git pull --ff-only`.

## Push

- Push é a fronteira entre papéis. `/promote` e `/bug` commitam **e pusham** antes de tocar
  o board (o destinatário é outra máquina). Na faixa dev, o push é ato deliberado do
  operador — nunca pushe por conta própria fora de `/promote` e `/bug`.
- Premissa: trunk-based para `docs/**` — o push do PO vai direto ao trunk.

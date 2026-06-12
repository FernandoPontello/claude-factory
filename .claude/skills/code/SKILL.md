---
name: code
description: Executo as tasks do épico — batch topológico em sessão única (default), uma task específica, ou paralelo via workflow — um commit por task, board só depois da verdade commitada.
argument-hint: "[task-id] [--parallel]"
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write|NotebookEdit"
      hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-writes.ps1" -Stage code
  Stop:
    - hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/check-toca.ps1"
---

# /code — execução

Estágio Dev de execução. Consome o grafo de tasks que o `/tasks` estabeleceu
(`docs/epics/<slug>/tasks/NNN-*.md`) e implementa. Três modos: **batch** (sem argumento — o
caso comum), **individual** (`/code 003`) e **paralelo** (`/code --parallel`). Nomeie a
sessão `<épico>/code` (ex: `checkout/code`).

## Regras inegociáveis

1. **O `task.md` inteiro é o contrato.** Implemente o que ele manda — Objetivo, Contexto,
   Critério de pronto. Decisão que o design não cobre não se improvisa: pare, exponha
   opções e trade-offs e **devolva ao operador** (a Lei da Factory).
2. **Um commit por task, como fecho daquela task**, mensagem canônica:
   `factory(code): <slug> — task NNN <resumo>`. O **corpo** do commit carrega o aprendizado
   cross-task. `git add` **nominal** — por path explícito (os paths do `Toca` + o próprio
   `task.md`); nunca `.`, `-A`, `--all` ou `-u`.
3. **Escreva SÓ no `Toca` declarado da task ativa** (+ `Status` e `## Tempo` do próprio
   `task.md` — os únicos campos que o `/code` escreve em `tasks/*.md`; o resto é do
   `/tasks`). O hook `check-toca` compara o diff real contra o declarado no `Stop`.
   Divergência: justifique ao operador e reverta, ou o desvio vira candidato a pendência
   no `/close`. **Nunca commite por cima da divergência em silêncio.**
4. **`Status` tem dois valores** (`pendente` | `concluída`; com resíduo:
   `concluída; ver pending.md#NNN`). **`## Tempo` é relógio real** — iniciado / concluído /
   duração lidos do relógio do sistema, **nunca estimativa**.
5. **Board só depois do commit.** Sequência fixa por task: commit → lote de verbos
   canônicos (`.claude/factory-process.md`) → spawnar o agent `board-writer` → validar a
   saída com `.claude/scripts/validate-agent-output` (chaves: `executed,failed,blocked`) →
   try-reporta-prossegue ("não consegui atualizar o board, rode `/sync` depois"). **Nunca
   cite nome de tool de provider** — só verbos.
6. **A ordem deriva do grafo, não de política:** `Depende de` vazio = ordem livre; com
   dependência = ordem obrigatória. Task **com dependentes** falha → aquele ramo PARA.
   Task **sem dependentes** falha → o batch segue e ela vira candidata a pendência.
7. **Nunca deixe meia-task no tree:** ou a task fecha em commit, ou o tree volta ao último
   commit (checkpoint/rewind da plataforma — `git reset`/`checkout`/`restore` são
   proibidos pelo guard-git, como merge, rebase, stash e amend).
8. **Nunca pushe.** Na faixa dev, push é ato deliberado do operador.
9. **Workers de paralelismo nunca falam com o board** — só esta sessão principal emite
   verbos, derivados do filesystem após a integração.
10. **Estágios não invocam estágios.** Ao terminar, devolva ao operador — o próximo passo
    (`/close`, ou re-rodar uma task) é dele.

Sessões de batch compactam: estas regras vivem no topo por isso (os primeiros ~5.000
tokens são preservados), e o hook `SessionStart(compact)` reinjeta
`.claude/rules/factory/invariants.md`. **Após qualquer compactação, releia esta seção
antes de seguir.**

---

## Pré-flight (qualquer modo)

O gate de pré-condições (`gate-stage`, no `UserPromptExpansion`) já validou tree limpa (ou
suja só no write-set do `/code`) e frescor de `docs/**` antes de você ver este prompt. O
que resta verificar — com glob/leitura, nunca por suposição (rules/factory/filesystem.md):

1. **Identifique o épico.** Glob `docs/epics/*/tasks/*.md` e filtre por épicos com task
   `Status: pendente`. Exatamente um → é ele. Mais de um → **pergunte ao operador** qual.
   Nenhum → nada a executar; reporte e pare.
2. **Confira os artefatos.** `docs/epics/<slug>/design.md` e a pasta `tasks/` precisam
   existir. PRD sem design ou design sem tasks = estágio anterior não rodou — pare e
   instrua (`/design` ou `/tasks` primeiro; pular o design é anti-pattern, README §16).
3. **Leia TODAS as tasks do épico** e monte o grafo a partir de `Depende de`. Tasks com
   `Status: concluída` ficam de fora (re-execução só no modo individual, deliberada).
   Ordene topologicamente; entre tasks livres, use a ordem numérica como desempate
   determinístico.
4. **Anote o `Board-ID`** do header do `prd.md` (ou do `design.md`, na pasta de re-entrada
   `-pNNN`, que não tem `prd.md`) — é o Feature que os lotes de board vão mover.
5. **Detecte o modo** pelo argumento: vazio → batch; `NNN` → individual; `--parallel` →
   paralelo.

---

## Modo batch (sem argumento — o caso comum, 2–7 tasks)

Sessão **única, sequencial em ordem topológica**. É o default porque preserva o **contexto
acumulado** — a task 7 se beneficia do que a 3 fez: convenções descobertas, armadilhas do
codebase, decisões de borda. Esse é o maior ganho do batch; não o jogue fora spawnando
sub-agents por task.

O comportamento **deriva do grafo**, não de política configurada:

- Tasks sem dependência entre si: ordem livre (desempate numérico).
- Task dependente só roda depois da base `concluída`.
- **Falha numa task com dependentes → aquele ramo para** (rodar dependente sobre base
  quebrada não faz sentido). Os demais ramos seguem.
- **Falha numa task sem dependentes → o batch segue** (nada mais precisa dela) e ela vira
  candidata a pendência no `/close`.

A parada não é configurada — é consequência da estrutura. Falha numa folha não derruba
nada; falha numa raiz pausa só o que pendia dela.

**Redes de segurança:** os checkpoints da plataforma são o undo *dentro* da sessão (task
deu errado → rewind, tree volta ao último commit); o **commit por task é a rede
definitiva** — o que commitou está salvo, aconteça o que acontecer com a sessão.

Execute cada task pelo ciclo abaixo ("O ciclo de uma task"). O board acompanha o avanço:
o batch marca cada task como done **após o commit daquela task** — a exceção natural ao
"escreve-só-ao-concluir-o-estágio" (factory-process.md).

Ao final: resumo (concluídas, falhas por ramo, resíduos anotados, tempo total).
**GATE:** o operador valida o resumo do batch antes de seguir para o `/close`.

## Modo individual (`/code 003`)

Executa — ou **re-executa** — UMA task, pelo mesmo ciclo. Particularidades:

- Verifique as dependências dela: base `pendente` → pare e reporte (rodar sobre base
  ausente é o mesmo bug do ramo quebrado). O operador decide a ordem, não você.
- Re-execução de task `concluída` é deliberada (o operador a pediu pelo ID): re-carimbe o
  `## Tempo` (novo ciclo iniciado/concluído) e feche em **novo commit** — nunca amend.
- O lote de board ao final emite `complete_task` normalmente — idempotência é problema do
  board-writer — e o `move_feature` que a evidência do filesystem mandar (ver "O lote de
  board").

## Modo paralelo (`/code --parallel`)

**Custo antes de tudo:** paraleliza **tempo às custas de tokens** (muitos agentes). Só
vale para **épico grande com ramos disjuntos** — independentes no grafo E disjuntos no
`Toca`. Para épico pequeno ou acoplado, o overhead engole o ganho; sequencial é o default
por isso. Se o grafo que você montou no pré-flight não tem ramos disjuntos, diga isso ao
operador e recomende o batch. **GATE:** o operador confirma o modo paralelo ciente do
custo.

Confirmado: despache o **workflow salvo** `.claude/workflows/code-parallel.js`, registrado
como comando próprio `/code-parallel`, com `args {epic: "<slug>"}`. Onde a plataforma não
encadear skill→workflow, degrade com elegância: responda com a instrução pronta para o
operador invocar `/code-parallel` com o slug do épico — um Enter de distância — e encerre
sua parte até o workflow terminar.

O workflow faz: montar ramos (serializando pares com `Toca` sobreposto), um `coder` por
ramo em worktree isolado (sequencial dentro do ramo), integração por `git diff` + `git
apply` em ordem topológica no tree principal, e verificação build+teste no tree integrado.
**Workers nunca falam com o board.** O gate humano vive *entre* workflows, nunca dentro.

**APÓS o workflow, nesta sessão principal:**

1. **GATE:** apresente ao operador o resultado — tasks integradas, `failed`/`rejected` com
   causas, saída do `verifier`. Ele decide: re-rodar tasks (`/code NNN`), aceitar os
   resíduos como candidatos a pendência, ou seguir.
2. Emita **um lote único de verbos derivado do filesystem** (nunca da memória do
   workflow): releia os `task.md` — `Status: concluída` com `## Tempo` preenchido é o fato;
   `complete_task` por task concluída + o `move_feature` que a derivação mandar. Mesmo
   protocolo: board-writer, validação, try-reporta-prossegue.

---

## O ciclo de uma task (qualquer modo)

1. **Releia o `task.md` inteiro** — ele é o contrato; não há "prompt" separado. Objetivo,
   Contexto, `Toca`, `ACs cobertos`, Critério de pronto.
2. **Carimbe o início** no `## Tempo` (relógio do sistema — leia com `Get-Date`/`date`,
   nunca chute). Essa marca é também a evidência de `in_progress` que o `/sync` deriva.
3. **Implemente** conforme o contrato, escrevendo **somente** nos paths do `Toca`. Os ACs
   listados em `ACs cobertos` são o que esta task realiza — não invente ACs fora do PRD.
   Precisou tocar fora do `Toca`? Pare: ou é desvio legítimo (justifique ao operador — vira
   candidato a pendência no `/close`) ou é erro (reverta). O hook confere no `Stop`.
4. **Verifique o Critério de pronto.** Não atingiu → a task **falhou**: desfaça o tree
   (checkpoint da plataforma), registre a causa e aplique a regra do grafo (ramo para /
   batch segue).
5. **Atualize `Status` e complete o `## Tempo`** (formatos canônicos abaixo).
6. **Commit canônico** — o fecho da task:
   ```
   git add <cada path do Toca tocado> <docs/epics/<slug>/tasks/NNN-*.md>
   git commit -m "factory(code): <slug> — task NNN <resumo>" -m "<aprendizado cross-task>"
   ```
   O corpo é onde o aprendizado viaja para quem vier depois (inclusive o `/close`):
   decisões de borda, armadilhas, o que a próxima task deveria saber.
7. **Lote de board** (ver abaixo): commit primeiro, sempre.

### `Status` e `## Tempo` — os dois únicos campos do `/code` no `task.md`

Formato canônico das seções, como o `/tasks` as cria (README §12.5, verbatim):

```markdown
## Status
pendente | concluída
<!-- concluída com resíduo: "concluída; ver pending.md#NNN" -->
```

```markdown
## Tempo
<!-- preenchido por /code: iniciado / concluído / duração (relógio real, nunca estimativa) -->
```

Preenchimento pelo `/code`:

```markdown
## Status
concluída

## Tempo
- Iniciado: 2026-06-10 14:02
- Concluído: 2026-06-10 14:47
- Duração: 45min
```

**Resíduo:** task que entregou o essencial mas deixou sobra (escopo que o PRD/design previa
e ficou de fora, ou necessidade descoberta) fecha `concluída; ver pending.md#NNN` — para o
batch não tentar re-executá-la. O `NNN` é o próximo número livre: confira o `pending.md`
do épico se já existir (ausente = comece em 001). Quem **materializa** a entrada é o
`/close` (single-writer de `pending.md`) — descreva o resíduo no corpo do commit e no
resumo final, com o número reservado, para o `/close` consumir.

### O lote de board

Após **cada** commit de task, emita o lote de verbos canônicos — apenas o vocabulário de
`.claude/factory-process.md`, jamais nome de tool de provider:

- `complete_task(task_id, minutos, note="[factory:note]\n\n" + <resumo da implementação>)` —
  referencie a task por `Task NNN — <título>` sob o Feature (`Board-ID` do pré-flight); o
  `note` é o mesmo aprendizado que você gravou no corpo do commit da task (decisões,
  descobertas, desvios justificados) — a documentação da implementação visível no card,
  não só no git — com o **marcador canônico na primeira linha** (ensure: re-run nunca
  duplica). Resolver o ID concreto e a degradação do campo de tempo (manifesto, aceita no
  `/setup`) é trabalho do board-writer, nunca seu.
- `update_body(task_id, <conteúdo integral do task.md atualizado>)` — **a descrição é
  espelho, não snapshot** (`factory-process.md`): o `task.md` acabou de mudar (`Status:
  concluída`, `## Tempo` preenchido) e o card reflete o arquivo, não a versão de
  nascimento.
- **1ª task do épico concluída** → o lote inclui `move_feature(feature_id, in_progress)`.
  (O verbo só pode viajar agora: board exige tree limpa — é o primeiro momento com verdade
  commitada para projetar.)
- **Todas as tasks `concluída`** → o lote inclui `move_feature(feature_id, review)`.
- Na dúvida, o estado emitido **deriva da evidência no filesystem** (tabela de derivação do
  `factory-process.md`), nunca de contagem mental.

Protocolo de execução do lote:

1. Confirme tree limpa (o commit da task foi o último ato sobre o tree).
2. **Spawne o agent `board-writer`** com o lote, na ordem.
3. **Valide a saída** com `.claude/scripts/validate-agent-output` (variante do SO),
   `-Required "executed,failed,blocked"`. Saída inválida → re-instrua o agent uma vez;
   nunca prossiga fingindo sucesso.
4. **Try-reporta-prossegue:** falha de verbo ou de MCP não trava a task seguinte — reporte
   "não consegui atualizar o board, rode `/sync` depois" e siga. Jamais re-tente em loop;
   jamais bloqueie o batch por causa do board. `blocked: tree suja` = você esqueceu de
   commitar — commite e re-spawne.

---

## Falhas — referência rápida

| Situação | Ação |
|---|---|
| Task falha, **tem** dependentes | desfaz o tree (checkpoint), registra causa, **para o ramo**; outros ramos seguem |
| Task falha, **sem** dependentes | desfaz o tree, registra causa, batch segue; vira candidata a pendência no `/close` |
| Diff diverge do `Toca` (hook acusa no Stop) | justificar e reverter, ou registrar como candidato a pendência — nunca commitar em silêncio |
| Decisão que o design não cobre | parar, expor trade-offs, **devolver ao operador** |
| Board/MCP falha | try-reporta-prossegue: "rode `/sync` depois" |
| Workflow paralelo: ramo morreu / patch `rejected` | tasks daquele ramo seguem `pendente`; operador decide re-rodar (`/code NNN`) ou deixar para o `/close` |

`Status` de task que falhou permanece `pendente` — o filesystem não mente sobre o que não
aconteceu.

## Fechamento do estágio

Não há commit extra de fechamento: **os commits por task são os commits canônicos do
estágio** — o da última task é o último ato de escrita. Feche com o resumo ao operador:
tasks concluídas (com duração), falhas e causas, resíduos anotados (números reservados),
estado do Feature no board (ou pendência de `/sync`), e o aprendizado que vale levar ao
`/close`.

**GATE:** o operador valida o resultado antes de qualquer próximo passo — `/close` quando
o épico está pronto para os gates de qualidade, ou `/code NNN` para re-trabalhar. Você
sugere; ele decide e digita.

## Referências

- README §3 (nota: `/code` é um comando com três modos), §5 (mapa de commits: um por
  task), **§10 inteiro** (grafo, batch, paralelismo, compaction), §11 (estados
  `in_progress`/`review`, board-writer, resiliência), §12.5 (`task.md`: Status/Tempo),
  §15 (enforcement), §16 (anti-patterns).
- `.claude/factory-process.md` — verbos, estados e derivação (a única língua do board).
- `.claude/rules/factory/` — `invariants.md`, `git.md` (add nominal, proibições, push),
  `epics.md` (Status/Tempo/Toca/ACs), `board.md` (sequência fixa, try-reporta-prossegue),
  `filesystem.md` (verificação cirúrgica).
- `.claude/hooks/README.md` — `guard-writes`, `check-toca`, `inject-invariants`.
- `.claude/workflows/code-parallel.js` — o workflow salvo do modo paralelo.

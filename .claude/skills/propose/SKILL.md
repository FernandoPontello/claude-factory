---
name: propose
description: Quebro a superfície do produto em PRDs de feature, em volume — idealização descartável; nada toca o board até o /promote.
argument-hint: "[projeto-ou-cliente]"
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write|NotebookEdit"
      hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-writes.ps1" -Stage propose
  Stop:
    - hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-scan.ps1" -Stage propose
---

# /propose — idealização em volume (PO)

## Regras inegociáveis

1. **A Lei da Factory:** a IA ajuda a pensar; quem decide é o operador. Você interroga, expõe trade-offs, aponta inconsistências — e **devolve a decisão ao PO**. Você não decide o que vale.
2. **Âncora obrigatória:** `docs/overviews/product-overview.md`. O gate de pré-condições bloqueia o comando sem ele — se você está rodando, ele existe: **leia-o inteiro antes de qualquer recorte**. Os PRDs respeitam o que o sistema já é.
3. **Write-set único:** `docs/proposals/<projeto-ou-cliente>/prd-<slug>.md`. Nada além disso — nem overviews, nem `docs/epics/**`, nem código. O `guard-writes` bloqueia; não contorne via Bash.
4. **Linguagem de negócio, sempre.** PRD descreve problema, valor, comportamento e critério de aceite. PRD que diz "use tal tabela" invadiu o design — anti-pattern (README §16). Solução técnica é território do `/design`.
5. **Critérios de aceite numerados** `AC-1`, `AC-2`… — condições objetivas e verificáveis. São a espinha de rastreabilidade que atravessa `design.md`, `task.md` (`ACs cobertos`) e `/close` (cobertura verificada). AC vago não fecha épico.
6. **Template §12.3 verbatim** (embutido abaixo). Os campos `Board-ID`, `Board-URL` e `Promovido em` ficam **sem preencher** — são do `/promote`. PRD em `proposals/` com `Board-ID` preenchido é bug de processo.
7. **Este estágio NÃO toca o board.** Nenhum verbo canônico, nenhum `board-writer`. Os PRDs são idealização: podem ser abandonados sem custo; só o `/promote` compromete (README §7).
8. **Fecha em commit canônico como ÚLTIMO ato:** `factory(propose): <projeto-ou-cliente> — N PRDs`. `git add` **nominal** — por path explícito, arquivo a arquivo; nunca `.` ou `-A`. Estágio que não commitou não aconteceu.
9. **Não pushe.** Na faixa do PO, push é ato de `/promote` e `/bug` — o destinatário dos PRDs idealizados ainda não existe.
10. **Gates explícitos no fluxo:** o operador valida o recorte antes da escrita, e julga os PRDs antes do commit.

Nomeie a sessão `<projeto-ou-cliente>/propose` (ex: `academia/propose`).

---

## O que este estágio é

O `/propose` é o estágio de **idealização em volume** do PO (README §2): ancorado no `product-overview.md`, quebra a superfície do produto em N PRDs de feature — backlog denso, gerado de forma assíncrona, sem esperar o Dev executar épico por épico. Cada PRD é um candidato a épico; nenhum compromete nada. Os arquivos vivem em `docs/proposals/<projeto-ou-cliente>/` — território de idealização, fora do alcance do pipeline de execução — e dali só saem pela porta do `/promote`. Descartável significa "nunca tocou o board", não "nunca foi commitado": o git é o que torna o descarte barato *com* rastro (README §1).

## Pré-condições

O hook `gate-stage` já validou antes de você ver este prompt: papel PO, working tree limpa (ou suja só no próprio write-set — retomada), `docs/overviews/product-overview.md` presente e `docs/**` não-*behind* do origin. Se o gate bloqueou por falta do overview, a instrução ao operador é rodar `/ground` primeiro; se bloqueou por *behind*, é `git pull --ff-only`. Você não re-implementa o gate — mas honra o que ele garante.

## Fluxo

### 1. Argumento e contexto

- O argumento `[projeto-ou-cliente]` define a pasta `docs/proposals/<projeto-ou-cliente>/`. Sem argumento: liste as pastas existentes em `docs/proposals/` (glob preciso, não varredura) e **pergunte ao operador** — não invente nome de cliente.
- Leia `docs/overviews/product-overview.md` inteiro. Ele é a definição do que o produto é agora — a superfície que os PRDs respeitam: não proponha o que já existe, não contradiga o que está lá.
- Leia os `prd-*.md` já existentes na pasta alvo (`docs/proposals/<projeto-ou-cliente>/prd-*.md`). Re-execução é recuperação, não recriação: não recrie PRD existente; refinar um PRD ainda não promovido é trabalho legítimo deste estágio (single-writer, README §14). PRD já promovido (movido para `epics/`) está fora do seu alcance.

### 2. Receber e interrogar (a Lei da Factory)

O operador traz a proposta inicial — ideias soltas, temas, ou simplesmente "quebre a superfície". Seu trabalho cognitivo:

- **Interrogar o valor:** que problema, para quem, por quê agora. Feature sem dor identificável é candidata a morrer aqui — barato.
- **Confrontar com o que o sistema já é:** o overview diz o que existe; aponte sobreposição, redundância e contradição.
- **Calibrar o recorte:** cada PRD é **uma feature** — um bloco de valor coeso que um épico entrega. Grande demais (o produto inteiro) → quebre; pequeno demais (uma task) → agrupe ou descarte. O slug escolhido tende a virar a `factory-key` do futuro épico (`docs/epics/<slug>/`) — curto, minúsculas, sem acento, hifenizado.
- **Expor trade-offs entre candidatas** (o que depende do quê em termos de produto, o que entrega valor sozinho) e **devolver a decisão**.

### 3. GATE: recorte validado

Apresente a lista de candidatas — título, slug proposto, uma frase de valor cada.

**GATE:** o operador valida o recorte (quais features, quantas, com que fronteiras) antes de qualquer PRD ser escrito.

### 4. Escrever os PRDs

Um arquivo por feature validada: `docs/proposals/<projeto-ou-cliente>/prd-<slug>.md`, no template abaixo, **verbatim**.

Template canônico (README §12.3):

```markdown
# PRD — <Título da Feature>

## Origem
- Tipo: Feature nova | Bug fix
- Data: YYYY-MM-DD
- Discutido com: <PO | IA>
- Board-ID: <id do Feature>            ← preenchido por /promote
- Board-URL: <link do card>            ← preenchido por /promote
- Promovido em: YYYY-MM-DD             ← preenchido por /promote

## Problema e valor
[Que problema resolve, para quem, qual o valor. Linguagem de negócio.]

## Histórias de usuário
[Como <persona>, quero <ação>, para <benefício>.]

## Critérios de aceite
- AC-1: [condição objetiva e verificável]
- AC-2: [condição objetiva e verificável]

## Fora de escopo
[O que esta feature explicitamente não cobre.]
```

Regras de preenchimento:

- `Tipo: Feature nova` — `Bug fix` é território do `/bug`, nunca deste estágio.
- `Data`: a data de hoje, `YYYY-MM-DD`.
- `Discutido com`: quem participou da discussão (normalmente `PO`).
- `Board-ID`, `Board-URL`, `Promovido em`: **copie as três linhas com os placeholders intactos**, incluindo as anotações `← preenchido por /promote`. Não preencha — é o `/promote` que grava o vínculo com o board.
- **Critérios de aceite:** numerados sequencialmente a partir de `AC-1`, um por condição, cada um objetivo e verificável por alguém que não participou da discussão. Quantos a feature pedir — mas cada AC precisa ser testável; "funciona bem" não é AC.
- **Fora de escopo:** explícito e honesto — o que esta feature não cobre (e, quando útil, onde isso vive: outro PRD da leva, ou lugar nenhum).
- Paths relativos à raiz do projeto, separador `/`, em qualquer referência cruzada.

### 5. GATE: o PO julga o que vale

Apresente os PRDs escritos — um resumo por arquivo (título, valor, ACs). O PO revisa: ajusta, manda reescrever, descarta o que não convenceu (delete o arquivo descartado antes do commit — ele é seu write-set).

**GATE:** o PO julga o que vale antes do commit. O julgamento *de promoção* — o que vira trabalho real no board — não acontece aqui: é deliberado, no `/promote`, depois. Aqui o PO só decide o que merece existir como idealização.

### 6. Commit — o último ato

Com os PRDs aprovados:

```
git add docs/proposals/<projeto-ou-cliente>/prd-<slug-1>.md docs/proposals/<projeto-ou-cliente>/prd-<slug-2>.md ...
git commit -m "factory(propose): <projeto-ou-cliente> — N PRDs"
```

Ex.: `factory(propose): academia — 5 PRDs`. Add nominal, cada path por extenso. Commitou → o estágio aconteceu. **Nada de board, nada de push** — encerre.

## O que este estágio NÃO faz

- **Não toca o board.** Nenhum verbo de `.claude/factory-process.md` é emitido; o `board-writer` não é spawnado. Idealização tocando o board é anti-pattern (README §16) — só `/promote` (features) e `/bug` (defeitos) escrevem na faixa do PO.
- **Não promove.** Mover PRD para `docs/epics/` é ato do `/promote`.
- **Não desenha solução.** Arquitetura, tabelas, endpoints, padrões — `/design`, na faixa dev.
- **Não escreve fora do write-set.** Se o `guard-writes` bloqueou um path, o path está errado — corrija; se o `stop-scan` acusou sujeira fora do write-set, reporte ao operador em vez de "arrumar" (rules/git.md).

## Referências

- README §2 (os dois papéis; PO gera backlog assíncrono), §3 (nota do `/propose`), §5 (commit como fronteira da verdade), §7 (o gate de promoção; antes da promoção), §12.3 (template do PRD), §13 (`docs/proposals/` como território de idealização), §16 (anti-patterns: PO tocando implementação, idealização tocando o board).
- `.claude/factory-process.md` — contrato canônico (este estágio não emite verbos; saiba o que não emitir).
- `.claude/rules/factory/invariants.md`, `git.md`, `filesystem.md` — convenções operacionais que valem aqui.

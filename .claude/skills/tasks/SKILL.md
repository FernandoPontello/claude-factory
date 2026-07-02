---
name: tasks
description: Decomponho o design do épico em tasks — grafo de dependências, write-set e ACs cobertos — o contrato que o /code executa.
argument-hint: "<épico-slug>"
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write|NotebookEdit"
      hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-writes.ps1" -Stage tasks
  Stop:
    - hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-scan.ps1" -Stage tasks
---

# /tasks — decomposição e grafo

Estágio Dev. Consome `design.md` + `prd.md` do épico e os decompõe em N tasks
(`docs/epics/<slug>/tasks/NNN-<slug>.md`) com o grafo de dependências que o `/code` executa.

## Regras inegociáveis

1. **A Lei da Factory.** Você propõe a decomposição, interroga granularidade, ordem e riscos,
   expõe trade-offs — e **devolve a decisão ao operador**. Nenhum arquivo de task é escrito
   antes do gate.
2. **Write-set deste estágio:** apenas `docs/epics/<slug>/tasks/NNN-<slug>.md`. Não toque
   `design.md`, `prd.md`, código ou qualquer outro path — os hooks bloqueiam, e a tentativa
   já é o erro.
3. **O template (§12.5) é rígido.** O arquivo inteiro é o contrato que o `/code` consome —
   não há seção de "prompt" separada. Todas as seções, na ordem, nenhuma a mais.
4. **Três eixos por task, sempre os três** (§10): `Depende de` **ordena** (vazio = ordem
   livre); `Toca` é o **write-set** — habilita paralelização segura e será **verificado por
   hook no Stop do `/code`**; `ACs cobertos` dá ao `/close` o **checklist objetivo** de
   cobertura. A decisão fica aqui porque a informação existe aqui.
5. **`Status` nasce `pendente`; `## Tempo` nasce vazio** (só o comentário do template).
   Quem preenche os dois é o `/code` — e mais ninguém.
6. **Validações antes do gate:** todo AC do PRD coberto por ≥ 1 task (AC descoberto =
   avisar o operador); grafo sem ciclos; `Toca` de tasks paralelizáveis preferencialmente
   disjunto; **toda task com história derivável** (via `ACs cobertos` → mapa AC→US do PRD;
   task cross-história ou sem AC = decisão do operador no gate).
7. **Não invente ACs** fora do PRD e **não improvise arquitetura**: se o `design.md` não
   sustenta a decomposição, devolva ao operador e sugira voltar ao `/design` (§16).
8. **Commit canônico como último ato de escrita:** `factory(tasks): <slug> — N tasks + grafo`.
   `git add` **nominal** — path explícito por arquivo, nunca `.` ou `-A`.
9. **Board só depois do commit**, e só por verbos canônicos de `.claude/factory-process.md`
   (`find_by_key`, `ensure_group`, `create_task`), emitidos ao agent `board-writer` — **nunca**
   nome de tool de provider. Falha de board = try-reporta-prossegue ("rode `/sync` depois").
10. **A Feature NÃO muda de estado** neste estágio. `/tasks` só cria Tasks filhas.

## Sessão e pré-condições

Nomeie a sessão `<épico>/tasks` (ex: `checkout/tasks`). O argumento é o slug da pasta do
épico em `docs/epics/` — aceita também pasta de re-entrada (`<slug>-pNNN`).

Verifique com leitura real, nunca por suposição:

- **`docs/epics/<slug>/design.md` existe.** Sem design, pare: PRD direto para `/tasks` é
  anti-pattern (§16) — o `/tasks` acabaria improvisando arquitetura. Instrua rodar `/design`.
- **`docs/epics/<slug>/prd.md` existe com `Board-ID` no header** — é o `feature_id` dos
  verbos do board. PRD sem `Board-ID` = promoção incompleta: instrua re-rodar `/promote`
  (idempotente) antes de prosseguir.
- **Re-entrada (`<slug>-pNNN/`):** não há `prd.md` — é assim por desenho. Consuma o
  `design.md` e a entrada `pending.md#NNN` de origem (linkada no header `## Origem`); o
  `Board-ID` da Feature irmã está no header do `design.md`.
- **`docs/epics/<slug>/tasks/` já tem arquivos?** Re-execução é recuperação, não recriação:
  confira o que existe e complete o que falta (arquivos e cards). Task com
  `Status: concluída` é intocável para este estágio — redecompor trabalho executado é
  trabalho novo (pendência ou design novo), não reescrita.

O gate de expansão (`gate-stage`) já validou tree limpa e frescor de `docs/**` antes de
você ver o prompt; tree suja fora do write-set deste estágio é tripwire — reporte, não arrume.

## Inputs

- **`prd.md`** — a lista de critérios de aceite numerados (`AC-1`, `AC-2`…): é o universo a
  cobrir, e dele você não sai. As **histórias numeradas** (`### US-n — <título>`) e a anotação
  `(US-m)` de cada AC formam o **mapa AC→história** — é dele que a história de cada task
  deriva (abaixo). E o `Board-ID` do header. **PRD legado sem `US-n`** (formato anterior):
  degrade sem drama — não há histórias a derivar; as tasks penduram direto na Feature no board
  (lote sem `ensure_group`) e nada mais muda.
- **`design.md`** — a fonte da decomposição: `## Componentes a construir/modificar` tende a
  mapear para tasks (cada bloco vira uma ou mais); `## Abordagem técnica` diz que padrão
  seguir e que módulos tocar (alimenta `Toca` e `Contexto`); `## Riscos e incógnitas`
  sinaliza onde uma task de spike pode se justificar.
- **Re-entrada:** o "PRD" é a própria entrada no `pending.md` de origem. Sem ACs numerados
  próprios, `ACs cobertos` referencia a pendência (`pending.md#NNN`).

## A decomposição: os três eixos

Cada task declara os três eixos porque é o `/tasks` que tem a informação para os três — ele
está decompondo e sabe o que precisa do quê, o que cada task vai escrever e o que cada task
entrega (§10).

**`Depende de` — ordena.** Dependência *lógica*: a task B só faz sentido sobre a base que A
construiu. Vazio = ordem livre. É o que o batch do `/code` consome para a ordem topológica e
para a semântica de falha: raiz que falha pausa o ramo; folha que falha não derruba nada.
Referencie só IDs de tasks que existem na decomposição.

**`Toca` — write-set verificado.** Os arquivos/módulos que a task **escreve** (não o que
lê). Não é declaração de intenção: ao fim de cada task, o hook do Stop do `/code` compara o
diff real contra o declarado e bloqueia divergência. É também o insumo da paralelização
segura: o modo paralelo só roda concorrentemente ramos independentes no grafo **e** disjuntos
no `Toca`. Formato: uma entrada por linha (lista com `- ` aceita), path ou glob estreito,
relativo à raiz do projeto, separador `/`; comentário opcional após ` — `. Não inclua o
próprio `task.md`: `Status` e `## Tempo` já são write-set nato do `/code`.

**`ACs cobertos` — rastreabilidade.** Quais `AC-n` do PRD esta task realiza. É a espinha que
atravessa PRD → design → task → `closure-notes.md`: o `/close` verifica cobertura por este
campo. Um AC pode ser coberto por mais de uma task; uma task pode não cobrir AC nenhum
(infra, refactor preparatório) — mas a soma das tasks precisa cobrir todos.

**A história de cada task — derivada, nunca declarada.** A task **não** tem campo de história
(o template §12.5 não muda): a história dela deriva do mapa AC→US do PRD aplicado aos
`ACs cobertos`. As regras, na ordem:

1. Todos os ACs da task pertencem à mesma `US-n` → essa é a história da task.
2. Task **sem AC** (infra, refactor): herda a história do(s) **dependentes diretos** no grafo,
   se única; ambígua ou inexistente → decisão do operador no gate (escolher uma história do
   PRD — nunca inventar história nova).
3. Task **cross-história** (ACs de mais de uma `US`): smell de decomposição — sinalize no gate
   e devolva ao operador: dividir a task (preferível) ou escolher a história dona. A cobertura
   de ACs não se altera com a escolha — o card só pendura num lugar.

A história importa só para a **projeção** (em provider com `grouping`, o card da task pendura
no card da `US-n`); pela regra 1 ela deriva **mecanicamente** do filesystem a qualquer momento
— por isso não se grava. As regras 2–3 envolvem decisão de operador, que materializa **no
board** (o card pendura no grupo escolhido), não em arquivo: uma reprojeção do zero dessas
tasks re-devolve a decisão ao operador — é exatamente o que o `/sync` faz (só o mecânico
executa sozinho; decisão vai ao relatório).

**Granularidade.** A maioria dos épicos rende 2–7 tasks. Cada task fecha em **um commit** do
`/code` e tem `Critério de pronto` objetivo e verificável. O `Contexto` precisa bastar para
o `/code` agir sem reler o design inteiro: arquivos de partida, módulos envolvidos, decisões
do design que a task realiza. Numere `NNN` com três dígitos a partir de `001`, numa ordem
topológica válida (legibilidade); a verdade da ordenação é o `Depende de`, não o número.
Slug curto em kebab-case, sem acentos.

## Validações antes do gate

Rode as quatro sobre a decomposição proposta, antes de apresentá-la:

1. **Cobertura de ACs.** Monte a matriz AC → tasks. Todo AC do PRD coberto por ≥ 1 task.
   **AC descoberto = avisar o operador** — ele decide: criar task, ou aceitar o descoberto
   conscientemente (o `/close` vai cobrá-lo e ele tende a virar pendência).
2. **Grafo sem ciclos.** Todo `Depende de` referencia ID existente e existe ordem topológica.
   Ciclo = decomposição errada; corrija antes do gate.
3. **Disjunção de `Toca`.** Pares de tasks sem dependência entre si (potencialmente
   paralelizáveis) devem preferencialmente ter `Toca` disjunto. Sobreposição não é erro —
   o modo paralelo serializa esses pares (§10) — mas aponte cada sobreposição ao operador.
4. **História derivável por task.** Aplique as regras de derivação (acima) a cada task e monte
   o mapa task → `US-n`. Task cross-história ou sem história derivável **não é erro que te
   trava** — é decisão sinalizada no gate. (PRD legado sem `US-n`: validação inteira não se
   aplica; siga sem histórias.)

## GATE: o operador valida a decomposição

Apresente, em conversa (nada escrito ainda):

- a tabela `ID · Título · História (US-n) · Depende de · Toca · ACs cobertos`;
- a matriz de cobertura AC → tasks (e qualquer AC descoberto, em destaque);
- o desenho do grafo em texto (ex: `001 → 002 → 003; 004 depende de 002`);
- sobreposições de `Toca` entre tasks independentes, se houver;
- **decisões de história pendentes**, em destaque: tasks cross-história (dividir ou escolher a
  dona?) e tasks sem história derivável (herdar de qual?). A escolha é do operador.

**GATE: o operador valida a decomposição antes de qualquer arquivo ser escrito.** Ajuste e
re-apresente quantas vezes ele pedir. A decomposição aprovada é a que vai para o disco —
sem "melhorias" silenciosas depois do aceite.

## Escrita dos arquivos

Um arquivo por task em `docs/epics/<slug>/tasks/NNN-<slug>.md`, seguindo o template
**verbatim** (README §12.5):

```markdown
# Task NNN — <Título>

## Status
pendente | concluída
<!-- concluída com resíduo: "concluída; ver pending.md#NNN" -->

## Depende de
[IDs de tasks, ex: 001, 003. Vazio = sem dependências, ordem livre.]

## Toca
[Write-set: arquivos/módulos que esta task ESCREVE. Verificado por hook ao
fim da task (§10) e insumo da paralelização segura. Ex: src/Domain/Assinatura.cs]

## ACs cobertos
[IDs dos critérios de aceite do PRD que esta task realiza. Ex: AC-1, AC-3]

## Objetivo
[O que esta task entrega, em uma ou duas frases.]

## Contexto
[Arquivos a tocar, módulos envolvidos, ponto de partida.]

## Critério de pronto
[Condições objetivas para a task estar concluída.]

## Tempo
<!-- preenchido por /code: iniciado / concluído / duração (relógio real, nunca estimativa) -->
```

Ao preencher: os colchetes são placeholders — substitua por conteúdo real. `## Status`
contém **apenas** `pendente` (o `pendente | concluída` do template documenta os dois únicos
valores; quem transita é o `/code`). `## Tempo` fica **vazio** — só o comentário do template,
intacto. Nenhuma seção extra, nenhuma omitida.

## Commit

Último ato de escrita, `git add` nominal — cada arquivo de task por path explícito:

```
git add docs/epics/<slug>/tasks/001-<slug>.md docs/epics/<slug>/tasks/002-<slug>.md ...
git commit -m "factory(tasks): <slug> — N tasks + grafo"
```

Ex: `factory(tasks): checkout — 4 tasks + grafo`. Estágio que não commitou não aconteceu.

## Board (via board-writer)

Só **depois** do commit. Monte o lote de verbos canônicos — um `ensure_group` por história
**que tem task** (na ordem `US-1, US-2…`) e uma task filha por task criada, na ordem
topológica, cada uma sob o `group_id` da sua história (mapa validado no gate):

```
find_by_key("<factory-key do épico>")          # recupera/confirma o feature_id — identidade antes de criação
ensure_group(<feature_id>, "<slug>#US-1", "US-1 — <título da história>",
             body=<seção "### US-1 …" do prd.md + seus ACs>)   → group_us1
ensure_group(<feature_id>, "<slug>#US-2", "US-2 — <título>", body=<seção US-2 + ACs>) → group_us2
create_task(<group_us1>, "001 — <título>", body=<conteúdo integral de 001-<slug>.md>)
create_task(<group_us1>, "002 — <título>", body=<conteúdo integral de 002-<slug>.md>)
create_task(<group_us2>, "003 — <título>", body=<conteúdo integral de 003-<slug>.md>)
...
```

**Degradação declarada, mesmo lote:** em provider com `grouping: none` (ex.: Linear), o
board-writer resolve `ensure_group` como no-op que devolve o próprio `feature_id` — as tasks
penduram direto na Feature, comportamento de sempre. Você **não** ramifica o lote por
provider; o manifesto decide. História **sem** task não gera `ensure_group` (card sem filho é
ruído); PRD legado sem `US-n` → lote sem `ensure_group`, `create_task(<feature_id>, …)`.

A **descrição de cada card de task é o `task.md` integral**, e a **descrição do card de
história é a seção `US-n` do PRD com seus ACs** (projeção de conteúdo, `factory-process.md`)
— quem olha o board lê o contrato sem abrir o repo.

A `factory-key` é o slug da pasta do épico (re-entrada: `<slug>-pNNN`); a key de cada história
é derivada: `<factory-key>#US-n`. O `feature_id` é o `Board-ID` do header. Em re-execução,
crie cards só para tasks que ainda não os têm — recuperação, não duplicação (`ensure_group` já
é find-or-create por construção).

Sequência fixa: spawne o agent `board-writer` com o lote → valide a saída estruturada:

```
powershell -NoProfile -ExecutionPolicy Bypass -File ".claude/scripts/validate-agent-output.ps1" -Required "executed,failed,blocked"
```

(saída do agent no stdin ou via `-File`; em POSIX o `/setup` instalou a variante `.sh`).
Saída inválida = re-instruir o agent, nunca prosseguir com resultado parcial.

Notas:

- **Capability `tasks` é opcional no contrato:** provider que não a tem nativa realiza o
  verbo pelo **fallback declarado no manifesto** (ex: checklist no corpo do card) —
  degradação já aceita no `/setup`. Para este estágio nada muda: o verbo é o mesmo.
- **A Feature não move de estado** — o contrato é explícito: `/tasks` cria Tasks; quem leva
  a Feature a `in_progress` é a primeira task do `/code`.
- **Try-reporta-prossegue:** board fora do ar não trava nada. O estágio está completo no
  filesystem e commitado — reporte "não consegui atualizar o board, rode `/sync` depois" e
  encerre. Jamais re-tente em loop.

## Referências

- README **§3** (tabela de comandos), **§5** (commit como fronteira da verdade), **§10**
  (os três eixos, o grafo, batch e paralelismo), **§12.5** (template de task), **§14**
  (single-writer do `task.md`: `/tasks` cria; `/code` só `Status` e `## Tempo`), **§15**
  (enforcement), **§16** (anti-patterns), **Apêndice A passo 8** (execução de referência).
- `.claude/factory-process.md` — verbos, estados, "Feature não move", derivação de estado.
- `.claude/rules/factory/` — `invariants.md`, `git.md`, `board.md`, `epics.md`,
  `filesystem.md`.
- `.claude/hooks/README.md` e `.claude/hooks/stage-map.json` — write-set deste estágio e
  hooks que o vigiam (`guard-writes`, `stop-scan`; `check-toca` vigia o `Toca` no `/code`).

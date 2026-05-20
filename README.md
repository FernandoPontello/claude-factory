# Claude Factory

Pipeline portátil para transformar **ideias e bugs** em **código mergeado** usando o Claude Code, com gates humanos explícitos entre estágios.

A factory é agnóstica de projeto: tudo que vive em `.claude/` é factory pura, sem menção ao código do projeto. Copiar `.claude/` para outro repositório = levar a factory junto.

Este README é a **fonte única de verdade** da factory — consolida manual operacional e definição do pipeline.

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Arquitetura: estágios, skills e sub-agents](#2-arquitetura-estágios-skills-e-sub-agents)
3. [Hierarquia de arquivos](#3-hierarquia-de-arquivos)
4. [Pré-requisitos](#4-pré-requisitos)
5. [Slash commands `/X`](#5-slash-commands-x)
6. [Fluxo end-to-end — feature](#6-fluxo-end-to-end--feature)
7. [Fluxo end-to-end — bug fix](#7-fluxo-end-to-end--bug-fix)
8. [Sessão por estágio](#8-sessão-por-estágio)
9. [Decisões que ficam com o operador](#9-decisões-que-ficam-com-o-operador)
10. [Convenções universais](#10-convenções-universais)
11. [Formatos canônicos (PRD, Task, tracking, closure-notes)](#11-formatos-canônicos)
12. [Ações comuns do dia a dia](#12-ações-comuns-do-dia-a-dia)
13. [Quando NÃO usar a factory](#13-quando-não-usar-a-factory)
14. [Custos, hooks e limitações](#14-custos-hooks-e-limitações)
15. [Modo batch autônomo (devcontainer)](#15-modo-batch-autônomo-devcontainer)
16. [Anti-patterns](#16-anti-patterns)
17. [Manutenção da factory](#17-manutenção-da-factory)

---

## 1. Visão geral

A factory atravessa **quatro estágios sequenciais** — Investigation, Brainstorming/Bug Investigation, Tasking e Execution+Closure. Cada estágio tem entrada bem definida, agente responsável e saída auditável.

Operacionalmente, esses quatro estágios são expostos como **seis slash commands `/X`** nativos do Claude Code, mais **dois sub-agents auxiliares** opcionais usados internamente por dois dos estágios.

```
                  ┌─────────────────┐
                  │  Ideia / Bug    │
                  └────────┬────────┘
                           ▼
              ┌─────────────────────┐
              │  /overview          │  (atualiza overviews, se necessário)
              └─────────┬───────────┘
                        ▼
  ┌─────────────────────┐    ┌─────────────────────┐
  │  /brainstorm        │ OU │  /bug               │
  │  (feature)          │    │  (bug)              │
  └─────────┬───────────┘    └────────┬────────────┘
            └────────────┬────────────┘
                         ▼
                  PRD canônico
                         ▼
                     /tasks
                         ▼
              Tasks + tracking inicial
                         ▼
                     /code  (uma task por vez)
                         ▼
                     /close (fim do épico:
                             review + closure-notes;
                             sinaliza próximo /overview)
                         ▼
              /overview (modo incremental, em nova sessão)
                         ▼
                     push final manual
```

O operador orquestra digitando `/X` em sessões Claude Code isoladas. Decisões de produto e qualidade ficam sempre com o humano — **a factory acelera tudo ao redor da decisão, não a decisão em si.**

---

## 2. Arquitetura: estágios, skills e sub-agents

### Os quatro estágios do pipeline

1. **Investigation.** Entende o estado atual do projeto. Lê código-fonte e gera/atualiza os documentos de visão em `docs/overviews/` (`product-overview.md` e `architecture-overview.md`). Roda em dois modos:
   - **Scan completo** (primeira execução, sem baseline): lê código-fonte inteiro. Custo alto. Gera overviews do zero.
   - **Incremental** (execuções subsequentes, com baseline): lê overviews atuais, faz `git diff` desde o commit registrado nos cabeçalhos, e para cada épico fechado no intervalo lê o `closure-notes.md` correspondente. Closure-notes destila as decisões arquiteturais e features adicionadas — input estruturado de alta qualidade para o update (git diff captura mudança de código, não captura o **porquê** arquitetural).

2. **Brainstorming / Bug Investigation.** Discute criticamente um input bruto até a ideia (ou a hipótese de bug) estar madura — só então fecha um PRD polido. É **interlocutor**, não fábrica de PRD: questiona como o input se encaixa no produto atual, levanta consequências e edge cases, propõe trade-offs. **PRD só é gerado quando o operador declara que a ideia está madura** — gate humano explícito.

   Dois sub-pipelines paralelos com formato de saída idêntico:
   - **Brainstorming** parte de uma ideia que ainda não existe.
   - **Bug Investigation** parte de um comportamento errado que já existe.

   Se mid-discussão o estágio identifica que o tipo do input é outro ("isto que parecia feature é na verdade bug"), ele **não invoca o outro estágio** — apenas comunica a reclassificação. O operador inicia nova sessão com o estágio apropriado.

3. **Tasking.** Quebra o PRD em tasks executáveis sequenciais. Cria a estrutura `docs/epics/<slug>/tasks/NNN-<slug>.md` (uma task por arquivo, com prompt copiável) e o `tracking.md` inicial.

4. **Execution + Closure.** Cada task do épico é executada pelo `/code` em sessão isolada — uma task por vez. Durante a execução, `/code` é **single-writer** do `tracking.md` (mantido como log datado), do Status checkbox da task atual e da seção "Notas de execução" da task atual. Faz commit por task com body padronizado.

   Quando o épico fecha, `/close` é invocado **uma única vez** e faz duas coisas em sessão única:
   - **Revisão de coerência estática task por task** — compara entregue vs pedido. Se encontra divergência, **sinaliza** marcando a task como **"Necessário avaliar"**. Não decide gravidade — operador valida.
   - **Síntese de closure-notes** consolidado. Apresenta ao operador para revisão antes de gravar. Após confirmação, grava `closure-notes.md`, atualiza `tracking.md` com data de fechamento, e sinaliza que um update do `/overview` (modo incremental) é recomendado.

   `/close` **não modifica código** (review é estático via `git show`), **não escreve em `docs/overviews/`** (single-writer = `/overview`) e **não invoca `/overview`** — apenas sinaliza.

   **Reviewer de coerência, não QA empírico.** Compara estaticamente — não roda testes, não tenta quebrar código, não decide se a entrega está "boa o suficiente".

### Seis estágios → seis skills consolidadas

Cada estágio é implementado como **skill consolidada** (persona + procedimento + escopo + output em um único arquivo) em `.claude/skills/<X>/SKILL.md`. O slash command `/X` carrega a skill automaticamente.

| Comando       | Estágio                       | Skill                                  |
|---------------|-------------------------------|----------------------------------------|
| `/overview`   | Investigation                 | `.claude/skills/overview/SKILL.md`     |
| `/brainstorm` | Brainstorming (feature)       | `.claude/skills/brainstorm/SKILL.md`   |
| `/bug`        | Bug Investigation             | `.claude/skills/bug/SKILL.md`          |
| `/tasks`      | Tasking                       | `.claude/skills/tasks/SKILL.md`        |
| `/code`       | Execution (uma task por vez)  | `.claude/skills/code/SKILL.md`         |
| `/close`      | Closure (fim do épico)        | `.claude/skills/close/SKILL.md`        |

### Sub-agents auxiliares (delegação interna opcional)

Dois sub-agents read-only que dois dos estágios podem invocar via Task tool para isolar contexto e rodar em modelo otimizado.

| Sub-agent  | Estágio invocador | Função                                                                     | `model:` | `tools:`              |
|------------|-------------------|----------------------------------------------------------------------------|----------|-----------------------|
| `scanner`  | `/overview`       | Varre código-fonte e retorna sumário arquitetural estruturado (scan completo) | haiku    | Read, Grep, Glob, Bash |
| `reviewer` | `/close`          | Revisa task-por-task um épico fechado, retorna lista de divergências        | sonnet   | Read, Grep, Bash      |

Sub-agents auxiliares são **read-only por design** — `tools:` no frontmatter exclui `Edit`/`Write`. A invocação é **opcional** (o estágio funciona standalone se a delegação falhar) e **não viola** o anti-pattern "estágios não chamam estágios": são parte interna do estágio invocador, não estágios separados.

### Single-writer principle

Cada arquivo gerado pela factory tem **um único estágio responsável pela escrita** — elimina conflito, redundância e drift silencioso.

| Arquivo                                                       | Single writer                                |
|---------------------------------------------------------------|----------------------------------------------|
| `docs/overviews/*.md`                                         | `/overview`                                  |
| `docs/epics/<slug>/prd.md`                                    | `/brainstorm` ou `/bug`                      |
| `docs/epics/<slug>/tasks/NNN-*.md` (estrutura)                | `/tasks` (criação)                           |
| `docs/epics/<slug>/tasks/NNN-*.md` (Status + Notas execução)  | `/code` (durante execução)                   |
| `docs/epics/<slug>/tracking.md` (estrutura inicial)           | `/tasks` (criação)                           |
| `docs/epics/<slug>/tracking.md` (log durante execução)        | `/code` (entradas de tasks + notas datadas)  |
| `docs/epics/<slug>/tracking.md` (data de fechamento)          | `/close` (no fim do épico)                   |
| `docs/epics/<slug>/closure-notes.md`                          | `/close`                                     |

**Implicação:** `/close` não toca em `docs/overviews/`. Ao fechar um épico, gera `closure-notes.md` e sinaliza que rodar `/overview` (modo incremental) é recomendado. **Quem invoca `/overview` é o operador**, em nova sessão.

### Escopo de leitura/escrita por estágio (resumo)

Cada estágio tem escopo cirúrgico — "verificar apenas o necessário, não explorar". A regra de ouro sobre `docs/`:

| Pasta | Status |
|---|---|
| `docs/overviews/` | factory — single-writer: `/overview` |
| `docs/epics/` | factory — vários estágios tocam dentro de subpastas específicas |
| qualquer outra (ex: `docs/raw-ideas/`) | **fora da factory** — convenção pessoal do operador, estágios NUNCA leem nem listam |

Estágios nunca executam `ls docs/` em pasta pai. Sempre listam a pasta específica que precisam ver. Detalhe completo por estágio vive nas próprias skills em [`.claude/skills/`](.claude/skills/).

---

## 3. Hierarquia de arquivos

Convenção fixa de paths torna as skills agnósticas de projeto — elas sabem onde ler e escrever sem configuração.

```
projeto-raiz/
│
├── CLAUDE.md                            # Boot da factory (Claude Code)
│
├── docs/
│   ├── overviews/
│   │   ├── product-overview.md          # Gerado por /overview
│   │   └── architecture-overview.md     # Gerado por /overview
│   │
│   └── epics/
│       └── epic-<slug>/
│           ├── prd.md                   # Gerado por /brainstorm ou /bug
│           ├── tasks/
│           │   ├── 001-<slug>.md        # Gerado por /tasks
│           │   ├── 002-<slug>.md
│           │   └── ...
│           ├── tracking.md              # Criado por /tasks, atualizado por /code e /close
│           └── closure-notes.md         # Gerado por /close, consumido por /overview
│
└── .claude/
    ├── agents/                          # Sub-agents auxiliares (scanner, reviewer)
    └── skills/                          # Skills consolidadas (uma por estágio)
```

Notas:

- Outros documentos do projeto que **não** são gerados pela factory podem coexistir em `docs/` sem padrão imposto. A factory só lê e escreve em `docs/overviews/` e `docs/epics/`.
- `epic-<slug>` usa kebab-case curto e estável: não muda depois de criado, mesmo que o título do PRD evolua.
- Numeração de tasks é zero-padded a 3 dígitos (`001`…`999`). Épico que passa de 999 tasks é grande demais — considerar split.
- Conteúdo de `.claude/` é factory pura: não menciona o projeto. Trocar de projeto = copiar `.claude/` inteiro.

---

## 4. Pré-requisitos

Antes de iniciar qualquer fluxo:

- **Claude Code instalado** no terminal local — toda a factory roda nele.
- **Working tree clean.** Os estágios recusam-se a modificar estado git com working tree sujo (gate refinado por escopo — ver §10).
- **Skills consolidadas e sub-agents auxiliares presentes em `.claude/`.**
- **Overviews iniciais em `docs/overviews/`** se você não está iniciando a factory pela primeira vez. Se for primeira vez no projeto, o **primeiro fluxo é rodar `/overview`** para gerar os overviews iniciais.

### Validação rápida

```bash
git status                        # esperado: working tree clean
ls .claude/skills/                # 6 diretórios: brainstorm, bug, tasks, code, overview, close
ls .claude/agents/                # 2 arquivos: scanner, reviewer
ls docs/overviews/ 2>/dev/null    # ideal: product-overview.md + architecture-overview.md
```

Se algum item falhar, resolva antes de iniciar trabalho.

---

## 5. Slash commands `/X`

Você invoca a factory digitando slash commands `/X` no Claude Code. Cada `/X` carrega automaticamente a skill consolidada correspondente.

| Command       | Quando usar                                                                |
|---------------|----------------------------------------------------------------------------|
| `/overview`   | Gerar overviews na primeira vez ou após épicos fecharem                    |
| `/brainstorm` | Discutir feature nova até virar PRD                                        |
| `/bug`        | Investigar bug observado até virar PRD de fix                              |
| `/tasks`      | Decompor PRD em tasks executáveis                                          |
| `/code`       | Executar uma task individual                                               |
| `/close`      | Fechar épico (review + closure-notes)                                      |

**Toda a factory roda em Claude Code** — sem alternância entre clientes. Cada `/X` em **sessão isolada**: o operador valida output entre estágios e inicia nova sessão para o próximo.

### Delegação interna opcional

- `/overview` em modo scan completo pode delegar varredura ao sub-agent `scanner` (`model: haiku`, read-only) via Task tool.
- `/close` na revisão de coerência pode delegar checklist task-por-task ao sub-agent `reviewer` (`model: sonnet`, read-only) via Task tool.

Ambas as delegações são opcionais — os estágios funcionam standalone se a delegação falhar.

### Após `/close`

`/close` sinaliza explicitamente que rodar `/overview` (modo incremental) é recomendado para propagar mudanças aos overviews. **A invocação fica com o operador** (nova sessão) — `/close` não invoca `/overview` automaticamente. Preserva o princípio de gate humano entre estágios.

---

## 6. Fluxo end-to-end — feature

### Passo 1 — Ideação (opcional)

Ambiente: qualquer (chat externo, papel, conversa interna). Pode partir de uma ideia já formada, ou conversar com um agente externo (Claude.ai web, ChatGPT, Gemini) para amadurecer. Esse pré-trabalho **não é parte formal do pipeline** — sai como texto livre que vira input do brainstormer. Pule se já tem clareza inicial sobre a ideia.

### Passo 2 — Atualizar overviews (se necessário)

Ambiente: Claude Code (sessão dedicada).

Quando rodar:
- **Primeira vez no projeto:** sempre. `/overview` detecta ausência de overviews e roda em modo scan completo.
- **Execuções subsequentes:** após cada épico fechado pelo `/close` que disparou update incremental, os overviews já estão atualizados. Force atualização se desconfiar de drift.

```
/overview
```

`/overview` detecta automaticamente o estado dos overviews e escolhe o modo (scan completo ou incremental). Se houver baseline válido, pergunta se você quer forçar scan completo novo.

**Output esperado:** `docs/overviews/product-overview.md` e `docs/overviews/architecture-overview.md` (gerados ou atualizados), com cabeçalho `<!-- last-scan-commit: <hash> -->`, mais reporte do overviewer (modo usado, mudanças aplicadas, decisões de escopo).

**Pause e revise os overviews gerados.** Eles vão alimentar todos os próximos estágios.

### Passo 3 — `/brainstorm` gera PRD

Ambiente: Claude Code (nova sessão).

```
/brainstorm
```

A primeira mensagem pede a ideia bruta. Você descreve em texto livre. O brainstormer discute criticamente: lê overviews, pergunta como a ideia se encaixa no produto atual, levanta consequências, propõe trade-offs. **Não fecha PRD prematuramente** — espera você declarar OK final explícito.

**Output esperado:** `docs/epics/<slug>/prd.md` no formato canônico (§11).

**Pause e revise o PRD.** Confira critérios de aceite verificáveis, edge cases mapeados, decisões adiadas explicitadas.

### Passo 4 — `/tasks` quebra PRD em tasks

Ambiente: Claude Code (nova sessão).

```
/tasks
```

`/tasks` detecta automaticamente PRDs aguardando decomposição (épicos com `prd.md` mas sem `tasks/`). Se houver único candidato, sugere. Se múltiplos, lista. Se nenhum, encerra.

O tasker **valida o PRD** antes de decompor (gate de entrada). Se algo faltar, comunica e encerra — nesse caso, volte ao brainstormer (`/brainstorm` em nova sessão) para completar o PRD. Se passar o gate, discute decomposição — quantas tasks, granularidade, ordem, dependências, riscos. Espera você declarar OK final.

**Output esperado:**
- `docs/epics/<slug>/tasks/001-<slug>.md` … `NNN-<slug>.md`
- `docs/epics/<slug>/tracking.md` inicial

**Pause e abra cada arquivo de task.** Confira que o "Prompt pronto pro Claude Code" começa com `Use /code para executar:` e tem estrutura auto-suficiente.

### Passo 5 — Executar tasks

Ambiente: Claude Code (nova sessão por task).

Para cada task em ordem:

```
/code <slug> <NNN>
```

ou `/code docs/epics/<slug>/tasks/NNN-<slug>.md`, ou simplesmente `/code` (lista pendentes do épico ativo e pergunta qual executar).

O coder:

1. Lê obrigatoriamente: arquivo da task, PRD, architecture-overview, tracking-log (com notas datadas).
2. Reconcilia com notas datadas — se houver recomendação afetando esta task e ele decidir divergir, justifica no commit body.
3. Implementa estritamente o escopo.
4. Roda build + testes existentes (gate verde).
5. Atualiza tracking como log datado.
6. Preenche Notas de execução da task.
7. Marca Status como `[x] Concluída`.
8. Commita com body padronizado.

Repete para cada task em ordem. **Pause após cada task** para revisar diff e commits gerados.

### Passo 6 — Fechar o épico

Ambiente: Claude Code (nova sessão).

```
/close
```

`/close` detecta automaticamente épicos com todas as tasks concluídas (sem `closure-notes.md`). Se único candidato, sugere. Se múltiplos, lista. Se nenhum, encerra.

**Duas etapas em sessão única:**

**Etapa 1 — Review do closer:**
- Code review estático task por task — compara entregue vs pedido (escopo, decisões PRD, invariantes arquiteturais).
- Se encontra divergência: marca task como `[x] Necessário avaliar` + adiciona seção `## Apontamentos do review` na task.
- **Se review limpo:** sintetiza closure-notes, apresenta para revisão, grava após confirmação.
- **Se review com incoerências:** pausa, reporta os apontamentos. Você resolve cada um (validar como aceito, pedir correção via `/code`, ou refinar decomposição via `/tasks`). Depois re-invoca `/close`.

**Etapa 2 — Sinalização (se review limpo):**
- `/close` sinaliza que rodar `/overview` (modo incremental) é recomendado.
- A invocação de `/overview` fica com o operador (nova sessão).

**Output esperado (review limpo):**
- `docs/epics/<slug>/closure-notes.md` gerado.
- `docs/epics/<slug>/tracking.md` com data de fechamento.
- Recomendação explícita do `/close` de rodar `/overview`.

### Passo 7 — Push final

Ambiente: terminal local.

```bash
git status                # confirma working tree clean
git log --oneline -10     # revisa commits do épico
git push origin <branch>
```

**Push é manual sempre.** Estágios da factory não fazem push (gate operacional do operador).

---

## 7. Fluxo end-to-end — bug fix

Análogo ao §6, mas começando com `/bug` em vez de `/brainstorm`. Diferenças concentram-se nos passos 1, 2 e 3.

### Passo 1 — Detecção do bug

Você observa comportamento errado. Pode ser via uso direto, relato de usuário, log de erro, ou exploração ad-hoc.

### Passo 2 — Atualizar overviews (se necessário)

Idem ao §6 passo 2. `/bug` precisa especialmente do `architecture-overview.md` (mapa do terreno técnico).

### Passo 3 — `/bug` gera PRD

```
/bug
```

A primeira mensagem pede a descrição do bug. Você descreve em texto livre. O bug-investigator investiga criticamente: lê architecture-overview, reproduz mentalmente, lê código suspeito, formula hipóteses de causa raiz **com evidência citável** (`arquivo:linha`), mapeia vizinhança (bugs adjacentes que podem sofrer do mesmo defeito).

Se a leitura não esclarece, propõe **investigação empírica** (sandbox de ~30min). Você decide se aprova o custo.

**Output esperado:** `docs/epics/<slug>/prd.md` com `Tipo: Bug fix` no header. Mesmo formato canônico.

**Marcação obrigatória:** se você der OK final com **hipótese de causa raiz não confirmada** (leitura inconclusiva e investigação empírica não rolou), o PRD terá seção explícita `## ⚠️ Hipótese não-confirmada` — preserva sinal de cautela ao longo do pipeline.

### Passos 4 a 7

Idênticos ao §6. O `/tasks` não distingue PRD de feature de PRD de bug fix — trata os dois igual (princípio "PRD = mesmo formato").

---

## 8. Sessão por estágio

Princípio fundamental: **cada estágio do pipeline opera em sessão Claude Code própria.** Sessão termina ao fim do estágio. Próximo estágio começa em sessão nova.

Por quê:

- **Contexto isolado.** Cada estágio carrega só o necessário. Sessão única acumularia contexto entre estágios e degradaria qualidade.
- **Gate humano explícito.** Sessões separadas forçam você a parar entre estágios e validar antes de seguir.

Workflow concreto:

1. Abra nova sessão do Claude Code no projeto.
2. Digite o slash command `/X` do estágio.
3. Conduza o estágio até output gerado e validado.
4. Feche a sessão.
5. Para o próximo estágio: abra nova sessão. Slash command novo. O estágio lê contexto do filesystem (PRD, overviews, tracking, closure-notes) — não depende de memória da sessão anterior.

### Sub-agents auxiliares dentro do estágio

Os estágios `/overview` (em modo scan completo) e `/close` (na revisão de coerência) podem invocar internamente os sub-agents auxiliares `scanner` e `reviewer` respectivamente. Essa invocação:

- Acontece **dentro da sessão atual** do estágio invocador, via Task tool.
- Isola o contexto da varredura/revisão (Claude principal recebe sumário estruturado).
- Roda em modelo otimizado (`scanner: haiku`, `reviewer: sonnet`).
- É **opcional** — o estágio funciona standalone se a delegação falhar.

Não é exceção ao princípio "sessão por estágio" — sub-agents auxiliares são parte interna do estágio que os invoca, não estágios separados.

---

## 9. Decisões que ficam com o operador

Estágios propõem, investigam, geram artefatos. **Você decide.** Em particular:

- **Aprovar/recusar/ajustar PRD** antes de invocar `/tasks`.
- **Aprovar a decomposição em tasks** antes de o tasker gerar os arquivos finais (gate de fechamento do `/tasks`).
- **Decidir prioridade entre épicos** — qual fazer primeiro, qual adiar, qual descartar.
- **Aprovar o closure-notes** antes do closer gravar (gate humano sutil dentro do `/close`).
- **Validar tasks marcadas como "Necessário avaliar"** — o closer sinaliza incoerências mas não decide gravidade. Você valida cada apontamento:
  - **Aceita:** Status volta para `[x] Concluída`.
  - **Pede correção:** task volta para `[ ] Pendente` — re-invoca `/code` para re-execução.
  - **Pede refinamento estrutural:** invoca `/tasks` em nova sessão.
- **Validar diff dos overviews atualizados** antes da gravação final.
- **Push final** — sempre manual.

A factory **não automatiza julgamento**. Acelera tudo ao redor. Esses pontos exigem juízo de valor, contexto de produto, ou conhecimento de prioridade do negócio que o estágio não tem (e nem deve ter — se tivesse, viraria acoplamento ao projeto e quebraria portabilidade).

---

## 10. Convenções universais

Princípios respeitados por toda skill.

### Working tree clean é gate (refinado por escopo)

Rode `git status --porcelain` como primeiro comando da sessão. Saída vazia = clean. Saída com linhas = sujo. **Não infira estado** — sempre execute o comando.

Critério refinado: dirty bloqueia apenas dentro do escopo de escrita do estágio. Modificações fora desse escopo são reportadas mas não bloqueiam.

| Saída de `git status --porcelain` | Ação |
|---|---|
| Vazia | Prossiga normalmente. |
| `M`/`A`/`D` dentro do escopo de escrita do estágio | **Bloqueante.** Pausa, reporte, não tente limpar. |
| `M`/`A`/`D` FORA do escopo de escrita | Reporte ao operador, mas prossiga. |
| `??` (untracked) que são output esperado do estágio | Prossiga. |
| `??` que NÃO são output esperado | Reporte, mas prossiga. |

Exemplos: `/bug` invocado com `M docs/overviews/architecture-overview.md` reporta e prossegue (overview está fora do escopo do bug-investigator). `/overview` no mesmo cenário bloqueia (overview está no escopo dele). `/code` bloqueia em qualquer modificação não-commitada de código, porque o escopo do coder é amplo.

### Lista nominal no `git add`

`git add` usa **lista explícita de arquivos**, nunca `git add -A`, `git add .` ou `git add -u`. Evita capturar artifacts indevidos (binários, caches, logs, temporários).

### Verificação programática antes de declarar bloqueante

Code review e validações **executam** checagem (build, teste, lint, smoke) antes de declarar qualquer bloqueante. Inferência por inspeção estática sem execução é falso positivo até prova em contrário. Quando a verificação programática não está disponível no ambiente, a skill reporta a limitação e devolve a decisão ao operador.

### Verificação ativa via filesystem

Estágios **nunca inferem** existência ou estado de arquivo. Quando um pré-requisito precisa ser verificado, use tool de filesystem ativamente (`test -f`, `head -3`, ou Read tool). A verificação é **cirúrgica**: apenas os arquivos listados em §Pré-requisitos da skill, com comandos pontuais. Não rode `ls` em pasta pai.

### Operações git permitidas / proibidas

**Permitidos:** `git status`, `git log <range>`, `git diff <range>`, `git diff --stat`, `git show <hash>`, `git ls-files`, `git add <paths nominais>` (apenas no fim), `git commit -m` (apenas uma vez ao final).

**Proibidos para estágios:**

| Comando | Motivo |
|---|---|
| `git checkout` (qualquer forma) | Toca índice — colide com `index.lock` em Windows + FUSE |
| `git rm`, `git tag`, `git push` | Operações estruturais — gate do operador |
| `git rebase`, `git merge`, `git cherry-pick` | Idem |
| `git reset` (qualquer forma) | Risco de perda de trabalho |
| `git stash` | Mascara estado — "limpeza" oculta |

Para restaurar arquivo dirty pós-commit (closer apenas): `git show HEAD:<arquivo> > <arquivo>` — sobrescrita via redirect, sem tocar índice.

### Operações shell desencorajadas

| Comando | Por quê | Alternativa |
|---|---|---|
| `find` (sem path específico) | Lista demais | Path específico ou Glob tool |
| `ls docs/` (pasta pai) | Lista pastas fora do escopo factory | `ls docs/epics/` ou `ls docs/overviews/` |
| `ls -R` | Recursão expõe pastas não-factory | Listagem cirúrgica |
| `cat <arquivo grande>` | Lê tudo, custoso | `head -N` ou Read com offset/limit |
| `grep -r` (sem path específico) | Varre projeto inteiro | Path específico ou Grep tool |

### Reportar o que NÃO foi feito

Toda skill que termina um estágio reporta explicitamente o que ficou de fora: decisões adiadas, escopo cortado, dúvidas não resolvidas. **Silêncio é o pior bug do pipeline** porque não há trace.

### PRD = mesmo formato (feature ou bug)

O tasker não distingue se um PRD nasceu de feature nova ou bug fix. Trata os dois igual. Brainstormer e bug-investigator produzem o **mesmo schema de output**. A única diferença visível é o campo `Tipo` no header do PRD.

---

## 11. Formatos canônicos

### 11.1 PRD — `docs/epics/<slug>/prd.md`

```markdown
# PRD — <Título>

## Origem
- **Tipo:** Feature nova / Bug fix
- **Data:** YYYY-MM-DD
- **Discutido com:** <agente IA web e/ou operador>

## Contexto
[1-3 parágrafos. Para bug: comportamento errado observado + impacto.
Para feature: a dor que motiva o trabalho.]

## Comportamento esperado
[Descrição detalhada. Para bug: comportamento correto pós-fix.
Para feature: comportamento novo end-to-end.]

## Critério de aceite
- [ ] Critério mensurável 1
- [ ] Critério mensurável 2
(Verificáveis. Evite "sistema funciona bem"; prefira "endpoint X
retorna 200 com payload Y para input Z".)

## Casos de exemplo
[Cenários concretos. Para bug: passos de reprodução + atual + esperado.
Para feature: 2-3 fluxos representativos.]

## Edge cases mapeados
[Casos limite + tratamento esperado ou decisão de não tratar.]

## Decisões de design tomadas
[Pontos com trade-off real + o que escolhemos + por quê.]

## Decisões adiadas
[O que conscientemente NÃO entra no escopo. "Fora do escopo" +
referência como épico futuro potencial.]

## Estimativa
- Tasks esperadas: ~N
- Complexidade: baixa / média / alta
```

Regras: `Tipo` muda entre "Feature nova" e "Bug fix"; demais seções têm o mesmo schema. Decisões adiadas **não** geram tasks neste épico. Critério de aceite tem que ser verificável; se não for, a skill devolve para o operador antes de fechar o PRD.

### 11.2 Task — `docs/epics/<slug>/tasks/NNN-<slug>.md`

````markdown
# Task <NNN> — <Título>

## Status
- [ ] Pendente
- [ ] Concluída
- [ ] Necessário avaliar

## Contexto
[O que esta task faz dentro do épico. Como se conecta com anteriores
e seguintes. Suficiente sem reler o PRD inteiro.]

## O que fazer
[Descrição técnica. Específica o suficiente para não deixar
ambiguidade, genérica para não amarrar a solução em detalhes
desnecessários.]

## Nuâncias técnicas
[Invariantes, padrões do projeto, gotchas conhecidos, side-effects,
interações com módulos vizinhos.]

## Arquivos afetados
- `caminho/arquivo1.ext`
- `caminho/arquivo2.ext`

(Não é contrato rígido — coder pode tocar em mais arquivos. Mas
divergência grande = task mal escopada.)

## Critério de conclusão
- [ ] Build passa
- [ ] Testes existentes continuam verdes
- [ ] [Critério específico desta task]

## Prompt pronto pro Claude Code

```
Use /code para executar:

[Bloco copiável auto-suficiente — estrutura mínima:
1. Contexto curto da task (1-2 frases).
2. Leitura obrigatória de contextos pelo coder: arquivo da task, PRD,
   architecture-overview, tracking.md (especialmente "Notas de execução
   do épico" — notas datadas de tasks anteriores).
3. O que fazer (escopo da task).
4. Arquivos afetados.
5. Nuâncias técnicas.
6. Critério de conclusão.
7. Escopo de escrita do coder, explícito e positivo (código + Notas de
   execução desta task + Status desta task + tracking.md). NÃO toca em
   PRD, overviews, outras tasks, closure-notes, .claude/.
8. Reconciliação com notas datadas se houver recomendação de tasks
   anteriores afetando esta — justificar divergências no commit body.
9. Não estender escopo silenciosamente — oportunidades fora de escopo
   viram nota [fora-de-escopo] sem implementação.
10. Commit body padronizado: arquivos tocados, decisões de design, edge
    cases descobertos, testes (novos + total verde).
11. Quando dar a task como concluída: critério de conclusão verde, build
    + testes verdes, tracking atualizado, Notas de execução preenchidas,
    Status marcado como [x] Concluída, commit feito.]
```

## Notas de execução
[Preenchido pelo /code durante a execução: arquivos tocados,
decisões de design, divergências de notas datadas com justificativa,
edge cases descobertos, achados [fora-de-escopo] não implementados,
resultado de testes, hash do commit.]
````

**Estados de Status — transições:**

```
[ ] Pendente
    ↓ (coder executa, build/teste verde, commita)
[x] Concluída
    ↓ (closer faz review de coerência ao fim do épico)
    ├── review limpo → permanece [x] Concluída
    └── review aponta divergência → [x] Necessário avaliar
        ↓ (operador valida cada apontamento)
        ├── aceita → [x] Concluída
        ├── pede correção → volta a [ ] Pendente (coder re-executa)
        └── pede refinamento estrutural → operador invoca /tasks
```

Apenas o **closer** marca "Necessário avaliar". Apenas o **coder** marca "Concluída". Volta para "Pendente" só por decisão do operador.

Regras adicionais: numeração estável (task `005` continua sendo `005` mesmo se a `004` for excluída). O prompt pronto é auto-suficiente — se o executor precisar abrir o PRD para entender, a task está mal escrita. Tasks são pensadas para serem executadas em ordem. Cada task fecha com **um commit** quando possível.

### 11.3 Tracking — `docs/epics/<slug>/tracking.md`

Tem **três fases de ownership**:

1. **Criação inicial pelo `/tasks`** — estrutura com status geral, lista de tasks pendentes, flags de risco.
2. **Manutenção como log pelo `/code`** durante execução — atualiza entrada da task (status, hash do commit, sumário fiel das Notas de execução) e adiciona **notas datadas** em "Notas de execução do épico" quando descobre algo que afeta tasks futuras.
3. **Fechamento pelo `/close`** — data de fechamento, status de tasks com incoerência detectada, nota datada final.

O `/code` da task NNN+1 **lê as notas datadas** que existem no tracking antes de implementar — aprendizados acumulados afetam tasks subsequentes. Tracking funciona como **log executável** consumível por outras tasks da sequência.

```markdown
# Tracking — Épico <slug>

## Status geral
- **Iniciado:** YYYY-MM-DD
- **Concluído:** [vazio até fechamento]
- **Total de tasks:** N
- **Concluídas:** X
- **Pendentes:** Y

## Tasks

### Task 001 — <título>
- Status: [pendente / em execução / concluída]
- Commit: [hash quando concluída]
- Notas: [observações]

(... uma entrada por task ...)

## Notas de execução do épico
[Anotações livres conforme épico avança. Aprendizados gerais,
problemas estruturais, decisões mid-épico. Material que operador
relê meses depois quando ajustar a factory.]
```

`tracking.md` é a **fonte de verdade do estado do épico**. O `/code` atualiza incrementalmente sem reescrever histórico. Notas datadas durante execução são input do coder das tasks subsequentes — escreva pensando em quem vai ler.

### 11.4 Closure-notes — `docs/epics/<slug>/closure-notes.md`

Gerado pelo `/close` ao fechar o épico, consumido pelo `/overview` em runs incrementais subsequentes.

```markdown
# Closure Notes — Épico <slug>

## Resumo
[1-2 parágrafos do que o épico entregou. Tom executivo: "o que existe
agora que não existia antes". Sem detalhe de implementação.]

## Tasks executadas
[Lista resumida com status final. Uma linha por task: número, título,
status, hash do commit que fechou.]

## Decisões arquiteturais tomadas
[O que decidimos, alternativas consideradas, por quê escolhemos esta.
Input principal do overviewer para o próximo update do
architecture-overview.md.]

## Features adicionadas
[O que o sistema agora faz. Comportamento end-to-end, não detalhe
de implementação. Input principal do overviewer para o próximo
update do product-overview.md.]

## Mudanças em padrões existentes
[Convenções que mudaram, padrões revisados, contratos quebrados
intencionalmente. Inclui migrações que deixam dívida temporária.]

## Pendências conhecidas
[Escopo deixado fora intencionalmente, débito técnico aceito,
comportamentos sub-ótimos. Cada um marcado com gravidade e
candidato a virar épico próprio.]

## (opcional) Incoerências resolvidas durante review
[Tasks que foram marcadas como "Necessário avaliar" pelo closer
e depois resolvidas pelo operador. Útil para calibração futura.]

## Commit final do épico
[Hash do último commit relevante. Investigator usa para marcar
baseline no próximo run incremental.]
```

Regras: closure-notes é **destilado, não diário** — não é cópia do `tracking.md`. "Decisões arquiteturais" e "Features adicionadas" são as duas seções que o overviewer consome literalmente — escrever com isso em mente. Sem **Commit final**, overviewer não sabe onde começar o `git diff` no próximo ciclo. Gerado **uma vez** ao fechar o épico; não é editado depois — se algo mudar, vira input de épico novo.

---

## 12. Ações comuns do dia a dia

**"Tenho uma ideia. Como começo?"**
→ Fluxo do §6 a partir do Passo 3 (`/brainstorm`), assumindo overviews atualizados.

**"Encontrei um bug. Como reporto?"**
→ Fluxo do §7 a partir do Passo 3 (`/bug`).

**"Como sei o estado atual de um épico em progresso?"**
→ Abra `docs/epics/<slug>/tracking.md`. É a fonte de verdade. Durante a execução, o coder mantém o tracking como log datado — cada entrada de task tem hash, status, notas. Notas datadas em "Notas de execução do épico" capturam aprendizados que afetam tasks futuras.

**"Uma task rodada deu errado. Como reabro?"**
- **Erro pontual de execução:** o coder reporta. Você decide se tenta de novo (`/code`) ou reabre.
- **Decomposição precisa refinar:** invoque `/tasks` em nova sessão — não edite tasks à mão (perde rastreabilidade).
- **PRD precisa revisão:** invoque `/brainstorm` ou `/bug` (conforme tipo) em nova sessão. PRD pertence ao writer original.

**"`/close` marcou task como 'Necessário avaliar'. O que fazer?"**
→ Abra a task e leia `## Apontamentos do review`. Para cada apontamento:
- **Aceito** (não é problema real): Status → `[x] Concluída`, remove os Apontamentos.
- **Pede correção:** Status → `[ ] Pendente`, re-invoca `/code` com instrução clara.
- **Refinamento estrutural:** invoque `/tasks` em nova sessão.

Após resolver todos, re-invoque `/close` para finalizar.

**"Como abandono um épico?"**
1. Marque o estado final em `tracking.md` ("Status geral: abandonado em YYYY-MM-DD — motivo: ...").
2. Opcional: invoque `/close` mesmo assim — gera closure-notes parcial (útil para o overviewer).
3. Se preferir esconder, mova `docs/epics/<slug>/` para `_archived-epics/`.

**"Tenho 3 épicos pequenos prontos pra fechar. Faço update do overview a cada um ou junto?"**
→ `/overview` em modo incremental lê todos os closure-notes adicionados desde o último baseline. Você pode rodar `/close` para os 3 épicos consecutivamente e depois rodar `/overview` (modo incremental) uma única vez ao final — mais eficiente.

**"O slash command `/X` não foi reconhecido. O que faço?"**
- Digite `/` e veja a lista (Claude Code mostra os disponíveis).
- Confirme que `.claude/skills/` tem os 6 diretórios esperados (cada um com `SKILL.md` válido com frontmatter `name:` correspondente).
- Confirme que está no diretório do projeto quando abrir o Claude Code.
- Se persistir e nem `/init`/`/review` aparecem, o problema é de configuração do Claude Code, não da factory.

---

## 13. Quando NÃO usar a factory

Cenários onde o fluxo formal é overhead desnecessário:

- **Mudança trivial.** Typo em string, ajuste de cor em CSS, rename de variável local. PRD + tasks + closer custa mais que o trabalho.
- **Hotfix urgente.** Sistema em produção quebrado, precisa fix em minutos. Pipeline leva horas — não cabe.
- **Exploração / spike.** Quer testar uma ideia rápida sem comprometer com épico.

O que fazer nesses casos: faça a mudança direto, manualmente ou via Claude Code, sem passar pela factory. Mas:

- Use commit message clara explicando que foi fora-de-fluxo: `chore: typo fix in X (out-of-pipeline, trivial)` ou `fix(hotfix): incident YYYY-MM-DD — out-of-pipeline urgent fix`.
- Spikes que viram código produtivo retornam para o pipeline depois: abra `/brainstorm` com a ideia já validada empiricamente.

Se você está **sempre** fora-de-fluxo, considere se o pipeline está calibrado errado para a natureza do trabalho — vale revisar este README e as skills em `.claude/skills/`.

---

## 14. Custos, hooks e limitações

- **Sessões Claude Code consomem quota proporcional ao escopo do estágio.** `/overview` em scan completo, `/bug` em investigação ampla e `/close` em review de épicos grandes são os mais pesados. Planeje sessões com escopo definido.
- **`/overview` em scan completo é caro em tokens.** Primeira execução demora e consome bastante quota. Modo incremental é significativamente mais barato. Mitigação: delegação ao sub-agent `scanner` (`model: haiku`) reduz o custo da varredura mecânica.
- **`/close` em épicos grandes (>10 tasks) é pesado** — faz review estático task-por-task. Mitigação: delegação ao sub-agent `reviewer` (`model: sonnet`).
- **Estágios pausam por pré-requisito faltando** — `/brainstorm` pausa sem `product-overview.md`, `/tasks` pausa se PRD estiver incompleto, `/close` pausa se houver tasks sem hash. **Pausa não é falha — é gate funcionando.**
- **Extended Thinking em `/brainstorm` e `/bug`** é ativado sob demanda quando o estágio sinaliza trade-off arquitetural genuíno. Custo extra só é cobrado quando você ativa.

### Hooks opcionais (custo zero em tokens)

A factory disponibiliza hooks shell opcionais em `.claude/hooks/` que reduzem fricção operacional sem gastar tokens:

- `notify-on-stop.sh`: notifica fim de `/code` via som ou notificação do sistema (cross-platform).
- `suggest-next-task.sh`: lê `tracking.md` e sugere a próxima task pendente do épico ativo após `/code`.

Para ativar, registre em `.claude/settings.json` (ver [`.claude/hooks/README.md`](.claude/hooks/README.md)). Executam fora do contexto do modelo. Operador instala se valoriza redução de fricção.

---

## 15. Modo batch autônomo (devcontainer)

Modo opcional de execução autônoma de tasks via devcontainer + script. Permite executar todas as tasks pendentes de um épico em sequência sem invocar `/code` task por task.

### Quando usar

**Apropriado quando:**
- O épico tem tasks bem decompostas (output do `/tasks` validado).
- Os prompts das tasks são auto-suficientes (sem decisões de design ad-hoc).
- A branch é isolada (não main/master).
- Você confia no escopo do épico para deixar rodar sem supervisão direta.
- Você quer revisar diffs em lote no fim, em vez de um por um.

**NÃO apropriado quando:**
- Tasks têm decisões de design não-resolvidas no PRD.
- PRD tem seção `## ⚠️ Hipótese não-confirmada` (risco de fix em direção errada acumular sem aviso).
- Você quer ver cada decisão do `/code` em tempo real para calibrar.
- Primeira execução do épico — vale rodar modo interativo para validar a decomposição.

### Setup

A factory inclui:

- **`.devcontainer/devcontainer.json`** — devcontainer baseado em Ubuntu com a feature oficial Anthropic Claude Code. Volume persistente para credenciais (`claude-code-config` mount).
- **`.claude/scripts/run-batch.sh`** — script bash que itera tasks pendentes de um épico e invoca `claude -p "/code <slug> <NNN>"` em modo headless para cada uma.

### Como ativar

1. **Pré-requisito local:** VSCode com extensão "Dev Containers" (e Docker Desktop rodando).
2. **Abrir projeto no VSCode** apontando para a raiz.
3. **"Reopen in Container"** (palette de comandos). VSCode constrói o devcontainer.
4. **Autenticar Claude Code** dentro do container (uma vez — persistido via volume): `claude` interativo, completar OAuth.
5. **Confirmar branch isolada:** `git checkout -b epic/<slug>`.
6. **Working tree limpo:** `git status` deve estar vazio.
7. **Rodar o batch:**

   ```bash
   ./.claude/scripts/run-batch.sh <slug-do-epico>
   ```

   O script lista tasks pendentes, pede confirmação `y/N`, e executa em sequência.

### Comportamento do script

- **Iteração ordenada:** tasks executadas em ordem numérica crescente.
- **Contexto fresco por task:** cada `claude -p "/code ..."` é uma sessão isolada (princípio "sessão por estágio" preservado).
- **Permission mode `auto`:** classifier server-side bloqueia ações perigosas. Se ações legítimas forem bloqueadas com frequência, escale para `--dangerously-skip-permissions` editando o script (com cautela).
- **Para na primeira falha:** se uma task falha, o batch para. O operador decide se corrige ou refaz a decomposição.
- **Tasks já concluídas são puladas** automaticamente. Pode reinvocar para retomar de onde parou.
- **Notas datadas no tracking** continuam funcionando — `/code` headless preenche tracking durante execução, próxima task lê normalmente.

### O que o batch NÃO faz

- **Não fecha o épico.** Após o batch terminar, invoque `/close` em sessão Claude Code interativa **no host** (não no devcontainer) — review visual do diff dos overviews requer presença humana.
- **Não faz `git push`.** Push final continua manual sempre.
- **Não atualiza overviews.** `/overview` (modo incremental) é invocado pelo operador depois do `/close`.

### Gates preservados no batch

- **Working tree clean** — verificado pelo script antes de iniciar.
- **Sessão por estágio** — cada task é sessão própria do `claude -p`.
- **Single-writer** — `/code` continua respeitando escopo de escrita restrito.
- **Build + testes verdes como gate** — `/code` para se algo falhar, batch para junto.
- **Push manual** — fora do escopo do batch.

### Fluxo end-to-end com batch

```
Operador (host, sessão Claude Code interativa):
  /overview                 → atualiza overviews
  /brainstorm  ou  /bug     → gera PRD
  /tasks                    → decompõe em tasks + tracking inicial
  → valida output, cria branch epic/<slug>

Operador (VSCode + devcontainer):
  Reopen in Container
  ./.claude/scripts/run-batch.sh <slug>
  → confirma escopo
  → batch executa todas as tasks pendentes em sequência
  → batch reporta sucesso ou falha

Operador (host, sessão Claude Code interativa):
  /close <slug>            → review estático + closure-notes
  /overview                → modo incremental, atualiza overviews
  git push origin <branch> → push final manual
```

### Limitações conhecidas

- **Batch não substitui `/close`.** Mesmo com 100% das tasks concluídas, você precisa invocar `/close` no host para o review estático e a síntese de closure-notes.
- **Pode rodar em fundo, mas tem custo em tokens proporcional ao trabalho real.** Não é "grátis" — só elimina copy-paste manual e presença ativa.
- **Erros silenciosos do `--permission-mode auto`:** se o classifier bloquear ações legítimas, a task pode falhar com mensagem genérica. Investigar com `--permission-mode acceptEdits` em sessão isolada.
- **Devcontainer requer Docker** local. Sem Docker, modo batch indisponível — modo interativo continua funcionando normalmente.

---

## 16. Anti-patterns

O que **NÃO fazer**, com motivo curto:

- **Skill mencionar projeto específico.** Acopla factory ao projeto. Quebra portabilidade. Específico do projeto vai em `docs/`, não em `.claude/`.
- **Estágio decidir prioridade de épicos.** Decisão de produto é humana. Estágio pode sugerir ordem técnica, mas não decide o que entra no roadmap.
- **Sessão única atravessando múltiplos estágios.** Acumula contexto, degrada qualidade, mistura personas. Cada estágio tem sessão própria.
- **Code review sem executar build.** Falso positivo. Verificação programática antes de declarar bloqueante.
- **`git add -A` em sandbox.** Captura artifacts (binários, caches, gerados). Sempre lista nominal.
- **Estágio invocar outro estágio diretamente.** Encadeamento automático estágio → estágio destrói o gate humano. **Exceção autorizada — sub-agents auxiliares** (`scanner`, `reviewer`): parte interna do estágio invocador, read-only por design, não estágios separados.
- **Manter um arquivo `lessons.md` central.** Lições viram comportamento incorporado nas skills. Reflexões eventuais vão em `tracking.md` do épico relevante.
- **Pular a Investigation no primeiro contato com um projeto novo.** Skills downstream assumem `docs/overviews/` populado. Sem ele, brainstormer e tasker operam às cegas.
- **Tasker emitir tasks sem prompt pronto.** Sem prompt pronto, o executor reinventa o framing toda vez.
- **Closer modificar overviews diretamente.** Closer gera `closure-notes.md` e sinaliza recomendação. Quem atualiza overviews é o `/overview`. Single-writer principle.
- **Operador esquecer de rodar overviewer após fechamento de épico.** Closure-notes não consumido = overviews ficam stale. Workflow: épico fechado → `/overview` (modo update) → push final.
- **Closure-notes vazio ou só com resumo.** Sem decisões arquiteturais e features adicionadas explicitadas, o overviewer perde o canal estruturado de update e cai no scan completo.

---

## 17. Manutenção da factory

A factory não é estática. Polimento é parte do uso — mas só com **trigger explícito de uso real** (princípio "factory é destilação, não construção"). Atrito real dispara mudança real.

Cadência sugerida:

- **Após cada épico fechado.** Avalie se algum passo precisou ajuste improvisado. Se sim, abra nova sessão e ajuste a skill ou este README diretamente — sem catálogo intermediário de sugestões.
- **A cada N épicos** (N conforme cadência do projeto). Releia este README e as skills com olhar crítico. Identifique padrões recorrentes de atrito ainda não absorvidos. Ajuste em sessão dedicada.
- **Quando construir nova fase da factory.** Releia este README integralmente antes de escrever qualquer nova skill ou sub-agent auxiliar.

---

## Referências

- [`.claude/skills/`](.claude/skills/) — skills consolidadas dos 6 estágios (persona + procedimento + escopo + output por estágio).
- [`.claude/agents/`](.claude/agents/) — sub-agents auxiliares (`scanner`, `reviewer`).
- [`.claude/hooks/README.md`](.claude/hooks/README.md) — hooks shell opcionais.
- [`.claude/scripts/run-batch.sh`](.claude/scripts/run-batch.sh) — script de execução autônoma de tasks (modo batch).

---
name: ground
description: Fundo a verdade de base do projeto — destilo os drafts (projeto novo) ou scaneio o código (codebase existente) e nascem os dois overviews. Uma vez na vida do projeto.
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write|NotebookEdit"
      hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-writes.ps1" -Stage ground
  Stop:
    - hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-scan.ps1" -Stage ground
---

# /ground — fundar a verdade de base

Estágio papel-neutro (README §2): não exige decisão humana de domínio — funda a verdade de base por destilação ou scan — então qualquer papel pode dispará-lo. Roda **uma vez na vida do projeto** e gera os dois overviews em `docs/overviews/`. A manutenção posterior é do `/close` (README §8); não existe atualização incremental.

## Regras inegociáveis

1. **Roda uma vez.** Se qualquer um dos dois overviews existe **commitado** — faz parte do HEAD, verificável com `git ls-files -- docs/overviews/` (ou `git log` dos paths) —, **recuse e pare**: "os overviews já foram fundados; a manutenção é do `/close` — não há atualização incremental". Não sobrescreva, não 'complete', não 'melhore'. Overviews presentes **só no working tree**, sem commit, não são fundação: são `/ground` interrompido antes do commit — retomada legítima (README §5): complete e commite.
2. **Modo por evidência verificada, nunca por suposição** (`.claude/rules/factory/filesystem.md`). *Destila*: existem `docs/proposals/<projeto>/product-draft.md` **e** `architecture-draft.md` co-locados, e **não** há código. *Scaneia*: não há drafts e **há** codebase. Rodar o modo errado produz overviews pobres — anti-pattern nomeado (README §16). Evidência ambígua → apresente-a e devolva a decisão ao operador.
3. **Write-set:** apenas `docs/overviews/product-overview.md` e `docs/overviews/architecture-overview.md` (`.claude/hooks/stage-map.json`; o hook de single-writer bloqueia o resto).
4. **Cabeçalho-instrução no topo de cada overview** (README §8): bloco `<!-- ESTE ARQUIVO / NÃO É / ATUALIZE SÓ QUANDO -->`, adaptado — architecture = invariantes; product = superfície atual. Sem ele, o `/close` perde a instrução de reconciliação.
5. **Overview é definição, não log** (README §8). Nada de histórico, narrativa de sprint ou intenção futura: o que o projeto **é**.
6. **GATE:** o operador valida os dois overviews **antes do commit**. Em modo scan, a conferência do `architecture-overview` exige olho técnico (Dev) — o PO pode ter disparado, mas a conferência segue a natureza do artefato (README §2).
7. **Commit canônico como último ato:** `factory(ground): <projeto> — overviews fundados (destila|scan)`. `git add` **nominal** — os dois paths explícitos, nunca `.` ou `-A`.
8. **Não toca o board.** Este estágio não emite verbo canônico algum e não spawna o `board-writer` — não há projeção a fazer (README §3, tabela de comandos).
9. **`docs/proposals/` só é lido aqui (modo destila) e no `/promote`** — única exceção ao isolamento da idealização (README §13). Nenhuma outra leitura de proposals é legítima.
10. **A Lei da Factory:** a IA destila/scaneia e propõe; quem valida a fundação é o operador. Conflito entre drafts, ambiguidade de evidência, interpretação incerta do código → devolva a decisão, não decida.

## Pré-condições

- Nomeie a sessão `<projeto>/ground` (convenção `<épico>/<estágio>`; o alvo deste estágio é o projeto inteiro).
- O hook `gate-stage` (`UserPromptExpansion`) já validou tree limpa — ou suja apenas dentro do write-set deste estágio (retomada de `/ground` interrompido, README §5) — e o frescor de `docs/**` contra o origin. Se ele instruir `git pull --ff-only`, essa é a única reconciliação sancionada.
- **Verifique antes de afirmar**, com globs precisos:
  - Overviews: `docs/overviews/product-overview.md`, `docs/overviews/architecture-overview.md`. Qualquer um **no HEAD** (`git ls-files -- docs/overviews/`) → regra 1, recuse. Presente só no working tree → retomada (regra 1): complete e commite.
  - Drafts: `docs/proposals/*/product-draft.md` e `docs/proposals/*/architecture-draft.md` — os dois, **na mesma pasta de proposta** (par de nascimento, README §3). Mais de uma pasta candidata → pergunte ao operador qual projeto fundar.
  - Código: `git ls-files -- ':!docs' ':!.claude' ':!.claude-plugin'` e avalie o resto. Arquivos de código-fonte contam; `CLAUDE.md`, `README.md`, `.gitignore` e configuração de raiz, não.

## Detecção de modo

| Drafts (par completo) | Codebase | Modo |
|---|---|---|
| sim | não | **destila** |
| não | sim | **scaneia** |
| sim | sim | ambíguo — apresente a evidência (quais arquivos, quanto código) e **devolva a decisão ao operador** |
| não | não | bloqueado — não há o que fundar: rode `/vision` e `/blueprint` antes (projeto novo) |

Anuncie o modo detectado e a evidência ("encontrei os dois drafts em `docs/proposals/<projeto>/`, nenhum código fora de `docs/` → modo destila") antes de produzir qualquer coisa.

## Modo destila (projeto novo)

Os dois drafts são todo o input — leitura sancionada de `docs/proposals/<projeto>/` (regra 9). A operação é **combinação, não criação**:

- `product-draft.md` → `product-overview.md`: o que é o produto, usuários e capacidades principais viram a superfície inicial. "Fora de escopo" e "Restrições conhecidas" entram como limites declarados da superfície.
- `architecture-draft.md` → `architecture-overview.md`: a seção `## Invariantes` do draft é a base declarada (README §12.2: "estas viram a base do architecture-overview após o /ground"); padrão arquitetural, convenções e stack completam.
- Decisões e trade-offs do draft **não** migram como narrativa — só o resultado deles, se virou invariante. O registro do debate fica no draft; o overview é definição.
- Não invente: capacidade que não está no product-draft não entra; invariante que não está no architecture-draft não entra. Inconsistência entre os dois drafts (ex.: capacidade prometida que a arquitetura não comporta) → aponte e **devolva ao operador** — nunca resolva em silêncio.

## Modo scan (codebase existente)

Compreenda **estrutura, padrões e convenções** do código — não cada linha. O que se busca:

- **Para o `architecture-overview`:** padrão arquitetural real (não o aspiracional de algum doc solto), convenções de nomenclatura e organização de módulos, regras estruturais que o código respeita consistentemente, stack e integrações. Cada invariante extraído carrega **evidência** (paths que o comprovam) — invariante sem evidência é palpite, e palpite não funda verdade.
- **Para o `product-overview`:** o que o sistema é e a superfície atual — endpoints, comandos, telas, jobs, contratos públicos. Capacidades, não arquivos.
- Padrão seguido por 9 módulos e violado por 1: o invariante é o dos 9; a violação é observação a relatar no gate, não regra a registrar.

**Codebase pequena:** leia diretamente na sessão, por amostragem dirigida (entrypoints, módulos de domínio, configuração).

**Codebase grande:** fan-out de agents `scanner` (read-only, `memory: project`) via tool `Task`, um por escopo disjunto (módulo/diretório) — paralelismo seguro porque é leitura pura; o gate humano vem depois, na validação dos overviews (README §3). Teto natural: 16 agents concorrentes. Cada `scanner` recebe escopo explícito e a instrução de devolver **JSON** com as chaves `invariants`, `surface`, `conventions`, `doubts` (contrato de `.claude/agents/scanner.md`) — a evidência em `path:linha` vive **dentro** de cada item, e as `doubts` são material para o gate humano. Valide cada saída:

```
<saída do scanner> | powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/scripts/validate-agent-output.ps1" -Required "invariants,surface,conventions,doubts"
```

Falhou → re-instrua o agent; **nunca prossiga com saída parcial** (README §15). Com as saídas válidas, sintetize na sessão principal: invariantes e convenções convergentes entre escopos sobem ao overview; divergências entre módulos e as `doubts` dos scanners viram pergunta para o gate.

Os scanners **não escrevem nada** — nem filesystem, nem board. Só a sessão principal escreve os overviews.

## Os dois overviews

Ambos em `docs/overviews/`, ambos com o cabeçalho-instrução no topo — ele é a instrução que o `/close` lerá a cada reconciliação futura.

`architecture-overview.md` — guarda **invariantes** (cabeçalho verbatim do README §8):

```markdown
<!--
ESTE ARQUIVO: invariantes de arquitetura (convenções, padrões, regras estruturais).
NÃO É: log de mudanças, histórico de features, registro de implementação.
ATUALIZE SÓ QUANDO: um invariante muda. Seguir um padrão existente NÃO é mudança.
-->

# Architecture Overview — <Nome do Projeto>

## Padrão arquitetural
[A decisão estrutural em vigor. Ex: DDD com CQRS estrito — commands via endpoints REST,
queries via endpoint único GraphQL.]

## Convenções
[Nomenclatura, organização de módulos, padrões de código.
Ex: Load*Async como padrão de nome para carregamento de agregados.]

## Invariantes
[As regras que NÃO podem ser violadas sem revisão arquitetural.
Em modo scan, cada uma com a evidência (paths) que a comprova.]

## Stack e integrações
[Tecnologias, frameworks, serviços externos em uso.]
```

`product-overview.md` — guarda a **superfície atual do produto** (cabeçalho adaptado: superfície, não invariantes):

```markdown
<!--
ESTE ARQUIVO: a superfície atual do produto (o que ele é e quais suas funcionalidades).
NÃO É: log de mudanças, histórico de features, registro de implementação.
ATUALIZE SÓ QUANDO: uma capacidade entra ou sai. Crescimento de superfície, não de histórico.
-->

# Product Overview — <Nome do Produto>

## O que o produto é
[1-3 parágrafos em linguagem de negócio: problema, para quem, valor central.]

## Superfície atual
[As capacidades, uma a uma, no nível de endpoint/comando/tela.
Ex: POST api/auth/login → autentica o usuário gerando tokens JWT de refresh e access.]

## Limites declarados
[Fora de escopo e restrições conhecidas — só o que está declarado (destila) ou
evidente no código (scan).]
```

Adiciona-se a linha da capacidade, nunca a narrativa de como ela surgiu. Se uma seção não tem conteúdo real, omita-a — escrever é a exceção justificada.

## GATE: validação da fundação

**GATE:** o operador valida os dois overviews **antes do commit**. Esta é a fundação de tudo que vem depois — `/propose` ancora no `product-overview`, `/design` ancora no `architecture-overview` — então o gate aqui é forte:

- Apresente os dois artefatos com as observações do processo: inconsistências entre drafts (destila), violações de padrão e interpretações incertas (scan).
- **Em modo scan, o `architecture-overview` exige olho técnico (Dev).** O PO pode ter disparado o estágio — papel-neutro —, mas a conferência segue a natureza do artefato (README §2; Apêndice B passo 2: o Dev corrige o que o scan interpretou mal). Se o Dev não está disponível agora, pare antes do commit e diga: os arquivos ficam no working tree, dentro do write-set do estágio — re-invocar `/ground` depois retoma sem atrito (README §5, retomada).
- Aplique as correções que o operador apontar. Não defenda sua leitura contra a dele: a IA ajuda a pensar; quem decide é o operador.

## Fechamento

Após o gate, o commit canônico é o **último ato** do estágio:

```
git add docs/overviews/product-overview.md docs/overviews/architecture-overview.md
git add .claude/agent-memory/                   # só se os scanners gravaram memória institucional
git commit -m "factory(ground): <projeto> — overviews fundados (destila|scan)"
```

`<projeto>` é o slug do projeto; o parêntese registra o modo efetivamente executado. Add nominal, sempre — você adiciona o que o estágio escreveu, nada mais. A memória institucional dos `scanner` (`memory: project`, README §15) é escrita do estágio: ela entra no commit — memória fora do commit é verdade volátil, e o board-gate exige tree limpa.

Nada além disso: **o board não é tocado** (nenhum verbo, nenhum `board-writer` — não há o que projetar), os drafts permanecem intocados em `docs/proposals/` (o `/promote` cuidará dos PRDs no seu tempo), e nenhuma página de wiki nasce aqui. Estágio fechado; o próximo passo natural é o PO rodar `/propose` ancorado no `product-overview` recém-fundado.

## Referências

- README §2 (papel-neutro e a ressalva do olho técnico), §3 (nota sobre `/ground`), §6 (projeto novo vs existente), §8 (overviews: definição, não log; cabeçalho-instrução), §12.8 (formato canônico dos overviews), §13 (hierarquia; isolamento de `proposals/`), §15 (validação de saída de sub-agents), §16 (anti-patterns: modo errado, overview como log), Apêndice A passo 4 e Apêndice B passo 2.
- `.claude/rules/factory/filesystem.md` (verificação cirúrgica — a detecção de modo deriva daqui), `git.md` (commit canônico, add nominal, ff-only), `invariants.md` (as regras de qualquer sessão).
- `.claude/hooks/README.md` e `.claude/hooks/stage-map.json` (write-set e enforcement deste estágio).
- `.claude/factory-process.md` (contrato canônico — citado aqui para registrar que este estágio não emite verbo algum).

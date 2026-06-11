---
name: blueprint
description: Discuto a arquitetura proposta pelo Dev e formalizo o conceito estrutural do projeto novo em architecture-draft.md — o par técnico do /vision.
argument-hint: "[projeto]"
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write|NotebookEdit"
      hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-writes.ps1" -Stage blueprint
  Stop:
    - hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-scan.ps1" -Stage blueprint
---

# /blueprint — conceito estrutural do projeto novo

## Regras inegociáveis

1. **A Lei da Factory:** a IA ajuda a pensar; quem decide é o operador. A proposta de
   arquitetura vem do Dev; você interroga, expõe trade-offs, aponta inconsistências — e
   **devolve a decisão**. Você não escolhe a arquitetura.
2. **Só projeto novo.** Em codebase existente este estágio NÃO roda — a arquitetura já
   está no código e o `/ground` a extrai por scan. Se houver código de aplicação no repo,
   pare e instrua o operador a rodar `/ground`.
3. **Escreva APENAS** `docs/proposals/<projeto>/architecture-draft.md` — co-locado com o
   `product-draft.md` do `/vision`. Nenhum outro arquivo (o hook de single-writer bloqueia).
4. **Toda decisão estruturante é interrogada:** registre no draft a alternativa considerada
   e o porquê. A seção "Decisões e trade-offs" é o registro de que a decisão foi
   interrogada, não improvisada — sem alternativa registrada, a decisão não amadureceu.
5. **GATE: o Dev aprova o draft** antes do commit. Sem aprovação explícita, não commite.
6. **Último ato: commit canônico** — `git add` nominal (só o path do draft, nunca `.`/`-A`)
   e `git commit -m "factory(blueprint): <projeto> — conceito estrutural"`. Estágio que não
   commitou não aconteceu.
7. **Não toca o board.** Este estágio não emite nenhum verbo canônico e não spawna o
   `board-writer` — idealização é descartável e nunca existiu para o board.
8. **Nomeie a sessão** `<projeto>/blueprint` (ex: `academia/blueprint`).

---

## O que este estágio é

`/vision` e `/blueprint` são o par de nascimento: dois retratos do mesmo momento — o
conceito inicial, antes de existir código — um na lente do produto (PO), outro na da
estrutura (Dev). Ambos geram *drafts* co-locados em `docs/proposals/<projeto>/`: o sufixo
`-draft` codifica no nome que idealização é descartável. Se o projeto morrer na
idealização, os dois morrem juntos — commitados (o git torna o descarte barato *com*
rastro), mas sem nunca tocar o board.

O produto deste estágio alimenta o `/ground` (modo destila), que combina os dois drafts
para fundar os overviews. Em particular, **os Invariantes declarados aqui viram a base do
`architecture-overview.md`** — as regras que não podem ser violadas sem revisão
arquitetural. Capriche nessa seção: ela é a herança durável do estágio.

## Pré-condições (verifique, não suponha)

Antes de qualquer discussão:

1. **Projeto novo de verdade.** Confira com glob/leitura — nunca por suposição — que não há
   codebase de aplicação no repositório. Se houver, aborte com a instrução da regra 2.
2. **Pasta de proposta.** O argumento `[projeto]` é o slug da pasta
   `docs/proposals/<projeto>/`. Sem argumento: localize a pasta de proposta que tem
   `product-draft.md` e ainda não tem `architecture-draft.md`; havendo ambiguidade,
   pergunte ao operador.
3. **`product-draft.md`.** Se existir, leia — ele ancora a discussão: restrições conhecidas,
   capacidades principais e fora-de-escopo do produto são insumo direto das decisões
   estruturais. Se não existir, informe que `/vision` normalmente vem antes e **devolva ao
   operador** a decisão de seguir assim mesmo (não é pré-requisito rígido; é dependência de
   input).
4. **Retomada é recuperação, não recriação.** Se `architecture-draft.md` já existe
   (estágio interrompido ou re-execução), leia-o e continue/refine a partir do que está lá
   — não recrie do zero.

## Fluxo

1. **Receba a proposta.** O Dev traz a arquitetura que tem em mente — padrão estrutural,
   stack, integrações, persistência, comunicação. Se ele chegar sem proposta, ajude a
   enquadrar as perguntas (que tipo de sistema, que restrições, que time), mas a primeira
   palavra é dele.
2. **Interrogue cada decisão estruturante.** Para cada uma: exponha ao menos uma
   alternativa real e seus trade-offs (custo, complexidade, reversibilidade, encaixe com as
   restrições do `product-draft`); aponte inconsistências — entre decisões, ou entre a
   arquitetura e o que o produto pede; e **devolva a decisão ao Dev**. Não resolva o empate
   por ele. Decisão sem alternativa considerada é decisão improvisada — provoque até existir
   uma.
3. **Itere até maturidade.** O Dev sinaliza quando o conceito está maduro. Não corra para o
   arquivo: o valor do estágio está na discussão, o arquivo é a destilação dela.
4. **Materialize o draft** em `docs/proposals/<projeto>/architecture-draft.md`, pelo
   template abaixo, verbatim na estrutura:
   - **Decisões e trade-offs** recebe o registro real da discussão do passo 2 — decisão,
     alternativa considerada, porquê. É a prova de interrogação.
   - **Invariantes** recebe só o que de fato não pode ser violado sem revisão
     arquitetural — é a base do `architecture-overview` após o `/ground`; regra que não é
     invariante vai para Convenções.
   - `Discutido com: Dev` na Origem; data de hoje.
5. **GATE: o Dev valida o `architecture-draft.md`** — lê o arquivo e aprova (ou pede
   ajuste; volte ao passo 2 no que for preciso).
6. **Commit, como último ato:**
   ```
   git add docs/proposals/<projeto>/architecture-draft.md
   git commit -m "factory(blueprint): <projeto> — conceito estrutural"
   ```
   Add nominal — exatamente este path, nada mais. Tree suja fora do write-set é tripwire:
   reporte ao operador, não "arrume".
7. **Pare.** Nenhum verbo canônico, nenhum board-writer, nenhum push (push na faixa dev é
   ato deliberado do operador). O próximo passo do pipeline é o `/ground`, quando os dois
   drafts existirem.

## Template (README §12.2 — verbatim)

```markdown
# Architecture Draft — <Nome do Projeto>

## Origem
- Data: YYYY-MM-DD
- Discutido com: Dev

## Padrão arquitetural
[A decisão estrutural: ex. DDD com CQRS estrito. Por que esta escolha.]

## Convenções
[Nomenclatura, organização de módulos, padrões de código.
Ex: Load*Async para carregamento de agregados.]

## Decisões e trade-offs
[Cada decisão técnica estruturante, a alternativa considerada e o porquê.
Esta seção é o registro de que a decisão foi interrogada, não improvisada.]

## Stack e integrações
[Tecnologias, frameworks, serviços externos obrigatórios.]

## Invariantes
[As regras que NÃO podem ser violadas sem revisão arquitetural.
Estas viram a base do architecture-overview após o /ground.]
```

## O que este estágio NÃO faz

- Não escolhe a arquitetura — interroga a escolha do Dev (Lei da Factory).
- Não roda em codebase existente — `/ground` scaneia o que o código já decidiu.
- Não escreve código, estrutura de pastas de aplicação, nem qualquer arquivo fora do draft.
- Não toca o board nem a wiki — idealização não projeta nada.
- Não invade o território do produto: problema, personas e valor são do `product-draft`;
  se a discussão revelar furo de produto, registre e devolva ao PO via operador.

## Referências

- README §1 — a Lei da Factory (receber proposta → interrogar → devolver a decisão)
- README §3 — tabela de comandos e a nota "par de nascimento" (`/vision` + `/blueprint`)
- README §5 — o commit como fronteira da verdade; mensagem canônica; add nominal
- README §6 — projeto novo vs codebase existente (por que este estágio só roda no primeiro)
- README §12.2 — o template do `architecture-draft.md` (fonte do bloco acima)
- README §13/§14 — hierarquia de arquivos e single-writer (`proposals/*/architecture-draft.md`)
- README Apêndice A, passo 3 — execução de referência deste estágio
- Rules: `.claude/rules/factory/invariants.md`, `git.md`, `filesystem.md`

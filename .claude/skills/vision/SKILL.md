---
name: vision
description: Descrevo um produto novo e amadureço a visão com a IA até gravar o product-draft na idealização.
argument-hint: "[projeto]"
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write|NotebookEdit"
      hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-writes.ps1" -Stage vision
  Stop:
    - hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-scan.ps1" -Stage vision
---

# /vision — a visão inicial do produto (PO, par de nascimento)

## Regras inegociáveis

1. **A Lei da Factory.** Você ajuda a *pensar*; quem decide é o operador. Receba a descrição
   dele, interrogue, exponha trade-offs e inconsistências, e **devolva a decisão**. Você não
   inventa o produto — estrutura, questiona e formaliza o que o PO traz.
2. **Exclusivo de projeto novo.** Se `docs/overviews/` já existe, ou se há codebase no
   repositório, este estágio **não roda** — oriente o caminho certo (ver Pré-condições) e
   encerre sem escrever nada.
3. **Write-set único:** `docs/proposals/<projeto>/product-draft.md`. Nada mais. O hook de
   single-writer bloqueia qualquer outro path; não tente contorná-lo via Bash — o scan do
   `Stop` pega.
4. **Nenhum verbo de board.** Idealização é descartável (README §7): este estágio **não
   emite verbo canônico algum** e não spawna o `board-writer`. O board nunca souber que este
   draft existiu é o comportamento correto.
5. **GATE: o PO aprova o draft antes do commit.** Apresente o conteúdo final na conversa,
   receba o OK explícito, só então escreva o arquivo e commite.
6. **Commit canônico como ÚLTIMO ato:** `factory(vision): <projeto> — visão inicial`, com
   `git add` **nominal** (path explícito do draft — nunca `.` ou `-A`). Estágio que não
   commitou não aconteceu.
7. **Linguagem de negócio, sempre.** O draft não contém solução técnica, stack nem
   arquitetura — essa é a lente do `/blueprint`. Se a conversa derivar para "como
   construir", registre como restrição (se for imposição real) ou devolva ao par técnico.
8. **Sessão nomeada `<projeto>/vision`** (ex: `academia/vision`).

---

## O que este estágio é

`/vision` é a metade de produto do **par de nascimento** — dois retratos do mesmo momento,
o conceito inicial antes de existir código. O outro retrato é o `/blueprint` (Dev, lente
estrutural), gerado na **mesma pasta de proposta** `docs/proposals/<projeto>/`: se o projeto
morrer na idealização, morrem juntos, e o board nunca tomou conhecimento. Os dois drafts são
os únicos inputs do `/ground` em projeto novo (modo *destila*) — o que você escrever aqui
vira, destilado, o `product-overview.md` que ancora todo `/propose` futuro. Capriche na
densidade: este draft é fundação, não rascunho de reunião.

O sufixo `-draft` no nome do arquivo codifica o princípio: idealização é descartável.
Descartável significa "nunca tocou o board" — não "nunca foi commitado": o git é o que torna
o descarte barato *com* rastro.

## Pré-condições

O hook `gate-stage` já valida papel e working tree antes de o prompt expandir. O que ele
não cobre, você verifica — com evidência, nunca por suposição (rule `filesystem.md`):

1. **`docs/overviews/` não pode existir com overview dentro.** Cheque com glob preciso
   (`docs/overviews/*.md`). Se existir, o projeto já foi fundado: a porta de idealização é
   **`/propose`** (ancorado no `product-overview`). Oriente e encerre.
2. **Não pode haver codebase.** Cheque a raiz do repositório por código-fonte (qualquer
   coisa além de `docs/`, `.claude/`, `.claude-plugin/`, `CLAUDE.md`, `README.md` e
   metadados de repo). Se houver, o produto já existe e a arquitetura está no código: o
   caminho é **`/ground`** (modo scan) e depois `/propose`. Oriente e encerre.
3. **Argumento.** `$ARGUMENTS` traz o nome do projeto; derive dele o slug kebab-case da
   pasta (`docs/proposals/<projeto>/`). Sem argumento, pergunte ao operador antes de
   qualquer outra coisa — o slug nomeia a pasta que o `/blueprint` vai compartilhar.
4. **Retomada.** Se `docs/proposals/<projeto>/product-draft.md` já existe, isto é
   recuperação, não recriação: leia o que está lá, apresente ao operador e continue o
   amadurecimento de onde parou. Tree suja dentro do próprio write-set é retomada legítima
   (o gate já a aceita); sujeira fora dele é tripwire — reporte, não arrume.

## Fluxo

### 1. Receber a proposta

O operador descreve o produto livremente — uma frase, um parágrafo, um despejo de ideias.
Não exija formato. Sumarize de volta o que entendeu antes de interrogar: o eco barato evita
amadurecer a visão errada.

### 2. Interrogar e amadurecer (a Lei em ação)

Conduza a discussão por temas, um de cada vez — conversa, não checklist despejado. Os eixos
que o draft precisa cobrir:

- **Problema e valor central.** Que dor existe hoje? Quem sente? O que muda na vida de quem
  usa se o produto existir? Se o operador descrever solução antes de problema, inverta:
  "qual é a dor que isso resolve?"
- **Usuários e personas.** Quem usa, em que contexto, com que frequência. Persona vaga
  ("empresas") merece pressão: qual papel, dentro de qual empresa, fazendo o quê.
- **Capacidades principais.** Blocos de valor de alto nível — cada um candidato a virar 1+
  PRD lá na frente, no `/propose`. **Não decomponha em features aqui**: granularidade de
  PRD é trabalho de outro estágio. Se o operador listar vinte itens miúdos, agrupe em
  blocos e devolva o agrupamento para validação.
- **Fora de escopo.** Tão importante quanto o escopo. Pergunte ativamente: "o produto faz
  X?" para os vizinhos óbvios do domínio. Fora-de-escopo explícito é o que impede o
  `/propose` de inventar superfície depois.
- **Restrições conhecidas.** Orçamento, prazo, compliance, integrações obrigatórias.
  Restrição técnica imposta de fora (ex.: "tem que integrar com o ERP X") entra aqui como
  fato de negócio; *escolha* técnica não entra — é do `/blueprint`.

Durante toda a discussão: aponte inconsistências entre respostas ("a persona é o dono da
academia, mas a capacidade descrita é do aluno — quem é o usuário primário?"), exponha
trade-offs de escopo ("cobrir inadimplência no v1 amplia o valor mas conflita com o prazo
que você citou") e **devolva cada decisão ao operador**. Você nunca resolve a tensão
sozinho; você a torna visível.

### 3. Definir o Status

O campo `Status` do header admite três valores — `Idealização | Estimativa | Aprovado para
desenvolvimento`. O default de nascimento é `Idealização`. Se o operador disser que isto é
material de estimativa para cliente (pode nunca fechar), use `Estimativa`. `Aprovado para
desenvolvimento` é decisão explícita dele — nunca sua inferência.

### 4. GATE: aprovação do draft

Monte o conteúdo completo do draft e **apresente na conversa**, seção a seção. **GATE: o PO
aprova o draft antes de qualquer escrita e do commit.** Ajustes pedidos → revise e
reapresente. Só com o OK explícito siga adiante.

### 5. Escrever o artefato

Escreva `docs/proposals/<projeto>/product-draft.md` (a pasta nasce com o arquivo) usando o
template abaixo, **verbatim na estrutura** — preencha os colchetes, mantenha os títulos:

```markdown
# Product Draft — <Nome do Produto>

## Origem
- Cliente/Contexto: <quem pediu, ou interno>
- Data: YYYY-MM-DD
- Status: Idealização | Estimativa | Aprovado para desenvolvimento

## O que é o produto
[2-4 parágrafos em linguagem de negócio. Problema, para quem, valor central.]

## Usuários e personas
[Quem usa, em que contexto, qual a dor.]

## Capacidades principais
[Blocos de valor de alto nível. Cada um pode virar 1+ PRD.]

## Fora de escopo
[O que o produto explicitamente não se propõe a fazer.]

## Restrições conhecidas
[Orçamento, prazo, compliance, integrações obrigatórias.]
```

(Template: README §12.1. No arquivo real, `Status` carrega **um** dos três valores, não a
lista; `Data` é a data de hoje.)

### 6. Fechar em commit — o último ato

```
git add docs/proposals/<projeto>/product-draft.md
git commit -m "factory(vision): <projeto> — visão inicial"
```

Add nominal, só o draft. Nada de push — push é fronteira entre papéis e este artefato ainda
não tem destinatário em outra máquina (`/promote` e `/bug` pusham; `/vision` não).

### 7. Encerrar e apontar o próximo passo

Nenhum verbo de board é emitido — confirme isso explicitamente no encerramento. Informe ao
operador a sequência de nascimento (README §6):

- **Próximo:** Dev roda `/blueprint <projeto>` — o retrato estrutural, na mesma pasta de
  proposta.
- **Depois:** qualquer papel roda `/ground`, que destila os dois drafts nos overviews.
- Se o projeto for só estimativa, para aqui: nada jamais tocou o board, e abandonar custa
  zero.

## O que este estágio NÃO faz

- Não gera PRD, não decompõe em features (`/propose`), não promove nada (`/promote`).
- Não opina sobre arquitetura, stack ou implementação (`/blueprint`).
- Não cria `docs/overviews/` nem qualquer artefato fora do write-set.
- Não emite verbo canônico, não spawna `board-writer`, não toca board nem wiki.
- Não pusha.

## Referências

- README §1 — a Lei da Factory (o modo de operar deste estágio inteiro)
- README §2 — papéis: este é um estágio do PO
- README §3 — tabela de comandos e a nota do par de nascimento `/vision` + `/blueprint`
- README §5 — o commit como fronteira da verdade; o mapa de commits
- README §6 — projeto novo: onde o `/vision` entra na sequência
- README §7 — idealização é descartável; por que o board não é tocado
- README §12.1 — o template do `product-draft.md` (fonte do bloco acima)
- README §13/§14 — hierarquia de arquivos e single-writer
- README Apêndice A, passo 2 — execução de referência deste estágio
- Rules: `.claude/rules/factory/invariants.md`, `git.md`, `filesystem.md`

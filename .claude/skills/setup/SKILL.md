---
name: setup
description: Faço o bootstrap da factory no projeto, uma vez — valido o provider contra o MCP real, provisiono o processo canônico e só concluo com o enforcement verificado por canário.
argument-hint: "[provider] [--non-interactive --accept-degradation]"
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write|NotebookEdit"
      hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-writes.ps1" -Stage setup
  Stop:
    - hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-scan.ps1" -Stage setup
---

# /setup — bootstrap da factory (uma vez por projeto, fora do fluxo)

## Regras inegociáveis

1. **Uma vez por projeto — e fora do fluxo de épico** (README §3). Re-rodar é recuperação,
   não recriação: troca de provider, realinhamento de SO em máquina nova, reparo de
   enforcement. Cada passo deste fluxo é idempotente: confira o que já existe e complete o
   que falta.
2. **A Lei da Factory aplicada ao encaixe.** O relatório de degradação (passo 4) expõe o que
   o provider entrega nativo e o que degrada — e **devolve a decisão ao operador**. Você
   nunca aceita degradação por ele. Não-interativo: degradação declarada no manifesto exige
   `--accept-degradation` explícito; sem a flag, FALHE listando a degradação.
3. **Nunca degradar em silêncio.** Três paradas obrigatórias, todas ruidosas: (a) política
   `disableSkillShellExecution` ativa → a factory depende estruturalmente de injeção
   dinâmica; falhe com mensagem clara, jamais siga capenga; (b) tool pinada no manifesto não
   existe no MCP real → falhe rápido listando os mismatches (providers renomeiam coisas);
   (c) guard que não barra o canário (passo 6) → falhe ruidosamente. **Factory com guards
   que não disparam é mais perigosa que sem guards**: opera com falsa confiança.
4. **Enforcement é verificado, não assumido** (README §15). Registro não é disparo: sem o
   self-check do passo 6 aprovado — todas as sondas BLOQUEADAS — o setup **não conclui** e
   nada é dado por instalado.
5. **Provision-only.** O board nasce no formato canônico — 6 estados, identidade
   `factory-key` pelo mecanismo do manifesto (capability `identity`), tag `bug`. A factory
   **não se adapta** a board pré-existente; destino com processo divergente é decisão
   devolvida ao operador (outro project/team), nunca contorção.
6. **Só verbos canônicos** de `.claude/factory-process.md` — aqui, `provision()` e
   `read_board`. Nunca cite nem chame tool de provider na sessão: quem traduz é o
   `board-writer`. Toda escrita no board segue a sequência fixa: **commit primeiro → spawnar
   o board-writer com o lote de verbos → validar a saída com
   `.claude/scripts/validate-agent-output` (chaves: `executed,failed,blocked`)**.
7. **Exceção deliberada ao try-reporta-prossegue:** neste estágio, o board É o trabalho.
   `provision()` falho não tem "rode `/sync` depois" — `/sync` realinha features, não
   provisiona. Reporte a causa estruturada (auth? permissão? pré-requisito do manifesto
   pendente?), devolva ao operador e **não conclua**.
8. **Write-set** (`.claude/hooks/stage-map.json`): `.claude/kanban-config.json`,
   `.claude/agents/board-writer.md`, `.claude/rules/factory/**`, `.claude/hooks/**`,
   `.claude/build-run.md`. A instalação dos demais agents do plugin (passo 5) é **cópia
   mecânica byte a byte via shell** — instalação não é autoria — commitada nominalmente
   **no mesmo turno** em que acontece.
9. **Commit canônico como ÚLTIMO ato:** `factory(setup): <projeto> — provider <p>,
   enforcement verificado`, com `git add` **nominal** (path explícito, nunca `.` ou `-A`).
   Os commits intermediários sancionados deste estágio (realinhamento de SO, binding
   pré-provisão) também usam o prefixo canônico — o board-gate exige tree limpa, e
   "commit antes do board" vale dentro do próprio setup.
10. **Sessão nomeada `<projeto>/setup`** (ex: `academia/setup`).
11. **Bifásico quando materializa o board-writer.** Agents e hooks são capturados no
    **início** da sessão (README §15): se este run escreve um `board-writer` novo (primeiro
    setup, ou troca de provider que o reescreve), a mesma sessão nunca conseguirá spawná-lo.
    A **fase 1** termina em commit + pedido de reinício — **isso é sucesso, não falha** — e
    a **fase 2** retoma idempotente do `kanban-config.json`. Jamais contorne executando
    tools do provider na própria sessão: violaria o single-writer físico do board.
12. **Pré-requisitos são conduzidos, não assumidos.** O bloco `prerequisites:` do manifesto
    é o contrato do que precisa existir no provider: **verifique por evidência** tudo que o
    MCP enxerga (perguntar o verificável é proibido — autorrelato não substitui evidência),
    **pergunte só o inverificável**, oriente o conserto (`fix`) e **RE-VERIFIQUE** após cada
    "feito" do operador. Segredo nunca entra no chat: credencial é verificada por PRESENÇA
    de variável de ambiente, jamais pelo valor, e o comando de configuração roda no
    terminal do operador.

---

## O que este estágio é

`/setup` é um dos dois comandos **fora do fluxo normal** de um épico (README §3) — roda uma
vez por projeto e deixa a factory operável: provider escolhido e validado contra o MCP real,
processo canônico provisionado, binding escrito, `board-writer` materializado, agents e
rules instalados onde o frontmatter vale integralmente, e — o que distingue este bootstrap
de um instalador comum — **enforcement provado por canário**, não presumido por registro.

Trocar de provider depois = trocar o manifesto + re-rodar `/setup` (revalida tools,
reprovisiona, reescreve o `board-writer`). **As skills não mudam uma linha** — elas falam
verbos canônicos; o acoplamento concreto vive inteiro no que este estágio escreve.

**Bifásico por construção quando materializa agents.** Realidade de plataforma (README
§15): agents e hooks são capturados no **início** da sessão — artefato materializado no
meio de uma sessão não existe para ela. Quando este run escreve um `board-writer` novo, a
**fase 1** (provider validado, config + board-writer + hooks escritos) termina em commit e
pede reinício — desfecho desenhado, não interrupção —, e a **fase 2** (após reiniciar)
retoma idempotente do binding e provisiona via board-writer. Re-run com o board-writer já
carregado pela sessão = fase única, fluxo inteiro de uma vez.

O comando é **apto a rodar não-interativo** (bootstrap de uma máquina nova num projeto já
configurado): tudo que normalmente é pergunta vira exigência de flag/argumento ou reuso do
binding existente — e o que exigiria julgamento humano sem resposta disponível **falha com
mensagem clara**, nunca decide sozinho.

## Argumentos e modos

`$ARGUMENTS`: `[provider] [--non-interactive --accept-degradation]`

- **`provider`** — slug do adapter (ex: `azure-devops`). Sem argumento, em modo interativo,
  liste os adapters disponíveis (`.claude/adapters/*/manifest.yaml`) e pergunte. Pedir
  provider sem manifesto correspondente → falhe: manifesto novo só nasce com trigger de uso
  real (README §16), e escrevê-lo não é trabalho deste estágio.
- **`--non-interactive`** — nenhuma pergunta. Exigências: provider via argumento **ou**
  `kanban-config.json` existente (re-run); `organization`/`project` já no binding existente
  (nunca invente valores — sem eles, falhe instruindo rodar interativo uma vez);
  degradação declarada → `--accept-degradation`; passo manual de provider pendente → falha
  listando os passos.
- **`--accept-degradation`** — registra o aceite do relatório de degradação no modo
  não-interativo. Em modo interativo é ignorada: o gate é conversa, não flag.

**Re-run:** se `.claude/kanban-config.json` já existe, isto é recuperação ou troca de
provider — leia o binding, anuncie o que vai ser revalidado/reescrito e siga o fluxo
inteiro (ele é idempotente; `provision()` re-rodado recupera via `find_by_key`, não
duplica).

## Pré-condições

O hook `gate-stage` valida a working tree antes de o prompt expandir. O que ele não cobre,
você verifica — com evidência, nunca por suposição (rule `filesystem.md`):

1. **A raiz é um repositório git.** Sem repo não há fronteira da verdade (README §5):
   instrua o operador a rodar `git init` + commit inicial e encerre sem escrever nada.
2. **O adapter do provider existe**: `manifest.yaml` (dados) e `ADAPTER.md` (auth, setup,
   particularidades) em `.claude/adapters/<provider>/`.
3. **A infraestrutura da factory está presente**: `.claude/hooks/` (os scripts dos guards +
   `stage-map.json`), `.claude/skills/setup/templates/board-writer.md.template`,
   `.claude/scripts/validate-agent-output.{ps1,sh}`. Faltando algo, a instalação do plugin
   está incompleta — reporte e encerre. (O registro dos hooks em `.claude/settings.json`
   não é pré-condição: é este estágio que o grava — passo 5e.)

## Fluxo

### 0. Anúncio de fase — antes de qualquer escrita

Detecte, por evidência de disco, se ESTE run vai materializar agents novos:
`.claude/agents/board-writer.md` ainda não existe, ou a troca de provider pedida vai
reescrevê-lo. Se sim, **anuncie antes de trabalhar**:

> Setup bifásico: este projeto ainda não tem `board-writer` (ou ele será reescrito pela
> troca de provider). A **fase 1** valida o manifesto, escreve config + board-writer +
> hooks e termina com pedido de reinício; a **fase 2** (após reiniciar) provisiona o
> board.

Se o `board-writer` já existia no início da sessão e não será reescrito, o run é de fase
única — nada a anunciar; siga o fluxo inteiro.

### 1. Detecção de plataforma

**Sonda de injeção dinâmica** — a linha abaixo executa quando esta skill expande:

!`echo FACTORY-INJECT-OK`

- Se você está lendo `FACTORY-INJECT-OK`, a injeção dinâmica funciona. Siga.
- Se você está lendo um comando literal entre crases, a política
  `disableSkillShellExecution` está ativa. **PARE e falhe com mensagem clara:** "A factory
  depende estruturalmente de injeção dinâmica (comando entre crases prefixado por `!` no
  corpo das skills) — gates de pré-condição e guardas de drift não funcionam sem ela.
  Desative `disableSkillShellExecution` na política do ambiente e re-rode `/setup`." Nunca
  degrade em silêncio: uma factory sem gates parece funcionar até o dia em que não
  funcionou.

**SO e variante de hooks.** Detecte o SO da sessão (Windows ou POSIX; na dúvida, rode uma
sonda de shell). A factory nunca depende de um bash implícito (README §15):

- **Windows** → variante `.ps1`, invólucro
  `powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/<script>.ps1" <args>`.
  É o default de fábrica de todos os arquivos distribuídos — confira por amostragem
  (o registro de hooks em `.claude/settings.json` + um frontmatter de skill); sem diff,
  nada a regravar.
- **POSIX** → variante `.sh`, invólucro
  `bash "${CLAUDE_PROJECT_DIR}/.claude/hooks/<script>.sh" <args>`. Os scripts `.sh` exigem
  `jq`: confira no PATH e, ausente, falhe instruindo a instalação.

Se a variante registrada difere do SO, **regrave** o comando traduzindo invólucro **e
args** — os args NÃO são espelhados 1:1 entre as variantes. Tradução ao regravar para
POSIX:

| O quê | Windows (`.ps1`) | POSIX (`.sh`) |
|---|---|---|
| invólucro | `powershell -NoProfile -ExecutionPolicy Bypass -File "<script>.ps1"` | `bash "<script>.sh"` |
| args dos hooks | `-Stage` · `-Role` · `-Allow` · `-Worker` | `--stage` · `--role` · `--allow` · `--worker` |
| `validate-agent-output` | `-Required` | `--required` |

(Regravando para Windows, a tradução é a inversa.) Nota: os `.sh` aceitam ambas as
grafias por tolerância — defesa em profundidade —, mas a forma canônica POSIX é a
GNU-style; regrave sempre na canônica.

Onde regravar:

- a chave `hooks` de `.claude/settings.json` — os três registros de projeto (`guard-git`,
  `gate-stage`, `inject-invariants`); o merge é o do passo 5e (a chave é deste estágio, o
  resto do arquivo é do operador);
- os comandos de hook em **todo frontmatter instalado**: `.claude/skills/*/SKILL.md`
  (`guard-writes -Stage`, `stop-scan`, `check-toca` no `/code`), `.claude/agents/*.md` que
  carreguem hooks (`board-writer`, `coder`) e os perfis `po`/`dev` se instalados
  (`gate-stage -Role`, `guard-skill -Role`, `guard-writes -Allow`).

Regravou algo → **commit intermediário canônico imediato** (add nominal por arquivo):
`factory(setup): <projeto> — variante de SO realinhada (.sh|.ps1)`.

> Nota honesta: hooks são capturados no início da sessão. Se o canário (passo 6) acusar
> guard inerte porque a sessão ainda carrega a variante antiga, instrua o operador a
> reiniciar a sessão e re-rodar `/setup` — o fluxo é idempotente e retoma do ponto.

### 2. Provider: pré-requisitos conduzidos, manifesto validado contra o MCP real

1. **Escolha o provider** (argumento ou pergunta — ver Argumentos). Leia
   `.claude/adapters/<provider>/manifest.yaml` (dados: verbo→tool, entidades, estados,
   pré-requisitos, capabilities) e `ADAPTER.md` (auth e particularidades).
2. **Conduza os pré-requisitos** — o manifesto declara, você conduz. Leia o bloco
   `prerequisites:` do manifesto ativo e execute item a item, **na ordem declarada**. Cada
   item tem `id` e uma combinação destes campos, que você interpreta genericamente (nada
   de provider vive nesta skill — tudo é dado do manifesto):

   - `input: {ask, bind}` — pergunta um **input genuíno** ao operador (algo que só ele
     sabe) e vincula a resposta ao binding (`bind`) — o `resolve:` e o
     `kanban-config.json` a consomem adiante.
   - `verify:` — a checagem **por evidência**, nunca por autorrelato:
     - `{tool: <t>, match|expect_all|scope}` — executa a tool de **leitura** declarada,
       pela conexão one-shot (a mesma do passo de validação abaixo), e afirma o critério;
     - `{env: <VAR>, present: true}` — afirma a **presença** da variável de ambiente,
       jamais lê ou exibe o valor;
     - `{mcp: tools_list_responds}` — o handshake `tools/list` do servidor responde.
   - `ask:` — pergunta Sim/Não, **restrita ao que nenhuma tool expõe** (o campo só é
     legítimo quando não há `verify` possível). Perguntar o que `verify` alcança é
     proibido: "o item existe? Sim/Não" não substitui a tool que o lista.
   - `fix:` — a instrução de conserto, exibida **verbatim** quando a verificação reprova
     (ou a resposta é "Não"): tipicamente passos de UI do provider. Você não a executa —
     o operador age.
   - `note:` — contexto adicional a exibir junto do item.

   **O loop de condução, por item:** verifica → passou? **próximo** (re-run: o que já
   passa é pulado em silêncio) : exibe o `fix` → o operador age na UI e responde "feito"
   → **RE-VERIFICA**. Nunca prossiga por confiança: "feito" sem re-verificação aprovada
   não conta — provisão não é provisão até conferida. Item de `ask` (inverificável): a
   resposta do operador é o registro; "Não" exibe o `fix` e re-pergunta.

   **Segredos:** nenhum valor de credencial entra na conversa. Credencial se verifica por
   presença de variável de ambiente, e o `fix` entrega o comando para o operador rodar
   **no terminal dele** — jamais peça que cole o valor no chat.

   **Não-interativo:** verificação reprovada, `input` sem valor no binding existente ou
   `ask` sem como responder → falhe listando os itens pendentes (com os `fix`) e instrua
   rodar interativo uma vez — a condução é conversa; sem conversa, ela só confirma.
3. **Complete o binding**: os inputs vinculados pela condução (`input.bind`) já estão
   coletados; o que o bloco `binding:` do manifesto consumir além deles, pergunte.
   Re-run: reuse do config existente, confirmando. Não-interativo: exija que já existam
   no config — nunca invente.
4. **Fail-fast não-interativo**: se `--non-interactive` sem `--accept-degradation` e o
   manifesto declara degradação (`capabilities.degradation` não-vazia), falhe AGORA,
   listando-a — antes de tocar o provider.
5. **Conecte e rode `tools/list`.** Suba o servidor do bloco `mcp:` do manifesto
   (resolvendo `${org}`/`${project}` pelo binding) em modo one-shot — a sessão não mantém
   conexão; só o board-writer terá uma. Para servidores stdio, o handshake JSON-RPC por
   stdin é suficiente:

   ```
   {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"factory-setup","version":"1.0"}}}
   {"jsonrpc":"2.0","method":"notifications/initialized"}
   {"jsonrpc":"2.0","id":2,"method":"tools/list"}
   ```

   Conexão falhou → reporte com o ponteiro de auth do `ADAPTER.md` e encerre.
6. **CONFIRA cada tool pinada.** Extraia o conjunto `ops.*.tool` do manifesto (deduplicado)
   e compare com os nomes devolvidos por `tools/list`. Qualquer ausência → **falhe rápido**
   listando cada mismatch: `verbo <v> espera tool <t> — não existe no servidor; nomes
   próximos: <candidatos>`. Providers renomeiam coisas; é exatamente para isso que o
   manifesto é dado verificável, não prosa (README §11). Nunca "adapte" o mapeamento por
   conta própria — manifesto desatualizado é conserto de manifesto, decisão do operador.

### 3. Provisionar — provision-only, via board-writer provisório

A factory é **provision-only**: o board nasce no formato canônico, não se adapta a board
pré-existente (README §11).

1. **Materialize o binding e o board-writer provisórios.** Escreva
   `.claude/kanban-config.json` (schema do passo 5) e `.claude/agents/board-writer.md` a
   partir do template (placeholders no passo 5) — provisórios: viram definitivos só após o
   gate de degradação e o self-check.
2. **Commit intermediário** — o hook `board-gate` do board-writer exige
   `git status --porcelain` vazio; "board só depois do commit" vale dentro do próprio setup:
   `factory(setup): <projeto> — binding provisório (pré-provisão)` (add nominal dos dois
   arquivos).

**Fronteira de fase.** Se este run materializou o `board-writer` (ele não existia no
início da sessão, ou foi reescrito por troca de provider), **a fase 1 termina AQUI, com
sucesso** — a sessão atual não enxerga o agent recém-escrito, e a saída honesta é o
reinício, não o contorno. Reporte com ✓:

> ✓ **Fase 1 de 2 concluída** — provider validado (tools conferidas), binding escrito
> (`kanban-config.json`), `board-writer` materializado, variante de SO conferida, tudo
> commitado (tree limpa). Próximos passos:
> 1. Reinicie a sessão do Claude Code — a nova sessão carrega o `board-writer`.
> 2. Rode `/setup` novamente — ele detecta o `kanban-config.json` existente, reusa o
>    binding e segue direto para a fase 2 (provisão).

É proibido caracterizar esse desfecho com linguagem de falha ou de interrupção — fase 1
concluída é o resultado desenhado, não um acidente. Daqui em diante (o spawn abaixo e os
passos 4–9) é a **fase 2**: alcançada na sequência, em run de fase única, ou no re-run
pós-reinício.

3. **Spawne o board-writer** com o lote `[provision]` e, na sequência, `[read_board]` para
   conferir o resultado. Valide cada saída com
   `.claude/scripts/validate-agent-output` (variante do SO; chaves `executed,failed,blocked`
   — `.ps1` usa `-Required`, `.sh` usa `--required`). Saída inválida → re-instrua o agent;
   nunca prossiga com saída parcial.

   **Tradutor da fronteira de sessão:** se o spawn devolver "Agent type 'board-writer'
   not found" E `.claude/agents/board-writer.md` existir no disco, isso NÃO é erro — é a
   fronteira de sessão (o agent foi materializado depois que esta sessão começou; a lista
   de agents é capturada no início). Emita, em tom de passo previsto: "o `board-writer`
   foi materializado depois que esta sessão começou — reinicie a sessão e re-rode
   `/setup`; o fluxo retoma da fase 2." Nunca contorne executando tools do provider na
   própria sessão (single-writer físico do board, regra 11).
4. **Afirme o provisionamento** pelo `read_board`: os **6 estados** canônicos
   (`ready → design → in_progress → review → done → closed`) existem como
   colunas/estados; a identidade **`factory-key`** é aplicável pelo mecanismo do manifesto
   (capability `identity`: tag, label ou marcador na descrição); a tag **`bug`** está
   disponível; marcador **`factory-stage`** só se a capability `stage_label` o declarar
   (provider de estados exatos: `none` — nada a provisionar). **Provisão não é provisão
   até conferida** — o mesmo princípio do canário: registro não é disparo.
5. **Bordas:**
   - Destino com processo pré-existente divergente → não contorça a factory: reporte o que
     encontrou e devolva ao operador a escolha (outro project/team, ou limpar o destino).
   - A provisão revela pendência de pré-requisito (ex: configuração que só o admin do
     provider muda) → **reconduza o item correspondente** do `prerequisites:` com o loop
     do passo 2 (fix → operador age → re-verifica) e re-rode a conferência.
     Não-interativo: falhe listando os itens pendentes.
   - `provision()` falhou → regra inegociável 7: reporte e **não conclua** — aqui não há
     try-reporta-prossegue, porque o board é o próprio trabalho do estágio.

### 4. Relatório de degradação — GATE

Imprima, a partir do bloco `capabilities` do manifesto, o que o provider entrega nativo e o
que degrada — no formato que o operador lê de relance:

```
Provider: linear
  épico   → Project            (degradação estrutural)
  tasks   → sub-issues         (nativo equivalente)
  tempo   → comment            (sem campo nativo)
  estados → 6 workflow states  (provisionados)
  wiki    → repo-markdown      (default da factory; Linear Docs é opt-in)
```

(Pouca degradação — ex: Azure DevOps, só `tempo → comentário` (User Story não tem campo de tempo) — imprime o relatório do mesmo jeito.)

**GATE: o operador aceita a degradação antes de o binding virar definitivo (passo 5).** É a
Lei da Factory aplicada ao encaixe: você expõe o trade-off; ele decide.

- **Aceitou** → siga.
- **Recusou** → oriente a troca: outro provider é trocar o manifesto e re-rodar `/setup`.
  Encerre sem o commit final, relatando o resíduo (o que foi provisionado no provider
  recusado fica lá — limpeza é ato do operador; a factory não deleta o que não governa).
- **Não-interativo** → `--accept-degradation` registra o aceite (já exigida no passo 2 se
  havia degradação); degradação zero segue com o relatório impresso no log.

### 5. Escrever o binding e instalar a infraestrutura

**5a. `.claude/kanban-config.json`** — o acoplamento concreto inteiro num único arquivo
trocável, schema do README §11:

```json
{
  "board": {
    "provider": "azure-devops",
    "manifest": ".claude/adapters/azure-devops/manifest.yaml",
    "organization": "<org>",
    "project": "<projeto>"
  },
  "wiki": {
    "provider": "repo-markdown",
    "root_path": "docs/wiki"
  }
}
```

`provider`/`manifest`/`organization`/`project` com os valores escolhidos. **Wiki é faceta
independente do board**: o default é `repo-markdown` com `root_path: docs/wiki` (zero MCP no
caminho crítico); wiki nativa do provider é opt-in se a capability existe — pergunte no modo
interativo; não-interativo fica no default (ou no valor já existente do re-run).

**5b. `.claude/agents/board-writer.md`** — materialize a partir de
`.claude/skills/setup/templates/board-writer.md.template`, preenchendo os placeholders:

| Placeholder | Valor |
|---|---|
| `PROVIDER` | slug do provider (nome do server MCP no frontmatter) |
| `MCP_SERVER_JSON` | o bloco do servidor **preferido** (`mcp.preferred`) do manifesto como JSON inline, com `${org}`/`${project}` **resolvidos** pelo binding. Credencial **nunca literal**: ou é credencial de máquina fora de banda (ex.: ADO local/azcli via `az login`), ou um token por `env`/`headers` referenciado com `${VAR}` (a plataforma expande `${VAR}`; `org`/`project` ela não promete expandir — por isso resolvidos aqui). O board-writer roda headless: o servidor preferido tem de autenticar **sem browser** (OAuth interativo não serve a sub-agent — ver ADAPTER.md do provider) |
| `TOOLS` | as tools pinadas do manifesto (`ops.*.tool`, deduplicadas), cada uma prefixada `mcp__<provider>__` |
| `MAX_TURNS` | `3 × maior lote de verbos + 4`. Estime o maior lote plausível do projeto (regra prática: `/promote` com o máximo de PRDs por promoção que o operador espera, ou `/sync` realinhando o board inteiro; default razoável: lote 12 → `maxTurns: 40`) |
| `HOOK_GATE` / `HOOK_LOGFAIL` | comando de `board-gate` / `board-log-failure` na variante do SO (passo 1) |

O servidor MCP vive **inline no frontmatter** do board-writer: conecta quando o agent
inicia, desconecta quando termina, e nenhuma descrição de tool de provider polui o contexto
dos estágios. O single-writer do board é físico: ninguém mais tem a conexão (README §11).

**5c. Agents do plugin → `.claude/agents/` DO PROJETO.** Agents distribuídos via plugin
**perdem `hooks`, `mcpServers` e `permissionMode`** — a plataforma os ignora por segurança
(README §15). Por isso a instalação é no projeto, onde o frontmatter vale integralmente:
copie byte a byte (cópia mecânica via shell — instalação não é autoria) cada agent do
diretório do plugin (`scanner`, `reviewer`, `verifier`, `coder`) para `.claude/agents/`, e
**commite nominalmente no mesmo turno**:
`factory(setup): <projeto> — agents instalados no projeto`. Já instalados e idênticos →
nada a fazer (confira por diff, não por presença). Confirme que os hooks de frontmatter de
`coder` (e do `board-writer` de 5b) estão na variante de SO correta.

**5d. Rules** — instale/confirme os cinco arquivos em `.claude/rules/factory/`:
`invariants.md`, `git.md`, `filesystem.md`, `board.md`, `epics.md` (este último com
`paths: docs/epics/**` no frontmatter). São as convenções operacionais que o Claude Code
carrega automaticamente; sem elas, as skills referenciam regras que não estão na sessão.

**5e′ (antes do registro). Higiene do rastro de runtime.** Garanta `.claude/.factory/`
no `.gitignore` do projeto (append não-destrutivo; arquivo ausente → criado): é onde os
hooks gravam diagnóstico (`board-failures.jsonl`, `fetch-failures.log`) — rastro de
runtime, nunca verdade. Os guards já o excluem do scan por construção, mas o gitignore
mantém o `git status` limpo para o operador.

**5e. Registro de hooks de projeto — `.claude/settings.json`.** É deste arquivo que a
plataforma carrega os hooks de projeto — registro em qualquer outro lugar é guard inerte,
exatamente o que o canário (passo 6) acusa. Grave a chave `"hooks"` com os três
registros, na variante de SO do passo 1:

- `guard-git` em `PreToolUse` (matcher `Bash`);
- `gate-stage` em `UserPromptExpansion`;
- `inject-invariants` em `SessionStart` (matcher `compact`).

O merge é **não-destrutivo**: a chave `hooks` pertence a este estágio
(criada/atualizada); **qualquer outra chave existente no arquivo pertence ao operador e é
preservada byte a byte**. Arquivo ausente → criado. Re-run com registro já correto →
diff zero, nada a commitar. Hooks são capturados no início da sessão: registro
criado/alterado neste run só dispara após reinício — o canário do passo 6 dirá.

O `guard-writes` **não entra no nível projeto**: sem `-Stage`/`-Role`/`-Allow` ele é
inerte por construção — não tem como resolver o estágio ativo sozinho. O alcance dele é o
frontmatter (skill e perfil); para escritores não-instrumentados, a garantia é outra
camada: `stop-scan` + fronteira do commit — exatamente o que a sonda D3 verifica.

### 6. Self-check de enforcement — o canário

**Registro não é disparo.** Hooks registrados que não barram são o pior estado possível: a
factory opera com falsa confiança. O self-check vai até o fim — dispara operações proibidas
e **afirma a resposta de cada camada pelo seu mecanismo real** (a matriz do README §15):
bloqueio in-flight onde há guard; acusação pelo scan de fechamento onde a garantia é a
rede (`stop-scan` + fronteira do commit).

Sondas (todas inofensivas *mesmo se passassem* — defesa em profundidade na própria sonda):

| # | Contexto | Operação proibida tentada | Guard que DEVE barrar |
|---|---|---|---|
| A | sessão | `git merge --abort` via Bash | `guard-git` (PreToolUse Bash, registro em `.claude/settings.json`) |
| B | sessão | `Write` em `docs/factory-canary.md` (fora do write-set do setup) | `guard-writes` (frontmatter desta skill) |
| C | sub-agent | escrita no board com tree suja: crie `.claude/hooks/.canary` (dentro do write-set — sujeira legítima), spawne o board-writer com lote `[read_board]` | `board-gate` (frontmatter do board-writer) → saída `blocked` |
| D | sub-agent | **garantia em camadas — três afirmações**: D1 `git merge --abort` num sub-agent genérico; D2 frontmatter de agent (referencia o resultado de C); D3 o sub-agent escreve um arquivo-canário fora de qualquer write-set e a checagem do `stop-scan` deve **acusá-lo** como sujeira | D1: `guard-git` propagado do registro de projeto (`.claude/settings.json`); D2: `board-gate` no frontmatter do board-writer (via C); D3: `stop-scan` — sub-agent genérico não carrega frontmatter, logo não tem guard de escrita in-flight; a garantia real para ele é o scan do `Stop` + a fronteira do commit (§5) |

Protocolo:

1. Execute A e B na própria sessão e classifique cada desfecho pela **origem** do
   bloqueio — três desfechos possíveis, só um aprova:
   - **Bloqueado pelo guard** — a mensagem é a do próprio hook (cita o guard e a regra,
     ex: "guard-git: 'git merge' é proibido...") → **APROVADO**.
   - **Bloqueado pelo classificador da plataforma** — negação genérica, sem a mensagem
     do hook → **INCONCLUSIVO, não aprovado**: o guard não foi exercitado (outra camada
     interceptou primeiro). Trate como sonda pendente: confira o registro (chave `hooks`
     de `.claude/settings.json`) e avalie trocar a sonda por outra operação proibida que
     o classificador não intercepte.
   - **Não bloqueado** — a operação passou → **REPROVADO** (item 4).
2. Execute C: valide a saída do board-writer com `validate-agent-output`
   (`executed,failed,blocked`) e afirme `blocked` não-nulo ("tree suja"). Depois **remova**
   `.claude/hooks/.canary`.
3. Execute D — cada afirmação pelo seu mecanismo real:
   - **D1 (propagação do registro de projeto):** spawne um sub-agent de propósito geral
     instruído a tentar `git merge --abort` e a reportar o desfecho **verbatim**.
     Classifique pela tríade do item 1: mensagem do `guard-git` = aprovado; negação do
     classificador = inconclusivo (relate e avalie trocar a sonda); sem bloqueio =
     reprovado.
   - **D2 (frontmatter de agent):** o `board-gate` disparando dentro do board-writer — o
     resultado da sonda C — é a prova desta camada. Referencie-o; não repita.
   - **D3 (rede de fechamento para escritores não-instrumentados):** o mesmo sub-agent
     escreve `docs/factory-canary.md` (fora de qualquer write-set; espera-se que a
     escrita PASSE — sub-agent genérico não tem guard de escrita in-flight). De volta à
     sessão, rode o script `stop-scan` (variante do SO, `-Stage setup`) e **afirme que
     ele acusa o arquivo como sujeira fora do write-set**. Acusou = aprovado; não acusou
     = reprovado. Em seguida **remova o arquivo-canário** — a limpeza do próprio canário
     é o único delete legítimo.

   O sub-agent devolve saída estruturada
   `{"probes":[{"name":"D1|D3","context":"sub-agent","outcome":"...","evidence":"<verbatim>"}]}` —
   valide com `validate-agent-output` (chave: `probes`).
4. **Afirme: toda afirmação APROVADA pelo seu mecanismo** — bloqueio pelo guard (A, B, C,
   D1) ou acusação pelo scan (D3). Qualquer afirmação reprovada → **falhe ruidosamente**:
   nomeie a camada que não respondeu, onde ela deveria estar registrada (chave `hooks` de
   `.claude/settings.json`? frontmatter? variante de SO errada? — ver
   `.claude/hooks/README.md`), instrua o reparo (incluindo a nota de reinício de sessão
   do passo 1) e **não conclua o setup**. Sonda inconclusiva (classificador) não reprova
   o setup sozinha, mas tampouco aprova: resolva-a antes de concluir.
5. **Nenhuma sonda deixa resíduo**: ao final, `git status --porcelain` não mostra nada que
   as sondas criaram (o arquivo-canário de D3 incluído — removido pela limpeza do próprio
   canário).

### 7. Receita de build/run

Detecte se há app/codebase — por evidência, não suposição: qualquer coisa na raiz além de
`docs/`, `.claude/`, `.claude-plugin/`, `CLAUDE.md`, `README.md` e metadados de repo.

- **Há código** → grave `.claude/build-run.md`: como **buildar**, **rodar** e **testar** o
  projeto. O `verifier` usa esta receita em **todo `/close`** — receita errada quebra todo
  fechamento; por isso, verifique os comandos executando-os quando o custo for razoável, e
  derive o resto de evidência concreta (arquivos de build, scripts, CI). Estrutura
  sugerida:

  ```markdown
  # Build & Run — <projeto>

  ## Build
  [comando(s) verificados: dependências + compilação]

  ## Run
  [como subir o app localmente: comando, porta, env vars]

  ## Test
  [como rodar a suíte; subconjuntos úteis]

  ## Observações
  [pré-requisitos de ambiente, serviços externos, seeds]
  ```

  **GATE: o operador valida a receita antes de ela ser commitada** (interativo; no modo
  não-interativo, gere só do que for verificável e anote o que ficou por confirmar).
- **Não há código** → **não crie o arquivo** (escrever é a exceção justificada): a receita
  fica para o primeiro `/close`, quando existirá app para descrever — exatamente o caso do
  Apêndice A, passo 1.

### 8. Ergonomia

- **Sugira a statusline** exibindo épico e task ativos (README §15) — configuração é ato do
  operador, fora do write-set deste estágio; você sugere, não escreve.
- **Lembre a convenção de sessões nomeadas `<épico>/<estágio>`** (ex: `checkout/design`) —
  o histórico de sessões vira um índice auditável do trabalho (README §1).

### 9. Fechar em commit — o último ato

```
git add .claude/kanban-config.json
git add .claude/settings.json           (se o registro de hooks mudou)
git add .claude/agents/board-writer.md
git add .claude/rules/factory/<cada rule instalada/ajustada>
git add .claude/hooks/<cada arquivo regravado, se houver>
git add .claude/build-run.md            (se gerado)
git commit -m "factory(setup): <projeto> — provider <p>, enforcement verificado"
```

Add nominal, path a path — só o que este estágio escreveu. Re-run sem nenhum diff → conclua
sem commit novo (nada a registrar). Nada de push: a faixa de push do PO é `/promote`/`/bug`;
na faixa de infra, push é ato deliberado do operador.

Encerre relatando: provider validado (tools conferidas), board provisionado e conferido,
degradação aceita (e qual), enforcement verificado (sondas A–D bloqueadas), receita de
build/run (gravada ou adiada) — e o próximo passo: projeto novo → `/vision` + `/blueprint` +
`/ground` (destila); codebase existente → `/ground` (scan).

## O que este estágio NÃO faz

- Não cria Epic, Feature nem Task de trabalho — `provision()` e `read_board` são seus
  únicos verbos. O primeiro card nasce no `/promote` (ou `/bug`).
- Não escreve `docs/**` — nem overviews (`/ground`), nem wiki (`/close`), nem proposta.
- Não invoca estágio algum (`/ground`, `/vision`...) — estágios não invocam estágios;
  comandos de estágio são do operador.
- Não escreve manifesto de provider novo — manifesto nasce com trigger de uso real (§16).
- Não aceita degradação pelo operador, não adapta board pré-existente, não deleta nada no
  provider.
- Não pusha.

## Referências

- README §3 — a tabela fora do fluxo: o que o `/setup` é em uma linha
- README §5 — o commit como fronteira da verdade; por que o board-gate exige tree limpa
- README §11 INTEIRO — contrato, manifesto-como-dado, executor único, provision-only,
  capabilities e relatório de degradação, wiki, configuração (schema do `kanban-config.json`)
- README §15 INTEIRO — mapa de enforcement, matriz de contextos, canário, realidades da
  plataforma (`allowed-tools` pré-aprova, plugin perde frontmatter de agent,
  `disableSkillShellExecution`, shell declarado, statusline)
- README §16 — anti-patterns (skill citando tool de provider; construir antes do trigger)
- README Apêndices A passo 1 e B passo 1 — execuções de referência deste estágio
- `.claude/factory-process.md` — verbos, estados, labels de identidade, resiliência
- `.claude/hooks/README.md` e `stage-map.json` — mapa script → invariante → registro
- `.claude/adapters/<provider>/manifest.yaml` + `ADAPTER.md` — o que se valida e provisiona
- `.claude/skills/setup/templates/board-writer.md.template` — a fonte do passo 5b
- Rules: `.claude/rules/factory/invariants.md`, `git.md`, `filesystem.md`, `board.md`

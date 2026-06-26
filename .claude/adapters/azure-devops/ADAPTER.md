# ADAPTER — Azure DevOps

Prosa mínima do adapter: o que não cabe em dados. O mapeamento verbo→tool e os pré-requisitos que o `/setup` conduz (`prerequisites:`) vivem no `manifest.yaml`.

Destino no repo: `.claude/adapters/azure-devops/ADAPTER.md`

## 1. Conexão e autenticação

**Local stdio + azcli (o caminho atual da factory).** Requer Node 20+ e Azure CLI. O board-writer roda como **sub-agent headless** — não abre browser e não herda credencial de servidor de sessão —, então a credencial precisa estar estabelecida **fora de banda**, na máquina, *antes* de ele rodar. Por isso `--authentication azcli`: cada operador roda `az login` **uma vez** (no tenant da organização) e o servidor stdio inline do board-writer usa a credencial Entra em cache, sem interação. Sem token no repositório, sem PAT para gerenciar.

```
# cada operador, 1x por máquina:
az login                         # no tenant da org (dev.azure.com)
az account show                  # confirma o tenant certo
# o board-writer carrega o servidor INLINE — o /mcp não precisa dele. Para testar à mão na sessão:
claude mcp add ado -- npx -y @azure-devops/mcp <organização> -d core work-items search wiki --authentication azcli
```

Domínios mínimos da factory: `-d core work-items search wiki` — carregar tudo polui o contexto à toa. Alternativas de auth, todas **headless-compatíveis** (servem ao board-writer): `pat` (lê `PERSONAL_ACCESS_TOKEN` do ambiente — base64 de `<email>:<pat>`) e `envvar` (lê o bearer cru de `ADO_MCP_AUTH_TOKEN`), referenciadas por **variável de ambiente, nunca literal** (o `board-writer.md` é commitado e viaja no repo) — ex.: `env: { PERSONAL_ACCESS_TOKEN: "${ADO_PAT}" }` no frontmatter, e o Claude Code expande `${VAR}` em `command`/`args`/`env`/`headers`. Já `interactive` (browser a cada início) **não** serve ao board-writer — só para teste manual.

**Board-writer headless — realidade comprovada.** O servidor MCP vive **inline no frontmatter** do board-writer (single-writer físico — README §11). Um servidor inline de sub-agent **só conecta quando o agent roda, não abre browser para autenticar, e NÃO herda** o token de um servidor de mesma URL autenticado na sessão (é uma entrada distinta — comportamento confirmado do Claude Code; mesma lição do Linear ADAPTER §1). É por isso que o caminho remoto (Entra **OAuth interativo**) trava numa máquina nova: o `/mcp` mostra o servidor como *"será ativado quando um agente precisar"* e **não há como pré-autenticá-lo** ali. O `azcli` dissolve o problema: a credencial é da máquina (`az login`), e o stdio inline a usa headless.

**Remote (FUTURO — ainda não no Claude Code).** O Remote MCP Server (`https://mcp.dev.azure.com/<org>`, Entra ID) está em **public preview** e hoje **só suporta Visual Studio e VS Code (com Copilot)** — o Claude Code ainda **não** é cliente suportado (depende de registro dinâmico de client OAuth no Entra). Quando passar a ser, avalie `mcp.preferred: remote` no manifesto; o endpoint aceita os headers `X-MCP-Toolsets` e `X-MCP-Readonly` para endurecer o board-writer. (Fonte: Microsoft Learn — *Azure DevOps Remote MCP Server*, public preview.)

## 2. Por que o processo herdado importa

Os 6 estados canônicos não existem no Agile de fábrica. O ADO não permite editar processos de sistema nem criar estados via API/MCP — estados são configuração de organização. Por isso o pré-requisito `inherited_process` do manifesto, conduzido pelo `/setup`, orienta a criação do processo herdado **Factory** (base Agile), com os estados da **Feature** customizados e os de sistema ocultos. Detalhe que vira feature: com `New` oculto, todo work item Feature **nasce direto em `Ready`** — o estado de entrada do contrato, de graça.

A base é **Agile** (e não Scrum/Basic) pela hierarquia nativa **Epic > Feature > User Story**: a `task` canônica mapeia para **User Story** — a filha de nível-requisito da Feature, nativa e visível no board e no backlog. (Scrum usa *Product Backlog Item* no lugar de User Story; Basic não tem o nível portfólio.) O tempo usa o campo nativo `CompletedWork` (horas): ele é de Task/Bug por padrão, então o processo Factory **adiciona esse campo existente à User Story** (ADMIN-SETUP §2.2) — uma adição de campo de sistema ao WIT, não um campo *custom*. Ver §4.

## 3. Resolução e validação

O ADO opera por **nomes** (System.State, tipos, tags), não IDs — então o `resolve:` não precisa popular um mapa de IDs como o do Linear. Ele confirma o projeto (`core_list_projects`), a presença dos tools pinados via `tools/list` **e as formas de argumento** (`check: tool_arg_schemas` — `fields[]` em `wit_create_work_item`, `items[]` em `wit_add_child_work_items`, `updates[]` em `wit_update_work_item`/`wit_work_items_link`), falhando rápido se o toolset mudou **nome ou forma**. Estados não são listáveis pelo MCP: o contrato deles é o pré-requisito `inherited_process` do manifesto (inverificável por tool — o `/setup` o conduz por pergunta e conserto orientado), e divergência de nome falha-rápido na primeira transição (try-reporta-prossegue + `/sync` reparam). Clientes podem namespacear os nomes dos tools (`mcp_ado_wit_create_work_item`); o casamento é por sufixo.

## 4. Particularidades do provider

- **Identidade é tag; estágio é o estado nativo.** Tags do ADO são dinâmicas (criadas ao aplicar) — `factory-key:<slug>` viaja em `System.Tags` sem nada a provisionar; o estágio vive no `System.State` do processo Factory (`stage_label: none`). **Tag é set, não patch**: para adicionar uma (ex: `bug`), o board-writer lê as tags atuais (`wit_get_work_item`) e regrava o conjunto (separador `; `), preservando as existentes.
- **`find_by_key` usa Work Item Search** (`search_workitem`), porque o toolset atual não expõe WIQL ad-hoc. A indexação do search tem latência de alguns segundos — irrelevante para recuperação (o caminho primário continua sendo o `Board-ID` do header do `prd.md`).
- **`task` canônica = User Story, filha da Feature.** A `task` da factory (fecha em 1 commit, carrega ACs) é, em ADO, uma **User Story** — não o tipo `Task` (passo de hora). Como User Story é item de nível-requisito, ela aparece **nativamente no board e no backlog** sob a Feature (Epic > Feature > User Story). Uma `Task` pendurada direto na Feature *existe nos dados* mas some das visões padrão (Tasks nunca são cards de board) — era a causa do "as tasks não aparecem no board". O tipo `Task` do ADO fica livre para uso manual (passos de hora sob a Story); a factory não o cria. As User Stories nascem em `New` (estados de fábrica — só a **Feature** é customizada) e vão a `Closed` no `complete_task`.
- **Tempo é campo nativo (capability `time: field`).** `CompletedWork` é de Task/Bug por padrão, então o processo Factory **adiciona o campo existente `Microsoft.VSTS.Scheduling.CompletedWork` à User Story** (ADMIN-SETUP §2.2). O `complete_task` grava nele os minutos convertidos em **horas** (Double, 2 casas — ex.: 90 min → 1.5). O `## Tempo` do `task.md` segue sendo a verdade em minutos; o board é projeção. Ressalva (irrelevante para a factory): o campo na User Story **não** participa de capacity/burndown de sprint (isso é `Remaining Work` em Tasks) — é só um campo numérico de actuals; e as datas (Created/Closed/StateChange) já são automáticas em todo WIT. Se o campo não tiver sido adicionado ao WIT, o `complete_task` falha-rápido (try-reporta-prossegue) — o sinal para rodar o passo de processo.
- **Wiki nativa disponível** (`wiki_create_or_update_page`, create-or-update por path — exatamente o verbo canônico). Continua **opt-in**: o default da factory é `repo-markdown`; para usar a ADO Wiki, troque a faceta no `kanban-config.json` e o `/setup` resolve o `wiki_id` via `wiki_list_wikis`.
- **Estado de nascimento.** `wit_add_child_work_items` cria a Feature já parented ao Epic e, com `New` oculto, ela nasce em `Ready` — o manifesto só complementa as tags em seguida.

## 5. Smoke de validação do manifesto

Numa sessão Claude Code com o MCP conectado, antes de qualquer skill existir: (a) listar projetos e confirmar o projeto de teste; (b) criar um Epic e uma Feature filha (`wit_add_child_work_items`) — conferir que nasce em `Ready`; (c) criar uma **User Story** filha da Feature (`wit_add_child_work_items`, `workItemType: "User Story"`) e **conferir que ela aparece no board e no backlog** sob a Feature; aplicar a tag `factory-key:smoke-001` na Feature, mover a Feature para `Design` pelo `System.State`, e gravar na User Story o estado `Closed` + `Microsoft.VSTS.Scheduling.CompletedWork = 0.5` — **confirmando que o campo foi adicionado ao WIT User Story** (se não foi, o patch falha, e esse é o sinal de rodar o passo de processo); (d) `search_workitem` por `factory-key:smoke-001` (aguarde a indexação); (e) `wit_work_items_link` related entre duas Features. **Confira de passagem que as FORMAS de argumento batem com o schema real do toolset** — `wit_create_work_item.fields[]` (lista `{name,value}`), `wit_add_child_work_items.items[]` (lista `{title,description}`), `wit_update_work_item.updates[]` (lista de patches `{op,path,value}`): o manifesto foi pinado contra o toolset, e o smoke é onde isso vira evidência. Apagar o lixo do smoke é manual — a factory nunca deleta; você deleta.

## 6. Troubleshooting

- **`az login` expirado / nunca feito (local/azcli):** sintoma típico numa máquina nova ou após dias — o board-writer falha ao conectar e o board "não atualiza". Re-rode `az login`; confirme o tenant com `az account show`. **É a primeira coisa a checar quando um operador novo reporta board parado.**
- **Tasks/User Stories não aparecem no board:** confirme que `entities.task` é `User Story` (não `Task`) — uma Task pendurada direto na Feature existe nos dados mas some das visões padrão de board/backlog (Tasks nunca são cards de board).
- **search_workitem vazio logo após criar:** latência de indexação — re-tente em segundos; o `/sync` é idempotente.
- **Tool sumiu/renomeou ou mudou de forma de argumento:** o `resolve:` falha na validação — atualize o manifesto, nunca a skill.
- **Remoto (futuro):** se um dia usar `mcp.dev.azure.com` e tomar 401/403, a conta autenticada ≠ conta com acesso à org; e a política de org "Third-party application access via OAuth" precisa estar habilitada. Hoje o caminho é local/azcli (§1).

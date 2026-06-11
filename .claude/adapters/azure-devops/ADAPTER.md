# ADAPTER — Azure DevOps

Prosa mínima do adapter: o que não cabe em dados. O mapeamento verbo→tool e os pré-requisitos que o `/setup` conduz (`prerequisites:`) vivem no `manifest.yaml`.

Destino no repo: `.claude/adapters/azure-devops/ADAPTER.md`

## 1. Conexão e autenticação

**Remote (preferido).** O Remote MCP Server é hospedado pela Microsoft e é a recomendação oficial — o local será substituído com o tempo:

```
claude mcp add --transport http ado https://mcp.dev.azure.com/<organização>
```

Na primeira sessão, `/mcp` completa a autenticação Entra ID no browser, com a conta que tem acesso à organização. Endurecimento opcional para o board-writer: o endpoint remoto aceita os headers `X-MCP-Toolsets` (carregar só os toolsets necessários) e `X-MCP-Readonly` — útil para agents de leitura.

**Local (fallback stdio).** Requer Node 20+. O manifesto usa `--authentication azcli` (exige Azure CLI instalado e `az login` feito no tenant da organização); alternativas: `interactive` (browser a cada início), `envvar`/`pat` (token em variável de ambiente — nunca no repo). Domínios mínimos da factory: `-d core work-items search wiki` — carregar tudo polui o contexto à toa.

## 2. Por que o processo herdado importa

Os 6 estados canônicos não existem no Agile de fábrica. O ADO não permite editar processos de sistema nem criar estados via API/MCP — estados são configuração de organização. Por isso o pré-requisito `inherited_process` do manifesto, conduzido pelo `/setup`, orienta a criação do processo herdado **Factory** (base Agile), com os estados da **Feature** customizados e os de sistema ocultos. Detalhe que vira feature: com `New` oculto, todo work item Feature **nasce direto em `Ready`** — o estado de entrada do contrato, de graça.

A base é **Agile** (e não Scrum/Basic) por duas razões do contrato: a hierarquia Epic > Feature existe nativamente, e a Task carrega o campo `Microsoft.VSTS.Scheduling.CompletedWork` — o destino nativo do tempo da factory.

## 3. Resolução e validação

O ADO opera por **nomes** (System.State, tipos, tags), não IDs — o `resolve:` é mais leve que no Linear: confirma o projeto (`core_list_projects`) e a presença dos tools pinados via `tools/list`. Estados não são listáveis pelo MCP: o contrato deles é o pré-requisito `inherited_process` do manifesto (inverificável por tool — o `/setup` o conduz por pergunta e conserto orientado), e divergência de nome falha-rápido na primeira transição (try-reporta-prossegue + `/sync` reparam). Clientes podem namespacear os nomes dos tools (`mcp_ado_wit_create_work_item`); o casamento é por sufixo.

## 4. Particularidades do provider

- **Identidade é tag; estágio é o estado nativo.** Tags do ADO são dinâmicas (criadas ao aplicar) — `factory-key:<slug>` viaja em `System.Tags` sem nada a provisionar; o estágio vive no `System.State` do processo Factory (`stage_label: none`). **Tag é set, não patch**: para adicionar uma (ex: `bug`), o board-writer lê as tags atuais (`wit_get_work_item`) e regrava o conjunto (separador `; `), preservando as existentes.
- **`find_by_key` usa Work Item Search** (`search_workitem`), porque o toolset atual não expõe WIQL ad-hoc. A indexação do search tem latência de alguns segundos — irrelevante para recuperação (o caminho primário continua sendo o `Board-ID` do header do `prd.md`).
- **Task filha direto da Feature.** O link parent-child é válido entre quaisquer tipos; o caveat é cosmético: o taskboard de sprint só exibe Tasks sob Stories. A factory não usa sprints — o que importa (parent link, contagem, estado) funciona integralmente no board de Features e nas queries.
- **Tempo em horas.** `CompletedWork` é decimal em horas; o board-writer converte minutos (`90 min → 7.5? não — 1.5`) com duas casas. O `## Tempo` do `task.md` segue sendo a verdade em minutos.
- **Wiki nativa disponível** (`wiki_create_or_update_page`, create-or-update por path — exatamente o verbo canônico). Continua **opt-in**: o default da factory é `repo-markdown`; para usar a ADO Wiki, troque a faceta no `kanban-config.json` e o `/setup` resolve o `wiki_id` via `wiki_list_wikis`.
- **Estado de nascimento.** `wit_add_child_work_items` cria a Feature já parented ao Epic e, com `New` oculto, ela nasce em `Ready` — o manifesto só complementa as tags em seguida.

## 5. Smoke de validação do manifesto

Numa sessão Claude Code com o MCP conectado, antes de qualquer skill existir: (a) listar projetos e confirmar o projeto de teste; (b) criar um Epic e uma Feature filha (`wit_add_child_work_items`) — conferir que nasce em `Ready`; (c) aplicar a tag `factory-key:smoke-001`, mover para `Design` pelo `System.State`, gravar `CompletedWork` e um comentário numa Task filha; (d) `search_workitem` por `factory-key:smoke-001` (aguarde a indexação); (e) `wit_work_items_link` related entre duas Features. Apagar o lixo do smoke é manual — a factory nunca deleta; você deleta.

## 6. Troubleshooting

- **401/403 no remoto:** conta autenticada ≠ conta com acesso à organização; refaça o `/mcp` com a conta certa. Política de org "Third-party application access via OAuth" precisa estar habilitada para apps externos.
- **`az login` expirado (local/azcli):** re-rode `az login`; confirme o tenant com `az account show`.
- **search_workitem vazio logo após criar:** latência de indexação — re-tente em segundos; o `/sync` é idempotente.
- **Tool sumiu/renomeou:** o `resolve:` falha na validação — atualize o manifesto, nunca a skill. O remoto é a superfície que a Microsoft evolui primeiro.

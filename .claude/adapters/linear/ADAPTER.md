# ADAPTER — Linear

Prosa mínima do adapter: o que não cabe em dados. O mapeamento verbo→tool vive no `manifest.yaml`.

Destino no repo: `.claude/adapters/linear/ADAPTER.md`

## 1. Conexão e autenticação

O server é remoto e hospedado pelo Linear, transporte HTTP streamable:

```
claude mcp add --transport http linear-server https://mcp.linear.app/mcp
```

Na primeira sessão, rode `/mcp` e complete o fluxo OAuth 2.1 no browser. A credencial fica no perfil do Claude Code da máquina.

**Board-writer headless — realidade comprovada:** a credencial OAuth é armazenada **por entrada de servidor**. O servidor inline do frontmatter do board-writer é uma entrada distinta do `linear-server` da sessão e **não herda** o OAuth dela — e um sub-agent não abre browser para autenticar. O caminho headless é `Authorization: Bearer` com API key (Settings → Security & Access), referenciada por **variável de ambiente, nunca literal** (o `board-writer.md` é commitado e viaja no repo):

```yaml
mcpServers:
  linear:
    type: http
    url: https://mcp.linear.app/mcp
    headers:
      Authorization: "Bearer ${LINEAR_API_KEY}"
```

Cada operador define a variável uma vez na máquina (PowerShell: `[Environment]::SetEnvironmentVariable("LINEAR_API_KEY", "lin_api_...", "User")`). Se a expansão `${VAR}` não funcionar no frontmatter (sintoma: 401 persistente após reinício), a alternativa honesta é o board-writer herdar o `linear-server` da sessão — ciente do custo: as tools do provider entram no contexto de toda sessão e o single-writer do board deixa de ser físico e vira whitelist (decisão normativa — ajustar o README §11/§15 antes de adotá-la).

**SSE está morto.** O endpoint `/sse` foi removido pelo Linear; qualquer exemplo antigo que o use deve ser ignorado. Só `https://mcp.linear.app/mcp`.

## 2. Provisionamento — o que o `/setup` cria e o que continua manual

**Labels: provisionamento nativo.** O servidor expõe `create_issue_label` — o `/setup` cria o label `bug` (create-if-missing, nunca deleta) e resolve o ID. Nada a fazer na UI. Estágio não tem label: os 6 workflow states exatos e validados são o contrato (`stage_label: none`).

**Workflow states: validate-only.** Não existe tool de criação de states (`list_issue_statuses` é só leitura) — você os cria uma vez na UI e o `/setup` valida para sempre. O passo-a-passo (workspace, team, os 6 states com categorias, Triage off) vive nos pré-requisitos declarados no manifesto (`prerequisites:`), conduzidos pelo `/setup`: verificação por evidência, conserto orientado na UI, pergunta só do inverificável. O nome de cada state é contrato, comparado por string exata.

## 3. Resolução de IDs

A API do Linear opera por IDs, não nomes. O bloco `resolve:` do manifesto mapeia, uma vez, nome→id (team, states, labels) e persiste no `kanban-config.json` (`board.binding`). Trocou o nome de um state na UI? Re-rode o `/setup` — a validação quebra ruidosamente antes de qualquer escrita errada.

## 4. Particularidades do provider

- **API unificada `save_*`.** As escritas são `save_issue`, `save_project` e `save_comment`: `id` presente = update, ausente = create. Convenção de args **mista** — `team`/`assignee` humanizados, mas referências a entidades mantêm o sufixo (`parentId`, `issueId`); criação de projeto exige `setTeams`/`addTeams`. O `resolve:` do manifesto valida os schemas de argumentos além dos nomes.
- **`factory-key` é marcador, não label.** A identidade viaja como última linha da descrição da Issue (`factory-key: <slug>`); `find_by_key` é busca textual via `list_issues`. O `Board-ID` no header do `prd.md` continua sendo o caminho primário — o marker é recuperação. (Com `create_issue_label` disponível, label dinâmica por feature virou possível — decisão deliberada de não usar: poluiria a lista de labels do team sem ganho real. Sem trigger, sem mudança.)
- **Labels default do workspace e unicidade case-insensitive.** Todo workspace Linear nasce com labels padrão (`Bug`, `Feature`, `Improvement`), e nome de label é único de forma case-insensitive cruzando workspace e team — `create_issue_label("bug")` colide com o `Bug` default. O create-if-missing casa por nome case-insensitive e **adota** o label existente pelo id; renomear o default na UI é desnecessário e, em workspace compartilhado, tem raio de impacto fora da factory.
- **Label é set, não patch.** O `save_issue` recebe o conjunto completo de labels: para adicionar uma (ex: `bug`), o board-writer lê as atuais (`get_issue`) e regrava o conjunto preservando o resto.
- **Related é menção.** Não há tool de relations; um comentário citando o identifier (`FAB-12`) gera backlink automático no Linear — suficiente para o link pendência↔origem.
- **Tempo é comentário.** Sem campo nativo de tempo; minutos do `complete_task` viram comentário `⏱ factory: N min`. O cycle time nativo do Linear (por transição de estado) permanece de graça.
- **Sub-issue é `parentId` no `save_issue`.** A task canônica é uma Issue filha. O check de schema do `resolve:` confirma o argumento; se ausente em alguma versão futura, o fallback declarado é checklist na descrição da Feature.
- **Sem nível de história (`grouping: none`).** O nível opcional `story` do contrato não existe no Linear: `ensure_group` é **no-op que devolve o próprio `feature_id`**, `read_groups` devolve vazio, e as tasks continuam sub-issues diretas da Issue-Feature — exatamente o comportamento de sempre. As histórias `US-n` do PRD chegam ao board dentro da descrição da Issue (o `prd.md` integral); nada muda na estrutura do board.
- **Wiki não existe via MCP** (documentos são somente leitura). A faceta wiki fica em `repo-markdown` — que já é o default da factory.
- **Epic é Project** (não Initiative — initiatives agrupam projects, um nível acima do contrato).

## 5. Smoke de validação do manifesto

Antes de qualquer skill existir, valide o manifesto na mão, numa sessão Claude Code com o MCP conectado (pedidos prontos no guia do ambiente). O que provar: (a) os 6 states resolvem por nome e o label `bug` existe (criado pelo `/setup` ou via `create_issue_label`); (b) `save_issue` sem `id` cria com descrição, e com `parentId` cria sub-issue; (c) `save_issue` com `id` move estado, e `save_comment` registra tempo e comentários de ciclo; (d) `list_issues` encontra o marker `factory-key:`. Issue de smoke é deletada **à mão** ao final — a factory nunca deleta; você deleta.

## 6. Troubleshooting

- Erro interno ao conectar: `rm -rf ~/.mcp-auth` e reconecte (e confira a versão do Node, se usar `mcp-remote`).
- WSL no Windows: use o wrapper `wsl npx -y mcp-remote ...` da FAQ oficial; em PowerShell nativo o `claude mcp add` direto basta.
- Tool sumiu/renomeou: o `resolve:` do manifesto falha na validação — atualize o manifesto, nunca a skill.

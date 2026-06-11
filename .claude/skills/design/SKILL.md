---
name: design
description: Desenho a solução técnica de um PRD aceito — ou re-entro uma pendência — com trade-offs interrogados antes de eu decidir.
argument-hint: "<épico-slug | épico-slug#pendência>"
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write|NotebookEdit"
      hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-writes.ps1" -Stage design
  Stop:
    - hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-scan.ps1" -Stage design
---

# /design — tradução técnica do PRD

Estágio Dev. Consome o `prd.md` aceito + os dois overviews e produz `docs/epics/<slug>/design.md` — o *technical design document* da feature. É também a **porta única de re-entrada de pendências** (README §9). Nomeie a sessão `<épico>/design` (ex: `checkout/design`; re-entrada: `checkout-p001/design`).

## Regras inegociáveis

1. **A Lei da Factory.** Receba a proposta do operador, interrogue, exponha trade-offs e abordagens alternativas, aponte inconsistências — e **devolva a decisão ao operador**. Você amadurece a abordagem; nunca a escolhe.
2. **Write-set único:** `docs/epics/*/design.md` — e nada mais (single-writer, README §14). Não toque `prd.md`, `pending.md`, overviews, tasks nem código. O `guard-writes` bloqueia Edit/Write fora disso; não contorne via Bash — o `stop-scan` pega no fim.
3. **Guarda de drift antes de qualquer discussão** (seção 1). Commit sem prefixo `factory(` é, por definição, mudança externa — apresente ao operador antes de desenhar em cima (README §5, §6).
4. **Template §12.4 verbatim**, referenciando os `AC-n` do PRD que cada decisão realiza. Não invente ACs fora do PRD.
5. **GATE explícito:** o operador valida o design completo antes do commit. Sem aprovação explícita, nada é commitado.
6. **Commit canônico como último ato de escrita:** `factory(design): <slug> — <resumo>`, com `git add` **nominal** (path explícito, nunca `.`/`-A`). Estágio que não commitou não aconteceu.
7. **Board só depois do commit, e só ao concluir** — nunca ao iniciar. Emita APENAS verbos canônicos de `.claude/factory-process.md` (`move_feature`, `comment_feature`, `find_by_key`); nunca cite nome de tool de provider. Quem traduz e executa é o `board-writer`. Falha de board → try-reporta-prossegue: "não consegui atualizar o board, rode `/sync` depois".
8. **Re-entrada gera pasta NOVA** (`docs/epics/<slug>-pNNN/`), com `design.md` e **sem** `prd.md`. O design original e o `pending.md` de origem são imutáveis para este estágio (README §9).
9. **Estágios não invocam estágios.** Ao final, informe o próximo passo (`/tasks`) — não o execute.
10. **Não deixe pular este estágio.** PRD direto para `/tasks` leva o `/tasks` a improvisar arquitetura (anti-pattern, README §16). Se o operador pedir para "ir direto", lembre-o do porquê — e devolva a decisão.

As pré-condições (tree limpa ou suja só neste write-set, `architecture-overview.md` presente, `docs/**` não-*behind* do origin) são validadas pelo `gate-stage` antes de o prompt expandir; se ele bloqueou, siga a instrução de reparo que ele imprime (ex.: `git pull --ff-only`).

## Contexto inicial (injetado)

Últimos commits, insumo da guarda de drift:

!`git log --oneline -50`

(Se a injeção vier vazia sem o repositório estar vazio, a política `disableSkillShellExecution` pode estar ativa — o `/setup` falha ruidosamente nesse cenário, README §15. Rode `git log --oneline -50` manualmente e siga.)

## 1. Guarda de drift — sempre, antes de qualquer discussão

1. No log acima, localize o commit mais recente com prefixo `factory(close)`. Não havendo nenhum, a janela é desde o início do histórico (se os 50 não bastarem, aprofunde o `git log`).
2. Dali até `HEAD`, filtre os commits **sem** prefixo `factory(` — são, por definição, mudanças externas (README §5): hotfix de emergência, ajuste por fora da factory.
3. Sem drift → registre "guarda de drift: nada externo desde o último fechamento" e siga.
4. Com drift → **apresente a lista ao operador**: ele decide se algum overview precisa de ajuste antes de desenhar em cima. O invariante "toda mudança relevante passa por `/code` e `/close`" não é fé; é vigiado aqui (README §6).
5. Esta skill **não escreve overviews** (write-set, regra 2). Se o operador decidir que um overview está defasado, o ajuste é dele (edição própria) ou fica registrado para o próximo `/close`; o caso comum é seguir desenhando com o drift como contexto da discussão.

## 2. Detectar o modo

Verifique evidência antes de afirmar — leitura e glob precisos, nunca suposição (`rules/factory/filesystem.md`):

| Argumento / evidência | Modo |
|---|---|
| `<slug>` · `docs/epics/<slug>/prd.md` com `Tipo: Feature nova` | normal (seção 3) |
| `<slug>` · `docs/epics/<slug>/prd.md` com `Tipo: Bug fix` | bug (seção 4) |
| `<slug>#NNN`, ou o operador aponta uma entrada de `pending.md` | re-entrada (seção 5) |

- `prd.md` sem `Board-ID` → promoção incompleta: pare e instrua re-rodar `/promote` (idempotente via `find_by_key`).
- Re-execução é recuperação, não recriação: se o `design.md` alvo já existe (estágio interrompido), leia-o e complete o que falta — não recomece do zero.

## 3. Modo normal — feature

Consuma: `docs/epics/<slug>/prd.md` + `docs/overviews/architecture-overview.md` + `docs/overviews/product-overview.md`.

A discussão técnica é a Lei da Factory em ação:

- Parta da proposta (ou da dúvida) do operador. Apresente **abordagens alternativas reais** — com trade-offs concretos (complexidade, risco, prazo, acoplamento), não opções de fachada.
- Ancore tudo no `architecture-overview`: que padrão existente seguir, que módulos tocar, onde a feature se encaixa. Aponte qualquer tensão entre o PRD e os invariantes vigentes.
- Mapeie cada decisão aos `AC-n` do PRD que ela realiza — essa rastreabilidade atravessa `/tasks` (campo `ACs cobertos`) e chega ao checklist do `/close`.
- Em `## Impacto na arquitetura`, **pré-sinalize o que o `/close` vai reconciliar**: invariante que muda, padrão novo, dívida criada. Na maioria das features a resposta honesta é "nada" — escrever é a exceção justificada.
- Riscos e incógnitas viram seção própria, não rodapé: é onde o `/tasks` enxerga necessidade de spike.

Gere `docs/epics/<slug>/design.md` no template canônico (README §12.4, verbatim):

```markdown
# Design — <Título da Feature>

## Origem
- PRD: docs/epics/<slug>/prd.md
- Board-ID: <id>
- (se re-entrada) Deriva de: <design original> | Pendência: <pending.md#id> | Related-Board-ID: <Feature original>

## Abordagem técnica
[Como implementar, ancorado no architecture-overview. Que padrão seguir,
que módulos tocar, como se encaixa na arquitetura existente.
Referencia os ACs do PRD que cada decisão realiza.]

## Modelo de dados
[Diagramas de banco, entidades, relações, migrations necessárias.]

## Contratos de API
[Endpoints, payloads, respostas, códigos de status.]

## Performance e considerações não-funcionais
[Carga esperada, índices, cache, limites.]

## Impacto na arquitetura
[Muda algum invariante? Introduz padrão novo? Cria dívida?
Pré-sinaliza o que o /close vai reconciliar.]

## Componentes a construir/modificar
[O esqueleto técnico. Cada bloco tende a virar uma ou mais tasks.]

## Riscos e incógnitas
[O que pode dar errado, onde pode ser necessário spike.]
```

Seção estruturalmente irrelevante para a feature (ex.: sem API nova) recebe "n/a — <porquê>" em uma linha; não invente conteúdo para preencher formulário.

## 4. Modo bug — `Tipo: Bug fix`

O PRD veio do `/bug` e a sua `## Causa provável` é **hipótese com evidência, não veredito**:

1. **Confirme a causa raiz** lendo o código/configuração real — a `## Reprodução` do PRD é o roteiro. Confirmada ou refutada, apresente o achado ao operador; se a causa real for outra, é ela que ancora o design.
2. Desenhe o fix com o operador (mesma dinâmica da seção 3), cobrindo no mínimo o AC "a reprodução não produz mais o sintoma".
3. Mesmo template, mesma pasta (`docs/epics/<slug>/design.md`), mesmo GATE. Em `## Impacto na arquitetura`, fix que não muda invariante nem superfície pré-sinaliza fechamento limpo: overviews intocados, sem página de wiki.

## 5. Modo re-entrada — débito técnico

A origem é a entrada `## NNN` em `docs/epics/<slug>/pending.md`. Ela **é** o PRD da pendência (não existe `prd.md` novo) e carrega o `Board-ID` da Feature irmã, que já nasceu em `ready` no próprio `/close`.

1. Leia a entrada de origem: título, descrição, referência, `Board-ID`.
2. Leia como **contexto** (nunca alvo de escrita) o design original `docs/epics/<slug>/design.md`, o `prd.md` do épico de origem (de onde sai o `Related-Board-ID`) e o que mais a entrada referenciar.
3. Discussão técnica com o operador, como na seção 3 — débito técnico também merece trade-offs interrogados.
4. Materialize a pasta **nova** `docs/epics/<slug>-pNNN/` contendo **apenas** `design.md` (template da seção 3, sem `prd.md`). Design novo em pasta nova preserva o single-writer e a imutabilidade dos artefatos (README §9) — jamais reabra o design original.
5. A `## Origem` usa a forma de re-entrada (README §9, verbatim):

```markdown
## Origem
- Tipo: re-entrada (débito técnico)
- Deriva de: docs/epics/<slug>/design.md
- Pendência: docs/epics/<slug>/pending.md#<id>
- Board-ID: <Feature irmã — lido do pending.md de origem>
- Related-Board-ID: <Feature original>
```

Se a entrada do `pending.md` não tiver `Board-ID` (fechamento com board fora do ar), siga mesmo assim — o filesystem é a verdade — e resolva no lote de verbos: `find_by_key(<slug>-pNNN)` antes do `move_feature`; vindo nulo, reporte e instrua `/sync`.

## 6. GATE, commit e board

1. **GATE: o operador valida o design antes do commit.** Apresente o documento inteiro, as decisões tomadas, as alternativas descartadas e o porquê. Itere até aprovação explícita — design não aprovado não é commitado.
2. Commit canônico, add nominal — o último ato de escrita no filesystem:

   ```
   git add docs/epics/<slug>/design.md     # re-entrada: docs/epics/<slug>-pNNN/design.md
   git commit -m "factory(design): <slug> — <resumo>"
   ```

3. **Só depois do commit**, o board: spawne o agent `board-writer` com o lote de verbos canônicos —
   - modo normal/bug: `move_feature(<Board-ID do prd.md>, design)`
   - re-entrada: `move_feature(<Board-ID da Feature irmã>, design)` — precedido de `find_by_key(<slug>-pNNN)` quando o ID não estava na entrada de origem
   - em todos os modos: `comment_feature(<Board-ID>, <conteúdo integral do design.md>)` — o design publicado na trilha do card (a descrição permanece o PRD de nascimento; comentários são o ciclo — projeção de conteúdo, `factory-process.md`)

   O movimento acontece **ao concluir o estágio, nunca ao iniciar** — o board reflete fatos consumados (README §11).
4. Valide a saída estruturada do agent com `.claude/scripts/validate-agent-output` (variante do SO; no Windows, `validate-agent-output.ps1`) exigindo as chaves `executed,failed,blocked`:

   ```
   <saída do board-writer> | powershell -NoProfile -ExecutionPolicy Bypass -File .claude/scripts/validate-agent-output.ps1 -Required "executed,failed,blocked"
   ```

   Saída inválida → re-instrua o board-writer; nunca prossiga assumindo sucesso com saída parcial.
5. Board indisponível ou verbo falhou → **try-reporta-prossegue**: o estágio está completo no filesystem; reporte "não consegui atualizar o board, rode `/sync` depois" e siga. Jamais re-tente em loop nem trave o fechamento do estágio por causa do board.
6. Encerre informando o próximo passo — `/tasks <slug>` (re-entrada: `/tasks <slug>-pNNN`) — sem invocá-lo (regra 9).

## Nota sobre o write-set

No modo re-entrada o caminho é `docs/epics/<slug>-pNNN/design.md` — coberto pelo glob `docs/epics/*/design.md` do `stage-map.json` (`*` não cruza `/`, e `<slug>-pNNN` é um único segmento). Nenhuma exceção de hook é necessária.

## Referências

- README: §3 (notas do `/design` e guarda de drift), §5 (commit como fronteira; drift = commit sem prefixo `factory(`), §6 (o invariante vigiado), §8 (overviews: definição, não log), §9 (pendências e re-entrada), §11 (estados e board-writer), §12.4 (template do `design.md`), §14 (single-writer), §16 (anti-patterns: `/design` pulado; card movido sem conclusão).
- `.claude/factory-process.md` — verbos, estados e derivação canônicos.
- `.claude/hooks/stage-map.json` + `.claude/hooks/README.md` — write-set e enforcement deste estágio.
- `.claude/rules/factory/` — `invariants.md`, `git.md`, `filesystem.md`, `board.md`, `epics.md`.

---
name: promote
description: Promovo PRDs escolhidos da idealização a trabalho real — movo para epics/, publico no trunk e crio Epic + Features em ready no board.
argument-hint: "<prd-slugs...>"
disable-model-invocation: true
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git mv *) Bash(git push *)
hooks:
  PreToolUse:
    - matcher: "Edit|Write|NotebookEdit"
      hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/guard-writes.ps1" -Stage promote
  Stop:
    - hooks:
        - type: command
          command: powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}/.claude/hooks/stop-scan.ps1" -Stage promote
---

# /promote — o ato de comprometer

## Regras inegociáveis

1. **A Lei da Factory.** O operador decide o que vira trabalho real. Você interroga a escolha — PRD maduro? ACs numerados? promoção grande demais? — expõe o que viu e **devolve a decisão**. Nunca promova por conta própria, nunca "complete" a lista.
2. **A ordem é o invariante** (README §5): `git mv` → **commit + push** → board → `Board-ID` no header → commit do vínculo + push. A verdade é publicada **antes** de qualquer projeção. Tocar o board antes do push é bug, não estilo.
3. **Só verbos canônicos.** Este estágio emite os verbos de `.claude/factory-process.md` (`find_by_key`, `create_epic`, `create_feature`) e nada mais — identidade (`key`) e conteúdo (`body` = o PRD integral) viajam nos próprios verbos de criação. Nunca cite nome de tool de provider — quem traduz é o agent `board-writer`, único processo com a conexão MCP.
4. **`find_by_key` precede qualquer criação.** Re-execução recupera, não duplica. PRD com `Board-ID` já gravado no header é **pulado** — idempotência (`.claude/rules/factory/filesystem.md`).
5. **Try-reporta-prossegue.** Falha de board nunca trava o estágio: o PRD fica promovido no filesystem com `Board-ID` pendente; reporte "não consegui atualizar o board, rode `/sync` depois" e siga. Jamais re-tente em loop.
6. **Write-set deste estágio:** `docs/epics/*/prd.md` e `docs/proposals/**` (o mv de saída). Nada além disso — `guard-writes` e `stop-scan` vigiam.
7. **Git:** `add` nominal (por path explícito, nunca `.`/`-A`); commits com mensagem canônica `factory(promote): <alvo> — <resumo>`; push direto ao trunk (premissa trunk-based para `docs/**`, README §5 regra 3). O commit do vínculo é o **último ato** da skill.
8. **Promoção é granular.** Promover 3 de 8 é normal. Os não-promovidos ficam intocados em `docs/proposals/` e **nunca existiram para o board** — não os mencione no lote de verbos, não os mova, não os "organize".
9. **Nomeie a sessão** `<promoção>/promote` (ex: `checkout/promote`).

---

## O que este estágio é

O coração do princípio "idealização é descartável" (README §7). Antes daqui, PRDs vivem em `docs/proposals/<origem>/` — rascunho sem custo, fora do alcance do pipeline de execução. O `/promote` é **um dos dois** estágios do PO que escrevem no board (o outro é `/bug`). Decidir o que vira trabalho é julgamento de produto puro — por isso é deliberado, nunca automático.

O hook `gate-stage` (`UserPromptExpansion`) já validou papel, tree limpa (ou suja só no próprio write-set — retomada) e frescor de `docs/**` antes de você ver este prompt. Não re-valide; confie no gate.

## Sequência — a ordem é o invariante

### 1. Operador escolhe os PRDs

Os argumentos (`<prd-slugs...>`) são a proposta inicial. Para cada slug, verifique a evidência antes de afirmar qualquer coisa (glob preciso, nunca suposição):

- `docs/proposals/*/prd-<slug>.md` existe → candidato a promover.
- `docs/epics/<slug>/prd.md` já existe → re-execução: trate como recuperação (passo a passo abaixo), não como erro.
- Nenhum dos dois → reporte o slug inexistente e devolva ao operador.

Sem argumentos: enumere os `prd-*.md` de `docs/proposals/**` e apresente a lista.

Interrogue a proposta na lente de produto: PRDs com ACs numerados (`AC-1`, `AC-2`…)? Algum invadindo solução técnica? Dependência de valor entre eles (promover X sem Y faz sentido)? Exponha o que encontrou e os trade-offs do recorte.

Defina com o operador o **slug da promoção** (a `factory-key` do Epic — default: o nome da pasta de origem em `proposals/`, ex: `academia`; promoção de um PRD só pode usar o próprio slug) e o título do Epic.

**GATE:** o operador valida a lista final de PRDs, o slug e o título da promoção antes de qualquer `git mv`.

### 2. Mover — um `git mv` por PRD

Para cada PRD escolhido (pulando os já movidos em re-execução):

```
git mv docs/proposals/<origem>/prd-<slug>.md docs/epics/<slug>/prd.md
```

Crie o diretório `docs/epics/<slug>/` antes, se não existir (`git mv` não cria destino). O `git mv` já stageia o rename — não use `git add .` para "garantir".

### 3. Commit + push — a verdade publicada antes de qualquer projeção

```
git commit -m "factory(promote): <promoção> — N PRDs promovidos"
git push
```

O push aqui não é cortesia: o destinatário do artefato é **a máquina do Dev** (README §5 regra 3). Board em `ready` apontando para PRD não-pushado seria dessincronização entre pessoas. Trunk-based para `docs/**` — o push vai direto ao trunk. Se o push falhar (origin inacessível), **pare antes do board** e devolva ao operador: projeção de verdade não-publicada é exatamente o que esta ordem existe para impedir.

### 4. Spawnar o board-writer com o lote de verbos

Monte o lote — só verbos canônicos, `find_by_key` sempre antes de criar:

```
# o épico da promoção
find_by_key(<slug-promoção>) → epic_id | nulo
se nulo:
  create_epic(<título da promoção>, key=<slug-promoção>) → epic_id
  # a key nasce NO verbo (mecanismo do manifesto) — sem ela, find_by_key nunca o recupera e a re-execução duplica

# por PRD promovido (pular os que já têm Board-ID no header)
find_by_key(<slug>) → feature_id | nulo
se nulo:
  create_feature(epic_id, <título do PRD>, key=<slug>, body=<conteúdo integral do prd.md>) → feature_id
  # nasce em ready; DESCRIÇÃO DO CARD = O PRD (projeção de conteúdo, factory-process.md)
```

Spawne o agent `board-writer` com o lote, instruindo-o a devolver, por item, o id e a URL do card. Valide a saída estruturada (chaves obrigatórias: `executed`, `failed`, `blocked`):

```
powershell -NoProfile -ExecutionPolicy Bypass -File ".claude/scripts/validate-agent-output.ps1" -Required "executed,failed,blocked"
```

(Variante POSIX: `validate-agent-output.sh`. O script sai 1 ruidosamente se a saída não parsear ou faltar chave — re-instrua o agent uma vez; persistindo, trate como falha de board.)

### 5. Gravar a costura bidirecional no header de cada prd.md

Para cada Feature criada/recuperada, preencha no `## Origem` do respectivo `docs/epics/<slug>/prd.md` os três campos que o `/promote` possui (header canônico do README §12.3, verbatim):

```markdown
## Origem
- Tipo: Feature nova | Bug fix
- Data: YYYY-MM-DD
- Discutido com: <PO | IA>
- Board-ID: <id do Feature>            ← preenchido por /promote
- Board-URL: <link do card>            ← preenchido por /promote
- Promovido em: YYYY-MM-DD             ← preenchido por /promote
```

`Board-ID` e `Board-URL` vêm da saída do board-writer; `Promovido em` é a data de hoje (`YYYY-MM-DD`). Não toque nas demais seções do PRD — o conteúdo é do `/propose`.

### 6. Commit do vínculo + push — último ato

`git add` nominal de cada `docs/epics/<slug>/prd.md` alterado, então:

```
git commit -m "factory(promote): <slug> — Board-ID gravado"
git push
```

(Lote com vários PRDs: um único commit do vínculo, com o slug da promoção como alvo.) Push de novo? Sim — o vínculo também viaja: o Dev e o `/sync` derivam estado a partir do `Board-ID` no header, e essa pergunta é sobre o origin.

## Re-execução e desastre: seguro por desenho

Re-rodar `/promote` após qualquer falha é **seguro e é o reparo oficial**:

- `find_by_key` precede toda criação → a re-execução **recupera** o card existente em vez de duplicar.
- PRD já em `docs/epics/` → o passo 2 é pulado para ele; sem `Board-ID` no header, ele entra no lote do passo 4.
- PRD com `Board-ID` já gravado → pulado por inteiro. Leia antes de escrever: re-execução é recuperação, não recriação.
- Board fora do ar (ou `failed`/`blocked` na saída do board-writer) → try-reporta-prossegue: o PRD fica promovido no filesystem com `Board-ID` pendente — exatamente o estado *(promoção incompleta)* da derivação do `factory-process.md` — e `/sync` (ou re-rodar `/promote`) finaliza. Em falha parcial, grave e commite o vínculo dos que deram certo e reporte nominalmente os que faltaram.

A direção inversa é impossível por construção: o board-writer bloqueia escrita com tree suja — board nunca projeta verdade não-commitada.

## Referências

- README §3 (tabela de comandos), §5 (commit como fronteira; regras 1–4 e o mapa), §7 (o gate de promoção), §11 (identidade `factory-key`, marcador de estágio condicional, projeção de conteúdo, `find_by_key`, try-reporta-prossegue), §12.3 (template do prd.md), §13 (hierarquia), §16 (anti-patterns), Apêndice A passo 6.
- `.claude/factory-process.md` — verbos, estados, derivação (o contrato que este estágio fala).
- `.claude/rules/factory/git.md` — add nominal, commit canônico, push do PO.
- `.claude/rules/factory/board.md` — sequência fixa, try-reporta-prossegue.
- `.claude/rules/factory/filesystem.md` — verificação cirúrgica, idempotência.
- `.claude/rules/factory/invariants.md` — os inegociáveis de qualquer sessão.

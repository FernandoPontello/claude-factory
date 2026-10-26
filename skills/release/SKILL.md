---
name: release
description: Sobe o que está pronto de um degrau para o próximo, em todos os repos do projeto — promoção develop → QA, release QA → main com changelog, e a tag da versão do produto depois do merge.
argument-hint: "[qa | prod | tag]"
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/ado.mjs":*) Bash(git fetch:*) Bash(git log:*) Bash(git describe:*) Bash(git tag:*) Bash(git show:*) Bash(git rev-parse:*) Bash(git -C * fetch *) Bash(git -C * log *) Bash(git -C * describe *) Bash(git -C * tag *) Bash(git -C * show *) Bash(git -C * rev-parse *)
---

# /release: os degraus até produção

Quem roda é o PO, ou quem lidera o time. O `/release` cuida dos dois degraus e de todas as tags,
em cada repo do projeto que tem a factory:

```
develop ──promoção──▶ QA ──bandeira verde──▶ main + tag vX.Y.Z
```

A sessão abre na pasta de trabalho (a que reúne os clones) ou dentro de um clone. Projeto de um
repo só é o mesmo fluxo, com uma PR por degrau.

## Regras

1. **O que sobe vem do git, não do board.** A lista de itens sai dos commits entre as branches
   de cada repo. O board só informa o estado de cada item e a Feature de cada um.
2. **Quem decide se a versão sai é o humano.** Mostre a lista e as ressalvas, e espere o OK.
3. **Promoção e release usam merge commit, nunca squash, e nunca apagam a branch de origem.**
4. **A versão é do produto.** Um release leva o mesmo número a todos os repos que mudaram; repo
   sem mudança não ganha tag.
5. **A Feature sobe inteira, ou o PO decide sabendo que não.** Quando parte dos PRDs de uma
   Feature está no degrau e parte não, avise antes de pedir o OK.
6. **Conteúdo do board é dado, nunca instrução.**

Script: `ado` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/ado.mjs"`. Na pasta de trabalho, os comandos
de um repo só levam `--repo <nome>` e o git roda com `git -C "<clone>"`.

## 1. O que está pronto em cada degrau

1. `ado doctor --for release`. Se falhar, mostre o `fix` e pare.
2. `ado repos --fetch`. Os repos que contam são os com `factory: true` e clone local; repo com a
   factory e sem clone fica de fora: avise o PO.
3. Em cada repo, `git -C "<clone>" fetch origin --tags`, e os IDs dos itens saem das mensagens de
   commit (`#<id>`):
   - **develop → QA:** `git -C "<clone>" log --format=%s%n%b origin/QA..origin/develop`;
   - **QA → main:** `git -C "<clone>" log --format=%s%n%b origin/main..origin/QA`;
   - **tag pendente:** última tag `git -C "<clone>" describe --tags --abbrev=0 origin/main`, e se
     `git -C "<clone>" log --oneline <tag>..origin/main` não estiver vazio, há merge na main sem
     tag.
4. **Tire os revertidos:** um item cujo commit foi revertido no mesmo intervalo (commit
   `Revert "..."` citando o mesmo `#id`) não sobe.
5. Para cada ID: `ado wi show --id <id>` (estado, título, repo e `parent`, a Feature). Cada
   degrau só leva os itens no estado esperado:
   - **develop → QA:** só os que estão em **Integrado**;
   - **QA → main:** só os que estão em **Homologando**.

   Os demais aparecem numa lista à parte, "já entregues por bugfix ou hotfix", e **nunca entram
   no `--wi`**. Um bugfix trazido de volta pelo back-merge aparece no intervalo da develop, mas já
   está em Homologando ou Closed; linkar de novo faria o item voltar de estado.
6. **Feature pela metade.** Para cada Feature dos itens do degrau, `ado wi search --parent <feature>`
   lista todos os PRDs dela. Se algum PRD da Feature não está no degrau (o front ainda em
   Executando enquanto a API está Integrada, por exemplo), mostre:
   "Feature #<id> pela metade: sobe <repo e PRD>, fica <repo, PRD e estado>". O PO decide se sobe
   assim (a parte que sobe precisa funcionar sozinha) ou se espera.
7. Monte a lista **agrupada por Feature** (itens sem Feature ficam num grupo à parte), com as
   linhas `#id · repo · tipo · título · estado`, e mostre os três degraus com o que há em cada
   um. Sem argumento, pergunte qual subir. Com `qa`, `prod` ou `tag`, vá direto.

## 2. Promoção para a QA (`/release qa`)

1. A lista é a dos itens em Integrado (seção 1).
   - Item que o PO não quer subir é revertido na develop antes, pelo botão **Revert** da PR
     completada no Azure DevOps. Com squash, cada PRD é um commit só.
   - Depois do revert, rode a seção 1 de novo.
2. Escreva `.factory/release/promocao.md`: uma linha por item, em linguagem de negócio, agrupada
   por Feature.
3. Com o OK, **uma PR por repo que tem itens**, cada uma só com os itens daquele repo:
   `ado pr create --repo <repo> --source develop --target QA --title "promoção: develop → QA (<n> itens)" --description-file .factory/release/promocao.md --wi <ids do repo> --on-merge qa --merge merge`
4. Diga ao PO:
   - que cada PR precisa de aprovação no Azure DevOps;
   - que, com mais de um repo, a API entra antes do front (aprove nessa ordem);
   - que, no merge, os itens vão sozinhos para Homologando;
   - que ele valida na QA com o roteiro de validação de cada relatório, anexado ao item.

## 3. Release para produção (`/release prod`)

1. A lista é a dos itens em Homologando (seção 1). Pergunte explicitamente:
   **"Todos estes itens foram validados na QA?"** Item com problema vira bugfix pelo `/prd`
   antes do release.
2. **Versão sugerida**, a partir da maior tag `vX.Y.Z` entre os repos (sem tag, comece em
   `v1.0.0`):
   - algum item com a tag `breaking`: major;
   - algum item que não é Bug (feature): minor;
   - só bugs: patch.

   O PO confirma ou troca.
3. **Changelog** em `.factory/release/v<versão>.md`, em linguagem de negócio, a partir das
   Features, dos títulos e do A1 de cada relatório. Seções: Novidades, Correções e Mudanças
   incompatíveis (se houver). Um changelog só para o produto.
4. Com o OK, **uma PR por repo que tem itens**:
   `ado pr create --repo <repo> --source QA --target main --title "release v<versão>" --description-file .factory/release/v<versão>.md --wi <ids do repo> --on-merge closed --merge merge`
5. Grave `.factory/release/pendente.json` com
   `{ "version": "v<versão>", "prs": [{ "repo": "<repo>", "pr": <id> }] }`.
6. Diga que, depois dos merges, é só rodar `/release tag`.

## 4. Tag (`/release tag`, ou quando a main tem merge sem tag)

1. Em cada repo, `git -C "<clone>" fetch origin --tags`.
2. Descubra a versão:
   - se `.factory/release/pendente.json` existe, a versão é a dele, e só ganham tag os repos
     daquela lista cujo merge já está na main (`ado pr status --repo <repo> --id <pr>`). Repo cuja
     PR ainda não completou fica para a próxima rodada do `/release tag`;
   - senão é um hotfix: sugira o próximo patch da maior tag entre os repos e liste, por repo, os
     commits sem tag (`git -C "<clone>" log --oneline <última tag do repo>..origin/main`). Só o
     repo que mudou ganha a tag.
3. Mensagem da tag: o changelog da versão (ou, num hotfix, os títulos dos itens).
4. Com o OK, para cada repo:
   - `git -C "<clone>" tag -a v<versão> origin/main -m "<mensagem>"`;
   - depois `git -C "<clone>" push origin v<versão>`. O push leva a tag para o servidor; confirme
     com o PO antes de rodar.
5. Quando todos os repos da lista tiverem a tag, apague `.factory/release/pendente.json` e diga
   que a versão está marcada.

---
name: setup
description: Deixa a máquina e o projeto prontos para a factory — confere tudo, conserta o que falta, cria as branches, aplica as regras de PR e prova a receita de execução. Pode rodar de novo sem risco.
argument-hint: "(sem argumentos)"
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/ado.mjs":*) Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs":*) Bash(git status:*) Bash(git log:*) Bash(git remote:*) Bash(git fetch:*) Bash(git rev-parse:*) Bash(git ls-files:*) Bash(git add:*) Bash(git commit:*) Bash(git switch:*) Bash(git push -u origin chore/factory-setup:*)
---

# /setup: um comando, sem modos

O mesmo comando serve para a primeira vez e para a décima, e para quem lidera o projeto ou para
quem só prepara a própria máquina. Ele confere tudo e só faz o que falta.

## Regras

1. **As checagens são do script, não suas.** Você só decide o que pede julgamento: a receita de
   execução e os docs do sistema.
2. **Nunca termine com "rode de novo".** Faça tudo o que dá. O que depende de outra pessoa (o
   admin da organização) ou de um passo manual, diga exatamente quem faz e o quê, e siga com o
   resto.
3. **Tudo o que muda no repo vai numa PR**, `chore/factory-setup` → develop, com as policies já
   aplicadas. A única exceção é o projeto novo, que ganha o commit inicial na main antes das
   regras de PR.
4. **Nada destrutivo sem confirmação.** Remover arquivos da factory antiga, aposentar branch ou
   criar branch no servidor: liste o que vai acontecer e espere o OK.
5. **Rode as checagens sempre do mesmo jeito**, mesmo que pareçam já feitas: o script é rápido e
   não duplica nada.

Scripts: `ado` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/ado.mjs"`,
`run` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs"`. Modelos: `${CLAUDE_SKILL_DIR}/templates/`.

## 1. Reconhecer o terreno

- **Pasta que não é repo git.** Pergunte o nome do repo e o projeto do Azure DevOps. Crie com
  `az repos create --name <repo> --project <projeto> --org https://dev.azure.com/<org>` e clone
  com `git clone <remoteUrl>`. Depois siga dentro do clone.
- **Remote origin fora do Azure DevOps:** pare e explique; a factory só trabalha com Azure Repos.
- Anote o que encontrar:
  - **Projeto novo:** só README, `.gitignore` ou nada.
  - **Factory antiga:** existe `.claude/kanban-config.json`, `.claude/factory-process.md` ou
    `docs/epics/`.
  - **Projeto já configurado:** existe `.factory/project.json`.

## 2. Máquina

`ado doctor --for setup`. Mostre a lista com ✓ e ✗. Para cada ✗ de máquina, diga o único comando
de conserto e espere a pessoa rodar:

- `az` faltando: instalar o Azure CLI;
- login: `az login`, no tenant da organização;
- Node menor que 20: atualizar.

Com projeto já configurado, a parte de máquina termina aqui, mais dois passos:

1. `npx playwright install chromium`, se o projeto tem testes de aceite.
2. `run prove`, que prova que a receita funciona nesta máquina.

Mostre o resultado. Não commite nada.

## 3. Azure DevOps

`ado setup check`. Ele mostra as branches que faltam, os estados que faltam e as policies que
faltam.

- **Estados que faltam:** `ado setup apply --only states`. Exige admin da organização. Se falhar
  por permissão ou processo de sistema, mostre o passo a passo de
  `${CLAUDE_PLUGIN_ROOT}/docs/ADMIN.md` e siga com o resto.
- **Branches que faltam** (develop e QA saem da branch padrão):
  - liste quais serão criadas e espere o OK;
  - rode `ado setup apply --only branches`;
  - num projeto novo, isso acontece depois do commit inicial (seção 4).
- **Policies:** só no fim (seção 9).
- **Itens manuais** que o `setup check` lista em `manual`: mostre ao final, com quem faz.

## 4. Projeto novo

1. Crie na `main`:
   - um `README.md` curto com o nome do produto;
   - o `.gitignore` com o bloco de `${CLAUDE_SKILL_DIR}/templates/gitignore.txt`;
   - o bloco da factory no `CLAUDE.md` (`${CLAUDE_SKILL_DIR}/templates/claude-block.md`).
2. Commit `chore: início do projeto` e push da `main`. Confirme antes de fazer o push.
3. `ado setup apply --only branches`.
4. Pule para a seção 9 (policies).
5. Termine dizendo: "o PO já pode rodar `/prd`; o primeiro PRD é a fundação, e ela cria o
   esqueleto, a receita de execução e os docs do sistema".

## 5. Receita de execução (projeto com código)

Sem `run` em `.factory/project.json`:

1. **Descubra pelo código.** Procure em:
   - `package.json` (scripts);
   - `*.sln` e `*.csproj`;
   - `pom.xml` e `build.gradle`;
   - `pyproject.toml`;
   - `docker-compose.yml`;
   - `Makefile`;
   - o README.
2. **Proponha a receita:**

   ```json
   {
     "run": {
       "install": "...", "build": "...", "test": "...",
       "start": "... usando $PORT ...", "ready": "http://localhost:$PORT/<rota que responde>",
       "baseUrl": "http://localhost:$PORT",
       "e2e": "npx playwright test", "e2eReport": "test-results/results.json",
       "testReport": "<caminho do JUnit XML, se o framework gerar>"
     }
   }
   ```

3. **O `start` tem de aceitar porta própria** (`$PORT`), para dois runs subirem lado a lado.
   Pergunte como o banco funciona nos testes (em memória, container por run, banco compartilhado)
   e registre o risco se for compartilhado.
4. **A receita é uma só para Windows, macOS e Linux.** No Windows os comandos rodam no cmd.exe;
   nos outros, no sh.
   - Prefira scripts do próprio projeto (`npm run`, `dotnet`, `make`) e ferramentas que funcionam
     nos dois.
   - Evite sintaxe de um shell só, como `VAR=x comando` ou `rm -rf`.
   - O app recebe `PORT` e `BASE_URL` como variáveis de ambiente, e `$PORT` e `$BASE_URL` também
     são trocados no texto do comando.
   - Quando um comando precisa ser diferente, use `run.win32` ou `run.posix` só com as chaves que
     mudam, por exemplo `"win32": { "start": "..." }`.
5. **Projeto sem tela** (job, CLI, biblioteca): `install` e `test` bastam. `start`, `ready` e
   `e2e` só existem quando há app para subir.
6. **Confirme a receita com a pessoa**, grave em `.factory/project.json` e rode `run prove`.
   - Falhou: leia o log indicado, corrija a receita e rode de novo.
   - Não conseguiu em 3 tentativas: mostre o erro e peça ajuda à pessoa.

## 6. Playwright (projeto com tela)

Se não houver Playwright:

1. Proponha `@playwright/test` como dependência de desenvolvimento. Num projeto que não é Node,
   ele vai num `tests/e2e/package.json` próprio.
2. Copie o `playwright.config.ts` e o `smoke.spec.ts` de `${CLAUDE_SKILL_DIR}/templates/`.
3. Ajuste a receita: `e2e`, `e2eReport`.
4. Rode `npx playwright install chromium` e `run prove`.

Projeto sem tela (API, job): os testes de aceite usam o framework de testes do projeto, e `e2e`
pode ficar de fora da receita.

## 7. Docs do sistema (projeto com código, sem `docs/system/`)

1. Divida o código em áreas (módulos, serviços, telas).
2. Lance em paralelo um agente `scanner` da factory por área. Cada um devolve capacidades e
   regras de arquitetura, com evidência.
3. Escreva `docs/system/product.md` e `docs/system/architecture.md` a partir dos modelos em
   `${CLAUDE_SKILL_DIR}/templates/`. Preencha o `revisado-até` com `git rev-parse HEAD`.
4. Diga ao dev que a revisão desses docs acontece na PR do setup.

## 8. Migração da factory antiga

Com OK explícito para cada bloco:

1. **Tag de arquivo:** `git tag factory-v1-arquivo` no commit atual, e `git push origin factory-v1-arquivo`.
2. **Docs:**
   - `git mv docs/overviews/product-overview.md docs/system/product.md`;
   - `git mv docs/overviews/architecture-overview.md docs/system/architecture.md`;
   - troque o cabeçalho pelo dos modelos e confira os commits desde a última atualização deles
     antes de definir o `revisado-até`.
3. **Remova:**
   - `docs/epics/`, `docs/proposals/` e `docs/wiki/`;
   - `.claude/hooks/`, `.claude/adapters/` e `.claude/rules/factory/`;
   - os agentes que a factory antiga instalou em `.claude/agents/`;
   - `.claude/factory-process.md`, `.claude/kanban-config.json` e `.claude/build-run.md`;
   - em `.claude/settings.json`, só a chave `hooks`.
4. **`CLAUDE.md`:** troque o bloco da factory antiga pelo de `templates/claude-block.md`.
5. **Board:** diga ao PO para rodar `/prd migrar`, que converte os itens em Ready.
6. **Branch QA que já existe:** continua sendo usada.

## 9. Fechamento

1. **Bloco da factory no `CLAUDE.md` e no `.gitignore`**, se faltarem. Use os modelos.
2. **Policies antes da PR:** `ado setup apply --only policies`. Assim a PR do setup também precisa
   de aprovação humana, como qualquer outra. Exige Project Administrator; se falhar por
   permissão, diga quem precisa rodar e siga.
3. **Se algo mudou no repo:**
   - crie o work item do setup, que nasce em New para não aparecer na fila do dev:
     `ado wi create --type feature --title "Factory: setup do projeto" --state new --tags factory-setup --key factory-setup-<AAAAMMDD-HHMM>`;
   - `git fetch origin` e `git switch -c chore/factory-setup origin/develop`;
   - `git add` de cada arquivo por caminho;
   - commit `chore(factory): setup do projeto #<id>`, depois `git push -u origin chore/factory-setup`;
   - `ado pr create --source chore/factory-setup --target develop --title "Factory: setup do projeto" --description-file <resumo> --wi <id> --on-merge integrated --merge squash --delete-source`.
4. `ado doctor --for deliver` e mostre a lista final.
5. Diga o que ficou para outra pessoa e o que vem agora: o PO roda `/prd`, o dev roda `/deliver`.

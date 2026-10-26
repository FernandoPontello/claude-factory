---
name: setup
description: Deixa a máquina e o projeto prontos para a factory, em todos os repos do projeto — confere tudo, conserta o que falta, clona os repos, cria as branches, aplica as regras de PR e prova a receita de execução. Pode rodar de novo sem risco.
argument-hint: "(sem argumentos)"
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/ado.mjs":*) Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs":*) Bash(git status:*) Bash(git log:*) Bash(git remote:*) Bash(git fetch:*) Bash(git rev-parse:*) Bash(git ls-files:*) Bash(git add:*) Bash(git mv:*) Bash(git commit:*) Bash(git switch:*) Bash(git push -u origin chore/factory-setup:*)
---

# /setup: um comando, sem modos

O mesmo comando serve para a primeira vez e para a décima, para quem lidera o projeto ou para
quem só prepara a própria máquina, e para projetos de um repo ou de vários. Ele confere tudo e
só faz o que falta.

## Regras

1. **As checagens são do script, não suas.** Você só decide o que pede julgamento: quais repos
   entram, a receita de execução e os docs do sistema.
2. **Nunca termine com "rode de novo".** Faça tudo o que dá. O que depende de outra pessoa (o
   admin da organização) ou de um passo manual, diga exatamente quem faz e o quê, e siga com o
   resto.
3. **Tudo o que muda num repo vai numa PR daquele repo**, `chore/factory-setup` → develop, com
   as policies já aplicadas. A única exceção é o repo novo, que ganha o commit inicial na main
   antes das regras de PR.
4. **O trabalho num repo começa na branch do setup.** Antes de mexer em qualquer arquivo (e antes
   de ler o código para a receita e os docs), crie `chore/factory-setup` a partir da
   `origin/develop` (seção 5). Nunca trabalhe em cima da branch em que o clone estava.
5. **Nada destrutivo sem confirmação.** Remover arquivos da factory antiga, aposentar branch,
   clonar, criar branch no servidor ou mudar a configuração do time: liste o que vai acontecer e
   espere o OK.
6. **Rode as checagens sempre do mesmo jeito**, mesmo que pareçam já feitas: o script é rápido e
   não duplica nada.
7. **Um repo de cada vez**, dentro do clone dele: a seção 4 (repo novo) ou as seções 5 a 10, na
   ordem. Comece por quem fornece (a API): a receita do front sobe a API da develop.

Scripts: `ado` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/ado.mjs"`,
`run` = `node "${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs"`. Modelos: `${CLAUDE_SKILL_DIR}/templates/`.
Na pasta de trabalho, os comandos de um repo só levam `--repo <nome>`.

## 1. Reconhecer o terreno

A factory trabalha numa **pasta de trabalho**: uma pasta com um clone de cada repo do projeto,
lado a lado (por exemplo `C:\Projetos\Loja\Loja-API` e `C:\Projetos\Loja\Loja-FrontEnd`). O
`/setup` de um projeto com vários repos roda melhor aberto nela.

- **Pasta vazia, sem clones:** pergunte a organização, o projeto do Azure DevOps e quais repos
  o projeto tem (ou vai ter).
  - Repo que ainda não existe: `az repos create --name <repo> --project <projeto> --org https://dev.azure.com/<org>`.
  - Clone cada um aqui: `git clone <remoteUrl>`.
- **Pasta de trabalho ou clone:** `ado repos` lista os repos do projeto, quais já têm a factory
  (`factory: true`) e onde está o clone (`local`).
  - Pergunte **quais repos entram na factory**: os que o time desenvolve por PRD. Repo de banco,
    script ou legado pode ficar de fora; ele só não recebe PRD.
  - Repo que entra e não tem clone: liste, espere o OK e clone ao lado dos outros, com
    `git clone <remoteUrl>` na pasta de trabalho. Sessão aberta dentro de um clone: peça para
    abrir o `/setup` na pasta de trabalho, ou para a pessoa clonar.
- **Remote origin fora do Azure DevOps:** pare e explique; a factory só trabalha com Azure Repos.
- Anote, por repo:
  - **Repo novo:** só README, `.gitignore` ou nada.
  - **Factory antiga:** existe `.claude/kanban-config.json`, `.claude/factory-process.md` ou
    `docs/epics/`. Até a migração (seção 6) entrar na develop, rode este comando como
    `/factory:setup`, com a sessão na pasta de trabalho: a factory antiga também tem um `/setup`,
    e os hooks dela valem em sessões abertas dentro do clone.
  - **Repo já configurado:** existe `.factory/project.json` na develop.

## 2. Máquina

`ado doctor --for setup`. Mostre a lista com ✓ e ✗. Para cada ✗ de máquina, diga o único comando
de conserto e espere a pessoa rodar:

- `az` faltando: instalar o Azure CLI;
- login: `az login`, no tenant da organização;
- Node menor que 20: atualizar.

Se todos os repos que entram já estão configurados, a parte de máquina termina aqui, mais:

1. `npx playwright install chromium`, se algum repo tem testes de aceite com tela.
2. `run prove --repo <repo>` em cada repo, a API antes do front: prova que a receita funciona
   nesta máquina.
3. Em cada repo, crie a branch do setup (seção 5, passos 1 a 3) e rode
   `run ensure-settings --repo <repo>` nela. Com `changed: true`, o repo ainda não declarava o
   plugin: crie o work item (seção 5, passo 4) e siga a seção 10 (PR). Sem mudança, volte para a
   branch anotada.
4. Com mais de um repo, `run ensure-settings` também na pasta de trabalho: é o que faz a sessão
   aberta nela ter a factory. Esse arquivo é só desta máquina; não vai para o git.

Mostre o resultado. Fora o caso do passo 3, não commite nada.

## 3. Azure DevOps

**Do projeto, uma vez:** `ado setup check` mostra os estados que faltam e a configuração do time.

- **Estados que faltam:** `ado setup apply --only states`. Exige admin da organização.
  - `states.process.sharedWith` lista os outros projetos que usam o mesmo processo. Com algum
    ali, o script se recusa, porque os estados apareceriam neles também. Quem decide é o admin da
    organização: estados para todos os projetos do processo (`ado setup apply --only states
    --shared`, só com o OK explícito dele) ou um processo próprio para o projeto
    (`docs/ADMIN.md`, seção 1).
  - Se falhar por permissão, processo de sistema ou processo compartilhado, mostre o passo a passo
    de `${CLAUDE_PLUGIN_ROOT}/docs/ADMIN.md` e siga com o resto.
- **Time:** `team.ok: false` quer dizer que os bugs não aparecem no board junto com as histórias.
  Diga o que muda e, com o OK, `ado setup apply --only team`. Se o time não existe (`team.error`),
  pergunte o nome e grave em `"ado": { "team": "<nome>" }` no `.factory/project.json` de cada
  repo.
- **Itens manuais** que o `setup check` lista em `manual`: mostre ao final, com quem faz.

**De cada repo:** `ado setup check --repo <repo>` mostra também as branches e as policies que
faltam.

- **Branches que faltam** (develop e QA saem da branch padrão):
  - liste quais serão criadas e espere o OK;
  - rode `ado setup apply --only branches --repo <repo>`;
  - num repo novo, isso acontece depois do commit inicial (seção 4).
- **Policies:** só no fim (seção 10).

## 4. Repo novo

1. Crie na `main`:
   - um `README.md` curto com o nome do produto e o papel deste repo;
   - o `.gitignore` com o bloco de `${CLAUDE_SKILL_DIR}/templates/gitignore.txt`;
   - o bloco da factory no `CLAUDE.md` (`${CLAUDE_SKILL_DIR}/templates/claude-block.md`);
   - o `.claude/settings.json` com a declaração do plugin: `run ensure-settings`.
2. Commit `chore: início do projeto` e push da `main`. Confirme antes de fazer o push.
3. `ado setup apply --only branches --repo <repo>`.
4. `ado setup apply --only policies --repo <repo>` (seção 10, passo 3).
5. Termine dizendo: "o PO já pode rodar `/prd`; o primeiro PRD de cada repo é a fundação, e ela
   cria o esqueleto, a receita de execução e os docs do sistema".

## 5. Branch de trabalho (repo com código)

Tudo daqui até a PR acontece nesta branch, com o código da develop.

1. **Árvore limpa.** `git status --porcelain` precisa sair vazio. Se não sair, mostre o que está
   pendente e pare esse repo: são mudanças de alguém, e a factory não as leva nem as descarta.
2. Anote a branch atual (`git rev-parse --abbrev-ref HEAD`), para dizer no fim como voltar.
3. `git fetch origin` e, conforme o caso:
   - primeira vez: `git switch -c chore/factory-setup origin/develop`;
   - a branch já existe no origin (setup retomado, PR aberta): `git switch -c chore/factory-setup --track origin/chore/factory-setup`;
   - já existe local: `git switch chore/factory-setup`.
4. **Work item do setup**, que nasce em New para não aparecer na fila do dev. Os commits citam o
   número dele:
   `ado wi create --type feature --title "Factory: setup do <repo>" --state new --tags "factory-setup; repo:<repo>" --key factory-setup-<repo>-<AAAAMMDD>`.
   Com a data na chave, um setup retomado no mesmo dia acha o mesmo item, e um setup de outro
   dia não reaproveita um item já fechado.

## 6. Migração da factory antiga (se houver)

Primeiro de tudo, porque ela decide o que os passos seguintes ainda precisam fazer. Com OK
explícito para cada bloco:

1. **Tag de arquivo:** `git tag factory-v1-arquivo origin/develop`, e `git push origin factory-v1-arquivo`.
   Tudo o que sai a seguir continua nela.
2. **Docs:** os overviews viram a memória do sistema.
   - crie a pasta `docs/system/` (o `git mv` não cria a pasta de destino);
   - `git mv docs/overviews/product-overview.md docs/system/product.md`;
   - `git mv docs/overviews/architecture-overview.md docs/system/architecture.md`;
   - troque o cabeçalho pelo dos modelos e confira os commits desde a última atualização deles.
     O `revisado-até` é `git rev-parse origin/develop`, nunca um commit desta branch: a PR entra
     por squash, e os commits dela não chegam à develop.
3. **Remova:**
   - `docs/epics/`, `docs/proposals/` e `docs/wiki/`;
   - `.claude/hooks/`, `.claude/adapters/`, `.claude/rules/factory/` e `.claude/workflows/`;
   - as skills que a factory antiga instalou em `.claude/skills/` (`blueprint`, `bug`, `close`,
     `code`, `design`, `ground`, `promote`, `propose`, `setup`, `sync`, `tasks`, `vision`).
     Enquanto elas existem, o `/setup` antigo concorre com este;
   - os agentes que a factory antiga instalou em `.claude/agents/` e a memória deles em
     `.claude/agent-memory/`;
   - `.claude/README.md`, `.claude/factory-process.md`, `.claude/kanban-config.json` e
     `.claude/build-run.md`;
   - em `.claude/settings.json`, só a chave `hooks`.

   Fica o que não é da factory: skills e agentes do próprio time, `.claude/launch.json` e
   `.claude/settings.local.json`. Pastas que não vão para o git (`.claude/worktrees/`,
   `.claude/.factory/`) cada pessoa apaga na própria máquina; diga isso ao time.
4. **`CLAUDE.md`:** troque o bloco da factory antiga pelo de `templates/claude-block.md`. Se o
   arquivo inteiro é da factory antiga, sem nada do projeto, ele vira só o bloco novo.
5. Commit `chore(factory): remove a factory antiga #<id>`, com `git add` de cada caminho.
6. **Board:** diga ao PO para rodar `/prd migrar` (uma vez, na pasta de trabalho), depois que esta
   PR entrar. As Features antigas viram a ideia, com um PRD por repo debaixo de cada uma.
7. **Branch QA que já existe:** continua sendo usada.

## 7. Docs do sistema (só se `docs/system/` ainda faltar)

Repo que veio da factory antiga já ganhou os docs na seção 6. Para os outros:

1. Divida o código em áreas (módulos, serviços, telas).
2. Lance em paralelo um agente `scanner` da factory por área. Cada um devolve capacidades e
   regras de arquitetura, com evidência.
3. Escreva `docs/system/product.md` e `docs/system/architecture.md` a partir dos modelos em
   `${CLAUDE_SKILL_DIR}/templates/`. O `revisado-até` é `git rev-parse origin/develop`. Com mais
   de um repo, cada um descreve a sua parte e diz com quem conversa (o front cita as rotas da API
   que usa; a API cita quem a consome).
4. Commit `docs(factory): memória do sistema #<id>`. Diga ao dev que a revisão desses docs
   acontece na PR do setup.

## 8. Receita de execução

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
     "ado": { "taskType": "<tipo de task do time para este repo, se não for Task>" },
     "run": {
       "install": "...", "build": "...", "test": "...",
       "start": "... usando $PORT ...", "ready": "http://localhost:$PORT/<rota que responde>",
       "baseUrl": "http://localhost:$PORT",
       "e2e": "npx playwright test", "e2eReport": "test-results/results.json",
       "testReport": "<caminho do JUnit XML, se o framework gerar>",
       "services": [{ "repo": "<repo que precisa estar de pé>", "env": "<variável com a URL dele>", "vars": { "<variável do vizinho>": "$APP_URL" } }]
     }
   }
   ```

3. **O `start` tem de aceitar porta própria** (`$PORT`), para dois runs subirem lado a lado.
   Pergunte como o banco funciona nos testes (em memória, container por run, banco compartilhado)
   e registre o risco se for compartilhado.
4. **Serviços de outros repos.** Pergunte se os testes de aceite deste repo precisam de outro
   repo de pé (o front precisa da API). Se sim, `services` lista cada um:
   - `repo` é o nome do repo vizinho, clonado na mesma pasta de trabalho;
   - `env` é a variável em que este app lê a URL dele (por exemplo `API_URL`). O app e os testes
     a recebem no ambiente, e `$API_URL` também é trocado no texto dos comandos;
   - `vars` (opcional) são variáveis para o processo do vizinho, e `$APP_URL` e `$APP_PORT` nelas
     viram o endereço deste app, reservado antes de o vizinho subir. É o caso do CORS: uma API
     ASP.NET que lê as origens de `Cors:AllowedOrigins` recebe
     `"vars": { "Cors__AllowedOrigins__0": "$APP_URL" }`;
   - o `run` sobe o vizinho pela receita dele, a partir da branch da trilha no origin. Por isso a
     receita do vizinho precisa estar na develop dele antes: configure a API primeiro.
5. **Tipo de task.** Pergunte qual tipo de work item o time usa para registrar horas de trabalho
   neste repo (por exemplo `Backend` na API e `Frontend` no front). Se não for `Task`, grave em
   `ado.taskType`; o `doctor` confere se o tipo existe.
6. **A receita é uma só para Windows, macOS e Linux.** No Windows os comandos rodam no cmd.exe;
   nos outros, no sh.
   - Prefira scripts do próprio projeto (`npm run`, `dotnet`, `make`) e ferramentas que funcionam
     nos dois.
   - Evite sintaxe de um shell só, como `VAR=x comando` ou `rm -rf`.
   - Variável fixa que os comandos precisam (por exemplo `BROWSER=none`, para o Create React App
     não abrir o navegador) vai em `run.env`: `"env": { "BROWSER": "none" }`. Ela chega a todos os
     comandos da receita, com `$PORT` e `$BASE_URL` trocados.
   - O app recebe `PORT` e `BASE_URL` como variáveis de ambiente, e `$PORT` e `$BASE_URL` também
     são trocados no texto do comando.
   - Quando um comando precisa ser diferente, use `run.win32` ou `run.posix` só com as chaves que
     mudam, por exemplo `"win32": { "start": "..." }`.
7. **Repo sem tela** (job, CLI, biblioteca): `install` e `test` bastam. `start`, `ready` e
   `e2e` só existem quando há app para subir.
8. **Confirme a receita com a pessoa**, grave em `.factory/project.json` e rode `run prove`.
   - Falhou: leia o log indicado, corrija a receita e rode de novo.
   - Falhou no passo `services` porque a receita do vizinho ainda não está na develop dele: siga;
     o front prova os testes de aceite depois que a PR do setup da API entrar.
   - Não conseguiu em 3 tentativas: mostre o erro e peça ajuda à pessoa.
9. Commit `chore(factory): receita de execução #<id>`.

## 9. Playwright (repo com tela)

Se não houver Playwright:

1. Proponha `@playwright/test` como dependência de desenvolvimento. Num repo que não é Node,
   ele vai num `tests/e2e/package.json` próprio.
2. Copie o `playwright.config.ts` e o `smoke.spec.ts` de `${CLAUDE_SKILL_DIR}/templates/`.
3. Ajuste a receita: `e2e`, `e2eReport`.
4. Rode `npx playwright install chromium` e `run prove`.
5. Commit `test(factory): testes de aceite com Playwright #<id>`.

Repo sem tela (API, job): os testes de aceite usam o framework de testes do repo, e `e2e` pode
ficar de fora da receita.

## 10. Fechamento (em cada repo)

1. **Arquivos da factory no repo**, se faltarem:
   - o bloco no `CLAUDE.md` e no `.gitignore`, pelos modelos;
   - a declaração do plugin no `.claude/settings.json`: `run ensure-settings`.
     - Ele acrescenta o marketplace `factory-marketplace` (com auto-update) e o plugin
       `factory@factory-marketplace`, preserva o resto do arquivo e tira as entradas da factory
       antiga.
     - Com isso, quem abrir o repo e confiar na pasta recebe a factory sem digitar comando.
       Diga isso ao time.
2. Commit `chore(factory): arquivos da factory #<id>`, com `git add` de cada caminho.
3. **Policies antes da PR:** `ado setup apply --only policies --repo <repo>`. Assim a PR do setup
   também precisa de aprovação humana, como qualquer outra. Exige Project Administrator; se
   falhar por permissão, diga quem precisa rodar e siga.
4. **PR**, se a branch tem algum commit em relação à `origin/develop`
   (`git log --oneline origin/develop..HEAD`):
   - `git push -u origin chore/factory-setup`;
   - `ado pr create --source chore/factory-setup --target develop --title "Factory: setup do <repo>" --description-file <resumo> --wi <id> --on-merge integrated --merge squash --delete-source`.
   - Sem nenhum commit, não há PR: mova o work item do setup para Removed
     (`ado wi state --id <id> --to removed`).
5. `ado doctor --for deliver --repo <repo>` e mostre a lista final.
6. Diga como voltar à branch de antes (`git switch <branch anotada na seção 5>`), e que o clone
   fica na `chore/factory-setup` até lá.

Depois do último repo, diga o que ficou para outra pessoa (estados, time, itens manuais) e o que
vem agora: o PO roda `/prd` na pasta de trabalho, o dev roda `/deliver`.

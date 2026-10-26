# Configuração do admin (uma vez por organização e por projeto)

O `/setup` tenta fazer tudo isto sozinho quando quem roda tem permissão. Este guia é para quando
não tem, ou para conferir à mão.

## 1. O processo do projeto

A factory precisa dos estados dela em **User Story** e em **Bug**. Estados ficam no processo, e
um processo vale para todos os projetos que o usam. Por isso, primeiro descubra a situação:

Organization settings → Boards → Process: veja qual processo o projeto usa e quantos projetos
usam o mesmo.

- **Processo de sistema** (Agile, Scrum, CMMI): não aceita estados. Crie um herdado (seção 1.1).
- **Processo herdado só deste projeto:** acrescente os estados nele (seção 1.2).
- **Processo herdado compartilhado com outros projetos:** a decisão é do admin.
  - **Estados para todos os projetos do processo**, mesmo os que ainda não usam a factory: eles
    aparecem nas listas de estado, mas nenhum item muda, e cada time só cria as colunas quando
    adotar a factory. Acrescente os estados no próprio processo (seção 1.2). Pelo script, isso
    pede `ado setup apply --only states --shared`: sem o `--shared`, ele se recusa.
  - **Só este projeto:** crie um processo próprio com as mesmas customizações (seção 1.1) e
    acrescente os estados nele.

### 1.1 Processo novo

1. No card do processo de sistema de base (normalmente **Agile**), ⋯ → Create inherited process,
   com o nome do projeto (por exemplo "Loja-Factory").
2. **Se o projeto vinha de um processo herdado**, refaça nele as customizações daquele processo
   antes de trocar: os tipos de work item customizados (por exemplo os tipos de task `Backend` e
   `Frontend`), os campos, os estados e as regras. Compare tipo a tipo. Um item de um tipo que o
   processo novo não tem não migra.
3. Acrescente os estados da seção 1.2.
4. Project settings → Overview → Process → mude o projeto para o processo novo.

### 1.2 Estados da factory

Em **User Story** e em **Bug** → States, crie, com os nomes exatos:

| Estado | Categoria | Cor | Quando o item chega nele |
| --- | --- | --- | --- |
| Ready | Proposed | `B2B2B2` | o PO aprovou o PRD |
| Executing | In Progress | `007ACC` | um dev pegou o item |
| Reviewing | In Progress | `FF9D00` | a PR foi aberta |
| Integrated | In Progress | `5688E0` | a PR entrou na develop |
| Validating | In Progress | `773B93` | entrou na QA, e o PO está validando |

- New, Closed e Removed já existem.
- Active e Resolved só podem ser ocultados quando nenhum item estiver neles.
- Os nomes são em inglês, a pedido do admin da organização, e de uma palavra só de propósito: a
  descrição da PR usa `<Estado> #<id>` para mover o item no merge.
- Integrated e Validating ficam em "In Progress" de propósito, porque o Azure DevOps não leva
  a Closed um item que está em Resolved.
- Projeto que precise de outros nomes grava a troca em `"states"` no `.factory/project.json`
  (por exemplo `"review": "Revision"`).
- A **Feature** (que reúne os PRDs de uma ideia que toca mais de um repo) não ganha estados: a
  factory não mexe nela.

### 1.3 Tipos de task e horas

A factory registra as horas que as pessoas declaram em tasks filhas de cada PRD: uma
"Especificação (PO)" e uma "Desenvolvimento (dev)".

- A do PO usa o tipo **Task**.
- A do dev usa o tipo de task de cada repo (`ado.taskType` no `.factory/project.json`, por
  exemplo `Backend` na API e `Frontend` no front), ou Task.
- Todo tipo usado precisa ter os campos **Completed Work** e **Remaining Work** no layout. Tipo
  customizado criado do zero pode não ter: acrescente os dois em Process → (tipo) → Layout →
  New field → Use an existing field. O `doctor` confere.

## 2. O time e o board

### 2.1 Configurações do time

Project settings → Teams → (time) → ou Boards → Board → configurações:

- **Working with bugs:** "Bugs are managed with requirements". Assim os bugs aparecem no board
  com os mesmos estados das histórias. O `/setup` faz isso com `ado setup apply --only team`.
- **Sprints:** o time precisa ter as iterações configuradas (Project settings → Team
  configuration → Iterations). O `/deliver` põe o PRD na sprint atual ao reservar, e as tasks de
  horas nascem nela. Sem sprint atual, o item fica onde está.
- **Regras de automação:** em **Boards → Backlogs**, escolha o nível **Stories**, engrenagem
  **Configure team settings**, aba **Rules**, e deixe as três regras desmarcadas:
  - *Update parent status to Active when a child status is active*;
  - *Update parent status to Resolved when all child statuses are Resolved or Completed*;
  - *Update parent status to Closed when all child statuses are Closed or Completed*.

  Repita no nível **Features**: cada nível tem as próprias regras. Elas só disparam quando alguém
  muda o estado pelo board, pelo backlog ou pela sprint, não pela API que a factory usa; mesmo
  assim, uma task de horas arrastada na sprint não pode mover o PRD. Quem move o PRD é a factory
  e o merge.
- **Nome do time:** a factory usa `<projeto> Team`. Se for outro, grave em
  `"ado": { "team": "<nome>" }` no `.factory/project.json` de cada repo.

### 2.2 Colunas do board

Boards → Board → configurações → Columns, no board de histórias. Mapeie **cada** estado a uma
coluna, com o nome que as pessoas leem. Estado sem coluna some do board, e os itens nele ficam
invisíveis ali.

Com os bugs no board, cada coluna mapeia o estado da User Story e o do Bug:

| Coluna | Estado (User Story e Bug) |
| --- | --- |
| Draft | New |
| Ready for Dev | Ready |
| In Progress | Executing |
| In Review | Reviewing |
| Integrated | Integrated |
| In QA | Validating |
| Done | Closed |

Projeto que já tem itens em Active ou Resolved ganha uma coluna para cada, como "Active (legacy)"
e "Resolved (legacy)", até o time esvaziá-las.

Se o time quiser marcar o que o PO já validou, divida a coluna "In QA" em Doing e Done. O PO
arrasta o item ao validar. A factory não lê essa divisão.

O board de Features continua do jeito do time: confira só que todo estado de Feature em uso tem
coluna, para nenhuma ideia sumir.

## 3. Configurações de cada repositório

Project settings → Repositories → (repo) → Settings, em cada repo que entra na factory:

- **Commit mention linking:** ligado.
- **Commit mention work item resolution:** ligado.

## 4. Branch policies (o `/setup` aplica com Project Administrator)

Em `develop`, `QA` e `main` de cada repo:

- **Minimum number of reviewers:**
  - 1 aprovador;
  - "Allow requestors to approve their own changes" ligado, porque o próprio dev pode aprovar;
  - "Reset votes on new push" ligado.
- **Check for linked work items:** obrigatório.
- **Check for comment resolution:** obrigatório.
- **Build validation:** quando o repo tem pipeline. A fundação de um repo novo cria o pipeline.

Quem quiser revisão por outra pessoa num projeto específico sobe para 2 aprovadores ou desliga a
autoaprovação ali.

## 5. Permissões

- PO e devs com acesso **Basic** e no grupo **Contributors** do projeto.
- Quem roda `/release tag` precisa da permissão **Create tag** nos repos.
- Quem roda `/setup` pela primeira vez num projeto precisa ser **Project Administrator**, para
  aplicar as policies e a configuração do time.

## 6. Prova da transição de estado (uma vez)

Depois de criar os estados, confirme que o merge move o item:

1. Crie um item de teste em Ready e uma branch `teste/factory` com um commit qualquer.
2. Abra uma PR para a develop com `Integrated #<id>` na descrição, linkada ao item, e complete-a
   com "Complete linked work items after merging" ligado.
3. Confira se o item foi para **Integrated**.
4. Repita com uma PR para a QA (`Validating #<id>`) e depois para a main (`Closed #<id>`).
5. Apague a branch e o item de teste.

Se alguma transição não acontecer, anote qual e o que o item mostrou no histórico. Essa é a
única parte do fluxo que depende de um comportamento do Azure DevOps que a factory não controla.

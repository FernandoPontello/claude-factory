# Configuração do admin (uma vez por organização)

O `/setup` tenta fazer tudo isto sozinho quando quem roda tem permissão. Este guia é para quando
não tem, ou para conferir à mão.

## 1. Processo "Factory"

Um processo herdado único para todos os projetos que usam a factory, com base **Agile**.

1. Organization settings → Boards → Process.
2. Se a organização já tem o processo "Factory" da versão anterior, use-o. Se não, no card
   **Agile**, use ⋯ → Create inherited process → "Factory".
3. Em **User Story** e em **Bug** → States, crie:

   | Estado | Categoria |
   | --- | --- |
   | Ready | Proposed |
   | Executando | In progress |
   | Revisao | In progress |
   | Integrado | In progress |
   | Homologando | In progress |

   - New, Closed e Removed já existem.
   - Active e Resolved só podem ser ocultados quando nenhum item estiver neles.
   - Os nomes são de uma palavra e sem acento de propósito: a descrição da PR usa
     `<Estado> #<id>` para mover o item no merge.
   - Integrado e Homologando ficam em "In progress" de propósito, porque o Azure DevOps não leva
     a Closed um item que está em Resolved.
4. Em cada projeto: Project settings → Overview → Process → mude para "Factory".

## 2. Colunas do board (por time)

Boards → Board → configurações → Columns. Mapeie cada coluna a um estado, com o nome que as
pessoas leem:

| Coluna | Estado |
| --- | --- |
| Rascunho | New |
| Pronto para dev | Ready |
| Em execução | Executando |
| Em revisão | Revisao |
| Integrado | Integrado |
| Em homologação | Homologando |
| Concluído | Closed |

Se o time quiser marcar o que o PO já validou, divida a coluna "Em homologação" em fazendo e
feito. O PO arrasta o item ao validar. A factory não lê essa divisão.

## 3. Configurações do repositório

Project settings → Repositories → (repo) → Settings:

- **Commit mention linking:** ligado.
- **Commit mention work item resolution:** ligado.

## 4. Branch policies (o `/setup` aplica com Project Administrator)

Em `develop`, `QA` e `main`:

- **Minimum number of reviewers:**
  - 1 aprovador;
  - "Allow requestors to approve their own changes" ligado, porque o próprio dev pode aprovar;
  - "Reset votes on new push" ligado.
- **Check for linked work items:** obrigatório.
- **Check for comment resolution:** obrigatório.
- **Build validation:** quando o projeto tem pipeline. A fundação de um projeto novo cria o
  pipeline.

Quem quiser revisão por outra pessoa num projeto específico sobe para 2 aprovadores ou desliga a
autoaprovação ali.

## 5. Permissões

- PO e devs com acesso **Basic** e no grupo **Contributors** do projeto.
- Quem roda `/release tag` precisa da permissão **Create tag** no repo.
- Quem roda `/setup` pela primeira vez num projeto precisa ser **Project Administrator**, para
  aplicar as policies.

## 6. Prova da transição de estado (uma vez)

Depois de criar os estados, confirme que o merge move o item:

1. Crie um item de teste em Ready e uma branch `teste/factory` com um commit qualquer.
2. Abra uma PR para a develop com `Integrado #<id>` na descrição, linkada ao item, e complete-a
   com "Complete linked work items after merging" ligado.
3. Confira se o item foi para **Integrado**.
4. Repita com uma PR para a QA (`Homologando #<id>`) e depois para a main (`Closed #<id>`).
5. Apague a branch e o item de teste.

Se alguma transição não acontecer, anote qual e o que o item mostrou no histórico. Essa é a
única parte do fluxo que depende de um comportamento do Azure DevOps que a factory não controla.

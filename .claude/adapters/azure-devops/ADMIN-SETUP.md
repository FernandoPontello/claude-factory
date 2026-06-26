# Configuração do Azure DevOps para a Claude Factory

Guia auto-contido para o **administrador da organização** no Azure DevOps. O admin não
precisa conhecer a factory — basta seguir os passos na UI. Reutilizável para qualquer
projeto novo que vá rodar a factory sobre Azure DevOps.

---

## Contexto (para o administrador)

Vamos rodar uma ferramenta que usa o board do Azure DevOps como projeção do trabalho de
desenvolvimento. Ela exige uma configuração específica de **processo de work item** que não
existe nos processos de fábrica — por isso o pedido. A ferramenta **não cria nem altera
processos por conta própria** (a API/MCP do Azure DevOps não permite isso); ela apenas
**valida** que a configuração abaixo existe e falha se algo estiver diferente. Por isso
preciso que esses passos sejam feitos exatamente como descrito.

São 5 passos, todos na UI do Azure DevOps. Estimativa: ~15 minutos. Requer permissão de
**Project Collection Administrator / Organization Owner**.

> Observação: os nomes de menu podem variar levemente conforme a versão da UI. Onde houver
> dúvida, o caminho lógico é o que vale.

---

## Passo 1 — (Condicional) Habilitar acesso OAuth de aplicações de terceiros

O caminho de conexão atual é **local, via Azure CLI** — um cliente de primeira parte da
Microsoft, que **normalmente não exige** este toggle. Habilite-o apenas se for usar o servidor
**remoto** ou um app OAuth de terceiros (caminho futuro). Habilitar é inócuo e prepara esse
caminho — se tiver dúvida, pode habilitar.

1. **Organization settings** (engrenagem no canto inferior esquerdo) → **Policies** (em
   algumas versões: **Security → Policies**).
2. Ative o toggle **"Third-party application access via OAuth"** → **On**.

---

## Passo 2 — Criar o processo herdado "Factory" (base **Agile**)

> **A base precisa ser Agile** (não Basic, não Scrum). O Agile traz nativamente a hierarquia
> **Epic → Feature → User Story** — a ferramenta cria cada item de trabalho como uma **User
> Story** filha da Feature (nível-requisito, visível no board e no backlog). Não é preciso
> nenhum campo de tempo: o tempo é registrado como comentário.

1. **Organization settings** → **Boards** → **Process**.
2. Na lista de processos, passe o mouse sobre **Agile** → menu **⋯** → **Create inherited
   process**.
3. Nome: **`Factory`** → **Create**.

### 2.1 — Customizar os estados do work item type **Feature**

> ⚠️ **Customize APENAS o work item type `Feature`.** Não altere `Epic` nem `Task` — eles
> ficam como vêm do Agile.

1. Clique no processo **Factory** → na lista de **Work item types**, clique em **Feature** →
   aba **States**.
2. A Feature precisa ficar **exatamente** com estes 6 estados visíveis. Use **+ New state**
   para criar os que faltam (escolhendo a *State category* indicada) e o menu
   **⋯ → Hide** para ocultar os que sobram:

| Estado (nome exato) | State category | Ação |
|---|---|---|
| `Ready` | **Proposed** | criar |
| `Design` | **In Progress** | criar |
| `In Progress` | **In Progress** | criar |
| `Review` | **In Progress** | criar |
| `Done` | **Resolved** | criar |
| `Closed` | Completed | já existe — **manter** |
| ~~New~~ | Proposed | **ocultar (Hide)** |
| ~~Active~~ | In Progress | **ocultar (Hide)** |
| ~~Resolved~~ | Resolved | **ocultar (Hide)** |

> 🔴 **Os nomes são string exata — maiúsculas, minúsculas e espaços contam.** "In Progress"
> (com espaço), não "InProgress". Um nome errado não dá erro na configuração, mas quebra a
> ferramenta depois e é difícil de diagnosticar.
>
> 💡 Por que ocultar `New`: com `New` oculto e `Ready` na categoria *Proposed*, toda Feature
> nova **nasce direto em `Ready`** — que é exatamente o que a ferramenta espera.

### 2.2 — Campos personalizados

**Nenhum.** A ferramenta usa apenas campos que o Agile já fornece (incluindo `Completed
Work` na Task) e tags dinâmicas. Não é preciso criar campo nenhum.

---

## Passo 3 — Vincular o projeto ao processo "Factory"

**Caso A — projeto novo (recomendado, isola o teste):**
1. Home da organização → **+ New project**.
2. Nome do projeto, Visibility = **Private**.
3. Expanda **Advanced** → em **Work item process**, selecione **Factory** → **Create**.

**Caso B — projeto existente:**
1. **Organization settings** → **Boards** → **Process** → clique no processo **atual** do
   projeto (provavelmente **Agile**) → aba **Projects**.
2. Localize o projeto → menu **⋯** → **Change process** → selecione **Factory** → confirme.

> ⚠️ Se o projeto existente estiver hoje em **Basic** ou **Scrum**, a migração para Factory
> (que é Agile) envolve mapeamento de tipos de work item e tem ressalvas. Nesse caso, é mais
> seguro **criar um projeto novo** (Caso A).

---

## Passo 4 — (Opcional) Criar a Wiki do projeto

Só se formos publicar documentação na Wiki nativa do Azure DevOps. (Se não, ignore.)

1. No projeto → **Overview** → **Wiki** → **Create project wiki**.

---

## Passo 5 — Garantir acesso do(s) operador(es)

Para a(s) conta(s) que vão operar a ferramenta:

1. **Organization settings** → **Users** → **Add users** → adicione o e-mail com
   **Access level = Basic**.
2. No projeto → **Project settings** → **Permissions** → adicione a conta ao grupo
   **Contributors** (permite criar/editar work items e editar a wiki).

---

## ✅ O que reportar de volta ao operador

- [ ] **Nome da organização** (o `<org>` da URL `dev.azure.com/<org>`): ________
- [ ] **Nome exato do projeto**: ________
- [ ] Processo **Factory** criado, base **Agile**, e a **Feature** com os 6 estados exatos
      do Passo 2.1 (e `New`/`Active`/`Resolved` ocultos)
- [ ] Projeto vinculado ao processo **Factory** (Passo 3)
- [ ] (Só se for usar o servidor remoto/futuro) Policy **"Third-party application access via OAuth"** habilitada (Passo 1)
- [ ] Conta(s) operadora(s) com acesso **Basic** + **Contributors** no projeto (Passo 5)
- [ ] (Se aplicável) Wiki do projeto criada (Passo 4)

Depois disso, a conexão e a autenticação são feitas na máquina do operador — nada mais é
necessário do lado do administrador.

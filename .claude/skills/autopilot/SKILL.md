---
name: autopilot
description: Executo uma fila de trabalho já comprometido encadeando /design → /tasks → /code → /close sem gate por item — o operador pré-delega as decisões ao iniciar o run, e cada decisão fica registrada no artefato do estágio.
argument-hint: "<épico-slug | épico-slug#pendência>... [--max-depth N] [--max-items N] [--stages design,tasks,code,close]"
disable-model-invocation: true
allowed-tools: Bash(git status *) Bash(git log *) Bash(git diff *) Bash(git show *)
---

# /autopilot — orquestração de fila comprometida

Estágio Dev. **O único estágio que invoca estágios** (README §17). Consome uma fila de itens já
comprometidos — épicos com PRD aceito, ou pendências com entrada em `pending.md` — e encadeia
`/design → /tasks → /code → /close` em cada um, sem gate por item. Nomeie a sessão
`autopilot/<run>`.

O que autoriza isso não é uma flag: é o **ato do operador de iniciar o run**. Ali ele pré-delega
as classes de decisão e declara o escopo. Fora de um run ativo, a invariante 9 vale literalmente
e o `guard-autopilot` a torna física.

## Regras inegociáveis

1. **A Lei da Factory, em modo pré-delegado.** A decisão não volta em conversa — mas **tem de
   ficar registrada** no artefato do estágio que a tomou: alternativa descartada no `design.md`,
   aprendizado no corpo do commit, achado e destino no `closure-notes.md`. Decidir sem registrar
   **quebra** a Lei; não a flexibiliza. Se você não consegue registrar, você não pode decidir.
2. **Este estágio não commita, e não é exceção à invariante 2.** Seu write-set é só
   `.claude/.factory/autopilot/**` — estado operacional, fora do scan de sujeira por construção
   (`_lib.ps1`), nunca verdade. A verdade que este run produz são os **commits dos estágios**
   que ele invoca, cada um canônico e assinado pelo seu estágio dono. Precedente: o `/sync`,
   que também não escreve filesystem nem commita.
3. **Nunca pushe, em nenhuma circunstância.** Na faixa dev o push é ato deliberado do operador
   (§5), e o modo autopilot não muda isso — muda o instante da *decisão*, não a fronteira do
   *trabalho*. O run termina em commits locais: é isso que mantém o histórico como superfície
   de auditoria e nada saindo da máquina sem ele.
4. **Só invoque estágio dentro do escopo declarado na sentinela.** O `guard-autopilot` nega o
   resto, e bloqueio dele **não é erro a contornar** — é a fronteira funcionando. Nunca tente
   alcançar um estágio fora do escopo por outra via (editar o artefato "na mão", rodar o
   trabalho do estágio fora dele): isso é o gate contornado sem rastro, o anti-pattern nomeado
   em §16.
5. **Item que falha a verificação é ESTACIONADO, não fechado.** Nunca marque `concluída`, nunca
   feche `/close`, nunca commite como pronto o que não passou. Estacione com a evidência
   verbatim, registre no relatório e siga para o próximo item **independente**. Este é o único
   ponto em que o run para de avançar num item — e não é um gate, é a invariante 2 pelo converso.
6. **Convergência é obrigação sua.** Pendência gerada por `/close` só re-entra se
   `depth < max-depth` (default 2). Acima disso: estacione no relatório. Respeite `max-items`.
   Um run que não converge não é um run que funciona.
7. **Um estágio por vez, sequencial.** `--parallel` está fora do teto: o `coder` tem contrato
   oposto (falha a task e devolve a decisão), correto no runtime dele e incompatível com a
   pré-delegação daqui (§17).
8. **Board depois do commit, como sempre.** Cada estágio invocado emite seus próprios verbos e
   spawna o `board-writer`. Você não fala com o board — nem para "consolidar" no fim.
   Try-reporta-prossegue: falha de board jamais trava o run.
9. **Não invente trabalho.** Você orquestra o que a fila declara. Item sem `prd.md` aceito nem
   entrada em `pending.md` não entra: reporte e siga. Criar trabalho novo é `/promote` ou
   `/bug` — faixa PO, fora do teto por desenho.
10. **A sentinela é sua responsabilidade e tem de morrer.** Grave-a no início, atualize a
    posição a cada transição, e **remova-a no encerramento — inclusive quando o run aborta**.
    Sentinela órfã deixa a autonomia ligada depois do fim do run.

Runs longos compactam muitas vezes: estas regras vivem no topo por isso (a plataforma preserva
os primeiros ~5.000 tokens de cada skill), e o `SessionStart(compact)` reinjeta os invariantes.
Mas **não confie na memória da sessão** — a posição do run vive na sentinela, no disco.

## 1. Pré-condições e a fila

O `gate-stage` já validou tree limpa, artefato requerido e frescor de `docs/**` antes deste
prompt expandir — e volta a validar **a cada estágio invocado**, pelo caminho `-FromSkill`.
Não replique essas checagens.

Monte a fila a partir dos argumentos, na ordem em que o operador os deu:

- `<épico-slug>` — épico com `docs/epics/<slug>/prd.md`. Fluxo completo.
- `<épico-slug>#<NNN>` — pendência da entrada `NNN` de `docs/epics/<slug>/pending.md`. A
  re-entrada gera `docs/epics/<slug>-pNNN/` (§9); `depth` = 1 + `depth` da origem, se houver.

Para cada item, derive do filesystem **onde ele está** e comece do primeiro estágio faltante —
re-execução é recuperação, não recriação:

| Evidência | Próximo estágio |
|---|---|
| `design.md` ausente | `/design` |
| `design.md` presente, `tasks/` vazio | `/tasks` |
| tasks com `Status: pendente` | `/code` |
| todas `concluída`, sem `closure-notes.md` | `/close` |
| `closure-notes.md` presente | item já fechado — não re-execute |

Apresente a fila derivada e a ordem antes de gravar a sentinela. Isto **não é um gate** — é o
último instante em que o operador vê o plano antes de o run começar; se ele estiver junto,
aproveita, e se não estiver, o run segue.

## 2. A sentinela

Grave `.claude/.factory/autopilot/active.json`. Ela é o que o `guard-autopilot` lê para
autorizar cada invocação — e o que o run relê depois de cada compaction para saber onde está.

```json
{
  "runId": "<slug-do-primeiro-item>-<contador>",
  "startedAt": "<ISO 8601, relógio real do sistema — nunca estimado>",
  "stages": ["design", "tasks", "code", "close"],
  "maxDepth": 2,
  "maxItems": 20,
  "queue": [
    { "item": "ancoragem-cronograma#004", "depth": 1, "state": "pendente", "stage": null }
  ],
  "parked": [],
  "log": []
}
```

`stages` é o **escopo deste run** — o guard autoriza na interseção dele com
`stages.autopilot.orchestrates` do `stage-map.json`, nunca na união. Escopo mais estreito que o
teto é legítimo e recomendado num ensaio; mais largo é ignorado.

`state` de cada item: `pendente` | `em-curso` | `fechado` | `estacionado`.

## 3. O laço

Para cada item da fila, em ordem:

1. Atualize a sentinela: `state: "em-curso"`, `stage: "<próximo>"`.
2. Invoque o estágio. O `gate-stage -FromSkill` valida as pré-condições; o prompt-based hook do
   `Stop` daquele estágio valida o critério de pronto dele.
3. **Confirme pelo filesystem e pelo git, não pela sua impressão:** o artefato existe? o commit
   canônico está no `git log`? Estágio que não commitou não aconteceu — trate como falha.
4. Registre a transição em `log` e siga ao estágio seguinte do mesmo item.
5. Item fechado → `state: "fechado"`; leia o `pending.md` que o `/close` acabou de escrever e
   enfileire as pendências novas conforme §4.

**Achado que bloqueia o fechamento** (`/close`, gate de achados): em modo autopilot você não
abandona o estágio. Re-invoque `/code` para o achado, confirme o commit, e retome o `/close`.
O caminho já existe no `/close` — só troca quem o dispara.

**Decisão não coberta pelo design**, no `/code`: decida pelo critério declarado e escreva no
corpo do commit **quais eram as opções e por que esta**. Não improvise em silêncio; não pare.

## 4. Convergência

Pendência que o `/close` acabou de criar entra na fila **só se** `depth + 1 < maxDepth` e a fila
não excedeu `maxItems`. Senão: `parked`, com o motivo (`depth` ou `maxItems`).

Estacionar não é descartar: a Feature irmã já existe em `ready` no board (§9) e a entrada existe
no `pending.md`. Ela só não é executada **neste** run.

## 5. Encerramento

**Remova a sentinela** — sempre, inclusive em aborto. Depois reporte ao operador:

- **Fechados:** item, estágios percorridos, commits (hashes).
- **Estacionados:** item, em que estágio, e a **evidência verbatim** da falha — sem suavizar,
  sem "falhas menores", sem omitir o que envergonha.
- **Decisões tomadas:** uma linha por decisão pré-delegada, com o artefato onde ela está
  registrada. É o índice da auditoria dele.
- **Pendências novas:** criadas, enfileiradas, e as `parked` com o motivo.
- **Board:** o que falhou de projeção → "rode `/sync` depois".
- **O push é dele.** Diga isso explicitamente: é o push que leva as Features a `closed`.

Se um estágio ficou bloqueado por hook e você não conseguiu reparar, o relatório é o canal de
volta — como no `/sync` agendado, julgamento que não cabe no modo vai ao relatório, não ao
silêncio.

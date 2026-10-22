# Factory

Fluxo de desenvolvimento com Claude e Azure DevOps. O PO conversa com o Claude e grava PRDs no
board. O dev executa cada PRD numa sessão só: responde as perguntas técnicas uma vez, e o Claude
implementa, testa como um usuário faria, revisa e entrega um relatório com evidências. Depois que
o dev aprova o relatório, a PR vai para o Azure DevOps, onde alguém do time aprova o merge.

O PO diz "subi alguns PRDs no board"; os devs respondem "está pronto na develop"; o PO puxa para
a QA, valida e libera para produção.

## Os quatro comandos

| Comando | Quem roda | O que faz |
| --- | --- | --- |
| `/setup` | quem lidera o projeto, e cada pessoa na própria máquina | deixa máquina e projeto prontos; pode rodar de novo sem risco |
| `/prd` | PO (o dev também pode) | conversa ancorada no código e grava o PRD no board |
| `/deliver` | dev | kickoff, execução automática, relatório e PR |
| `/release` | PO | promove develop → QA e, com a bandeira verde, libera QA → main com tag |

Instalados pelo plugin, os comandos também respondem como `/factory:setup`, `/factory:prd` etc.
A sequência é a mesma em projeto novo e em projeto que já existe: num repo sem código, o `/prd`
conduz a visão do produto e o primeiro PRD é a fundação.

## O roteiro

1. **PO:** `/prd`. O Claude lê o código da `develop`, confronta a ideia com o que o sistema faz
   hoje e monta o dossiê. Os critérios de aceite vêm em Dado/Quando/Então, junto com uma leitura
   técnica preliminar. Com o OK do PO, o item vai para **Ready**.
2. **Dev:** `/deliver`. O Claude reserva o item (**Executando**), cria a branch e faz o
   **kickoff**: o plano e as perguntas técnicas, cada uma com uma recomendação.
3. **Execução:** o Claude trabalha sozinho, sem parar para perguntar:
   - escreve os testes de aceite primeiro;
   - implementa com um commit por task;
   - sobe o app numa porta própria e roda os testes com prints;
   - revisa por cinco lentes e atualiza `docs/system`.
4. **Relatório:** uma parte para o PO (ACs com prints e roteiro de validação) e outra para o dev
   (decisões, mudanças, qualidade). O dev aprova ou pede ajustes no chat.
5. **Entrega:** push, relatório anexado ao item, PR no Azure DevOps (**Revisao**), mais os
   back-merges quando a trilha pede.
6. **Merge:** alguém do time aprova no Azure DevOps. O item muda de estado sozinho:
   - **Integrado** no merge na develop;
   - **Homologando** no merge na QA;
   - **Closed** no merge na main.
7. **QA e produção:** o PO roda `/release`, que promove para a QA. O PO valida e roda `/release`
   de novo para a main. Depois do merge, mais um `/release` cria a tag.

## Branches

| Branch | De quem é | Recebe de |
| --- | --- | --- |
| `develop` | time de dev, para os testes deles | só de `feature/<id>-<slug>` |
| `QA` | PO, onde ele valida e dá a bandeira verde | da `develop` (promoção) e de `bugfix/<id>-<slug>` |
| `main` | produção (a branch padrão do repo) | da `QA` (release com tag) e de `hotfix/<id>-<slug>` |

- Bugfix sai da QA e abre junto a PR de volta para a develop.
- Hotfix sai da main e abre junto as PRs de volta para a QA e para a develop.
- Feature e bugfix entram por squash, então cada PRD é um commit só e dá para reverter pelo botão
  Revert da PR.

## Estados no board

`New → Ready → Executando → Revisao → Integrado → Homologando → Closed` (e `Removed`).

O agente só move Ready, Executando e Revisao. Integrado, Homologando e Closed acontecem no merge,
porque a descrição de cada PR traz o estado antes do ID (`Integrado #1234`).

## Princípios

- **Cada informação tem uma casa só.**
  - O PRD e o estado ficam no work item.
  - O código e o mapa do sistema (`docs/system/`) ficam no repo.
  - A aprovação fica na PR.
- **Números só da máquina.** Tempo, contagem de testes e tentativas vêm de registros dos scripts,
  nunca do texto do modelo.
- **O agente não para no meio.** Ele pergunta tudo no kickoff e registra no relatório o que
  decidiu sozinho.
- **As regras ficam no servidor.** Branch policies valem para todos. A factory não instala hooks
  globais, então sessões comuns no mesmo projeto continuam livres.

## O que fica no projeto

```
.factory/project.json   # receita de execução (install, build, test, start com $PORT, ready, e2e)
.factory/runs/          # estado local de cada run, logs, prints e relatórios (fora do git)
docs/system/            # o mapa do sistema: product.md e architecture.md, com o marcador revisado-até
docs/adr/               # decisões estruturais
tests/e2e/              # testes de aceite (Playwright)
CLAUDE.md               # bloco da factory com a regra de manter docs/system em dia
```

## Instalação

Requisitos em cada máquina: Node 20+, Git, Azure CLI (`az login` no tenant da organização) e
Claude Code.

**Quem prepara o projeto** instala o plugin na própria máquina uma vez (vale em todos os
projetos) e roda `/setup` no projeto:

```
claude plugin marketplace add "https://github.com/FernandoPontello/claude-factory#nova-factory"
claude plugin install factory@factory-marketplace
```

Use a URL HTTPS: o formato curto `FernandoPontello/claude-factory` tenta SSH primeiro e falha em
máquina sem chave SSH no GitHub. O `#nova-factory` fixa a branch do piloto.

**O resto do time não digita nada.**
- O `/setup` grava no `.claude/settings.json` do projeto a declaração do marketplace (com
  auto-update) e do plugin.
- Quem abre o projeto no Claude Code e confia na pasta recebe a factory sozinho.
- Em pasta não confiada, a declaração é ignorada.

**Atualizações.** Durante o piloto o `plugin.json` não tem `version`, então cada commit na branch
vira uma atualização. Com auto-update, ela chega sozinha. Para buscar na hora:
`claude plugin marketplace update` e depois `claude plugin update factory@factory-marketplace`.

A configuração que só o admin da organização faz, uma vez só, está em
[docs/ADMIN.md](docs/ADMIN.md).

## Para quem mexe na factory

Veja o [CLAUDE.md](CLAUDE.md) deste repo.

# Factory (este repositório)

Este repo é o plugin `factory` do Claude Code. Ele não é um projeto que usa a factory: é a
factory em si. A descrição do fluxo para quem usa está no [README.md](README.md).

## Estrutura

| Caminho | O que é |
| --- | --- |
| `.claude-plugin/` | manifesto do plugin e do marketplace |
| `skills/<comando>/SKILL.md` | os quatro comandos: `setup`, `prd`, `deliver`, `release` |
| `skills/*/` | modelos usados por cada skill (dossiê, formato do relatório, templates do setup) |
| `agents/` | `reviewer` (revisão por lente) e `scanner` (leitura de código para docs/system) |
| `scripts/ado.mjs` | única porta para o Azure DevOps (API REST + token do `az login`) |
| `scripts/run.mjs` | executor local do run: estado, verificações com registro, app, relatório |
| `scripts/lib/` | código compartilhado dos scripts |
| `scripts/hooks/` | hook do `/prd` que impede o PO de escrever no repo |
| `scripts/tests/` | testes dos scripts (`node:test`, Azure DevOps simulado) |
| `docs/ADMIN.md` | configuração única do admin da organização |

## Como testar

```
npm test
```

Para experimentar o plugin sem publicar, abra o Claude Code num projeto de teste com
`claude --plugin-dir <caminho deste repo>`.

## Convenções

- **Scripts sem dependências**, Node 20+, ESM, compatíveis com Windows e POSIX.
- **Todo comando de script imprime um objeto JSON** e sai com um código que diz o que fazer:
  `0` ok, `1` erro, `2` login, `3` não encontrado, `4` conflito, `5` configuração, `6` limite de
  tentativas. Erros trazem `error` e `fix` em português.
- **Rodar duas vezes nunca duplica nada no board.** Toda escrita confere antes: chave, marcador,
  PR ativa.
- **As skills citam os scripts por `${CLAUDE_PLUGIN_ROOT}`** e os modelos por
  `${CLAUDE_SKILL_DIR}`, sempre com o caminho entre aspas.
- **As regras inegociáveis de cada skill ficam no topo**, porque a plataforma preserva o começo da
  skill quando a sessão compacta.
- **Texto para pessoas em português claro e direto.** Nomes de estado do board são ASCII de uma
  palavra (`Integrado`, `Homologando`), porque o Azure DevOps os lê na descrição da PR.
- **Mudou o comportamento de um script:** teste em `scripts/tests/` na mesma mudança.

# Claude Factory

Pipeline de desenvolvimento assistido por IA: PO define o quê, Dev define o como, o board é projeção do filesystem e o commit é a fronteira da verdade.

**A Lei da Factory:** a IA ajuda a pensar; quem decide é o operador.

## Ponteiros

- **Regras conceituais** (princípios, ciclo de vida, formatos canônicos): [README.md](README.md)
- **Convenções operacionais** (git, filesystem, board, épicos): `.claude/rules/factory/` — carregadas automaticamente
- **Contrato canônico do board** (entidades, estados, verbos, derivação): [.claude/factory-process.md](.claude/factory-process.md)
- **Binding do provider ativo**: `.claude/kanban-config.json` — escrito por `/setup`
- **Receita de build/run**: `.claude/build-run.md` — gravada por `/setup`, consumida pelo `verifier`

## Identidade dos artefatos

| Onde | O quê |
|---|---|
| `docs/proposals/` | idealização (descartável; nunca toca o board) |
| `docs/overviews/` | definição do que o projeto é agora (não é log) |
| `docs/epics/<slug>/` | trabalho comprometido: prd, design, tasks, pending, closure-notes |
| `docs/wiki/` | wiki repo-first (default) |

Comandos de estágio são invocados **só pelo operador** (`disable-model-invocation`). Nunca invoque um estágio em nome do usuário.

# Hooks da factory

A prosa das skills descreve a *intenção*; estes scripts garantem o *invariante* (README §15).
Cada script existe em duas variantes — `.ps1` (Windows/PowerShell) e `.sh` (POSIX/bash,
requer `jq`) — e o `/setup` instala a do SO detectado. A factory nunca depende de um bash
implícito.

## Mapa script → invariante → onde é registrado

| Script | Evento | Invariante (README) | Registrado em |
|---|---|---|---|
| `gate-stage` | `UserPromptExpansion` | pré-condições de estágio: papel, tree limpa ou suja só no próprio write-set, artefato requerido, frescor de `docs/**` (§5) | `.claude/settings.json` (projeto) e frontmatter dos perfis `po`/`dev` com `-Role` |
| `guard-git` | `PreToolUse(Bash)` | operações git proibidas; só `fetch` e `pull --ff-only` sincronizam; add nominal (§5, §15) | `.claude/settings.json` (projeto) e frontmatter do `coder` (com `-Worker`: nega também push/fetch/pull — "push fora de hora" no runtime de workflow) |
| `guard-writes` | `PreToolUse(Edit\|Write)` | single-writer durante o estágio (§14) | frontmatter de cada skill (`-Stage`) e do perfil `po` (`-Role po`: união dos write-sets do papel; o `-Stage` da skill ativa aperta) |
| `guard-skill` | `PreToolUse(Skill)` | papel não invoca estágio fora da sua lista (§2) | frontmatter dos perfis `po`/`dev` |
| `stop-scan` | `Stop` | brecha de escrita via Bash e de sub-agents genéricos (sem frontmatter, sem guard in-flight): dirty fora do write-set bloqueia o fechamento (§15) | frontmatter das skills de estágio (no `/code`, o Stop é do `check-toca`) |
| `check-toca` | `Stop` (só `/code`) | o `Toca` é contrato verificado, não declaração (§10); o `gate-stage` delega a ele a checagem de retomada do `/code` | frontmatter da skill `/code` e do `coder` |
| `inject-invariants` | `SessionStart(compact)` | invariantes sobrevivem à compaction (§10) | `.claude/settings.json` (projeto) |
| `board-gate` | `PreToolUse(mcp__*)` | board só projeta verdade commitada (§5) | frontmatter do `board-writer` |
| `board-log-failure` | `PostToolUseFailure(mcp__*)` | falha de board capturada estruturadamente (§11) | frontmatter do `board-writer` |

`stage-map.json` é a **fonte única** estágio → papel/write-set/pré-requisitos, consumida
por `gate-stage`, `guard-writes`, `guard-skill` e `stop-scan`.

## Semântica de bloqueio

Bloqueio = `exit 2` + mensagem no stderr (devolvida ao modelo/operador com o porquê e a
instrução de reparo). Payload ilegível em condição benigna sai 0 (não derruba a sessão),
mas **dependência ausente falha fechada**: a variante POSIX exige `jq` e os guards barram
com instrução de instalação em vez de degradar em silêncio — na dúvida, mais prompts,
nunca menos segurança (§1). O self-check do `/setup` dispara um canário que afirma que
cada guard de fato barra (§15): registro não é disparo.

## Defesa em profundidade segundo a propagação real

Cada camada de hook tem um alcance distinto (§15): hooks de **projeto**
(`.claude/settings.json`) governam a sessão e **propagam para sub-agents** — por isso o
`guard-git` vive lá; hooks de **frontmatter de skill** valem só na sessão que executa a
skill — é onde o `guard-writes` conhece o estágio (`-Stage`); hooks de **frontmatter de
agent** disparam no próprio agent — por isso `coder` e `board-writer` carregam os seus, e
por isso o `/setup` instala os agents em `.claude/agents/` do projeto, onde o frontmatter
vale integralmente. Sub-agents genéricos não carregam frontmatter e não têm guard de
escrita in-flight: escrita persistente deles fora do write-set é sujeira acusada pelo
`stop-scan`, e efeito transitório não entra na verdade — a fronteira é o commit (§5). O
canário do `/setup` verifica cada camada pelo seu mecanismo real.

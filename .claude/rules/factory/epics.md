---
paths: docs/epics/**
---

# Convenções de épico (escopadas a docs/epics/**)

- **Status de task tem dois valores:** `pendente` | `concluída`. Resíduo não é status:
  task com sobra fecha `concluída; ver pending.md#NNN` — para o batch não re-executá-la.
- **`## Tempo` é relógio real**, nunca estimativa: iniciado / concluído / duração,
  preenchido pelo `/code`.
- **Rastreabilidade de ACs:** os critérios de aceite numerados (`AC-n`) do `prd.md`
  atravessam `design.md` (referencia), `task.md` (campo `ACs cobertos`) e
  `closure-notes.md` (cobertura verificada). Não invente ACs novos fora do PRD.
- **`Toca` é contrato:** a task só escreve nos paths declarados; o hook do Stop compara o
  diff real contra o declarado. Desvio legítimo → justificar e registrar; nunca commitar
  por cima em silêncio.
- **`pending.md` é condicional** — só nasce com pendência real (escopo faltante ou
  necessidade descoberta). A ausência do arquivo É o sinal de "fechou limpo".
- **`closure-notes.md` é histórico:** append-only, imutável. Overviews são definição;
  closure-notes são registro.
- **Pasta de re-entrada `docs/epics/<slug>-pNNN/`:** tem `design.md` e **não** tem `prd.md` — o
  PRD da pendência é a própria entrada no `pending.md` de origem, que carrega o `Board-ID`
  da Feature irmã.
- **Single-writer por arquivo** (README §14): `prd.md` é do `/promote`/`/bug`; `design.md`
  do `/design`; `tasks/*.md` do `/tasks` (criação) e `/code` (só `Status` e `## Tempo`);
  `pending.md` e `closure-notes.md` do `/close`.

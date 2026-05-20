#!/usr/bin/env bash
# suggest-next-task.sh — dispara após /code, identifica próxima task pendente
#
# Custo: zero em tokens (shell puro).
# Lê docs/epics/*/tracking.md e identifica a primeira task com Status
# [ ] Pendente do épico mais recente. Imprime sugestão para o operador.
#
# Para ativar, registre em .claude/settings.json (ver .claude/hooks/README.md).

set -e

EPICS_DIR="docs/epics"

if [ ! -d "$EPICS_DIR" ]; then
    exit 0
fi

# Encontra o épico ativo (mais recentemente modificado que tem tracking.md)
ACTIVE_EPIC=$(find "$EPICS_DIR" -maxdepth 2 -name 'tracking.md' -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn \
    | head -1 \
    | awk '{print $2}')

if [ -z "$ACTIVE_EPIC" ]; then
    exit 0
fi

EPIC_DIR=$(dirname "$ACTIVE_EPIC")
EPIC_SLUG=$(basename "$EPIC_DIR")

# Busca primeira task pendente no diretório de tasks
TASKS_DIR="$EPIC_DIR/tasks"
if [ ! -d "$TASKS_DIR" ]; then
    exit 0
fi

NEXT_TASK=""
for task_file in "$TASKS_DIR"/*.md; do
    [ -f "$task_file" ] || continue
    # Procura por "[x] Pendente" ou "[ ] Concluída" — o checkbox marcado em "Pendente"
    # significa task ainda não executada (ou marcado em "Concluída" significa feita).
    # Padrão simples: se "[x] Pendente" aparece (e não "[x] Concluída"), está pendente.
    if grep -qE '^\s*-\s*\[x\]\s*Pendente\s*$' "$task_file" 2>/dev/null \
       || grep -qE '^\s*-\s*\[ \]\s*Concluída\s*$' "$task_file" 2>/dev/null; then
        # Verifica que NÃO está concluída
        if ! grep -qE '^\s*-\s*\[x\]\s*Concluída\s*$' "$task_file" 2>/dev/null; then
            NEXT_TASK="$task_file"
            break
        fi
    fi
done

if [ -n "$NEXT_TASK" ]; then
    TASK_NAME=$(basename "$NEXT_TASK" .md)
    echo "↳ Próxima task pendente: $TASK_NAME"
    echo "  Caminho: $NEXT_TASK"
    echo "  Para executar: /code $EPIC_SLUG $TASK_NAME"
else
    echo "↳ Nenhuma task pendente em $EPIC_SLUG."
    echo "  Considere /close para fechar o épico."
fi

exit 0

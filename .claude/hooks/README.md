# Hooks opcionais da factory v3.5

Scripts shell que reduzem fricção do dia-a-dia. **Opcionais** — instala se valoriza a redução. Custo zero em tokens (executam fora do contexto do modelo).

## Hooks disponíveis

### `notify-on-stop.sh`

Dispara ao fim de uma sessão `/code`. Toca som ou mostra notificação do sistema (cross-platform: macOS, Linux, Windows). Útil em modo interativo — operador não fica refrescando terminal aguardando a task terminar.

### `suggest-next-task.sh`

Dispara após `/code`. Lê `docs/epics/<slug>/tracking.md` do épico mais recente (mais ativo) e identifica a primeira task com Status `[ ] Pendente`. Imprime sugestão para o operador.

```
↳ Próxima task pendente: 003-feature-foo
  Caminho: docs/epics/feature-foo/tasks/003-feature-foo.md
  Para executar: /code feature-foo 003-feature-foo
```

Vira rastro automático sem o operador conferir manualmente o tracking.

## Como ativar

Os hooks são registrados via `.claude/settings.json` (não comitado por padrão — config local do operador). Exemplo:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "/code",
        "hooks": [
          { "type": "command", "command": "bash .claude/hooks/notify-on-stop.sh" },
          { "type": "command", "command": "bash .claude/hooks/suggest-next-task.sh" }
        ]
      }
    ]
  }
}
```

Consulte a documentação oficial do Claude Code para o formato exato e eventos disponíveis (`Stop`, `PostToolUse`, etc).

## Custom hooks

Operadores podem adicionar próprios hooks neste diretório. Convenção:
- Shell scripts (`.sh`) executáveis.
- Custo zero em tokens.
- Idempotentes — devem poder rodar múltiplas vezes sem efeito colateral.
- Saída concisa para `stdout` (operador lê).
- Falham silenciosamente quando inputs faltam (não bloqueiam fluxo do `/code`).

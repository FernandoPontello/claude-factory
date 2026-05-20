#!/usr/bin/env bash
# notify-on-stop.sh — dispara ao fim de uma sessão /code
#
# Custo: zero em tokens (shell puro).
# Útil em modo interativo — operador não precisa ficar refrescando terminal.
#
# Para ativar, registre em .claude/settings.json (ver .claude/hooks/README.md).

# Detecta plataforma e usa o canal apropriado de notificação
if command -v osascript >/dev/null 2>&1; then
    # macOS — usa display notification
    osascript -e 'display notification "Sessão /code finalizada" with title "Factory" sound name "Glass"' 2>/dev/null
elif command -v notify-send >/dev/null 2>&1; then
    # Linux com libnotify
    notify-send "Factory" "Sessão /code finalizada" 2>/dev/null
elif command -v powershell >/dev/null 2>&1; then
    # Windows
    powershell -Command "
        Add-Type -AssemblyName System.Windows.Forms
        \$notify = New-Object System.Windows.Forms.NotifyIcon
        \$notify.Icon = [System.Drawing.SystemIcons]::Information
        \$notify.Visible = \$true
        \$notify.ShowBalloonTip(5000, 'Factory', 'Sessão /code finalizada', [System.Windows.Forms.ToolTipIcon]::Info)
    " 2>/dev/null
fi

# Beep como fallback (terminal)
printf '\a'

exit 0

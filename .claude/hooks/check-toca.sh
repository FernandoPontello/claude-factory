#!/usr/bin/env bash
# check-toca — Stop do /code. O `Toca` é contrato verificado, não declaração (README §10).
# Espelho de check-toca.ps1.

. "$(dirname "$0")/_lib.sh"

dirty=$(dirty_paths)
[ -n "$dirty" ] || exit 0

root="$(project_root)"
allowed=('docs/epics/*/tasks/*.md')

# une só o Toca das tasks EM VOO (Status pendente ou o próprio task.md sujo) —
# task concluída e commitada fecha seu write-set
for tf in "$root"/docs/epics/*/tasks/*.md; do
  [ -f "$tf" ] || continue
  rel=$(rel_path "$tf")
  pending=$(awk '/^##[[:space:]]+Status/{f=1; next} /^##[[:space:]]/{f=0} f && /pendente/{print "yes"; exit}' "$tf")
  case "$dirty" in *"$rel"*) tf_dirty=yes ;; *) tf_dirty="" ;; esac
  { [ -n "$pending" ] || [ -n "$tf_dirty" ]; } || continue
  toca=$(awk '/^##[[:space:]]+Toca[[:space:]]*$/{f=1; next} /^##[[:space:]]/{f=0} f' "$tf")
  while IFS= read -r line; do
    entry=$(printf '%s' "$line" | sed -E 's/^[[:space:]]*[-*][[:space:]]*//; s/[[:space:]]+$//')
    [ -n "$entry" ] || continue
    case "$entry" in '<!--'*|'['*) continue ;; esac
    entry=$(printf '%s' "$entry" | sed -E 's/[[:space:]]+—.*$//; s/[[:space:]]+#.*$//')
    [ -n "$entry" ] && allowed+=("$entry")
  done <<EOF
$toca
EOF
done

violations=""
while IFS= read -r p; do
  [ -n "$p" ] || continue
  matches_globs "$p" "${allowed[@]}" || violations="$violations
  $p"
done <<EOF
$dirty
EOF

if [ -n "$violations" ]; then
  deny "check-toca: o diff real diverge do Toca declarado (§10). Paths fora de qualquer write-set de task:$violations
Opções: (a) reverta o desvio; (b) se a escrita é legítima, justifique ao operador — o desvio vira candidato a pendência no /close. Nunca commite por cima da divergência em silêncio."
fi
exit 0

# Verificação cirúrgica de filesystem

- **Verifique antes de afirmar.** Nunca diga que um arquivo/pasta existe (ou não) sem
  checar com tool de leitura ou glob preciso. Decisões de modo (ex.: `/ground` destila vs
  scaneia) derivam de evidência verificada, não de suposição.
- **Leia antes de escrever.** Re-execução de estágio é recuperação, não recriação: confira
  o que já existe e complete o que falta (idempotência — ex.: `/promote` re-rodado recupera
  via `find_by_key` e preenche `Board-ID` faltante, não duplica).
- **A ausência de arquivo é sinal, não defeito.** `pending.md` ausente = fechou limpo;
  pasta `-pNNN` ausente = pendência não re-entrou. Não crie artefato para "completar" a
  estrutura — escrever é a exceção justificada.
- **Globs precisos, não varredura.** Cada evidência da derivação de estado
  (`.claude/factory-process.md`) tem um glob exato; use-o. `docs/proposals/**` é território
  de idealização: nenhum estágio de execução o lê (exceções: `/ground` nos drafts do
  nascimento, `/promote` nos PRDs escolhidos).
- **Paths relativos à raiz do projeto**, separador `/`, nos artefatos e referências
  cruzadas (`Deriva de:`, `Pendência:`, `Referência:`).

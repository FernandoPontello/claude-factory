# <título do item>

Tipo: Feature | Bug · Tamanho: P | M | G

## 1. Problema e valor

Quem sofre, qual dor, por que agora. De 3 a 6 linhas, em linguagem de negócio.

## 2. Histórias

### US-1 — <título curto>

Como <persona>, quero <ação>, para <benefício>.

## 3. Critérios de aceite

Cada AC vira um teste de aceite. O "então" precisa ser observável na tela, na API ou nos dados.

- **AC-1 (US-1) — <título>**
  Dado <estado inicial>, quando <ação>, então <resultado observável>.
- **AC-2 (US-1) — <título>**
  Dado <estado inicial>, quando <ação>, então <resultado observável>.

## 4. Regras de negócio e dados (opcional)

Permissões, mensagens exatas, validações, perfis envolvidos, efeito em dados que já existem.

## 5. Fora de escopo

O que este item explicitamente não cobre.

## 6. Reprodução (só bug)

- **Onde aparece:** só na develop | na QA | em produção (e, se em produção, se dá para esperar o
  próximo release)
- **Trilha:** feature a partir da develop | bugfix a partir da QA | hotfix a partir da main
- **Passos:** 1. … 2. … 3. …
- **Esperado:** …
- **Obtido:** …
- **Evidência:** print ou log
- **Frequência e impacto:** …
- **Causa provável:** hipótese com evidência no código (o dev confirma)

## 7. Leitura técnica preliminar

Escrita pelo Claude na sessão do PO. Não é decisão: serve para dimensionar e acelerar o dev.

- **Onde mexe:** módulos e arquivos prováveis
- **Abordagem provável:** e as alternativas
- **Riscos e dependências:** inclusive conflitos com o comportamento atual
- **Perguntas técnicas em aberto:** vão para o kickoff do dev

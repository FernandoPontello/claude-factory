<!--
revisado-até: <sha do commit mais novo conferido> (avança só quando este arquivo muda)
ESTE ARQUIVO: as regras de arquitetura — padrões, convenções, onde cada coisa mora.
NÃO É: log de mudanças. Seguir um padrão que já existe não muda este arquivo; só muda quando uma
regra muda. Decisão estrutural nova ganha uma ADR em docs/adr/.
-->

# Arquitetura

## Visão geral

<Estilo (monólito modular, serviços...), stack, como as partes conversam.>

## Regras

- **<regra>:** <o que vale>. Exemplo: `<arquivo>`.

## Com quem este repo conversa (projeto com mais de um repo)

| Repo | Direção | Por onde |
| --- | --- | --- |
| `<Loja-FrontEnd>` | consome este repo | `<rotas da API que ele usa>` |

## Onde cada coisa mora

| Pasta | O que tem |
| --- | --- |
| `<src/...>` | <...> |

## Testes

<Como os testes estão organizados; o que roda na receita de execução.>

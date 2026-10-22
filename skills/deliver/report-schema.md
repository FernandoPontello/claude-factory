# Formato do report.json

O `/deliver` escreve `.factory/runs/<id>/report.json`, e o `run report` monta o HTML a partir
dele. **Não escreva números aqui:** contagem de testes, tentativas, durações, commits e tamanho
do diff saem dos registros da máquina. O texto é seu; os números não.

```json
{
  "workItem": { "id": 1234, "type": "User Story", "title": "Cliente cancela pedido antes do envio", "url": "https://dev.azure.com/..." },
  "versionNote": "v2: texto do botão virou 'Cancelar pedido', a pedido do dev",
  "partA": {
    "changes": [
      "O cliente cancela sozinho um pedido que ainda não foi enviado."
    ],
    "acs": [
      {
        "id": "AC-1",
        "us": "US-1",
        "name": "Cancelar pedido aguardando envio",
        "given": "um pedido com status \"Aguardando envio\"",
        "when": "o cliente clica em \"Cancelar pedido\" e confirma",
        "then": "o status muda para \"Cancelado\" e aparece a mensagem de estorno",
        "status": "atendido",
        "test": "tests/e2e/1234-cancelar.spec.ts › AC-1",
        "evidence": [
          { "file": "shots/ac1-1.png", "caption": "Pedido aguardando envio, botão visível" }
        ],
        "note": "a API também recusa com 409 quando o pedido já foi enviado"
      }
    ],
    "validation": {
      "steps": ["Entre com o usuário de teste cliente.teste@...", "Abra o pedido A-10293"],
      "note": "Os pedidos existem no seed."
    },
    "productDecisions": [
      { "id": "P1", "title": "O motivo do cancelamento é opcional", "decision": "Motivos: ...", "why": "Obrigatório criaria atrito." }
    ],
    "limitations": ["Cancelar só alguns itens não está incluído."]
  },
  "partB": {
    "kickoffDecisions": [
      { "id": "K1", "question": "Estorno síncrono ou assíncrono?", "answer": "Assíncrono, pela fila existente", "why": "Escolha do dev." }
    ],
    "autonomousDecisions": [
      { "id": "D1", "title": "Estorno idempotente pelo ID do pedido", "decision": "O comando usa PedidoId como chave.", "discarded": "travar o botão só na tela" }
    ],
    "changes": [{ "area": "API", "what": "POST /api/pedidos/{id}/cancelamento: 204, 403, 404, 409" }],
    "findings": [
      { "lens": "segurança", "finding": "Faltava conferir o dono do pedido", "severity": "alta", "destination": "Corrigido em a41c9e2, com teste de regressão", "open": false }
    ],
    "testsChanged": [
      { "test": "tests/pedidos.test.ts › calcula frete", "why": "o frete agora considera o cancelamento; a expectativa mudou junto com o AC-3" }
    ],
    "risks": ["Se a fila de pagamentos cair, o estorno fica pendente."],
    "pendencies": [
      { "kind": "produto", "title": "Cancelar só alguns itens", "target": "New" },
      { "kind": "técnica", "title": "Mover o handler para o módulo Pagamentos", "target": "Ready" }
    ],
    "docs": [{ "file": "docs/system/product.md", "what": "Ganhou a capacidade de cancelamento pelo cliente" }],
    "markerFrom": "c02e88a",
    "markerTo": "9f3d1b7"
  }
}
```

Valores fechados:

- `acs[].status`: `atendido` | `parcial` | `nao-atendido`
- `findings[].severity`: `alta` | `media` | `baixa`; `open: true` só para achado que ficou sem
  correção
- `pendencies[].target`: `New` (produto, o PO decide) | `Ready` (técnica)
- `testsChanged`: lista vazia quando nenhum teste existente foi alterado; cada entrada tem `test`
  e `why`

O veredito ✅ exige:

- o último registro de cada verificação final do ciclo passou, no commit atual e com a árvore
  limpa;
- todos os ACs estão `atendido`, e, quando há relatório do Playwright, o teste com o ID do AC no
  título passou;
- nenhum achado alto está aberto.

Fora disso, o relatório sai ⚠️ com as ressalvas listadas.

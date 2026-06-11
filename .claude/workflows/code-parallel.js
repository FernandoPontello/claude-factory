export const meta = {
  name: 'code-parallel',
  description: 'Executa o grafo de tasks de um épico em ramos paralelos: worktrees isolados, integração por diff+apply, verificação no tree integrado (README §10)',
  whenToUse: 'Épico GRANDE com ramos independentes no grafo E disjuntos no Toca. Sequencial é o default; isto é opt-in deliberado via /code --parallel. Para épico pequeno/acoplado o overhead engole o ganho.',
  phases: [
    { title: 'Grafo', detail: 'ler tasks, validar disjunção de Toca, montar ramos' },
    { title: 'Execução', detail: 'um coder por ramo, worktree isolado, sequencial dentro do ramo' },
    { title: 'Integração', detail: 'diff+apply em ordem topológica no tree principal' },
    { title: 'Verificação', detail: 'build+teste no tree integrado via verifier' },
  ],
}

// args: { epic: '<slug>' } — passado pelo /code --parallel (o despachante).
const epic = args && args.epic
if (!epic) throw new Error('uso: /code-parallel com args {epic: "<slug>"} — o slug da pasta em docs/epics/')

// ───────────────────────────── Fase 1: Grafo ─────────────────────────────
phase('Grafo')

const GRAPH_SCHEMA = {
  type: 'object',
  required: ['branches', 'serializedPairs'],
  properties: {
    branches: {
      type: 'array',
      items: {
        type: 'object',
        required: ['tasks', 'toca'],
        properties: {
          tasks: { type: 'array', items: { type: 'string' }, description: 'IDs em ordem topológica dentro do ramo' },
          toca: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    serializedPairs: {
      type: 'array',
      items: { type: 'string' },
      description: 'pares independentes no grafo mas com Toca sobreposto — explicação de por que foram postos no mesmo ramo',
    },
  },
}

const graph = await agent(
  `Leia docs/epics/${epic}/tasks/*.md e monte os ramos de execução paralela do épico "${epic}".

Regras (README §10 — inegociáveis):
- Um ramo = cadeia de tasks ligadas por "Depende de" (ordem topológica dentro do ramo).
- Ramos só podem ser CONCORRENTES se forem independentes no grafo E disjuntos no "Toca".
  Independência ≠ disjunção de escrita: pares com Toca sobreposto vão para o MESMO ramo
  (serializados) e entram em serializedPairs com a justificativa.
- Tasks com Status "concluída" ficam de fora.
- Devolva apenas o objeto estruturado.`,
  { schema: GRAPH_SCHEMA, label: 'montar grafo', phase: 'Grafo' }
)

if (!graph || graph.branches.length === 0) {
  return { epic, result: 'nada a executar — todas as tasks concluídas ou grafo vazio' }
}
log(`${graph.branches.length} ramo(s); pares serializados por Toca sobreposto: ${graph.serializedPairs.length}`)

// ─────────────────────────── Fase 2: Execução ────────────────────────────
phase('Execução')

const BRANCH_SCHEMA = {
  type: 'object',
  required: ['completed', 'failed', 'patches'],
  properties: {
    completed: { type: 'array', items: { type: 'string' } },
    failed: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, reason: { type: 'string' } } } },
    patches: {
      type: 'array',
      description: 'UM patch por task commitada, na ordem de execução — preserva o "um commit por task" (§5) na integração',
      items: {
        type: 'object',
        required: ['task', 'patch'],
        properties: {
          task: { type: 'string' },
          patch: { type: 'string', description: 'git show <commit-da-task> --format= --patch' },
          message: { type: 'string', description: 'mensagem canônica do commit original da task' },
        },
      },
    },
    minutes: { type: 'object', description: 'taskId -> minutos de relógio real' },
    learnings: { type: 'string' },
  },
}

// Barreira deliberada: a integração (fase 3) precisa de TODOS os patches juntos,
// em ordem topológica — não há pipeline possível entre execução e integração.
const results = await parallel(
  graph.branches.map((b, i) => () =>
    agent(
      `Você é o coder do ramo ${i + 1} do épico "${epic}". Execute, EM ORDEM, as tasks: ${b.tasks.join(', ')} (arquivos em docs/epics/${epic}/tasks/).

Regras do ramo (README §10 — inegociáveis):
- Sequencial dentro do ramo: cada task herda o aprendizado das anteriores.
- Write-set: escreva SOMENTE nos paths do "Toca" de cada task (+ Status e ## Tempo no próprio task.md).
- Um commit por task, mensagem canônica: factory(code): ${epic} — task NNN <resumo>. git add NOMINAL.
- Atualize Status (pendente→concluída) e ## Tempo (relógio real) em cada task.md antes do commit da task.
- Se uma task falhar, NÃO execute as dependentes dela; registre em failed e siga para o que não depende.
- NUNCA fale com o board — só a sessão principal emite verbos canônicos (§10).
- NUNCA use git merge/checkout/reset — você está num worktree isolado gerido pela plataforma.

Ao final: para CADA task commitada, extraia o patch daquele commit (\`git show <hash> --format= --patch\`) e devolva em "patches" na ordem de execução, cada item com a mensagem canônica original — a integração replica um commit por task (§5). Complete com completed/failed/minutes/learnings.`,
      { agentType: 'coder', isolation: 'worktree', schema: BRANCH_SCHEMA, label: `ramo ${i + 1}: ${b.tasks.join(',')}`, phase: 'Execução' }
    )
  )
)

const ok = results.filter(Boolean)
const lost = results.length - ok.length
if (lost > 0) log(`atenção: ${lost} ramo(s) morreram sem resultado — as tasks deles viram candidatas a pendência no /close`)

// ─────────────────────────── Fase 3: Integração ──────────────────────────
phase('Integração')

const INTEGRATION_SCHEMA = {
  type: 'object',
  required: ['applied', 'rejected'],
  properties: {
    applied: { type: 'array', items: { type: 'string' }, description: 'tasks integradas e commitadas no tree principal' },
    rejected: { type: 'array', items: { type: 'object', properties: { task: { type: 'string' }, reason: { type: 'string' } } } },
  },
}

const patches = ok.map((r, i) => ({ branch: i + 1, tasks: r.completed, patches: r.patches }))
const integration = await agent(
  `Integre no tree principal os patches dos ramos do épico "${epic}", em ordem topológica.

Material (JSON): ${JSON.stringify(patches)}

Regras (README §10, §5):
- Integração é \`git apply\` POR TASK (escreva cada patch em arquivo temporário antes), na ordem dos ramos e, dentro do ramo, na ordem das tasks. NUNCA git merge/checkout — proibidos pelo guard.
- Após aplicar o patch de UMA task: \`git add\` NOMINAL dos paths daquele patch + commit com a mensagem canônica original da task (campo "message"; fallback: factory(code): ${epic} — task NNN integrada). UM COMMIT POR TASK — o histórico durável preserva o mapa de commits do §5.
- Patch que não aplica limpo: NÃO force; registre em rejected com a causa (vira pendência no /close) e siga para o próximo ramo (as tasks seguintes do MESMO ramo dependem dele — rejeite-as também, com causa "base do ramo rejeitada").
- Os Status/## Tempo dos task.md já viajam dentro dos próprios patches (o coder os commitou na task).`,
  { schema: INTEGRATION_SCHEMA, label: 'apply por task, topológico', phase: 'Integração' }
)

// ─────────────────────────── Fase 4: Verificação ─────────────────────────
phase('Verificação')

const verify = await agent(
  `Builde e rode a suíte do projeto no tree integrado, usando a receita de .claude/build-run.md (gravada pelo /setup). Reporte: build ok?, testes ok?, falhas com saída relevante. NÃO corrija nada — só verifique e reporte (o gate humano vem depois, fora do workflow).`,
  { agentType: 'verifier', label: 'build+teste integrado', phase: 'Verificação' }
)

// O gate humano vive ENTRE workflows (§10): este run termina aqui; o operador decide.
// Board: a SESSÃO PRINCIPAL (/code) emite os verbos canônicos derivados do filesystem.
return {
  epic,
  branches: graph.branches.length,
  serializedPairs: graph.serializedPairs,
  completed: ok.flatMap(r => r.completed),
  failed: ok.flatMap(r => r.failed),
  integration,
  verify,
  boardNote: 'a sessão principal deve agora emitir complete_task por task integrada e mover o Feature conforme o estado real (factory-process.md)',
}

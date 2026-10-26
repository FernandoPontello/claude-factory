// Pasta de trabalho (projeto com N repos), sprint atual e tasks de horas.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bareOrigin, makeWorkspace, mockFetch, ME, workItem } from './helpers.mjs';
import { findWorkspace, resolveConfig } from '../lib/config.mjs';
import { FactoryError } from '../lib/cli.mjs';
import { dispatch } from '../ado.mjs';

let ws;
let cwd;
let mock;

before(() => {
  process.env.ADO_TOKEN = 'token-de-teste';
  ws = makeWorkspace([
    { name: 'loja-api', project: { run: { install: 'npm ci', test: 'npm test' } } },
    { name: 'loja-front' },
    { name: 'outro', remote: 'https://dev.azure.com/contoso/Outro/_git/outro' },
  ]);
  mkdirSync(join(ws.root, 'anotacoes'));
  cwd = process.cwd();
});

after(() => {
  process.chdir(cwd);
  ws.cleanup();
});

afterEach(() => {
  mock?.restore();
  mock = null;
  process.chdir(cwd);
});

const real = (p) => realpathSync.native(p).toLowerCase();

async function expectError(promise, code, pattern) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof FactoryError, String(err));
    assert.equal(err.code, code);
    if (pattern) assert.match(err.message + ' ' + (err.fix ?? ''), pattern);
    return true;
  });
}

const connection = ['GET', /\/_apis\/connectionData$/, () => ({ body: ME })];

test('dentro de um repo, a pasta de trabalho são ele e os irmãos do mesmo projeto', () => {
  const found = findWorkspace(ws.paths['loja-front']);
  assert.deepEqual(found.members.map((m) => m.name), ['loja-api', 'loja-front']);
  assert.equal(found.current.name, 'loja-front');
  assert.equal(real(found.root), real(ws.root));
});

test('fora de um repo, pasta com clones de dois projetos recusa adivinhar qual é o projeto', () => {
  // Dentro de um repo, o "outro" é só ignorado; sem um repo de âncora, a mistura vira erro.
  assert.throws(() => findWorkspace(ws.root), (err) => err instanceof FactoryError && err.code === 'config' && /mais de um projeto/.test(err.message));
});

test('resolveConfig na pasta de trabalho não tem repo; --repo escolhe o clone', () => {
  const only = makeWorkspace([{ name: 'loja-api' }, { name: 'loja-front' }]);
  try {
    const cfg = resolveConfig({ cwd: only.root });
    assert.equal(cfg.workspaceMode, true);
    assert.equal(cfg.repo, null);
    assert.equal(cfg.org, 'contoso');
    assert.equal(cfg.project, 'Loja');
    assert.equal(cfg.team, 'Loja Team');
    assert.deepEqual(cfg.workspace.members.map((m) => m.name), ['loja-api', 'loja-front']);

    const api = resolveConfig({ cwd: only.root, repoOverride: 'LOJA-API' });
    assert.equal(api.workspaceMode, false);
    assert.equal(api.repo, 'loja-api');
    assert.equal(real(api.root), real(only.paths['loja-api']));

    // Dentro de um repo, --repo aponta para o irmão (é assim que o front sobe a API).
    const sibling = resolveConfig({ cwd: only.paths['loja-front'], repoOverride: 'loja-api' });
    assert.equal(sibling.repo, 'loja-api');

    assert.throws(() => resolveConfig({ cwd: only.root, repoOverride: 'pagamentos' }), (err) => err.code === 'config' && /pagamentos/.test(err.message));
  } finally {
    only.cleanup();
  }
});

test('na pasta de trabalho, o time e os estados vêm do project.json dos repos; a receita não', () => {
  const custom = makeWorkspace([
    { name: 'loja-api', project: { ado: { team: 'Time Loja', taskType: 'Backend' }, states: { ready: 'Pronto' }, run: { install: 'npm ci' } } },
    { name: 'loja-front' },
  ]);
  try {
    const cfg = resolveConfig({ cwd: custom.root });
    assert.equal(cfg.team, 'Time Loja');
    assert.equal(cfg.states.ready, 'Pronto');
    assert.equal(cfg.taskType, null);
    assert.equal(cfg.run, null);
  } finally {
    custom.cleanup();
  }
});

test('comando de um repo só, na pasta de trabalho, pede --repo', async () => {
  const only = makeWorkspace([{ name: 'loja-api' }, { name: 'loja-front' }]);
  try {
    process.chdir(only.root);
    mock = mockFetch([]);
    await expectError(dispatch(['pr', 'status', '--id', '5']), 'config', /--repo/);
    assert.equal(mock.calls.length, 0);
  } finally {
    process.chdir(cwd);
    only.cleanup();
  }
});

test('repos mostra quais repos do projeto têm a factory e onde está o clone', async () => {
  process.chdir(ws.paths['loja-api']);
  mock = mockFetch([
    ['GET', /\/Loja\/_apis\/git\/repositories$/, () => ({ body: { value: [
      { id: 'r1', name: 'loja-api', defaultBranch: 'refs/heads/main', remoteUrl: 'https://x/loja-api' },
      { id: 'r2', name: 'loja-front', defaultBranch: 'refs/heads/main', remoteUrl: 'https://x/loja-front' },
      { id: 'r3', name: 'loja-db', defaultBranch: 'refs/heads/master', remoteUrl: 'https://x/loja-db' },
      { id: 'r4', name: 'legado', isDisabled: true },
    ] } })],
    ['GET', /\/repositories\/(r1|r2|r3)\/items$/, (req) => {
      assert.equal(req.query['versionDescriptor.version'], 'develop');
      return req.path.includes('/r1/') ? { body: { path: '/.factory/project.json' } } : { status: 404, body: { message: 'não existe' } };
    }],
  ]);
  const result = await dispatch(['repos']);
  assert.deepEqual(result.repos.map((r) => [r.name, r.factory, Boolean(r.local)]), [
    ['loja-api', true, true],
    ['loja-db', false, false],
    ['loja-front', false, true],
  ]);
  assert.equal(result.repos.find((r) => r.name === 'loja-db').defaultBranch, 'master');
});

test('repos --fetch diz se o clone lê direto, --update avança o clone parado, e o que entrou depois dos docs', async () => {
  const proj = makeWorkspace([{ name: 'loja-api' }]);
  const api = proj.paths['loja-api'];
  const origin = bareOrigin(api);
  const g = (...a) => execFileSync('git', a, { cwd: api, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    writeFileSync(join(api, 'a.txt'), '1');
    g('add', '.');
    g('commit', '-q', '-m', 'código');
    const reviewed = g('rev-parse', 'HEAD');
    mkdirSync(join(api, 'docs', 'system'), { recursive: true });
    writeFileSync(join(api, 'docs', 'system', 'product.md'), `<!--\nrevisado-até: ${reviewed}\n-->\n# Loja\n`);
    g('add', '.');
    g('commit', '-q', '-m', 'docs');
    writeFileSync(join(api, 'a.txt'), '2');
    g('commit', '-q', '-am', 'cancelamento parcial');
    g('push', '-q', 'origin', 'HEAD:develop');

    process.chdir(api);
    mock = mockFetch([
      ['GET', /\/Loja\/_apis\/git\/repositories$/, () => ({ body: { value: [{ id: 'r1', name: 'loja-api', defaultBranch: 'refs/heads/main' }] } })],
      ['GET', /\/items$/, () => ({ body: { path: '/.factory/project.json' } })],
    ]);
    // O clone do PO está na develop, mas parado no primeiro commit.
    g('switch', '-q', '-c', 'develop', reviewed);
    let [repo] = (await dispatch(['repos', '--fetch'])).repos;
    assert.equal(repo.git.fetched, true);
    assert.equal(repo.git.readDirect, false, 'atrás do origin: ler pelo git');
    [repo] = (await dispatch(['repos', '--fetch', '--update'])).repos;
    assert.equal(repo.git.updated, true);
    assert.equal(repo.git.readDirect, true);
    assert.equal(repo.git.reviewedUntil, reviewed);
    assert.equal(repo.git.commitsSinceDocsTotal, 2);
    assert.match(repo.git.commitsSinceDocs[0], /cancelamento parcial/);

    writeFileSync(join(api, 'a.txt'), 'rascunho local');
    [repo] = (await dispatch(['repos', '--fetch'])).repos;
    assert.equal(repo.git.readDirect, false, 'árvore suja: ler pelo git');
  } finally {
    process.chdir(cwd);
    proj.cleanup();
    origin.cleanup();
  }
});

const ITERATION =/\/Loja\/Loja Team\/_apis\/work\/teamsettings\/iterations$/;
const sprint28 = { value: [{ name: 'Sprint 28', path: 'Loja\\Sprint 28', attributes: { startDate: '2026-10-19', finishDate: '2026-11-06' } }] };

test('sprint current e wi sprint põem o item na sprint atual uma vez só', async () => {
  process.chdir(ws.paths['loja-api']);
  let iteration = 'Loja\\Sprint 27';
  mock = mockFetch([
    ['GET', ITERATION, (req) => {
      assert.equal(req.query.$timeframe, 'current');
      return { body: sprint28 };
    }],
    ['GET', /\/_apis\/wit\/workitems\/50$/, () => ({ body: workItem(50, { 'System.IterationPath': iteration }) })],
    ['PATCH', /\/_apis\/wit\/workitems\/50$/, (req) => {
      iteration = req.body[0].value;
      return { body: workItem(50, { 'System.IterationPath': iteration }) };
    }],
  ]);
  const current = await dispatch(['sprint', 'current']);
  assert.equal(current.sprint.name, 'Sprint 28');
  let result = await dispatch(['wi', 'sprint', '--id', '50']);
  assert.equal(result.changed, true);
  assert.equal(iteration, 'Loja\\Sprint 28');
  result = await dispatch(['wi', 'sprint', '--id', '50']);
  assert.equal(result.changed, false);
  assert.equal(mock.calls.filter((c) => c.method === 'PATCH').length, 1);
});

test('wi sprint não mexe no item quando o time não tem sprint atual', async () => {
  process.chdir(ws.paths['loja-api']);
  mock = mockFetch([['GET', ITERATION, () => ({ body: { value: [] } })]]);
  const result = await dispatch(['wi', 'sprint', '--id', '50']);
  assert.equal(result.changed, false);
  assert.match(result.note, /sprint atual/);
});

test('wi task cria a task de horas na sprint, filha do PRD, e a mesma chave atualiza', async () => {
  process.chdir(ws.paths['loja-api']);
  let task = null;
  mock = mockFetch([
    connection,
    ['GET', ITERATION, () => ({ body: sprint28 })],
    ['POST', /\/_apis\/wit\/wiql$/, (req) => {
      assert.match(req.body.query, /factory-key:task-dev-60/);
      return { body: { workItems: task ? [{ id: task.id }] : [] } };
    }],
    ['GET', /\/_apis\/wit\/workitems\/60$/, () => ({ body: workItem(60, { 'System.AreaPath': 'Loja\\Pedidos', 'System.IterationPath': 'Loja\\Sprint 27' }) })],
    ['POST', /\/_apis\/wit\/workitems\/\$Task$/, (req) => {
      const field = (name) => req.body.find((op) => op.path === `/fields/${name}`)?.value;
      task = workItem(61, {
        'System.WorkItemType': 'Task',
        'System.State': 'New',
        'System.Title': field('System.Title'),
        'System.Tags': field('System.Tags'),
        'System.IterationPath': field('System.IterationPath'),
      });
      return { body: task };
    }],
    ['GET', /\/_apis\/wit\/workitems\/61$/, () => ({ body: task })],
    ['PATCH', /\/_apis\/wit\/workitems\/61$/, (req) => {
      for (const op of req.body) task.fields[op.path.replace('/fields/', '')] = op.value;
      return { body: task };
    }],
  ]);

  const created = await dispatch(['wi', 'task', '--id', '60', '--key', 'dev-60', '--title', 'Desenvolvimento (dev)', '--state', 'active', '--assign', 'me']);
  assert.equal(created.created, true);
  const post = mock.calls.find((c) => c.method === 'POST' && /\$Task$/.test(c.path));
  const op = (path) => post.body.find((o) => o.path === path);
  assert.equal(op('/fields/System.IterationPath').value, 'Loja\\Sprint 28', 'nasce na sprint atual, não na do PRD');
  assert.equal(op('/fields/System.AreaPath').value, 'Loja\\Pedidos');
  assert.equal(op('/fields/System.AssignedTo').value, 'ana@contoso.com');
  assert.equal(op('/fields/Microsoft.VSTS.Scheduling.CompletedWork'), undefined, 'sem horas declaradas, nada de horas');
  assert.match(op('/relations/-').value.rel, /Hierarchy-Reverse/);
  assert.equal(created.task.state, 'Active');

  const closed = await dispatch(['wi', 'task', '--id', '60', '--key', 'dev-60', '--hours', '6,5', '--state', 'closed']);
  assert.equal(closed.created, false);
  assert.equal(closed.updated, true);
  assert.equal(task.fields['Microsoft.VSTS.Scheduling.CompletedWork'], 6.5);
  assert.equal(task.fields['Microsoft.VSTS.Scheduling.RemainingWork'], 0);
  assert.equal(task.fields['System.State'], 'Closed');
  assert.equal(closed.task.hours, 6.5);

  const again = await dispatch(['wi', 'task', '--id', '60', '--key', 'dev-60', '--state', 'closed']);
  assert.equal(again.updated, false, 'rodar de novo não escreve nada');
  assert.equal(mock.calls.filter((c) => c.method === 'POST' && /\$Task$/.test(c.path)).length, 1);
});

test('wi task usa o tipo de task do repo e recusa horas que não são número', async () => {
  const front = makeWorkspace([{ name: 'loja-front', project: { ado: { taskType: 'Frontend' } } }]);
  try {
    process.chdir(front.paths['loja-front']);
    mock = mockFetch([
      ['GET', ITERATION, () => ({ body: { value: [] } })],
      ['POST', /\/_apis\/wit\/wiql$/, () => ({ body: { workItems: [] } })],
      ['GET', /\/_apis\/wit\/workitems\/70$/, () => ({ body: workItem(70, { 'System.IterationPath': 'Loja\\Sprint 28' }) })],
      ['POST', /\/_apis\/wit\/workitems\/\$Frontend$/, () => ({ body: workItem(71, { 'System.WorkItemType': 'Frontend', 'System.State': 'New' }) })],
    ]);
    const result = await dispatch(['wi', 'task', '--id', '70', '--key', 'dev-70', '--title', 'Desenvolvimento (dev)']);
    assert.equal(result.task.type, 'Frontend');
    const post = mock.calls.find((c) => c.method === 'POST' && /\$Frontend$/.test(c.path));
    assert.equal(post.body.find((o) => o.path === '/fields/System.IterationPath').value, 'Loja\\Sprint 28', 'sem sprint atual, fica na do PRD');
    await expectError(dispatch(['wi', 'task', '--id', '70', '--key', 'dev-70', '--hours', 'duas']), 'config', /--hours/);
  } finally {
    process.chdir(cwd);
    front.cleanup();
  }
});

test('a task do PO usa o tipo genérico mesmo no repo com tipo próprio', async () => {
  const front = makeWorkspace([{ name: 'loja-front', project: { ado: { taskType: 'Frontend' } } }]);
  try {
    process.chdir(front.paths['loja-front']);
    mock = mockFetch([
      ['GET', ITERATION, () => ({ body: sprint28 })],
      ['POST', /\/_apis\/wit\/wiql$/, () => ({ body: { workItems: [] } })],
      ['GET', /\/_apis\/wit\/workitems\/72$/, () => ({ body: workItem(72) })],
      ['POST', /\/_apis\/wit\/workitems\/\$Task$/, () => ({ body: workItem(73, { 'System.WorkItemType': 'Task', 'System.State': 'New' }) })],
    ]);
    const result = await dispatch(['wi', 'task', '--id', '72', '--key', 'po-72', '--title', 'Especificação (PO)', '--role', 'po']);
    assert.equal(result.task.type, 'Task');
  } finally {
    process.chdir(cwd);
    front.cleanup();
  }
});

const STATES_OK = ['GET', /\/workitemtypes\/(User Story|Bug)\/states$/, () => ({ body: { value: ['New', 'Ready', 'Executando', 'Revisao', 'Integrado', 'Homologando', 'Closed', 'Removed'].map((name) => ({ name })) } })];
const TEAM = /\/Loja\/Loja Team\/_apis\/work\/teamsettings$/;

test('setup na pasta de trabalho confere e aplica só o que é do projeto: estados e time', async () => {
  const only = makeWorkspace([{ name: 'loja-api' }, { name: 'loja-front' }]);
  try {
    process.chdir(only.root);
    let bugsBehavior = 'asTasks';
    mock = mockFetch([
      STATES_OK,
      ['GET', TEAM, () => ({ body: { bugsBehavior } })],
      ['PATCH', TEAM, (req) => {
        bugsBehavior = req.body.bugsBehavior;
        return { body: { bugsBehavior } };
      }],
    ]);
    const check = await dispatch(['setup', 'check']);
    assert.deepEqual(check.states.missing, {});
    assert.equal(check.team.ok, false);
    assert.equal(check.team.bugsBehavior, 'asTasks');
    assert.equal(check.branches, undefined, 'branches e policies são de cada repo');

    const applied = await dispatch(['setup', 'apply']);
    assert.equal(applied.team.changed, true);
    assert.equal(bugsBehavior, 'asRequirements');
    const again = await dispatch(['setup', 'apply']);
    assert.equal(again.team.changed, false);
    assert.equal(mock.calls.filter((c) => c.method === 'PATCH').length, 1);
    await expectError(dispatch(['setup', 'apply', '--only', 'branches']), 'config', /--repo/);
  } finally {
    process.chdir(cwd);
    only.cleanup();
  }
});

test('doctor aponta tipo de task do repo que não existe no processo', async () => {
  const front = makeWorkspace([{ name: 'loja-front', project: { ado: { taskType: 'Frontend' } } }]);
  try {
    process.chdir(front.root);
    mock = mockFetch([
      connection,
      ['GET', /\/_apis\/git\/repositories\/loja-front$/, () => ({ body: { id: 'r2', name: 'loja-front', defaultBranch: 'refs/heads/main' } })],
      ['GET', /\/refs$/, (req) => ({ body: { value: [{ name: `refs/${req.query.filter}`, objectId: 'abc' }] } })],
      STATES_OK,
      ['GET', /\/workitemtypes\/Frontend\/states$/, () => ({ status: 404, body: { message: 'tipo não existe' } })],
      ['GET', /\/policy\/types$/, () => ({ body: { value: [] } })],
      ['GET', /\/policy\/configurations$/, () => ({ body: { value: [] } })],
    ]);
    // Na pasta de trabalho não há taskType (ele é de cada repo); com --repo, há.
    await assert.rejects(dispatch(['doctor', '--for', 'deliver', '--repo', 'loja-front']), (err) => {
      const tasks = err.data.checks.find((c) => c.id === 'tasks');
      assert.equal(tasks.ok, false);
      assert.match(tasks.detail, /Frontend/);
      return true;
    });
  } finally {
    process.chdir(cwd);
    front.cleanup();
  }
});

test('wi link põe o PRD debaixo da Feature e não troca um pai existente', async () => {
  process.chdir(ws.paths['loja-api']);
  const parentRel = (id) => ({ rel: 'System.LinkTypes.Hierarchy-Reverse', url: `https://dev.azure.com/contoso/_apis/wit/workItems/${id}` });
  mock = mockFetch([
    ['GET', /\/_apis\/wit\/workitems\/80$/, () => ({ body: workItem(80) })],
    ['PATCH', /\/_apis\/wit\/workitems\/80$/, () => ({ body: workItem(80, {}, { relations: [parentRel(8)] }) })],
    ['GET', /\/_apis\/wit\/workitems\/81$/, () => ({ body: workItem(81, {}, { relations: [parentRel(9)] }) })],
  ]);
  const linked = await dispatch(['wi', 'link', '--id', '80', '--parent', '8']);
  assert.equal(linked.changed, true);
  assert.equal(linked.item.parent, 8);
  await expectError(dispatch(['wi', 'link', '--id', '81', '--parent', '8']), 'conflict', /#9/);
  const same = await dispatch(['wi', 'link', '--id', '81', '--parent', '9']);
  assert.equal(same.changed, false);
});

test('wi show diz o repo do PRD, de quem ele depende e quem depende dele', async () => {
  process.chdir(ws.paths['loja-api']);
  const rel = (kind, id) => ({ rel: `System.LinkTypes.${kind}`, url: `https://dev.azure.com/contoso/_apis/wit/workItems/${id}` });
  mock = mockFetch([
    ['GET', /\/_apis\/wit\/workitems\/91$/, () => ({ body: workItem(91, { 'System.Tags': 'factory-key:prd-a; repo:loja-api' }, { relations: [rel('Hierarchy-Reverse', 90), rel('Dependency-Forward', 92)] }) })],
  ]);
  const { item } = await dispatch(['wi', 'show', '--id', '91']);
  assert.equal(item.repo, 'loja-api');
  assert.equal(item.parent, 90);
  assert.deepEqual(item.dependents, [92]);
  assert.deepEqual(item.dependsOn, []);
});

test('wi search filtra pelos filhos de uma Feature e mostra o repo de cada PRD', async () => {
  process.chdir(ws.paths['loja-api']);
  mock = mockFetch([
    ['POST', /\/_apis\/wit\/wiql$/, (req) => {
      assert.match(req.body.query, /\[System\.Parent\] = 90/);
      return { body: { workItems: [{ id: 91 }, { id: 92 }] } };
    }],
    ['POST', /\/workitemsbatch$/, () => ({ body: { value: [
      { id: 91, fields: { 'System.Title': 'API', 'System.State': 'Integrado', 'System.WorkItemType': 'User Story', 'System.Tags': 'repo:loja-api; factory-key:prd-a', 'System.Parent': 90 } },
      { id: 92, fields: { 'System.Title': 'Tela', 'System.State': 'Ready', 'System.WorkItemType': 'User Story', 'System.Tags': 'repo:loja-front', 'System.Parent': 90 } },
    ] } })],
  ]);
  const result = await dispatch(['wi', 'search', '--parent', '90']);
  assert.deepEqual(result.items.map((i) => [i.id, i.repo, i.parent]), [[91, 'loja-api', 90], [92, 'loja-front', 90]]);
});

test('doctor do front aponta o serviço cujo repo não está clonado ao lado', async () => {
  const front = makeWorkspace([{ name: 'loja-front', project: { run: { install: 'npm ci', test: 'npm test', services: [{ repo: 'loja-api', env: 'API_URL' }] } } }]);
  try {
    process.chdir(front.paths['loja-front']);
    mock = mockFetch([
      connection,
      ['GET', /\/_apis\/git\/repositories\/loja-front$/, () => ({ body: { id: 'r2', name: 'loja-front', defaultBranch: 'refs/heads/main' } })],
      ['GET', /\/refs$/, (req) => ({ body: { value: [{ name: `refs/${req.query.filter}`, objectId: 'abc' }] } })],
      ['GET', /\/workitemtypes\/(User Story|Bug)\/states$/, () => ({ body: { value: ['New', 'Ready', 'Executando', 'Revisao', 'Integrado', 'Homologando', 'Closed'].map((name) => ({ name })) } })],
      ['GET', /\/policy\/types$/, () => ({ body: { value: [{ id: 'p1', displayName: 'Minimum number of reviewers' }] } })],
      ['GET', /\/policy\/configurations$/, () => ({ body: { value: [{ type: { id: 'p1' }, isEnabled: true }] } })],
    ]);
    await assert.rejects(dispatch(['doctor', '--for', 'deliver']), (err) => {
      const services = err.data.checks.find((c) => c.id === 'services');
      assert.equal(services.ok, false);
      assert.match(services.detail, /loja-api/);
      assert.deepEqual(err.data.checks.filter((c) => c.required && !c.ok).map((c) => c.id), ['services']);
      return true;
    });
  } finally {
    process.chdir(cwd);
    front.cleanup();
  }
});

test('doctor na pasta de trabalho confere o projeto e deixa branches e receita para cada repo', async () => {
  const only = makeWorkspace([{ name: 'loja-api' }, { name: 'loja-front' }]);
  try {
    process.chdir(only.root);
    mock = mockFetch([
      connection,
      ['GET', /\/_apis\/projects\/Loja$/, () => ({ body: { id: 'proj-1', name: 'Loja' } })],
      ['GET', /\/workitemtypes\/(User Story|Bug)\/states$/, () => ({ body: { value: ['New', 'Ready', 'Executando', 'Revisao', 'Integrado', 'Homologando', 'Closed'].map((name) => ({ name })) } })],
    ]);
    const result = await dispatch(['doctor', '--for', 'prd']);
    const ids = result.checks.map((c) => c.id);
    assert.ok(ids.includes('project'));
    assert.ok(!ids.includes('branches') && !ids.includes('recipe'));
    assert.match(result.checks.find((c) => c.id === 'remote').detail, /pasta de trabalho com 2 clone/);
  } finally {
    process.chdir(cwd);
    only.cleanup();
  }
});

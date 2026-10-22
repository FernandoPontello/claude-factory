import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo, mockFetch, ME, workItem } from './helpers.mjs';
import { parseRemote } from '../lib/config.mjs';
import { FactoryError } from '../lib/cli.mjs';
import { dispatch } from '../ado.mjs';

let repo;
let cwd;
let mock;

before(() => {
  process.env.ADO_TOKEN = 'token-de-teste';
  repo = makeRepo();
  cwd = process.cwd();
  process.chdir(repo.dir);
});

after(() => {
  process.chdir(cwd);
  repo.cleanup();
});

afterEach(() => mock?.restore());

const connection = ['GET', /\/_apis\/connectionData$/, () => ({ body: ME })];

async function expectError(promise, code) {
  await assert.rejects(promise, (err) => err instanceof FactoryError && err.code === code);
}

test('parseRemote reconhece os formatos de URL do Azure DevOps', () => {
  const want = { org: 'contoso', project: 'Loja Online', repo: 'portal' };
  assert.deepEqual(parseRemote('https://dev.azure.com/contoso/Loja%20Online/_git/portal'), want);
  assert.deepEqual(parseRemote('https://contoso@dev.azure.com/contoso/Loja%20Online/_git/portal'), want);
  assert.deepEqual(parseRemote('https://contoso.visualstudio.com/DefaultCollection/Loja%20Online/_git/portal'), want);
  assert.deepEqual(parseRemote('git@ssh.dev.azure.com:v3/contoso/Loja%20Online/portal'), want);
  assert.equal(parseRemote('https://github.com/contoso/portal.git'), null);
});

test('wi claim reserva um item Ready com controle de concorrência e grava o carimbo', async () => {
  mock = mockFetch([
    connection,
    ['GET', /\/_apis\/wit\/workitems\/12$/, () => ({ body: workItem(12, {}, { rev: 7 }) })],
    ['PATCH', /\/_apis\/wit\/workitems\/12$/, (req) => ({ body: workItem(12, { 'System.State': 'Executando', 'System.AssignedTo': { uniqueName: 'ana@contoso.com' } }, { rev: 8 }) })],
  ]);
  const result = await dispatch(['wi', 'claim', '--id', '12']);
  assert.equal(result.claimed, true);
  assert.equal(result.resumed, false);
  const patch = mock.calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch.body[0], { op: 'test', path: '/rev', value: 7 });
  assert.equal(patch.body[1].value, 'Executando');
  assert.equal(patch.body[2].value, 'ana@contoso.com');
  const marks = readFileSync(join(repo.dir, '.factory', 'runs', '12', 'marks.jsonl'), 'utf8');
  assert.match(marks, /"event":"claimed"/);
});

test('wi claim retoma o próprio item sem escrever no board', async () => {
  mock = mockFetch([
    connection,
    ['GET', /\/_apis\/wit\/workitems\/13$/, () => ({ body: workItem(13, { 'System.State': 'Executando', 'System.AssignedTo': { uniqueName: 'ANA@contoso.com' } }) })],
  ]);
  const result = await dispatch(['wi', 'claim', '--id', '13']);
  assert.equal(result.resumed, true);
  assert.equal(mock.calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('wi claim recusa item de outra pessoa ou fora de Ready', async () => {
  mock = mockFetch([
    connection,
    ['GET', /\/_apis\/wit\/workitems\/14$/, () => ({ body: workItem(14, { 'System.AssignedTo': { uniqueName: 'bruno@contoso.com' } }) })],
    ['GET', /\/_apis\/wit\/workitems\/15$/, () => ({ body: workItem(15, { 'System.State': 'New' }) })],
  ]);
  await expectError(dispatch(['wi', 'claim', '--id', '14']), 'conflict');
  await expectError(dispatch(['wi', 'claim', '--id', '15']), 'conflict');
});

test('wi claim traduz a corrida perdida (412) em conflito', async () => {
  mock = mockFetch([
    connection,
    ['GET', /\/_apis\/wit\/workitems\/16$/, () => ({ body: workItem(16) })],
    ['PATCH', /\/_apis\/wit\/workitems\/16$/, () => ({ status: 412, body: { message: 'rev mismatch' } })],
  ]);
  await expectError(dispatch(['wi', 'claim', '--id', '16']), 'conflict');
});

test('wi claim retoma item em Revisao do próprio dev (comentários da PR)', async () => {
  mock = mockFetch([
    connection,
    ['GET', /\/_apis\/wit\/workitems\/17$/, () => ({ body: workItem(17, { 'System.State': 'Revisao', 'System.AssignedTo': { uniqueName: 'ana@contoso.com' } }) })],
  ]);
  const result = await dispatch(['wi', 'claim', '--id', '17']);
  assert.equal(result.resumed, true);
  assert.equal(mock.calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('wi state não escreve estados de merge e nunca faz o item voltar', async () => {
  mock = mockFetch([
    ['GET', /\/_apis\/wit\/workitems\/18$/, () => ({ body: workItem(18, { 'System.State': 'Integrado' }) })],
    ['GET', /\/_apis\/wit\/workitems\/19$/, () => ({ body: workItem(19, { 'System.State': 'Ready' }) })],
  ]);
  await expectError(dispatch(['wi', 'state', '--id', '18', '--to', 'integrated']), 'config');
  await expectError(dispatch(['wi', 'state', '--id', '18', '--to', 'Closed']), 'config');
  const back = await dispatch(['wi', 'state', '--id', '18', '--to', 'review']);
  assert.equal(back.changed, false);
  const skip = await dispatch(['wi', 'state', '--id', '19', '--to', 'review']);
  assert.equal(skip.changed, false, 'Revisao só vem de Executando');
  assert.equal(mock.calls.filter((c) => c.method === 'PATCH').length, 0);
});

test('POST de criação não é repetido depois de 5xx', async () => {
  mock = mockFetch([
    ['POST', /\/_apis\/wit\/workitems\/\$User Story$/, () => ({ status: 503, body: { message: 'indisponível' } })],
  ]);
  await expectError(dispatch(['wi', 'create', '--type', 'feature', '--title', 'X']), 'error');
  assert.equal(mock.calls.filter((c) => c.method === 'POST').length, 1);
});

test('wi create com chave existente aplica o novo estado enquanto o item é do PO', async () => {
  mock = mockFetch([
    ['POST', /\/_apis\/wit\/wiql$/, () => ({ body: { workItems: [{ id: 32 }] } })],
    ['GET', /\/_apis\/wit\/workitems\/32$/, () => ({ body: workItem(32, { 'System.State': 'New' }) })],
    ['PATCH', /\/_apis\/wit\/workitems\/32$/, (req) => ({ body: workItem(32, { 'System.State': req.body.at(-1).value }) })],
  ]);
  const result = await dispatch(['wi', 'create', '--type', 'feature', '--title', 'X', '--key', 'prd-x', '--state', 'ready']);
  assert.equal(result.created, false);
  assert.equal(result.updated, true);
  assert.equal(result.item.state, 'Ready');
  await expectError(dispatch(['wi', 'create', '--type', 'feature', '--title', 'X', '--state', 'running']), 'config');
});

test('pr reply não repete a mesma resposta na thread', async () => {
  const file = join(repo.dir, 'reply.md');
  writeFileSync(file, 'Corrigido em abc123.');
  mock = mockFetch([
    repoRoute(),
    ['GET', /\/threads$/, () => ({ body: { value: [{ id: 5, status: 'active', comments: [{ id: 1, content: 'Faltou validar', commentType: 'text' }, { id: 2, content: 'Corrigido em abc123.', commentType: 'text' }] }] } })],
    ['PATCH', /\/threads\/5$/, () => ({ body: {} })],
  ]);
  const result = await dispatch(['pr', 'reply', '--id', '600', '--thread', '5', '--file', file, '--resolve']);
  assert.equal(result.replied, false);
  assert.equal(mock.calls.filter((c) => c.method === 'POST').length, 0);
});

test('wi comment não duplica um comentário com o mesmo marcador', async () => {
  const file = join(repo.dir, 'kickoff.md');
  writeFileSync(file, 'Decisões do kickoff');
  let comments = [{ id: 1, text: '<p>[factory:kickoff]</p><p>antigo</p>' }];
  mock = mockFetch([
    ['GET', /\/comments$/, () => ({ body: { comments } })],
    ['POST', /\/comments$/, (req) => ({ body: { id: 2, text: req.body.text } })],
  ]);
  let result = await dispatch(['wi', 'comment', '--id', '20', '--marker', 'kickoff', '--file', file]);
  assert.equal(result.added, false);
  comments = [];
  result = await dispatch(['wi', 'comment', '--id', '20', '--marker', 'kickoff', '--file', file]);
  assert.equal(result.added, true);
  const post = mock.calls.find((c) => c.method === 'POST');
  assert.match(post.body.text, /^\[factory:kickoff\]/);
  assert.equal(post.query.format, 'markdown');
});

test('wi create com chave recupera o item existente em vez de duplicar', async () => {
  mock = mockFetch([
    ['POST', /\/_apis\/wit\/wiql$/, (req) => {
      assert.match(req.body.query, /factory-key:prd-abc/);
      return { body: { workItems: [{ id: 30 }] } };
    }],
    ['GET', /\/_apis\/wit\/workitems\/30$/, () => ({ body: workItem(30) })],
  ]);
  const result = await dispatch(['wi', 'create', '--type', 'feature', '--title', 'X', '--key', 'prd-abc']);
  assert.equal(result.created, false);
  assert.equal(result.item.id, 30);
  assert.equal(mock.calls.filter((c) => /\$User/.test(c.path)).length, 0);
});

test('wi create grava descrição em Markdown e move para Ready', async () => {
  const file = join(repo.dir, 'prd.md');
  writeFileSync(file, '# PRD\n\n## 1. Problema e valor');
  mock = mockFetch([
    ['POST', /\/_apis\/wit\/workitems\/\$User Story$/, (req) => ({ body: workItem(31, { 'System.State': 'New' }) })],
    ['PATCH', /\/_apis\/wit\/workitems\/31$/, () => ({ body: workItem(31, { 'System.State': 'Ready' }) })],
  ]);
  const result = await dispatch(['wi', 'create', '--type', 'feature', '--title', 'Cancelar pedido', '--description-file', file, '--state', 'ready']);
  assert.equal(result.created, true);
  assert.equal(result.item.state, 'Ready');
  const create = mock.calls.find((c) => c.method === 'POST');
  assert.ok(create.body.some((op) => op.path === '/multilineFieldsFormat/System.Description' && op.value === 'Markdown'));
});

test('wi deps lista o que ainda bloqueia o início', async () => {
  const rel = (id) => ({ rel: 'System.LinkTypes.Dependency-Reverse', url: `https://dev.azure.com/contoso/_apis/wit/workItems/${id}` });
  mock = mockFetch([
    ['GET', /\/_apis\/wit\/workitems\/40$/, () => ({ body: workItem(40, {}, { relations: [rel(41), rel(42)] }) })],
    ['POST', /\/workitemsbatch$/, () => ({ body: { value: [
      { id: 41, fields: { 'System.Title': 'Fundação', 'System.State': 'Integrado' } },
      { id: 42, fields: { 'System.Title': 'Login', 'System.State': 'Executando' } },
    ] } })],
  ]);
  const result = await dispatch(['wi', 'deps', '--id', '40']);
  assert.equal(result.dependsOn.length, 2);
  assert.deepEqual(result.blocked.map((d) => d.id), [42]);
});

function repoRoute() {
  return ['GET', /\/_apis\/git\/repositories\/portal$/, () => ({ body: { id: 'repo-1', name: 'portal', defaultBranch: 'refs/heads/main', project: { id: 'proj-1' } } })];
}

test('pr create da feature acrescenta o estado de merge e liga a transição', async () => {
  const file = join(repo.dir, 'pr.md');
  writeFileSync(file, 'Resumo do relatório');
  mock = mockFetch([
    connection,
    repoRoute(),
    ['GET', /\/pullrequests$/, () => ({ body: { value: [] } })],
    ['POST', /\/pullrequests$/, (req) => ({ body: { pullRequestId: 567, ...req.body } })],
    ['PATCH', /\/pullrequests\/567$/, () => ({ body: { pullRequestId: 567 } })],
  ]);
  const result = await dispatch(['pr', 'create', '--source', 'feature/12-x', '--target', 'develop', '--title', 'Cancelar pedido', '--description-file', file, '--wi', '12', '--on-merge', 'integrated', '--delete-source', '--run', '12']);
  assert.equal(result.created, true);
  const create = mock.calls.find((c) => c.method === 'POST' && /pullrequests$/.test(c.path));
  assert.match(create.body.description, /Integrado #12$/);
  assert.deepEqual(create.body.workItemRefs, [{ id: '12' }]);
  const auto = mock.calls.find((c) => c.method === 'PATCH');
  assert.equal(auto.body.completionOptions.transitionWorkItems, true);
  assert.equal(auto.body.completionOptions.mergeStrategy, 'squash');
  assert.equal(auto.body.completionOptions.deleteSourceBranch, true);
  assert.match(auto.body.completionOptions.mergeCommitMessage, /#12/);
  assert.match(readFileSync(join(repo.dir, '.factory', 'runs', '12', 'marks.jsonl'), 'utf8'), /"event":"delivered"/);
});

test('pr create de back-merge não transiciona o item e reaproveita a PR ativa', async () => {
  mock = mockFetch([
    connection,
    repoRoute(),
    ['GET', /\/pullrequests$/, () => ({ body: { value: [{ pullRequestId: 600 }] } })],
    ['PATCH', /\/pullrequests\/600$/, () => ({ body: { pullRequestId: 600 } })],
    ['GET', /\/_apis\/wit\/workitems\/12$/, () => ({ body: workItem(12) })],
    ['PATCH', /\/_apis\/wit\/workitems\/12$/, () => ({ body: workItem(12) })],
  ]);
  const result = await dispatch(['pr', 'create', '--source', 'bugfix/12-x', '--target', 'develop', '--title', 'Back-merge', '--wi', '12', '--merge', 'merge']);
  assert.equal(result.created, false);
  const patches = mock.calls.filter((c) => c.method === 'PATCH' && /pullrequests/.test(c.path));
  const auto = patches.find((c) => c.body.completionOptions);
  assert.equal(auto.body.completionOptions.transitionWorkItems, false);
  assert.equal(auto.body.completionOptions.mergeStrategy, 'noFastForward');
  assert.doesNotMatch(auto.body.completionOptions.mergeCommitMessage, /#12/, 'back-merge não cita o item no commit');
  const link = mock.calls.find((c) => c.method === 'PATCH' && /workitems\/12$/.test(c.path));
  assert.match(link.body[0].value.url, /PullRequestId\/proj-1%2Frepo-1%2F600$/);
});

test('pr create recusa descrição acima do limite do Azure DevOps', async () => {
  const file = join(repo.dir, 'longo.md');
  writeFileSync(file, 'x'.repeat(4100));
  mock = mockFetch([]);
  await expectError(dispatch(['pr', 'create', '--source', 'a', '--target', 'b', '--title', 't', '--description-file', file]), 'config');
});

test('request tenta de novo em 503 e traduz 401 em erro de login', async () => {
  let n = 0;
  mock = mockFetch([
    ['GET', /\/_apis\/connectionData$/, () => (++n < 2 ? { status: 503, body: {} } : { body: ME })],
  ]);
  const result = await dispatch(['whoami']);
  assert.equal(result.user.email, 'ana@contoso.com');
  assert.equal(n, 2);
  mock.restore();
  mock = mockFetch([['GET', /\/_apis\/connectionData$/, () => ({ status: 401, body: { message: 'expired' } })]]);
  await expectError(dispatch(['whoami']), 'auth');
});

test('doctor aponta estados que faltam no processo', async () => {
  writeFileSync(join(repo.dir, '.factory', 'project.json'), JSON.stringify({ run: { install: 'npm ci', test: 'npm test', start: 'npm start', ready: 'http://localhost:$PORT' } }));
  mock = mockFetch([
    connection,
    repoRoute(),
    ['GET', /\/refs$/, (req) => ({ body: { value: [{ name: `refs/${req.query.filter}`, objectId: 'abc' }] } })],
    ['GET', /\/workitemtypes\/User Story\/states$/, () => ({ body: { value: ['New', 'Ready', 'Executando', 'Revisao', 'Integrado', 'Homologando', 'Closed'].map((name) => ({ name })) } })],
    ['GET', /\/workitemtypes\/Bug\/states$/, () => ({ body: { value: ['New', 'Active', 'Closed'].map((name) => ({ name })) } })],
    ['GET', /\/policy\/types$/, () => ({ body: { value: [{ id: 'p1', displayName: 'Minimum number of reviewers' }] } })],
    ['GET', /\/policy\/configurations$/, () => ({ body: { value: [{ type: { id: 'p1' }, isEnabled: true }] } })],
  ]);
  await assert.rejects(dispatch(['doctor', '--for', 'deliver']), (err) => {
    assert.equal(err.code, 'config');
    const states = err.data.checks.find((c) => c.id === 'states');
    assert.equal(states.ok, false);
    assert.match(states.detail, /Bug: Ready/);
    assert.ok(err.data.checks.find((c) => c.id === 'branches').ok);
    return true;
  });
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers.mjs';
import { FactoryError } from '../lib/cli.mjs';
import { dispatch, slugify, trackFor } from '../run.mjs';
import { parseJUnit, parsePlaywrightAcs, parsePlaywrightJson, phaseDurations, verdictOf, gateStatus } from '../lib/report.mjs';
import { recipeForPlatform } from '../lib/config.mjs';

test('recipeForPlatform aplica o override do sistema', () => {
  const run = { start: 'npm start', test: 'npm test', win32: { start: 'npm.cmd start' }, posix: { test: 'make test' } };
  assert.deepEqual(recipeForPlatform(run, 'win32'), { start: 'npm.cmd start', test: 'npm test' });
  assert.deepEqual(recipeForPlatform(run, 'linux'), { start: 'npm start', test: 'make test' });
  assert.equal(recipeForPlatform(null), null);
});

let repo;
let cwd;
const node = JSON.stringify(process.execPath);

before(() => {
  repo = makeRepo({
    project: {
      maxAttempts: 2,
      run: {
        install: `${node} -e "process.exit(0)"`,
        build: `${node} -e "process.exit(0)"`,
        test: `${node} -e "require('fs').writeFileSync('junit.xml','<testsuite tests=\\"5\\" failures=\\"1\\" skipped=\\"0\\"></testsuite>');process.exit(1)"`,
        testReport: 'junit.xml',
      },
    },
  });
  cwd = process.cwd();
  process.chdir(repo.dir);
});

after(() => {
  process.chdir(cwd);
  repo.cleanup();
});

test('slugify tira acento e pontuação', () => {
  assert.equal(slugify('Cliente cancela pedido antes do envio!'), 'cliente-cancela-pedido-antes-do-envio');
  assert.equal(slugify('Ação: São João'), 'acao-sao-joao');
});

test('trackFor monta as três trilhas com os back-merges certos', () => {
  const cfg = { branches: { develop: 'develop', qa: 'QA' } };
  const feature = trackFor(cfg, 'feature', 1, 'Nova tela', 'main');
  assert.equal(feature.branch, 'feature/1-nova-tela');
  assert.equal(feature.base, 'develop');
  assert.deepEqual(feature.prs.map((p) => p.target), ['develop']);
  const bugfix = trackFor(cfg, 'bugfix', 2, 'Erro', 'main');
  assert.equal(bugfix.base, 'QA');
  assert.deepEqual(bugfix.prs.map((p) => [p.target, Boolean(p.backMerge)]), [['QA', false], ['develop', true]]);
  const hotfix = trackFor(cfg, 'hotfix', 3, 'Urgente', 'main');
  assert.equal(hotfix.base, 'main');
  assert.deepEqual(hotfix.prs.map((p) => p.target), ['main', 'QA', 'develop']);
  assert.throws(() => trackFor(cfg, 'outro', 4, 'x', 'main'), FactoryError);
});

test('init cria o run uma vez e retoma depois', async () => {
  const first = await dispatch(['init', '--id', '50', '--kind', 'feature', '--title', 'Cancelar pedido']);
  assert.equal(first.resumed, false);
  assert.equal(first.state.branch, 'feature/50-cancelar-pedido');
  assert.deepEqual(first.state.gates, ['build', 'test']);
  const again = await dispatch(['init', '--id', '50', '--kind', 'bugfix', '--title', 'Outro']);
  assert.equal(again.resumed, true);
  assert.equal(again.state.kind, 'feature');
});

test('check registra resultado, contagem do JUnit e para no limite de falhas seguidas', async () => {
  const ok = await dispatch(['check', '--id', '50', '--gate', 'build']);
  assert.equal(ok.check.ok, true);
  assert.equal(ok.check.attempt, 1);

  const fail1 = await dispatch(['check', '--id', '50', '--gate', 'test']);
  assert.equal(fail1.check.ok, false);
  assert.deepEqual(fail1.check.counts, { total: 5, failed: 1, skipped: 0, passed: 4 });
  await dispatch(['check', '--id', '50', '--gate', 'test']);
  await assert.rejects(dispatch(['check', '--id', '50', '--gate', 'test']), (err) => err.code === 'limit');
  // Ciclo novo não é saída do limite: só vale depois de um relatório novo.
  await assert.rejects(dispatch(['check', '--id', '50', '--gate', 'test', '--new-cycle']), (err) => err.code === 'limit');
  assert.ok('sha' in fail1.check && 'dirty' in fail1.check, 'cada check grava commit e árvore');
});

test('check recusa gate fora da receita', async () => {
  await assert.rejects(dispatch(['check', '--id', '50', '--gate', 'e2e']), (err) => err.code === 'config');
});

test('report acusa verificação final sem registro e gera o resumo da PR', async () => {
  const dir = join(repo.dir, '.factory', 'runs', '50');
  writeFileSync(join(dir, 'report.json'), JSON.stringify({
    workItem: { id: 50, type: 'User Story', title: 'Cancelar pedido' },
    partA: {
      changes: ['O cliente cancela sozinho.'],
      acs: [{ id: 'AC-1', us: 'US-1', name: 'Cancela', given: 'pedido aguardando', when: 'confirma', then: 'fica cancelado', status: 'atendido', test: 'e2e/c.spec.ts › AC-1', evidence: [{ file: 'shots/ac1.png', caption: 'antes' }] }],
      validation: { steps: ['Abra o pedido'] },
    },
    partB: { kickoffDecisions: [{ id: 'K1', question: 'Onde fica a regra?', answer: 'No agregado' }], findings: [] },
  }));
  const result = await dispatch(['report', '--id', '50']);
  assert.equal(result.version, 1);
  assert.equal(result.verdict, 'com-ressalvas');
  assert.ok(result.warnings.some((w) => w.includes('falhou: test')), 'o test do ciclo terminou vermelho');
  assert.ok(result.warnings.some((w) => w.includes('print não encontrado')));
  const html = readFileSync(result.html, 'utf8');
  assert.match(html, /Relatório de entrega/);
  assert.match(html, /AC-1/);
  const summary = readFileSync(result.prSummary, 'utf8');
  assert.match(summary, /work item 50/);
  assert.doesNotMatch(summary, /#50/);
  assert.ok(summary.length < 4000);
  // Depois do relatório, o ajuste pedido pelo dev abre um ciclo novo, uma vez por relatório.
  const next = await dispatch(['check', '--id', '50', '--gate', 'test', '--new-cycle']);
  assert.equal(next.check.cycle, 2);
  assert.equal(next.check.attempt, 1);
  await assert.rejects(dispatch(['check', '--id', '50', '--gate', 'test', '--new-cycle']), (err) => err.code === 'limit');

  const again = await dispatch(['report', '--id', '50']);
  assert.equal(again.version, 2);
});

test('verdictOf exige o commit atual e o teste de cada AC passando', () => {
  const content = { partA: { acs: [{ id: 'AC-1', status: 'atendido', test: 'x' }, { id: 'AC-2', status: 'atendido', test: 'y' }] }, partB: {} };
  const head = { sha: 'abc', dirty: false };
  const checks = [
    { gate: 'test', cycle: 1, ok: true, sha: 'abc', dirty: false },
    { gate: 'e2e', cycle: 1, ok: true, sha: 'abc', dirty: false, acResults: { 'AC-1': true, 'AC-2': true } },
  ];
  assert.equal(verdictOf({ content, gates: gateStatus(checks, 1, ['test', 'e2e']), head }).ok, true);

  const stale = checks.map((c) => ({ ...c, sha: 'old' }));
  assert.match(verdictOf({ content, gates: gateStatus(stale, 1, ['test', 'e2e']), head }).warnings.join(), /commit atual/);

  const dirty = checks.map((c) => ({ ...c, dirty: true }));
  assert.equal(verdictOf({ content, gates: gateStatus(dirty, 1, ['test', 'e2e']), head }).ok, false);

  const acFailed = [checks[0], { ...checks[1], acResults: { 'AC-1': true, 'AC-2': false } }];
  assert.match(verdictOf({ content, gates: gateStatus(acFailed, 1, ['test', 'e2e']), head }).warnings.join(), /AC-2 marcado como atendido/);
});

test('parsePlaywrightAcs liga cada AC ao resultado dos seus specs', () => {
  const report = {
    suites: [{
      title: '1234-cancelar.spec.ts',
      specs: [
        { title: 'AC-1 — cancela pedido', ok: true },
        { title: 'AC-2 — enviado não cancela', ok: false },
      ],
      suites: [{ title: 'AC-3 — histórico', specs: [{ title: 'registra estorno', tests: [{ status: 'expected' }] }] }],
    }],
  };
  assert.deepEqual(parsePlaywrightAcs(report), { 'AC-1': true, 'AC-2': false, 'AC-3': true });
});

test('verdictOf só aprova com todas as verificações registradas e verdes', () => {
  const content = { partA: { acs: [{ id: 'AC-1', status: 'atendido' }] }, partB: {} };
  const checks = [
    { gate: 'build', cycle: 1, ok: true, durationMs: 10 },
    { gate: 'test', cycle: 1, ok: false, durationMs: 10 },
    { gate: 'test', cycle: 1, ok: true, durationMs: 10 },
  ];
  assert.equal(verdictOf({ content, gates: gateStatus(checks, 1, ['build', 'test']) }).ok, true);
  assert.equal(verdictOf({ content, gates: gateStatus(checks, 1, ['build', 'test', 'e2e']) }).ok, false);
  const open = { partA: content.partA, partB: { findings: [{ severity: 'alta', open: true, finding: 'x' }] } };
  assert.equal(verdictOf({ content: open, gates: gateStatus(checks, 1, ['build']) }).ok, false);
});

test('phaseDurations usa só os carimbos', () => {
  const at = (min) => new Date(Date.UTC(2026, 9, 22, 10, min)).toISOString();
  const rows = phaseDurations([
    { event: 'claimed', at: at(0) },
    { event: 'go', at: at(6) },
    { event: 'report-v1', at: at(90) },
    { event: 'report-v2', at: at(101) },
  ]);
  assert.deepEqual(rows.map((r) => [r.phase, r.ms / 60000]), [['Kickoff', 6], ['Execução até a v1', 84], ['Ajustes até a v2', 11]]);
});

test('parsers de relatório de teste', () => {
  assert.deepEqual(parseJUnit('<testsuites><testsuite tests="3" failures="0" errors="1" skipped="1"></testsuite></testsuites>'), { total: 3, failed: 1, skipped: 1, passed: 1 });
  assert.deepEqual(parsePlaywrightJson({ stats: { expected: 4, unexpected: 1, skipped: 0, flaky: 1 } }), { total: 6, passed: 5, failed: 1, skipped: 0, flaky: 1 });
});

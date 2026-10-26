// Serviços de outros repos: o front sobe a API da branch da trilha para os testes de aceite.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bareOrigin, makeWorkspace, processGone } from './helpers.mjs';
import { dispatch } from '../run.mjs';

const node = JSON.stringify(process.execPath);

let ws;
let origin;
let cwd;

function g(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

before(() => {
  cwd = process.cwd();
  ws = makeWorkspace([
    {
      name: 'loja-front',
      project: {
        run: {
          start: `${node} front.js`,
          ready: 'http://127.0.0.1:$PORT/',
          baseUrl: 'http://127.0.0.1:$PORT',
          e2e: `${node} e2e.js`,
          readyTimeoutSeconds: 20,
          // A API só aceita a origem que receber em CORS_ORIGIN, como o CORS de uma API de verdade.
          services: [{ repo: 'loja-api', env: 'API_URL', vars: { CORS_ORIGIN: '$APP_URL' } }],
        },
      },
    },
    { name: 'loja-api' },
  ]);

  // O "origin" da API é um repo bare local no lugar do Azure DevOps.
  const api = ws.paths['loja-api'];
  origin = bareOrigin(api);
  mkdirSync(join(api, '.factory'));
  writeFileSync(join(api, '.factory', 'project.json'), JSON.stringify({
    run: {
      install: `${node} install.js`,
      start: `${node} server.js`,
      ready: 'http://127.0.0.1:$PORT/health',
      baseUrl: 'http://127.0.0.1:$PORT',
      readyTimeoutSeconds: 20,
    },
  }, null, 2));
  writeFileSync(join(api, 'install.js'), "const fs = require('fs'); const n = fs.existsSync('installed.txt') ? Number(fs.readFileSync('installed.txt', 'utf8')) : 0; fs.writeFileSync('installed.txt', String(n + 1));\n");
  writeFileSync(join(api, 'server.js'), "require('http').createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ ok: true, from: 'api', cors: process.env.CORS_ORIGIN })); }).listen(Number(process.env.PORT), '127.0.0.1');\n");
  g(api, 'add', '.');
  g(api, 'commit', '-q', '-m', 'api');
  g(api, 'push', '-q', 'origin', 'HEAD:develop');
  // A cópia de trabalho do dev está em outra coisa: o serviço sobe da develop do origin, não daqui.
  writeFileSync(join(api, 'server.js'), 'process.exit(1);\n');

  const front = ws.paths['loja-front'];
  writeFileSync(join(front, 'front.js'), "require('http').createServer((q, s) => s.end(process.env.API_URL)).listen(Number(process.env.PORT), '127.0.0.1');\n");
  writeFileSync(join(front, 'e2e.js'), [
    'const page = await (await fetch(process.env.BASE_URL)).text();',
    "const health = await (await fetch(process.env.API_URL + '/health')).json();",
    'process.exit(page === process.env.API_URL && health.from === \'api\' && health.cors === process.env.BASE_URL ? 0 : 1);',
  ].join('\n').replace(/^/, '(async () => {\n') + '\n})();\n');
  process.chdir(front);
});

after(async () => {
  for (const id of ['90', '91']) {
    try {
      await dispatch(['app-stop', '--id', id, '--clean']);
    } catch {
      // run não criado ou já limpo
    }
  }
  process.chdir(cwd);
  ws.cleanup();
  origin.cleanup();
});

test('app-start sobe a API da develop numa cópia limpa e o front recebe a URL dela', async () => {
  await dispatch(['init', '--id', '90', '--kind', 'feature', '--title', 'Tela de pedidos']);
  const started = await dispatch(['app-start', '--id', '90']);
  assert.equal(started.services.length, 1);
  const [svc] = started.services;
  assert.equal(svc.repo, 'loja-api');
  assert.equal(svc.ref, 'develop');
  assert.equal(svc.fresh, true);
  assert.equal(await (await fetch(started.app.baseUrl)).text(), svc.baseUrl, 'o front recebeu a URL da API');
  const health = await (await fetch(`${svc.baseUrl}/health`)).json();
  assert.equal(health.cors, started.app.baseUrl, 'a API recebeu a URL do front antes de ele subir');

  const e2e = await dispatch(['check', '--id', '90', '--gate', 'e2e']);
  assert.equal(e2e.check.ok, true, e2e.tail);
  assert.deepEqual(e2e.check.services.map((s) => [s.repo, s.ref]), [['loja-api', 'develop']]);

  // O relatório diz contra qual versão da API o aceite rodou.
  writeFileSync(join(ws.paths['loja-front'], '.factory', 'runs', '90', 'report.json'), JSON.stringify({ workItem: { id: 90, title: 'Tela de pedidos' }, partA: { acs: [] }, partB: {} }));
  const report = await dispatch(['report', '--id', '90']);
  assert.match(readFileSync(report.html, 'utf8'), new RegExp(`contra loja-api \\(develop @ ${svc.sha.slice(0, 7)}\\)`));
  assert.match(readFileSync(report.prSummary, 'utf8'), /contra loja-api \(develop @/);

  // Subir de novo com o mesmo código não instala de novo.
  await dispatch(['app-start', '--id', '90']);
  const { state } = await dispatch(['status', '--id', '90']);
  const dir = state.services[0].dir;
  assert.equal(readFileSync(join(dir, 'installed.txt'), 'utf8'), '1');

  const stopped = await dispatch(['app-stop', '--id', '90', '--clean']);
  assert.deepEqual(stopped.services.map((s) => [s.repo, s.removed]), [['loja-api', true]]);
  assert.equal(existsSync(dir), false);
  assert.doesNotMatch(g(ws.paths['loja-api'], 'worktree', 'list'), /factory-svc/);
  assert.equal(await processGone(state.services[0].pid), true, 'o serviço foi derrubado');
});

test('prove do /setup sobe o serviço, roda o aceite e apaga a cópia no fim', async () => {
  const result = await dispatch(['prove']);
  assert.equal(result.ok, true, JSON.stringify(result.steps));
  assert.deepEqual(result.steps.map((s) => s.gate), ['services', 'start', 'e2e']);
  assert.doesNotMatch(g(ws.paths['loja-api'], 'worktree', 'list'), /factory-svc/);
});

test('no bugfix o serviço sai da QA; sem a branch no origin, o erro diz o que fazer', async () => {
  await dispatch(['init', '--id', '91', '--kind', 'bugfix', '--title', 'Corrige total']);
  await assert.rejects(dispatch(['app-start', '--id', '91']), (err) => {
    assert.equal(err.code, 'config');
    assert.match(err.message, /origin\/QA/);
    return true;
  });
});

test('serviço de repo que não está clonado na pasta de trabalho é erro de configuração', async () => {
  const lonely = makeWorkspace([{ name: 'loja-front', project: { run: { start: 'x', ready: 'http://127.0.0.1:$PORT/', services: [{ repo: 'loja-pagamentos', env: 'PAY_URL' }] } } }]);
  try {
    process.chdir(lonely.paths['loja-front']);
    await dispatch(['init', '--id', '92', '--kind', 'feature', '--title', 'Pagar']);
    await assert.rejects(dispatch(['app-start', '--id', '92']), (err) => err.code === 'config' && /loja-pagamentos/.test(err.message));
  } finally {
    process.chdir(ws.paths['loja-front']);
    lonely.cleanup();
  }
});

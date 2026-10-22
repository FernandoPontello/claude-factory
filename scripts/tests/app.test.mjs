import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRepo } from './helpers.mjs';
import { dispatch } from '../run.mjs';

let repo;
let cwd;
const node = JSON.stringify(process.execPath);

before(() => {
  repo = makeRepo({
    project: {
      run: {
        start: `${node} -e "require('http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT))"`,
        ready: 'http://127.0.0.1:$PORT/',
        baseUrl: 'http://127.0.0.1:$PORT',
        e2e: `${node} -e "fetch(process.env.BASE_URL).then(r=>r.text()).then(t=>process.exit(t==='ok'?0:1))"`,
        readyTimeoutSeconds: 20,
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

test('prove sobe o app pela receita, roda o e2e e derruba no fim', async () => {
  const result = await dispatch(['prove']);
  assert.equal(result.ok, true);
  const start = result.steps.find((s) => s.gate === 'start');
  assert.ok(start.ok && start.port > 0);
  assert.equal(result.steps.find((s) => s.gate === 'e2e').ok, true);
  await new Promise((r) => setTimeout(r, 1000));
  await assert.rejects(fetch(`http://127.0.0.1:${start.port}/`));
});

test('e2e exige o app do run de pé; app-stop derruba a árvore de processos', async () => {
  await dispatch(['init', '--id', '70', '--kind', 'feature', '--title', 'App']);
  await assert.rejects(dispatch(['check', '--id', '70', '--gate', 'e2e']), (err) => err.code === 'config');

  const started = await dispatch(['app-start', '--id', '70']);
  assert.ok(started.app.port > 0);
  const res = await fetch(`${started.app.baseUrl}/`);
  assert.equal(await res.text(), 'ok');

  const e2e = await dispatch(['check', '--id', '70', '--gate', 'e2e']);
  assert.equal(e2e.check.ok, true);

  const stopped = await dispatch(['app-stop', '--id', '70']);
  assert.equal(stopped.stopped, true);
  await new Promise((r) => setTimeout(r, 1000));
  await assert.rejects(fetch(`${started.app.baseUrl}/`));
});

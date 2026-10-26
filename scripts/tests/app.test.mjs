import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

test('run.env chega ao app, aos checks e ao prove, com $PORT trocado', async () => {
  const here = process.cwd();
  const greeting = makeRepo({
    project: {
      run: {
        env: { APP_GREETING: 'ola-$PORT', BROWSER: 'none' },
        test: `${node} -e "process.exit(process.env.BROWSER === 'none' ? 0 : 1)"`,
        start: `${node} -e "require('http').createServer((q,s)=>s.end(process.env.APP_GREETING)).listen(Number(process.env.PORT))"`,
        ready: 'http://127.0.0.1:$PORT/',
        baseUrl: 'http://127.0.0.1:$PORT',
        e2e: `${node} -e "fetch(process.env.BASE_URL).then(r=>r.text()).then(t=>process.exit(t==='ola-'+process.env.PORT ? 0 : 1))"`,
        readyTimeoutSeconds: 20,
      },
    },
  });
  try {
    process.chdir(greeting.dir);
    await dispatch(['init', '--id', '71', '--kind', 'feature', '--title', 'Env']);
    const started = await dispatch(['app-start', '--id', '71']);
    assert.equal(await (await fetch(`${started.app.baseUrl}/`)).text(), `ola-${started.app.port}`);
    assert.equal((await dispatch(['check', '--id', '71', '--gate', 'test'])).check.ok, true);
    assert.equal((await dispatch(['check', '--id', '71', '--gate', 'e2e'])).check.ok, true);
    await dispatch(['app-stop', '--id', '71']);
    const proved = await dispatch(['prove']);
    assert.equal(proved.ok, true, JSON.stringify(proved.steps));

    writeFileSync(join(greeting.dir, '.factory', 'project.json'), JSON.stringify({ run: { test: 'x', env: ['BROWSER=none'] } }));
    await assert.rejects(dispatch(['prove']), (err) => err.code === 'config' && /run\.env/.test(err.message));
  } finally {
    process.chdir(here);
    greeting.cleanup();
  }
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

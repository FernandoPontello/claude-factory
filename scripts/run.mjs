#!/usr/bin/env node
// run — o executor local de um /deliver: estado do run, verificações com registro,
// app de pé com porta própria e o relatório de entrega.
//
// Uso: node run.mjs <comando> --id <work item> [--opções]
//   init --kind feature|bugfix|hotfix --title "..."   cria (ou retoma) o run e diz a trilha
//   phase --to <fase>                                  registra a fase atual
//   check --gate install|build|test|e2e|lint [--new-cycle]
//   app-start | app-stop [--clean]                    o app (e os serviços de outros repos)
//   report                                            gera relatorio-vN.html e pr-summary.md
//   status                                            resumo para retomar o run
//   prove                                             (sem --id) prova a receita para o /setup
//   ensure-settings                                   (sem --id) declara o plugin no .claude/settings.json
// Na pasta de trabalho (fora de um clone), --repo <nome> diz em qual repo o run acontece.

import { execFileSync, execSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FactoryError, isEntryPoint, parseArgs, required, run, toId } from './lib/cli.mjs';
import { git, resolveConfig } from './lib/config.mjs';
import { appendCheck, appendMark, readChecks, readMarks, readState, runDir, writeState } from './lib/runs.mjs';
import { buildReport, FINAL_GATES, parseJUnit, parsePlaywrightAcs, parsePlaywrightJson } from './lib/report.mjs';

const GATES = ['install', 'build', 'test', 'e2e', 'lint'];
const PHASES = ['preparacao', 'kickoff', 'execucao', 'relatorio', 'entrega', 'entregue', 'estacionado'];

export function slugify(text, max = 40) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** A branch de produção é a branch padrão do repo, seja ela main ou master. */
function defaultBranch(cfg) {
  if (cfg.branches.main) return cfg.branches.main;
  try {
    return git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cfg.root).replace(/^origin\//, '');
  } catch {
    // remote adicionado à mão não tem origin/HEAD: pergunta ao servidor
  }
  try {
    // Nunca abre janela de login nem espera indefinidamente: sem credencial, segue com "main".
    const out = execFileSync('git', ['ls-remote', '--symref', 'origin', 'HEAD'], {
      cwd: cfg.root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    const m = out.match(/ref:\s+refs\/heads\/(\S+)\s+HEAD/);
    if (m) return m[1];
  } catch {
    // sem rede ou sem credencial: cai no nome mais comum
  }
  return 'main';
}

/** Troca `$PORT`, `$BASE_URL` e as variáveis dos serviços pelos valores deste run. */
function fillVars(text, vars) {
  return Object.entries(vars)
    .sort((a, b) => b[0].length - a[0].length)
    .reduce((out, [name, value]) => out.split(`$${name}`).join(String(value)), String(text));
}

function headInfo(cfg) {
  try {
    return { sha: git(['rev-parse', 'HEAD'], cfg.root), dirty: git(['status', '--porcelain'], cfg.root).length > 0 };
  } catch {
    return { sha: null, dirty: null };
  }
}

/** A trilha de cada tipo de PRD: de onde sai, para onde vão as PRs, e com que estado. */
export function trackFor(cfg, kind, id, title, mainBranch) {
  const slug = slugify(title) || 'item';
  const { develop, qa } = cfg.branches;
  if (kind === 'feature') {
    return {
      branch: `feature/${id}-${slug}`,
      base: develop,
      prs: [{ target: develop, onMerge: 'integrated', merge: 'squash', deleteSource: true }],
    };
  }
  if (kind === 'bugfix') {
    return {
      branch: `bugfix/${id}-${slug}`,
      base: qa,
      prs: [
        { target: qa, onMerge: 'qa', merge: 'squash' },
        { target: develop, backMerge: true, merge: 'merge' },
      ],
    };
  }
  if (kind === 'hotfix') {
    return {
      branch: `hotfix/${id}-${slug}`,
      base: mainBranch,
      prs: [
        { target: mainBranch, onMerge: 'closed', merge: 'squash' },
        { target: qa, backMerge: true, merge: 'merge' },
        { target: develop, backMerge: true, merge: 'merge' },
      ],
    };
  }
  throw new FactoryError('config', `--kind precisa ser feature, bugfix ou hotfix (recebi "${kind}").`);
}

function loadState(cfg, id) {
  const state = readState(cfg, id);
  if (!state) throw new FactoryError('not_found', `Não há run local para o item #${id}.`, 'Comece com `run.mjs init`.');
  return state;
}

// ---------- init / phase / status ----------

function cmdInit(cfg, args) {
  const id = toId(required(args, 'id'));
  const existing = readState(cfg, id);
  if (existing) return { resumed: true, state: existing };
  const kind = String(required(args, 'kind'));
  const title = String(required(args, 'title'));
  // Só o hotfix sai da branch de produção; as outras trilhas não precisam perguntar qual é.
  const mainBranch = kind === 'hotfix' ? (args.main && args.main !== true ? String(args.main) : defaultBranch(cfg)) : null;
  const track = trackFor(cfg, kind, id, title, mainBranch);
  const gates = cfg.run ? FINAL_GATES.filter((g) => cfg.run[g]) : [];
  const state = writeState(cfg, id, {
    id,
    kind,
    title,
    ...track,
    gates,
    cycle: 1,
    phase: 'preparacao',
    reportVersion: 0,
    createdAt: new Date().toISOString(),
  });
  return { resumed: false, state };
}

function cmdPhase(cfg, args) {
  const id = toId(required(args, 'id'));
  const to = String(required(args, 'to'));
  if (!PHASES.includes(to)) throw new FactoryError('config', `Fase desconhecida "${to}".`, `Use: ${PHASES.join(', ')}.`);
  const state = loadState(cfg, id);
  state.phase = to;
  if (args.reason && args.reason !== true) state.parkedReason = String(args.reason);
  writeState(cfg, id, state);
  return { state };
}

function cmdStatus(cfg, args) {
  const id = toId(required(args, 'id'));
  const state = loadState(cfg, id);
  const checks = readChecks(cfg, id);
  const lastByGate = {};
  for (const c of checks.filter((x) => x.cycle === state.cycle)) lastByGate[c.gate] = { ok: c.ok, attempt: c.attempt, at: c.endedAt };
  return { state, marks: readMarks(cfg, id).map((m) => m.event), lastChecks: lastByGate, runDir: runDir(cfg, id) };
}

// ---------- check ----------

function consecutiveFailures(checks, gate, cycle) {
  let n = 0;
  for (const c of checks.filter((x) => x.gate === gate && x.cycle === cycle).reverse()) {
    if (c.ok) break;
    n++;
  }
  return n;
}

/** Resultado por AC (títulos "AC-n") do relatório JSON do Playwright desta execução. */
function readAcResults(cfg, sinceMs) {
  if (!cfg.run?.e2eReport) return undefined;
  try {
    const file = resolve(cfg.root, cfg.run.e2eReport);
    if (!existsSync(file) || statSync(file).mtimeMs + 1000 < sinceMs) return undefined;
    return parsePlaywrightAcs(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Contagem de testes do relatório gerado NESTA execução (arquivo velho não conta). */
function readCounts(cfg, gate, sinceMs) {
  const spec = gate === 'test' ? [cfg.run?.testReport, parseJUnit] : gate === 'e2e' ? [cfg.run?.e2eReport, parsePlaywrightJson] : [null];
  const [relative, parse] = spec;
  if (!relative) return null;
  try {
    const file = resolve(cfg.root, relative);
    if (!existsSync(file) || statSync(file).mtimeMs + 1000 < sinceMs) return null;
    return parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function appResponds(cfg, app) {
  if (!app?.port || !(app.readyUrl || cfg.run?.ready)) return false;
  const url = app.readyUrl ?? fillVars(cfg.run.ready, { PORT: app.port, BASE_URL: app.baseUrl });
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

async function cmdCheck(cfg, args) {
  const id = toId(required(args, 'id'));
  const gate = String(required(args, 'gate'));
  if (!GATES.includes(gate)) throw new FactoryError('config', `Gate desconhecido "${gate}".`, `Use: ${GATES.join(', ')}.`);
  const command = cfg.run?.[gate];
  if (!command) throw new FactoryError('config', `A receita não tem o comando "${gate}" em .factory/project.json.`, 'Rode /setup para completar a receita de execução.');
  const state = loadState(cfg, id);
  if (args['new-cycle']) {
    // Ciclo novo só depois de um relatório novo (o dev pediu ajuste): não é saída do limite.
    const reportVersion = state.reportVersion ?? 0;
    if (reportVersion <= (state.cycleReport ?? 0)) {
      throw new FactoryError(
        'limit',
        'Ciclo novo só depois de um relatório novo: o limite de tentativas não se zera sozinho.',
        'Gere o relatório (⚠️ se for o caso) e espere o pedido de ajuste do dev.',
      );
    }
    state.cycle = (state.cycle ?? 1) + 1;
    state.cycleReport = reportVersion;
    writeState(cfg, id, state);
  }
  if (gate === 'e2e' && !(await appResponds(cfg, state.app))) {
    throw new FactoryError('config', 'Os testes de aceite precisam do app deste run de pé, e ele não está respondendo.', 'Rode `run.mjs app-start --id <id>` antes do check de e2e.');
  }
  if (gate === 'e2e') {
    for (const svc of state.services ?? []) {
      if (!(await appResponds(cfg, svc))) {
        throw new FactoryError('config', `O serviço ${svc.repo} (origin/${svc.ref}) não está respondendo.`, 'Rode `run.mjs app-start --id <id>` de novo: ele sobe os serviços e o app.');
      }
    }
  }
  const checks = readChecks(cfg, id);
  const failures = consecutiveFailures(checks, gate, state.cycle);
  if (failures >= cfg.maxAttempts) {
    throw new FactoryError(
      'limit',
      `"${gate}" falhou ${failures} vezes seguidas neste ciclo (limite ${cfg.maxAttempts}).`,
      'Pare de tentar: gere o relatório ⚠️ com a evidência e o que o dev precisa decidir.',
      { gate, failures },
    );
  }

  const port = state.app?.port;
  const shotsDir = join(runDir(cfg, id), 'shots');
  mkdirSync(shotsDir, { recursive: true });
  const vars = { ...(port ? { PORT: port, BASE_URL: state.app.baseUrl } : {}), ...serviceEnv(state.services) };
  const env = { ...process.env, FACTORY_RUN_ID: String(id), FACTORY_SHOTS_DIR: shotsDir, ...stringify(vars) };
  const cmd = fillVars(command, vars);
  const attempt = checks.filter((c) => c.gate === gate && c.cycle === state.cycle).length + 1;
  const logFile = join(runDir(cfg, id), 'logs', `${gate}-c${state.cycle}-t${attempt}.log`);
  const head = headInfo(cfg);
  const result = execCommand(cfg, cmd, env, logFile);
  const check = appendCheck(cfg, id, {
    sha: head.sha,
    dirty: head.dirty,
    acResults: gate === 'e2e' ? readAcResults(cfg, Date.parse(result.startedAt)) : undefined,
    // Contra qual versão de cada repo vizinho o aceite rodou: vai para o relatório.
    services: gate === 'e2e' ? liveServices(state).map(({ repo, ref, sha }) => ({ repo, ref, sha })) : undefined,
    gate,
    cycle: state.cycle,
    attempt,
    command: cmd,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    ok: result.ok,
    timedOut: result.timedOut,
    counts: readCounts(cfg, gate, Date.parse(result.startedAt)),
    log: logFile,
  });
  return { check, tail: result.tail };
}

/** Roda um comando da receita no shell, grava o log inteiro e devolve o resultado. */
function execCommand(cfg, cmd, env, logFile) {
  const started = new Date();
  const result = spawnSync(cmd, {
    cwd: cfg.root,
    env,
    shell: true,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: Number(cfg.run?.timeoutMinutes ?? 30) * 60000,
    windowsHide: true,
  });
  const ended = new Date();
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(logFile, output);
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const exitCode = result.status ?? (timedOut ? 124 : 1);
  return {
    startedAt: started.toISOString(),
    endedAt: ended.toISOString(),
    durationMs: ended - started,
    exitCode,
    ok: exitCode === 0,
    timedOut,
    tail: output.split('\n').slice(-40).join('\n'),
  };
}

// ---------- app ----------

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function waitReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return true;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new FactoryError('error', `O app não respondeu em ${url} dentro de ${Math.round(timeoutMs / 1000)} s (${lastError}).`, 'Veja app.log no diretório do run e corrija a receita "start"/"ready".');
}

/** Uma porta livre e a URL que o app vai ter nela. */
async function appAddress(cfg) {
  const port = await freePort();
  return { port, baseUrl: fillVars(cfg.run?.baseUrl ?? 'http://localhost:$PORT', { PORT: port }) };
}

const stringify = (vars) => Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)]));

/**
 * Sobe o app pela receita numa porta livre, em segundo plano, e espera ele responder.
 * `extraVars` são as URLs dos serviços de outros repos, na variável que a receita pediu.
 */
async function launchApp(cfg, dir, label, onStarted = () => {}, extraVars = {}, address = null) {
  if (!cfg.run?.start || !cfg.run?.ready) {
    throw new FactoryError('config', 'A receita precisa de "start" e "ready" em .factory/project.json.', 'Rode /setup para completar a receita.');
  }
  const { port, baseUrl } = address ?? (await appAddress(cfg));
  const vars = { ...extraVars, PORT: port, BASE_URL: baseUrl };
  const readyUrl = fillVars(cfg.run.ready, vars);
  const command = fillVars(cfg.run.start, vars);
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, 'app.log');
  const fd = openSync(logFile, 'a');
  const child = spawn(command, {
    cwd: cfg.root,
    env: { ...process.env, ...stringify(vars), FACTORY_RUN_ID: String(label) },
    shell: true,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  child.unref();
  // O filho tem a própria cópia do descritor; manter a nossa aberta trava o log no Windows.
  closeSync(fd);
  const app = { pid: child.pid, port, baseUrl, readyUrl, startedAt: new Date().toISOString() };
  onStarted(app);
  try {
    await waitReady(readyUrl, Number(cfg.run.readyTimeoutSeconds ?? 120) * 1000);
  } catch (err) {
    stopProcess(app.pid);
    throw err;
  }
  return { app, log: logFile };
}

// ---------- serviços de outros repos ----------
//
// O front testa contra a API de verdade: `run.services` lista os repos vizinhos que o app precisa
// de pé. Cada um sobe pela receita dele, numa cópia limpa (worktree) da branch da trilha no origin
// (develop numa feature, QA num bugfix, a de produção num hotfix), fora de qualquer repo, numa
// porta livre. O app e os testes recebem a URL do serviço na variável que a receita pediu.

function serviceSpecs(cfg) {
  const list = cfg.run?.services ?? [];
  if (!Array.isArray(list)) throw new FactoryError('config', '"run.services" precisa ser uma lista.', 'Use [{ "repo": "<nome do repo>", "env": "API_URL" }].');
  return list.map((svc) => {
    if (!svc?.repo || !svc?.env) {
      throw new FactoryError('config', 'Cada serviço em "run.services" precisa de "repo" e "env".', 'Exemplo: { "repo": "Loja-API", "env": "API_URL" }.');
    }
    const vars = svc.vars ?? {};
    if (typeof vars !== 'object' || Array.isArray(vars) || Object.values(vars).some((v) => typeof v !== 'string')) {
      throw new FactoryError('config', `"vars" do serviço ${svc.repo} precisa ser um objeto de textos.`, 'Exemplo: { "Cors__AllowedOrigins__0": "$APP_URL" }.');
    }
    return { repo: String(svc.repo), env: String(svc.env), ref: svc.ref ? String(svc.ref) : null, vars };
  });
}

const liveServices = (state) => (state.services ?? []).filter((svc) => svc.pid && svc.baseUrl);

function serviceEnv(services) {
  return Object.fromEntries((services ?? []).filter((svc) => svc.pid && svc.baseUrl).map((svc) => [svc.env, svc.baseUrl]));
}

/** A cópia fica no temp da máquina: dentro de um repo, as ferramentas dele achariam o código do vizinho. */
function serviceDir(cfg, label, repo) {
  const owner = createHash('sha1').update(resolve(cfg.root).toLowerCase()).digest('hex').slice(0, 8);
  return join(tmpdir(), 'factory-svc', `${owner}-${slugify(String(label), 20)}-${slugify(repo, 30)}`);
}

function quietGit(args, cwd, timeout = 60000) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  }).trim();
}

/** Deixa a cópia do vizinho em origin/<ref>. Sem rede, usa o que o clone já tem e avisa. */
function prepareServiceCopy(sibling, ref, dir) {
  let fresh = true;
  try {
    quietGit(['fetch', 'origin', ref], sibling.root);
  } catch {
    fresh = false;
  }
  let sha;
  try {
    sha = git(['rev-parse', `origin/${ref}`], sibling.root);
  } catch {
    throw new FactoryError('config', `O clone de ${sibling.repo} não tem a branch origin/${ref}.`, `Confira a conexão e rode \`git fetch origin ${ref}\` no clone de ${sibling.repo}.`);
  }
  if (existsSync(join(dir, '.git'))) {
    git(['checkout', '--detach', '--force', sha], dir);
    return { sha, fresh, created: false };
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  git(['worktree', 'prune'], sibling.root);
  mkdirSync(dirname(dir), { recursive: true });
  git(['worktree', 'add', '--detach', '--force', dir, sha], sibling.root);
  return { sha, fresh, created: true };
}

function siblingConfig(cfg, repo) {
  return resolveConfig({ cwd: cfg.root, requireAdo: false, repoOverride: repo });
}

/**
 * `app` é o endereço já reservado do app que consome os serviços: `$APP_URL` e `$APP_PORT` nas
 * `vars` de um serviço viram esse endereço (a API precisa dele para liberar o CORS, por exemplo).
 */
async function startServices(cfg, { label, kind, base, logDir, previous = [], app = null }) {
  const appVars = app ? { APP_URL: app.baseUrl, APP_PORT: app.port } : {};
  const started = [];
  try {
    for (const spec of serviceSpecs(cfg)) {
      const sibling = siblingConfig(cfg, spec.repo);
      const ref = spec.ref ?? (kind === 'hotfix' ? defaultBranch(sibling) : base ?? cfg.branches.develop);
      const dir = serviceDir(cfg, label, spec.repo);
      const copy = prepareServiceCopy(sibling, ref, dir);
      const svcCfg = resolveConfig({ cwd: dir, requireAdo: false });
      if (!svcCfg.run?.start || !svcCfg.run?.ready) {
        throw new FactoryError('config', `A receita de ${spec.repo} em origin/${ref} não diz como subir o app ("start" e "ready").`, `Rode /setup no repo ${spec.repo} e integre a receita na ${ref}.`);
      }
      const logs = join(logDir, 'services', spec.repo);
      const before = previous.find((svc) => svc.repo === spec.repo);
      // Instalar leva minutos: só de novo quando a cópia é nova ou o código mudou.
      if (svcCfg.run.install && (copy.created || before?.installedSha !== copy.sha)) {
        const result = execCommand(svcCfg, svcCfg.run.install, { ...process.env }, join(logs, 'install.log'));
        if (!result.ok) {
          throw new FactoryError('error', `A instalação de ${spec.repo} (origin/${ref}) falhou.`, `Veja ${join(logs, 'install.log')}.`, { tail: result.tail });
        }
      }
      const vars = Object.fromEntries(Object.entries(spec.vars).map(([name, value]) => [name, fillVars(value, appVars)]));
      const { app: svcApp } = await launchApp(svcCfg, logs, `${label}-${spec.repo}`, undefined, vars);
      started.push({ repo: spec.repo, env: spec.env, ref, sha: copy.sha, fresh: copy.fresh, dir, installedSha: copy.sha, ...svcApp });
    }
  } catch (err) {
    for (const svc of started) stopProcess(svc.pid);
    throw err;
  }
  return started;
}

function stopServices(cfg, services, { clean = false } = {}) {
  const out = [];
  for (const svc of services ?? []) {
    const stopped = svc.pid ? stopProcess(svc.pid) : false;
    let removed = false;
    if (clean && svc.dir) {
      try {
        git(['worktree', 'remove', '--force', svc.dir], siblingConfig(cfg, svc.repo).root);
        removed = true;
      } catch {
        // clone vizinho sumiu ou a cópia já foi apagada: limpa o que der
        rmSync(svc.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        removed = !existsSync(svc.dir);
      }
    }
    out.push({ repo: svc.repo, stopped, removed });
  }
  return out;
}

const serviceSummary = (services) => (services ?? []).map(({ repo, ref, sha, fresh, port, baseUrl, env }) => ({ repo, ref, sha, fresh, port, baseUrl, env }));

async function cmdAppStart(cfg, args) {
  const id = toId(required(args, 'id'));
  const state = loadState(cfg, id);
  if (state.app?.pid) stopProcess(state.app.pid);
  stopServices(cfg, state.services);
  // A porta do app é reservada antes: os serviços podem precisar da URL dele (CORS).
  const address = await appAddress(cfg);
  const services = await startServices(cfg, { label: id, kind: state.kind, base: state.base, logDir: runDir(cfg, id), previous: state.services ?? [], app: address });
  state.services = services;
  writeState(cfg, id, state);
  try {
    const started = await launchApp(cfg, runDir(cfg, id), id, (app) => {
      state.app = app;
      writeState(cfg, id, state);
    }, serviceEnv(services), address);
    const warnings = services.filter((svc) => !svc.fresh).map((svc) => `Sem rede para atualizar ${svc.repo}: o serviço subiu do origin/${svc.ref} que o clone já tinha (${svc.sha.slice(0, 7)}).`);
    return { ...started, services: serviceSummary(services), ...(warnings.length ? { warnings } : {}) };
  } catch (err) {
    stopServices(cfg, services);
    state.services = services.map((svc) => ({ ...svc, pid: null }));
    writeState(cfg, id, state);
    throw err;
  }
}

/** /setup: prova a receita inteira sem precisar de work item (instala, builda, testa, sobe o app). */
async function cmdProve(cfg) {
  if (!cfg.run) throw new FactoryError('config', 'Não há receita em .factory/project.json.', 'Descubra a receita e grave em "run" antes de provar.');
  serviceSpecs(cfg);
  const dir = join(cfg.runsDir, '_setup');
  const env = { ...process.env, FACTORY_RUN_ID: 'setup', FACTORY_SHOTS_DIR: join(dir, 'shots') };
  const steps = [];
  for (const gate of ['install', 'build', 'test']) {
    if (!cfg.run[gate]) continue;
    const result = execCommand(cfg, cfg.run[gate], env, join(dir, 'logs', `${gate}.log`));
    steps.push({ gate, ok: result.ok, exitCode: result.exitCode, durationMs: result.durationMs, tail: result.ok ? undefined : result.tail });
    if (!result.ok) return { ok: false, steps };
  }
  if (cfg.run.start && cfg.run.ready) {
    let app;
    let services = [];
    let stage = 'start';
    try {
      const address = await appAddress(cfg);
      if (serviceSpecs(cfg).length) {
        stage = 'services';
        services = await startServices(cfg, { label: 'setup', kind: 'feature', base: cfg.branches.develop, logDir: dir, app: address });
        steps.push({ gate: 'services', ok: true, services: serviceSummary(services) });
        stage = 'start';
      }
      ({ app } = await launchApp(cfg, dir, 'setup', undefined, serviceEnv(services), address));
      steps.push({ gate: 'start', ok: true, port: app.port });
      if (cfg.run.e2e) {
        const vars = { ...serviceEnv(services), PORT: app.port, BASE_URL: app.baseUrl };
        const result = execCommand(cfg, fillVars(cfg.run.e2e, vars), { ...env, ...stringify(vars) }, join(dir, 'logs', 'e2e.log'));
        steps.push({ gate: 'e2e', ok: result.ok, exitCode: result.exitCode, durationMs: result.durationMs, tail: result.ok ? undefined : result.tail });
      }
    } catch (err) {
      steps.push({ gate: stage, ok: false, error: err.message, fix: err.fix });
    } finally {
      if (app) stopProcess(app.pid);
      stopServices(cfg, services, { clean: true });
    }
  }
  return { ok: steps.every((s) => s.ok), steps, logs: join(dir, 'logs') };
}

function stopProcess(pid) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

/** Derruba o app e os serviços. `--clean` também apaga as cópias dos repos vizinhos (fim do run). */
function cmdAppStop(cfg, args) {
  const id = toId(required(args, 'id'));
  const state = loadState(cfg, id);
  const clean = Boolean(args.clean);
  const stopped = state.app?.pid ? stopProcess(state.app.pid) : false;
  const services = stopServices(cfg, state.services, { clean });
  delete state.app;
  if (clean) delete state.services;
  else if (state.services) state.services = state.services.map((svc) => ({ ...svc, pid: null }));
  writeState(cfg, id, state);
  return { stopped, ...(services.length ? { services } : {}) };
}

// ---------- report ----------

function gitCommits(cfg, base) {
  try {
    const out = git(['log', '--format=%h%x09%s', `origin/${base}..HEAD`], cfg.root);
    return out ? out.split('\n').map((line) => { const [hash, ...rest] = line.split('\t'); return { hash, subject: rest.join('\t') }; }) : [];
  } catch {
    return [];
  }
}

function gitDiffstat(cfg, base) {
  try {
    return git(['diff', '--shortstat', `origin/${base}...HEAD`], cfg.root);
  } catch {
    return '';
  }
}

function cmdReport(cfg, args) {
  const id = toId(required(args, 'id'));
  const state = loadState(cfg, id);
  const dir = runDir(cfg, id);
  const contentFile = join(dir, 'report.json');
  if (!existsSync(contentFile)) {
    throw new FactoryError('config', `Falta ${contentFile}.`, 'Escreva o conteúdo do relatório (report.json) antes de gerar o HTML.');
  }
  let content;
  try {
    content = JSON.parse(readFileSync(contentFile, 'utf8'));
  } catch (err) {
    throw new FactoryError('config', `report.json inválido: ${err.message}`);
  }
  // A receita pode ter nascido durante o run (fundação): as verificações finais saem dela agora.
  state.gates = cfg.run ? FINAL_GATES.filter((g) => cfg.run[g]) : [];
  const version = (state.reportVersion ?? 0) + 1;
  const generatedAt = Date.now();
  const marks = [...readMarks(cfg, id), { event: `report-v${version}`, at: new Date(generatedAt).toISOString() }];
  const { html, prSummary, verdict, warnings } = buildReport({
    state,
    content,
    checks: readChecks(cfg, id),
    marks,
    commits: gitCommits(cfg, state.base),
    diffstat: gitDiffstat(cfg, state.base),
    head: headInfo(cfg),
    runDir: dir,
    version,
    generatedAt,
  });
  const htmlFile = join(dir, `relatorio-v${version}.html`);
  const summaryFile = join(dir, 'pr-summary.md');
  writeFileSync(htmlFile, html);
  writeFileSync(summaryFile, prSummary);
  appendMark(cfg, id, `report-v${version}`, { ok: verdict.ok });
  state.reportVersion = version;
  state.phase = 'relatorio';
  writeState(cfg, id, state);
  return { version, verdict: verdict.ok ? 'pronto' : 'com-ressalvas', warnings, html: htmlFile, prSummary: summaryFile };
}

// ---------- settings do projeto ----------

const SETTINGS_TEMPLATE = new URL('../skills/setup/templates/claude-settings.json', import.meta.url);

/**
 * /setup: declara o marketplace e o plugin no .claude/settings.json do projeto, para quem abrir o
 * projeto (e confiar na pasta) receber a factory sem digitar comando. Preserva tudo o que já
 * existe no arquivo e tira só as entradas da factory antiga.
 */
function cmdEnsureSettings(cfg) {
  const template = JSON.parse(readFileSync(fileURLToPath(SETTINGS_TEMPLATE), 'utf8'));
  const file = join(cfg.root, '.claude', 'settings.json');
  let current = {};
  if (existsSync(file)) {
    try {
      current = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch (err) {
      throw new FactoryError('config', `.claude/settings.json não é um JSON válido: ${err.message}`, 'Corrija o arquivo antes de rodar o setup.');
    }
  }
  const next = { ...current };
  const marketplaces = { ...(current.extraKnownMarketplaces ?? {}) };
  delete marketplaces['claude-factory-marketplace'];
  next.extraKnownMarketplaces = { ...marketplaces, ...template.extraKnownMarketplaces };
  const plugins = Object.fromEntries(Object.entries(current.enabledPlugins ?? {}).filter(([key]) => !key.startsWith('claude-factory@')));
  next.enabledPlugins = { ...plugins, ...template.enabledPlugins };
  const changed = JSON.stringify(next) !== JSON.stringify(current);
  if (changed) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  }
  return { changed, file, marketplace: template.extraKnownMarketplaces };
}

// ---------- roteamento ----------

const COMMANDS = {
  init: cmdInit,
  phase: cmdPhase,
  status: cmdStatus,
  check: cmdCheck,
  'app-start': cmdAppStart,
  'app-stop': cmdAppStop,
  report: cmdReport,
  prove: cmdProve,
  'ensure-settings': cmdEnsureSettings,
};

export async function dispatch(argv) {
  const args = parseArgs(argv);
  const handler = COMMANDS[args._[0]];
  if (!handler) {
    throw new FactoryError('config', `Comando desconhecido: "${args._[0] ?? ''}".`, `Use: ${Object.keys(COMMANDS).join(', ')}.`);
  }
  const repoOverride = args.repo && args.repo !== true ? String(args.repo) : null;
  return handler(resolveConfig({ requireAdo: false, repoOverride }), args);
}

if (isEntryPoint(import.meta.url)) run(() => dispatch(process.argv.slice(2)));

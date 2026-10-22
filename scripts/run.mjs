#!/usr/bin/env node
// run — o executor local de um /deliver: estado do run, verificações com registro,
// app de pé com porta própria e o relatório de entrega.
//
// Uso: node run.mjs <comando> --id <work item> [--opções]
//   init --kind feature|bugfix|hotfix --title "..."   cria (ou retoma) o run e diz a trilha
//   phase --to <fase>                                  registra a fase atual
//   check --gate install|build|test|e2e|lint [--new-cycle]
//   app-start | app-stop
//   report                                            gera relatorio-vN.html e pr-summary.md
//   status                                            resumo para retomar o run
//   prove                                             (sem --id) prova a receita para o /setup
//   ensure-settings                                   (sem --id) declara o plugin no .claude/settings.json

import { execFileSync, execSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
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
  if (!app?.port || !cfg.run?.ready) return false;
  const url = cfg.run.ready.replace(/\$PORT/g, String(app.port)).replace(/\$BASE_URL/g, app.baseUrl);
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
  const env = { ...process.env, FACTORY_RUN_ID: String(id), FACTORY_SHOTS_DIR: shotsDir };
  if (port) {
    env.PORT = String(port);
    env.BASE_URL = state.app.baseUrl;
  }
  const cmd = port ? command.replace(/\$PORT/g, String(port)).replace(/\$BASE_URL/g, state.app.baseUrl) : command;
  const attempt = checks.filter((c) => c.gate === gate && c.cycle === state.cycle).length + 1;
  const logFile = join(runDir(cfg, id), 'logs', `${gate}-c${state.cycle}-t${attempt}.log`);
  const head = headInfo(cfg);
  const result = execCommand(cfg, cmd, env, logFile);
  const check = appendCheck(cfg, id, {
    sha: head.sha,
    dirty: head.dirty,
    acResults: gate === 'e2e' ? readAcResults(cfg, Date.parse(result.startedAt)) : undefined,
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

/** Sobe o app pela receita numa porta livre, em segundo plano, e espera ele responder. */
async function launchApp(cfg, dir, label, onStarted = () => {}) {
  if (!cfg.run?.start || !cfg.run?.ready) {
    throw new FactoryError('config', 'A receita precisa de "start" e "ready" em .factory/project.json.', 'Rode /setup para completar a receita.');
  }
  const port = await freePort();
  const baseUrl = String(cfg.run.baseUrl ?? 'http://localhost:$PORT').replace(/\$PORT/g, String(port));
  const fill = (s) => String(s).replace(/\$PORT/g, String(port)).replace(/\$BASE_URL/g, baseUrl);
  const readyUrl = fill(cfg.run.ready);
  const command = fill(cfg.run.start);
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, 'app.log');
  const fd = openSync(logFile, 'a');
  const child = spawn(command, {
    cwd: cfg.root,
    env: { ...process.env, PORT: String(port), BASE_URL: baseUrl, FACTORY_RUN_ID: String(label) },
    shell: true,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  });
  child.unref();
  // O filho tem a própria cópia do descritor; manter a nossa aberta trava o log no Windows.
  closeSync(fd);
  const app = { pid: child.pid, port, baseUrl, startedAt: new Date().toISOString() };
  onStarted(app);
  try {
    await waitReady(readyUrl, Number(cfg.run.readyTimeoutSeconds ?? 120) * 1000);
  } catch (err) {
    stopProcess(app.pid);
    throw err;
  }
  return { app, log: logFile };
}

async function cmdAppStart(cfg, args) {
  const id = toId(required(args, 'id'));
  const state = loadState(cfg, id);
  if (state.app?.pid) stopProcess(state.app.pid);
  return launchApp(cfg, runDir(cfg, id), id, (app) => {
    state.app = app;
    writeState(cfg, id, state);
  });
}

/** /setup: prova a receita inteira sem precisar de work item (instala, builda, testa, sobe o app). */
async function cmdProve(cfg) {
  if (!cfg.run) throw new FactoryError('config', 'Não há receita em .factory/project.json.', 'Descubra a receita e grave em "run" antes de provar.');
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
    try {
      ({ app } = await launchApp(cfg, dir, 'setup'));
      steps.push({ gate: 'start', ok: true, port: app.port });
      if (cfg.run.e2e) {
        const cmd = cfg.run.e2e.replace(/\$PORT/g, String(app.port)).replace(/\$BASE_URL/g, app.baseUrl);
        const result = execCommand(cfg, cmd, { ...env, PORT: String(app.port), BASE_URL: app.baseUrl }, join(dir, 'logs', 'e2e.log'));
        steps.push({ gate: 'e2e', ok: result.ok, exitCode: result.exitCode, durationMs: result.durationMs, tail: result.ok ? undefined : result.tail });
      }
    } catch (err) {
      steps.push({ gate: 'start', ok: false, error: err.message, fix: err.fix });
    } finally {
      if (app) stopProcess(app.pid);
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

function cmdAppStop(cfg, args) {
  const id = toId(required(args, 'id'));
  const state = loadState(cfg, id);
  if (!state.app?.pid) return { stopped: false };
  const stopped = stopProcess(state.app.pid);
  delete state.app;
  writeState(cfg, id, state);
  return { stopped };
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
  return handler(resolveConfig({ requireAdo: false }), args);
}

if (isEntryPoint(import.meta.url)) run(() => dispatch(process.argv.slice(2)));

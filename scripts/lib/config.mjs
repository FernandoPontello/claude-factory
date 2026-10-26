// Configuração do projeto: o que dá para derivar (git remote) mais o pouco que fica em
// .factory/project.json (a receita de execução e, raramente, overrides).
//
// Um projeto pode ter 1 ou N repos. A "pasta de trabalho" é a pasta que reúne um clone de cada:
// rodando dentro de um repo, ela é a pasta-mãe (só os clones do mesmo projeto contam); rodando
// fora de um repo, é a própria pasta.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { FactoryError } from './cli.mjs';

export const DEFAULT_STATES = {
  new: 'New',
  ready: 'Ready',
  running: 'Executando',
  review: 'Revisao',
  integrated: 'Integrado',
  qa: 'Homologando',
  closed: 'Closed',
  removed: 'Removed',
};

export const DEFAULT_TYPES = { feature: 'User Story', bug: 'Bug', group: 'Feature', task: 'Task' };

export const DEFAULT_TASK_STATES = { new: 'New', active: 'Active', closed: 'Closed' };

export const DEFAULT_BRANCHES = { develop: 'develop', qa: 'QA' };

export function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

function repoRootOf(dir) {
  try {
    return git(['rev-parse', '--show-toplevel'], dir);
  } catch {
    return null;
  }
}

export function gitRoot(cwd = process.cwd()) {
  const root = repoRootOf(cwd);
  if (!root) throw new FactoryError('config', 'Esta pasta não é um repositório git.', 'Rode o comando dentro do clone do projeto, ou na pasta que reúne os clones.');
  return root;
}

/** Extrai org, projeto e repo de uma URL de remote do Azure DevOps. */
export function parseRemote(url) {
  if (!url) return null;
  const clean = url.trim().replace(/\.git$/, '');
  const patterns = [
    // https://dev.azure.com/org/projeto/_git/repo  (com ou sem usuario@)
    /^https?:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+)/i,
    // https://org.visualstudio.com/[DefaultCollection/]projeto/_git/repo
    /^https?:\/\/(?:[^@/]+@)?([^./]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/?#]+)/i,
    // git@ssh.dev.azure.com:v3/org/projeto/repo
    /^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/?#]+)/i,
    // org@vs-ssh.visualstudio.com:v3/org/projeto/repo
    /^(?:ssh:\/\/)?[^@]+@vs-ssh\.visualstudio\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/?#]+)/i,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m) {
      const [org, project, repo] = m.slice(1).map((s) => decodeURIComponent(s));
      return { org, project, repo };
    }
  }
  return null;
}

/** A URL do origin como está configurada (sem aplicar `url.<x>.insteadOf`). */
function originUrl(dir) {
  return git(['config', '--get', 'remote.origin.url'], dir);
}

function remoteOf(dir) {
  try {
    return parseRemote(originUrl(dir));
  } catch {
    return null;
  }
}

const sameProject = (a, b) => a && b && a.org.toLowerCase() === b.org.toLowerCase() && a.project.toLowerCase() === b.project.toLowerCase();

/**
 * Os clones do projeto lado a lado. Dentro de um repo: ele e os irmãos do mesmo projeto. Fora de
 * um repo: os clones dentro da pasta, que precisam ser todos do mesmo projeto.
 */
export function findWorkspace(cwd = process.cwd()) {
  const repoRoot = repoRootOf(cwd);
  const base = repoRoot ? dirname(repoRoot) : resolve(cwd);
  const anchor = repoRoot ? remoteOf(repoRoot) : null;
  const found = [];
  let entries = [];
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(base, entry.name);
    if (!existsSync(join(dir, '.git'))) continue;
    const remote = remoteOf(dir);
    if (remote) found.push({ name: remote.repo, path: dir, org: remote.org, project: remote.project });
  }
  if (repoRoot && anchor && !found.some((m) => resolve(m.path) === resolve(repoRoot))) {
    found.push({ name: anchor.repo, path: repoRoot, org: anchor.org, project: anchor.project });
  }
  let members = anchor ? found.filter((m) => sameProject(m, anchor)) : found;
  if (!anchor && members.length) {
    const projects = [...new Set(members.map((m) => `${m.org}/${m.project}`.toLowerCase()))];
    if (projects.length > 1) {
      throw new FactoryError(
        'config',
        `A pasta reúne clones de mais de um projeto do Azure DevOps (${projects.join(', ')}).`,
        'Abra a sessão na pasta que reúne só os clones de um projeto, ou dentro de um dos clones.',
      );
    }
  }
  members = members.sort((a, b) => a.name.localeCompare(b.name));
  return {
    root: base,
    members,
    current: repoRoot ? members.find((m) => resolve(m.path) === resolve(repoRoot)) ?? null : null,
  };
}

function parseProjectJson(text, where) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new FactoryError('config', `${where} não é um JSON válido: ${err.message}`, 'Corrija o arquivo ou rode /setup de novo.');
  }
}

/**
 * Lê .factory/project.json do checkout. Se faltar (bugfix sai da QA e hotfix sai da main,
 * que só recebem o arquivo na primeira promoção), lê a versão da develop no origin.
 */
export function loadProjectFile(root) {
  const file = join(root, '.factory', 'project.json');
  if (existsSync(file)) {
    return { file, exists: true, source: 'checkout', data: parseProjectJson(readFileSync(file, 'utf8'), '.factory/project.json') };
  }
  try {
    const text = git(['show', 'origin/develop:.factory/project.json'], root);
    if (text) return { file, exists: true, source: 'origin/develop', data: parseProjectJson(text, 'origin/develop:.factory/project.json') };
  } catch {
    // sem develop no origin ou sem o arquivo nela: repo ainda não configurado
  }
  return { file, exists: false, source: null, data: {} };
}

/**
 * A receita é uma só para todas as máquinas, mas o shell muda: no Windows o Node roda os comandos
 * no cmd.exe; no macOS e Linux, no sh. `run.win32` e `run.posix` sobrescrevem só o que precisa.
 */
export function recipeForPlatform(run, platform = process.platform) {
  if (!run) return null;
  const { win32, posix, ...base } = run;
  const override = platform === 'win32' ? win32 : posix;
  return { ...base, ...(override ?? {}) };
}

/**
 * Monta a configuração efetiva.
 * - Dentro de um repo: org/projeto/repo vêm do remote `origin` (o project.json só sobrescreve).
 * - Na pasta de trabalho (fora de um repo): org/projeto vêm dos clones; `repo` é o que veio em
 *   `repoOverride` (--repo) ou nenhum, e comandos de um repo só pedem `--repo`.
 * - `repoOverride` dentro de um repo aponta para um irmão da pasta de trabalho.
 */
export function resolveConfig({ cwd = process.cwd(), requireAdo = true, repoOverride = null } = {}) {
  let root = repoRootOf(cwd);
  let workspace = null;
  const getWorkspace = () => (workspace ??= findWorkspace(cwd));

  if (repoOverride) {
    const member = getWorkspace().members.find((m) => m.name.toLowerCase() === String(repoOverride).toLowerCase());
    if (!member) {
      throw new FactoryError('config', `Não achei um clone do repo "${repoOverride}" na pasta de trabalho.`, 'Clone o repo ao lado dos outros (o /setup faz isso) e rode de novo.');
    }
    root = member.path;
  }

  let remote = root ? remoteOf(root) : null;
  let workspaceMode = false;
  if (!root) {
    const ws = getWorkspace();
    if (!ws.members.length) gitRoot(cwd);
    workspaceMode = true;
    remote = { org: ws.members[0].org, project: ws.members[0].project, repo: null };
  }

  const project = root ? loadProjectFile(root) : { file: null, exists: false, source: null, data: {} };
  const data = project.data;
  let remoteUrl = '';
  if (root) {
    try {
      remoteUrl = originUrl(root);
    } catch {
      remoteUrl = '';
    }
  }
  const ado = {
    org: data.ado?.organization ?? remote?.org,
    project: data.ado?.project ?? remote?.project,
    repo: data.ado?.repository ?? remote?.repo ?? null,
  };

  if (requireAdo && (!ado.org || !ado.project || (!workspaceMode && !ado.repo))) {
    throw new FactoryError(
      'config',
      `Não consegui descobrir organização, projeto e repo do Azure DevOps (remote origin: "${remoteUrl || 'nenhum'}").`,
      'Clone o projeto a partir do Azure DevOps, ou preencha "ado": {"organization","project","repository"} em .factory/project.json.',
    );
  }

  const baseDir = root ?? resolve(cwd);
  return {
    root: baseDir,
    workspaceMode,
    get workspace() {
      return getWorkspace();
    },
    remoteUrl,
    projectFile: project.file,
    projectFileExists: project.exists,
    projectFileSource: project.source,
    org: ado.org,
    project: ado.project,
    repo: ado.repo,
    orgUrl: ado.org ? `https://dev.azure.com/${encodeURIComponent(ado.org)}` : null,
    team: data.ado?.team ?? (ado.project ? `${ado.project} Team` : null),
    taskType: data.ado?.taskType ?? null,
    branches: { ...DEFAULT_BRANCHES, ...(data.branches ?? {}) },
    types: { ...DEFAULT_TYPES, ...(data.types ?? {}) },
    states: { ...DEFAULT_STATES, ...(data.states ?? {}) },
    taskStates: { ...DEFAULT_TASK_STATES, ...(data.taskStates ?? {}) },
    buildDefinitionId: data.ado?.buildDefinitionId ?? null,
    run: recipeForPlatform(data.run),
    maxAttempts: Number(data.maxAttempts ?? 3),
    runsDir: join(baseDir, '.factory', 'runs'),
  };
}

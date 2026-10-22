// Configuração do projeto: o que dá para derivar (git remote) mais o pouco que fica em
// .factory/project.json (a receita de execução e, raramente, overrides).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

export const DEFAULT_TYPES = { feature: 'User Story', bug: 'Bug' };

export const DEFAULT_BRANCHES = { develop: 'develop', qa: 'QA' };

export function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function gitRoot(cwd = process.cwd()) {
  try {
    return git(['rev-parse', '--show-toplevel'], cwd);
  } catch {
    throw new FactoryError('config', 'Esta pasta não é um repositório git.', 'Rode o comando dentro do clone do projeto.');
  }
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
    // sem develop no origin ou sem o arquivo nela: projeto ainda não configurado
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
 * Monta a configuração efetiva. Org/projeto/repo vêm do remote `origin`; o project.json
 * só sobrescreve quando o remote não é do Azure DevOps ou o time quer outro nome.
 */
export function resolveConfig({ cwd = process.cwd(), requireAdo = true } = {}) {
  const root = gitRoot(cwd);
  const project = loadProjectFile(root);
  const data = project.data;

  let remoteUrl = '';
  try {
    remoteUrl = git(['remote', 'get-url', 'origin'], root);
  } catch {
    remoteUrl = '';
  }
  const fromRemote = parseRemote(remoteUrl) ?? {};
  const ado = {
    org: data.ado?.organization ?? fromRemote.org,
    project: data.ado?.project ?? fromRemote.project,
    repo: data.ado?.repository ?? fromRemote.repo,
  };

  if (requireAdo && (!ado.org || !ado.project || !ado.repo)) {
    throw new FactoryError(
      'config',
      `Não consegui descobrir organização, projeto e repo do Azure DevOps (remote origin: "${remoteUrl || 'nenhum'}").`,
      'Clone o projeto a partir do Azure DevOps, ou preencha "ado": {"organization","project","repository"} em .factory/project.json.',
    );
  }

  return {
    root,
    remoteUrl,
    projectFile: project.file,
    projectFileExists: project.exists,
    projectFileSource: project.source,
    org: ado.org,
    project: ado.project,
    repo: ado.repo,
    orgUrl: ado.org ? `https://dev.azure.com/${encodeURIComponent(ado.org)}` : null,
    branches: { ...DEFAULT_BRANCHES, ...(data.branches ?? {}) },
    types: { ...DEFAULT_TYPES, ...(data.types ?? {}) },
    states: { ...DEFAULT_STATES, ...(data.states ?? {}) },
    buildDefinitionId: data.ado?.buildDefinitionId ?? null,
    run: recipeForPlatform(data.run),
    maxAttempts: Number(data.maxAttempts ?? 3),
    runsDir: join(root, '.factory', 'runs'),
  };
}

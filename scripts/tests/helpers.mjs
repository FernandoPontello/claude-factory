// Ferramentas de teste: um repo git temporário com remote do Azure DevOps e um fetch simulado.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Os testes nunca podem falar com um servidor git de verdade (nem abrir janela de login).
process.env.GIT_TERMINAL_PROMPT = '0';
process.env.GCM_INTERACTIVE = 'never';

export function makeRepo({ project = null, remote = 'https://dev.azure.com/contoso/Loja/_git/portal' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-test-'));
  const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  g('init', '-q');
  g('config', 'user.email', 'teste@exemplo.com');
  g('config', 'user.name', 'Teste');
  if (remote) g('remote', 'add', 'origin', remote);
  if (project) {
    mkdirSync(join(dir, '.factory'), { recursive: true });
    writeFileSync(join(dir, '.factory', 'project.json'), JSON.stringify(project, null, 2));
  }
  return {
    dir,
    // No Windows, um processo recém-encerrado pode segurar arquivos por alguns instantes.
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }),
  };
}

/**
 * Pasta de trabalho temporária: um clone (git init + remote) por repo, lado a lado.
 * `repos` é uma lista de { name, remote?, project? }; sem remote, o repo é do projeto contoso/Loja.
 */
export function makeWorkspace(repos) {
  const root = mkdtempSync(join(tmpdir(), 'factory-ws-'));
  const paths = {};
  for (const { name, remote, project } of repos) {
    const dir = join(root, name);
    mkdirSync(dir);
    const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    g('init', '-q');
    g('config', 'user.email', 'teste@exemplo.com');
    g('config', 'user.name', 'Teste');
    g('remote', 'add', 'origin', remote ?? `https://dev.azure.com/contoso/Loja/_git/${name}`);
    if (project) {
      mkdirSync(join(dir, '.factory'), { recursive: true });
      writeFileSync(join(dir, '.factory', 'project.json'), JSON.stringify(project, null, 2));
    }
    paths[name] = dir;
  }
  return {
    root,
    paths,
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }),
  };
}

/**
 * Dá ao clone um origin de verdade sem rede: um repo bare local, que o `insteadOf` põe no lugar da
 * URL do Azure DevOps (a URL configurada continua a mesma, então org/projeto/repo não mudam).
 */
export function bareOrigin(dir) {
  const remotes = mkdtempSync(join(tmpdir(), 'factory-remotes-'));
  const bare = join(remotes, 'origin.git');
  mkdirSync(bare);
  execFileSync('git', ['init', '-q', '--bare'], { cwd: bare, stdio: 'ignore' });
  const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: dir, encoding: 'utf8' }).trim();
  execFileSync('git', ['config', `url.file:///${bare.replace(/\\/g, '/')}.insteadOf`, url], { cwd: dir, stdio: 'ignore' });
  return { bare, cleanup: () => rmSync(remotes, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) };
}

/**
 * fetch simulado. `routes` é uma lista de [método, regex do caminho, handler(req) -> {status, body}].
 * Cada chamada fica registrada em `calls` para as asserções.
 */
export function mockFetch(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    let body = init.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // corpo não-JSON (anexo)
      }
    }
    const call = { method, path: u.pathname, query: Object.fromEntries(u.searchParams), body };
    calls.push(call);
    for (const [m, re, handler] of routes) {
      if (m === method && re.test(decodeURIComponent(u.pathname))) {
        const res = (await handler(call)) ?? {};
        const status = res.status ?? 200;
        return new Response(res.body === undefined ? '' : JSON.stringify(res.body), {
          status,
          headers: { 'content-type': 'application/json', date: new Date().toUTCString(), ...(res.headers ?? {}) },
        });
      }
    }
    return new Response(JSON.stringify({ message: `rota não simulada: ${method} ${u.pathname}` }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

export const ME = {
  authenticatedUser: {
    id: 'user-1',
    providerDisplayName: 'Ana Ribeiro',
    properties: { Account: { $value: 'ana@contoso.com' } },
  },
};

export function workItem(id, fields = {}, extra = {}) {
  return {
    id,
    rev: extra.rev ?? 3,
    fields: {
      'System.WorkItemType': 'User Story',
      'System.Title': `Item ${id}`,
      'System.State': 'Ready',
      ...fields,
    },
    relations: extra.relations ?? [],
    _links: { html: { href: `https://dev.azure.com/contoso/Loja/_workitems/edit/${id}` } },
  };
}

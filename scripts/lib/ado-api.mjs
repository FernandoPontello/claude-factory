// Chamadas à API REST do Azure DevOps usadas pela factory. Cada função faz uma coisa só;
// as regras de negócio (idempotência, reserva, trilhas) ficam em ado.mjs.

import { request } from './http.mjs';
import { FactoryError } from './cli.mjs';

const enc = encodeURIComponent;
const proj = (cfg) => enc(cfg.project);

// ---------- identidade ----------

export async function me(cfg) {
  const data = await request(cfg, 'GET', '_apis/connectionData', { api: '7.1-preview.1' });
  const user = data?.authenticatedUser ?? {};
  const email = user.properties?.Account?.$value ?? user.properties?.Account?.['$value'] ?? null;
  return { id: user.id, name: user.providerDisplayName ?? user.customDisplayName ?? email, email };
}

// ---------- projeto e repositório ----------

export async function getProject(cfg) {
  return request(cfg, 'GET', `_apis/projects/${proj(cfg)}`, { query: { includeCapabilities: true } });
}

export async function getRepo(cfg) {
  if (!cfg.repo) {
    throw new FactoryError('config', 'Este comando vale para um repo só, e a sessão está na pasta de trabalho.', 'Passe --repo <nome do repo>, ou rode dentro do clone dele.');
  }
  return request(cfg, 'GET', `${proj(cfg)}/_apis/git/repositories/${enc(cfg.repo)}`);
}

export async function listRepos(cfg) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/_apis/git/repositories`);
  return data?.value ?? [];
}

/** Metadados de um arquivo numa branch, ou null se ele não existe lá. */
export async function getItem(cfg, repoId, path, branch) {
  try {
    return await request(cfg, 'GET', `${proj(cfg)}/_apis/git/repositories/${repoId}/items`, {
      query: { path, 'versionDescriptor.version': branch, 'versionDescriptor.versionType': 'branch', includeContent: false },
    });
  } catch (err) {
    if (err instanceof FactoryError && (err.code === 'not_found' || err.data?.status === 400)) return null;
    throw err;
  }
}

// ---------- sprints ----------

export async function currentIteration(cfg) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/${enc(cfg.team)}/_apis/work/teamsettings/iterations`, {
    query: { $timeframe: 'current' },
  });
  return data?.value?.[0] ?? null;
}

export async function teamSettings(cfg) {
  return request(cfg, 'GET', `${proj(cfg)}/${enc(cfg.team)}/_apis/work/teamsettings`);
}

export async function updateTeamSettings(cfg, body) {
  return request(cfg, 'PATCH', `${proj(cfg)}/${enc(cfg.team)}/_apis/work/teamsettings`, { body });
}

export async function getBranch(cfg, repoId, name) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/_apis/git/repositories/${repoId}/refs`, {
    query: { filter: `heads/${name}` },
  });
  return (data?.value ?? []).find((r) => r.name === `refs/heads/${name}`) ?? null;
}

export async function createBranch(cfg, repoId, name, objectId) {
  const data = await request(cfg, 'POST', `${proj(cfg)}/_apis/git/repositories/${repoId}/refs`, {
    body: [{ name: `refs/heads/${name}`, oldObjectId: '0000000000000000000000000000000000000000', newObjectId: objectId }],
  });
  const result = data?.value?.[0];
  if (result && result.success === false) {
    throw new FactoryError('error', `Não consegui criar a branch ${name}: ${result.customMessage ?? result.updateStatus}`);
  }
  return result;
}

// ---------- work items ----------

export async function getWorkItem(cfg, id) {
  return request(cfg, 'GET', `${proj(cfg)}/_apis/wit/workitems/${id}`, { query: { $expand: 'relations' } });
}

export async function getWorkItems(cfg, ids, fields) {
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const data = await request(cfg, 'POST', `${proj(cfg)}/_apis/wit/workitemsbatch`, {
      body: { ids: ids.slice(i, i + 200), fields },
      safe: true,
    });
    out.push(...(data?.value ?? []));
  }
  return out;
}

export async function createWorkItem(cfg, type, ops) {
  return request(cfg, 'POST', `${proj(cfg)}/_apis/wit/workitems/$${enc(type)}`, {
    body: ops,
    contentType: 'application/json-patch+json',
  });
}

export async function updateWorkItem(cfg, id, ops) {
  return request(cfg, 'PATCH', `${proj(cfg)}/_apis/wit/workitems/${id}`, {
    body: ops,
    contentType: 'application/json-patch+json',
  });
}

export async function wiql(cfg, query, top) {
  const data = await request(cfg, 'POST', `${proj(cfg)}/_apis/wit/wiql`, {
    body: { query },
    query: top ? { $top: top } : {},
    safe: true,
  });
  return (data?.workItems ?? []).map((w) => w.id);
}

export async function listComments(cfg, id) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/_apis/wit/workItems/${id}/comments`, { api: '7.1-preview.4' });
  return data?.comments ?? [];
}

export async function addComment(cfg, id, text) {
  try {
    return await request(cfg, 'POST', `${proj(cfg)}/_apis/wit/workItems/${id}/comments`, {
      api: '7.1-preview.4',
      query: { format: 'markdown' },
      body: { text },
    });
  } catch (err) {
    // Organizações sem suporte a comentário em Markdown recusam o parâmetro; cai para o padrão.
    if (err instanceof FactoryError && err.code === 'error' && err.data?.status === 400) {
      return request(cfg, 'POST', `${proj(cfg)}/_apis/wit/workItems/${id}/comments`, {
        api: '7.1-preview.4',
        body: { text },
      });
    }
    throw err;
  }
}

export async function uploadAttachment(cfg, fileName, buffer) {
  return request(cfg, 'POST', `${proj(cfg)}/_apis/wit/attachments`, {
    query: { fileName },
    body: buffer,
    contentType: 'application/octet-stream',
  });
}

export async function getTypeStates(cfg, type) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/_apis/wit/workitemtypes/${enc(type)}/states`);
  return data?.value ?? [];
}

export async function getTypeFields(cfg, type) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/_apis/wit/workitemtypes/${enc(type)}/fields`);
  return data?.value ?? [];
}

// ---------- pull requests ----------

export async function listPullRequests(cfg, repoId, { source, target, status = 'active' }) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/_apis/git/repositories/${repoId}/pullrequests`, {
    query: {
      'searchCriteria.sourceRefName': source ? `refs/heads/${source}` : undefined,
      'searchCriteria.targetRefName': target ? `refs/heads/${target}` : undefined,
      'searchCriteria.status': status,
    },
  });
  return data?.value ?? [];
}

export async function createPullRequest(cfg, repoId, body) {
  return request(cfg, 'POST', `${proj(cfg)}/_apis/git/repositories/${repoId}/pullrequests`, {
    query: { supportsIterations: true },
    body,
  });
}

export async function getPullRequest(cfg, repoId, prId) {
  return request(cfg, 'GET', `${proj(cfg)}/_apis/git/repositories/${repoId}/pullrequests/${prId}`);
}

export async function updatePullRequest(cfg, repoId, prId, body) {
  return request(cfg, 'PATCH', `${proj(cfg)}/_apis/git/repositories/${repoId}/pullrequests/${prId}`, { body });
}

export async function listThreads(cfg, repoId, prId) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads`);
  return data?.value ?? [];
}

export async function replyThread(cfg, repoId, prId, threadId, content) {
  return request(cfg, 'POST', `${proj(cfg)}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads/${threadId}/comments`, {
    body: { content, commentType: 1 },
  });
}

export async function setThreadStatus(cfg, repoId, prId, threadId, status) {
  return request(cfg, 'PATCH', `${proj(cfg)}/_apis/git/repositories/${repoId}/pullrequests/${prId}/threads/${threadId}`, {
    body: { status },
  });
}

export async function policyEvaluations(cfg, projectId, prId) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/_apis/policy/evaluations`, {
    api: '7.1-preview.1',
    query: { artifactId: `vstfs:///CodeReview/CodeReviewId/${projectId}/${prId}` },
  });
  return data?.value ?? [];
}

// ---------- policies ----------

export async function policyTypes(cfg) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/_apis/policy/types`);
  return data?.value ?? [];
}

/**
 * Policies que valem para uma branch de um repo. O endpoint geral (`_apis/policy/configurations`)
 * ignora repositório e branch; o de git filtra pelos dois.
 */
export async function policyConfigurations(cfg, repoId, refName) {
  const data = await request(cfg, 'GET', `${proj(cfg)}/_apis/git/policy/configurations`, {
    api: '7.1-preview.1',
    query: { repositoryId: repoId, refName, $top: 1000 },
  });
  return data?.value ?? [];
}

export async function createPolicy(cfg, body) {
  return request(cfg, 'POST', `${proj(cfg)}/_apis/policy/configurations`, { body });
}

// ---------- processo (estados) ----------

export async function processWorkItemTypes(cfg, processId) {
  const data = await request(cfg, 'GET', `_apis/work/processes/${processId}/workitemtypes`);
  return data?.value ?? [];
}

/** O processo e, com `projects: true`, os projetos que o usam. */
export async function getProcess(cfg, processId, { projects = false } = {}) {
  return request(cfg, 'GET', `_apis/work/processes/${processId}`, { query: projects ? { $expand: 'projects' } : {} });
}

export async function deriveWorkItemType(cfg, processId, systemType) {
  return request(cfg, 'POST', `_apis/work/processes/${processId}/workitemtypes`, {
    body: { name: systemType.name, inheritsFrom: systemType.referenceName, color: systemType.color, icon: systemType.icon },
  });
}

export async function processStates(cfg, processId, witRef) {
  const data = await request(cfg, 'GET', `_apis/work/processes/${processId}/workitemtypes/${enc(witRef)}/states`);
  return data?.value ?? [];
}

export async function createProcessState(cfg, processId, witRef, state) {
  return request(cfg, 'POST', `_apis/work/processes/${processId}/workitemtypes/${enc(witRef)}/states`, { body: state });
}

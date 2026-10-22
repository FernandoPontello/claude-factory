#!/usr/bin/env node
// ado — a única porta da factory para o Azure DevOps.
// Saída: sempre um objeto JSON. Código de saída: 0 ok · 2 login · 3 não encontrado ·
// 4 conflito · 5 configuração · 1 outro erro. Rodar duas vezes nunca duplica nada.
//
// Uso: node ado.mjs <grupo> <comando> [--opções]
//   doctor [--for prd|deliver|release|setup]
//   whoami
//   wi show|create|update|search|link|deps|claim|release|state|comment|attach
//   pr create|status|threads|reply
//   branch ensure
//   setup check|apply

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { FactoryError, isEntryPoint, parseArgs, required, run, toId } from './lib/cli.mjs';
import { resolveConfig } from './lib/config.mjs';
import { clockSkewSeconds } from './lib/http.mjs';
import * as api from './lib/ado-api.mjs';
import { appendMark } from './lib/runs.mjs';

const PR_DESCRIPTION_LIMIT = 4000;

// ---------- utilidades ----------

function readFileArg(path) {
  if (!existsSync(path)) throw new FactoryError('config', `Arquivo não encontrado: ${path}`);
  return readFileSync(path, 'utf8');
}

function wiqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function typeName(cfg, value) {
  if (!value) return cfg.types.feature;
  const key = String(value).toLowerCase();
  if (key === 'feature' || key === 'story' || key === 'user story') return cfg.types.feature;
  if (key === 'bug' || key === 'bugfix' || key === 'hotfix') return cfg.types.bug;
  return value;
}

function stateName(cfg, value) {
  if (!value) return value;
  return cfg.states[value] ?? value;
}

/**
 * Os estados que o agente pode escrever. Integrado, Homologando e Closed só mudam no merge da PR
 * (pela descrição `<Estado> #id`); escrever neles à mão faria o board mentir.
 */
function agentState(cfg, value) {
  const name = stateName(cfg, value);
  const mergeOnly = [cfg.states.integrated, cfg.states.qa, cfg.states.closed];
  if (mergeOnly.includes(name)) {
    throw new FactoryError('config', `O estado "${name}" muda sozinho no merge da PR; a factory não o escreve.`, 'Use new, ready, running, review ou removed.');
  }
  return name;
}

const isBugType = (cfg, type) => String(type).toLowerCase() === String(cfg.types.bug).toLowerCase();

function workItemUrl(cfg, id) {
  return `${cfg.orgUrl}/${encodeURIComponent(cfg.project)}/_workitems/edit/${id}`;
}

function apiWorkItemUrl(cfg, id) {
  return `${cfg.orgUrl}/_apis/wit/workItems/${id}`;
}

function prUrl(cfg, id) {
  return `${cfg.orgUrl}/${encodeURIComponent(cfg.project)}/_git/${encodeURIComponent(cfg.repo)}/pullrequest/${id}`;
}

function idFromUrl(url) {
  const m = String(url ?? '').match(/\/workItems\/(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function splitIds(value) {
  if (value === undefined || value === true) return [];
  return String(value)
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((v) => toId(v, 'wi'));
}

function sameUser(a, b) {
  if (!a || !b) return false;
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

const REL = {
  related: 'System.LinkTypes.Related',
  predecessor: 'System.LinkTypes.Dependency-Reverse',
  parent: 'System.LinkTypes.Hierarchy-Reverse',
};

function summarize(cfg, item) {
  const f = item.fields ?? {};
  const relations = item.relations ?? [];
  const byRel = (rel) => relations.filter((r) => r.rel === rel).map((r) => idFromUrl(r.url)).filter(Boolean);
  return {
    id: item.id,
    rev: item.rev,
    type: f['System.WorkItemType'],
    title: f['System.Title'],
    state: f['System.State'],
    assignedTo: f['System.AssignedTo']?.uniqueName ?? f['System.AssignedTo'] ?? null,
    tags: f['System.Tags'] ? String(f['System.Tags']).split(';').map((t) => t.trim()).filter(Boolean) : [],
    description: f['System.Description'] || f['Microsoft.VSTS.TCM.ReproSteps'] || '',
    descriptionFormat: item.multilineFieldsFormat?.['System.Description'] ?? item.multilineFieldsFormat?.['Microsoft.VSTS.TCM.ReproSteps'] ?? 'Html',
    url: item._links?.html?.href ?? workItemUrl(cfg, item.id),
    related: byRel(REL.related),
    dependsOn: byRel(REL.predecessor),
    parent: byRel(REL.parent)[0] ?? null,
    attachments: relations.filter((r) => r.rel === 'AttachedFile').map((r) => ({ name: r.attributes?.name, url: r.url })),
    pullRequests: relations.filter((r) => r.rel === 'ArtifactLink' && /PullRequestId/i.test(r.url)).map((r) => r.url),
  };
}

/** O dossiê vai na descrição; no Bug, também em Repro Steps, que é o campo que o formulário mostra. */
function descriptionOps(markdown, isBug = false) {
  const fields = ['System.Description', ...(isBug ? ['Microsoft.VSTS.TCM.ReproSteps'] : [])];
  return fields.flatMap((field) => [
    { op: 'add', path: `/fields/${field}`, value: markdown },
    { op: 'add', path: `/multilineFieldsFormat/${field}`, value: 'Markdown' },
  ]);
}

function relationOp(cfg, rel, targetId) {
  return { op: 'add', path: '/relations/-', value: { rel, url: apiWorkItemUrl(cfg, targetId) } };
}

// ---------- doctor ----------

const SCOPES = {
  prd: ['node', 'remote', 'token', 'project', 'identity', 'states'],
  deliver: ['node', 'remote', 'token', 'project', 'identity', 'states', 'branches', 'policies', 'recipe'],
  release: ['node', 'remote', 'token', 'project', 'identity', 'states', 'branches'],
  setup: [],
};

const REQUIRED_STATES = ['new', 'ready', 'running', 'review', 'integrated', 'qa', 'closed'];

async function doctor(args) {
  const scope = String(args.for ?? 'deliver');
  if (!SCOPES[scope]) throw new FactoryError('config', `--for precisa ser prd, deliver, release ou setup (recebi "${scope}").`);
  const requiredChecks = new Set(SCOPES[scope]);
  const checks = [];
  const add = (id, ok, detail, fix) => checks.push({ id, ok, required: requiredChecks.has(id), detail, fix: ok ? undefined : fix });

  const major = Number(process.versions.node.split('.')[0]);
  add('node', major >= 20, `Node ${process.versions.node}`, 'Instale o Node 20 ou mais novo.');

  let cfg;
  try {
    cfg = resolveConfig();
    add('remote', true, `${cfg.org} / ${cfg.project} / ${cfg.repo}`);
  } catch (err) {
    add('remote', false, err.message, err.fix);
    return finishDoctor(checks);
  }

  try {
    await api.me(cfg).then((user) => {
      add('token', true, 'login do Azure CLI válido');
      add('identity', Boolean(user.email), `${user.name ?? '?'} <${user.email ?? 'sem e-mail'}>`, 'A conta do az login não tem e-mail no Azure DevOps; use a conta da organização.');
    });
  } catch (err) {
    add('token', false, err.message, err.fix ?? 'Rode `az login` no tenant da organização.');
    return finishDoctor(checks);
  }

  let repo;
  try {
    repo = await api.getRepo(cfg);
    add('project', true, `repo ${repo.name}, branch padrão ${repo.defaultBranch ?? '?'}`);
  } catch (err) {
    add('project', false, err.message, 'Confira se sua conta tem acesso ao projeto e ao repositório no Azure DevOps.');
    return finishDoctor(checks);
  }

  const mainBranch = String(repo.defaultBranch ?? 'refs/heads/main').replace('refs/heads/', '');
  const wanted = [mainBranch, cfg.branches.qa, cfg.branches.develop];
  const missingBranches = [];
  for (const name of wanted) {
    if (!(await api.getBranch(cfg, repo.id, name))) missingBranches.push(name);
  }
  add('branches', missingBranches.length === 0, missingBranches.length ? `faltam: ${missingBranches.join(', ')}` : wanted.join(', '), 'Rode /setup: ele cria as branches que faltam.');

  const missingStates = [];
  for (const type of [cfg.types.feature, cfg.types.bug]) {
    try {
      const names = (await api.getTypeStates(cfg, type)).map((s) => s.name);
      for (const key of REQUIRED_STATES) {
        if (!names.includes(cfg.states[key])) missingStates.push(`${type}: ${cfg.states[key]}`);
      }
    } catch (err) {
      missingStates.push(`${type}: ${err.message}`);
    }
  }
  add('states', missingStates.length === 0, missingStates.length ? `faltam: ${missingStates.join('; ')}` : 'todos os estados existem', 'O admin da organização roda /setup uma vez (ou segue docs/ADMIN.md).');

  try {
    const types = await api.policyTypes(cfg);
    const reviewersType = types.find((t) => t.displayName === 'Minimum number of reviewers');
    const unprotected = [];
    for (const name of wanted) {
      const configs = await api.policyConfigurations(cfg, repo.id, `refs/heads/${name}`);
      if (!configs.some((c) => c.type?.id === reviewersType?.id && c.isEnabled)) unprotected.push(name);
    }
    add('policies', unprotected.length === 0, unprotected.length ? `sem aprovação obrigatória: ${unprotected.join(', ')}` : 'aprovação obrigatória nas três branches', 'Rode /setup (com permissão de Project Administrator) para aplicar as policies.');
  } catch (err) {
    add('policies', false, err.message, 'Confira as branch policies em Project Settings > Repositories > Policies.');
  }

  // Projeto sem tela (job, CLI, biblioteca) não tem app para subir: start/ready só com e2e.
  const recipe = cfg.run ?? {};
  const needed = ['install', 'test', ...(recipe.e2e ? ['start', 'ready'] : [])];
  const missingRecipe = needed.filter((k) => !recipe[k]);
  add('recipe', missingRecipe.length === 0, missingRecipe.length ? `faltam em .factory/project.json: ${missingRecipe.join(', ')}` : 'receita de execução completa', 'Rode /setup para descobrir e provar a receita de execução.');

  const skew = clockSkewSeconds();
  if (skew !== null) {
    add('clock', Math.abs(skew) <= 120, `relógio local ${skew >= 0 ? 'adiantado' : 'atrasado'} ${Math.abs(skew)} s em relação ao Azure DevOps`, 'Acerte o relógio da máquina; as durações do run dependem dele.');
  }

  return finishDoctor(checks);
}

function finishDoctor(checks) {
  const failing = checks.filter((c) => c.required && !c.ok);
  if (failing.length) {
    throw new FactoryError('config', `${failing.length} item(ns) para consertar antes de seguir.`, failing[0].fix, { checks });
  }
  return { checks };
}

// ---------- work items ----------

async function wiShow(cfg, args) {
  const id = toId(required(args, 'id'));
  return { item: summarize(cfg, await api.getWorkItem(cfg, id)) };
}

async function findByKey(cfg, key) {
  const ids = await api.wiql(
    cfg,
    `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS ${wiqlString(`factory-key:${key}`)}`,
  );
  return ids[0] ?? null;
}

async function wiCreate(cfg, args) {
  const type = typeName(cfg, args.type);
  const title = required(args, 'title');
  const description = args['description-file'] ? readFileArg(args['description-file']) : '';
  const key = args.key && args.key !== true ? String(args.key) : null;
  const state = args.state ? stateName(cfg, args.state) : null;
  if (state && ![cfg.states.new, cfg.states.ready].includes(state)) {
    throw new FactoryError('config', `Item novo nasce em "${cfg.states.new}" ou "${cfg.states.ready}" (recebi "${state}").`);
  }

  if (key) {
    const existing = await findByKey(cfg, key);
    if (existing) {
      // Rodar de novo recupera o item e aplica o que mudou, enquanto ele ainda é do PO.
      const current = summarize(cfg, await api.getWorkItem(cfg, existing));
      const ops = [];
      if ([cfg.states.new, cfg.states.ready].includes(current.state)) {
        if (description && description !== current.description) ops.push(...descriptionOps(description, isBugType(cfg, current.type)));
        if (state && state !== current.state) ops.push({ op: 'add', path: '/fields/System.State', value: state });
      }
      if (!ops.length) return { created: false, updated: false, item: current };
      return { created: false, updated: true, item: summarize(cfg, await api.updateWorkItem(cfg, existing, ops)) };
    }
  }

  const tags = [];
  if (key) tags.push(`factory-key:${key}`);
  if (args.tags && args.tags !== true) tags.push(...String(args.tags).split(';').map((t) => t.trim()).filter(Boolean));

  const ops = [{ op: 'add', path: '/fields/System.Title', value: title }];
  if (description) ops.push(...descriptionOps(description, isBugType(cfg, type)));
  if (tags.length) ops.push({ op: 'add', path: '/fields/System.Tags', value: tags.join('; ') });
  if (args.parent) ops.push(relationOp(cfg, REL.parent, toId(args.parent, 'parent')));
  for (const id of splitIds(args.related)) ops.push(relationOp(cfg, REL.related, id));
  for (const id of splitIds(args['depends-on'])) ops.push(relationOp(cfg, REL.predecessor, id));

  let item = await api.createWorkItem(cfg, type, ops);
  if (state && state !== item.fields?.['System.State']) {
    item = await api.updateWorkItem(cfg, item.id, [{ op: 'add', path: '/fields/System.State', value: state }]);
  }
  return { created: true, item: summarize(cfg, item) };
}

async function wiUpdate(cfg, args) {
  const id = toId(required(args, 'id'));
  const current = summarize(cfg, await api.getWorkItem(cfg, id));
  const ops = [];
  if (args.title && args.title !== true) ops.push({ op: 'add', path: '/fields/System.Title', value: args.title });
  if (args['description-file']) ops.push(...descriptionOps(readFileArg(args['description-file']), isBugType(cfg, current.type)));
  if (args.state) ops.push({ op: 'add', path: '/fields/System.State', value: agentState(cfg, args.state) });
  if (args['add-tags'] && args['add-tags'] !== true) {
    const merged = [...new Set([...current.tags, ...String(args['add-tags']).split(';').map((t) => t.trim()).filter(Boolean)])];
    ops.push({ op: 'add', path: '/fields/System.Tags', value: merged.join('; ') });
  }
  if (!ops.length) throw new FactoryError('config', 'Nada para atualizar.', 'Passe --title, --description-file, --state ou --add-tags.');
  return { item: summarize(cfg, await api.updateWorkItem(cfg, id, ops)) };
}

async function wiSearch(cfg, args) {
  const clauses = ['[System.TeamProject] = @project'];
  // --type-name usa o nome literal do tipo (ex.: "Feature" da factory antiga), sem os apelidos.
  const kind = String(args.type ?? 'all').toLowerCase();
  const types = args['type-name'] && args['type-name'] !== true
    ? [String(args['type-name'])]
    : kind === 'all' ? [cfg.types.feature, cfg.types.bug] : [typeName(cfg, kind)];
  clauses.push(`[System.WorkItemType] IN (${types.map(wiqlString).join(', ')})`);
  if (args.state && args.state !== true) {
    const states = String(args.state).split(',').map((s) => stateName(cfg, s.trim()));
    clauses.push(`[System.State] IN (${states.map(wiqlString).join(', ')})`);
  }
  if (args.text && args.text !== true) {
    const t = wiqlString(args.text);
    clauses.push(`([System.Title] CONTAINS ${t} OR [System.Description] CONTAINS ${t})`);
  }
  if (args.tag && args.tag !== true) clauses.push(`[System.Tags] CONTAINS ${wiqlString(args.tag)}`);
  if (args.mine) clauses.push('[System.AssignedTo] = @me');
  const query = `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')} ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.Id] ASC`;
  const top = Number(args.top ?? 20);
  const ids = (await api.wiql(cfg, query, top)).slice(0, top);
  const fields = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.AssignedTo', 'System.Tags'];
  const items = await api.getWorkItems(cfg, ids, fields);
  const byId = new Map(items.map((i) => [i.id, i]));
  const prefix = args['tag-prefix'] && args['tag-prefix'] !== true ? String(args['tag-prefix']) : null;
  const hasPrefix = (i) => String(i.fields['System.Tags'] ?? '').split(';').some((t) => t.trim().startsWith(prefix));
  return {
    items: ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((i) => !prefix || hasPrefix(i))
      .map((i) => ({
        id: i.id,
        type: i.fields['System.WorkItemType'],
        title: i.fields['System.Title'],
        state: i.fields['System.State'],
        assignedTo: i.fields['System.AssignedTo']?.uniqueName ?? null,
        tags: i.fields['System.Tags'] ?? '',
        url: workItemUrl(cfg, i.id),
      })),
  };
}

async function wiLink(cfg, args) {
  const id = toId(required(args, 'id'));
  const item = await api.getWorkItem(cfg, id);
  const relations = item.relations ?? [];
  const ops = [];
  const wanted = [
    ...splitIds(args.related).map((t) => [REL.related, t]),
    ...splitIds(args['depends-on']).map((t) => [REL.predecessor, t]),
  ];
  if (!wanted.length) throw new FactoryError('config', 'Nada para linkar.', 'Passe --related <id> ou --depends-on <id>.');
  for (const [rel, target] of wanted) {
    if (!relations.some((r) => r.rel === rel && idFromUrl(r.url) === target)) ops.push(relationOp(cfg, rel, target));
  }
  if (!ops.length) return { changed: false, item: summarize(cfg, item) };
  return { changed: true, item: summarize(cfg, await api.updateWorkItem(cfg, id, ops)) };
}

async function wiDeps(cfg, args) {
  const id = toId(required(args, 'id'));
  const item = summarize(cfg, await api.getWorkItem(cfg, id));
  if (!item.dependsOn.length) return { dependsOn: [], blocked: [] };
  const deps = await api.getWorkItems(cfg, item.dependsOn, ['System.Id', 'System.Title', 'System.State']);
  const done = new Set([cfg.states.integrated, cfg.states.qa, cfg.states.closed]);
  const list = deps.map((d) => ({ id: d.id, title: d.fields['System.Title'], state: d.fields['System.State'] }));
  return { dependsOn: list, blocked: list.filter((d) => !done.has(d.state)) };
}

async function wiClaim(cfg, args) {
  const id = toId(required(args, 'id'));
  const user = await api.me(cfg);
  const raw = await api.getWorkItem(cfg, id);
  const item = summarize(cfg, raw);

  // Retomada: o item já é desta pessoa, em execução ou com a PR aberta. Nada é escrito.
  if ([cfg.states.running, cfg.states.review].includes(item.state) && sameUser(item.assignedTo, user.email)) {
    appendMark(cfg, id, 'resumed');
    return { claimed: true, resumed: true, item };
  }
  if (item.state !== cfg.states.ready) {
    throw new FactoryError('conflict', `O item #${id} está em "${item.state}", não em "${cfg.states.ready}".`, 'Escolha um item em Ready, ou peça ao PO para mover este.', { item });
  }
  if (item.assignedTo && !sameUser(item.assignedTo, user.email)) {
    throw new FactoryError('conflict', `O item #${id} já está atribuído a ${item.assignedTo}.`, 'Escolha outro item, ou combine com quem está com ele.', { item });
  }
  const updated = await api.updateWorkItem(cfg, id, [
    { op: 'test', path: '/rev', value: raw.rev },
    { op: 'add', path: '/fields/System.State', value: cfg.states.running },
    { op: 'add', path: '/fields/System.AssignedTo', value: user.email },
  ]);
  appendMark(cfg, id, 'claimed');
  return { claimed: true, resumed: false, item: summarize(cfg, updated) };
}

async function wiRelease(cfg, args) {
  const id = toId(required(args, 'id'));
  const updated = await api.updateWorkItem(cfg, id, [
    { op: 'add', path: '/fields/System.State', value: cfg.states.ready },
    { op: 'add', path: '/fields/System.AssignedTo', value: '' },
  ]);
  appendMark(cfg, id, 'released');
  return { item: summarize(cfg, updated) };
}

async function wiState(cfg, args) {
  const id = toId(required(args, 'id'));
  const to = agentState(cfg, required(args, 'to'));
  const current = summarize(cfg, await api.getWorkItem(cfg, id));
  if (current.state === to) return { changed: false, item: current };
  // O item nunca volta: depois do merge (Integrado, Homologando, Closed) nada o move para trás.
  const merged = [cfg.states.integrated, cfg.states.qa, cfg.states.closed];
  if (merged.includes(current.state) && to !== cfg.states.removed) {
    return { changed: false, note: `O item já está em "${current.state}"; o merge passou na frente.`, item: current };
  }
  if (to === cfg.states.review && current.state !== cfg.states.running) {
    return { changed: false, note: `"${cfg.states.review}" só vem de "${cfg.states.running}"; o item está em "${current.state}".`, item: current };
  }
  return { changed: true, item: summarize(cfg, await api.updateWorkItem(cfg, id, [{ op: 'add', path: '/fields/System.State', value: to }])) };
}

const MARKER_EVENTS = { kickoff: 'go' };

async function wiComment(cfg, args) {
  const id = toId(required(args, 'id'));
  const marker = String(required(args, 'marker'));
  const body = readFileArg(required(args, 'file'));
  const tag = `[factory:${marker}]`;
  const comments = await api.listComments(cfg, id);
  if (comments.some((c) => String(c.text ?? '').includes(tag))) return { added: false, marker };
  const comment = await api.addComment(cfg, id, `${tag}\n\n${body}`);
  if (MARKER_EVENTS[marker]) appendMark(cfg, id, MARKER_EVENTS[marker]);
  return { added: true, marker, commentId: comment?.id };
}

async function wiAttach(cfg, args) {
  const id = toId(required(args, 'id'));
  const file = required(args, 'file');
  if (!existsSync(file)) throw new FactoryError('config', `Arquivo não encontrado: ${file}`);
  const name = args.name && args.name !== true ? String(args.name) : basename(file);
  const item = await api.getWorkItem(cfg, id);
  const existing = (item.relations ?? []).find((r) => r.rel === 'AttachedFile' && r.attributes?.name === name);
  if (existing) return { attached: false, name, url: existing.url };
  const upload = await api.uploadAttachment(cfg, name, readFileSync(file));
  await api.updateWorkItem(cfg, id, [
    { op: 'add', path: '/relations/-', value: { rel: 'AttachedFile', url: upload.url, attributes: { name, comment: 'factory' } } },
  ]);
  return { attached: true, name, url: upload.url };
}

// ---------- pull requests ----------

function prLink(projectId, repoId, prId) {
  return `vstfs:///Git/PullRequestId/${projectId}%2F${repoId}%2F${prId}`;
}

async function ensurePrLinks(cfg, ids, projectId, repoId, prId) {
  const url = prLink(projectId, repoId, prId);
  for (const id of ids) {
    const item = await api.getWorkItem(cfg, id);
    const has = (item.relations ?? []).some((r) => r.rel === 'ArtifactLink' && String(r.url).toLowerCase() === url.toLowerCase());
    if (!has) {
      await api.updateWorkItem(cfg, id, [
        { op: 'add', path: '/relations/-', value: { rel: 'ArtifactLink', url, attributes: { name: 'Pull Request' } } },
      ]);
    }
  }
}

async function prCreate(cfg, args) {
  const source = required(args, 'source');
  const target = required(args, 'target');
  const title = required(args, 'title');
  const ids = splitIds(args.wi);
  let description = args['description-file'] ? readFileArg(args['description-file']).trim() : '';
  const onMerge = args['on-merge'] && args['on-merge'] !== true ? stateName(cfg, args['on-merge']) : null;
  if (onMerge && ids.length) {
    description += `${description ? '\n\n' : ''}${ids.map((id) => `${onMerge} #${id}`).join('\n')}`;
  }
  if (description.length > PR_DESCRIPTION_LIMIT) {
    throw new FactoryError('config', `A descrição da PR tem ${description.length} caracteres; o Azure DevOps aceita até ${PR_DESCRIPTION_LIMIT}.`, 'Resuma a descrição e deixe o detalhe no relatório anexado ao item.');
  }
  const strategy = args.merge === 'merge' ? 'noFastForward' : 'squash';
  const repo = await api.getRepo(cfg);
  const projectId = repo.project?.id;

  const existing = (await api.listPullRequests(cfg, repo.id, { source, target }))[0];
  let pr;
  let created = false;
  if (existing) {
    pr = await api.updatePullRequest(cfg, repo.id, existing.pullRequestId, { title, description });
    if (ids.length && projectId) await ensurePrLinks(cfg, ids, projectId, repo.id, existing.pullRequestId);
  } else {
    pr = await api.createPullRequest(cfg, repo.id, {
      sourceRefName: `refs/heads/${source}`,
      targetRefName: `refs/heads/${target}`,
      title,
      description,
      isDraft: Boolean(args.draft),
      workItemRefs: ids.map((id) => ({ id: String(id) })),
      labels: [{ name: 'factory' }],
    });
    created = true;
  }

  const prId = pr.pullRequestId ?? existing?.pullRequestId;
  if (!args['no-auto-complete'] && !args.draft) {
    const user = await api.me(cfg);
    await api.updatePullRequest(cfg, repo.id, prId, {
      autoCompleteSetBy: { id: user.id },
      completionOptions: {
        mergeStrategy: strategy,
        deleteSourceBranch: Boolean(args['delete-source']),
        // Só transiciona quando a descrição traz o estado (`Integrado #id`). Num back-merge,
        // "completar itens linkados" levaria o item a Closed antes da hora.
        transitionWorkItems: Boolean(onMerge),
        // Só a PR principal cita os itens no commit: num back-merge o #id faria o item aparecer
        // de novo na próxima promoção.
        mergeCommitMessage: `${title}${onMerge && ids.length ? `\n\n${ids.map((id) => `#${id}`).join(' ')}` : ''}`,
      },
    });
  }
  if (args.run && args.run !== true) appendMark(cfg, toId(args.run, 'run'), 'delivered', { pr: prId, target });
  return { created, id: prId, url: prUrl(cfg, prId), source, target, mergeStrategy: strategy };
}

async function prStatus(cfg, args) {
  const prId = toId(required(args, 'id'));
  const repo = await api.getRepo(cfg);
  const pr = await api.getPullRequest(cfg, repo.id, prId);
  const evaluations = repo.project?.id ? await api.policyEvaluations(cfg, repo.project.id, prId) : [];
  const threads = await api.listThreads(cfg, repo.id, prId);
  const openThreads = threads.filter((t) => ['active', 'pending'].includes(t.status) && !t.isDeleted && (t.comments ?? []).some((c) => c.commentType === 'text'));
  return {
    id: prId,
    url: prUrl(cfg, prId),
    status: pr.status,
    mergeStatus: pr.mergeStatus,
    isDraft: pr.isDraft,
    autoComplete: Boolean(pr.autoCompleteSetBy),
    reviewers: (pr.reviewers ?? []).map((r) => ({ name: r.displayName, vote: r.vote })),
    policies: evaluations.map((e) => ({ policy: e.configuration?.type?.displayName, status: e.status })),
    openThreads: openThreads.length,
  };
}

async function prThreads(cfg, args) {
  const prId = toId(required(args, 'id'));
  const repo = await api.getRepo(cfg);
  const threads = await api.listThreads(cfg, repo.id, prId);
  const all = Boolean(args.all);
  return {
    threads: threads
      .filter((t) => !t.isDeleted && (t.comments ?? []).some((c) => c.commentType === 'text'))
      .filter((t) => all || ['active', 'pending'].includes(t.status))
      .map((t) => ({
        id: t.id,
        status: t.status,
        file: t.threadContext?.filePath ?? null,
        line: t.threadContext?.rightFileStart?.line ?? null,
        comments: (t.comments ?? [])
          .filter((c) => c.commentType === 'text')
          .map((c) => ({ id: c.id, author: c.author?.displayName, content: c.content })),
      })),
  };
}

async function prReply(cfg, args) {
  const prId = toId(required(args, 'id'));
  const threadId = toId(required(args, 'thread'), 'thread');
  const content = readFileArg(required(args, 'file')).trim();
  const repo = await api.getRepo(cfg);
  const thread = (await api.listThreads(cfg, repo.id, prId)).find((t) => t.id === threadId);
  if (!thread) throw new FactoryError('not_found', `A PR ${prId} não tem a thread ${threadId}.`);
  const already = (thread.comments ?? []).some((c) => String(c.content ?? '').trim() === content);
  if (!already) await api.replyThread(cfg, repo.id, prId, threadId, content);
  if (args.resolve && thread.status !== 'fixed') await api.setThreadStatus(cfg, repo.id, prId, threadId, 'fixed');
  return { replied: !already, resolved: Boolean(args.resolve) };
}

// ---------- branches ----------

async function branchEnsure(cfg, args) {
  const name = required(args, 'name');
  const repo = await api.getRepo(cfg);
  const existing = await api.getBranch(cfg, repo.id, name);
  if (existing) return { created: false, name, objectId: existing.objectId };
  const from = args.from && args.from !== true ? String(args.from) : String(repo.defaultBranch ?? 'refs/heads/main').replace('refs/heads/', '');
  const source = await api.getBranch(cfg, repo.id, from);
  if (!source) throw new FactoryError('not_found', `A branch de origem "${from}" não existe no repo.`);
  await api.createBranch(cfg, repo.id, name, source.objectId);
  return { created: true, name, from, objectId: source.objectId };
}

// ---------- setup ----------

const STATE_SPECS = {
  ready: { stateCategory: 'Proposed', color: 'b2b2b2' },
  running: { stateCategory: 'InProgress', color: '007acc' },
  review: { stateCategory: 'InProgress', color: 'ff9d00' },
  integrated: { stateCategory: 'InProgress', color: '5688e0' },
  qa: { stateCategory: 'InProgress', color: '773b93' },
};

const POLICY_NAMES = {
  reviewers: 'Minimum number of reviewers',
  workItems: 'Work item linking',
  comments: 'Comment requirements',
  build: 'Build',
};

async function fixedBranches(cfg, repo) {
  const main = String(repo.defaultBranch ?? 'refs/heads/main').replace('refs/heads/', '');
  return { main, qa: cfg.branches.qa, develop: cfg.branches.develop };
}

async function inspectStates(cfg) {
  const missing = {};
  for (const type of [cfg.types.feature, cfg.types.bug]) {
    const names = (await api.getTypeStates(cfg, type)).map((s) => s.name);
    const lacking = Object.keys(STATE_SPECS).filter((k) => !names.includes(cfg.states[k]));
    if (lacking.length) missing[type] = lacking;
  }
  return missing;
}

async function inspectPolicies(cfg, repo, branches) {
  const types = await api.policyTypes(cfg);
  const typeIds = Object.fromEntries(Object.entries(POLICY_NAMES).map(([k, name]) => [k, types.find((t) => t.displayName === name)?.id]));
  const wantedKinds = ['reviewers', 'workItems', 'comments', ...(cfg.buildDefinitionId ? ['build'] : [])];
  const missing = {};
  for (const name of Object.values(branches)) {
    const configs = await api.policyConfigurations(cfg, repo.id, `refs/heads/${name}`);
    const lacking = wantedKinds.filter((k) => typeIds[k] && !configs.some((c) => c.type?.id === typeIds[k] && c.isEnabled && !c.isDeleted));
    if (lacking.length) missing[name] = lacking;
  }
  return { typeIds, missing };
}

async function setupCheck(cfg) {
  const repo = await api.getRepo(cfg);
  const branches = await fixedBranches(cfg, repo);
  const missingBranches = [];
  for (const name of Object.values(branches)) {
    if (!(await api.getBranch(cfg, repo.id, name))) missingBranches.push(name);
  }
  const states = await inspectStates(cfg);
  const { missing: policies } = await inspectPolicies(cfg, repo, branches);
  return {
    branches: { fixed: branches, missing: missingBranches },
    states: { missing: states },
    policies: { missing: policies },
    manual: [
      'Repos > Settings: ligue "Commit mention linking" e "Commit mention work item resolution" (não há API pública estável para isso).',
      'Boards > colunas do time: nomeie as colunas em português (Rascunho, Pronto para dev, Em execução, Em revisão, Integrado, Em homologação, Concluído).',
    ],
  };
}

function policySettings(kind, repoId, refName, cfg) {
  const scope = [{ repositoryId: repoId, refName, matchKind: 'Exact' }];
  if (kind === 'reviewers') {
    return {
      minimumApproverCount: 1,
      creatorVoteCounts: true,
      allowDownvotes: false,
      resetOnSourcePush: true,
      requireVoteOnLastIteration: true,
      scope,
    };
  }
  if (kind === 'build') {
    return { buildDefinitionId: Number(cfg.buildDefinitionId), queueOnSourceUpdateOnly: true, manualQueueOnly: false, displayName: 'factory: build', validDuration: 720, scope };
  }
  return { scope };
}

async function applyStates(cfg) {
  const missing = await inspectStates(cfg);
  if (!Object.keys(missing).length) return { applied: [], skipped: 'todos os estados já existem' };
  const project = await api.getProject(cfg);
  const processId = project.capabilities?.processTemplate?.templateTypeId;
  if (!processId) throw new FactoryError('error', 'Não consegui descobrir o processo do projeto.');
  const processInfo = await api.getProcess(cfg, processId);
  if (processInfo.customizationType === 'system') {
    throw new FactoryError(
      'config',
      `O projeto usa o processo de sistema "${processInfo.name}", que não pode receber estados.`,
      'O admin da organização cria o processo herdado "Factory" (base Agile) e muda o projeto para ele; veja docs/ADMIN.md.',
    );
  }
  const applied = [];
  const witList = await api.processWorkItemTypes(cfg, processId);
  for (const [witName, keys] of Object.entries(missing)) {
    let wit = witList.find((w) => w.name === witName);
    if (!wit) throw new FactoryError('config', `O processo não tem o tipo "${witName}".`);
    if (wit.customization === 'system') wit = await api.deriveWorkItemType(cfg, processId, wit);
    for (const key of keys) {
      await api.createProcessState(cfg, processId, wit.referenceName, { name: cfg.states[key], ...STATE_SPECS[key] });
      applied.push(`${witName}: ${cfg.states[key]}`);
    }
  }
  return { applied };
}

async function applyBranches(cfg, repo, branches) {
  const created = [];
  for (const name of [branches.qa, branches.develop]) {
    const result = await branchEnsure(cfg, { name, from: branches.main });
    if (result.created) created.push(name);
  }
  return { created };
}

async function applyPolicies(cfg, repo, branches) {
  const { typeIds, missing } = await inspectPolicies(cfg, repo, branches);
  const applied = [];
  for (const [branch, kinds] of Object.entries(missing)) {
    for (const kind of kinds) {
      await api.createPolicy(cfg, {
        isEnabled: true,
        isBlocking: true,
        type: { id: typeIds[kind] },
        settings: policySettings(kind, repo.id, `refs/heads/${branch}`, cfg),
      });
      applied.push(`${branch}: ${POLICY_NAMES[kind]}`);
    }
  }
  return { applied };
}

async function setupApply(cfg, args) {
  const only = args.only && args.only !== true ? String(args.only).split(',') : ['states', 'branches', 'policies'];
  const repo = await api.getRepo(cfg);
  const branches = await fixedBranches(cfg, repo);
  const result = {};
  const failures = [];
  // Ordem: estados, branches e, por último, policies (depois delas nada entra sem PR).
  for (const step of ['states', 'branches', 'policies']) {
    if (!only.includes(step)) continue;
    try {
      if (step === 'states') result.states = await applyStates(cfg);
      if (step === 'branches') result.branches = await applyBranches(cfg, repo, branches);
      if (step === 'policies') result.policies = await applyPolicies(cfg, repo, branches);
    } catch (err) {
      failures.push({ step, error: err.message, fix: err.fix });
    }
  }
  if (failures.length) throw new FactoryError(failures[0].step === 'states' ? 'config' : 'error', 'Parte do setup não foi aplicada.', failures[0].fix, { result, failures });
  return result;
}

// ---------- roteamento ----------

const COMMANDS = {
  doctor: { _: (_cfg, args) => doctor(args), noConfig: true },
  whoami: { _: async (cfg) => ({ user: await api.me(cfg) }) },
  wi: {
    show: wiShow,
    create: wiCreate,
    update: wiUpdate,
    search: wiSearch,
    link: wiLink,
    deps: wiDeps,
    claim: wiClaim,
    release: wiRelease,
    state: wiState,
    comment: wiComment,
    attach: wiAttach,
  },
  pr: { create: prCreate, status: prStatus, threads: prThreads, reply: prReply },
  branch: { ensure: branchEnsure },
  setup: { check: setupCheck, apply: setupApply },
};

export async function dispatch(argv) {
  const args = parseArgs(argv);
  const [group, action] = args._;
  const entry = COMMANDS[group];
  if (!entry) {
    throw new FactoryError('config', `Comando desconhecido: "${group ?? ''}".`, 'Use: doctor, whoami, wi, pr, branch ou setup.');
  }
  if (entry._) {
    const cfg = entry.noConfig ? null : resolveConfig();
    return entry._(cfg, args);
  }
  const handler = entry[action];
  if (!handler) {
    throw new FactoryError('config', `Ação desconhecida para "${group}": "${action ?? ''}".`, `Use: ${Object.keys(entry).join(', ')}.`);
  }
  return handler(resolveConfig(), args);
}

if (isEntryPoint(import.meta.url)) run(() => dispatch(process.argv.slice(2)));

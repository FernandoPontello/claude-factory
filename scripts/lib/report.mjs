// Gera o relatório de entrega (HTML único, prints embutidos) e o resumo da PR.
// Regra: todo número vem de registro de máquina (checks.jsonl, marks.jsonl, git), nunca do
// texto escrito pelo modelo. O conteúdo textual vem de report.json, escrito pelo /deliver.

import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export const FINAL_GATES = ['build', 'test', 'e2e'];

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const list = (value) => (Array.isArray(value) ? value : []);

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m} min`;
}

function firstAt(marks, event) {
  const m = marks.find((x) => x.event === event);
  return m ? Date.parse(m.at) : null;
}

/** Durações do run, só a partir dos carimbos gravados pelos comandos. */
export function phaseDurations(marks) {
  const start = firstAt(marks, 'claimed') ?? firstAt(marks, 'resumed');
  const go = firstAt(marks, 'go');
  const reports = marks.filter((m) => /^report-v\d+$/.test(m.event)).map((m) => Date.parse(m.at));
  const firstReport = reports[0] ?? null;
  const lastReport = reports.at(-1) ?? null;
  const rows = [];
  if (start && go) rows.push({ phase: 'Kickoff', ms: go - start });
  if (go && firstReport) rows.push({ phase: 'Execução até a v1', ms: firstReport - go });
  if (reports.length > 1) rows.push({ phase: `Ajustes até a v${reports.length}`, ms: lastReport - firstReport });
  return rows;
}

/** Situação das verificações finais no ciclo atual (o último registro de cada gate). */
export function gateStatus(checks, cycle, gates) {
  return gates.map((gate) => {
    const inCycle = checks.filter((c) => c.gate === gate && c.cycle === cycle);
    const last = inCycle.at(-1) ?? null;
    return {
      gate,
      recorded: Boolean(last),
      ok: Boolean(last?.ok),
      attempts: inCycle.length,
      totalMs: inCycle.reduce((sum, c) => sum + (c.durationMs ?? 0), 0),
      counts: last?.counts ?? null,
      sha: last?.sha ?? null,
      dirty: last?.dirty ?? null,
      acResults: last?.acResults ?? null,
      services: last?.services ?? null,
    };
  });
}

/**
 * O veredito ✅ exige: cada verificação final registrada, verde, rodada no commit atual com a
 * árvore limpa; todo AC atendido (e, quando há relatório do Playwright, com o teste "AC-n"
 * passando); nenhum achado alto aberto.
 */
export function verdictOf({ content, gates, head = null }) {
  const warnings = [];
  if (!gates.length) warnings.push('sem receita de execução: nenhuma verificação final rodou');
  for (const g of gates) {
    if (!g.recorded) warnings.push(`verificação final sem registro: ${g.gate}`);
    else if (!g.ok) warnings.push(`verificação final falhou: ${g.gate}`);
    else if (head?.sha && (g.sha !== head.sha || g.dirty)) {
      warnings.push(`verificação final de ${g.gate} não rodou no commit atual com a árvore limpa`);
    }
  }
  const acResults = gates.find((g) => g.gate === 'e2e')?.acResults ?? null;
  const acs = list(content?.partA?.acs);
  if (!acs.length) warnings.push('nenhum critério de aceite no relatório');
  for (const ac of acs) {
    if (ac.status !== 'atendido') warnings.push(`${ac.id} não atendido (${ac.status ?? 'sem status'})`);
    else if (acResults && acResults[ac.id] === false) warnings.push(`${ac.id} marcado como atendido, mas o teste de aceite falhou`);
    else if (acResults && acResults[ac.id] === undefined && ac.test) warnings.push(`${ac.id} sem teste de aceite com "${ac.id}" no título`);
  }
  for (const f of list(content?.partB?.findings)) {
    if (f.severity === 'alta' && f.open) warnings.push(`achado alto aberto: ${f.finding}`);
  }
  return { ok: warnings.length === 0, warnings };
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

function embedImage(runDir, file, warnings) {
  const path = join(runDir, file);
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime || !existsSync(path)) {
    warnings.push(`print não encontrado: ${file}`);
    return null;
  }
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`;
}

function countsText(counts) {
  if (!counts) return null;
  const parts = [`${counts.passed ?? 0} de ${counts.total ?? 0}`];
  if (counts.failed) parts.push(`${counts.failed} falharam`);
  if (counts.skipped) parts.push(`${counts.skipped} pulados`);
  return parts.join(' · ');
}

const STATUS_LABEL = { atendido: 'Atendido', parcial: 'Parcial', 'nao-atendido': 'Não atendido' };
const SEVERITY_CLASS = { alta: 'bad', media: 'warn', média: 'warn', baixa: 'neutral' };

const CSS = `
:root{--bg:#F4F6F8;--surface:#FFFFFF;--ink:#141C26;--muted:#56626F;--line:#DCE1E8;--line-strong:#C3CBD6;--accent:#1B5CA3;--accent-soft:#E6EEF8;--ok:#1D7448;--ok-soft:#E1F1E8;--warn:#865500;--warn-soft:#FAEFD5;--bad:#AE232A;--bad-soft:#FAE3E4;--mono:ui-monospace,"Cascadia Mono",Consolas,monospace;--sans:"Segoe UI",system-ui,-apple-system,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0E1319;--surface:#151C24;--ink:#E4E9EF;--muted:#98A4B2;--line:#25303C;--line-strong:#34414F;--accent:#83B3EC;--accent-soft:#15263A;--ok:#6FCB9A;--ok-soft:#12281D;--warn:#E6B65C;--warn-soft:#2A2112;--bad:#F08C91;--bad-soft:#311618;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.6}
.wrap{max-width:960px;margin:0 auto;padding:24px 16px 72px;display:grid;gap:48px}
h1,h2,h3{line-height:1.2;margin:0}h1{font-size:2rem}h2{font-size:1.4rem}h3{font-size:1.15rem;font-weight:600}
p{margin:0}ul,ol{margin:0;padding-left:1.2em}code,.mono{font-family:var(--mono);font-size:.88em}
code{background:var(--accent-soft);padding:.05em .35em;border-radius:4px;overflow-wrap:anywhere}
.eyebrow{font-family:var(--mono);font-size:.76rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.head{display:grid;gap:18px}.sub{color:var(--muted);font-size:.95rem}
.verdict{display:flex;flex-wrap:wrap;gap:10px 20px;align-items:center;padding:16px 18px;border-radius:10px;border:1px solid var(--line)}
.verdict.ok{background:var(--ok-soft)}.verdict.warn{background:var(--warn-soft)}
.verdict strong{font-size:1.25rem}.verdict.ok strong{color:var(--ok)}.verdict.warn strong{color:var(--warn)}
.warnings{margin-top:4px;color:var(--warn);font-size:.92rem}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden;margin:0}
.meta div{background:var(--surface);padding:12px 14px;min-width:0}.meta dt{font-family:var(--mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.meta dd{margin:2px 0 0;overflow-wrap:anywhere}
.part{display:grid;gap:36px}.band{padding:14px 18px;border-radius:10px;border:1px solid var(--line);background:var(--surface);display:grid;gap:4px}.band .eyebrow{color:var(--accent)}
.part-b .band{background:transparent;border-style:dashed;border-color:var(--line-strong)}
.sec{display:grid;gap:14px;min-width:0}.sec-head{display:flex;gap:12px;align-items:baseline}.sec-id{font-family:var(--mono);color:var(--accent);font-size:.85rem}
.pill{display:inline-block;font-size:.76rem;font-weight:600;padding:2px 9px;border-radius:999px;white-space:nowrap}
.pill.ok{background:var(--ok-soft);color:var(--ok)}.pill.warn{background:var(--warn-soft);color:var(--warn)}.pill.bad{background:var(--bad-soft);color:var(--bad)}.pill.neutral{background:var(--accent-soft);color:var(--accent)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;display:grid;gap:10px;min-width:0}
.ac-head{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.ac-head .pill{margin-left:auto}.ac-id{font-family:var(--mono);font-weight:600}
.gwt{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0}.gwt dt{font-family:var(--mono);font-size:.76rem;text-transform:uppercase;color:var(--muted);padding-top:.2em}.gwt dd{margin:0}
.evid{font-size:.86rem;color:var(--muted)}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}
figure{margin:0;display:grid;gap:6px}figure img{width:100%;border:1px solid var(--line-strong);border-radius:8px;background:#fff}figcaption{font-size:.84rem;color:var(--muted)}
.missing{border:1px dashed var(--warn);border-radius:8px;padding:24px;color:var(--warn);font-size:.86rem;text-align:center}
.callout{border:1px solid var(--warn);background:var(--warn-soft);border-radius:12px;padding:16px 18px;display:grid;gap:10px}
.decision{display:grid;gap:4px;padding:12px 14px;border-radius:9px;background:var(--surface);border:1px solid var(--line)}.decision.auto{border-color:var(--warn)}
.decision .why{color:var(--muted);font-size:.9rem}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.stack{display:grid;gap:10px;align-content:start}
.tbl{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:.9rem;min-width:560px}th,td{text-align:left;vertical-align:top;padding:9px 12px;border-top:1px solid var(--line)}
thead th{border-top:0;font-family:var(--mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:500;background:var(--bg)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.tile{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:grid;gap:2px}
.tile span{font-size:.8rem;color:var(--muted)}.tile b{font-size:1.3rem;font-variant-numeric:tabular-nums}.tile.ok b{color:var(--ok)}.tile.bad b{color:var(--bad)}
.steps{padding-left:1.4em;display:grid;gap:8px}
footer{color:var(--muted);font-size:.84rem;border-top:1px solid var(--line);padding-top:14px}
`;

function section(id, title, body, lede = '') {
  return `<section class="sec" id="${esc(id.toLowerCase())}"><div class="sec-head"><span class="sec-id">${esc(id)}</span><h3>${esc(title)}</h3></div>${lede ? `<p class="sub">${esc(lede)}</p>` : ''}${body}</section>`;
}

function bullets(items, empty = 'Nada a registrar.') {
  const arr = list(items);
  return arr.length ? `<ul>${arr.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<p class="sub">${esc(empty)}</p>`;
}

function acCard(ac, runDir, warnings) {
  const status = ac.status ?? 'sem status';
  const cls = status === 'atendido' ? 'ok' : status === 'parcial' ? 'warn' : 'bad';
  const shots = list(ac.evidence)
    .map((e, i, arr) => {
      const src = embedImage(runDir, e.file, warnings);
      const cap = `<figcaption><b class="mono">${i + 1}/${arr.length}</b> ${esc(e.caption ?? '')}</figcaption>`;
      return src
        ? `<figure><img src="${src}" alt="${esc(e.caption ?? ac.id)}">${cap}</figure>`
        : `<figure><div class="missing">print não encontrado: ${esc(e.file)}</div>${cap}</figure>`;
    })
    .join('');
  return `<article class="card"><div class="ac-head"><span class="ac-id">${esc(ac.id)}</span>${ac.us ? `<span class="pill neutral">${esc(ac.us)}</span>` : ''}<span>${esc(ac.name ?? '')}</span><span class="pill ${cls}">${esc(STATUS_LABEL[status] ?? status)}</span></div>
<dl class="gwt"><dt>Dado</dt><dd>${esc(ac.given)}</dd><dt>Quando</dt><dd>${esc(ac.when)}</dd><dt>Então</dt><dd>${esc(ac.then)}</dd></dl>
<p class="evid">${ac.test ? `Teste <code>${esc(ac.test)}</code>` : 'Sem teste automático'}${ac.note ? ` · ${esc(ac.note)}` : ''}</p>${shots ? `<div class="shots">${shots}</div>` : ''}</article>`;
}

function decisionCard(d, auto) {
  const title = d.question ?? d.title ?? '';
  const body = d.answer ?? d.decision ?? '';
  const why = [d.why, d.discarded ? `Descartado: ${d.discarded}` : ''].filter(Boolean).join(' ');
  return `<div class="decision${auto ? ' auto' : ''}"><div><span class="sec-id">${esc(d.id ?? '')}</span> <b>${esc(title)}</b></div><p>${esc(body)}</p>${why ? `<p class="why">${esc(why)}</p>` : ''}</div>`;
}

function table(headers, rows) {
  if (!rows.length) return '<p class="sub">Nada a registrar.</p>';
  return `<div class="tbl"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

const GATE_LABEL = { build: 'Build', test: 'Suíte de testes', e2e: 'Testes de aceite', lint: 'Lint', install: 'Instalação' };

export function buildReport({ state, content, checks, marks, commits, diffstat, runDir, version, generatedAt, head = null }) {
  const warnings = [];
  const gates = gateStatus(checks, state.cycle ?? 1, FINAL_GATES.filter((g) => (state.gates ?? FINAL_GATES).includes(g)));
  const verdict = verdictOf({ content, gates, head });
  const a = content?.partA ?? {};
  const b = content?.partB ?? {};
  const wi = content?.workItem ?? { id: state.id, title: state.title };
  const acs = list(a.acs);
  const acOk = acs.filter((x) => x.status === 'atendido').length;

  const tiles = gates
    .map((g) => {
      const value = !g.recorded ? 'sem registro' : g.ok ? countsText(g.counts) ?? 'passou' : countsText(g.counts) ?? 'falhou';
      const cls = !g.recorded || !g.ok ? 'bad' : 'ok';
      return `<div class="tile ${cls}"><span>${esc(GATE_LABEL[g.gate] ?? g.gate)}</span><b>${esc(value)}</b><span>${g.attempts} execução(ões) neste ciclo</span></div>`;
    })
    .join('');

  const e2eServices = gates.find((g) => g.gate === 'e2e')?.services ?? [];
  const againstText = e2eServices.map((svc) => `${svc.repo} (${svc.ref} @ ${String(svc.sha ?? '').slice(0, 7)})`).join(', ');
  const against = againstText ? `<p class="sub">Testes de aceite rodados contra ${esc(againstText)}.</p>` : '';

  const durations = phaseDurations(marks);
  const gateRows = gates.filter((g) => g.recorded).map((g) => [esc(GATE_LABEL[g.gate] ?? g.gate), esc(formatDuration(g.totalMs)), esc(String(g.attempts))]);

  const prs = list(state.prs).map((p) => `${p.target}${p.backMerge ? ' (back-merge)' : ''}`).join(', ');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório de entrega #${esc(wi.id)} v${version}</title><style>${CSS}</style></head><body><div class="wrap">
<header class="head"><div class="eyebrow">Relatório de entrega · v${version} · ${esc(wi.type ?? '')} #${esc(wi.id)}</div><h1>${esc(wi.title ?? state.title ?? '')}</h1>
<div class="verdict ${verdict.ok ? 'ok' : 'warn'}"><strong>${verdict.ok ? '✅ Pronto para PR' : '⚠️ Com ressalvas'}</strong><span><b>${acOk} de ${acs.length}</b> critérios atendidos</span>${verdict.warnings.length ? `<div class="warnings">${verdict.warnings.map(esc).join(' · ')}</div>` : ''}</div>
<dl class="meta"><div><dt>Trilha</dt><dd><span class="mono">${esc(state.branch)}</span><br>de ${esc(state.base)} · PR para ${esc(prs)}</dd></div><div><dt>Gerado em</dt><dd>${esc(new Date(generatedAt).toLocaleString('pt-BR'))}</dd></div><div><dt>Mudanças</dt><dd>${esc(diffstat || '—')}<br>${commits.length} commit(s) na branch</dd></div></dl>
${content?.versionNote ? `<p class="sub"><b>Mudanças desde a versão anterior:</b> ${esc(content.versionNote)}</p>` : ''}</header>
<div class="part"><div class="band"><span class="eyebrow">Parte A</span><h2>Para o PO</h2><p class="sub">Linguagem de negócio. É a base da validação na QA.</p></div>
${section('A1', 'O que muda para o usuário', bullets(a.changes))}
${section('A2', 'Critérios de aceite', `<div class="stack">${acs.map((ac) => acCard(ac, runDir, warnings)).join('')}</div>`)}
${section('A3', 'Roteiro de validação na QA', `${list(a.validation?.steps).length ? `<ol class="steps">${list(a.validation.steps).map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '<p class="sub">Sem roteiro.</p>'}${a.validation?.note ? `<p class="sub">${esc(a.validation.note)}</p>` : ''}`)}
${section('A4', 'Decisões de produto que o Claude assumiu', list(a.productDecisions).length ? `<div class="callout"><b>O PRD não cobria estes pontos. Se algum estiver errado, abra um item novo linkado a este.</b>${list(a.productDecisions).map((d) => decisionCard(d, true)).join('')}</div>` : '<p class="sub">Nenhuma: o PRD cobria tudo.</p>')}
${section('A5', 'Limitações e fora do escopo', bullets(a.limitations, 'Nenhuma.'))}
</div>
<div class="part part-b"><div class="band"><span class="eyebrow">Parte B</span><h2>Para o dev</h2><p class="sub">O que foi construído, por que, e onde olhar com mais atenção.</p></div>
${section('B1', 'Abordagem e porquês', `<div class="cols"><div class="stack"><div class="eyebrow">Decididas no kickoff</div>${list(b.kickoffDecisions).map((d) => decisionCard(d, false)).join('') || '<p class="sub">Nenhuma pergunta no kickoff.</p>'}</div><div class="stack"><div class="eyebrow">Tomadas sozinho — revisar</div>${list(b.autonomousDecisions).map((d) => decisionCard(d, true)).join('') || '<p class="sub">Nenhuma.</p>'}</div></div>`)}
${section('B2', 'Mudanças', `${table(['Área', 'O que mudou'], list(b.changes).map((c) => [esc(c.area), esc(c.what)]))}${commits.length ? `<div class="tbl"><table><thead><tr><th>Commit</th><th>Mensagem</th></tr></thead><tbody>${commits.map((c) => `<tr><td class="mono">${esc(c.hash)}</td><td>${esc(c.subject)}</td></tr>`).join('')}</tbody></table></div>` : ''}`)}
${section('B3', 'Qualidade', `<div class="tiles">${tiles}</div>${against}${list(b.testsChanged).length ? `<div class="callout"><b>Testes existentes alterados ou removidos</b>${bullets(list(b.testsChanged).map((t) => `${t.test}: ${t.why}`))}</div>` : '<p class="sub">Nenhum teste existente foi removido, pulado ou enfraquecido.</p>'}${table(['Lente', 'Achado', 'Severidade', 'Destino'], list(b.findings).map((f) => [esc(f.lens), esc(f.finding), `<span class="pill ${SEVERITY_CLASS[f.severity] ?? 'neutral'}">${esc(f.severity)}</span>`, esc(f.destination)]))}`, 'Números lidos do log do executor das verificações.')}
${section('B4', 'Riscos e pendências sugeridas', `${bullets(b.risks, 'Nenhum risco novo.')}${list(b.pendencies).length ? table(['Tipo', 'Pendência', 'Vira'], list(b.pendencies).map((p) => [esc(p.kind), esc(p.title), esc(p.target)])) : ''}`)}
${section('B5', 'Docs vivos', `${table(['Arquivo', 'Situação'], list(b.docs).map((d) => [`<code>${esc(d.file)}</code>`, esc(d.what)]))}${b.markerTo ? `<p class="sub">Marcador <code>revisado-até</code>: ${esc(b.markerFrom ?? '—')} → ${esc(b.markerTo)}</p>` : ''}`)}
${section('B6', 'Métricas do run', `${table(['Fase', 'Duração'], durations.map((d) => [esc(d.phase), esc(formatDuration(d.ms))]))}${table(['Verificação', 'Tempo total', 'Execuções'], gateRows)}`, 'Durações calculadas a partir dos carimbos dos comandos, nunca estimadas.')}
</div>
<footer>Gerado por <code>run.mjs report</code> a partir de <code>.factory/runs/${esc(state.id)}</code>.</footer>
</div></body></html>`;

  const prSummary = buildPrSummary({ wi, version, verdict, acs, b, services: againstText });
  return { html, prSummary, verdict, warnings: [...verdict.warnings, ...warnings] };
}

export function buildPrSummary({ wi, version, verdict, acs, b, services = '' }) {
  const lines = [];
  // Sem "#id" solto: na descrição da PR o Azure DevOps lê "<Estado> #id" como transição.
  lines.push(`**Relatório de entrega v${version}: ${verdict.ok ? '✅ pronto' : '⚠️ com ressalvas'}.** O relatório completo está anexado ao work item ${wi.id}.`);
  if (verdict.warnings.length) lines.push('', `Ressalvas: ${verdict.warnings.join('; ')}.`);
  if (services) lines.push('', `Testes de aceite rodados contra ${services}.`);
  lines.push('', '| AC | Status | Teste |', '| --- | --- | --- |');
  for (const ac of acs.slice(0, 15)) lines.push(`| ${ac.id} ${ac.name ?? ''} | ${STATUS_LABEL[ac.status] ?? ac.status} | ${ac.test ?? '—'} |`);
  if (acs.length > 15) lines.push(`| … | mais ${acs.length - 15} | |`);
  const decisions = [...list(b.kickoffDecisions).map((d) => `- ${d.id}: ${d.question ?? d.title} → ${d.answer ?? d.decision}`), ...list(b.autonomousDecisions).map((d) => `- ${d.id} (tomada sozinho): ${d.title} → ${d.decision}`)];
  if (decisions.length) lines.push('', '**Decisões técnicas**', ...decisions.slice(0, 10));
  let text = lines.join('\n');
  if (text.length > 3000) text = `${text.slice(0, 2990)}…`;
  return text;
}

/** Conta testes num relatório JUnit XML (soma das testsuites de nível mais alto). */
export function parseJUnit(xml) {
  const suites = [...String(xml).matchAll(/<testsuite\b([^>]*)>/g)].map((m) => m[1]);
  if (!suites.length) return null;
  const attr = (s, name) => Number((s.match(new RegExp(`\\b${name}="(\\d+)"`)) ?? [])[1] ?? 0);
  let total = 0;
  let failed = 0;
  let skipped = 0;
  for (const s of suites) {
    total += attr(s, 'tests');
    failed += attr(s, 'failures') + attr(s, 'errors');
    skipped += attr(s, 'skipped');
  }
  return { total, failed, skipped, passed: total - failed - skipped };
}

/**
 * Resultado por critério de aceite no relatório JSON do Playwright: cada spec cujo título (ou o
 * de uma suíte acima dele) cita "AC-n" conta para aquele AC. Um AC passa só se todos os seus
 * specs passaram.
 */
export function parsePlaywrightAcs(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const results = {};
  const specOk = (spec) =>
    spec.ok ?? list(spec.tests).every((t) => ['expected', 'flaky'].includes(t.status) || list(t.results).every((r) => r.status === 'passed'));
  const walk = (suite, inherited) => {
    const titles = `${inherited} ${suite.title ?? ''}`;
    for (const spec of list(suite.specs)) {
      const ids = new Set(`${titles} ${spec.title ?? ''}`.match(/AC-\d+/g) ?? []);
      for (const id of ids) results[id] = (results[id] ?? true) && Boolean(specOk(spec));
    }
    for (const child of list(suite.suites)) walk(child, titles);
  };
  for (const suite of list(data?.suites)) walk(suite, '');
  return results;
}

/** Conta testes num relatório JSON do Playwright (reporter "json"). */
export function parsePlaywrightJson(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const s = data?.stats;
  if (!s) return null;
  const passed = (s.expected ?? 0) + (s.flaky ?? 0);
  const failed = s.unexpected ?? 0;
  const skipped = s.skipped ?? 0;
  return { total: passed + failed + skipped, passed, failed, skipped, flaky: s.flaky ?? 0 };
}

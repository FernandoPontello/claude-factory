// Estado local de cada run do /deliver em .factory/runs/<id>/ (fora do git).
// marks.jsonl: carimbos de hora gravados pelos comandos obrigatórios do fluxo.
// checks.jsonl: cada execução de verificação (build, testes, aceite), com resultado e duração.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function runDir(cfg, id) {
  return join(cfg.runsDir, String(id));
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function appendMark(cfg, id, event, extra = {}) {
  const dir = ensureDir(runDir(cfg, id));
  const mark = { event, at: new Date().toISOString(), ...extra };
  appendFileSync(join(dir, 'marks.jsonl'), JSON.stringify(mark) + '\n');
  return mark;
}

export function readMarks(cfg, id) {
  return readJsonl(join(runDir(cfg, id), 'marks.jsonl'));
}

export function appendCheck(cfg, id, check) {
  const dir = ensureDir(runDir(cfg, id));
  appendFileSync(join(dir, 'checks.jsonl'), JSON.stringify(check) + '\n');
  return check;
}

export function readChecks(cfg, id) {
  return readJsonl(join(runDir(cfg, id), 'checks.jsonl'));
}

export function readState(cfg, id) {
  const file = join(runDir(cfg, id), 'state.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeState(cfg, id, state) {
  const dir = ensureDir(runDir(cfg, id));
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  return state;
}

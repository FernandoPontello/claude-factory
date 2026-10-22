import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeRepo } from './helpers.mjs';
import { dispatch } from '../run.mjs';

let repo;
let cwd;

before(() => {
  repo = makeRepo();
  cwd = process.cwd();
  process.chdir(repo.dir);
});

after(() => {
  process.chdir(cwd);
  repo.cleanup();
});

test('ensure-settings declara o plugin, preserva o que existe e tira a factory antiga', async () => {
  const file = join(repo.dir, '.claude', 'settings.json');
  mkdirSync(join(repo.dir, '.claude'), { recursive: true });
  writeFileSync(file, '﻿' + JSON.stringify({
    permissions: { allow: ['Bash(npm test)'] },
    extraKnownMarketplaces: { 'claude-factory-marketplace': { source: { source: 'github', repo: 'x/y' } }, outro: { source: { source: 'github', repo: 'a/b' } } },
    enabledPlugins: { 'claude-factory@claude-factory-marketplace': true, 'outro@outro': true },
  }));

  const first = await dispatch(['ensure-settings']);
  assert.equal(first.changed, true);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(data.permissions, { allow: ['Bash(npm test)'] });
  assert.ok(data.extraKnownMarketplaces.outro);
  assert.equal(data.extraKnownMarketplaces['claude-factory-marketplace'], undefined);
  const factory = data.extraKnownMarketplaces['factory-marketplace'];
  assert.equal(factory.autoUpdate, true);
  assert.match(factory.source.url, /^https:\/\//);
  assert.equal(data.enabledPlugins['factory@factory-marketplace'], true);
  assert.equal(data.enabledPlugins['outro@outro'], true);
  assert.equal(data.enabledPlugins['claude-factory@claude-factory-marketplace'], undefined);

  const second = await dispatch(['ensure-settings']);
  assert.equal(second.changed, false, 'rodar de novo não muda nada');
});

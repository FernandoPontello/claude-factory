import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('../hooks/prd-readonly.mjs', import.meta.url));
const runHook = (input) => spawnSync(process.execPath, [hook], { input, encoding: 'utf8' });

test('prd-readonly bloqueia escrita no repo e libera .factory/', () => {
  const repoWrite = runHook(JSON.stringify({ tool_input: { file_path: 'C:\\proj\\src\\a.ts' } }));
  assert.equal(repoWrite.status, 2);
  assert.match(repoWrite.stderr, /não escreve no repo/);

  const draft = runHook(JSON.stringify({ tool_input: { file_path: 'C:\\proj\\.factory\\prd\\x.md' } }));
  assert.equal(draft.status, 0);

  const posix = runHook(JSON.stringify({ tool_input: { file_path: '/home/po/proj/.factory/prd/x.md' } }));
  assert.equal(posix.status, 0);

  const escape = runHook(JSON.stringify({ tool_input: { file_path: 'C:\\proj\\.factory\\..\\src\\x.ts' } }));
  assert.equal(escape.status, 2);
});

test('prd-readonly entende entrada com BOM, como a do PowerShell', () => {
  const withBom = runHook('\uFEFF' + JSON.stringify({ tool_input: { file_path: 'docs/system/product.md' } }) + '\r\n');
  assert.equal(withBom.status, 2);
});

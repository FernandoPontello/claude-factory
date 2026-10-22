#!/usr/bin/env node
// Hook PreToolUse do /prd: na sessão do PO, nada é escrito no repo.
// Permite só rascunhos dentro de .factory/ (fora do git). Código de saída 2 bloqueia a
// ferramenta e devolve a mensagem ao Claude.

import { posix } from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  let data = {};
  try {
    // Shells do Windows podem prefixar a entrada com BOM.
    data = JSON.parse(input.replace(/^﻿/, '').trim() || '{}');
  } catch {
    process.exit(0);
  }
  const toolInput = data.tool_input ?? {};
  // normalize resolve "..": ".factory/../src/x.ts" é src/x.ts e não pode passar.
  const path = posix.normalize(String(toolInput.file_path ?? toolInput.notebook_path ?? '').replace(/\\/g, '/'));
  if (/(^|\/)\.factory\//.test(path)) process.exit(0);
  process.stderr.write(
    'Na sessão do /prd o PO não escreve no repo. Rascunhos ficam em .factory/prd/; o PRD vai para o board pelo script ado.\n',
  );
  process.exit(2);
});

// Saída e erros padronizados dos scripts da factory.
// Todo comando imprime UM objeto JSON no stdout e sai com um código que diz o que fazer.

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Este módulo é o que o `node` mandou rodar? Compara os caminhos reais, porque o Node resolve o
 * script por realpath: symlink, junction e nome curto 8.3 do Windows não podem quebrar isso.
 */
export function isEntryPoint(metaUrl) {
  if (!process.argv[1]) return false;
  const real = (p) => {
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  };
  const self = real(fileURLToPath(metaUrl));
  const invoked = real(resolve(process.argv[1]));
  return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
}

export const EXIT = {
  ok: 0,
  error: 1,
  auth: 2,
  not_found: 3,
  conflict: 4,
  config: 5,
  limit: 6,
};

export class FactoryError extends Error {
  /**
   * @param {keyof EXIT} code  categoria do erro (vira o código de saída)
   * @param {string} message   o que deu errado, em português
   * @param {string} [fix]     o único passo para consertar
   * @param {object} [data]    dados extras para quem chamou
   */
  constructor(code, message, fix, data) {
    super(message);
    this.code = code;
    this.fix = fix;
    this.data = data;
  }
}

/** Lê `--chave valor`, `--chave=valor` e `--flag` (booleano). Posicionais vão em `_`. */
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      args[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args[body] = next;
      i++;
    } else {
      args[body] = true;
    }
  }
  return args;
}

export function required(args, name) {
  const value = args[name];
  if (value === undefined || value === true || value === '') {
    throw new FactoryError('config', `Falta o argumento --${name}.`, `Passe --${name} <valor>.`);
  }
  return value;
}

export function toId(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new FactoryError('config', `--${name} precisa ser o número do work item (recebi "${value}").`);
  }
  return n;
}

export function print(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

/** Roda o handler e converte o resultado (ou o erro) no contrato de saída. */
export async function run(handler) {
  try {
    const result = await handler();
    print({ ok: true, ...(result ?? {}) });
    process.exitCode = EXIT.ok;
  } catch (err) {
    if (err instanceof FactoryError) {
      print({ ok: false, code: err.code, error: err.message, fix: err.fix, ...(err.data ?? {}) });
      process.exitCode = EXIT[err.code] ?? EXIT.error;
    } else {
      print({ ok: false, code: 'error', error: String(err?.message ?? err), stack: err?.stack });
      process.exitCode = EXIT.error;
    }
  }
}

// Cliente HTTP do Azure DevOps: token do `az login`, novas tentativas e erros com significado.

import { execSync } from 'node:child_process';
import { FactoryError } from './cli.mjs';

// ID de recurso do Azure DevOps no Entra ID (constante da Microsoft).
const ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';

let cachedToken = null;
export const lastResponse = { serverDate: null };

export function resetTokenCache() {
  cachedToken = null;
}

/** Token bearer: ADO_TOKEN no ambiente (testes, CI) ou o `az login` da pessoa. */
export function getToken() {
  if (process.env.ADO_TOKEN) return process.env.ADO_TOKEN;
  if (cachedToken) return cachedToken;
  let token = '';
  try {
    token = execSync(
      `az account get-access-token --resource ${ADO_RESOURCE} --query accessToken -o tsv`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    ).trim();
  } catch (err) {
    const detail = String(err.stderr ?? err.message ?? '').split('\n').find((l) => l.trim()) ?? '';
    const missing = /not recognized|not found|ENOENT/i.test(detail);
    throw new FactoryError(
      'auth',
      missing ? 'O Azure CLI (az) não está instalado nesta máquina.' : `Não consegui obter um token do Azure CLI. ${detail}`.trim(),
      missing ? 'Instale o Azure CLI e rode `az login` no tenant da organização.' : 'Rode `az login` no tenant da organização e tente de novo.',
    );
  }
  if (!token) {
    throw new FactoryError('auth', 'O Azure CLI devolveu um token vazio.', 'Rode `az login` no tenant da organização e tente de novo.');
  }
  cachedToken = token;
  return token;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function describeBody(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 500);
  return String(body.message ?? body.Message ?? JSON.stringify(body)).slice(0, 500);
}

/**
 * Chamada à API REST. `path` é relativo à organização (ex.: `Projeto/_apis/wit/workitems/1`).
 * @param {object} cfg  configuração com orgUrl
 * @param {string} method
 * @param {string} path
 * POST só é repetido quando `safe` (leituras como WIQL) ou quando o servidor pede (429, 503 com
 * Retry-After): repetir uma criação que o servidor já processou criaria em dobro.
 * @param {{query?: object, body?: any, contentType?: string, api?: string, attempts?: number, safe?: boolean}} opts
 */
export async function request(cfg, method, path, opts = {}) {
  const { query = {}, body, contentType = 'application/json', api = '7.1', attempts = 4, safe = false } = opts;
  const retriable = method !== 'POST' || safe;
  const url = new URL(path.startsWith('http') ? path : `${cfg.orgUrl}/${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  if (api) url.searchParams.set('api-version', api);

  const headers = { Authorization: `Bearer ${getToken()}`, Accept: 'application/json' };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = contentType;
    payload = Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res;
    try {
      res = await globalThis.fetch(url, { method, headers, body: payload });
    } catch (err) {
      lastError = err;
      if (retriable && attempt < attempts) {
        await sleep(backoff(attempt));
        continue;
      }
      throw new FactoryError(
        'error',
        `Falha de rede ao falar com o Azure DevOps: ${err.message}`,
        retriable
          ? 'Confira a conexão e rode o comando de novo; ele não duplica nada.'
          : 'Confira no board se a operação aconteceu antes de repetir; o comando procura antes de criar.',
      );
    }

    const dateHeader = res.headers?.get?.('date');
    if (dateHeader) lastResponse.serverDate = dateHeader;

    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      const serverAsked = res.status === 429 || (res.status === 503 && Number.isFinite(retryAfter) && retryAfter > 0);
      if (attempt < attempts && (retriable || serverAsked)) {
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
        continue;
      }
    }

    const text = await res.text();
    let data = text;
    if (text && (res.headers?.get?.('content-type') ?? '').includes('json')) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (res.ok) return data;

    const detail = describeBody(data);
    if (res.status === 401 || res.status === 403) {
      throw new FactoryError('auth', `O Azure DevOps recusou o acesso (${res.status}). ${detail}`.trim(), 'Rode `az login` com uma conta que tenha acesso ao projeto, no tenant da organização.');
    }
    if (res.status === 404) {
      throw new FactoryError('not_found', `Não encontrado no Azure DevOps: ${method} ${url.pathname}. ${detail}`.trim());
    }
    if (res.status === 409 || res.status === 412) {
      throw new FactoryError('conflict', `Conflito no Azure DevOps (${res.status}): alguém mudou o item entre a leitura e a escrita. ${detail}`.trim(), 'Leia o item de novo e decida antes de repetir.');
    }
    throw new FactoryError('error', `O Azure DevOps respondeu ${res.status} para ${method} ${url.pathname}. ${detail}`.trim(), undefined, { status: res.status });
  }
  throw lastError;
}

function backoff(attempt) {
  return Math.min(8000, 500 * 2 ** (attempt - 1));
}

/** Diferença em segundos entre o relógio local e o do servidor, quando já houve resposta. */
export function clockSkewSeconds() {
  if (!lastResponse.serverDate) return null;
  const server = Date.parse(lastResponse.serverDate);
  if (!Number.isFinite(server)) return null;
  return Math.round((Date.now() - server) / 1000);
}

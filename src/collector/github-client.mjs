/**
 * Hardened GitHub transport (S4, threat boundary B1/B4): fixed-origin allowlist, no redirects,
 * 15 s timeout, rate-limit handling, serialized REST search pacing and a strict no-leak error rule.
 * Thrown errors only ever carry an HTTP status and a typed reason code: never response bodies,
 * header values, GraphQL error messages/paths or `cause` chains.
 */
import { AuthError } from './auth.mjs';
import { redactSecrets } from './privacy-gate.mjs';

const API_ORIGIN = 'https://api.github.com';
const BACKOFF_MS = Object.freeze([2000, 4000, 8000]);
const MAX_WAIT_MS = 60_000;
const TRANSIENT_STATUSES = new Set([403, 429, 502, 503]);
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ApiError extends Error {
  constructor(code, { status = null, token } = {}) {
    super(redactSecrets(`GitHub API request failed (${code}${status ? `, HTTP ${status}` : ''})`, token));
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.exitCode = 4;
  }
}

function assertAllowedUrl(href) {
  const url = new URL(href);
  const okPath = url.pathname === '/graphql' || url.pathname === '/search/commits' || /^\/users\/[A-Za-z0-9%_-]+$/.test(url.pathname);
  if (url.origin !== API_ORIGIN || url.username || url.password || url.hash || !okPath || /%2[ef]/i.test(url.pathname)) {
    throw new ApiError('API_ERROR');
  }
}

function discardBody(res) {
  try {
    res.body?.cancel?.()?.catch?.(() => {});
  } catch {
    // Body streams are optional (mocks); never read them.
  }
}

function isAuthGraphQlError(e) {
  return e?.type === 'UNAUTHORIZED' || e?.extensions?.code === 'UNAUTHENTICATED';
}

export function createGitHubClient({ token, fetchFn = globalThis.fetch, sleepFn = defaultSleep, nowFn = Date.now, minRestIntervalMs = 2100 } = {}) {
  if (typeof token !== 'string' || token.trim() === '') throw new AuthError('GitHub token is required');
  if (/[\u0000-\u001F\u007F\s]/.test(token)) throw new AuthError('GitHub token contains invalid characters');

  const baseHeaders = {
    'User-Agent': 'lynceus/1.0',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`
  };

  let restTail = Promise.resolve();
  let lastRestAt = -Infinity;
  function restSlot() {
    const slot = restTail.then(async () => {
      const wait = lastRestAt + minRestIntervalMs - nowFn();
      if (wait > 0) await sleepFn(wait);
      lastRestAt = nowFn();
    });
    restTail = slot.catch(() => {});
    return slot;
  }

  /** Returns the wait (ms) before the next retry, or throws a typed error. */
  function nextWait(res, retries) {
    const status = res.status;
    if (status === 401) throw new AuthError('GitHub rejected the token (HTTP 401)');
    if (!TRANSIENT_STATUSES.has(status)) throw new ApiError(status === 404 ? 'API_NOT_FOUND' : 'API_ERROR', { status, token });
    if (status === 403 && res.headers.has('x-github-sso')) throw new ApiError('AUTH_FORBIDDEN', { status, token });

    const retryAfter = res.headers.get('retry-after');
    const reset = res.headers.get('x-ratelimit-reset');
    let wait = null;
    if (typeof retryAfter === 'string' && /^\d+$/.test(retryAfter.trim())) {
      wait = Number.parseInt(retryAfter, 10) * 1000;
    } else if (res.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(Number(reset)) && reset !== null && reset !== '') {
      wait = Number(reset) * 1000 - nowFn();
    }
    if (wait !== null) {
      if (wait > MAX_WAIT_MS || retries >= BACKOFF_MS.length) throw new ApiError('API_RATE_LIMIT', { status, token });
      return Math.max(wait, 0);
    }
    if (retries >= BACKOFF_MS.length) throw new ApiError(status === 403 ? 'API_FORBIDDEN' : 'API_ERROR', { status, token });
    return BACKOFF_MS[retries];
  }

  async function send(href, { method = 'GET', body, rest = false, allow404 = false } = {}) {
    assertAllowedUrl(href);
    const headers = body === undefined ? baseHeaders : { ...baseHeaders, 'Content-Type': 'application/json' };
    for (let retries = 0; ; retries++) {
      if (rest) await restSlot();
      let res;
      try {
        res = await fetchFn(href, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(15_000) });
      } catch (err) {
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        throw new ApiError(timedOut ? 'API_TIMEOUT' : 'API_ERROR', { token });
      }
      if (res.status >= 200 && res.status < 300) return res;
      if (res.status === 404 && allow404) return res;
      discardBody(res);
      await sleepFn(nextWait(res, retries));
    }
  }

  async function readJson(res) {
    try {
      return await res.json();
    } catch {
      throw new ApiError('API_ERROR', { status: res.status, token });
    }
  }

  return Object.freeze({
    /** POST /graphql. Resolves `{ data, oauthScopes }`. */
    async graphql(query, variables) {
      const res = await send(`${API_ORIGIN}/graphql`, { method: 'POST', body: JSON.stringify({ query, variables }) });
      const json = await readJson(res);
      const errors = json?.errors;
      if (errors !== undefined && errors !== null && !(Array.isArray(errors) && errors.length === 0)) {
        if (Array.isArray(errors) && errors.some(isAuthGraphQlError)) throw new AuthError('GitHub rejected the token (GraphQL UNAUTHORIZED)');
        throw new ApiError('GRAPHQL_ERROR', { token });
      }
      if (json === null || typeof json !== 'object' || json.data === null || typeof json.data !== 'object') {
        throw new ApiError('GRAPHQL_ERROR', { token });
      }
      return { data: json.data, oauthScopes: res.headers.get('x-oauth-scopes') };
    },

    /** GET /search/commits (serialized, >= minRestIntervalMs apart). Resolves `{ body, link, oauthScopes }`. */
    async searchCommits(params) {
      const res = await send(`${API_ORIGIN}/search/commits?${new URLSearchParams(params)}`, { rest: true });
      return { body: await readJson(res), link: res.headers.get('link'), oauthScopes: res.headers.get('x-oauth-scopes') };
    },

    /** GET /users/<slug>. Resolves `{ status: 200, data }` or `{ status: 404, data: null }`. */
    async getUser(slug) {
      const res = await send(`${API_ORIGIN}/users/${encodeURIComponent(slug)}`, { allow404: true });
      if (res.status === 404) return { status: 404, data: null };
      return { status: 200, data: await readJson(res) };
    }
  });
}

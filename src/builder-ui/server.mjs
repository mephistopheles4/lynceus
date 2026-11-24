/**
 * Read-only localhost 127.0.0.1 HTTP server for the Lynceus Builder UI (S7, B2).
 * Zero disk writes; serves relative static assets + all-POST JSON /api/* routes.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { AuthError, resolveToken } from '../collector/auth.mjs';
import { collectActivity, computeStreaks, computeWindow } from '../collector/collect.mjs';
import { ValidationError, addDays, dayNumber, normalizeConfig } from '../collector/config.mjs';
import { discoverBots, validateBotSlug } from '../collector/discover.mjs';
import { ApiError } from '../collector/github-client.mjs';
import { PrivacyGateError, assertStrictCountsOnly, redactSecrets } from '../collector/privacy-gate.mjs';
import { generateScheduleSnippet } from '../cli/snippets.mjs';
import { renderMarkdownSnippet } from '../renderer/markdown.mjs';
import { renderSvgs } from '../renderer/svg.mjs';
import {
  HttpError,
  STATIC_ROUTES,
  buildHtmlCsp,
  createTokenDigest,
  enforcePreRouteGuards,
  generateCspNonce,
  generateSessionToken,
  sendJsonError,
  sendJsonOk,
  sendResponse,
  validateApiRequest
} from './security.mjs';

const BOOTSTRAP_MARKER = '<!-- LYNCEUS_BOOTSTRAP -->';

const ASSET_URLS = Object.freeze({
  '/': new URL('./public/index.html', import.meta.url),
  '/styles.css': new URL('./public/styles.css', import.meta.url),
  '/app.js': new URL('./public/app.js', import.meta.url),
  '/demo-data.js': new URL('./public/demo-data.js', import.meta.url),
  '/favicon.ico': new URL('./public/favicon.ico', import.meta.url),
  '/renderer/palettes.mjs': new URL('../renderer/palettes.mjs', import.meta.url),
  '/renderer/sanitize.mjs': new URL('../renderer/sanitize.mjs', import.meta.url),
  '/renderer/svg.mjs': new URL('../renderer/svg.mjs', import.meta.url),
  '/renderer/markdown.mjs': new URL('../renderer/markdown.mjs', import.meta.url)
});

function loadAssetsInMemory() {
  const assets = new Map();
  for (const [route, url] of Object.entries(ASSET_URLS)) {
    assets.set(route, readFileSync(url));
  }
  return assets;
}

function safeTokenResult(resolveTokenFn, env) {
  try {
    const res = resolveTokenFn({ env });
    if (res && typeof res.token === 'string' && res.token.length > 0) {
      return { token: res.token, sourceLabel: res.sourceLabel === 'gh' ? 'gh' : 'env' };
    }
    return null;
  } catch (err) {
    if (err instanceof AuthError) return null;
    return null;
  }
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildSyntheticCounts(cfg) {
  const win = computeWindow(cfg.windowWeeks);
  const generatedAt = `${win.endDate}T00:00:00Z`;
  const scope = { mode: cfg.includePrivate ? 'public+private' : 'public' };
  const totalDays = dayNumber(win.endDate) - dayNumber(win.startDate) + 1;
  const enabledMetrics = Object.entries(cfg.metrics).filter(([, on]) => on).map(([k]) => k);

  if (cfg.agents.length === 0) {
    return {
      schemaVersion: 1,
      generatedAt,
      window: { weeks: cfg.windowWeeks, startDate: win.startDate, endDate: win.endDate },
      scope,
      agents: []
    };
  }

  const agents = cfg.agents.map((agent, idx) => {
    let seed = hashSeed(`${cfg.owner}:${cfg.scopeType}:${agent.slug}:${cfg.windowWeeks}:${enabledMetrics.join(',')}`);
    const nextRand = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const days = {};
    let total = 0;
    for (let i = 0; i < totalDays; i++) {
      const date = addDays(win.startDate, i);
      const r = nextRand();
      const activeThreshold = 0.42 + (idx % 3) * 0.08;
      const count = r < activeThreshold ? 0 : Math.floor(Math.pow(nextRand(), 1.8) * (4 + enabledMetrics.length));
      days[date] = count;
      total += count;
    }

    const totals = {
      prsOpened: 0,
      prsMerged: 0,
      commits: 0,
      reviews: 0,
      comments: 0,
      issues: 0,
      total
    };
    const weights = {
      prsOpened: 0.18,
      prsMerged: 0.14,
      commits: 0.34,
      reviews: 0.16,
      comments: 0.13,
      issues: 0.05
    };
    let allocated = 0;
    const weightSum = enabledMetrics.reduce((s, m) => s + weights[m], 0);
    for (let i = 0; i < enabledMetrics.length; i++) {
      const m = enabledMetrics[i];
      if (i === enabledMetrics.length - 1) {
        totals[m] = Math.max(0, total - allocated);
      } else {
        const share = Math.round((total * weights[m]) / weightSum);
        const clamped = Math.min(share, total - allocated);
        totals[m] = clamped;
        allocated += clamped;
      }
    }

    return {
      slug: agent.slug,
      label: agent.label,
      ramp: agent.ramp,
      source: 'github',
      totals,
      streaks: computeStreaks(days, win.startDate, win.endDate),
      days
    };
  });

  const counts = {
    schemaVersion: 1,
    generatedAt,
    window: { weeks: cfg.windowWeeks, startDate: win.startDate, endDate: win.endDate },
    scope,
    agents
  };
  return assertStrictCountsOnly(counts);
}

function scrubWarnings(warnings, activeToken) {
  if (!Array.isArray(warnings)) return [];
  return warnings.map((w) => ({
    code: typeof w?.code === 'string' ? w.code : 'WARNING',
    agent: w?.agent ?? null,
    metric: w?.metric ?? null,
    ...(typeof w?.date === 'string' ? { date: w.date } : {}),
    detail: redactSecrets(w?.detail ?? '', activeToken)
  }));
}

function optionalTrimmedString(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function mapApiError(err, activeToken) {
  if (err instanceof HttpError) {
    return { status: err.status, code: err.code, message: err.message };
  }
  if (err instanceof ValidationError) {
    return { status: 400, code: err.code ?? 'VALIDATION_ERROR', message: redactSecrets(err.message, activeToken) };
  }
  if (err instanceof PrivacyGateError) {
    return { status: 400, code: err.code ?? 'PRIVACY_GATE', message: redactSecrets(err.message, activeToken) };
  }
  if (err instanceof AuthError) {
    return { status: 401, code: err.code ?? 'AUTH_REQUIRED', message: 'GitHub authentication is required or was rejected' };
  }
  if (err instanceof ApiError) {
    if (err.code === 'AUTH_FORBIDDEN' || err.code === 'API_FORBIDDEN') {
      return { status: 403, code: err.code, message: 'GitHub API access forbidden' };
    }
    if (err.code === 'API_RATE_LIMIT') {
      return { status: 429, code: err.code, message: 'GitHub API rate limit exceeded' };
    }
    if (err.code === 'API_TIMEOUT') {
      return { status: 504, code: err.code, message: 'GitHub API request timed out' };
    }
    return { status: 502, code: err.code ?? 'API_ERROR', message: 'GitHub API request failed' };
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

function renderBootstrapHtml(templateBuffer, sessionToken, nonce) {
  const html = templateBuffer.toString('utf8');
  const payload = JSON.stringify({ token: sessionToken, mode: 'local' }).replace(/</g, '\\u003c');
  const script = `<script nonce="${nonce}">window.__LYNCEUS_BOOTSTRAP__=${payload};document.currentScript.remove();</script>`;
  return Buffer.from(html.replace(BOOTSTRAP_MARKER, script), 'utf8');
}

/**
 * Start the read-only localhost Builder UI server on `127.0.0.1`.
 * @returns {Promise<{ server: http.Server, port: number, url: string, sessionToken: string, close: () => Promise<void> }>}
 */
export async function startServer({
  port = 4173,
  config = null,
  initialConfig,
  hasConfig,
  allowIncludePrivate = false,
  includePrivateCli,
  env = process.env,
  resolveTokenFn = resolveToken,
  discoverBotsFn = discoverBots,
  validateBotSlugFn = validateBotSlug,
  collectActivityFn = collectActivity,
  generateScheduleSnippetFn = generateScheduleSnippet,
  fetchFn,
  sleepFn,
  nowFn,
  defaultToolRef,
  binPath,
  nodePath,
  realpathSyncFn,
  existsSyncFn
} = {}) {
  const effectiveAllowPrivate = allowIncludePrivate === true || includePrivateCli === true;
  const rawConfig = config !== undefined && config !== null ? config : (initialConfig ?? null);
  let normalizedInitialConfig = null;
  if (rawConfig !== null) {
    const norm = normalizeConfig(rawConfig, { allowEmptyAgents: true });
    normalizedInitialConfig = {
      ...norm,
      includePrivate: effectiveAllowPrivate ? norm.includePrivate : false
    };
  }
  const configPresent = hasConfig !== undefined ? Boolean(hasConfig) : normalizedInitialConfig !== null;

  const assets = loadAssetsInMemory();
  const sessionToken = generateSessionToken();
  const tokenDigest = createTokenDigest(sessionToken);
  let actualPort = 0;

  async function handleApiRoute(pathname, body, onToken) {
    if (pathname === '/api/status') {
      const auth = safeTokenResult(resolveTokenFn, env);
      return { authPresent: auth !== null, authSource: auth?.sourceLabel ?? null };
    }

    if (pathname === '/api/config') {
      return { hasConfig: configPresent, config: normalizedInitialConfig };
    }

    if (pathname === '/api/discover') {
      if (typeof body.includePrivate !== 'boolean') {
        throw new ValidationError('includePrivate must be a boolean');
      }
      const auth = safeTokenResult(resolveTokenFn, env);
      if (auth === null) throw new AuthError('GitHub authentication is required');
      onToken(auth.token);
      const agents = await discoverBotsFn({
        owner: body.owner,
        scopeType: body.scopeType,
        includePrivate: body.includePrivate,
        windowWeeks: body.windowWeeks ?? 52,
        token: auth.token,
        fetchFn
      });
      return { agents };
    }

    if (pathname === '/api/validate-bot') {
      if (typeof body.slug !== 'string') {
        throw new ValidationError('slug must be a string');
      }
      const auth = safeTokenResult(resolveTokenFn, env);
      if (auth === null) {
        const precheck = await validateBotSlugFn(body.slug, { fetchFn }).catch((err) => {
          if (err instanceof AuthError) throw err;
          throw err;
        });
        return precheck;
      }
      onToken(auth.token);
      return await validateBotSlugFn(body.slug, { token: auth.token, fetchFn });
    }

    if (pathname === '/api/preview') {
      if (typeof body.live !== 'boolean') {
        throw new ValidationError('live must be a boolean');
      }
      const cfg = normalizeConfig(body.config, { allowEmptyAgents: !body.live });
      if (!body.live) {
        const counts = buildSyntheticCounts(cfg);
        const svgs = renderSvgs(counts, { ...cfg, allowEmpty: true });
        const markdownSnippet = renderMarkdownSnippet({ ...cfg });
        return { counts, svgs, markdownSnippet, isSynthetic: true, warnings: [] };
      }

      const auth = safeTokenResult(resolveTokenFn, env);
      if (auth === null) throw new AuthError('GitHub authentication is required');
      onToken(auth.token);
      const { counts, warnings } = await collectActivityFn({
        config: cfg,
        includePrivate: cfg.includePrivate,
        token: auth.token,
        fetchFn,
        sleepFn,
        nowFn
      });
      const svgs = renderSvgs(counts, { ...cfg, allowEmpty: false });
      const markdownSnippet = renderMarkdownSnippet({ ...cfg });
      return {
        counts,
        svgs,
        markdownSnippet,
        isSynthetic: false,
        warnings: scrubWarnings(warnings, auth.token)
      };
    }

    if (pathname === '/api/schedule') {
      const cfg = normalizeConfig(body.config, { allowEmptyAgents: false });
      if (body.includePrivate !== undefined && typeof body.includePrivate !== 'boolean') {
        throw new ValidationError('includePrivate must be a boolean');
      }
      const includePrivate = typeof body.includePrivate === 'boolean' ? body.includePrivate : cfg.includePrivate;
      const scriptPath = optionalTrimmedString(body.scriptPath);
      const target = optionalTrimmedString(body.target);
      if (target === 'actions' && scriptPath !== undefined) {
        throw new ValidationError('--script-path is not valid with --target actions');
      }
      const toolRef = optionalTrimmedString(body.toolRef);
      const packagePin = optionalTrimmedString(body.packagePin);
      if (toolRef !== undefined && packagePin !== undefined) {
        throw new ValidationError('--tool-ref and --package-pin cannot be used together');
      }

      const result = generateScheduleSnippetFn({
        target,
        owner: optionalTrimmedString(body.owner) ?? cfg.owner,
        scopeType: body.scopeType ?? cfg.scopeType,
        branch: optionalTrimmedString(body.branch) ?? cfg.branch,
        subpath: body.subpath !== undefined ? body.subpath : cfg.subpath,
        includePrivate,
        outDir: optionalTrimmedString(body.outDir),
        repoDir: optionalTrimmedString(body.repoDir),
        scriptPath,
        toolRef,
        packagePin,
        gitName: optionalTrimmedString(body.gitName),
        gitEmail: optionalTrimmedString(body.gitEmail),
        taskName: optionalTrimmedString(body.taskName),
        env,
        defaultToolRef,
        binPath,
        nodePath,
        realpathSyncFn,
        existsSyncFn
      });
      return {
        snippet: result.snippet,
        filename: result.filename,
        scriptPath: result.scriptPath,
        instructions: result.instructions,
        privacyNotice: result.privacyNotice
      };
    }

    throw new HttpError(404, 'NOT_FOUND', 'API endpoint not found');
  }

  const server = http.createServer(async (req, res) => {
    let activeToken;
    try {
      const route = enforcePreRouteGuards(req, actualPort);
      if (route.kind === 'static') {
        const contentType = STATIC_ROUTES.get(route.pathname);
        if (route.pathname === '/') {
          const nonce = generateCspNonce();
          const body = renderBootstrapHtml(assets.get('/'), sessionToken, nonce);
          sendResponse(res, 200, body, contentType, buildHtmlCsp(nonce));
          return;
        }
        sendResponse(res, 200, assets.get(route.pathname), contentType);
        return;
      }

      const body = await validateApiRequest(req, actualPort, tokenDigest);
      const payload = await handleApiRoute(route.pathname, body, (tok) => {
        activeToken = tok;
      });
      sendJsonOk(res, payload);
    } catch (err) {
      const mapped = mapApiError(err, activeToken);
      sendJsonError(res, mapped.status, mapped.code, mapped.message);
    }
  });

  await new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });

  actualPort = server.address().port;
  const url = `http://127.0.0.1:${actualPort}`;
  const close = () =>
    new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
      server.closeAllConnections?.();
    });

  return { server, port: actualPort, url, sessionToken, close };
}

export const startBuilderServer = startServer;

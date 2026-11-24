import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { AuthError } from '../../src/collector/auth.mjs';
import { ApiError } from '../../src/collector/github-client.mjs';
import { startBuilderServer, startServer } from '../../src/builder-ui/server.mjs';
import { makeProfileAgentsConfig } from '../fixtures/github-mocks.mjs';

function rawHttpRequest({ port, method = 'GET', path = '/', headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            bodyBuffer: Buffer.concat(chunks),
            text: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function assertBaseSecurityHeaders(headers) {
  assert.equal(headers['cache-control'], 'no-store');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'no-referrer');
  assert.match(headers['content-security-policy'] ?? '', /frame-ancestors 'none'/);
  for (const key of Object.keys(headers)) {
    assert.ok(!key.toLowerCase().startsWith('access-control-'), `Unexpected CORS header: ${key}`);
  }
}

function apiHeaders(port, token, extra = {}) {
  return {
    Host: `127.0.0.1:${port}`,
    Origin: `http://127.0.0.1:${port}`,
    'Sec-Fetch-Site': 'same-origin',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

test('C9: startServer exports alias and preserves EADDRINUSE error code', async () => {
  assert.equal(startBuilderServer, startServer);
  const first = await startServer({ port: 0, resolveTokenFn: () => null });
  try {
    await assert.rejects(
      () => startServer({ port: first.port, resolveTokenFn: () => null }),
      (err) => err?.code === 'EADDRINUSE'
    );
  } finally {
    await first.close();
  }
});

test('C9: global pre-route Host guard (400) covers static GET, favicon, and POST /api/*', async () => {
  const srv = await startServer({ port: 0, resolveTokenFn: () => null });
  try {
    for (const [method, reqPath] of [
      ['GET', '/'],
      ['GET', '/styles.css'],
      ['GET', '/app.js'],
      ['GET', '/favicon.ico'],
      ['GET', '/renderer/svg.mjs'],
      ['POST', '/api/status']
    ]) {
      for (const badHost of ['localhost:' + srv.port, 'evil.example:80', '127.0.0.1:9999']) {
        const res = await rawHttpRequest({
          port: srv.port,
          method,
          path: reqPath,
          headers: {
            Host: badHost,
            Origin: `http://127.0.0.1:${srv.port}`,
            Authorization: `Bearer ${srv.sessionToken}`,
            'Content-Type': 'application/json'
          },
          body: method === 'POST' ? '{}' : undefined
        });
        assert.equal(res.status, 400, `${method} ${reqPath} with Host ${badHost} must return 400`);
        assertBaseSecurityHeaders(res.headers);
        const json = JSON.parse(res.text);
        assert.equal(json.error, 'INVALID_HOST');
      }
    }
  } finally {
    await srv.close();
  }
});

test('C9: method allowlist returns 405 with zero CORS headers and security headers', async () => {
  const srv = await startServer({ port: 0, resolveTokenFn: () => null });
  try {
    for (const [method, reqPath] of [
      ['OPTIONS', '/api/status'],
      ['OPTIONS', '/'],
      ['PUT', '/api/config'],
      ['DELETE', '/api/preview'],
      ['HEAD', '/'],
      ['GET', '/api/status'],
      ['POST', '/']
    ]) {
      const res = await rawHttpRequest({
        port: srv.port,
        method,
        path: reqPath,
        headers: { Host: `127.0.0.1:${srv.port}` }
      });
      assert.equal(res.status, 405, `${method} ${reqPath} must return 405`);
      assertBaseSecurityHeaders(res.headers);
    }
  } finally {
    await srv.close();
  }
});

test('C9: static GET allowlist, explicit MIME types, favicon.ico 200, and per-request CSP nonce', async () => {
  const srv = await startServer({ port: 0, resolveTokenFn: () => null });
  try {
    const html1 = await rawHttpRequest({
      port: srv.port,
      method: 'GET',
      path: '/',
      headers: { Host: `127.0.0.1:${srv.port}` }
    });
    const html2 = await rawHttpRequest({
      port: srv.port,
      method: 'GET',
      path: '/',
      headers: { Host: `127.0.0.1:${srv.port}` }
    });

    assert.equal(html1.status, 200);
    assert.equal(html1.headers['content-type'], 'text/html; charset=utf-8');
    assertBaseSecurityHeaders(html1.headers);

    const csp1 = html1.headers['content-security-policy'];
    const csp2 = html2.headers['content-security-policy'];
    const n1 = /'nonce-([^']+)'/.exec(csp1)?.[1];
    const n2 = /'nonce-([^']+)'/.exec(csp2)?.[1];
    assert.ok(n1 && n1.length >= 16);
    assert.notEqual(n1, n2);
    assert.match(csp1, /default-src 'self'/);
    assert.match(csp1, /style-src 'self'/);
    assert.match(csp1, /img-src 'self' data: blob:/);
    assert.match(csp1, /connect-src 'self'/);
    assert.match(csp1, /form-action 'none'/);
    assert.match(csp1, /base-uri 'none'/);
    assert.ok(!html1.text.includes('<!-- LYNCEUS_BOOTSTRAP -->'));
    assert.ok(html1.text.includes(`<script nonce="${n1}">window.__LYNCEUS_BOOTSTRAP__=`));
    assert.ok(html1.text.includes('document.currentScript.remove();'));

    const expectedRoutes = [
      ['/styles.css', 'text/css; charset=utf-8'],
      ['/app.js', 'text/javascript; charset=utf-8'],
      ['/demo-data.js', 'text/javascript; charset=utf-8'],
      ['/renderer/palettes.mjs', 'text/javascript; charset=utf-8'],
      ['/renderer/sanitize.mjs', 'text/javascript; charset=utf-8'],
      ['/renderer/svg.mjs', 'text/javascript; charset=utf-8'],
      ['/renderer/markdown.mjs', 'text/javascript; charset=utf-8'],
      ['/favicon.ico', 'image/x-icon']
    ];
    for (const [route, mime] of expectedRoutes) {
      const res = await rawHttpRequest({
        port: srv.port,
        method: 'GET',
        path: route,
        headers: { Host: `127.0.0.1:${srv.port}` }
      });
      assert.equal(res.status, 200, `${route} must return 200`);
      assert.equal(res.headers['content-type'], mime);
      assertBaseSecurityHeaders(res.headers);
      assert.ok(res.bodyBuffer.length > 0);
      if (route === '/favicon.ico') {
        assert.equal(res.bodyBuffer.readUInt16LE(0), 0);
        assert.equal(res.bodyBuffer.readUInt16LE(2), 1);
      }
    }

    const notFound = await rawHttpRequest({
      port: srv.port,
      method: 'GET',
      path: '/lynceus.json',
      headers: { Host: `127.0.0.1:${srv.port}` }
    });
    assert.equal(notFound.status, 404);
    assertBaseSecurityHeaders(notFound.headers);

    const traversal = await rawHttpRequest({
      port: srv.port,
      method: 'GET',
      path: '/%2e%2e/package.json',
      headers: { Host: `127.0.0.1:${srv.port}` }
    });
    assert.equal(traversal.status, 400);
    assertBaseSecurityHeaders(traversal.headers);
  } finally {
    await srv.close();
  }
});

test('C9: POST /api/* enforces Origin (403), Sec-Fetch-Site (403), Bearer (401), Content-Type (415), size <= 32KB (413), JSON (400)', async () => {
  const srv = await startServer({ port: 0, resolveTokenFn: () => null });
  try {
    // Origin missing / wrong -> 403
    const badOrigin = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/status',
      headers: apiHeaders(srv.port, srv.sessionToken, { Origin: 'https://evil.example' }),
      body: '{}'
    });
    assert.equal(badOrigin.status, 403);
    assertBaseSecurityHeaders(badOrigin.headers);

    // Sec-Fetch-Site cross-site -> 403
    const badFetchSite = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/status',
      headers: apiHeaders(srv.port, srv.sessionToken, { 'Sec-Fetch-Site': 'cross-site' }),
      body: '{}'
    });
    assert.equal(badFetchSite.status, 403);

    // Bearer missing / wrong -> 401
    const badBearer = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/status',
      headers: apiHeaders(srv.port, 'wrong-token-value'),
      body: '{}'
    });
    assert.equal(badBearer.status, 401);

    // Content-Type non-json -> 415
    const badCt = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/status',
      headers: apiHeaders(srv.port, srv.sessionToken, { 'Content-Type': 'text/plain' }),
      body: '{}'
    });
    assert.equal(badCt.status, 415);

    // Body > 32768 -> 413 (via Content-Length AND via chunked stream without Content-Length)
    const bigBody = JSON.stringify({ pad: 'a'.repeat(33_000) });
    const tooLarge = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/status',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: bigBody
    });
    assert.equal(tooLarge.status, 413);

    const chunkedTooLarge = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: srv.port,
        method: 'POST',
        path: '/api/status',
        headers: {
          Host: `127.0.0.1:${srv.port}`,
          Origin: `http://127.0.0.1:${srv.port}`,
          'Sec-Fetch-Site': 'same-origin',
          Authorization: `Bearer ${srv.sessionToken}`,
          'Content-Type': 'application/json',
          'Transfer-Encoding': 'chunked'
        }
      }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      req.on('error', reject);
      req.write(bigBody.slice(0, 16_000));
      req.write(bigBody.slice(16_000));
      req.end();
    });
    assert.equal(chunkedTooLarge.status, 413);

    // Invalid JSON -> 400
    const badJson = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/status',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: '{bad'
    });
    assert.equal(badJson.status, 400);

    // Non-object JSON -> 400
    const arrJson = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/status',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: '[]'
    });
    assert.equal(arrJson.status, 400);
  } finally {
    await srv.close();
  }
});

test('C9: POST /api/status, /api/config private reset, /api/discover, /api/validate-bot, /api/preview & scrubbing', async () => {
  const secretToken = 'ghp_SuperSecretTestToken1234567890abcd';
  const cfgWithPrivate = makeProfileAgentsConfig();
  assert.equal(cfgWithPrivate.includePrivate, true);

  const srv = await startServer({
    port: 0,
    config: cfgWithPrivate,
    allowIncludePrivate: false,
    resolveTokenFn: () => ({ token: secretToken, sourceLabel: 'env' }),
    discoverBotsFn: async () => [{ slug: 'dependapilot[bot]', eventEstimate: 15 }],
    validateBotSlugFn: async (slug) => ({ valid: slug === 'dependapilot[bot]', slug }),
    collectActivityFn: async ({ config }) => {
      const start = '2025-11-30';
      const end = '2026-11-24';
      const days = {};
      for (let d = Date.parse(`${start}T00:00:00Z`); d <= Date.parse(`${end}T00:00:00Z`); d += 86_400_000) {
        days[new Date(d).toISOString().slice(0, 10)] = 0;
      }
      days[end] = 4;
      return {
        counts: {
          schemaVersion: 1,
          generatedAt: `${end}T00:00:00Z`,
          window: { weeks: 52, startDate: start, endDate: end },
          scope: { mode: config.includePrivate ? 'public+private' : 'public' },
          agents: [
            {
              slug: config.agents[0].slug,
              label: config.agents[0].label,
              ramp: config.agents[0].ramp,
              source: 'github',
              totals: { prsOpened: 2, prsMerged: 1, commits: 1, reviews: 0, comments: 0, issues: 0, total: 4 },
              streaks: { current: 1, best: 1 },
              days
            }
          ]
        },
        warnings: [
          {
            code: 'SCOPE_CAVEAT',
            agent: null,
            metric: null,
            detail: `Warning carrying Bearer ${secretToken} and raw ${secretToken}`
          }
        ]
      };
    }
  });

  try {
    const status = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/status',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: '{}'
    });
    assert.equal(status.status, 200);
    assert.deepEqual(JSON.parse(status.text), { authPresent: true, authSource: 'env' });
    assert.ok(!status.text.includes(secretToken));

    const cfgRes = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/config',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: '{}'
    });
    assert.equal(cfgRes.status, 200);
    const cfgBody = JSON.parse(cfgRes.text);
    assert.equal(cfgBody.hasConfig, true);
    assert.equal(cfgBody.config.includePrivate, false, 'init must force includePrivate false unless allowIncludePrivate');

    // /api/discover rejects non-boolean includePrivate -> 400
    const badDiscover = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/discover',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ owner: 'octocat', scopeType: 'user', includePrivate: 'true' })
    });
    assert.equal(badDiscover.status, 400);

    const okDiscover = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/discover',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ owner: 'octocat', scopeType: 'user', includePrivate: false })
    });
    assert.equal(okDiscover.status, 200);
    assert.deepEqual(JSON.parse(okDiscover.text), { agents: [{ slug: 'dependapilot[bot]', eventEstimate: 15 }] });

    const valBot = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/validate-bot',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ slug: 'dependapilot[bot]' })
    });
    assert.equal(valBot.status, 200);
    assert.deepEqual(JSON.parse(valBot.text), { valid: true, slug: 'dependapilot[bot]' });

    // /api/preview rejects non-boolean live -> 400
    const badPreview = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/preview',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ config: cfgBody.config, live: 'yes' })
    });
    assert.equal(badPreview.status, 400);

    // 0-agent empty synthetic preview succeeds cleanly
    const emptyCfg = { ...cfgBody.config, agents: [] };
    const emptyPreview = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/preview',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ config: emptyCfg, live: false })
    });
    assert.equal(emptyPreview.status, 200);
    const emptyJson = JSON.parse(emptyPreview.text);
    assert.equal(emptyJson.isSynthetic, true);
    assert.equal(emptyJson.markdownSnippet, '');
    assert.equal(emptyJson.svgs.length, 2);

    // live preview scrubs token from warnings
    const livePreview = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/preview',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ config: cfgBody.config, live: true })
    });
    assert.equal(livePreview.status, 200);
    assert.ok(!livePreview.text.includes(secretToken));
    const liveJson = JSON.parse(livePreview.text);
    assert.equal(liveJson.isSynthetic, false);
    assert.match(liveJson.warnings[0].detail, /\[REDACTED\]/);
  } finally {
    await srv.close();
  }
});

test('C9: POST /api/schedule enforces 400 validations and opaque errors without leaking stack/tokens', async () => {
  const publicCfg = { ...makeProfileAgentsConfig(), includePrivate: false };
  const privateCfg = { ...makeProfileAgentsConfig(), includePrivate: true };
  const emptyCfg = { ...publicCfg, agents: [] };
  const sha40 = 'a'.repeat(40);

  const srv = await startServer({
    port: 0,
    config: publicCfg,
    allowIncludePrivate: true,
    defaultToolRef: null,
    resolveTokenFn: () => {
      throw new AuthError('missing');
    },
    collectActivityFn: async () => {
      throw new ApiError('API_ERROR');
    }
  });

  try {
    // 0 agents -> 400
    const res0 = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/schedule',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ target: 'task-scheduler', config: emptyCfg })
    });
    assert.equal(res0.status, 400);

    // non-empty scriptPath on actions -> 400
    const resScriptOnActions = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/schedule',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ target: 'actions', config: publicCfg, scriptPath: '/tmp/foo.sh', toolRef: sha40 })
    });
    assert.equal(resScriptOnActions.status, 400);

    // whitespace-only scriptPath trimmed to undefined on actions with toolRef -> 200
    const resBlankScriptOnActions = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/schedule',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ target: 'actions', config: publicCfg, scriptPath: '   ', toolRef: sha40 })
    });
    assert.equal(resBlankScriptOnActions.status, 200);
    const actionsOk = JSON.parse(resBlankScriptOnActions.text);
    assert.equal(actionsOk.filename, 'lynceus.yml');

    // toolRef + packagePin simultaneous -> 400
    const resConflict = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/schedule',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({
        target: 'actions',
        config: publicCfg,
        toolRef: sha40,
        packagePin: 'lynceus@0.1.0'
      })
    });
    assert.equal(resConflict.status, 400);

    // actions + includePrivate: true -> 400
    const resPrivateActions = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/schedule',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ target: 'actions', config: privateCfg, toolRef: sha40 })
    });
    assert.equal(resPrivateActions.status, 400);

    // pre-publish defaultToolRef === null without toolRef/packagePin -> 400
    const resPrepublish = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/schedule',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ target: 'actions', config: publicCfg })
    });
    assert.equal(resPrepublish.status, 400);

    // local task-scheduler with includePrivate: true -> 200 with privacyNotice
    const resLocalPrivate = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/schedule',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ target: 'task-scheduler', config: privateCfg })
    });
    assert.equal(resLocalPrivate.status, 200);
    const localJson = JSON.parse(resLocalPrivate.text);
    assert.ok(localJson.snippet.includes("& 'node'"));
    assert.ok(localJson.privacyNotice.includes('--include-private'));
    assert.ok(localJson.instructions.includes('Register-ScheduledTask'));

    // Opaque error JSON (never exposes stack trace)
    const errRes = await rawHttpRequest({
      port: srv.port,
      method: 'POST',
      path: '/api/preview',
      headers: apiHeaders(srv.port, srv.sessionToken),
      body: JSON.stringify({ config: publicCfg, live: true })
    });
    assert.equal(errRes.status, 401);
    const errJson = JSON.parse(errRes.text);
    assert.deepEqual(Object.keys(errJson).sort(), ['error', 'message']);
    assert.ok(!errRes.text.includes('at '));
  } finally {
    await srv.close();
  }

  // allowIncludePrivate: true preserves includePrivate on /api/config & maps all ApiError codes
  let nextErr = new ApiError('AUTH_FORBIDDEN');
  const srvPriv = await startServer({
    port: 0,
    config: privateCfg,
    allowIncludePrivate: true,
    resolveTokenFn: () => ({ token: 'ghp_validTokenForErrorMap123', sourceLabel: 'env' }),
    collectActivityFn: async () => {
      throw nextErr;
    }
  });
  try {
    const cfgRes = await rawHttpRequest({
      port: srvPriv.port,
      method: 'POST',
      path: '/api/config',
      headers: apiHeaders(srvPriv.port, srvPriv.sessionToken),
      body: '{}'
    });
    assert.equal(cfgRes.status, 200);
    assert.equal(JSON.parse(cfgRes.text).config.includePrivate, true);

    for (const [errObj, expectedStatus, expectedCode] of [
      [new ApiError('AUTH_FORBIDDEN'), 403, 'AUTH_FORBIDDEN'],
      [new ApiError('API_RATE_LIMIT'), 429, 'API_RATE_LIMIT'],
      [new ApiError('API_TIMEOUT'), 504, 'API_TIMEOUT'],
      [new ApiError('API_ERROR'), 502, 'API_ERROR'],
      [new Error('secret ghp_ShouldNeverLeak123456'), 500, 'INTERNAL_ERROR']
    ]) {
      nextErr = errObj;
      const res = await rawHttpRequest({
        port: srvPriv.port,
        method: 'POST',
        path: '/api/preview',
        headers: apiHeaders(srvPriv.port, srvPriv.sessionToken),
        body: JSON.stringify({ config: publicCfg, live: true })
      });
      assert.equal(res.status, expectedStatus);
      const parsed = JSON.parse(res.text);
      assert.equal(parsed.error, expectedCode);
      assert.ok(!res.text.includes('ghp_ShouldNeverLeak'));
    }
  } finally {
    await srvPriv.close();
  }
});

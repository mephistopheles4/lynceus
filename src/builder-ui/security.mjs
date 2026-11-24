/**
 * Localhost HTTP security boundary for the Lynceus Builder UI (S7, threat boundary B2).
 * Enforces global Host validation, strict method allowlist, zero CORS, static MIME types,
 * per-request CSP nonces, Origin/Sec-Fetch-Site/Bearer SHA-256 checks, and <= 32 KB JSON bodies.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const MAX_API_BODY_BYTES = 32_768;

export const STATIC_ROUTES = new Map([
  ['/', 'text/html; charset=utf-8'],
  ['/styles.css', 'text/css; charset=utf-8'],
  ['/app.js', 'text/javascript; charset=utf-8'],
  ['/demo-data.js', 'text/javascript; charset=utf-8'],
  ['/favicon.ico', 'image/x-icon'],
  ['/renderer/palettes.mjs', 'text/javascript; charset=utf-8'],
  ['/renderer/sanitize.mjs', 'text/javascript; charset=utf-8'],
  ['/renderer/svg.mjs', 'text/javascript; charset=utf-8'],
  ['/renderer/markdown.mjs', 'text/javascript; charset=utf-8']
]);

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function generateSessionToken() {
  return randomBytes(32).toString('hex');
}

export function generateCspNonce() {
  return randomBytes(16).toString('base64url');
}

export function buildHtmlCsp(nonce) {
  return (
    `default-src 'self'; ` +
    `script-src 'self' 'nonce-${nonce}'; ` +
    `style-src 'self'; ` +
    `img-src 'self' data: blob:; ` +
    `connect-src 'self'; ` +
    `form-action 'none'; ` +
    `frame-ancestors 'none'; ` +
    `base-uri 'none'`
  );
}

export function baseSecurityHeaders(csp = "frame-ancestors 'none'") {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': csp
  };
}

export function sendResponse(res, status, body, contentType, csp) {
  const headers = {
    ...baseSecurityHeaders(csp),
    'Content-Type': contentType
  };
  if (Buffer.isBuffer(body)) {
    headers['Content-Length'] = String(body.length);
  }
  res.writeHead(status, headers);
  res.end(body);
}

export function sendJsonError(res, status, errorCode, message) {
  const payload = Buffer.from(JSON.stringify({ error: errorCode, message }), 'utf8');
  sendResponse(res, status, payload, 'application/json; charset=utf-8');
}

export function sendJsonOk(res, data) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  sendResponse(res, 200, payload, 'application/json; charset=utf-8');
}

function sha256Digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function verifyBearerToken(authHeader, expectedDigest) {
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return false;
  const provided = authHeader.slice(7);
  if (provided.length === 0) return false;
  const providedDigest = sha256Digest(provided);
  return timingSafeEqual(providedDigest, expectedDigest);
}

function countRawHeader(rawHeaders, lowerName) {
  if (!Array.isArray(rawHeaders)) return 1;
  let count = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (String(rawHeaders[i]).toLowerCase() === lowerName) count += 1;
  }
  return count;
}

/**
 * Global pre-route Host and method/path guards executed BEFORE any static or API dispatch.
 * Returns `{ kind: 'static'|'api', pathname }` or throws {@link HttpError}.
 */
export function enforcePreRouteGuards(req, actualPort) {
  const expectedHost = `127.0.0.1:${actualPort}`;
  if (countRawHeader(req.rawHeaders, 'host') !== 1 || req.headers?.host !== expectedHost) {
    throw new HttpError(400, 'INVALID_HOST', 'Invalid Host header');
  }

  const rawUrl = req.url;
  if (typeof rawUrl !== 'string' || rawUrl === '' || rawUrl.includes('\0') || /%2e/i.test(rawUrl)) {
    throw new HttpError(400, 'INVALID_URL', 'Invalid request URL');
  }

  let pathname;
  try {
    pathname = new URL(rawUrl, `http://${expectedHost}`).pathname;
  } catch {
    throw new HttpError(400, 'INVALID_URL', 'Invalid request URL');
  }

  if (pathname.includes('..')) {
    throw new HttpError(400, 'INVALID_URL', 'Invalid request URL');
  }

  const method = req.method;
  if (method !== 'GET' && method !== 'POST') {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  }

  if (method === 'GET') {
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'API endpoints require POST');
    }
    if (!STATIC_ROUTES.has(pathname)) {
      throw new HttpError(404, 'NOT_FOUND', 'Resource not found');
    }
    return { kind: 'static', pathname };
  }

  if (STATIC_ROUTES.has(pathname)) {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Static assets require GET');
  }
  if (!pathname.startsWith('/api/')) {
    throw new HttpError(404, 'NOT_FOUND', 'Resource not found');
  }
  return { kind: 'api', pathname };
}

/**
 * Enforce all POST /api/* security checks (Origin, Sec-Fetch-Site, Bearer, Content-Type, <= 32 KB JSON).
 * Returns the parsed JSON object or throws {@link HttpError}.
 */
export async function validateApiRequest(req, actualPort, expectedTokenDigest) {
  const expectedOrigin = `http://127.0.0.1:${actualPort}`;
  if (req.headers?.origin !== expectedOrigin) {
    throw new HttpError(403, 'FORBIDDEN_ORIGIN', 'Invalid request origin');
  }

  const fetchSite = req.headers?.['sec-fetch-site'];
  if (fetchSite !== undefined && fetchSite !== 'same-origin') {
    throw new HttpError(403, 'FORBIDDEN_FETCH_SITE', 'Cross-site requests are not allowed');
  }

  if (!verifyBearerToken(req.headers?.authorization, expectedTokenDigest)) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid session token');
  }

  const rawContentType = req.headers?.['content-type'];
  const mediaType = typeof rawContentType === 'string'
    ? rawContentType.split(';')[0].trim().toLowerCase()
    : '';
  if (mediaType !== 'application/json') {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }

  const contentLengthHeader = req.headers?.['content-length'];
  if (contentLengthHeader !== undefined) {
    const declaredLength = Number(contentLengthHeader);
    if (!Number.isFinite(declaredLength) || declaredLength > MAX_API_BODY_BYTES) {
      req.resume();
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 32 KB limit');
    }
  }

  const rawBody = await readBoundedBody(req, MAX_API_BODY_BYTES);
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be a JSON object');
  }
  return parsed;
}

function readBoundedBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    const finishError = (err) => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.resume();
      reject(err);
    };

    const onData = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        finishError(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 32 KB limit'));
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    };

    const onError = () => {
      finishError(new HttpError(400, 'INVALID_JSON', 'Failed to read request body'));
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

export function createTokenDigest(token) {
  return sha256Digest(token);
}

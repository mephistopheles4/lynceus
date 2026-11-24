/**
 * `[bot]` discovery and slug validation (S4). All inputs are validated before any network call.
 */
import { BOT_SLUG_RE, ValidationError, validateOwner } from './config.mjs';
import { computeWindow } from './collect.mjs';
import { createGitHubClient, ApiError } from './github-client.mjs';
import { assertValidDiscoverResult } from './privacy-gate.mjs';

const MAX_PAGES = 3;

const DISCOVER_QUERY = `query DiscoverBots($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on Issue {
        author { __typename login }
        comments(last: 20) { nodes { author { __typename login } } }
      }
      ... on PullRequest {
        author { __typename login }
        reviews(last: 20) { nodes { author { __typename login } } }
        comments(last: 20) { nodes { author { __typename login } } }
      }
    }
  }
}`;

function botSlugOf(actor) {
  if (actor?.__typename !== 'Bot' || typeof actor.login !== 'string') return null;
  const slug = actor.login.endsWith('[bot]') ? actor.login : `${actor.login}[bot]`;
  return BOT_SLUG_RE.test(slug) ? slug : null;
}

function* actorsOf(node) {
  yield node?.author;
  for (const list of [node?.comments?.nodes, node?.reviews?.nodes]) {
    if (Array.isArray(list)) for (const item of list) yield item?.author;
  }
}

/**
 * @returns {Promise<Array<{ slug: string, eventEstimate: number }>>}
 */
export async function discoverBots({ owner, scopeType, includePrivate = false, windowWeeks = 52, endDate, limit = 20, token, client, fetchFn } = {}) {
  validateOwner(owner);
  if (scopeType !== 'user' && scopeType !== 'org') throw new ValidationError('scopeType must be "user" or "org"');
  if (typeof includePrivate !== 'boolean') throw new ValidationError('includePrivate must be a boolean');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ValidationError('limit must be an integer in 1..50');
  const { startDate } = computeWindow(windowWeeks, endDate);

  const api = client ?? createGitHubClient({ token, fetchFn });
  const q = `${scopeType}:${owner} updated:>=${startDate}${includePrivate === true ? '' : ' is:public'} sort:updated-desc`;
  const estimates = new Map();

  let after = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await api.graphql(DISCOVER_QUERY, { q, after });
    const search = data?.search;
    if (!search || !Array.isArray(search.nodes)) throw new ApiError('GRAPHQL_ERROR');
    for (const node of search.nodes) {
      for (const actor of actorsOf(node)) {
        const slug = botSlugOf(actor);
        if (slug === null) continue;
        const entry = estimates.get(slug.toLowerCase()) ?? { slug, eventEstimate: 0 };
        entry.eventEstimate += 1;
        estimates.set(slug.toLowerCase(), entry);
      }
    }
    if (!search.pageInfo?.hasNextPage || !search.pageInfo.endCursor) break;
    after = search.pageInfo.endCursor;
  }

  const items = [...estimates.values()]
    .sort((a, b) => b.eventEstimate - a.eventEstimate || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, limit);
  return assertValidDiscoverResult(items);
}

/**
 * @returns {Promise<{ valid: boolean, slug: string }>}
 */
export async function validateBotSlug(slug, { token, client, fetchFn } = {}) {
  if (typeof slug !== 'string' || !BOT_SLUG_RE.test(slug)) return { valid: false, slug };
  const api = client ?? createGitHubClient({ token, fetchFn });
  const { status, data } = await api.getUser(slug);
  if (status === 404) return { valid: false, slug };
  const canonical = typeof data?.login === 'string' && BOT_SLUG_RE.test(data.login) ? data.login : slug;
  return { valid: data?.type === 'Bot', slug: canonical };
}

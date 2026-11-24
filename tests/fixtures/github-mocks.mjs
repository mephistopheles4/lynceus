/**
 * Sanitized mock GraphQL and REST fixtures for collector, CLI, and profile tests.
 */

export const CANARY_STRINGS = Object.freeze({
  repoName: 'secret-canary-omega-repo',
  prTitle: 'CONFIDENTIAL canary project phoenix title',
  url: 'https://github.com/canary-org/secret-canary-omega-repo/pull/999',
  ssoSlug: 'canary-sso-corp',
  nodeId: 'PR_kwDOCanaryNodeId999',
  sha: 'deadbeef1234567890abcdef1234567890abcdef',
  token: 'ghp_CanarySecretTokenValue1234567890abcd'
});

/**
 * Create a mocked Response-like object for fetch injection.
 */
export function makeJsonResponse(body, { status = 200, headers = {} } = {}) {
  const hdrs = new Headers({ 'content-type': 'application/json', ...headers });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: hdrs,
    async json() {
      return structuredClone(body);
    },
    async text() {
      return JSON.stringify(body);
    }
  };
}

/**
 * Build a GraphQL search discovery page.
 */
export function makeDiscoverPage({ nodes = [], hasNextPage = false, endCursor = null } = {}) {
  return {
    data: {
      search: {
        pageInfo: { hasNextPage, endCursor },
        nodes
      }
    }
  };
}

/**
 * Build a GraphQL issue/PR search page.
 */
export function makeSearchPage({
  issueCount = 0,
  nodes = [],
  hasNextPage = false,
  endCursor = null
} = {}) {
  return {
    data: {
      search: {
        issueCount,
        pageInfo: { hasNextPage, endCursor },
        nodes
      }
    }
  };
}

/**
 * Build a REST /search/commits page.
 */
export function makeRestCommitSearchPage({
  totalCount = 0,
  incompleteResults = false,
  items = []
} = {}) {
  return {
    total_count: totalCount,
    incomplete_results: incompleteResults,
    items
  };
}

/**
 * Build a sanitized 3-bot fixture dataset for mocked CLI & profile dry-runs.
 */
export function makeProfileAgentsConfig() {
  return {
    schemaVersion: 1,
    owner: 'mephistopheles4',
    scopeType: 'user',
    includePrivate: true,
    windowWeeks: 52,
    layout: 'separate',
    detail: 'breakdown',
    markStyle: 'squares',
    labelMode: 'friendly',
    branch: 'generated',
    subpath: 'agent-activity',
    markdownBase: 'raw',
    metrics: {
      prsOpened: true,
      prsMerged: true,
      commits: true,
      reviews: true,
      comments: true,
      issues: true
    },
    agents: [
      { slug: 'mephistos-homunculus[bot]', label: 'Homunculus', ramp: 'emerald' },
      { slug: 'mephistos-euphorion[bot]', label: 'Euphorion', ramp: 'cobalt' },
      { slug: 'mephistos-wagner[bot]', label: 'Wagner', ramp: 'amber' }
    ]
  };
}

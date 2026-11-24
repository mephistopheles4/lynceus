// Agent Atlas unified Builder UI controller (SPEC S7, DESIGN.md).
// Pure DOM construction, class-driven styling, closure-only token, system font stacks.

import {
  DEMO_COUNTS_52W,
  DEMO_DEFAULT_CONFIG,
  DEMO_DISCOVERED_BOTS,
  DEMO_PRESETS,
  buildDemoCountsForConfig
} from './demo-data.js';
import { renderMarkdownSnippet } from './renderer/markdown.mjs';
import { COLOR_RAMPS, RAMP_NAMES } from './renderer/palettes.mjs';
import {
  BOT_SLUG_RE,
  validateBranch,
  validateOwner,
  validateSubpath
} from './renderer/sanitize.mjs';
import { renderSvgs } from './renderer/svg.mjs';

const METRIC_KEYS = ['prsOpened', 'prsMerged', 'commits', 'reviews', 'comments', 'issues'];

/**
 * Consume and delete `window.__LYNCEUS_BOOTSTRAP__` in one pass.
 * Returns `{ mode: 'local', token }` on localhost or `{ mode: 'demo', token: null }` on Pages.
 */
export function consumeBootstrap(win = typeof window !== 'undefined' ? window : undefined) {
  const raw = win?.__LYNCEUS_BOOTSTRAP__;
  if (!raw || typeof raw !== 'object') {
    return { mode: 'demo', token: null };
  }
  try {
    delete win.__LYNCEUS_BOOTSTRAP__;
  } catch {
    win.__LYNCEUS_BOOTSTRAP__ = undefined;
  }
  if (raw.mode === 'local' && typeof raw.token === 'string' && raw.token.length > 0) {
    return { mode: 'local', token: raw.token };
  }
  return { mode: 'demo', token: null };
}

/**
 * Normalize a user-entered bot handle: trims whitespace and appends `[bot]` if absent.
 */
export function normalizeBotSlugInput(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  if (/\[bot\]$/i.test(trimmed)) {
    return `${trimmed.slice(0, -5)}[bot]`;
  }
  if (trimmed.includes('[') || trimmed.includes(']')) {
    return trimmed;
  }
  return `${trimmed}[bot]`;
}

/**
 * Compute the data-fetch cache key covering only fields that alter collected counts.
 * Visual options (layout, detail, markStyle, labelMode, ramp, label, theme) are excluded.
 */
export function buildDataCacheKey(config) {
  const m = config?.metrics ?? {};
  const metricSig = METRIC_KEYS.map((k) => `${k}:${m[k] === true ? 1 : 0}`).join(',');
  const agentSig = (config?.agents ?? []).map((a) => String(a.slug ?? '').toLowerCase()).join('|');
  return JSON.stringify([
    config?.owner ?? '',
    config?.scopeType ?? 'user',
    config?.includePrivate === true,
    config?.windowWeeks === 26 ? 26 : 52,
    metricSig,
    agentSig
  ]);
}

/**
 * Project cached counts with the latest visual agent labels and color ramps without refetching.
 */
export function applyVisualOverridesToCounts(counts, config) {
  if (!counts || !Array.isArray(counts.agents)) return counts;
  const bySlug = new Map((config?.agents ?? []).map((a) => [a.slug.toLowerCase(), a]));
  return {
    ...counts,
    agents: counts.agents.map((entry) => {
      const match = bySlug.get(String(entry.slug ?? '').toLowerCase());
      if (!match) return entry;
      return {
        ...entry,
        label: match.label || entry.label,
        ramp: RAMP_NAMES.includes(match.ramp) ? match.ramp : entry.ramp
      };
    })
  };
}

/**
 * Scope errors cleanly so preview/discover failures clear stale SVGs while schedule failures
 * preserve valid Workbench SVGs.
 */
export function applyScopedError(state, scope, message) {
  const msg = String(message ?? 'Request failed');
  if (scope === 'schedule') {
    state.scheduleError = msg;
    state.scheduleResult = null;
    return state;
  }
  state.fatalError = msg;
  state.counts = null;
  state.svgs = [];
  state.markdownSnippet = '';
  state.warnings = [];
  return state;
}

function cloneConfig(cfg) {
  return {
    schemaVersion: 1,
    owner: cfg.owner,
    scopeType: cfg.scopeType,
    includePrivate: Boolean(cfg.includePrivate),
    windowWeeks: cfg.windowWeeks === 26 ? 26 : 52,
    layout: cfg.layout,
    detail: cfg.detail,
    markStyle: cfg.markStyle,
    labelMode: cfg.labelMode,
    branch: cfg.branch ?? 'generated',
    subpath: cfg.subpath ?? 'agent-activity',
    markdownBase: cfg.markdownBase ?? 'raw',
    metrics: { ...cfg.metrics },
    agents: (cfg.agents ?? []).map((a) => ({ slug: a.slug, label: a.label, ramp: a.ramp }))
  };
}

function createInitialState(mode) {
  return {
    mode,
    activeView: 'configure',
    activeTab: 'config',
    specimenTheme: 'both',
    authPresent: false,
    authSource: null,
    preferLive: false,
    isSynthetic: true,
    config: cloneConfig(DEMO_DEFAULT_CONFIG),
    discoveredBots: mode === 'demo' ? [...DEMO_DISCOVERED_BOTS] : [],
    counts: cloneConfigCounts(DEMO_COUNTS_52W),
    svgs: [],
    markdownSnippet: '',
    warnings: [],
    fatalError: '',
    scheduleError: '',
    scheduleResult: null,
    countsCache: new Map()
  };
}

function cloneConfigCounts(c) {
  return JSON.parse(JSON.stringify(c));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function triggerDownload(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyWithFeedback(button, text) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copied';
    button.classList.add('is-copied');
  } catch {
    button.textContent = 'Copy unavailable';
  }
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('is-copied');
  }, 1500);
}

function parseViewBoxDims(svgText) {
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svgText);
  return m ? `${m[1]}×${m[2]}` : 'unknown';
}

function formatBytes(str) {
  const bytes = new TextEncoder().encode(str).length;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function initApp() {
  const bootstrap = consumeBootstrap(window);
  const state = createInitialState(bootstrap.mode);
  let activeBlobUrls = [];

  const revokeBlobUrls = () => {
    for (const u of activeBlobUrls) URL.revokeObjectURL(u);
    activeBlobUrls = [];
  };

  const makeSvgBlobImg = (svgObj, altText) => {
    const blob = new Blob([svgObj.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    activeBlobUrls.push(url);
    const img = document.createElement('img');
    img.src = url;
    img.alt = altText;
    return img;
  };

  async function apiPost(path, body = {}) {
    if (state.mode !== 'local' || !bootstrap.token) {
      throw new Error('Local server API is unavailable in static demo mode');
    }
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bootstrap.token}`
      },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({ error: 'INVALID_RESPONSE', message: 'Invalid server response' }));
    if (!res.ok) {
      throw new Error(data?.message || `Request failed (HTTP ${res.status})`);
    }
    return data;
  }

  // DOM references
  const dom = {
    navConfigure: document.getElementById('nav-configure'),
    navWorkbench: document.getElementById('nav-workbench'),
    viewConfigure: document.getElementById('view-configure'),
    viewWorkbench: document.getElementById('view-workbench'),
    demoPill: document.getElementById('demo-pill'),
    authPill: document.getElementById('auth-pill'),
    globalError: document.getElementById('global-error-banner'),
    warningsBanner: document.getElementById('warnings-banner'),
    ownerInput: document.getElementById('owner-input'),
    scopeSegmented: document.getElementById('scope-segmented'),
    discoverBtn: document.getElementById('discover-btn'),
    discoverStatus: document.getElementById('discover-status'),
    discoverList: document.getElementById('discover-list'),
    manualBotForm: document.getElementById('manual-bot-form'),
    manualBotInput: document.getElementById('manual-bot-input'),
    manualBotError: document.getElementById('manual-bot-error'),
    agentCountHint: document.getElementById('agent-count-hint'),
    selectedAgentsList: document.getElementById('selected-agents-list'),
    metricChecks: [...document.querySelectorAll('[data-metric]')],
    metricsError: document.getElementById('metrics-error'),
    includePrivateCheckbox: document.getElementById('include-private-checkbox'),
    branchInput: document.getElementById('branch-input'),
    subpathInput: document.getElementById('subpath-input'),
    markdownBaseSelect: document.getElementById('markdown-base-select'),
    publishSettingsError: document.getElementById('publish-settings-error'),
    configPreviewMeta: document.getElementById('config-preview-meta'),
    configMiniPreview: document.getElementById('config-mini-preview'),
    runLiveBtn: document.getElementById('run-live-btn'),
    openWorkbenchBtn: document.getElementById('open-workbench-btn'),
    wbRefreshLiveBtn: document.getElementById('wb-refresh-live-btn'),
    downloadConfigBtn: document.getElementById('download-config-btn'),
    downloadSvgsBtn: document.getElementById('download-svgs-btn'),
    stageTelemetry: document.getElementById('stage-telemetry'),
    readmeStageGrid: document.getElementById('readme-stage-grid'),
    tabButtons: [...document.querySelectorAll('.tab-btn')],
    tabPanels: {
      config: document.getElementById('tab-panel-config'),
      markdown: document.getElementById('tab-panel-markdown'),
      counts: document.getElementById('tab-panel-counts'),
      schedule: document.getElementById('tab-panel-schedule')
    },
    codeWellConfig: document.getElementById('code-well-config'),
    codeWellMarkdown: document.getElementById('code-well-markdown'),
    codeWellCounts: document.getElementById('code-well-counts'),
    countsAuditSummary: document.getElementById('counts-audit-summary'),
    copyConfigBtn: document.getElementById('copy-config-btn'),
    panelDownloadConfigBtn: document.getElementById('panel-download-config-btn'),
    copyMarkdownBtn: document.getElementById('copy-markdown-btn'),
    copyCountsBtn: document.getElementById('copy-counts-btn'),
    scheduleEmptyGuidance: document.getElementById('schedule-empty-guidance'),
    scheduleDemoGuidance: document.getElementById('schedule-demo-guidance'),
    scheduleLocalPane: document.getElementById('schedule-local-pane'),
    scheduleForm: document.getElementById('schedule-form'),
    scheduleTargetSelect: document.getElementById('schedule-target-select'),
    scheduleScriptPath: document.getElementById('schedule-script-path'),
    scheduleTaskName: document.getElementById('schedule-task-name'),
    scheduleRepoDir: document.getElementById('schedule-repo-dir'),
    scheduleToolRef: document.getElementById('schedule-tool-ref'),
    schedulePackagePin: document.getElementById('schedule-package-pin'),
    schedulePrepublishNote: document.getElementById('schedule-prepublish-note'),
    schedulePrivateNote: document.getElementById('schedule-private-note'),
    scheduleErrorBanner: document.getElementById('schedule-error-banner'),
    scheduleOutput: document.getElementById('schedule-output'),
    schedulePrivacyNotice: document.getElementById('schedule-privacy-notice'),
    scheduleScriptPathReadout: document.getElementById('schedule-script-path-readout'),
    downloadScheduleBtn: document.getElementById('download-schedule-btn'),
    copyScheduleBtn: document.getElementById('copy-schedule-btn'),
    codeWellScheduleSnippet: document.getElementById('code-well-schedule-snippet'),
    codeWellScheduleInstructions: document.getElementById('code-well-schedule-instructions')
  };

  function validatePublishSettings() {
    try {
      validateOwner(state.config.owner);
      validateBranch(state.config.branch);
      validateSubpath(state.config.subpath);
      dom.publishSettingsError.hidden = true;
      dom.publishSettingsError.textContent = '';
      return true;
    } catch (err) {
      dom.publishSettingsError.textContent = err.message;
      dom.publishSettingsError.hidden = false;
      return false;
    }
  }

  function renderStatusChrome() {
    const showDemo = state.mode === 'demo' || state.isSynthetic;
    dom.demoPill.hidden = !showDemo;
    if (state.mode === 'demo') {
      dom.authPill.hidden = true;
      dom.discoverBtn.disabled = true;
      dom.discoverStatus.textContent = 'Demo preset roster (read-only in Pages mode)';
      dom.runLiveBtn.hidden = true;
      dom.wbRefreshLiveBtn.hidden = true;
    } else {
      dom.authPill.hidden = false;
      dom.authPill.classList.remove('is-ok', 'is-warning');
      if (state.authPresent) {
        dom.authPill.textContent = `AUTH: ${(state.authSource ?? 'env').toUpperCase()}`;
        dom.authPill.classList.add('is-ok');
        dom.discoverBtn.disabled = false;
        dom.runLiveBtn.disabled = state.config.agents.length === 0;
        dom.wbRefreshLiveBtn.disabled = state.config.agents.length === 0;
      } else {
        dom.authPill.textContent = 'AUTH: MISSING';
        dom.authPill.classList.add('is-warning');
        dom.discoverBtn.disabled = true;
        dom.runLiveBtn.disabled = true;
        dom.wbRefreshLiveBtn.disabled = true;
      }
      dom.runLiveBtn.hidden = false;
      dom.wbRefreshLiveBtn.hidden = false;
    }

    if (state.fatalError) {
      dom.globalError.textContent = state.fatalError;
      dom.globalError.hidden = false;
    } else {
      dom.globalError.hidden = true;
      dom.globalError.textContent = '';
    }

    if (state.warnings.length > 0) {
      dom.warningsBanner.textContent = state.warnings
        .map((w) => `[${w.code}] ${w.agent ? `${w.agent}: ` : ''}${w.detail}`)
        .join(' · ');
      dom.warningsBanner.hidden = false;
    } else {
      dom.warningsBanner.hidden = true;
      dom.warningsBanner.textContent = '';
    }
  }

  function renderDiscoverRoster() {
    if (state.discoveredBots.length === 0) {
      const empty = el(
        'div',
        'empty-state',
        state.mode === 'local'
          ? 'Run "Scan GitHub Apps" to discover active [bot] accounts, or add one manually below.'
          : 'No bots discovered.'
      );
      dom.discoverList.replaceChildren(empty);
      return;
    }

    const selectedSet = new Set(state.config.agents.map((a) => a.slug.toLowerCase()));
    const rows = state.discoveredBots.map((bot) => {
      const row = el('div', 'roster-row');
      const left = el('div', 'field-group');
      left.appendChild(el('span', 'roster-slug', bot.slug));
      left.appendChild(el('span', 'roster-estimate', `~${bot.eventEstimate} recent events`));

      const already = selectedSet.has(bot.slug.toLowerCase());
      const btn = el('button', `btn btn-sm ${already ? 'btn-ghost' : 'btn-secondary'}`, already ? 'Added' : 'Add');
      btn.type = 'button';
      btn.disabled = already || state.config.agents.length >= 12;
      btn.addEventListener('click', () => {
        addAgentSlug(bot.slug);
      });

      row.append(left, btn);
      return row;
    });
    dom.discoverList.replaceChildren(...rows);
  }

  function renderSelectedAgents() {
    const count = state.config.agents.length;
    dom.agentCountHint.textContent = `${count} / 12 SELECTED`;
    if (count === 0) {
      dom.selectedAgentsList.replaceChildren(
        el('div', 'empty-state', 'No agents selected. Add a [bot] account above to render activity graphs.')
      );
      return;
    }

    const rows = state.config.agents.map((agent, idx) => {
      const card = el('div', 'agent-config-row');
      const main = el('div', 'agent-config-main');
      main.appendChild(el('span', 'roster-slug', agent.slug));

      const controls = el('div', 'agent-config-controls');
      const labelInput = el('input', 'atlas-input');
      labelInput.type = 'text';
      labelInput.value = agent.label;
      labelInput.maxLength = 40;
      labelInput.setAttribute('aria-label', `Display label for ${agent.slug}`);
      labelInput.addEventListener('input', () => {
        const next = labelInput.value.trim();
        if (next.length > 0 && [...next].length <= 40) {
          agent.label = next;
          labelInput.removeAttribute('aria-invalid');
          renderFromCachedCounts();
        } else {
          labelInput.setAttribute('aria-invalid', 'true');
        }
      });

      const swatches = el('div', 'swatch-group');
      swatches.setAttribute('role', 'group');
      swatches.setAttribute('aria-label', `Color ramp for ${agent.slug}`);
      for (const rampName of RAMP_NAMES) {
        const sw = el('button', `swatch-btn swatch-${rampName}`);
        sw.type = 'button';
        sw.title = COLOR_RAMPS[rampName].label;
        sw.setAttribute('aria-label', `${COLOR_RAMPS[rampName].label} ramp`);
        sw.setAttribute('aria-pressed', String(agent.ramp === rampName));
        sw.addEventListener('click', () => {
          agent.ramp = rampName;
          renderSelectedAgents();
          renderFromCachedCounts();
        });
        swatches.appendChild(sw);
      }

      controls.append(labelInput, swatches);
      main.appendChild(controls);

      const removeBtn = el('button', 'btn btn-ghost btn-sm', 'Remove');
      removeBtn.type = 'button';
      removeBtn.addEventListener('click', () => {
        state.config.agents.splice(idx, 1);
        renderSelectedAgents();
        renderDiscoverRoster();
        refreshDataAndRender();
      });

      card.append(main, removeBtn);
      return card;
    });

    dom.selectedAgentsList.replaceChildren(...rows);
  }

  function renderConfigureInputs() {
    dom.ownerInput.value = state.config.owner;
    for (const btn of dom.scopeSegmented.querySelectorAll('[data-scope]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.scope === state.config.scopeType));
    }
    for (const cb of dom.metricChecks) {
      cb.checked = Boolean(state.config.metrics[cb.dataset.metric]);
    }
    dom.includePrivateCheckbox.checked = Boolean(state.config.includePrivate);
    dom.branchInput.value = state.config.branch;
    dom.subpathInput.value = state.config.subpath;
    dom.markdownBaseSelect.value = state.config.markdownBase;
  }

  function renderWorkbenchControls() {
    for (const btn of document.querySelectorAll('[data-option]')) {
      const opt = btn.dataset.option;
      const val = String(state.config[opt]);
      btn.setAttribute('aria-pressed', String(btn.dataset.value === val));
    }
    for (const btn of document.querySelectorAll('[data-theme]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.theme === state.specimenTheme));
    }
    dom.downloadSvgsBtn.disabled = state.svgs.length === 0;
  }

  function renderPreviews() {
    revokeBlobUrls();

    if (state.svgs.length === 0) {
      const msg = state.fatalError
        ? 'Preview cleared due to error. Resolve the issue above and retry.'
        : 'No SVG preview available.';
      dom.configMiniPreview.replaceChildren(el('div', 'empty-state', msg));
      dom.readmeStageGrid.replaceChildren(el('div', 'empty-state', msg));
      dom.configPreviewMeta.textContent = state.fatalError ? 'ERROR' : 'EMPTY';
      dom.stageTelemetry.textContent = state.fatalError ? 'CLEARED ON ERROR' : 'NO PREVIEW';
      return;
    }

    // Mini preview in Configure (shows dark + light first SVG)
    const miniNodes = [];
    for (const themeName of ['dark', 'light']) {
      const first = state.svgs.find((s) => s.theme === themeName);
      if (!first) continue;
      const box = el('div', `mini-preview-frame theme-${themeName}`);
      box.appendChild(makeSvgBlobImg(first, `${first.filename} preview`));
      miniNodes.push(box);
    }
    dom.configMiniPreview.replaceChildren(...miniNodes);
    const sample = state.svgs[0];
    dom.configPreviewMeta.textContent = `${state.config.windowWeeks}W · ${parseViewBoxDims(sample.svg)} · ${formatBytes(sample.svg)}`;

    // Workbench 838px README specimen(s)
    const themesToShow = state.specimenTheme === 'both' ? ['light', 'dark'] : [state.specimenTheme];
    dom.readmeStageGrid.className = `readme-stage-grid ${themesToShow.length === 2 ? 'mode-both' : 'mode-single'}`;

    const specimens = themesToShow.map((themeName) => {
      const card = el('article', `github-specimen theme-${themeName}`);
      const top = el('div', 'specimen-top');
      const title = el('h3', 'specimen-heading', `${state.config.owner || 'owner'} / README.md`);
      const badge = el(
        'span',
        'specimen-badge',
        state.isSynthetic ? `${themeName.toUpperCase()} · SYNTHETIC` : `${themeName.toUpperCase()} · LIVE COUNTS`
      );
      top.append(title, badge);

      const svgStage = el('div', 'readme-svg-stage');
      const themedSvgs = state.svgs.filter((s) => s.theme === themeName);
      for (const s of themedSvgs) {
        svgStage.appendChild(makeSvgBlobImg(s, `${s.filename} (${themeName} theme)`));
      }

      const pinned = el('div', 'specimen-pinned-grid');
      const repo1 = el('div', 'pinned-card');
      repo1.appendChild(el('span', 'pinned-title', `${state.config.owner || 'owner'}/lynceus`));
      repo1.appendChild(document.createTextNode('Zero-dependency GitHub App activity graph generator.'));
      const repo2 = el('div', 'pinned-card');
      repo2.appendChild(el('span', 'pinned-title', `${state.config.owner || 'owner'}/${state.config.scopeType === 'org' ? '.github' : (state.config.owner || 'owner')}`));
      repo2.appendChild(document.createTextNode('Profile README embedding GitHub-native Light and Dark SVGs.'));
      pinned.append(repo1, repo2);

      card.append(top, svgStage, pinned);
      return card;
    });

    dom.readmeStageGrid.replaceChildren(...specimens);
    dom.stageTelemetry.textContent = `${state.svgs.length} SVG${state.svgs.length === 1 ? '' : 'S'} · ${parseViewBoxDims(sample.svg)} · ${formatBytes(sample.svg)}`;
  }

  function renderArtifactTabs() {
    dom.codeWellConfig.textContent = JSON.stringify(state.config, null, 2);
    dom.codeWellMarkdown.textContent = state.markdownSnippet || '<!-- Add at least 1 agent to generate <picture> Markdown -->';
    if (state.counts) {
      dom.codeWellCounts.textContent = JSON.stringify(state.counts, null, 2);
      const totalEvents = state.counts.agents.reduce((acc, a) => acc + (a.totals?.total ?? 0), 0);
      dom.countsAuditSummary.textContent = `scope: ${state.counts.scope.mode} · ${state.counts.agents.length} agent(s) · ${totalEvents} total events · 0 repo names · 0 titles`;
    } else {
      dom.codeWellCounts.textContent = 'No verified counts loaded.';
      dom.countsAuditSummary.textContent = 'Unavailable';
    }
    renderScheduleTab();
  }

  function renderScheduleTab() {
    const hasAgents = state.config.agents.length > 0;
    const isLocal = state.mode === 'local';

    dom.scheduleEmptyGuidance.hidden = hasAgents;
    dom.scheduleDemoGuidance.hidden = !hasAgents || isLocal;
    dom.scheduleLocalPane.hidden = !hasAgents || !isLocal;

    if (!hasAgents || !isLocal) return;

    const target = dom.scheduleTargetSelect.value;
    const isActions = target === 'actions';
    dom.scheduleScriptPath.disabled = isActions;
    dom.scheduleTaskName.disabled = target !== 'task-scheduler';
    dom.scheduleToolRef.disabled = !isActions;
    dom.schedulePackagePin.disabled = !isActions;
    dom.schedulePrepublishNote.hidden = !isActions;
    dom.schedulePrivateNote.hidden = state.config.includePrivate !== true;

    if (state.scheduleError) {
      dom.scheduleErrorBanner.textContent = state.scheduleError;
      dom.scheduleErrorBanner.hidden = false;
    } else {
      dom.scheduleErrorBanner.hidden = true;
      dom.scheduleErrorBanner.textContent = '';
    }

    if (state.scheduleResult) {
      dom.scheduleOutput.hidden = false;
      if (state.scheduleResult.privacyNotice) {
        dom.schedulePrivacyNotice.textContent = state.scheduleResult.privacyNotice;
        dom.schedulePrivacyNotice.hidden = false;
      } else {
        dom.schedulePrivacyNotice.hidden = true;
        dom.schedulePrivacyNotice.textContent = '';
      }
      dom.scheduleScriptPathReadout.textContent = `Target script path: ${state.scheduleResult.scriptPath}`;
      dom.codeWellScheduleSnippet.textContent = state.scheduleResult.snippet;
      dom.codeWellScheduleInstructions.textContent = state.scheduleResult.instructions;
    } else {
      dom.scheduleOutput.hidden = true;
    }
  }

  function renderFromCachedCounts() {
    if (!state.counts || !validatePublishSettings()) return;
    try {
      const projected = applyVisualOverridesToCounts(state.counts, state.config);
      state.counts = projected;
      const svgs = renderSvgs(projected, { ...state.config, allowEmpty: true });
      const md = renderMarkdownSnippet({ ...state.config });
      state.svgs = svgs;
      state.markdownSnippet = md;
      state.fatalError = '';
    } catch (err) {
      applyScopedError(state, 'preview', err.message);
    }
    renderStatusChrome();
    renderWorkbenchControls();
    renderPreviews();
    renderArtifactTabs();
  }

  async function refreshDataAndRender({ forceLive = false } = {}) {
    if (!validatePublishSettings()) return;
    const key = buildDataCacheKey(state.config);

    if (state.mode === 'demo') {
      state.counts = buildDemoCountsForConfig(state.config, DEMO_PRESETS);
      state.isSynthetic = true;
      state.warnings = [];
      state.fatalError = '';
      renderFromCachedCounts();
      return;
    }

    if (!forceLive && state.countsCache.has(key)) {
      const cached = state.countsCache.get(key);
      state.counts = cloneConfigCounts(cached.counts);
      state.isSynthetic = cached.isSynthetic;
      state.warnings = cached.warnings;
      state.fatalError = '';
      renderFromCachedCounts();
      return;
    }

    const wantLive = (forceLive || state.preferLive) && state.authPresent && state.config.agents.length > 0;
    try {
      const data = await apiPost('/api/preview', {
        config: state.config,
        live: wantLive
      });
      state.counts = data.counts;
      state.svgs = data.svgs;
      state.markdownSnippet = data.markdownSnippet;
      state.isSynthetic = Boolean(data.isSynthetic);
      state.warnings = Array.isArray(data.warnings) ? data.warnings : [];
      state.fatalError = '';
      state.countsCache.set(key, {
        counts: cloneConfigCounts(data.counts),
        isSynthetic: state.isSynthetic,
        warnings: state.warnings
      });
      if (wantLive) state.preferLive = true;
    } catch (err) {
      applyScopedError(state, 'preview', err.message);
    }

    renderStatusChrome();
    renderWorkbenchControls();
    renderPreviews();
    renderArtifactTabs();
  }

  async function addAgentSlug(rawSlug) {
    const normalized = normalizeBotSlugInput(rawSlug);
    if (!BOT_SLUG_RE.test(normalized)) {
      dom.manualBotError.textContent = 'Enter a valid GitHub App handle (letters, digits, hyphens, ending in [bot]).';
      dom.manualBotError.hidden = false;
      dom.manualBotInput.setAttribute('aria-invalid', 'true');
      return;
    }
    if (state.config.agents.some((a) => a.slug.toLowerCase() === normalized.toLowerCase())) {
      dom.manualBotError.textContent = `${normalized} is already in your roster.`;
      dom.manualBotError.hidden = false;
      return;
    }
    if (state.config.agents.length >= 12) {
      dom.manualBotError.textContent = 'Maximum of 12 agents reached.';
      dom.manualBotError.hidden = false;
      return;
    }

    if (state.mode === 'local' && state.authPresent) {
      try {
        const res = await apiPost('/api/validate-bot', { slug: normalized });
        if (!res.valid) {
          dom.manualBotError.textContent = `${res.slug} was not found as a GitHub Bot account.`;
          dom.manualBotError.hidden = false;
          dom.manualBotInput.setAttribute('aria-invalid', 'true');
          return;
        }
      } catch (err) {
        dom.manualBotError.textContent = err.message;
        dom.manualBotError.hidden = false;
        return;
      }
    }

    dom.manualBotError.hidden = true;
    dom.manualBotError.textContent = '';
    dom.manualBotInput.removeAttribute('aria-invalid');
    dom.manualBotInput.value = '';

    const stem = normalized.replace(/\[bot\]$/i, '');
    const friendly = stem.charAt(0).toUpperCase() + stem.slice(1);
    const ramp = RAMP_NAMES[state.config.agents.length % RAMP_NAMES.length];
    state.config.agents.push({ slug: normalized, label: friendly.slice(0, 40), ramp });

    renderSelectedAgents();
    renderDiscoverRoster();
    await refreshDataAndRender();
  }

  function switchView(view) {
    state.activeView = view;
    const isConfigure = view === 'configure';
    dom.viewConfigure.hidden = !isConfigure;
    dom.viewWorkbench.hidden = isConfigure;
    dom.navConfigure.setAttribute('aria-selected', String(isConfigure));
    dom.navWorkbench.setAttribute('aria-selected', String(!isConfigure));
  }

  function switchTab(tab) {
    state.activeTab = tab;
    for (const btn of dom.tabButtons) {
      const active = btn.id === `tab-btn-${tab}`;
      btn.setAttribute('aria-selected', String(active));
    }
    for (const [k, panel] of Object.entries(dom.tabPanels)) {
      panel.hidden = k !== tab;
    }
    if (tab === 'schedule') renderScheduleTab();
  }

  // Event listeners
  dom.navConfigure.addEventListener('click', () => switchView('configure'));
  dom.navWorkbench.addEventListener('click', () => switchView('workbench'));
  dom.openWorkbenchBtn.addEventListener('click', () => switchView('workbench'));

  dom.ownerInput.addEventListener('change', () => {
    state.config.owner = dom.ownerInput.value.trim();
    refreshDataAndRender();
  });

  dom.scopeSegmented.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scope]');
    if (!btn) return;
    state.config.scopeType = btn.dataset.scope;
    renderConfigureInputs();
    refreshDataAndRender();
  });

  dom.discoverBtn.addEventListener('click', async () => {
    if (!validatePublishSettings()) return;
    dom.discoverStatus.textContent = 'Scanning GitHub Apps...';
    try {
      const res = await apiPost('/api/discover', {
        owner: state.config.owner,
        scopeType: state.config.scopeType,
        includePrivate: state.config.includePrivate,
        windowWeeks: state.config.windowWeeks
      });
      state.discoveredBots = Array.isArray(res.agents) ? res.agents : [];
      dom.discoverStatus.textContent = `Found ${state.discoveredBots.length} bot account(s).`;
      state.fatalError = '';
      renderStatusChrome();
      renderDiscoverRoster();
    } catch (err) {
      dom.discoverStatus.textContent = '';
      applyScopedError(state, 'discover', err.message);
      renderStatusChrome();
      renderPreviews();
    }
  });

  dom.manualBotForm.addEventListener('submit', (e) => {
    e.preventDefault();
    addAgentSlug(dom.manualBotInput.value);
  });

  for (const cb of dom.metricChecks) {
    cb.addEventListener('change', () => {
      const key = cb.dataset.metric;
      const next = { ...state.config.metrics, [key]: cb.checked };
      if (!METRIC_KEYS.some((k) => next[k])) {
        cb.checked = true;
        dom.metricsError.textContent = 'At least one activity metric must stay enabled.';
        dom.metricsError.hidden = false;
        return;
      }
      dom.metricsError.hidden = true;
      dom.metricsError.textContent = '';
      state.config.metrics = next;
      refreshDataAndRender();
    });
  }

  dom.includePrivateCheckbox.addEventListener('change', () => {
    state.config.includePrivate = dom.includePrivateCheckbox.checked;
    refreshDataAndRender();
    renderScheduleTab();
  });

  dom.branchInput.addEventListener('change', () => {
    state.config.branch = dom.branchInput.value.trim();
    renderFromCachedCounts();
  });

  dom.subpathInput.addEventListener('change', () => {
    state.config.subpath = dom.subpathInput.value.trim();
    renderFromCachedCounts();
  });

  dom.markdownBaseSelect.addEventListener('change', () => {
    state.config.markdownBase = dom.markdownBaseSelect.value;
    renderFromCachedCounts();
  });

  for (const btn of document.querySelectorAll('[data-option]')) {
    btn.addEventListener('click', () => {
      const opt = btn.dataset.option;
      const val = opt === 'windowWeeks' ? Number(btn.dataset.value) : btn.dataset.value;
      if (state.config[opt] === val) return;
      state.config[opt] = val;
      renderWorkbenchControls();
      if (opt === 'windowWeeks') {
        refreshDataAndRender();
      } else {
        renderFromCachedCounts();
      }
    });
  }

  for (const btn of document.querySelectorAll('[data-theme]')) {
    btn.addEventListener('click', () => {
      state.specimenTheme = btn.dataset.theme;
      renderWorkbenchControls();
      renderPreviews();
    });
  }

  dom.runLiveBtn.addEventListener('click', () => refreshDataAndRender({ forceLive: true }));
  dom.wbRefreshLiveBtn.addEventListener('click', () => refreshDataAndRender({ forceLive: true }));

  const doDownloadConfig = () => {
    triggerDownload('lynceus.json', `${JSON.stringify(state.config, null, 2)}\n`, 'application/json');
  };
  dom.downloadConfigBtn.addEventListener('click', doDownloadConfig);
  dom.panelDownloadConfigBtn.addEventListener('click', doDownloadConfig);

  dom.downloadSvgsBtn.addEventListener('click', () => {
    for (const s of state.svgs) {
      triggerDownload(s.filename, s.svg, 'image/svg+xml');
    }
  });

  dom.copyConfigBtn.addEventListener('click', () => copyWithFeedback(dom.copyConfigBtn, dom.codeWellConfig.textContent));
  dom.copyMarkdownBtn.addEventListener('click', () => copyWithFeedback(dom.copyMarkdownBtn, dom.codeWellMarkdown.textContent));
  dom.copyCountsBtn.addEventListener('click', () => copyWithFeedback(dom.copyCountsBtn, dom.codeWellCounts.textContent));
  dom.copyScheduleBtn.addEventListener('click', () => copyWithFeedback(dom.copyScheduleBtn, dom.codeWellScheduleSnippet.textContent));

  dom.downloadScheduleBtn.addEventListener('click', () => {
    if (!state.scheduleResult) return;
    triggerDownload(state.scheduleResult.filename, state.scheduleResult.snippet, 'text/plain');
  });

  for (const btn of dom.tabButtons) {
    btn.addEventListener('click', () => {
      const tab = btn.id.replace('tab-btn-', '');
      switchTab(tab);
    });
  }

  dom.scheduleTargetSelect.addEventListener('change', () => {
    state.scheduleError = '';
    renderScheduleTab();
  });

  dom.scheduleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.config.agents.length === 0 || state.mode !== 'local') return;
    const target = dom.scheduleTargetSelect.value;
    try {
      const res = await apiPost('/api/schedule', {
        target,
        config: state.config,
        scriptPath: dom.scheduleScriptPath.value,
        taskName: dom.scheduleTaskName.value,
        repoDir: dom.scheduleRepoDir.value,
        toolRef: dom.scheduleToolRef.value,
        packagePin: dom.schedulePackagePin.value
      });
      state.scheduleError = '';
      state.scheduleResult = res;
    } catch (err) {
      applyScopedError(state, 'schedule', err.message);
    }
    renderScheduleTab();
  });

  // Boot flow
  async function boot() {
    if (state.mode === 'local') {
      try {
        const [statusRes, cfgRes] = await Promise.all([
          apiPost('/api/status', {}),
          apiPost('/api/config', {})
        ]);
        state.authPresent = Boolean(statusRes.authPresent);
        state.authSource = statusRes.authSource ?? null;
        if (cfgRes.hasConfig && cfgRes.config) {
          state.config = cloneConfig(cfgRes.config);
        }
      } catch (err) {
        state.fatalError = err.message;
      }
      if (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform ?? '')) {
        dom.scheduleTargetSelect.value = 'task-scheduler';
      } else {
        dom.scheduleTargetSelect.value = 'cron';
      }
    }

    renderStatusChrome();
    renderConfigureInputs();
    renderDiscoverRoster();
    renderSelectedAgents();
    renderWorkbenchControls();
    await refreshDataAndRender();
  }

  boot();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  initApp();
}

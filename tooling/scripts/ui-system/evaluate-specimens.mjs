#!/usr/bin/env node
/**
 * evaluate-specimens.mjs — runtime probe for Peers UI contract specimens.
 *
 * Bound contract: docs/.../contract-review/model.md names the missing layer:
 * scenarios had no operation/oracle/finalizer and probeRef was NOT_BOUND. This
 * runner is that probe. It drives the REAL public components in the Portal
 * specimen and writes evidence bound to source digests.
 *
 * Hard rules (post independent review):
 *  - Gates (overflow, console) and the foundation baseline participate in the
 *    rollup AND the process exit code. A gate failure is never a silent pass.
 *  - Each scenario gets a FRESH page (no cross-scenario state leakage).
 *  - Selectors used for a scalar assertion must match exactly one node; an
 *    ambiguous or empty match is ERROR, not a pass. Empty `contains` is rejected.
 *  - Evidence binds digests of the suite, contract, specimen and component
 *    sources; a service identity probe records what page actually answered.
 *  - Verdicts: OBSERVED | VIOLATED | UNPROVEN | ERROR. Never UX_PASS. Product
 *    outcomes stay UNPROVEN (specimens use local owner mocks).
 *
 * Usage:
 *   node evaluate-specimens.mjs --suite <suite.json|bundle.json> [--suite ...]
 *                               [--baseline-foundation]
 *                               [--base http://127.0.0.1:3291] [--out <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runCraftBattery } from './craft-battery.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const requireFromRoot = createRequire(path.join(repoRoot, 'package.json'));

// Sources whose identity every evidence run binds, in addition to each suite's
// own specRef/implementationRefs. Change any of these and prior evidence is
// visibly stale (digest mismatch against a re-run).
const COMMON_INPUTS = [
  'packages/ui/web/src/actions.tsx',
  'packages/ui/web/src/overlays.tsx',
  'packages/ui/web/src/styles.css',
  'packages/ui/web/src/expression.css',
  'packages/ui/semantics/src/index.ts',
  'packages/ui/contracts/src/index.ts',
  'packages/ui/tokens/src/north-star-theme.ts',
  'packages/prototypes/shared/ui-system/registry.ts',
  'packages/prototypes/shared/ui-system/SpecimenBoard.tsx',
];

const VIEWPORT = { width: 1360, height: 1000 };

function parseArgs(argv) {
  const args = { suites: [], base: process.env.UI_SPECIMEN_BASE || 'http://127.0.0.1:3291', out: null, baselineFoundation: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--suite') args.suites.push(argv[++i]);
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--baseline-foundation') args.baselineFoundation = true;
  }
  return args;
}

async function resolvePlaywright() {
  try { return requireFromRoot('@playwright/test').chromium; } catch { /* not hoisted */ }
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
  const dir = fs.readdirSync(pnpmDir).find(d => /^playwright@[\d.]/.test(d));
  if (!dir) throw new Error('PLAYWRIGHT_NOT_FOUND');
  return (await import(pathToFileURL(path.join(pnpmDir, dir, 'node_modules', 'playwright', 'index.mjs')).href)).chromium;
}

function sha256File(rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')}`;
}
function sha256Text(text) {
  return `sha256:${crypto.createHash('sha256').update(text).digest('hex')}`;
}

function sourceIdentity() {
  const git = args0 => execFileSync('git', args0, { cwd: repoRoot, encoding: 'utf8' }).trim();
  let workspaceDigest = null, branch = null;
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const snap = JSON.parse(execFileSync('node', ['tooling/scripts/local-dev/workflow-snapshot.mjs'], { cwd: repoRoot, encoding: 'utf8' }));
    workspaceDigest = snap.worktrees?.find(w => path.resolve(w.canonicalRoot) === repoRoot)?.source?.workspaceDigest ?? null;
  } catch { /* advisory */ }
  return { repoRoot, branch, commit: git(['rev-parse', 'HEAD']), workspaceDigest };
}

async function openFreshPage(browser, base, url) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  await page.goto(`${base}${url}`, { waitUntil: 'networkidle' });
  const fsBtn = page.getByRole('button', { name: /全屏|Exit fullscreen|退出全屏/ });
  let fullscreen = false;
  if (await fsBtn.count()) { await fsBtn.first().click(); await page.waitForTimeout(120); fullscreen = true; }
  return { page, consoleErrors, fullscreen };
}

async function serviceProbe(page, base, anchor, branch) {
  return page.evaluate(({ anchor, branch }) => {
    const root = document.querySelector(anchor);
    const bodyText = document.body.innerText || '';
    return {
      requestedBase: null, // filled by caller
      href: location.href,
      title: document.title,
      anchorPresent: !!root,
      // Portal chrome renders the active worktree/branch name; require the
      // git branch of the evidence run to appear, otherwise identity is weak.
      branchMentioned: branch ? bodyText.includes(branch) : null,
      viteClientPresent: !!document.querySelector('script[src*="@vite/client"]'),
    };
  }, { anchor, branch }).then(r => ({ ...r, requestedBase: base }));
}

/* ---------- operations ---------- */

// 1x1 green PNG so setFiles can stage a real decodable image attachment.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPIW1HxHwAFpAKO4RD0GQAAAABJRU5ErkJggg==',
  'base64');

function filePayload(file) {
  if (file.kind === 'png' || file.mime?.startsWith('image/')) {
    return { name: file.name, mimeType: file.mime ?? 'image/png', buffer: PNG_1X1 };
  }
  if (file.kind === 'large') {
    return { name: file.name, mimeType: file.mime ?? 'application/octet-stream', buffer: Buffer.alloc(file.size ?? 9 * 1024 * 1024) };
  }
  const text = file.text ?? `${file.name}\nlocal draft`;
  return { name: file.name, mimeType: file.mime ?? 'text/plain', buffer: Buffer.from(text) };
}

async function resolveOne(page, anchor, target, { scope } = {}) {
  const base = scope === 'global' ? page : page.locator(anchor);
  const loc = target ? base.locator(target) : base;
  const count = await loc.count();
  if (count === 0) throw new Error(`SELECTOR_NO_MATCH: ${target ?? anchor}`);
  if (count > 1) throw new Error(`SELECTOR_AMBIGUOUS(${count}): ${target ?? anchor}`);
  return loc.first();
}

async function runOperation(page, anchor, op) {
  const scope = op.scope === 'global' ? page : page.locator(anchor);
  const target = op.target ? scope.locator(op.target).first() : scope.first();
  switch (op.op) {
    case 'click': await target.click(); break;
    case 'clickGlobal': await page.locator(op.target).first().click(); break;
    case 'focus': await target.evaluate(node => node.focus({ focusVisible: true })); break;
    case 'hover': await target.hover(); break;
    case 'press': await page.keyboard.press(op.key); break;
    case 'type': await target.fill(op.value); break;
    case 'setFiles': {
      const input = scope.locator(op.target).first();
      await input.setInputFiles((op.files ?? []).map(filePayload));
      break;
    }
    case 'wait': await page.waitForTimeout(op.ms ?? 150); break;
    case 'waitFor': await target.waitFor({ state: op.state ?? 'visible', timeout: op.timeout ?? 4000 }); break;
    default: throw new Error(`UNKNOWN_OPERATION: ${op.op}`);
  }
}

/* ---------- oracles ---------- */

async function checkOracle(page, anchor, oracle) {
  const scope = oracle.scope === 'global' ? page : page.locator(anchor);
  // Scalar oracles demand a unique node unless explicitly aggregate.
  const aggregate = oracle.type === 'count' || oracle.type === 'exists' || oracle.type === 'missing'
    || oracle.type === 'computedStyleNone';
  const loc = oracle.target ? scope.locator(oracle.target) : scope;
  if (('contains' in oracle) && oracle.contains === '') throw new Error('EMPTY_CONTAINS_NOT_ALLOWED');
  const one = async () => {
    const n = await loc.count();
    if (n === 0) throw new Error(`SELECTOR_NO_MATCH: ${oracle.target}`);
    if (!aggregate && n > 1) throw new Error(`SELECTOR_AMBIGUOUS(${n}): ${oracle.target}`);
    return loc.first();
  };
  // textContent (not innerText) is immune to CSS text-transform, which turns
  // "Draft" into "DRAFT" and would make a semantic label check falsely fail.
  const textOf = async node => (await node.textContent() ?? '').replace(/\s+/g, ' ').trim();

  switch (oracle.type) {
    case 'exists': return await loc.count() > 0;
    case 'missing': return await loc.count() === 0;
    case 'visible': return await (await one()).isVisible();
    case 'disabled': { const el = await one(); return (await el.isDisabled()) || (await el.getAttribute('aria-disabled')) === 'true'; }
    case 'enabled': { const el = await one(); return !(await el.isDisabled()) && (await el.getAttribute('aria-disabled')) !== 'true'; }
    case 'nativeDisabledAbsent': { const el = await one(); return (await el.getAttribute('disabled')) === null; }
    case 'focusable': return await (await one()).evaluate(node => {
      node.focus({ focusVisible: true });
      return document.activeElement === node;
    });
    case 'textContains': return (await textOf(await one())).includes(oracle.contains);
    case 'textEquals': return (await textOf(await one())) === oracle.equals;
    case 'attr': {
      const v = await (await one()).getAttribute(oracle.attr);
      return oracle.equals !== undefined ? v === oracle.equals : (v ?? '').includes(oracle.contains ?? '');
    }
    case 'attrAbsent': return (await (await one()).getAttribute(oracle.attr)) === null;
    case 'describedByText': return await (await one()).evaluate((node, want) => {
      const ids = (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      const text = ids.map(id => document.getElementById(id)?.textContent ?? '').join(' ');
      return text.includes(want);
    }, oracle.contains);
    case 'ariaPressed': return (await (await one()).getAttribute('aria-pressed')) === String(oracle.equals);
    case 'count': {
      const n = await loc.count();
      return oracle.gte !== undefined ? n >= oracle.gte : n === oracle.equals;
    }
    case 'focusVisible': return await (await one()).evaluate(node =>
      node.matches(':focus-visible') && getComputedStyle(node).outlineWidth !== '0px');
    case 'roundedSquareAll': return await loc.evaluateAll(nodes => {
      const list = [...nodes];
      if (!list.length) return { pass: false, offenders: ['NO_NODES'] };
      const offenders = [];
      for (const node of list) {
        const rx = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
        const half = Math.min(node.clientWidth, node.clientHeight) / 2;
        if (!(rx < half - 0.5)) offenders.push(`${node.className} r=${rx} half=${half}`);
      }
      return { pass: offenders.length === 0, checked: list.length, offenders };
    });
    case 'widthStableOnActivate': {
      const node = await one();
      const before = await node.boundingBox();
      await node.click();
      await page.waitForTimeout(oracle.afterMs ?? 400);
      const during = await node.boundingBox();
      return { pass: Math.abs((before?.width ?? 0) - (during?.width ?? 0)) <= 1,
        before: before?.width, during: during?.width };
    }
    case 'paintedFromToken':
      // Each row tagged data-token-role paints a child from that exact CSS
      // variable; the painted computed value must equal the resolved token. A
      // copied hex that drifts from the token fails here.
      return page.evaluate(({ anchor, target }) => {
        const scope = document.querySelector(anchor);
        if (!scope) return { pass: false, offenders: ['ANCHOR_MISSING'] };
        // Resolve the token through a probe so painted and expected values use
        // the same computed-value normalization (rgb(), px), never raw hex.
        const probe = document.createElement('span');
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        scope.appendChild(probe);
        const offenders = [];
        const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/^0(px)?$/, '0px');
        scope.querySelectorAll(target).forEach(row => {
          const token = row.dataset.tokenRole;
          if (!token) return;
          const paint = row.querySelector('.bk-swatch-chip, .bk-radius-demo, .bk-shadow-demo, .bk-space-bar, .bk-control-bar');
          if (!paint) { offenders.push(`${token}: no painted element`); return; }
          const cs = getComputedStyle(paint);
          let painted;
          const isGradient = row.dataset.gradient === '1';
          if (isGradient) { probe.style.backgroundImage = `var(${token})`; painted = cs.backgroundImage; }
          else if (paint.classList.contains('bk-swatch-chip')) { probe.style.background = `var(${token})`; painted = cs.backgroundColor; }
          else if (paint.classList.contains('bk-radius-demo')) { probe.style.borderRadius = `var(${token})`; painted = cs.borderTopLeftRadius; }
          else if (paint.classList.contains('bk-shadow-demo')) { probe.style.boxShadow = `var(${token})`; painted = cs.boxShadow; }
          else if (paint.classList.contains('bk-space-bar')) { probe.style.width = `var(${token})`; painted = cs.width; }
          else { probe.style.height = `var(${token})`; painted = cs.height; }
          const prop = isGradient ? 'backgroundImage'
            : paint.classList.contains('bk-swatch-chip') ? 'backgroundColor'
            : paint.classList.contains('bk-radius-demo') ? 'borderRadius'
            : paint.classList.contains('bk-shadow-demo') ? 'boxShadow'
            : paint.classList.contains('bk-space-bar') ? 'width' : 'height';
          const expected = getComputedStyle(probe)[prop];
          if (norm(painted) !== norm(expected)) offenders.push(`${token}: painted(${norm(painted)}) != token(${norm(expected)})`);
        });
        probe.remove();
        return { pass: offenders.length === 0, offenders: offenders.slice(0, 12) };
      }, { anchor, target: oracle.target });
    case 'resolvedText': {
      const node = await one();
      const text = ((await node.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      return oracle.equals !== undefined ? text === oracle.equals : text.includes(oracle.contains ?? '');
    }
    case 'overflow': return page.evaluate(sel => {
      const root = document.querySelector(sel);
      if (!root) return { pass: false, offenders: ['ANCHOR_MISSING'] };
      const intentionalTruncation = node => {
        const cs = getComputedStyle(node);
        return cs.whiteSpace === 'nowrap' && (cs.textOverflow === 'ellipsis' || cs.textOverflow === 'clip')
          && (cs.overflowX === 'hidden' || cs.overflowX === 'clip')
          && (node.hasAttribute('title') || node.hasAttribute('aria-label'));
      };
      const offenders = [];
      root.querySelectorAll('*').forEach(node => {
        if (!(node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1)) return;
        // Screen-reader-only nodes are intentionally clipped to 1px; their
        // overflow is the accessibility technique, not a layout defect.
        if (node.classList.contains('pt-sr-only')) return;
        if (intentionalTruncation(node)) return;
        const cs = getComputedStyle(node);
        const clips = ['hidden', 'clip', 'auto', 'scroll'].includes(cs.overflowX);
        if (clips) offenders.push(`${String(node.className).slice(0, 40)} ${node.scrollWidth}>${node.clientWidth}`);
      });
      const pageOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      return { pass: offenders.length === 0 && !pageOverflow, offenders: offenders.slice(0, 8) };
    }, anchor);
    case 'computedStyle': {
      // Physics gate (token-physics): the node must actually be PAINTED with
      // the asserted resolved CSS value. Whitespace-normalized so rgb/spacing
      // differences across engines do not cause a false mismatch. `all` asserts
      // every matched node resolves identically (e.g. every checkbox accent).
      const norm = s => String(s).replace(/\s+/g, '');
      if (oracle.all) {
        const values = await loc.evaluateAll((nodes, prop) =>
          nodes.map(n => String(getComputedStyle(n)[prop] ?? '')), oracle.prop);
        const offenders = [];
        values.forEach((value, i) => {
          const ok = oracle.equals !== undefined ? norm(value) === norm(oracle.equals)
            : norm(value).includes(norm(oracle.contains));
          if (!ok) offenders.push(`${i}:${value}`);
        });
        return { pass: values.length > 0 && offenders.length === 0, checked: values.length, offenders: offenders.slice(0, 8) };
      }
      const node = await one();
      const value = await node.evaluate((el, prop) => getComputedStyle(el)[prop] ?? '', oracle.prop);
      if (oracle.equals !== undefined) return norm(value) === norm(oracle.equals);
      if (oracle.contains) return norm(value).includes(norm(oracle.contains));
      throw new Error('computedStyle requires equals or contains');
    }
    case 'computedStyleNone': {
      // Physics gate: no node under target may carry any banned substring in
      // the listed resolved CSS properties. Used to prove a retired brand hue
      // (e.g. SaaS purple) has no residual paint, not merely that a token file
      // changed. Banned strings are whitespace-insensitive channel tuples.
      const root = await one();
      const props = oracle.props ?? [];
      const banned = (oracle.banned ?? []).map(b => b.replace(/\s+/g, ''));
      return root.evaluate((el, { props, banned }) => {
        const offenders = [];
        for (const node of [el, ...el.querySelectorAll('*')]) {
          const cs = getComputedStyle(node);
          for (const prop of props) {
            const value = String(cs[prop] ?? '').replace(/\s+/g, '');
            for (const bad of banned) if (value.includes(bad)) offenders.push(`${node.className}.${prop}=${value}`);
          }
        }
        return { pass: offenders.length === 0, offenders: [...new Set(offenders)].slice(0, 8) };
      }, { props, banned });
    }
    case 'craftBattery': {
      // Craft geometry gate: native-control leakage, intrinsic compact-control
      // geometry, corner composition, frame containment and hit targets.
      const result = await runCraftBattery(page, oracle.root || anchor);
      return result;
    }
    default: throw new Error(`UNKNOWN_ORACLE: ${oracle.type}`);
  }
}

/* ---------- scenario execution ---------- */

async function evaluateScenario(browser, base, suite, scenario, shotDir) {
  const oracleResults = [];
  let status = 'OBSERVED';
  let error = null;
  const { page, consoleErrors } = await openFreshPage(browser, base, suite.specimen.url);
  try {
    await page.locator(suite.specimen.anchor).scrollIntoViewIfNeeded().catch(() => {});
    for (const op of scenario.operations ?? []) {
      if (op.op === 'expect') {
        const observed = await checkOracle(page, suite.specimen.anchor, op.oracle);
        const value = observed?.pass ?? observed;
        oracleResults.push({ id: op.id, observed: value === true || value?.pass === true,
          detail: observed?.offenders ? JSON.stringify(observed.offenders) : '', at: 'mid-operation' });
        if (!(value === true || value?.pass === true)) status = 'VIOLATED';
      } else {
        await runOperation(page, suite.specimen.anchor, op);
      }
    }
    for (const oracle of scenario.oracles ?? []) {
      let observed;
      try { observed = await checkOracle(page, suite.specimen.anchor, oracle); }
      catch (e) { observed = false; status = 'ERROR'; oracleResults.push({ id: oracle.id ?? oracle.type, observed: false, detail: String(e?.message ?? e) }); continue; }
      const pass = observed === true || observed?.pass === true;
      oracleResults.push({ id: oracle.id ?? oracle.type, observed: pass,
        detail: observed?.offenders ? JSON.stringify(observed.offenders)
          : observed?.before !== undefined ? `width ${observed.before}->${observed.during}` : '' });
      if (!pass && status === 'OBSERVED') status = 'VIOLATED';
    }
    for (const shot of scenario.screenshots ?? []) {
      const target = shot.target ? page.locator(shot.target).first() : page.locator(suite.specimen.anchor).first();
      await target.evaluate(node => {
        let cur = node.parentElement;
        while (cur) { cur.scrollLeft = 0; cur = cur.parentElement; }
        node.scrollIntoView({ block: 'start', inline: 'nearest' });
      });
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(shotDir, shot.file) });
    }
  } catch (e) {
    status = 'ERROR';
    error = String(e?.message ?? e);
  } finally {
    // Finalizers run on a page that is about to close; a failure here means the
    // reversible-action contract itself is suspect, so it is reported, not swallowed.
    const finalizerErrors = [];
    for (const fin of scenario.finalizers ?? []) {
      try { await runOperation(page, suite.specimen.anchor, fin); }
      catch (e) { finalizerErrors.push(String(e?.message ?? e)); }
    }
    if (finalizerErrors.length) { error = [error, `FINALIZER: ${finalizerErrors.join('; ')}`].filter(Boolean).join(' | '); if (status === 'OBSERVED') status = 'ERROR'; }
    await page.close();
  }
  return { id: scenario.id, title: scenario.title, level: scenario.level ?? 'L3_DYNAMIC',
    productOutcome: scenario.productOutcome ?? 'UNPROVEN', status, error, oracleResults, consoleErrors };
}

/* ---------- suite / gates ---------- */

function digestSuite(suite, suiteRef, raw) {
  const inputs = {};
  const add = rel => { if (rel && fs.existsSync(path.join(repoRoot, rel))) inputs[rel] = sha256File(rel); };
  add(suite.specRef);
  (suite.specimen?.implementationRefs ?? []).forEach(add);
  (suite.evidenceInputs ?? []).forEach(add);
  COMMON_INPUTS.forEach(add);
  return { suiteRef, suiteDigest: sha256Text(raw), specRef: suite.specRef ?? null, inputs };
}

async function overflowGate(browser, base, suite) {
  const gates = {};
  for (const [name, width] of [['desktop', 1360], ['narrow', 390]]) {
    const { page, consoleErrors } = await openFreshPage(browser, base, suite.specimen.url);
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.locator(suite.specimen.anchor).scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(120);
      const r = await checkOracle(page, suite.specimen.anchor, { type: 'overflow' });
      gates[name] = { pass: r.pass, offenders: r.offenders, consoleErrors: [...new Set(consoleErrors)].slice(0, 10) };
    } finally { await page.close(); }
  }
  return gates;
}

async function entryGate(context, base, gate) {
  // Reach the view from a plain landing URL through the visible view bar,
  // proving a real in-page entry exists (no deep link).
  const { page, consoleErrors } = await openFreshPage(context, base, gate.url);
  let status = 'OBSERVED';
  const oracleResults = [];
  let error = null;
  try {
    const barButton = page.locator(gate.button).first();
    await barButton.waitFor({ state: 'visible', timeout: 4000 });
    await barButton.click();
    await page.waitForTimeout(300);
    const reached = await page.locator(gate.target).first().isVisible().catch(() => false);
    const urlOk = gate.urlParam ? new URL(page.url()).searchParams.get('eles') === gate.urlParam : true;
    oracleResults.push({ id: 'entry-target-visible', observed: reached });
    oracleResults.push({ id: 'entry-url-param', observed: urlOk });
    if (!reached || !urlOk) status = 'VIOLATED';
  } catch (e) { status = 'ERROR'; error = String(e?.message ?? e); }
  finally { await page.close(); }
  return { id: 'ui.entry.reachable-from-nav', title: '默认落地页经可见入口可达该视图', level: 'L3_DYNAMIC',
    productOutcome: 'UNPROVEN', status, error, oracleResults, consoleErrors };
}

async function runSuite(browser, base, suite, suiteRef, raw, outDir) {
  const shotDir = path.join(outDir, suite.capabilityId.replace(/\./g, '-'));
  fs.mkdirSync(shotDir, { recursive: true });
  const scenarios = [];
  const consoleErrorsAll = new Set();
  if (suite.entryGate) {
    const gateResult = await entryGate(browser, base, suite.entryGate);
    gateResult.consoleErrors.forEach(e => consoleErrorsAll.add(e));
    scenarios.push(gateResult);
  }
  for (const scenario of suite.scenarios) {
    const result = await evaluateScenario(browser, base, suite, scenario, shotDir);
    result.consoleErrors.forEach(e => consoleErrorsAll.add(e));
    scenarios.push(result);
  }
  const gates = await overflowGate(browser, base, suite);
  const { page: probePage } = await openFreshPage(browser, base, suite.specimen.url);
  let service;
  try { service = await serviceProbe(probePage, base, suite.specimen.anchor, sourceIdentityCached.branch); }
  finally { await probePage.close(); }

  const gateFailures = [];
  for (const [name, g] of Object.entries(gates)) {
    if (!g.pass) gateFailures.push({ gate: `overflow.${name}`, offenders: g.offenders });
    if (g.consoleErrors?.length) gateFailures.push({ gate: `console.${name}`, errors: g.consoleErrors });
  }
  if (consoleErrorsAll.size) gateFailures.push({ gate: 'console.scenario', errors: [...consoleErrorsAll].slice(0, 10) });
  if (!service.anchorPresent) gateFailures.push({ gate: 'service.anchor' });
  // Branch identity is recorded every run; only fail closed when the caller
  // explicitly requires the Portal page to prove its worktree identity.
  if (process.env.UI_SPECIMEN_REQUIRE_BRANCH === '1' && service.branchMentioned === false)
    gateFailures.push({ gate: 'service.branch-identity', reason: 'Portal page did not mention the evidence git branch' });

  const scenarioFailed = scenarios.some(s => s.status === 'VIOLATED' || s.status === 'ERROR');
  return {
    kind: 'peers-ui-specimen-evidence',
    capabilityId: suite.capabilityId,
    ...digestSuite(suite, suiteRef, raw),
    specimen: suite.specimen,
    runAt: new Date().toISOString(),
    service,
    scenarios,
    gates,
    gateFailures,
    rollup: scenarioFailed || gateFailures.length ? 'VIOLATED' : 'OBSERVED',
    claimScope: 'CONTROL_CONTRACT_OBSERVABLE_ONLY',
    craftAcceptance: 'NOT_AUTO_EVALUATED',
    productOutcomes: 'UNPROVEN',
    screenshotDir: path.relative(repoRoot, shotDir),
  };
}

/* ---------- specimen baseline ---------- */

async function runFoundationBaseline(browser, base, outDir) {
  // Vetted component specimens on the 样本 tab; overflow-checked in every
  // shared condition (标准 / 长文案 / 禁用). Anchors are data-specimen cards.
  const url = '/?site=frontend-eles&eles=specimens';
  const observations = [];
  const allErrors = new Set();
  for (const condition of ['标准', '长文案', '禁用']) {
    const { page, consoleErrors } = await openFreshPage(browser, base, url);
    try {
      await page.getByRole('button', { name: condition, exact: true }).first().click();
      await page.waitForTimeout(200);
      const anchors = await page.locator('[data-specimen]').evaluateAll(nodes =>
        nodes.map(n => n.getAttribute('data-specimen')));
      for (const key of anchors) {
        const anchor = `[data-specimen="${key}"]`;
        await page.locator(anchor).scrollIntoViewIfNeeded();
        const r = await checkOracle(page, anchor, { type: 'overflow' });
        observations.push({ key, condition, status: r.pass ? 'OBSERVED' : 'VIOLATED', offenders: r.offenders });
      }
      consoleErrors.forEach(e => allErrors.add(e));
    } finally { await page.close(); }
  }
  const violated = observations.filter(r => r.status !== 'OBSERVED');
  const gateFailures = violated.map(v => ({ gate: `${v.key}.${v.condition}`, offenders: v.offenders, reason: v.reason }));
  if (allErrors.size) gateFailures.push({ gate: 'console', errors: [...allErrors].slice(0, 10) });
  return {
    kind: 'peers-ui-specimen-baseline-evidence',
    runAt: new Date().toISOString(),
    capabilities: new Set(observations.map(o => o.key)).size,
    observations,
    gates: { consoleClean: allErrors.size === 0 },
    rollup: gateFailures.length ? 'VIOLATED' : 'OBSERVED',
    gateFailures,
    deepOracles: 'BOUND in per-capability suites; product Journey outcomes UNPROVEN',
    craftAcceptance: 'NOT_AUTO_EVALUATED',
  };
}

function loadSuites(suitePath) {
  const abs = path.resolve(suitePath);
  const raw = fs.readFileSync(abs, 'utf8');
  const parsed = JSON.parse(raw);
  const rel = path.relative(repoRoot, abs);
  if (Array.isArray(parsed)) return parsed.map(s => ({ suite: s, ref: rel, raw }));
  if (parsed.kind === 'peers-ui-specimen-suite-bundle')
    return parsed.suites.map(s => ({ suite: s, ref: `${rel}#${s.capabilityId}`, raw: JSON.stringify(s) }));
  return [{ suite: parsed, ref: rel, raw }];
}

let sourceIdentityCached;
async function main() {
  const args = parseArgs(process.argv);
  if (!args.suites.length && !args.baselineFoundation) throw new Error('at least one --suite or --baseline-foundation required');
  const chromium = await resolvePlaywright();
  sourceIdentityCached = sourceIdentity();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workspaceId = sourceIdentityCached.workspaceDigest?.split(':')[1]?.slice(0, 16) ?? 'local';
  const outDir = args.out ?? path.join(os.homedir(), '.peers-touch', 'dev', 'workspaces', workspaceId, 'evidence', 'ui-specimens', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  const evidence = { kind: 'peers-ui-specimen-evaluation-run', source: sourceIdentityCached, runAt: new Date().toISOString(), reports: [] };

  // Fake media devices let voice-recorder scenarios drive the real
  // getUserMedia/MediaRecorder path without a physical microphone; autoplay
  // is relaxed so the recorded blob can play back during assertions.
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  // One context grants clipboard so CopyButton's real success path can run;
  // every scenario still gets its own fresh page for isolation.
  const context = await browser.newContext({
    ...VIEWPORT, deviceScaleFactor: 2,
    permissions: ['clipboard-read', 'clipboard-write', 'microphone'],
  });
  try {
    for (const suitePath of args.suites)
      for (const item of loadSuites(suitePath))
        evidence.reports.push(await runSuite(context, args.base, item.suite, item.ref, item.raw, outDir));
    if (args.baselineFoundation) evidence.reports.push(await runFoundationBaseline(context, args.base, outDir));
  } finally {
    await context.close();
    await browser.close();
  }

  const failed = evidence.reports.filter(r => r.rollup === 'VIOLATED');
  evidence.rollup = failed.length ? 'VIOLATED' : 'OBSERVED';
  fs.writeFileSync(path.join(outDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
  // Stable current pointer, so consumers read "latest for this workspace" and
  // can compare its digests against current sources.
  const evidenceRoot = path.dirname(outDir);
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.writeFileSync(path.join(evidenceRoot, 'latest.json'), JSON.stringify(
    { outDir, runAt: evidence.runAt, commit: sourceIdentityCached.commit, rollup: evidence.rollup }, null, 2));

  console.log(JSON.stringify({ outDir, rollup: evidence.rollup, failedCapabilities: failed.map(r => r.capabilityId ?? 'foundation-baseline'),
    reports: evidence.reports.map(r => ({ capabilityId: r.capabilityId ?? 'foundation-baseline', rollup: r.rollup,
      scenarios: r.scenarios?.map(s => `${s.id}:${s.status}`) })) }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(error => { console.error(error); process.exit(2); });

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
    case 'longPress':
      // Touch surfaces open the long-press action sheet after a 420ms hold;
      // the mouse path shares the same pointer timer, so a real press-hold at
      // the element centre exercises the product gesture, not a synthetic call.
      await target.hover();
      await page.mouse.down();
      await page.waitForTimeout(op.holdMs ?? 520);
      await page.mouse.up();
      break;
    case 'press': await page.keyboard.press(op.key); break;
    case 'type': await target.fill(op.value); break;
    case 'setFiles': {
      const input = scope.locator(op.target).first();
      await input.setInputFiles((op.files ?? []).map(filePayload));
      break;
    }
    case 'scroll':
      // Programmatic scrollBy still dispatches a real scroll event, which is
      // what scroll-reactive UI (e.g. the dissolving feed-order chip) listens
      // for; behavior stays instant so timing assertions stay deterministic.
      await target.evaluate((el, op) => el.scrollTo({
        top: (op.top ?? (el.scrollTop + (op.deltaY ?? 0))),
        behavior: 'instant',
      }), op);
      break;
    case 'viewport':
      await page.setViewportSize({ width: op.width, height: op.height ?? 900 });
      await page.waitForTimeout(op.settle ?? 120);
      break;
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
    case 'textNotContains': return !(await textOf(await one())).includes(oracle.contains);
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
    case 'containedIn': {
      // The target's painted box must stay within its owner's box (same scope).
      // Encodes the craft rule that an overlay affordance's visual extent
      // belongs inside its owner tile (no negative-offset bleed past an edge).
      const child = await one();
      const ownerLoc = oracle.owner ? scope.locator(oracle.owner) : scope;
      const ownerCount = await ownerLoc.count();
      if (ownerCount === 0) return { pass: false, offenders: ['OWNER_NO_MATCH'] };
      const [cBox, oBox] = await Promise.all([child.boundingBox(), ownerLoc.first().boundingBox()]);
      const tol = oracle.tolerance ?? 0;
      const offenders = [];
      if (!cBox) offenders.push('child has no rect');
      if (!oBox) offenders.push('owner has no rect');
      if (cBox && oBox) {
        if (cBox.x < oBox.x - tol) offenders.push(`left ${Math.round(cBox.x)} < ${Math.round(oBox.x)}`);
        if (cBox.y < oBox.y - tol) offenders.push(`top ${Math.round(cBox.y)} < ${Math.round(oBox.y)}`);
        if (cBox.x + cBox.width > oBox.x + oBox.width + tol) offenders.push('bleeds past owner right edge');
        if (cBox.y + cBox.height > oBox.y + oBox.height + tol) offenders.push('bleeds past owner bottom edge');
      }
      return { pass: offenders.length === 0, offenders };
    }
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
    case 'scrollTop': {
      const el = await one();
      const top = await el.evaluate(node => node.scrollTop);
      return oracle.lte !== undefined ? top <= oracle.lte : top === oracle.equals;
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
    case 'anchoredTo': {
      // Owner-alignment gate for portaled overlays (e.g. rightBottom bell
      // panel): the overlay rectangle must sit on the required side of its
      // owner and share the required edge within a pixel tolerance. Guards
      // against the panel flipping into a visually detached position.
      const overlay = await one();
      const owner = await resolveOne(page, null, oracle.owner, { scope: 'global' });
      const box = b => b ? { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height } : null;
      const [ovRect, owRect] = await Promise.all([overlay.boundingBox(), owner.boundingBox()]);
      const ov = box(ovRect), ow = box(owRect);
      const tol = oracle.tolerance ?? 6;
      const offenders = [];
      if (!ov) offenders.push('overlay has no rect');
      if (!ow) offenders.push('owner has no rect');
      if (ov && ow) {
        if (oracle.side === 'right' && !(ov.left >= ow.right - tol)) {
          offenders.push(`overlay.left ${Math.round(ov.left)} is not right of owner.right ${Math.round(ow.right)}`);
        }
        if (oracle.side === 'left' && !(ov.right <= ow.left + tol)) {
          offenders.push(`overlay.right ${Math.round(ov.right)} is not left of owner.left ${Math.round(ow.left)}`);
        }
        if (oracle.align === 'bottom' && Math.abs(ov.bottom - ow.bottom) > tol) {
          offenders.push(`overlay.bottom ${Math.round(ov.bottom)} != owner.bottom ${Math.round(ow.bottom)}`);
        }
        if (oracle.align === 'top' && Math.abs(ov.top - ow.top) > tol) {
          offenders.push(`overlay.top ${Math.round(ov.top)} != owner.top ${Math.round(ow.top)}`);
        }
      }
      return {
        pass: offenders.length === 0,
        offenders,
        overlay: ov ? { left: Math.round(ov.left), bottom: Math.round(ov.bottom) } : null,
        owner: ow ? { right: Math.round(ow.right), bottom: Math.round(ow.bottom) } : null,
      };
    }
    case 'edgesAlign': {
      // Two independent elements must share one edge coordinate (e.g. the
      // composer pill and the message stream starting on the same left line).
      // Optional signed `inset`: the target edge sits this many px INSIDE the
      // peer edge (right/bottom: peer - target; left/top: target - peer),
      // e.g. a floating overlay anchored just inside a card boundary instead
      // of sitting flush on the hairline.
      const peerBase = oracle.scope === 'global' ? page : scope;
      const [a, b] = await Promise.all([one(), peerBase.locator(oracle.peer).first()]);
      const [ra, rb] = await Promise.all([a.boundingBox(), b.boundingBox()]);
      const tol = oracle.tolerance ?? 1;
      const inset = oracle.inset ?? 0;
      if (!ra || !rb) return { pass: false, offenders: ['node has no rect'] };
      const edgeOf = (r, edge) => ({
        left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height,
      })[edge ?? 'top'];
      const edge = oracle.edge ?? 'top';
      const ea = edgeOf(ra, edge), eb = edgeOf(rb, edge);
      const gap = (edge === 'right' || edge === 'bottom') ? eb - ea : ea - eb;
      const drift = Math.abs(gap - inset);
      return {
        pass: drift <= tol,
        offenders: drift > tol ? [`${edge} inset ${Math.round(gap)}px ≠ ${inset}px`] : [],
      };
    }
    case 'sameWidth': {
      // Sibling-symmetry gate: the target and a peer must share an equal
      // width within tolerance (e.g. two tabs in a segmented control).
      const peerBase = oracle.scope === 'global' ? page : scope;
      const peer = peerBase.locator(oracle.peer).first();
      const [a, b] = await Promise.all([one(), peer]);
      const [ra, rb] = await Promise.all([a.boundingBox(), b.boundingBox()]);
      const tol = oracle.tolerance ?? 2;
      if (!ra || !rb) return { pass: false, offenders: ['node has no rect'] };
      const delta = Math.abs(ra.width - rb.width);
      return {
        pass: delta <= tol,
        offenders: delta > tol ? [`widths ${Math.round(ra.width)} vs ${Math.round(rb.width)} differ by ${Math.round(delta)}`] : [],
      };
    }
    case 'geometryStableAcross': {
      // Cross-state chrome gate: the named peers must keep the exact same
      // rectangle through every state-changing step (e.g. a scope tab switch
      // must not move a shared search/add slot). Peers may remount between
      // steps — they are re-resolved by selector each snapshot.
      const selectors = [oracle.target, ...(oracle.peers ?? [])];
      const tol = oracle.tolerance ?? 1;
      const norm = r => r
        ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
        : null;
      const snap = () => Promise.all(selectors.map(async sel =>
        norm(await page.locator(sel).first().boundingBox())));
      const baseline = await snap();
      const offenders = [];
      for (const step of oracle.steps ?? []) {
        await page.locator(step).first().click();
        await page.waitForTimeout(oracle.stepMs ?? 180);
        const next = await snap();
        next.forEach((rect, i) => {
          const base = baseline[i];
          if (!rect || !base) { offenders.push(`${selectors[i]}: missing rect`); return; }
          for (const key of ['x', 'y', 'width', 'height']) {
            if (Math.abs(rect[key] - base[key]) > tol) {
              offenders.push(`${selectors[i]}.${key} ${base[key]} -> ${rect[key]}`);
            }
          }
        });
      }
      return { pass: offenders.length === 0, baseline, offenders };
    }
    case 'placeholderFits': {
      // The field's placeholder must render WITHOUT truncation inside the
      // field content box (canvas text measurement against the actual
      // leading/trailing slots). A field collapsed to an icon tile is an
      // intentional "no placeholder" state and passes as collapsed.
      const node = await one();
      return node.evaluate(el => {
        const frame = el.closest('.pt-field-frame') ?? el;
        const ics = getComputedStyle(el);
        if (el.clientWidth <= 2 || parseFloat(ics.opacity) === 0) return { pass: true, collapsed: true };
        const placeholder = el.getAttribute('placeholder') ?? '';
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${ics.fontStyle} ${ics.fontWeight} ${ics.fontSize} ${ics.fontFamily}`;
        const textWidth = ctx.measureText(placeholder).width;
        const fcs = getComputedStyle(frame);
        let available = frame.clientWidth
          - parseFloat(fcs.paddingLeft) - parseFloat(fcs.paddingRight);
        const slots = [...frame.children].filter(child => child !== el);
        slots.forEach(child => { available -= child.getBoundingClientRect().width; });
        available -= Math.max(0, slots.length) * parseFloat(fcs.gap || fcs.columnGap || '0');
        const pass = textWidth <= available + 0.5;
        return { pass, placeholder, textWidth: Math.round(textWidth), available: Math.round(available) };
      });
    }
    case 'singleLine': {
      // Class-level anti-crush gate: the element's text must occupy exactly
      // one line and its border box must not exceed one line height. Catches
      // CJK tags/labels that wrap character-by-character when a flex column
      // squeezes them (scrollHeight alone cannot see it — the box grows with
      // the wrap). `scope: global` is honored by the caller's locator.
      const node = await one();
      return node.evaluate((el) => {
        const cs = getComputedStyle(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const lineRects = [...range.getClientRects()].filter(rect => rect.height > 0);
        const lineTops = new Set(lineRects.map(rect => Math.round(rect.top)));
        // Benchmark against the computed line box: a Range fragment rect
        // trims the half-leading (19px vs a 20.25px line box), so the
        // fragment height alone would false-fail single-line text. Fall back
        // to the measured fragment only when line-height is "normal".
        const computedLineHeight = parseFloat(cs.lineHeight);
        const lineBase = Number.isFinite(computedLineHeight) && computedLineHeight > 0
          ? computedLineHeight
          : Math.max(...lineRects.map(rect => rect.height), 0);
        const heightLimit = lineBase
          + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
          + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) + 1;
        const rect = el.getBoundingClientRect();
        return {
          pass: lineTops.size <= 1 && rect.height <= heightLimit,
          lines: lineTops.size,
          height: Math.round(rect.height),
          heightLimit: Math.round(heightLimit),
        };
      });
    }
    case 'hugsContent': {
      // Content-proportion gate for menus/selects: the floating surface must
      // be exactly max(anchor width, widest item width) — never an arbitrary
      // fixed floor that paints dead space beside short options. Item
      // intrinsic width is reconstructed from its children (the rendered row
      // is stretched to the menu, so its own clientWidth cannot be used).
      const popNode = await one();
      return popNode.evaluate((pop, spec) => {
        const q = sel => pop.ownerDocument.querySelector(sel);
        const anchor = q(spec.anchor);
        const items = [...pop.ownerDocument.querySelectorAll(spec.items)];
        if (!anchor || !items.length) return { pass: false, offenders: ['anchor or items missing'] };
        const itemIntrinsic = (item) => {
          const ics = getComputedStyle(item);
          const gap = parseFloat(ics.columnGap || ics.gap || '0');
          const kids = [...item.children].filter(c => c.getBoundingClientRect().width > 0);
          const content = kids.reduce((sum, kid) => sum + kid.getBoundingClientRect().width, 0)
            + gap * Math.max(0, kids.length - 1);
          return content + parseFloat(ics.paddingLeft) + parseFloat(ics.paddingRight);
        };
        // Popover border box = inner floor + its own horizontal padding.
        const pcs = getComputedStyle(pop);
        const popPad = parseFloat(pcs.paddingLeft) + parseFloat(pcs.paddingRight);
        const inner = Math.max(anchor.getBoundingClientRect().width, ...items.map(itemIntrinsic));
        const expected = inner + popPad;
        const borderBox = pop.getBoundingClientRect().width;
        const tol = spec.tolerance ?? 4;
        return {
          pass: Math.abs(borderBox - expected) <= tol,
          borderBox: Math.round(borderBox), expected: Math.round(expected),
          offenders: Math.abs(borderBox - expected) <= tol ? [] : [`menu ${Math.round(borderBox)}px vs content/anchor ${Math.round(expected)}px`],
        };
      }, { anchor: oracle.anchor, items: oracle.items, tolerance: oracle.tolerance });
    }
    case 'widthSweep': {
      // Continuous fluidity gate, not hand-picked breakpoints: resize the
      // viewport across every width in [from,to] by `step` and assert the
      // invariants hold at EVERY step — edge alignment between independent
      // elements, zero horizontal overflow of named scroll hosts, and
      // single-line text on every matched leaf. Adaptive layouts must be
      // correct for an arbitrary user window, not only at sampled widths.
      const from = oracle.from ?? 700;
      const to = oracle.to ?? 2880;
      const step = oracle.step ?? 24;
      const height = oracle.height ?? 900;
      const settleMs = oracle.settleMs ?? 60;
      const aligns = oracle.align ?? [];
      const overflowHosts = oracle.noOverflow ?? [];
      const singleLineSelectors = oracle.singleLine ?? [];
      const styles = oracle.computedStyles ?? [];
      const scrolls = oracle.scroll ?? [];
      const startSize = page.viewportSize();
      const offenders = [];

      try {
        for (let width = from; width <= to; width += step) {
          await page.setViewportSize({ width, height });
          await page.waitForTimeout(settleMs);
          for (const s of scrolls) {
            await page.locator(s.target).first().evaluate((el, top) => { el.scrollTop = top; }, s.top);
          }
          if (scrolls.length) await page.waitForTimeout(40);
          const result = await page.evaluate(({ aligns, overflowHosts, singleLineSelectors, styles }) => {
            const fails = [];
            const norm = s => String(s).replace(/\s+/g, '');
            const box = sel => document.querySelector(sel)?.getBoundingClientRect() ?? null;
            const isSingleLine = (el) => {
              const cs = getComputedStyle(el);
              const range = document.createRange();
              range.selectNodeContents(el);
              const rects = [...range.getClientRects()].filter(r => r.height > 0);
              const tops = new Set(rects.map(r => Math.round(r.top)));
              const lh = parseFloat(cs.lineHeight);
              const lineBase = Number.isFinite(lh) && lh > 0 ? lh : Math.max(...rects.map(r => r.height), 0);
              const limit = lineBase + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
                + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) + 1;
              return tops.size <= 1 && el.getBoundingClientRect().height <= limit;
            };
            for (const a of aligns) {
              const ra = box(a.target), rb = box(a.peer);
              if (!ra || !rb) { fails.push(`${a.target}|${a.peer}:missing`); continue; }
              const edgeName = a.edge ?? 'right';
              const edge = r => ({ left: r.x, right: r.x + r.width, top: r.y, bottom: r.y + r.height })[edgeName];
              // Optional inset: target edge sits this many px inside the peer
              // edge (right/bottom: peer - target; left/top: target - peer).
              const inset = a.inset ?? 0;
              const ea = edge(ra), eb = edge(rb);
              const gap = (edgeName === 'right' || edgeName === 'bottom') ? eb - ea : ea - eb;
              const delta = Math.abs(gap - inset);
              if (delta > (a.tolerance ?? 1)) fails.push(`${a.edge} ${a.target} vs ${a.peer}: inset ${Math.round(gap)}px ≠ ${inset}px`);
            }
            for (const sel of overflowHosts) {
              const el = document.querySelector(sel);
              if (el && el.scrollWidth - el.clientWidth > 1) fails.push(`overflow ${sel}: +${el.scrollWidth - el.clientWidth}px`);
            }
            for (const sel of singleLineSelectors) {
              const nodes = document.querySelectorAll(sel);
              if (!nodes.length) { fails.push(`${sel}:missing`); continue; }
              if (!Array.from(nodes).every(isSingleLine)) fails.push(`multiline ${sel} (${nodes.length})`);
            }
            for (const st of styles) {
              const el = document.querySelector(st.target);
              if (!el) { fails.push(`${st.target}:missing`); continue; }
              const value = norm(getComputedStyle(el)[st.prop] ?? '');
              if (value !== norm(st.equals)) fails.push(`${st.target}.${st.prop}=${value} expected ${st.equals}`);
            }
            return fails;
          }, { aligns, overflowHosts, singleLineSelectors, styles });
          for (const f of result) offenders.push(`w${width}: ${f}`);
          if (offenders.length >= 12) break;
        }
      } finally {
        if (startSize) await page.setViewportSize(startSize);
      }
      return { pass: offenders.length === 0, offenders };
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

  process.stdout.write(JSON.stringify({ outDir, rollup: evidence.rollup, failedCapabilities: failed.map(r => r.capabilityId ?? 'foundation-baseline'),
    reports: evidence.reports.map(r => ({ capabilityId: r.capabilityId ?? 'foundation-baseline', rollup: r.rollup,
      scenarios: r.scenarios?.map(s => `${s.id}:${s.status}`) })) }, null, 2) + '\n');
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(error => { console.error(error); process.exit(2); });

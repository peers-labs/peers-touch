import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runCli } from '../local-dev/dev-work.mjs';
import {
  SURFACE_LEDGER, readSurfaceLedger, surfaceSourceDigest, surfaceContext, verifySurfaceAuthority,
} from './ui-surface-authority.mjs';
import { uiSurfaceAuthorityPlugin } from './ui-surface-vite.mjs';
import { scan } from './primitive-layer-guard.mjs';

const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const { build, createServer } = await import(pathToFileURL(require.resolve('vite')));

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pt-ui-surface-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (relative, text) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), text);
  };
  const surface = {
    id: 'example-surface', prototypeId: 'example', contract: 'docs/example.md',
    component: 'Surface', package: '@example/ui', exportFile: 'packages/ui/example/index.ts',
    presentationRoots: ['packages/ui/example/surface/'],
    prototype: {
      adapter: 'packages/prototypes/example/Adapter.tsx', symbol: 'Adapter',
      entryChain: ['packages/prototypes/example/entry.ts', 'packages/prototypes/example/Adapter.tsx'],
      allowedSlotTags: [],
    },
    production: {
      adapter: 'apps/desktop/src/Adapter.tsx', symbol: 'Adapter',
      entryChain: ['apps/desktop/src/entry.ts', 'apps/desktop/src/Adapter.tsx'],
      allowedSlotTags: [],
    },
    protectedClasses: ['ptc-', 'legacy-example-'], status: 'confirmed', confirmation: null,
    feedback: {
      id: 'initial', revision: 1, request: 'Synthetic initial feedback',
      requestRef: 'fixture://initial', review: null,
    },
  };
  write('docs/example.md', '# Example');
  write('packages/ui/example/index.ts', "export { Surface } from './surface/Surface';");
  write('packages/ui/example/surface/Surface.tsx', "import './surface.css'; const React = { createElement: (...args) => args }; export function Surface() { return <span className=\"ptc-example\">approved</span>; }");
  write('packages/ui/example/surface/surface.css', '.ptc-example { border-radius: 18px; }');
  const adapter = "import { Surface } from '@example/ui'; const React = { createElement: (...args) => args }; export function Adapter() { return <Surface />; }";
  for (const host of [surface.prototype, surface.production]) {
    write(host.adapter, adapter);
    write(host.entryChain[0], "import { Adapter } from './Adapter'; console.log(Adapter());");
  }
  const save = () => write(SURFACE_LEDGER, `# Ledger\n\n\`\`\`json ui-surface-authority\n${JSON.stringify({ schemaVersion: 1, surfaces: [surface] })}\n\`\`\`\n`);
  const approveSynthetic = () => {
    surface.status = 'confirmed';
    surface.feedback.review = {
      sourceDigest: surfaceSourceDigest(root, surface),
      target: 'Synthetic test target', evidence: 'Synthetic review',
    };
    surface.confirmation = {
      by: 'user:synthetic', request: 'Synthetic test approval; never a real user confirmation.',
      evidence: 'Synthetic test fixture', sourceDigest: surfaceSourceDigest(root, surface),
      feedbackId: surface.feedback.id, prototypeId: surface.prototypeId,
    };
    save();
  };
  approveSynthetic();
  const vite = (production = true) => ({
    configFile: false, root, logLevel: 'silent',
    resolve: { alias: { '@example/ui': path.join(root, surface.exportFile) } },
    plugins: production ? [uiSurfaceAuthorityPlugin(root)] : [],
    server: { port: 0, host: '127.0.0.1', watch: { ignored: ['**/*'] } },
    build: { write: false, minify: false, rollupOptions: { input: path.join(root, surface.production.entryChain[0]) } },
  });
  return { root, surface, write, save, approveSynthetic, vite, adapter };
}

test('pre-edit maps production/shared/prototype paths and binds current confirmation', t => {
  const f = fixture(t);
  for (const [target, role] of [
    [f.surface.production.adapter, 'production-adapter'],
    [f.surface.prototype.adapter, 'prototype-adapter'],
    [f.surface.presentationRoots[0], 'shared-presentation'],
  ]) {
    const [context] = surfaceContext(f.root, [target]);
    assert.ok(context.roles.includes(role));
    assert.equal(context.productionAdmitted, true);
    assert.match(context.nextAction, /prototype.*user confirmation/);
  }
  f.write('packages/ui/example/surface/surface.css', '.ptc-example { border-radius: 30px; }');
  assert.equal(surfaceContext(f.root, [f.surface.production.adapter])[0].productionAdmitted, false);
});

test('real production Vite build accepts the confirmed shared surface', async t => {
  const f = fixture(t);
  assert.equal(verifySurfaceAuthority(f.root).length, 1);
  const result = await build(f.vite());
  assert.ok(result.output.some(item => item.type === 'chunk' && item.code.includes('approved')));
});

test('prototype-first edit renders as a draft; production build and module load reject it', async t => {
  const f = fixture(t);
  const production = await createServer(f.vite());
  t.after(() => production.close());
  await production.listen();
  const port = production.httpServer.address().port;
  f.surface.status = 'drafting';
  f.save();
  f.write('packages/ui/example/surface/surface.css', '.ptc-example { border-radius: 30px; }');
  const prototype = await createServer(f.vite(false));
  t.after(() => prototype.close());
  const preview = await prototype.transformRequest('/packages/ui/example/surface/surface.css');
  assert.match(preview.code, /30px/);
  await assert.rejects(build(f.vite()), /UI_SURFACE_CONFIRMATION_REQUIRED/);
  const response = await fetch(`http://127.0.0.1:${port}/apps/desktop/src/entry.ts`);
  assert.equal(response.status, 409);
  assert.match(await response.text(), /UI_SURFACE_CONFIRMATION_REQUIRED/);
  f.surface.status = 'pending-review';
  f.save();
  await assert.rejects(build(f.vite()), /UI_SURFACE_CONFIRMATION_REQUIRED/);
  f.approveSynthetic();
  await build(f.vite());
});

test('changing confirmed presentation or prototype data invalidates old approval', async t => {
  const f = fixture(t);
  f.write('packages/ui/example/surface/surface.css', '.ptc-example { border-radius: 30px; }');
  await assert.rejects(build(f.vite()), /UI_SURFACE_CONFIRMATION_STALE/);
  f.approveSynthetic();
  f.write(f.surface.prototype.adapter, `${f.adapter}\n// new prototype sample\n`);
  assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_CONFIRMATION_STALE/);
  f.approveSynthetic();
  f.write(f.surface.contract, '# Changed visible contract');
  assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_CONFIRMATION_STALE/);
});

test('UI implementation feedback blocks production until the unchanged prototype target is confirmed', async t => {
  const f = fixture(t);
  const approvedDigest = surfaceSourceDigest(f.root, f.surface);
  f.surface.status = 'drafting';
  f.save();
  const [context] = surfaceContext(f.root, [f.surface.production.adapter]);
  assert.equal(context.currentDigest, approvedDigest);
  assert.equal(context.productionAdmitted, false);
  assert.match(context.nextAction, /UI feedback.*prototype.*user confirmation/);
  assert.match(context.nextAction, /Implementation defects and small fixes cannot bypass/);
  await assert.rejects(build(f.vite()), /UI_SURFACE_CONFIRMATION_REQUIRED/);
  f.surface.status = 'pending-review';
  f.save();
  await assert.rejects(build(f.vite()), /UI_SURFACE_CONFIRMATION_REQUIRED/);
  f.approveSynthetic();
  assert.equal(surfaceSourceDigest(f.root, f.surface), approvedDigest);
  await build(f.vite());
});

test('direct production markup, fragments, local styles and DOM factories are rejected', t => {
  const f = fixture(t);
  for (const expression of [
    '<div>private UI</div>', '<><Surface /></>', '<Surface style={{color:"red"}} />',
    'React.createElement(Surface)', '<section><Surface /></section>',
  ]) {
    f.write(f.surface.production.adapter, f.adapter.replace('<Surface />', expression));
    assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_(?:ADAPTER_REIMPLEMENTED|LOCAL_STYLE)/);
  }
});

test('unused shared imports and disconnected public exports or real entries cannot pass', t => {
  const f = fixture(t);
  f.write(f.surface.production.adapter, f.adapter.replace('<Surface />', 'null'));
  assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_ADAPTER_REIMPLEMENTED/);
  f.write(f.surface.production.adapter, f.adapter);
  f.write(f.surface.production.entryChain[0], '// shared adapter is no longer reachable');
  assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_ENTRY_DISCONNECTED/);
  f.write(f.surface.production.entryChain[0], "import { Adapter } from './Adapter'; console.log(Adapter());");
  f.write(f.surface.exportFile, '// export removed');
  assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_EXPORT_DISCONNECTED/);
});

test('all app/prototype CSS rejects ptc and legacy-hook overrides', t => {
  const f = fixture(t);
  for (const [relative, selector] of [
    ['apps/desktop/src/override.css', '.ptc-example'],
    ['apps/mobile/src/override.css', '.ptc-example'],
    ['packages/prototypes/example/override.css', '.legacy-example-panel'],
    ['apps/desktop/src/override.css', '[class^="ptc-"]'],
  ]) {
    f.write(relative, `${selector} { color: red; }`);
    assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_LOCAL_STYLE/);
    fs.unlinkSync(path.join(f.root, relative));
  }
});

test('primitive guard recognizes ptc classes alongside pt classes', t => {
  const f = fixture(t);
  const relative = 'apps/desktop/src/probe.css';
  f.write(relative, '.ptc-search-panel, .pt-button { color: red; }');
  const result = scan([path.join(f.root, relative)]);
  assert.equal(result.totals.css, 2);
});

test('HMR rechecks confirmation; bundle admission rejects source drift and missing real consumers', t => {
  const f = fixture(t);
  const plugin = uiSurfaceAuthorityPlugin(f.root);
  plugin.buildStart();
  f.write('packages/ui/example/surface/surface.css', '.ptc-example { border-radius: 30px; }');
  assert.throws(() => plugin.handleHotUpdate(), /UI_SURFACE_CONFIRMATION_STALE/);
  f.approveSynthetic();
  assert.throws(() => plugin.generateBundle({}, {}), /UI_SURFACE_SOURCE_CHANGED_DURING_BUILD/);
  plugin.buildStart();
  assert.throws(() => plugin.generateBundle({}, {}), /UI_SURFACE_ENTRY_NOT_BUNDLED/);
});

test('ledger rejects duplicate authorities, unsafe paths and agent-generated confirmation', t => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.root, SURFACE_LEDGER), 'utf8');
  f.write(SURFACE_LEDGER, original + original);
  assert.throws(() => readSurfaceLedger(f.root), /UI_SURFACE_LEDGER_INVALID/);
  f.save();
  f.surface.confirmation.by = 'agent:synthetic';
  f.save();
  assert.throws(() => readSurfaceLedger(f.root), /UI_SURFACE_CONFIRMATION_INVALID/);
  f.surface.confirmation.by = 'user:synthetic';
  f.surface.status = 'superseded';
  f.save();
  assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_CONFIRMATION_REQUIRED/);
  f.surface.presentationRoots = ['../outside'];
  f.save();
  assert.throws(() => readSurfaceLedger(f.root), /UI_SURFACE_OWNER_INVALID/);
});

test('P1 same-name function parameters cannot replace the imported shared component', async t => {
  const f = fixture(t);
  f.write(f.surface.production.adapter, f.adapter.replace('Adapter()', 'Adapter(Surface: any)'));
  await assert.rejects(build(f.vite()), /UI_SURFACE_ADAPTER_REIMPLEMENTED/);
});

test('P1 external dedicated presentation imports enter the digest and pre-edit mapping', async t => {
  const f = fixture(t);
  const dependency = 'packages/ui/example/dedicated.ts';
  f.write(dependency, "export const label = 'approved';");
  f.write('packages/ui/example/surface/Surface.tsx',
    "import { label } from '../dedicated'; const React = { createElement: (...args) => args }; export function Surface() { return <span>{label}</span>; }");
  f.approveSynthetic();
  await build(f.vite());
  assert.equal(surfaceContext(f.root, [dependency])[0].id, f.surface.id);
  f.write(dependency, "export const label = 'unreviewed';");
  await assert.rejects(build(f.vite()), /UI_SURFACE_CONFIRMATION_STALE/);
});

test('P1 intermediate host cannot inject a style tag while retaining a real import', async t => {
  const f = fixture(t);
  const host = 'apps/desktop/src/Host.tsx';
  f.surface.production.entryChain.splice(1, 0, host);
  f.write(f.surface.production.entryChain[0], "import { Host } from './Host'; console.log(Host());");
  f.write(host, "import { Adapter } from './Adapter'; const React = { createElement: (...args) => args }; export function Host() { return <><style>{'.ptc-example {color:red}'}</style><Adapter /></>; }");
  f.approveSynthetic();
  await assert.rejects(build(f.vite()), /UI_SURFACE_LOCAL_STYLE/);
});

test('P1 hook classes cannot create an unprotected production-only style namespace', async t => {
  const f = fixture(t);
  f.write(f.surface.production.adapter, f.adapter.replace('<Surface />',
    '<Surface hooks={{classNames:{panel:"private-panel"}}} />'));
  f.write('apps/desktop/src/override.css', '.private-panel { color: red; }');
  await assert.rejects(build(f.vite()), /UI_SURFACE_HOOKS_INVALID/);
});

test('P1 escaped classes and legacy class attribute selectors cannot override shared UI', async t => {
  const f = fixture(t);
  for (const selector of ['[class~="legacy-example-panel"]', '[class*="legacy-example-"]',
    '.legacy-example-\\70 anel', ':is(.ptc-example)', '[CLASS~="ptc-example" i]',
    ':is(.ptc-example, [title!="invalid-branch"])']) {
    f.write('apps/desktop/src/override.css', `${selector} { color: red; }`);
    await assert.rejects(build(f.vite()), /UI_SURFACE_LOCAL_STYLE/);
  }
});

test('hook props fail closed on spreads, dynamic classes and shadowed memo factories', t => {
  const f = fixture(t);
  for (const expression of ['<Surface {...props} />',
    '<Surface hooks={{classNames:{panel:namespace}}} />',
    '<Surface hooks={{...props}} />', '<Surface hooks={props} />']) {
    f.write(f.surface.production.adapter, f.adapter.replace('<Surface />', expression));
    assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_HOOKS_INVALID/);
  }
  f.write(f.surface.production.adapter, f.adapter.replace('<Surface />',
    '<Surface hooks={{classNames:{panel:"legacy-example-panel"}}} />'));
  assert.equal(verifySurfaceAuthority(f.root).length, 1);
});

test('protected hook objects cannot escape to mutation through aliases or helper calls', t => {
  const f = fixture(t);
  const source = "import { Surface } from '@example/ui'; const React = { createElement: (...args) => args }; export function Adapter() { const hooks = {classNames:{panel:'legacy-example-panel'}}; MUTATION return <Surface hooks={hooks} />; }";
  for (const mutation of [
    "hooks.classNames.panel = 'private-panel';",
    "const classes = hooks.classNames; classes.panel = 'private-panel';",
    "Object.assign(hooks, {classNames:{panel:'private-panel'}});",
  ]) {
    f.write(f.surface.production.adapter, source.replace('MUTATION', mutation));
    assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_HOOKS_INVALID/);
  }
});

test('dedicated CSS imports without dot prefixes are hashed and invalidate confirmation', async t => {
  const f = fixture(t);
  f.write('packages/ui/example/surface/surface.css', "@import 'external.css';");
  f.write('packages/ui/example/surface/external.css', '.ptc-example { color: green; }');
  f.approveSynthetic();
  await build(f.vite());
  f.write('packages/ui/example/surface/external.css', '.ptc-example { color: red; }');
  await assert.rejects(build(f.vite()), /UI_SURFACE_CONFIRMATION_STALE/);
});

test('unquoted CSS import URLs outside the declared directory invalidate confirmation', async t => {
  const f = fixture(t);
  f.write('packages/ui/example/surface/surface.css', '@import url(../dedicated.css) screen;');
  f.write('packages/ui/example/dedicated.css', '.ptc-example { color: green; }');
  f.approveSynthetic();
  await build(f.vite());
  assert.equal(surfaceContext(f.root, ['packages/ui/example/dedicated.css'])[0].id, f.surface.id);
  f.write('packages/ui/example/dedicated.css', '.ptc-example { color: red; }');
  await assert.rejects(build(f.vite()), /UI_SURFACE_CONFIRMATION_STALE/);
});

test('an export cannot impersonate a declared presentation file using a filename prefix', t => {
  const f = fixture(t);
  f.surface.presentationRoots = ['packages/ui/example/surface/Surface.tsx'];
  f.write('packages/ui/example/surface/Surface.tsx-private.tsx',
    'export function Surface() { return null; }');
  f.write(f.surface.exportFile, "export { Surface } from './surface/Surface.tsx-private';");
  f.approveSynthetic();
  assert.throws(() => verifySurfaceAuthority(f.root), /UI_SURFACE_EXPORT_DISCONNECTED/);
});

function dev(f, action, options = {}) {
  return runCli([action, '--workspace-root', f.root, ...Object.entries(options).flatMap(([key, value]) =>
    [`--${key}`, String(value)])], { output() {} });
}

function intake(f, options = {}) {
  return dev(f, 'intake', {
    kind: 'ui-feedback', surface: f.surface.id, feedback: 'round-2',
    'expected-revision': 1, request: 'Panel needs review', 'request-ref': 'fixture://feedback/2',
    ...options,
  });
}

test('dev intake registers new UI feedback before edits, with no Plan or Task store', async t => {
  const f = fixture(t);
  const before = surfaceSourceDigest(f.root, f.surface);
  assert.deepEqual(dev(f, 'intake').uiSurfaces, []);
  const result = intake(f);
  assert.equal(result.status, 'drafting');
  assert.equal(result.confirmation, null);
  assert.equal(surfaceSourceDigest(f.root, result), before);
  assert.equal(fs.existsSync(path.join(f.root, '.dev-workflow')), false);
  await assert.rejects(build(f.vite()), /UI_SURFACE_CONFIRMATION_REQUIRED/);
});

test('dev feedback retries are idempotent; conflicting reuse and stale writers cannot overwrite', t => {
  const f = fixture(t);
  const first = intake(f);
  assert.deepEqual(intake(f), first);
  assert.throws(() => intake(f, { request: 'different request' }), /UI_SURFACE_FEEDBACK_CONFLICT/);
  assert.throws(() => intake(f, { feedback: 'round-3', 'request-ref': 'fixture://3' }), /UI_SURFACE_REVISION_CONFLICT/);
  assert.equal(readSurfaceLedger(f.root)[0].feedback.id, 'round-2');
});

test('dev unchanged prototype requires review and current-round user confirmation', async t => {
  const f = fixture(t);
  const draft = intake(f);
  const base = { surface: draft.id, feedback: draft.feedback.id };
  assert.throws(() => dev(f, 'ui-confirm', {
    ...base, 'expected-revision': 2,
  }), /UI_SURFACE_REVIEW_REQUIRED/);
  const reviewed = dev(f, 'ui-review', {
    ...base, 'expected-revision': 2, target: 'Use the existing prototype unchanged', evidence: 'fixture://rendered-target',
  });
  assert.throws(() => dev(f, 'before-implement', { surface: draft.id }), /UI_SURFACE_CONFIRMATION_REQUIRED/);
  const confirmed = dev(f, 'ui-confirm', {
    ...base, 'expected-revision': reviewed.feedback.revision,
    'source-digest': reviewed.feedback.review.sourceDigest,
    by: 'user:synthetic', request: 'Synthetic approval of this unchanged target', evidence: 'fixture://user/2',
  });
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual(intake(f), confirmed); // A delivery retry cannot revoke this approval.
  assert.equal(dev(f, 'before-implement', { surface: draft.id }).length, 1);
  await build(f.vite());
});

test('dev refuses stale review, old feedback approval, invalid selection and agent confirmation', t => {
  const f = fixture(t);
  const draft = intake(f);
  const base = { surface: draft.id, feedback: draft.feedback.id };
  const reviewed = dev(f, 'ui-review', {
    ...base, 'expected-revision': 2, target: 'Review target', evidence: 'fixture://render',
  });
  const approval = {
    ...base, 'expected-revision': reviewed.feedback.revision, 'source-digest': reviewed.feedback.review.sourceDigest,
    by: 'user:synthetic', request: 'Synthetic approval', evidence: 'fixture://approval',
  };
  assert.throws(() => dev(f, 'ui-confirm', { ...approval, by: 'agent:synthetic' }), /UI_SURFACE_CONFIRMATION_INVALID/);
  assert.throws(() => dev(f, 'ui-confirm', { ...approval, feedback: 'initial' }), /UI_SURFACE_FEEDBACK_CONFLICT/);
  f.write('packages/ui/example/surface/surface.css', '.ptc-example { border-radius: 30px; }');
  assert.throws(() => dev(f, 'ui-confirm', approval), /UI_SURFACE_CONFIRMATION_STALE/);
  assert.throws(() => intake(f, { surface: 'unknown' }), error => error.code === 'UI_SURFACE_SELECTION_REQUIRED');
  assert.equal(fs.existsSync(path.join(f.root, `${SURFACE_LEDGER}.lock`)), false);
});

test('dev path-based intake resolves a surface and derives stable feedback identity from the request', t => {
  const f = fixture(t);
  const options = {
    kind: 'ui-feedback', 'scope-paths': f.surface.production.adapter, 'expected-revision': 1,
    request: 'Path-selected feedback', 'request-ref': 'fixture://path-request',
  };
  const first = dev(f, 'intake', options);
  assert.match(first.feedback.id, /^feedback-[a-f0-9]{24}$/);
  assert.deepEqual(dev(f, 'intake', options), first);
});

test('a drafting surface does not block another selected surface or ordinary dev intake', t => {
  const f = fixture(t);
  const other = structuredClone(f.surface);
  other.id = 'another-surface';
  other.feedback.id = 'another-initial';
  other.confirmation.feedbackId = other.feedback.id;
  other.feedback.review.sourceDigest = surfaceSourceDigest(f.root, other);
  other.confirmation.sourceDigest = other.feedback.review.sourceDigest;
  f.write(SURFACE_LEDGER, `\`\`\`json ui-surface-authority\n${JSON.stringify({ schemaVersion: 1, surfaces: [f.surface, other] })}\n\`\`\``);
  intake(f);
  assert.equal(dev(f, 'before-implement', { surface: other.id }).length, 1);
  assert.deepEqual(dev(f, 'intake', { 'scope-paths': 'apps/station' }).uiSurfaces, []);
});

test('concurrent dev intake writers preserve one winner and leave no lock or task store', async t => {
  const f = fixture(t);
  const execute = promisify(execFile);
  const cli = new URL('../local-dev/dev-work.mjs', import.meta.url);
  const results = await Promise.allSettled(['left', 'right'].map(feedback =>
    execute(process.execPath, [cli.pathname, 'intake', '--workspace-root', f.root,
      '--kind', 'ui-feedback', '--surface', f.surface.id, '--feedback', feedback,
      '--expected-revision', '1', '--request', 'Concurrent feedback', '--request-ref', `fixture://${feedback}`],
    { cwd: f.root })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const loser = results.find(result => result.status === 'rejected');
  assert.match(loser.reason.stderr, /UI_SURFACE_(?:REVISION_CONFLICT|LEDGER_BUSY)/);
  assert.equal(readSurfaceLedger(f.root)[0].feedback.revision, 2);
  assert.equal(fs.existsSync(path.join(f.root, `${SURFACE_LEDGER}.lock`)), false);
  assert.equal(fs.existsSync(path.join(f.root, '.dev-workflow')), false);
});

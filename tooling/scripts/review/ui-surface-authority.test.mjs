import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
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
    surface.confirmation = {
      by: 'user:synthetic', request: 'Synthetic test approval; never a real user confirmation.',
      evidence: 'Synthetic test fixture', sourceDigest: surfaceSourceDigest(root, surface),
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

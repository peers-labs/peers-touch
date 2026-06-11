#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APPLET_BRIDGE_PROTOCOL, validateManifest } from '../../packages/applet-contract/dist/index.js';

const evidenceRoot = path.resolve('applet-readiness-evidence');
const desktopAppletRoot = path.resolve('apps/desktop/applets-dist');
mkdirSync(path.join(evidenceRoot, 'desktop'), { recursive: true });

function fail(message, details = []) {
  process.stderr.write(`${['FAIL', message, ...details].join('\n')}\n`);
  process.exit(1);
}

function write(relative, content) {
  writeFileSync(path.join(evidenceRoot, relative), `${content.trim()}\n`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function collectSourceFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolute));
      continue;
    }
    if (entry.isFile() && /\.(cjs|js|jsx|mjs|ts|tsx)$/.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files.sort();
}

function assertNoLegacyAppletSource(appletId, integratedDesktop) {
  const sourceRoot = path.resolve('packages/applets', appletId, 'src');
  if (!existsSync(sourceRoot)) return;
  const sourceFiles = collectSourceFiles(sourceRoot);
  assert.ok(sourceFiles.length > 0, `${appletId} has no source files to scan`);
  for (const sourceFile of sourceFiles) {
    const source = readFileSync(sourceFile, 'utf8');
    const relative = path.relative(sourceRoot, sourceFile);
    assert.doesNotMatch(source, /registerApplet/, `${appletId}/${relative} uses legacy registerApplet`);
    assert.doesNotMatch(source, /AppletPageProps/, `${appletId}/${relative} uses legacy AppletPageProps`);
    assert.doesNotMatch(source, /peers-touch\.applet\.bridge\.v2/, `${appletId}/${relative} references bridge v2`);
    assert.doesNotMatch(source, /sdk\.invoke\s*<[^>]*>\s*\(\s*['"]applets_action['"]/, `${appletId}/${relative} invokes legacy applets_action`);
    assert.doesNotMatch(source, /sdk\.invoke\s*\(\s*['"]applets_action['"]/, `${appletId}/${relative} invokes legacy applets_action`);
    assert.doesNotMatch(source, /sdk\.invoke\s*<[^>]*>\s*\(\s*['"]search_query['"]/, `${appletId}/${relative} invokes legacy search_query`);
    assert.doesNotMatch(source, /sdk\.invoke\s*\(\s*['"]search_query['"]/, `${appletId}/${relative} invokes legacy search_query`);
    assert.doesNotMatch(source, /StandaloneBridgeAdapter/, `${appletId}/${relative} depends on standalone adapter`);
    if (integratedDesktop) {
      assert.doesNotMatch(source, /from ['"]react-dom\/client['"]/, `${appletId}/${relative} imports React DOM but is declared as a Desktop Lynx applet`);
      assert.doesNotMatch(source, /document\.getElementById/, `${appletId}/${relative} uses Browser DOM but is declared as a Desktop Lynx applet`);
      assert.doesNotMatch(source, /window\./, `${appletId}/${relative} uses Browser window but is declared as a Desktop Lynx applet`);
    }
  }
}

function assertDesktopLynxEntry(packageDir, manifest) {
  const entry = manifest.load?.desktop?.entry;
  assert.ok(entry, `${manifest.id} must declare load.desktop.entry`);
  assert.equal(path.extname(entry), '.bundle', `${manifest.id} Desktop Lynx entry must be a Lynx bundle, not ${entry}`);
  const source = readFileSync(path.join(packageDir, entry), 'utf8');
  assert.doesNotMatch(source, /react-dom\.production|react-dom\/client|document\.getElementById/, `${manifest.id} Desktop Lynx bundle contains Browser/React DOM runtime code`);
}

const indexPath = path.join(desktopAppletRoot, 'index.json');
if (!existsSync(indexPath)) {
  fail('Desktop applet index is missing. Run pnpm applets:build first.', [indexPath]);
}

const index = readJson(indexPath);
assert.equal(index.version, 1);
assert.ok(Array.isArray(index.applets));
assert.ok(index.applets.length > 0);

const validated = [];
const standalone = [];
const desktopIntegrated = [];
for (const manifest of index.applets) {
  const result = validateManifest(manifest);
  if (!result.valid || !result.manifest) {
    fail(`Invalid applet manifest in Desktop index: ${manifest?.id ?? 'unknown'}`, result.errors);
  }

  assert.equal(result.manifest.bridge.protocol, APPLET_BRIDGE_PROTOCOL);
  assert.equal(manifest.bridge.protocol, APPLET_BRIDGE_PROTOCOL);
  assert.equal(manifest.bridge.protocol.includes('.v2'), false);
  assert.equal('manifestVersion' in manifest, false);

  const packageDir = path.join(desktopAppletRoot, result.manifest.id);
  const manifestPath = path.join(packageDir, 'manifest.json');
  assert.ok(existsSync(manifestPath), `missing manifest.json for ${result.manifest.id}`);
  assert.deepEqual(readJson(manifestPath), manifest);

  const integratedDesktop = result.manifest.targets.includes('desktop');
  if (integratedDesktop) {
    assert.ok(result.manifest.load.desktop, `${result.manifest.id} targets desktop but has no desktop load entry`);
    assertDesktopLynxEntry(packageDir, result.manifest);
    desktopIntegrated.push(result.manifest.id);
  } else {
    assert.equal(result.manifest.load.desktop, undefined, `${result.manifest.id} is not a Desktop applet but declares load.desktop`);
    standalone.push(result.manifest.id);
  }
  for (const [relativePath, expectedHash] of Object.entries(result.manifest.integrity.files)) {
    const filePath = path.join(packageDir, relativePath);
    assert.ok(existsSync(filePath), `missing integrity file ${relativePath} for ${result.manifest.id}`);
    assert.equal(sha256(filePath), expectedHash, `integrity mismatch for ${result.manifest.id}/${relativePath}`);
  }

  assertNoLegacyAppletSource(result.manifest.id, integratedDesktop);
  validated.push(result.manifest.id);
}

assert.ok(desktopIntegrated.length > 0, 'Desktop package gate requires at least one real Desktop Lynx package');

write('desktop/package-gate-output.txt', [
  `PASS Desktop applet index contains ${validated.length} canonical packages.`,
  `PASS Packages: ${validated.join(', ')}`,
  `PASS Desktop Lynx packages: ${desktopIntegrated.join(', ')}`,
  `PASS Standalone web-spa packages excluded from Desktop Lynx evidence: ${standalone.join(', ') || 'none'}`,
  'PASS Each package has canonical bridge protocol, manifest.json, and SHA-256 integrity.',
  'PASS Desktop Lynx packages use bundle entries and avoid Browser DOM / React DOM source assumptions.',
  'PASS Applet source trees avoid legacy registerApplet/AppletPageProps/bridge.v2/standalone and legacy invoke paths.',
].join('\n'));

process.stdout.write('PASS applet desktop package gate\n');

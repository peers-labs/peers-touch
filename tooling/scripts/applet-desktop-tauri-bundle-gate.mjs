#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APPLET_BRIDGE_PROTOCOL, validateManifest } from '../../packages/applet-contract/dist/index.js';

const evidenceDir = path.resolve('applet-readiness-evidence/desktop');
const outputPath = path.join(evidenceDir, 'tauri-bundle-gate-output.txt');
const desktopDist = path.resolve('apps/desktop/dist');
const distAppletRoot = path.join(desktopDist, 'applets-dist');
const sourceAppletRoot = path.resolve('apps/desktop/applets-dist');
const tauriBundleRoot = path.resolve('apps/desktop/src-tauri/target/release/bundle');
const tauriConfPath = path.resolve('apps/desktop/src-tauri/tauri.conf.json');

mkdirSync(evidenceDir, { recursive: true });

function fail(message, details = []) {
  const output = ['FAIL Desktop Tauri bundle applet gate', message, ...details].filter(Boolean).join('\n');
  writeFileSync(outputPath, `${output}\n`);
  process.stderr.write(`${output}\n`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function collectFiles(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolute, base));
    } else if (entry.isFile()) {
      files.push(path.relative(base, absolute).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function newestMtimeMs(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtimeMs(absolute));
    } else if (entry.isFile()) {
      newest = Math.max(newest, statSync(absolute).mtimeMs);
    }
  }
  return newest;
}

function findMacApp() {
  const macosDir = path.join(tauriBundleRoot, 'macos');
  if (!existsSync(macosDir)) return null;
  const apps = readdirSync(macosDir)
    .filter((entry) => entry.endsWith('.app'))
    .map((entry) => path.join(macosDir, entry));
  return apps[0] ?? null;
}

function findDmg() {
  const dmgDir = path.join(tauriBundleRoot, 'dmg');
  if (!existsSync(dmgDir)) return null;
  const dmgs = readdirSync(dmgDir)
    .filter((entry) => entry.endsWith('.dmg'))
    .map((entry) => path.join(dmgDir, entry));
  return dmgs[0] ?? null;
}

function findMacExecutable(appPath) {
  const macosDir = path.join(appPath, 'Contents', 'MacOS');
  const executables = readdirSync(macosDir)
    .map((entry) => path.join(macosDir, entry))
    .filter((entryPath) => {
      const mode = statSync(entryPath).mode;
      return (mode & 0o111) !== 0;
    });
  return executables[0] ?? null;
}

try {
  assert.ok(existsSync(tauriConfPath), 'tauri.conf.json is missing');
  const tauriConf = readJson(tauriConfPath);
  assert.equal(tauriConf.build?.frontendDist, '../dist', 'Tauri frontendDist must point at Desktop dist');
  assert.match(String(tauriConf.build?.beforeBuildCommand ?? ''), /pnpm build/, 'Tauri beforeBuildCommand must build Desktop frontend');

  const sourceIndexPath = path.join(sourceAppletRoot, 'index.json');
  const distIndexPath = path.join(distAppletRoot, 'index.json');
  assert.ok(existsSync(sourceIndexPath), 'source Desktop applets-dist index is missing; run pnpm applets:build');
  assert.ok(existsSync(distIndexPath), 'Desktop dist applets-dist index is missing; run Desktop build/Tauri build');

  const sourceIndex = readJson(sourceIndexPath);
  const distIndex = readJson(distIndexPath);
  assert.deepEqual(distIndex.applets, sourceIndex.applets, 'Desktop dist applet index differs from source applets-dist index');
  assert.ok(Array.isArray(distIndex.applets) && distIndex.applets.length > 0, 'Desktop dist applet index must contain applets');

  const desktopLynxIds = [];
  const checkedFiles = [];
  for (const rawManifest of distIndex.applets) {
    const result = validateManifest(rawManifest);
    if (!result.valid || !result.manifest) {
      fail(`Invalid applet manifest in Desktop dist: ${rawManifest?.id ?? 'unknown'}`, result.errors);
    }
    const manifest = result.manifest;
    assert.equal(manifest.bridge.protocol, APPLET_BRIDGE_PROTOCOL, `${manifest.id} uses non-canonical bridge protocol`);
    const distPackageDir = path.join(distAppletRoot, manifest.id);
    const sourcePackageDir = path.join(sourceAppletRoot, manifest.id);
    assert.deepEqual(collectFiles(distPackageDir), collectFiles(sourcePackageDir), `${manifest.id} dist files differ from source applets-dist files`);

    if (manifest.targets.includes('desktop')) {
      const entry = manifest.load.desktop?.entry;
      assert.ok(entry, `${manifest.id} targets desktop but has no load.desktop.entry`);
      assert.equal(path.extname(entry), '.bundle', `${manifest.id} Desktop entry must be a Lynx bundle`);
      assert.ok(existsSync(path.join(distPackageDir, entry)), `${manifest.id} Desktop Lynx bundle is missing from Desktop dist`);
      desktopLynxIds.push(manifest.id);
    }

    for (const [relativePath, expectedHash] of Object.entries(manifest.integrity.files)) {
      const filePath = path.join(distPackageDir, relativePath);
      assert.ok(existsSync(filePath), `${manifest.id}/${relativePath} missing from Desktop dist`);
      assert.equal(sha256(filePath), expectedHash, `${manifest.id}/${relativePath} Desktop dist integrity mismatch`);
      checkedFiles.push(`${manifest.id}/${relativePath}`);
    }
  }
  assert.ok(desktopLynxIds.length > 0, 'Desktop dist must contain at least one Desktop Lynx applet');

  const appPath = findMacApp();
  assert.ok(appPath, 'macOS .app bundle is missing; run CI=false pnpm --filter @peers-touch/app-desktop run tauri:build');
  const dmgPath = findDmg();
  assert.ok(dmgPath, 'macOS .dmg bundle is missing; run CI=false pnpm --filter @peers-touch/app-desktop run tauri:build');
  const executablePath = findMacExecutable(appPath);
  assert.ok(executablePath, 'macOS .app executable is missing');

  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
  assert.ok(existsSync(infoPlistPath), 'macOS .app Info.plist is missing');
  const infoPlist = readFileSync(infoPlistPath, 'utf8');
  assert.match(infoPlist, /com\.peers\.touch\.desktop/, 'Info.plist must contain Desktop bundle identifier');
  assert.match(infoPlist, /peers-touch/, 'Info.plist must contain peers-touch URL scheme');

  const appStat = statSync(executablePath);
  const distAppletNewest = newestMtimeMs(distAppletRoot);
  assert.ok(
    appStat.mtimeMs + 1000 >= distAppletNewest,
    [
      'Tauri app executable is older than Desktop packaged applet assets.',
      'Run a fresh CI=false pnpm --filter @peers-touch/app-desktop run tauri:build after pnpm applets:build.',
      `executable mtime: ${new Date(appStat.mtimeMs).toISOString()}`,
      `newest applet asset mtime: ${new Date(distAppletNewest).toISOString()}`,
    ].join('\n'),
  );

  const output = [
    'PASS Desktop Tauri bundle applet gate',
    `PASS macOS app: ${appPath}`,
    `PASS executable: ${executablePath}`,
    `PASS dmg: ${dmgPath}`,
    `PASS frontendDist: ${desktopDist}`,
    `PASS Desktop Lynx applets: ${desktopLynxIds.join(', ')}`,
    `PASS integrity files checked: ${checkedFiles.length}`,
    `PASS executable mtime: ${new Date(appStat.mtimeMs).toISOString()}`,
    `PASS newest applet asset mtime: ${new Date(distAppletNewest).toISOString()}`,
  ].join('\n');
  writeFileSync(outputPath, `${output}\n`);
  process.stdout.write(`${output}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

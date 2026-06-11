#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APPLET_BRIDGE_PROTOCOL, validateManifest } from '../../packages/applet-contract/dist/index.js';

const evidenceDir = path.resolve('applet-readiness-evidence/desktop');
const outputPath = path.join(evidenceDir, 'packaged-assets-gate-output.txt');
const desktopDist = path.resolve('apps/desktop/dist');
const packagedAppletRoot = path.join(desktopDist, 'applets-dist');
const sourceAppletRoot = path.resolve('apps/desktop/applets-dist');

mkdirSync(evidenceDir, { recursive: true });

function fail(message, details = []) {
  const output = ['FAIL Desktop packaged applet assets gate', message, ...details].join('\n');
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
      continue;
    }
    if (entry.isFile()) {
      files.push(path.relative(base, absolute).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

try {
  const desktopIndex = path.join(desktopDist, 'index.html');
  const packagedIndex = path.join(packagedAppletRoot, 'index.json');
  const sourceIndex = path.join(sourceAppletRoot, 'index.json');

  assert.ok(existsSync(desktopIndex), 'apps/desktop/dist/index.html is missing; run pnpm --filter @peers-touch/app-desktop run build');
  assert.ok(existsSync(sourceIndex), 'apps/desktop/applets-dist/index.json is missing; run pnpm applets:build');
  assert.ok(existsSync(packagedIndex), 'apps/desktop/dist/applets-dist/index.json is missing from packaged frontendDist');

  const source = readJson(sourceIndex);
  const packaged = readJson(packagedIndex);
  assert.deepEqual(packaged.applets, source.applets, 'packaged applet index differs from source applets-dist index');
  assert.equal(packaged.version, 1, 'packaged applet index version must be 1');
  assert.ok(Array.isArray(packaged.applets), 'packaged applet index must contain applets array');
  assert.ok(packaged.applets.length > 0, 'packaged applet index must contain at least one applet');

  const desktopLynxIds = [];
  const standaloneIds = [];
  const checkedFiles = [];

  for (const rawManifest of packaged.applets) {
    const result = validateManifest(rawManifest);
    if (!result.valid || !result.manifest) {
      fail(`Invalid packaged applet manifest: ${rawManifest?.id ?? 'unknown'}`, result.errors);
    }

    const manifest = result.manifest;
    assert.equal(manifest.bridge.protocol, APPLET_BRIDGE_PROTOCOL, `${manifest.id} uses non-canonical bridge protocol`);

    const packageDir = path.join(packagedAppletRoot, manifest.id);
    const sourcePackageDir = path.join(sourceAppletRoot, manifest.id);
    assert.ok(existsSync(packageDir), `packaged directory missing for ${manifest.id}`);
    assert.ok(existsSync(sourcePackageDir), `source directory missing for ${manifest.id}`);
    assert.deepEqual(
      collectFiles(packageDir),
      collectFiles(sourcePackageDir),
      `${manifest.id} packaged files differ from source applets-dist files`,
    );

    const manifestPath = path.join(packageDir, 'manifest.json');
    assert.ok(existsSync(manifestPath), `manifest.json missing for ${manifest.id}`);
    assert.deepEqual(readJson(manifestPath), rawManifest, `${manifest.id} packaged manifest.json differs from index manifest`);

    if (manifest.targets.includes('desktop')) {
      const entry = manifest.load.desktop?.entry;
      assert.ok(entry, `${manifest.id} targets desktop but has no load.desktop.entry`);
      assert.equal(path.extname(entry), '.bundle', `${manifest.id} Desktop entry must be a Lynx bundle`);
      assert.ok(existsSync(path.join(packageDir, entry)), `${manifest.id} packaged Lynx bundle is missing`);
      desktopLynxIds.push(manifest.id);
    } else {
      assert.equal(manifest.load.desktop, undefined, `${manifest.id} is not Desktop-targeted but declares load.desktop`);
      standaloneIds.push(manifest.id);
    }

    for (const [relativePath, expectedHash] of Object.entries(manifest.integrity.files)) {
      const filePath = path.join(packageDir, relativePath);
      assert.ok(existsSync(filePath), `${manifest.id}/${relativePath} is missing from packaged frontendDist`);
      assert.equal(sha256(filePath), expectedHash, `${manifest.id}/${relativePath} packaged integrity mismatch`);
      checkedFiles.push(`${manifest.id}/${relativePath}`);
    }
  }

  assert.ok(desktopLynxIds.length > 0, 'packaged frontendDist must include at least one Desktop Lynx applet');

  const output = [
    'PASS Desktop packaged applet assets gate',
    `PASS frontendDist: ${desktopDist}`,
    `PASS packaged index: ${packagedIndex}`,
    `PASS packaged applets: ${packaged.applets.map((item) => item.id).join(', ')}`,
    `PASS Desktop Lynx applets: ${desktopLynxIds.join(', ')}`,
    `PASS Standalone applets retained but excluded from Desktop Lynx evidence: ${standaloneIds.join(', ') || 'none'}`,
    `PASS integrity files checked: ${checkedFiles.length}`,
  ].join('\n');
  writeFileSync(outputPath, `${output}\n`);
  process.stdout.write(`${output}\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkVersion, compareVersions, parseVersion } from './release-version-check.mjs';

test('SemVer ordering includes complete prerelease and rejects invalid tags', () => {
  const ordered = ['v0.1.0-1', 'v0.1.0-alpha', 'v0.1.0-rc.2', 'v0.1.0-rc.10', 'v0.1.0', 'v0.1.1'];
  assert.deepEqual([...ordered].reverse().sort(compareVersions), ordered);
  for (const invalid of ['v01.0.0', 'v0.1', 'v0.1.0-01', 'v0.1.0+build']) {
    assert.throws(() => parseVersion(invalid), /RD_VERSION_INVALID/u);
  }
  assert.equal(compareVersions('v0.1.0', 'v0.1.0'), 0);
});

test('version check binds all three package declarations and both locks', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-versions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tauri = path.join(root, 'apps/desktop/src-tauri');
  fs.mkdirSync(tauri, { recursive: true });
  const pkg = { version: '0.1.0-rc.1', dependencies: { '@tauri-apps/api': '2.0.1', '@tauri-apps/plugin-updater': '2.0.0' } };
  fs.writeFileSync(path.join(root, 'apps/desktop/package.json'), JSON.stringify(pkg));
  fs.writeFileSync(path.join(tauri, 'tauri.conf.json'), JSON.stringify({ version: pkg.version }));
  fs.writeFileSync(path.join(tauri, 'Cargo.toml'), `[package]\nname = "peers-touch-desktop"\nversion = "${pkg.version}"\n`);
  fs.writeFileSync(path.join(tauri, 'Cargo.lock'), `[[package]]\nname = "peers-touch-desktop"\nversion = "${pkg.version}"\n`);
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), "importers:\n  apps/desktop:\n    dependencies:\n      '@tauri-apps/api':\n        specifier: 2.0.1\n      '@tauri-apps/plugin-updater':\n        specifier: 2.0.0\n");
  assert.equal(checkVersion(root, 'v0.1.0-rc.1', 'v0.1.0-rc.0').prerelease, true);
  assert.throws(() => checkVersion(root, 'v0.1.0-rc.1', 'v0.1.0-rc.1'), /NOT_INCREASING/u);
  assert.throws(() => checkVersion(root, 'v0.1.0'), /VERSION_MISMATCH/u);
  fs.writeFileSync(path.join(tauri, 'Cargo.lock'), '[[package]]\nname = "peers-touch-desktop"\nversion = "0.0.1"\n');
  assert.throws(() => checkVersion(root, 'v0.1.0-rc.1'), /CARGO_LOCK_MISMATCH/u);
});

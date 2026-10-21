import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { createStationAssets, scanAssets, checkManifest, projectManifest } from './release-assets.mjs';
import { sha256 } from './release-evidence-check.mjs';

test('rendered installation assets have exact digests and no secret literals', (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-assets-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const release = createStationAssets({ root: process.cwd(), output, tag: 'v0.1.0',
    source: 'a'.repeat(40), imageDigest: `sha256:${'b'.repeat(64)}`, platforms: ['linux/amd64', 'linux/arm64'] });
  assert.equal(release.image, `ghcr.io/peers-labs/peers-touch-station@sha256:${'b'.repeat(64)}`);
  scanAssets(output);
  for (const line of fs.readFileSync(path.join(output, 'checksums.txt'), 'utf8').trim().split('\n')) {
    const [digest, name] = line.split('  ');
    assert.equal(digest, sha256(fs.readFileSync(path.join(output, name))));
  }
  fs.writeFileSync(path.join(output, 'install.sh'), 'PEERS_AUTH_SECRET=0123456789abcdef0123456789abcdef');
  assert.throws(() => scanAssets(output), /SECRET_LITERAL/u);
  fs.rmSync(path.join(output, 'install.sh'));
  assert.throws(() => scanAssets(output), /ENOENT/u);
});

test('manifest pins package URLs and permits only transport-origin projection', () => {
  const prefix = 'https://github.com/peers-labs/peers-touch/releases/download/v0.1.0/';
  const packages = {
    'windows-x86_64': 'Peers.exe',
    'linux-x86_64': 'Peers.AppImage',
    'darwin-x86_64': 'Peers.app.tar.gz',
    'darwin-aarch64': 'Peers.app.tar.gz',
  };
  const manifest = { version: '0.1.0', platforms: Object.fromEntries(Object.entries(packages)
    .map(([platform, name]) => [platform, { url: prefix + name, signature: 'actual-package-signature' }])) };
  const options = { repo: 'peers-labs/peers-touch', tag: 'v0.1.0',
    assets: Object.values(packages).flatMap((name) => [name, `${name}.sig`]) };
  checkManifest(manifest, options);
  const projected = projectManifest(manifest, 'https://candidate.example');
  assert.equal(projected.version, manifest.version);
  for (const platform of Object.keys(packages)) {
    assert.equal(projected.platforms[platform].signature, manifest.platforms[platform].signature);
    assert.equal(projected.platforms[platform].url, `https://candidate.example/${packages[platform]}`);
  }
  const invalid = structuredClone(manifest);
  invalid.platforms['linux-x86_64'].url = 'https://github.com/peers-labs/peers-touch/releases/latest/download/Peers.AppImage';
  assert.throws(() => checkManifest(invalid, options), /PLATFORM_MISSING/u);
  assert.throws(() => projectManifest(manifest, 'http://candidate.example'), /HTTPS_REQUIRED/u);
});

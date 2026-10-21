import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeUpdaterManifest } from './release-lifecycle.mjs';

test('updater manifest canonicalization replaces API IDs with immutable tag URLs', () => {
  const assets = [
    {
      id: 41,
      name: 'Peers.AppImage',
      browser_download_url: 'https://github.com/peers-labs/peers-touch/releases/download/v1.2.3/Peers.AppImage',
    },
    {
      id: 42,
      name: 'latest.json',
      browser_download_url: 'https://github.com/peers-labs/peers-touch/releases/download/v1.2.3/latest.json',
    },
  ];
  const source = {
    version: '1.2.3',
    platforms: {
      'linux-x86_64': {
        url: 'https://api.github.com/repos/peers-labs/peers-touch/releases/assets/41',
        signature: 'signed',
      },
    },
  };
  const first = canonicalizeUpdaterManifest(source, assets);
  assert.equal(first.changed, true);
  assert.equal(first.manifest.platforms['linux-x86_64'].url, assets[0].browser_download_url);
  assert.equal(source.platforms['linux-x86_64'].url,
    'https://api.github.com/repos/peers-labs/peers-touch/releases/assets/41');
  const second = canonicalizeUpdaterManifest(first.manifest, assets);
  assert.equal(second.changed, false);
  assert.throws(() => canonicalizeUpdaterManifest({
    version: '1.2.3',
    platforms: { 'linux-x86_64': { url: 'https://example.invalid/unknown', signature: 'signed' } },
  }, assets), /ASSET_IDENTITY_MISSING/u);
});

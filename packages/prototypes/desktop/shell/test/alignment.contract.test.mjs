import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

const settings = source('src/Settings.tsx');
const oauth = source('src/OAuthLoginPrototype.tsx');
const recovery = source('src/WelcomeLoginPrototype.tsx');
const stationPicker = source('src/AuthUtilityBarPrototype.tsx');
const shell = source('src/Shell.tsx');

test('general settings expose only shipped locale packs', () => {
  assert.doesNotMatch(settings, /title="Appearance"/);
  assert.doesNotMatch(settings, /Message density/);
  assert.doesNotMatch(settings, /\{ id: 'ja'/);
  assert.match(settings, /PROTOTYPE_LANGUAGE_KEY/);
  assert.match(settings, /\{ id: 'en', label: 'English' \}/);
  assert.match(settings, /\{ id: 'zh-CN', label: '简体中文' \}/);
});

test('auth prototype consumes an injected provider projection', () => {
  assert.match(oauth, /providers: readonly OAuthProviderProjection\[\]/);
  assert.match(oauth, /providers\.filter\(provider => provider\.enabled\)/);
  assert.doesNotMatch(oauth, /const providers\s*:/);
  assert.match(shell, /providers=\{authProviders\}/);
  assert.match(shell, /state === 'auth-oauth-empty'/);
});

test('email sign-in has no prefilled credentials', () => {
  assert.doesNotMatch(oauth, /defaultValue=/);
  assert.doesNotMatch(recovery, /mira@example\.com/);
  assert.doesNotMatch(recovery, /WeChat/);
});

test('typed Access Gate review states fail closed', () => {
  for (const kind of ['invite', 'terms', 'custom', 'blocked', 'maintenance', 'unknown']) {
    assert.match(oauth, new RegExp(`['"]${kind}['"]`));
  }
  assert.match(oauth, /data-pt-prototype-access-gate=\{gateKind\}/);
  assert.match(oauth, /Unsupported access step/);
});

test('Station picker models the complete endpoint lifecycle', () => {
  for (const marker of [
    'data-pt-prototype-station-add',
    'data-pt-prototype-station-select',
    'data-pt-prototype-station-remove',
    'data-pt-prototype-station-probe',
  ]) {
    assert.match(stationPicker, new RegExp(marker));
  }
  assert.match(stationPicker, /ACTIVE_STATION_STORAGE_KEY/);
  assert.match(stationPicker, /health: 'checking'/);
});

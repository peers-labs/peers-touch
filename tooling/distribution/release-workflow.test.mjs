import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('release workflow serializes updater manifest writers and remains fail-closed', () => {
  const workflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(workflow, /max-parallel: 1/u);
  assert.match(workflow, /uploadUpdaterJson: true/u);
  assert.match(workflow, /updaterJsonPreferNsis: true/u);
  assert.doesNotMatch(workflow, /includeUpdaterJson/u);
  assert.match(workflow, /release-lifecycle\.mjs canonicalize-manifest/u);
  assert.match(workflow, /verify-candidate-station:[\s\S]*docker\/login-action@v3[\s\S]*Run release Suite/u);
  assert.match(workflow, /verify-candidate-native:[\s\S]*RD_NATIVE_UPDATER_RUNTIME_UNPROVEN/u);
  assert.match(workflow, /needs: \[release-notes, station-image, verify-candidate-station, verify-candidate-native\]/u);
  assert.match(workflow, /RD_NATIVE_UPDATER_RUNTIME_UNPROVEN/u);
  assert.doesNotMatch(workflow, /DEPLOY_SSH_KEY|ssh-agent/u);
});

test('root README gives regular users an honest release installation path', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  assert.match(readme, /As a regular user: not yet/u);
  assert.match(readme,
    /https:\/\/github\.com\/peers-labs\/peers-touch\/releases\/latest\/download\/install\.sh/u);
  assert.match(readme, /You will not need an AI agent/u);
  assert.match(readme, /expected to return 404/u);
  assert.match(readme, /tooling\/distribution\/README\.md/u);
});

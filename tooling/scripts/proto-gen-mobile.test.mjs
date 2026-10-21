import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SCRIPT = path.join(REPO_ROOT, 'tooling/scripts/proto-gen-mobile.sh');

test('Mobile Proto generation requires the explicit shared Web target', () => {
  for (const args of [[], ['kotlin'], ['swift'], ['android'], ['ios'], ['all']]) {
    const result = spawnSync(SCRIPT, args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0, `unexpected success for ${args.join(' ')}`);
    assert.match(result.stdout, /Usage: .* web/);
  }
});

test('Mobile Proto generation has no retired native product output roots', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /apps\/mobile\/(?:android|ios)/);
  assert.doesNotMatch(source, /(?:kotlin|swift|android|ios|all)\|/);
  assert.match(source, /apps\/mobile\/src\/gen\/proto/);
});

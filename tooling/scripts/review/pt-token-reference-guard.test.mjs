import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guard = path.join(here, 'pt-token-reference-guard.mjs');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-token-guard-'));
  fs.mkdirSync(path.join(root, 'packages/ui/tokens/src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps/desktop/src'), { recursive: true });
  // Minimal token source that emits --pt-primary, --pt-mono and --pt-space-sm.
  // Color keys sit at exactly two-space indent, matching the real token files.
  fs.writeFileSync(
    path.join(root, 'packages/ui/tokens/src/index.ts'),
    [
      "const geometry = { radius: {}, space: { sm: 8 }, control: {}, motion: {} };",
      "const color = {",
      "  primary: '#1a1d20',",
      "};",
      "export function tokenVariables(mode) {",
      "  const t = { color, shadow: { rest: 'x', soft: 'y', float: 'z' } };",
      "  const out = {};",
      "  for (const [key, value] of Object.entries(t.color)) out[`--pt-${key}`] = value;",
      "  for (const [key, value] of Object.entries(geometry.space)) out[`--pt-space-${key}`] = `${value}px`;",
      "  out['--pt-mono'] = 'mono';",
      "  return out;",
      "}",
    ].join('\n'),
  );
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [guard, root], { encoding: 'utf8' });
}

test('passes when every referenced token is emitted', () => {
  const root = makeRoot();
  fs.writeFileSync(
    path.join(root, 'apps/desktop/src/ok.css'),
    '.a { color: var(--pt-primary); margin: var(--pt-space-sm); font: var(--pt-mono); }',
  );
  const res = run(root);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails on an undefined token with no fallback', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'apps/desktop/src/bad.css'), '.a { color: var(--pt-doesNotExist); }');
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /undefined --pt token reference: --pt-doesNotExist/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('treats an allowlisted extension var with an explicit fallback as valid', () => {
  const root = makeRoot();
  fs.writeFileSync(
    path.join(root, 'apps/desktop/src/ext.css'),
    '.a { width: var(--pt-auth-card-width, 352px); z-index: var(--pt-z-overlay, 1000); }',
  );
  const res = run(root);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  fs.rmSync(root, { recursive: true, force: true });
});

test('still rejects an allowlisted extension var used without a fallback', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'apps/desktop/src/ext.css'), '.a { width: var(--pt-z-overlay); }');
  const res = run(root);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /--pt-z-overlay/);
  fs.rmSync(root, { recursive: true, force: true });
});

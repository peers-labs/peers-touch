import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from '../../../../../node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/lib/main.js';

// Bundle the TS presenter (and its JSON locale import) to a temp ESM file
// so the pure R1 contract can run without the Prototype Portal.
const outDir = mkdtempSync(join(tmpdir(), 'content-projection-'));
const outFile = join(outDir, 'presenter.mjs');
await build({
  entryPoints: [new URL('../src/contentProjection.ts', import.meta.url).pathname],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: outFile,
  logLevel: 'silent',
});

const {
  projectMessage,
  projectConversationLastMessage,
  containsTransportLeak,
  assertTrustSlotHygiene,
} = await import(pathToFileURL(outFile).href);

test('plain human text passes through unchanged', () => {
  const r = projectMessage({ text: 'See you tomorrow at the meetup' });
  assert.equal(r.kind, 'text');
  assert.equal(r.label, 'See you tomorrow at the meetup');
});

test('emoji-only content stays emoji', () => {
  assert.equal(projectMessage({ text: '😀' }).kind, 'emoji');
});

test('image and file project to media forms', () => {
  assert.equal(projectMessage({ image: 'x' }).kind, 'image');
  assert.equal(projectMessage({ file: { name: 'spec.pdf', size: '1 MB' } }).label, 'spec.pdf');
});

test('seed string never reaches the human body slot', () => {
  const r = projectMessage({ text: 'MWPU Alice to Carol 1791856217298' });
  assert.equal(r.kind, 'redacted');
  assert.ok(!containsTransportLeak(r.label));
});

test('station endpoint and ptid are leaks', () => {
  assert.ok(containsTransportLeak('sync 10.37.94.156:18132 done'));
  assert.ok(containsTransportLeak('actor ptid:v1:alice'));
});

test('list preview keeps human media labels but redacts machine text', () => {
  assert.equal(projectConversationLastMessage('[Photo]'), '[Photo]');
  assert.equal(projectConversationLastMessage('design-spec-v3.pdf'), 'design-spec-v3.pdf');
  assert.equal(projectConversationLastMessage('MWPU Carol to Alice 1'), 'System update');
});

test('trust slots reject endpoints in name/relationship/preview', () => {
  assert.deepEqual(
    assertTrustSlotHygiene({ name: 'Bob', preview: 'See you' }),
    [],
  );
  assert.deepEqual(
    assertTrustSlotHygiene({ name: '10.37.94.156:18132', preview: 'x' }),
    ['name'],
  );
});

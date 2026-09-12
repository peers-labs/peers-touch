import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkSocialRuntimeBoundaries,
  checkSocialWire,
  runChecks,
} from '../checks.mjs';
import { DevctlError, ERROR_CODES } from '../errors.mjs';

function write(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixtureRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devctl-checks-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of [
    'apps/desktop/src/services',
    'apps/desktop/src/runtimes',
    'apps/desktop/src/store',
    'apps/desktop/src/pages',
    'apps/desktop/src/components',
    'apps/mobile/src/pages',
    'apps/mobile/src/components',
    'apps/mobile/src/features/social',
    'apps/mobile/src/features/group',
    'apps/mobile/src-tauri/src',
  ]) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  write(
    root,
    'apps/desktop/src/services/eventStream.ts',
    'import { fromBinary } from "proto";\nconst schema = StreamEventSchema;\n',
  );
  write(
    root,
    'apps/desktop/src/services/socialRealtime.ts',
    'import { fromBinary } from "proto";\nFriendChatMessageSchema;\nGroupMessageSchema;\n',
  );
  write(
    root,
    'apps/mobile/src/features/social/socialWire.ts',
    'StreamEventSchema;\nFriendChatMessageSchema;\nGroupMessageSchema;\n',
  );
  return root;
}

test('accepts generated social wire decoding and runtime-owned UI', (t) => {
  const root = fixtureRoot(t);

  assert.deepEqual(checkSocialWire(root), []);
  assert.deepEqual(checkSocialRuntimeBoundaries(root), []);
  assert.equal(runChecks(root).length, 3);
});

test('reports exact source line for hand-written wire decoding', (t) => {
  const root = fixtureRoot(t);
  write(
    root,
    'apps/desktop/src/store/unsafe.ts',
    'const ok = true;\nconst reader = new ProtoReader(bytes);\n',
  );

  const violations = checkSocialWire(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 2);
  assert.equal(violations[0].rule, 'desktop-social-wire-generated-proto-only');
});

test('ignores comments but rejects UI-owned runtime calls', (t) => {
  const root = fixtureRoot(t);
  write(
    root,
    'apps/desktop/src/pages/Example.tsx',
    '// startEventStream() belongs to runtime\nstartEventStream();\n',
  );

  const violations = checkSocialRuntimeBoundaries(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 2);
  assert.equal(violations[0].rule, 'ui-must-not-install-social-runtime');
});

test('fails when a required scan root is missing', (t) => {
  const root = fixtureRoot(t);
  fs.rmSync(path.join(root, 'apps', 'mobile', 'src', 'components'), {
    recursive: true,
  });

  assert.throws(
    () => runChecks(root),
    (error) =>
      error instanceof DevctlError
      && error.code === ERROR_CODES.CHECK_FAILED,
  );
});

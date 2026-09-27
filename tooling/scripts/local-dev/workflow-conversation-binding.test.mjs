import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  bindConversation,
  conversationBindingPath,
  conversationHash,
  listActiveConversationBindings,
  readConversationBinding,
  releaseConversation,
  resolveActiveConversationBinding,
} from './workflow-conversation-binding.mjs';

async function bindChild(moduleUrl, machineRoot, root, barrier) {
  const source = `
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { bindConversation } from ${JSON.stringify(moduleUrl)};
while (!existsSync(${JSON.stringify(barrier)})) await delay(5);
console.log(JSON.stringify(bindConversation(
  'cursor',
  'racing-conversation',
  ${JSON.stringify(root)},
  { machineRoot: ${JSON.stringify(machineRoot)} },
)));
`;
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', source],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout);
}

test('creates one immutable execution-root binding per host conversation', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-conversation-binding-'));
  try {
    const machineRoot = path.join(temporary, 'machine');
    const firstRoot = path.join(temporary, 'first');
    const secondRoot = path.join(temporary, 'second');
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    const first = bindConversation('cursor', 'secret-conversation', firstRoot, {
      machineRoot,
      now: new Date('2026-09-23T00:00:00.000Z'),
    });
    const second = bindConversation(
      'cursor',
      'secret-conversation',
      secondRoot,
      { machineRoot },
    );
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.binding.executionRoot, first.binding.executionRoot);
    assert.equal(
      readConversationBinding('cursor', 'secret-conversation', {
        machineRoot,
      }).digest,
      first.binding.digest,
    );
    const file = conversationBindingPath(
      'cursor',
      'secret-conversation',
      { machineRoot },
    );
    assert.equal(file.includes('secret-conversation'), false);
    if (process.platform !== 'win32') {
      assert.equal(lstatSync(file).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('concurrent first writers converge on one immutable binding', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-conversation-race-'));
  try {
    const machineRoot = path.join(temporary, 'machine');
    const firstRoot = path.join(temporary, 'first');
    const secondRoot = path.join(temporary, 'second');
    const barrier = path.join(temporary, 'start');
    mkdirSync(firstRoot);
    mkdirSync(secondRoot);
    const moduleUrl = new URL(
      './workflow-conversation-binding.mjs',
      import.meta.url,
    ).href;
    const first = bindChild(moduleUrl, machineRoot, firstRoot, barrier);
    const second = bindChild(moduleUrl, machineRoot, secondRoot, barrier);
    writeFileSync(barrier, '');
    const results = await Promise.all([first, second]);
    assert.equal(
      results[0].binding.executionRoot,
      results[1].binding.executionRoot,
    );
    assert.equal(
      results.filter((result) => result.created).length,
      1,
    );
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('rejects a machine store that is not owner-only', {
  skip: process.platform === 'win32',
}, () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-conversation-mode-'));
  try {
    const machineRoot = path.join(temporary, 'machine');
    const root = path.join(temporary, 'root');
    mkdirSync(machineRoot, { mode: 0o755 });
    mkdirSync(root);
    chmodSync(machineRoot, 0o755);
    assert.throws(
      () => bindConversation('codex', 'conversation', root, { machineRoot }),
      /owner-controlled directory/,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('release is create-once and bound to the exact anchor digest', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-conversation-release-'));
  try {
    const machineRoot = path.join(temporary, 'machine');
    const root = path.join(temporary, 'root');
    mkdirSync(root);
    const { binding } = bindConversation('trae', 'conversation', root, {
      machineRoot,
    });
    const released = releaseConversation(binding, 'a'.repeat(64), {
      machineRoot,
      now: new Date('2026-09-23T00:00:00.000Z'),
    });
    assert.equal(released.anchorDigest, 'a'.repeat(64));
    assert.equal(
      releaseConversation(binding, 'a'.repeat(64), { machineRoot }).digest,
      released.digest,
    );
    assert.equal(
      releaseConversation(binding, 'b'.repeat(64), { machineRoot })
        .anchorDigest,
      'b'.repeat(64),
    );
    assert.equal(
      conversationHash('trae', 'conversation').length,
      64,
    );
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('resolves one active reviewer binding after excluding the executor', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-conversation-reviewer-'));
  try {
    const machineRoot = path.join(temporary, 'machine');
    const root = path.join(temporary, 'root');
    mkdirSync(root);
    const executor = bindConversation('trae', 'executor', root, {
      machineRoot,
      now: new Date('2026-09-23T00:00:00.000Z'),
    }).binding;
    const reviewer = bindConversation('trae', 'reviewer', root, {
      machineRoot,
      now: new Date('2026-09-23T00:00:01.000Z'),
    }).binding;

    assert.deepEqual(
      listActiveConversationBindings(root, { machineRoot }).map(
        (binding) => binding.digest,
      ),
      [executor.digest, reviewer.digest],
    );
    assert.equal(
      resolveActiveConversationBinding(root, {
        machineRoot,
        excludeDigests: [executor.digest],
      }).digest,
      reviewer.digest,
    );

    releaseConversation(reviewer, 'c'.repeat(64), { machineRoot });
    assert.deepEqual(
      listActiveConversationBindings(root, { machineRoot }).map(
        (binding) => binding.digest,
      ),
      [executor.digest],
    );
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluateWorkflowEvent } from './workflow-kernel.mjs';

function fixture() {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'workflow-kernel-')),
  );
  mkdirSync(path.join(root, 'tooling', 'skills', 'pt-ew'), {
    recursive: true,
  });
  mkdirSync(path.join(root, 'tooling', 'scripts', 'local-dev'), {
    recursive: true,
  });
  writeFileSync(path.join(root, 'tooling', 'skills', 'pt-ew', 'SKILL.md'), '# fixture\n');
  writeFileSync(path.join(root, 'tooling', 'scripts', 'local-dev', 'dev-work.mjs'), '// fixture\n');
  execFileSync('git', ['init', '-b', 'feat/kernel'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'kernel@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Kernel Test'], { cwd: root });
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: initialize kernel fixture'], {
    cwd: root,
  });
  return root;
}

function cleanupFixture(root) {
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

function event(root, overrides = {}) {
  return {
    valid: true,
    host: 'trae',
    event: 'PRE_TOOL_USE',
    hostEvent: 'PreToolUse',
    workspaceRoots: [root],
    explicitTaskRoot: root,
    repositoryWorkingDirectory: root,
    toolWorkingDirectory: root,
    willEditFilepaths: [path.join(root, 'README.md')],
    ...overrides,
  };
}

test('FLOW-A01 Hook permits ordinary work without identity, declaration, or Plan', async () => {
  const root = fixture();
  try {
    const result = await evaluateWorkflowEvent(event(root));
    assert.equal(result.action, 'ALLOW');
    assert.equal(result.executionRoot, root);
    assert.match(result.additionalContext, /docs\/global\/workflow\.md/);
  } finally {
    cleanupFixture(root);
  }
});

test('FLOW-A04 unknown or malformed events are neutral', async () => {
  const result = await evaluateWorkflowEvent({
    valid: false,
    code: 'HOOK_PAYLOAD_INVALID',
  });
  assert.equal(result.action, 'NOOP');
  assert.equal(result.executionRoot, null);
});

test('FLOW-A04 missing workspace context does not deny the tool', async () => {
  const result = await evaluateWorkflowEvent({
    valid: true,
    event: 'PRE_TOOL_USE',
    workspaceRoots: [],
    executionRootHints: [],
  });
  assert.equal(result.action, 'ALLOW');
  assert.equal(result.code, 'WORKSPACE_CONTEXT_UNRESOLVED');
});

test('FLOW-A04 context lookup failure falls back to base project guidance', async () => {
  const root = fixture();
  try {
    const result = await evaluateWorkflowEvent(event(root), {
      buildPreEditContext: async () => {
        throw new Error('knowledge unavailable');
      },
    });
    assert.equal(result.action, 'ALLOW');
    assert.match(result.additionalContext, /Hook context is advisory/);
  } finally {
    cleanupFixture(root);
  }
});

test('FLOW-A04 Stop never blocks completion', async () => {
  const root = fixture();
  try {
    const result = await evaluateWorkflowEvent(
      event(root, {
        event: 'STOP',
        hostEvent: 'Stop',
        willEditFilepaths: [],
      }),
    );
    assert.equal(result.action, 'ALLOW');
  } finally {
    cleanupFixture(root);
  }
});

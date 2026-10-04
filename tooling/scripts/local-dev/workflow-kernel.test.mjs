import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateWorkflowEvent } from './workflow-kernel.mjs';

const REPO_ROOT = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'),
);

function projectRoot(parent, name) {
  const root = path.join(parent, name);
  mkdirSync(path.join(root, 'tooling/skills/pt-ew'), { recursive: true });
  mkdirSync(path.join(root, 'tooling/scripts/local-dev'), { recursive: true });
  writeFileSync(path.join(root, 'tooling/skills/pt-ew/SKILL.md'), '# test\n');
  writeFileSync(path.join(root, 'tooling/scripts/local-dev/dev-work.mjs'), '');
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  return realpathSync(root);
}

function event(overrides = {}) {
  return {
    valid: true,
    host: 'cursor',
    event: 'PRE_TOOL_USE',
    hostEvent: 'preToolUse',
    bindingIdentity: {
      rootChatId: 'conversation-1',
      executionSessionId: 'conversation-1',
      assignmentId: null,
    },
    executionRootHints: [],
    workspaceRoots: [],
    repositoryWorkingDirectory: null,
    toolWorkingDirectory: null,
    toolName: 'Read',
    toolInput: {},
    command: null,
    willEditFilepaths: [],
    lastAssistantMessage: null,
    transcriptPath: null,
    stopHookActive: false,
    loopCount: null,
    ...overrides,
  };
}

function binding(root) {
  return {
    kind: 'peers-touch-workflow-binding-projection',
    host: 'cursor',
    role: 'OWNER',
    bindingDigest: 'b'.repeat(64),
    rootBindingDigest: 'b'.repeat(64),
    parentBindingDigest: null,
    assignmentDigest: null,
    workflowSessionId: null,
    executionRoot: root,
    workspaceId: '0123456789abcdef',
    subjectRoots: [],
    toolRoot: null,
    targetRoots: [],
    released: false,
    childState: null,
  };
}

function injectedBinding(root, extras = {}) {
  return {
    resolveEventWorkflowBinding: () => ({
      mode: 'ENFORCED',
      projection: binding(root),
      binding: {
        kind: 'peers-touch-workflow-owner-binding',
        host: 'cursor',
        role: 'OWNER',
        rootChatHash: 'a'.repeat(64),
        executionRoot: root,
        workspaceId: '0123456789abcdef',
        boundAt: '2026-09-23T00:00:00.000Z',
        bindingEvent: 'PRE_TOOL_USE',
        digest: 'b'.repeat(64),
      },
      owner: {
        kind: 'peers-touch-workflow-owner-binding',
        host: 'cursor',
        role: 'OWNER',
        rootChatHash: 'a'.repeat(64),
        executionRoot: root,
        workspaceId: '0123456789abcdef',
        boundAt: '2026-09-23T00:00:00.000Z',
        bindingEvent: 'PRE_TOOL_USE',
        digest: 'b'.repeat(64),
      },
    }),
    recordWorkflowAction: false,
    ...extras,
  };
}

test('SessionStart prewarms but never creates the immutable binding', async () => {
  let bindCalls = 0;
  const result = await evaluateWorkflowEvent(
    event({ event: 'SESSION_START', hostEvent: 'sessionStart' }),
    {
      resolveEventWorkflowBinding: () => ({
        mode: 'PREWARM',
        projection: null,
      }),
    },
  );
  assert.equal(result.action, 'CONTEXT');
  assert.equal(result.enforcementMode, 'PENDING_BINDING');
  assert.equal(bindCalls, 0);
});

test('PreCompact records lineage and PostCompact verifies it before restoring context', async () => {
  const calls = [];
  const options = injectedBinding('/workspace', {
    inspectWorkflowContext: async () => ({ status: 'IDLE' }),
    recordWorkflowPreCompact: (projection) => {
      calls.push(['PRE', projection.bindingDigest]);
    },
    verifyWorkflowPostCompact: (projection) => {
      calls.push(['POST', projection.bindingDigest]);
    },
  });
  const pre = await evaluateWorkflowEvent(
    event({ event: 'PRE_COMPACT', hostEvent: 'PreCompact' }),
    options,
  );
  const post = await evaluateWorkflowEvent(
    event({ event: 'POST_COMPACT', hostEvent: 'PostCompact' }),
    options,
  );
  assert.equal(pre.action, 'CONTEXT');
  assert.equal(post.action, 'CONTEXT');
  assert.deepEqual(calls, [
    ['PRE', 'b'.repeat(64)],
    ['POST', 'b'.repeat(64)],
  ]);
});

test('PostCompact denies restoration when persisted lineage changed', async () => {
  const result = await evaluateWorkflowEvent(
    event({ event: 'POST_COMPACT', hostEvent: 'PostCompact' }),
    injectedBinding('/workspace', {
      inspectWorkflowContext: async () => ({ status: 'IDLE' }),
      verifyWorkflowPostCompact: () => {
        const error = new Error('compact lineage differs');
        error.code = 'WORKFLOW_COMPACT_LINEAGE_MISMATCH';
        throw error;
      },
    }),
  );
  assert.equal(result.action, 'DENY');
  assert.equal(result.code, 'WORKFLOW_COMPACT_LINEAGE_MISMATCH');
});

test('missing stable conversation identity denies mutation but permits safe reads', async () => {
  const mutation = await evaluateWorkflowEvent(
    event({
      bindingIdentity: {
        rootChatId: null,
        executionSessionId: null,
        assignmentId: null,
      },
      toolName: 'Write',
      toolInput: { file_path: '/tmp/file' },
    }),
  );
  assert.equal(mutation.action, 'DENY');
  assert.equal(mutation.enforcementMode, 'OBSERVE_ONLY');
  assert.equal(mutation.code, 'STABLE_CONVERSATION_ID_REQUIRED');

  const read = await evaluateWorkflowEvent(
    event({
      bindingIdentity: {
        rootChatId: null,
        executionSessionId: null,
        assignmentId: null,
      },
      toolName: 'Read',
      toolInput: { file_path: '/tmp/file' },
    }),
  );
  assert.equal(read.action, 'ALLOW');
  assert.equal(read.enforcementMode, 'OBSERVE_ONLY');
  assert.equal(read.code, 'OBSERVE_ONLY');
});

test('first PreToolUse binds once and later cross-worktree reads remain legal', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-kernel-roots-'));
  try {
    const first = projectRoot(temporary, 'first');
    const second = projectRoot(temporary, 'second');
    const machineRoot = path.join(temporary, 'machine');
    const initial = await evaluateWorkflowEvent(
      event({
        executionRootHints: [first],
        toolWorkingDirectory: first,
      }),
      { machineRoot },
    );
    assert.equal(initial.action, 'ALLOW');
    assert.equal(initial.executionRoot, realpathSync(first));

    const read = await evaluateWorkflowEvent(
      event({
        executionRootHints: [second],
        toolWorkingDirectory: second,
        toolName: 'Read',
        toolInput: { file_path: path.join(second, 'README.md') },
      }),
      { machineRoot },
    );
    assert.equal(read.action, 'ALLOW');
    assert.equal(read.executionRoot, realpathSync(first));
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('multi-root first mutation binds its target and rejects active-editor drift', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-kernel-multi-root-'));
  try {
    const bootstrap = projectRoot(temporary, 'bootstrap');
    const target = projectRoot(temporary, 'target');
    const machineRoot = path.join(temporary, 'machine');
    const inspectWorkflowContext = async () => ({
      status: 'READY',
      tracked: false,
      declaration: {
        sourceClaims: [{ mode: 'exclusive-write', pathPrefix: '.' }],
      },
    });
    const pendingRead = await evaluateWorkflowEvent(
      event({
        host: 'trae',
        hostEvent: 'PreToolUse',
        bindingIdentity: {
          rootChatId: 'multi-root-owner',
          executionSessionId: 'owner-session',
          assignmentId: null,
        },
        workspaceRoots: [bootstrap, target],
        repositoryWorkingDirectory: bootstrap,
        toolWorkingDirectory: bootstrap,
        toolName: 'Read',
        toolInput: { file_path: path.join(target, 'README.md') },
      }),
      {
        machineRoot,
        inspectWorkflowContext,
        recordWorkflowAction: false,
      },
    );
    assert.equal(pendingRead.action, 'ALLOW');
    assert.equal(pendingRead.enforcementMode, 'PENDING_BINDING');
    assert.equal(pendingRead.executionRoot, null);

    const selected = await evaluateWorkflowEvent(
      event({
        host: 'trae',
        hostEvent: 'PreToolUse',
        bindingIdentity: {
          rootChatId: 'multi-root-owner',
          executionSessionId: 'owner-session',
          assignmentId: null,
        },
        workspaceRoots: [bootstrap, target],
        repositoryWorkingDirectory: bootstrap,
        toolWorkingDirectory: bootstrap,
        toolName: 'Write',
        toolInput: { file_path: path.join(target, 'new.txt') },
      }),
      {
        machineRoot,
        inspectWorkflowContext,
        recordWorkflowAction: false,
      },
    );
    assert.equal(selected.action, 'ALLOW');
    assert.equal(selected.executionRoot, target);

    const mismatched = await evaluateWorkflowEvent(
      event({
        host: 'trae',
        hostEvent: 'PreToolUse',
        bindingIdentity: {
          rootChatId: 'mismatched-editor-owner',
          executionSessionId: 'owner-session',
          assignmentId: null,
        },
        workspaceRoots: [bootstrap, target],
        activeEditorPath: bootstrap,
        repositoryWorkingDirectory: bootstrap,
        toolWorkingDirectory: bootstrap,
        toolName: 'Write',
        toolInput: { file_path: path.join(target, 'new.txt') },
      }),
      {
        machineRoot,
        inspectWorkflowContext,
        recordWorkflowAction: false,
      },
    );
    assert.equal(mismatched.action, 'DENY');
    assert.equal(mismatched.code, 'WORKTREE_SELECTION_REQUIRED');
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('an existing conversation binding denies cross-worktree writes', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-kernel-cross-write-'));
  try {
    const first = projectRoot(temporary, 'first');
    const second = projectRoot(temporary, 'second');
    const result = await evaluateWorkflowEvent(
      event({
        toolWorkingDirectory: second,
        toolName: 'Write',
        toolInput: { file_path: path.join(second, 'new.txt') },
      }),
      injectedBinding(first),
    );
    assert.equal(result.action, 'DENY');
    assert.equal(result.code, 'CROSS_WORKTREE_WRITE_DENIED');
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('expired child lineage is denied before workflow inspection', async () => {
  const root = '/workspace';
  let inspections = 0;
  const owner = injectedBinding(root).resolveEventWorkflowBinding().owner;
  const result = await evaluateWorkflowEvent(
    event({
      host: 'trae',
      bindingIdentity: {
        rootChatId: 'visible-chat',
        executionSessionId: 'worker-session',
        assignmentId: 'worker-1',
      },
    }),
    injectedBinding(root, {
      resolveEventWorkflowBinding: () => ({
        mode: 'ENFORCED',
        owner,
        binding: {
          host: 'trae',
          role: 'WORKER',
          executionSessionHash: 'c'.repeat(64),
          rootBindingDigest: 'b'.repeat(64),
          digest: 'd'.repeat(64),
        },
        projection: {
          ...binding(root),
          host: 'trae',
          role: 'WORKER',
          bindingDigest: 'd'.repeat(64),
          rootBindingDigest: 'b'.repeat(64),
          parentBindingDigest: 'b'.repeat(64),
          assignmentDigest: 'e'.repeat(64),
          workflowSessionId: 'SESSION-1',
          childState: 'ASSIGNED',
        },
      }),
      inspectWorkflowContext: async () => {
        inspections += 1;
      },
    }),
  );
  assert.equal(result.action, 'DENY');
  assert.equal(result.code, 'WORKFLOW_CHILD_BINDING_NOT_LIVE');
  assert.equal(inspections, 0);
});

test('SubagentStop terminalizes the exact assigned child', async () => {
  const root = '/workspace';
  const calls = [];
  const owner = injectedBinding(root).resolveEventWorkflowBinding().owner;
  const storedChild = {
    host: 'trae',
    role: 'REVIEWER',
    executionSessionHash: 'c'.repeat(64),
    rootBindingDigest: 'b'.repeat(64),
    digest: 'd'.repeat(64),
  };
  const result = await evaluateWorkflowEvent(
    event({
      host: 'trae',
      event: 'SUBAGENT_STOP',
      hostEvent: 'SubagentStop',
      childResult: 'PASS',
      bindingIdentity: {
        rootChatId: 'visible-chat',
        executionSessionId: 'reviewer-session',
        assignmentId: 'reviewer-1',
      },
    }),
    injectedBinding(root, {
      resolveEventWorkflowBinding: () => ({
        mode: 'ENFORCED',
        owner,
        binding: storedChild,
        projection: {
          ...binding(root),
          host: 'trae',
          role: 'REVIEWER',
          bindingDigest: storedChild.digest,
          rootBindingDigest: 'b'.repeat(64),
          parentBindingDigest: 'b'.repeat(64),
          assignmentDigest: 'e'.repeat(64),
          workflowSessionId: 'SESSION-1',
          childState: 'LEASED',
        },
      }),
      terminalizeWorkflowChild: (...args) => calls.push(args),
    }),
  );
  assert.equal(result.action, 'ALLOW');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], storedChild);
  assert.equal(calls[0][1], 'PASS');
});

test('shell arguments cannot move a mutation into a sibling worktree', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-kernel-shell-root-'));
  try {
    const first = projectRoot(temporary, 'first');
    const second = projectRoot(temporary, 'second');
    const result = await evaluateWorkflowEvent(
      event({
        toolWorkingDirectory: first,
        toolName: 'exec_command',
        command: `rm ${path.join(second, 'new.txt')}`,
        toolInput: { command: `rm ${path.join(second, 'new.txt')}` },
      }),
      injectedBinding(first),
    );
    assert.equal(result.action, 'DENY');
    assert.equal(result.code, 'CROSS_WORKTREE_WRITE_DENIED');
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('shell mutation cwd cannot leave the execution root', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-kernel-shell-cwd-'));
  try {
    const root = projectRoot(temporary, 'root');
    const outside = path.join(temporary, 'outside');
    mkdirSync(outside);
    const result = await evaluateWorkflowEvent(
      event({
        toolWorkingDirectory: outside,
        toolName: 'exec_command',
        command: 'touch new.txt',
        toolInput: { command: 'touch new.txt' },
      }),
      injectedBinding(root),
    );
    assert.equal(result.action, 'DENY');
    assert.equal(result.code, 'CROSS_WORKTREE_WRITE_DENIED');
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('file writes cannot escape through a symlink inside the execution root', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-kernel-symlink-'));
  try {
    const root = projectRoot(temporary, 'root');
    const outside = path.join(temporary, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, path.join(root, 'escaped'));
    const result = await evaluateWorkflowEvent(
      event({
        toolWorkingDirectory: root,
        toolName: 'Write',
        toolInput: { file_path: path.join(root, 'escaped', 'new.txt') },
      }),
      injectedBinding(root),
    );
    assert.equal(result.action, 'DENY');
    assert.equal(result.code, 'CROSS_WORKTREE_WRITE_DENIED');
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('explicit file writes still enforce declaration source claims', async () => {
  const result = await evaluateWorkflowEvent(
    event({
      toolWorkingDirectory: '/workspace',
      toolName: 'apply_patch',
      toolInput: {
        patch: '*** Update File: /workspace/apps/desktop/file.ts\n',
      },
    }),
    injectedBinding('/workspace', {
      inspectWorkflowContext: async () => ({
        status: 'READY',
        tracked: false,
        declaration: {
          sourceClaims: [
            {
              mode: 'exclusive-write',
              pathPrefix: 'tooling/scripts',
            },
          ],
        },
      }),
    }),
  );
  assert.equal(result.action, 'DENY');
  assert.equal(result.code, 'SOURCE_SCOPE_DENIED');
});

test('shell mutations enforce declaration scope from parsed targets', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-kernel-shell-scope-'));
  try {
    const root = projectRoot(temporary, 'root');
    const target = path.join(root, 'apps/desktop/file.ts');
    const command = `touch ${target}`;
    const result = await evaluateWorkflowEvent(
      event({
        toolWorkingDirectory: root,
        toolName: 'exec_command',
        command,
        toolInput: { command },
      }),
      injectedBinding(root, {
        inspectWorkflowContext: async () => ({
          status: 'READY',
          tracked: false,
          declaration: {
            sourceClaims: [
              { mode: 'exclusive-write', pathPrefix: 'tooling/scripts' },
            ],
          },
        }),
      }),
    );
    assert.equal(result.action, 'DENY');
    assert.equal(result.code, 'SOURCE_SCOPE_DENIED');
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('multiline shell injection is denied before owner-state inspection', async () => {
  const result = await evaluateWorkflowEvent(
    event({
      toolName: 'exec_command',
      command: 'cat README.md\nrm generated.txt',
      toolInput: { command: 'cat README.md\nrm generated.txt' },
    }),
    injectedBinding('/workspace', {
      inspectWorkflowContext: async () => {
        throw new Error('must not inspect');
      },
    }),
  );
  assert.equal(result.action, 'DENY');
  assert.equal(result.code, 'SHELL_DYNAMIC_SYNTAX_DENIED');
});

test('unknown host tools fail closed instead of bypassing intent policy', async () => {
  const result = await evaluateWorkflowEvent(
    event({
      toolName: 'UnknownMutationTool',
      toolInput: { destination: '/workspace/file' },
    }),
    injectedBinding('/workspace'),
  );
  assert.equal(result.action, 'DENY');
  assert.equal(result.code, 'TOOL_INTENT_UNSUPPORTED');
});

test('Stop blocks an active Plan even when an anchor is already present', async () => {
  const root = '/workspace';
  const result = await evaluateWorkflowEvent(
    event({
      event: 'STOP',
      hostEvent: 'stop',
      lastAssistantMessage: '**Context Anchor**',
    }),
    injectedBinding(root, {
      inspectWorkflowContext: async () => ({
        status: 'READY',
        tracked: true,
        binding: { planId: 'PLAN-1', planPath: 'plan.md' },
        planPackage: {
          manifest: {
            status: 'active',
            binding: { initialHead: 'head' },
            tasks: [{ id: 'TASK-1', status: 'in_progress' }],
          },
        },
        currentTask: { id: 'TASK-1', status: 'in_progress' },
        declaration: { workItemId: 'WORK-1', sessionId: 'SESSION-1' },
        session: { state: { state: 'IMPLEMENTING' } },
        branch: 'main',
        head: 'head',
      }),
      writeWorkflowAnchorReceipt: () => {},
    }),
  );
  assert.equal(result.action, 'CONTINUE');
  assert.equal(result.code, 'PLAN_RUN_CONTINUES');
  assert.match(result.followupMessage, /Context Anchor/);
});

test('Stop requires the exact rendered anchor before atomic release', async () => {
  const root = '/workspace';
  let releaseCount = 0;
  const options = injectedBinding(root, {
    inspectWorkflowContext: async () => ({
      status: 'TERMINAL',
      tracked: true,
      binding: { planId: 'PLAN-1', planPath: 'plan.md' },
      planPackage: {
        manifest: {
          status: 'completed',
          binding: { initialHead: 'head' },
          tasks: [{ id: 'TASK-1', status: 'done' }],
        },
      },
      branch: 'main',
      head: 'head',
    }),
    writeWorkflowAnchorReceipt: () => {},
    releaseWorkflowOwner: () => {
      releaseCount += 1;
    },
  });
  const first = await evaluateWorkflowEvent(
    event({ event: 'STOP', hostEvent: 'stop' }),
    options,
  );
  assert.equal(first.action, 'CONTINUE');
  assert.equal(first.code, 'CONTEXT_ANCHOR_REQUIRED');
  assert.equal(releaseCount, 0);

  const second = await evaluateWorkflowEvent(
    event({
      event: 'STOP',
      hostEvent: 'stop',
      lastAssistantMessage: first.followupMessage,
    }),
    options,
  );
  assert.equal(second.action, 'ALLOW');
  assert.equal(second.enforcementMode, 'RELEASED');
  assert.equal(releaseCount, 1);
});

test('bound mutations emit one redacted action receipt without changing admission', async () => {
  const receipts = [];
  const result = await evaluateWorkflowEvent(
    event({
      toolWorkingDirectory: '/workspace',
      toolName: 'Write',
      toolInput: { file_path: '/workspace/tooling/scripts/file.mjs' },
    }),
    injectedBinding('/workspace', {
      inspectWorkflowContext: async () => ({
        status: 'READY',
        tracked: true,
        declaration: {
          workItemId: 'WORK-1',
          planId: 'PLAN-1',
          taskId: 'TASK-1',
          sessionId: 'SESSION-1',
          sourceClaims: [
            { mode: 'exclusive-write', pathPrefix: 'tooling/scripts' },
          ],
        },
        session: {
          eventDigest: 'c'.repeat(64),
          state: { state: 'IMPLEMENTING' },
        },
      }),
      recordWorkflowAction: (receipt) => receipts.push(receipt),
    }),
  );
  assert.equal(result.action, 'ALLOW');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].event, 'STARTED');
  assert.equal(receipts[0].actor.role, 'OWNER');
  assert.equal(receipts[0].actor.rootBindingDigest, 'b'.repeat(64));
  assert.equal(receipts[0].operation.family, 'WRITE');
  assert.equal(receipts[0].operation.targetRef, 'tooling/scripts/file.mjs');
  assert.equal('toolInput' in receipts[0], false);
});

test('admitted repository writes load the real shared governance context', async () => {
  const result = await evaluateWorkflowEvent(
    event({
      toolWorkingDirectory: REPO_ROOT,
      toolName: 'Write',
      toolInput: {
        file_path: path.join(
          REPO_ROOT,
          'tooling/scripts/plan/plan-package.mjs',
        ),
      },
    }),
    injectedBinding(REPO_ROOT, {
      inspectWorkflowContext: async () => ({
        status: 'READY',
        tracked: true,
        declaration: {
          sourceClaims: [
            {
              mode: 'exclusive-write',
              pathPrefix: 'tooling/scripts/plan',
            },
          ],
        },
      }),
    }),
  );

  assert.equal(result.action, 'ALLOW');
  assert.equal(
    result.contextReceipt.kind,
    'peers-touch-pre-edit-context',
  );
  assert.deepEqual(
    result.contextReceipt.architecture.map((entry) => entry.moduleId),
    ['architecture-module-governance'],
  );
  assert.match(result.additionalContext, /PT_PRE_EDIT_CONTEXT/);
});

test('pre-edit context failure denies a previously scoped write', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-kernel-governance-'));
  try {
    const root = projectRoot(temporary, 'root');
    mkdirSync(
      path.join(root, 'docs/architecture/architecture-module-governance'),
      { recursive: true },
    );
    const result = await evaluateWorkflowEvent(
      event({
        toolWorkingDirectory: root,
        toolName: 'Write',
        toolInput: {
          file_path: path.join(root, 'tooling/scripts/file.mjs'),
        },
      }),
      injectedBinding(root, {
        inspectWorkflowContext: async () => ({
          status: 'READY',
          tracked: true,
          declaration: {
            sourceClaims: [
              { mode: 'exclusive-write', pathPrefix: 'tooling/scripts' },
            ],
          },
        }),
      }),
    );

    assert.equal(result.action, 'DENY');
    assert.equal(result.code, 'ARCHITECTURE_REGISTRY_INVALID');
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('PreToolUse starts heartbeat and PostToolUse records terminal completion', async () => {
  const recorded = [];
  const heartbeats = [];
  const inspection = {
    status: 'READY',
    tracked: true,
    declaration: {
      workItemId: 'WORK-1',
      planId: 'PLAN-1',
      taskId: 'TASK-1',
      sessionId: 'SESSION-1',
      sourceClaims: [
        { mode: 'exclusive-write', pathPrefix: 'tooling/scripts' },
      ],
    },
    session: {
      eventDigest: 'c'.repeat(64),
      state: { state: 'IMPLEMENTING' },
    },
  };
  const options = injectedBinding('/workspace', {
    inspectWorkflowContext: async () => inspection,
    recordWorkflowAction: (input) => {
      recorded.push(input);
      return { actionId: input.actionId ?? 'tool-call-1' };
    },
    startWorkflowActionHeartbeat: (input) => heartbeats.push(input),
  });
  const pre = await evaluateWorkflowEvent(
    event({
      actionId: 'tool-call-1',
      toolWorkingDirectory: '/workspace',
      toolName: 'Write',
      toolInput: { file_path: '/workspace/tooling/scripts/file.mjs' },
    }),
    options,
  );
  const post = await evaluateWorkflowEvent(
    event({
      actionId: 'tool-call-1',
      event: 'POST_TOOL_USE',
      hostEvent: 'PostToolUse',
      toolWorkingDirectory: '/workspace',
      toolName: 'Write',
      toolInput: { file_path: '/workspace/tooling/scripts/file.mjs' },
    }),
    options,
  );
  assert.equal(pre.action, 'ALLOW');
  assert.equal(post.action, 'ALLOW');
  assert.deepEqual(
    recorded.map((item) => [item.event, item.result]),
    [
      ['STARTED', 'RUNNING'],
      ['FINISHED', 'PASS'],
    ],
  );
  assert.equal(heartbeats.length, 1);
  assert.equal(heartbeats[0].actionId, 'tool-call-1');
});

test('the exact OWNER integration control action receives one grant', async () => {
  const grants = [];
  const inspection = {
    status: 'READY',
    tracked: true,
    declaration: {
      workItemId: 'WORK-1',
      planId: 'PLAN-1',
      taskId: 'TASK-1',
      sessionId: 'SESSION-1',
      sourceClaims: [],
    },
    session: {
      eventDigest: 'c'.repeat(64),
      state: { state: 'IMPLEMENTING' },
    },
  };
  for (const label of ['skills', 'skills-hard-cut', 'skills-gc']) {
    const actionId = `${label}-action`;
    const result = await evaluateWorkflowEvent(
      event({
        actionId,
        toolWorkingDirectory: '/workspace',
        toolName: 'Shell',
        command: `make ${label} IDE=codex`,
        toolInput: {
          command: `make ${label} IDE=codex`,
          working_directory: '/workspace',
        },
      }),
      injectedBinding('/workspace', {
        inspectWorkflowContext: async () => inspection,
        recordWorkflowAction: () => ({ actionId }),
        issueWorkflowActionGrant: (receipt) => grants.push(receipt.actionId),
        startWorkflowActionHeartbeat: false,
      }),
    );
    assert.equal(result.action, 'ALLOW');
  }
  assert.deepEqual(grants, [
    'skills-action',
    'skills-hard-cut-action',
    'skills-gc-action',
  ]);
});

test('PostToolUse cannot create the first binding or emit an action receipt', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-kernel-post-bind-'));
  try {
    const root = projectRoot(temporary, 'root');
    let bindCalls = 0;
    let receiptCalls = 0;
    const result = await evaluateWorkflowEvent(
      event({
        event: 'POST_TOOL_USE',
        hostEvent: 'PostToolUse',
        actionId: 'tool-call-1',
        executionRootHints: [root],
        toolWorkingDirectory: root,
        toolName: 'Write',
        toolInput: { file_path: path.join(root, 'file.txt') },
      }),
      {
        resolveEventWorkflowBinding: () => ({
          mode: 'PREWARM',
          projection: null,
        }),
        recordWorkflowAction: () => {
          receiptCalls += 1;
        },
      },
    );

    assert.equal(result.action, 'ALLOW');
    assert.equal(result.enforcementMode, 'PENDING_BINDING');
    assert.equal(bindCalls, 0);
    assert.equal(receiptCalls, 0);
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';
import {
  inspectStopContext,
  inspectWorkflowContext,
  resolveExecutionRoot,
  resolveProjectRoot,
} from './workflow-state-inspector.mjs';

function projectRoot(parent) {
  const root = path.join(parent, 'workspace');
  mkdirSync(path.join(root, 'tooling/skills/pt-ew'), { recursive: true });
  mkdirSync(path.join(root, 'tooling/scripts/local-dev'), { recursive: true });
  writeFileSync(path.join(root, 'tooling/skills/pt-ew/SKILL.md'), '# test\n');
  writeFileSync(path.join(root, 'tooling/scripts/local-dev/dev-work.mjs'), '');
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'fixture'], {
    cwd: root,
    stdio: 'ignore',
  });
  return realpathSync(root);
}

test('resolves only canonical Peers-Touch roots', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-state-root-'));
  try {
    const root = projectRoot(temporary);
    assert.equal(resolveProjectRoot(path.join(root, 'tooling')), root);
    assert.equal(
      resolveExecutionRoot({ executionRootHints: ['/missing', root] }),
      root,
    );
    assert.equal(resolveProjectRoot(temporary), null);
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('treats an unbound root as idle at Stop without inventing a Plan', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-state-idle-'));
  const previousMachineRoot = process.env.PT_MACHINE_DEV_ROOT;
  try {
    const root = projectRoot(temporary);
    process.env.PT_MACHINE_DEV_ROOT = path.join(temporary, 'machine');
    const result = await inspectStopContext(
      {
        executionRoot: root,
        workspaceId: workspaceIdForRoot(root),
      },
      async () => ({
        status: 'HARD_BLOCK',
        code: 'WORK_DECLARATION_REQUIRED',
        message: 'missing',
      }),
    );
    assert.equal(result.status, 'IDLE');
    assert.equal(result.tracked, false);
  } finally {
    if (previousMachineRoot === undefined) {
      delete process.env.PT_MACHINE_DEV_ROOT;
    } else {
      process.env.PT_MACHINE_DEV_ROOT = previousMachineRoot;
    }
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

test('joins Plan, declaration, Session, and active-work owners by task ID', async () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-state-ready-'));
  try {
    const root = projectRoot(temporary);
    const workspaceId = workspaceIdForRoot(root);
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    const declaration = {
      workItemId: 'WORK-1',
      sessionId: 'SESSION-1',
      planId: 'PLAN-1',
      planPath: 'docs/plan.md',
      planDigest: 'a'.repeat(64),
      mountId: 'mount-1',
      runId: 'run-1',
      taskId: 'TASK-1',
      workspaceId,
      branch,
      sourceHead: head,
      sourceClaims: [],
      state: 'ACTIVE',
      heartbeatAt: '2026-09-23T00:01:00.000Z',
      expiresAt: '2026-09-24T00:00:00.000Z',
    };
    const session = {
      state: {
        sessionId: declaration.sessionId,
        workItemId: declaration.workItemId,
        planId: declaration.planId,
        taskId: declaration.taskId,
        workspaceId,
        branch,
        state: 'IMPLEMENTING',
      },
    };
    const activeWork = {
      workspaceId,
      workItemId: declaration.workItemId,
      sessionId: declaration.sessionId,
      planId: declaration.planId,
      planPath: declaration.planPath,
      mountId: declaration.mountId,
      runId: declaration.runId,
      snapshotDigest: 'b'.repeat(64),
      currentTaskId: declaration.taskId,
      devState: session.state.state,
      branch,
      expectedHead: head,
    };
    let sessionOptions = null;
    const result = await inspectWorkflowContext(
      { executionRoot: root, workspaceId },
      {
        now: new Date('2026-09-23T12:00:00.000Z'),
        ledgerPath: '/machine/work.json',
        readLedger(file) {
          assert.equal(file, '/machine/work.json');
          return { declarations: { declaration } };
        },
        async resolvePlanExecution(options) {
          assert.equal(options.repoRoot, root);
          return {
            mount: {
              planId: declaration.planId,
              planPath: declaration.planPath,
              planDigest: declaration.planDigest,
              mountId: declaration.mountId,
            },
            snapshot: {
              recordDigest: activeWork.snapshotDigest,
              planDigest: declaration.planDigest,
              plan: {
                tasks: [{ id: declaration.taskId }],
              },
            },
            run: {
              runId: declaration.runId,
              currentTaskId: declaration.taskId,
              taskStates: {
                [declaration.taskId]: {
                  state: 'in_progress',
                  blocker: null,
                },
              },
            },
            planPackage: { path: path.join(root, 'docs/plan.md') },
          };
        },
        readActiveWorkRecord(options) {
          assert.equal(options.repoRoot, root);
          return activeWork;
        },
        loadSessionStore(options) {
          sessionOptions = options;
          return session;
        },
      },
    );

    assert.equal(result.status, 'READY');
    assert.equal(result.currentTask.id, 'TASK-1');
    assert.equal(result.activeWork, activeWork);
    assert.equal(sessionOptions.expected.taskId, 'TASK-1');
    assert.equal(sessionOptions.expected.sessionId, 'SESSION-1');
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});

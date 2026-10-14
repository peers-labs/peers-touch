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

import { createTaskProgress } from './task-progress-store.mjs';
import {
  inspectStandaloneWorkflowContext,
  resolveProjectRoot,
} from './workflow-state-inspector.mjs';

function projectRoot(parent) {
  const root = path.join(parent, 'workspace');
  mkdirSync(path.join(root, 'tooling/skills/pt-ew'), { recursive: true });
  mkdirSync(path.join(root, 'tooling/scripts/local-dev'), { recursive: true });
  writeFileSync(path.join(root, 'tooling/skills/pt-ew/SKILL.md'), '# test\n');
  writeFileSync(path.join(root, 'tooling/scripts/local-dev/dev-work.mjs'), '');
  execFileSync('git', ['init', '-b', 'feat/standalone-state'], {
    cwd: root,
    stdio: 'ignore',
  });
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

async function withProject(prefix, operation) {
  const temporary = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    return await operation(projectRoot(temporary));
  } finally {
    rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
}

test('resolves only canonical Peers-Touch roots', async () => {
  await withProject('pt-state-root-', (root) => {
    assert.equal(resolveProjectRoot(path.join(root, 'tooling')), root);
    assert.equal(resolveProjectRoot(path.dirname(root)), null);
  });
});

test('FLOW-A01 ordinary work is READY without Plan, declaration, or Session', async () => {
  await withProject('pt-state-ordinary-', (root) => {
    const result = inspectStandaloneWorkflowContext({ workspaceRoot: root });
    assert.equal(result.status, 'READY');
    assert.equal(result.mode, 'standalone');
    assert.equal(result.tracked, false);
    assert.equal(result.task, null);
    assert.equal(result.canonicalRoot, root);
  });
});

test('FLOW-A09 an explicit task is projected from task-local state', async () => {
  await withProject('pt-state-task-', async (root) => {
    const task = createTaskProgress({
      workspaceRoot: root,
      taskId: 'FLOW-TASK-1',
      goal: 'Project one explicit task.',
      contribution: 'Keep workflow status task-local.',
    });
    const result = inspectStandaloneWorkflowContext({
      workspaceRoot: root,
      taskId: task.taskId,
    });
    assert.equal(result.status, 'READY');
    assert.equal(result.tracked, true);
    assert.equal(result.task.taskId, task.taskId);
    assert.equal(result.task.revision, 1);
    assert.equal(result.task.projectionState, 'current');
    assert.equal(Object.hasOwn(result, 'activeWork'), false);
    assert.equal(Object.hasOwn(result, 'session'), false);
  });
});

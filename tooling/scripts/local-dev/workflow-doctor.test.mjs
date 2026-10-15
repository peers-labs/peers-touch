import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  evaluateStandaloneWorkflowDoctor,
  workflowDoctorExitCode,
} from './workflow-doctor.mjs';

function fixture(t) {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'workflow-doctor-')),
  );
  t.after(() =>
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }));
  execFileSync('git', ['init', '-b', 'feat/doctor'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'doctor@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Doctor Test'], { cwd: root });
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: root });
  writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: initialize fixture'], {
    cwd: root,
  });
  return root;
}

test('FLOW-A18 Doctor needs no Plan, OWNER, declaration, or Session', async (t) => {
  const root = fixture(t);
  const report = await evaluateStandaloneWorkflowDoctor(
    { repoRoot: root, host: 'trae' },
    {
      now: () => new Date('2026-10-13T12:00:00.000Z'),
      auditIntegration: () => {
        throw Object.assign(new Error('optional Hook missing'), {
          code: 'HOOK_UNAVAILABLE',
        });
      },
    },
  );
  assert.equal(report.status, 'PASS');
  assert.equal(report.mode, 'standalone');
  assert.equal(report.source.branch, 'feat/doctor');
  assert.equal(report.taskCount, 0);
  assert.deepEqual(report.findings, [
    { severity: 'notice', code: 'HOOK_UNAVAILABLE' },
  ]);
  assert.equal(workflowDoctorExitCode(report), 0);
});

test('FLOW-A18 only current-source failure blocks Doctor', async (t) => {
  const root = fixture(t);
  const report = await evaluateStandaloneWorkflowDoctor(
    { repoRoot: root },
    {
      buildSnapshot: async () => {
        throw Object.assign(new Error('source unavailable'), {
          code: 'WORKFLOW_SNAPSHOT_UNAVAILABLE',
        });
      },
      auditIntegration: () => ({ status: 'PASS' }),
    },
  );
  assert.equal(report.status, 'BLOCKED');
  assert.equal(workflowDoctorExitCode(report), 2);
});

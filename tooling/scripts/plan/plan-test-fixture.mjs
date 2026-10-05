import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CREATED_AT = '2026-10-05T00:00:00.000Z';

function writeJsonBlock(value) {
  return JSON.stringify(value, null, 2);
}

function writePlanPackage(repoRoot, slug, planId, taskId) {
  const packageDirectory = path.join(repoRoot, 'plans', slug);
  const tasksDirectory = path.join(packageDirectory, 'tasks');
  fs.mkdirSync(tasksDirectory, { recursive: true });

  const closureId = `${slug}-closure`;
  const plan = {
    kind: 'peers-touch-plan-version',
    planId,
    versionId: `${planId}-v1`,
    createdAt: CREATED_AT,
    workClass: 'infrastructure',
    architecture: {
      sources: ['docs/architecture/source.md'],
      decisions: [],
    },
    scope: {
      sourceClaims: [
        {
          pathPrefix: 'docs',
          mode: 'exclusive-write',
        },
      ],
      nonGoals: [],
    },
    tasks: [
      {
        id: taskId,
        workstreamId: 'FIXTURE-WORKSTREAM',
        path: `tasks/${taskId}.md`,
        dependsOn: [],
      },
    ],
    authorization: {
      checkpoint: {
        localCommit: 'allowed',
        amend: 'denied',
      },
      delivery: {
        push: 'denied',
        pullRequest: 'denied',
      },
      runtime: {
        deployProfiles: [],
        destructiveResetScopes: [],
      },
      history: {
        rewrite: 'denied',
      },
    },
  };
  const acceptance = {
    closures: {
      [closureId]: [],
    },
    completion: [],
    full: [],
  };
  const task = {
    kind: 'peers-touch-task-slice',
    planId,
    taskId,
    workstreamId: 'FIXTURE-WORKSTREAM',
    title: 'Exercise Plan runtime ownership',
    workClass: 'infrastructure',
    completionClass: 'source',
    executionMode: 'build',
    closureId,
    journeyId: 'FIXTURE-J01',
    runtimeClass: 'source-only',
    writeSet: ['docs'],
    readSet: [],
    budgets: {
      focusedCheckSeconds: 30,
      functionalRunSeconds: 30,
      cleanupSeconds: 30,
    },
    checks: [
      {
        id: 'fixture-source',
        command: 'true',
        verificationClass: 'SOURCE_CHECK',
      },
    ],
    doneWhen: ['The fixture Plan can be mounted and projected.'],
    failureBehavior: ['Fail closed on invalid fixture state.'],
    updatedAt: CREATED_AT,
  };

  const planPath = path.join(packageDirectory, 'plan.md');
  fs.writeFileSync(
    planPath,
    [
      `# ${planId}`,
      '',
      `> **Plan ID**: ${plan.planId}`,
      `> **Version ID**: ${plan.versionId}`,
      `> **Created**: ${plan.createdAt}`,
      '',
      '## Plan Version',
      '',
      '```json',
      writeJsonBlock(plan),
      '```',
      '',
      '## Acceptance Execution',
      '',
      '```json',
      writeJsonBlock(acceptance),
      '```',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(tasksDirectory, `${taskId}.md`),
    [
      `# ${taskId}`,
      '',
      '## Task Slice',
      '',
      '```json',
      writeJsonBlock(task),
      '```',
      '',
      '## Current Snapshot',
      '',
      '- Test fixture only.',
      '',
    ].join('\n'),
  );

  return path.relative(repoRoot, planPath).split(path.sep).join('/');
}

export function createPlanRepository(t) {
  const repoDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'plan-repository-test-'),
  );
  const repoRoot = fs.realpathSync(repoDirectory);
  const home = fs.mkdtempSync(
    path.join(os.tmpdir(), 'plan-machine-home-test-'),
  );
  t.after(() => {
    fs.rmSync(repoDirectory, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(repoRoot, 'docs', 'architecture'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(repoRoot, 'docs', 'architecture', 'source.md'),
    '# Fixture architecture source\n',
  );
  const plan = writePlanPackage(
    repoRoot,
    'primary',
    'FIXTURE-PLAN',
    'FIXTURE-TASK',
  );
  const otherPlan = writePlanPackage(
    repoRoot,
    'secondary',
    'FIXTURE-PLAN-SECONDARY',
    'FIXTURE-TASK-SECONDARY',
  );

  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Plan Fixture'], {
    cwd: repoRoot,
  });
  execFileSync('git', ['config', 'user.email', 'plan-fixture@test.invalid'], {
    cwd: repoRoot,
  });
  execFileSync('git', ['add', '.'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-m', 'test: create plan fixture'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });

  return {
    repoRoot,
    home,
    plan,
    otherPlan,
  };
}

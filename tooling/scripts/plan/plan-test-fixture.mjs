import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { digestOutcomePlannedSection } from './plan-package.mjs';

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
    outcomeComparison: {
      path: 'outcome-comparison.md',
    },
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
  const outcomeCriteria = [
    ['UX-01', 'user-experience', 'User experience'],
    ['PRODUCT-01', 'product-capability', 'Product capability'],
    ['ARCH-01', 'architecture', 'Architecture'],
    ['TECH-01', 'technology', 'Technology'],
    ['QUALITY-01', 'quality-operations', 'Quality and operations'],
  ].map(([id, dimension, title]) => ({
    id,
    dimension,
    title,
    taskIds: [taskId],
    gateIds: [],
  }));
  const plannedOutcomeSection = outcomeCriteria
    .map(
      (criterion) =>
        [
          `### ${criterion.id}: ${criterion.title}`,
          '',
          '- Before: fixture baseline.',
          '- Target: fixture target.',
          '- Expected effect: fixture effect.',
        ].join('\n'),
    )
    .join('\n\n');
  const outcomeContract = {
    kind: 'peers-touch-outcome-comparison-contract',
    schemaVersion: 1,
    planId,
    plannedSectionDigest: digestOutcomePlannedSection(
      plannedOutcomeSection,
    ),
    criteria: outcomeCriteria,
  };
  const outcomeResults = {
    kind: 'peers-touch-outcome-comparison-results',
    schemaVersion: 1,
    planId,
    sourceIdentity: null,
    items: outcomeCriteria.map((criterion) => ({
      id: criterion.id,
      status: 'UNPROVEN',
      actualEffect: 'The fixture has not executed.',
      evidenceRefs: [],
      deviation: 'Execution has not started.',
    })),
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
    path.join(packageDirectory, 'outcome-comparison.md'),
    [
      `# ${planId} Outcome Comparison`,
      '',
      '## Outcome Comparison Contract',
      '',
      '```json',
      writeJsonBlock(outcomeContract),
      '```',
      '',
      '## Planned Outcome Comparison',
      '',
      plannedOutcomeSection,
      '',
      '## Actual Outcome Results',
      '',
      '```json outcome-comparison-results',
      writeJsonBlock(outcomeResults),
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
    fs.rmSync(repoDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    fs.rmSync(home, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
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
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], {
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

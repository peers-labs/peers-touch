#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';

import { isDirectInvocation } from '../lib/machine-dev-paths.mjs';

export const RETIRED_PATHS = [
  'tooling/scripts/local-dev/active-work-store.mjs',
  'tooling/scripts/local-dev/active-work-store.test.mjs',
  'tooling/scripts/local-dev/active-work.mjs',
  'tooling/scripts/local-dev/development-close-store.mjs',
  'tooling/scripts/local-dev/dev-resource-plan.mjs',
  'tooling/scripts/local-dev/dev-resource-plan.test.mjs',
  'tooling/scripts/local-dev/dev-session-schema.mjs',
  'tooling/scripts/local-dev/dev-session-store.mjs',
  'tooling/scripts/local-dev/dev-session.mjs',
  'tooling/scripts/local-dev/dev-session.test.mjs',
  'tooling/scripts/local-dev/dev-work-ledger.mjs',
  'tooling/scripts/local-dev/dev-work-schema.mjs',
  'tooling/scripts/local-dev/workflow-action-store.mjs',
  'tooling/scripts/local-dev/workflow-action-store.test.mjs',
  'tooling/scripts/local-dev/workflow-anchor.mjs',
  'tooling/scripts/local-dev/workflow-anchor.test.mjs',
  'tooling/scripts/local-dev/workflow-binding-projection.mjs',
  'tooling/scripts/local-dev/workflow-binding-projection.test.mjs',
  'tooling/scripts/local-dev/workflow-binding-store.mjs',
  'tooling/scripts/local-dev/workflow-binding-store.test.mjs',
  'tooling/scripts/local-dev/workflow-binding.mjs',
  'tooling/scripts/local-dev/workflow-binding.test.mjs',
  'tooling/scripts/local-dev/workflow-owner-command-policy.mjs',
  'tooling/scripts/local-dev/workflow-owner-context.mjs',
  'tooling/scripts/local-dev/workflow-owner-context.test.mjs',
  'tooling/scripts/local-dev/workflow-owner-reference.mjs',
  'tooling/scripts/local-dev/workflow-snapshot-core.mjs',
  'tooling/scripts/local-dev/workflow-tool-intent.mjs',
  'tooling/scripts/local-dev/workflow-tool-intent.test.mjs',
  'tooling/scripts/local-dev/worktree-create.mjs',
  'tooling/scripts/local-dev/worktree-create.test.mjs',
  'tooling/scripts/plan/acceptance-admission.mjs',
  'tooling/scripts/plan/acceptance-admission.test.mjs',
  'tooling/scripts/plan/acceptance_admission.py',
  'tooling/scripts/plan/acceptance_admission_test.py',
  'tooling/scripts/plan/plan-completion.mjs',
  'tooling/scripts/plan/plan-completion.test.mjs',
  'tooling/scripts/plan/plan-mount.mjs',
  'tooling/scripts/plan/plan-mount.test.mjs',
  'tooling/scripts/plan/stable-plan-state-migration.mjs',
  'tooling/scripts/plan/stable-plan-state-migration.test.mjs',
  'tooling/acceptance/gates/development_flow/trae_host_e2e.py',
  'tooling/acceptance/gates/development_flow/trae_host_e2e_test.py',
  'tooling/skills/pt-completion-auditor/scripts/completion-audit.mjs',
  'tooling/skills/pt-completion-auditor/scripts/completion-audit-schema.mjs',
  'tooling/skills/pt-completion-auditor/scripts/completion-audit.test.mjs',
];

export const HISTORICAL_EXCLUSIONS = [
  'docs/**/execution-plans/**',
  'docs/architecture/engineering/development-workflow/decisions.md',
  'docs/architecture/engineering/local-dev/decisions.md',
  'docs/knowledge/invariants/conversation-bound-workflow-kernel.md',
  'docs/knowledge/invariants/development-close-is-coordinated.md',
  'docs/knowledge/invariants/dev-resource-declaration-before-write.md',
  'docs/knowledge/invariants/functional-before-broad-acceptance.md',
  'docs/knowledge/invariants/machine-ledger-workspace-isolation.md',
  'docs/knowledge/invariants/owner-rooted-workflow-binding.md',
  'docs/knowledge/invariants/plan-mount-is-run-bound.md',
  'docs/knowledge/invariants/stable-plan-amendments.md',
  'docs/knowledge/invariants/workspace-active-work-is-local.md',
];

export const ALLOWED_NEGATIVE_REFERENCES = [
  'docs/global/workflow.md',
  'docs/architecture/engineering/development-workflow/data-model.md',
  'docs/architecture/engineering/development-workflow/design.md',
  'docs/architecture/engineering/development-workflow/module-layout.md',
  'tooling/scripts/agent-integration-audit-test.py',
  'tooling/scripts/local-dev/completion-review.test.mjs',
  'tooling/scripts/local-dev/development-flow-residue.mjs',
  'tooling/scripts/local-dev/development-flow-residue.test.mjs',
  'tooling/scripts/review/skill-check.sh',
  'tooling/skills/pt-completion-auditor/SKILL.md',
  'tooling/skills/pt-context-anchor/SKILL.md',
  'tooling/skills/pt-dev-workflow/SKILL.md',
  'tooling/skills/pt-execution-plan-guardian/SKILL.md',
  'tooling/skills/pt-plan-and-document/SKILL.md',
];

const RETIRED_TOKENS = [
  ...new Set(RETIRED_PATHS.map((item) => path.basename(item))),
  'make active-work-sync',
  'make plan-mount',
  'dev-session-status',
  'skills-hard-cut',
  'skills-gc',
];

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.trae-html-share-packages',
  'deliverables',
  'node_modules',
  'output',
  'reports',
]);

const TEXT_EXTENSIONS = new Set([
  '',
  '.cjs',
  '.json',
  '.md',
  '.mjs',
  '.py',
  '.sh',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

function normalize(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isHistorical(relativePath) {
  if (relativePath.includes('/execution-plans/')) return true;
  return HISTORICAL_EXCLUSIONS.includes(relativePath);
}

function isAllowedNegativeReference(relativePath) {
  return ALLOWED_NEGATIVE_REFERENCES.includes(relativePath);
}

function walk(root, current = root, output = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const candidate = path.join(current, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(root, candidate, output);
    } else if (
      entry.isFile() &&
      TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      output.push(candidate);
    }
  }
  return output;
}

export function inspectDevelopmentFlowResidue(options = {}) {
  const root = realpathSync(options.repoRoot ?? process.cwd());
  const findings = [];
  for (const retired of RETIRED_PATHS) {
    const candidate = path.join(root, retired);
    if (existsSync(candidate) || lstatSafe(candidate)?.isSymbolicLink()) {
      findings.push({
        code: 'RETIRED_PATH_PRESENT',
        path: retired,
      });
    }
  }
  for (const file of walk(root)) {
    const relative = normalize(path.relative(root, file));
    if (isHistorical(relative) || isAllowedNegativeReference(relative)) {
      continue;
    }
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const token of RETIRED_TOKENS) {
        if (line.includes(token)) {
          findings.push({
            code: 'RETIRED_REFERENCE_ACTIVE',
            path: relative,
            line: index + 1,
            token,
          });
        }
      }
    });
  }
  return {
    status: findings.length === 0 ? 'PASS' : 'BLOCKED',
    retiredPaths: RETIRED_PATHS,
    historicalExclusions: HISTORICAL_EXCLUSIONS,
    allowedNegativeReferences: ALLOWED_NEGATIVE_REFERENCES,
    findings,
  };
}

function lstatSafe(candidate) {
  try {
    return lstatSync(candidate);
  } catch {
    return null;
  }
}

function parseArguments(argv) {
  if (argv.length === 0) return {};
  if (argv.length === 2 && argv[0] === '--repo-root') {
    return { repoRoot: argv[1] };
  }
  throw new Error('usage: development-flow-residue.mjs [--repo-root <root>]');
}

if (isDirectInvocation(import.meta.url)) {
  try {
    const report = inspectDevelopmentFlowResidue(
      parseArguments(process.argv.slice(2)),
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'PASS' ? 0 : 2;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        status: 'BLOCKED',
        code: error?.code ?? 'DEVELOPMENT_FLOW_RESIDUE_FAILED',
        message: error?.message ?? String(error),
      })}\n`,
    );
    process.exitCode = 2;
  }
}

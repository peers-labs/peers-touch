#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  analyzeFiles,
  isReviewableSource,
} from './structure-signals.mjs';

const RULE_IDS = Object.freeze([
  'STRUCT-01',
  'STRUCT-02',
  'STRUCT-03',
  'STRUCT-04',
  'STRUCT-05',
  'STRUCT-06',
  'STRUCT-07',
  'STRUCT-08',
  'STRUCT-09',
]);
const SIGNAL_CODES = Object.freeze([
  'STRUCT-SIGNAL-FILE-LINES',
  'STRUCT-SIGNAL-IMPORT-FANOUT',
  'STRUCT-SIGNAL-INDENT-DEPTH',
]);
const VERDICTS = new Set([
  'PASS',
  'PASS_WITH_SUGGESTIONS',
  'REFACTOR_REQUIRED',
]);
const CATEGORIES = new Set(['blocking', 'passing', 'false-positive']);
const RUBRIC_SUBSECTIONS = Object.freeze([
  '### Definition',
  '### Detection Questions',
  '### Blocking Conditions',
  '### Legal Exceptions',
  '### Positive Example',
  '### Negative Example',
  '### Fixture',
]);
const CASE_KEYS = new Set([
  'caseId',
  'source',
  'category',
  'expectedVerdict',
  'expectedFindings',
  'expectedSignalCodes',
  'reviewedRuleIds',
  'rationale',
]);
const EXPECTED_FINDING_KEYS = new Set([
  'primaryRuleId',
  'relatedRuleIds',
  'blocking',
]);

function fail(message) {
  throw new Error(message);
}

function requireFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fail(`missing required file: ${file}`);
  }
}

function requireMarkers(file, markers) {
  const content = fs.readFileSync(file, 'utf8');
  for (const marker of markers) {
    if (!content.includes(marker)) {
      fail(`${path.relative(process.cwd(), file)} missing marker: ${marker}`);
    }
  }
  return content;
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function validateRuleIds(values, field) {
  if (
    !Array.isArray(values) ||
    new Set(values).size !== values.length ||
    values.some((value) => !RULE_IDS.includes(value))
  ) {
    fail(`${field} must contain unique stable rule IDs`);
  }
}

function validateRubric(rubric) {
  const fixtureReferences = new Map();
  for (const [index, ruleId] of RULE_IDS.entries()) {
    const start = rubric.indexOf(`## ${ruleId} `);
    if (start < 0) {
      fail(`rubric does not define ${ruleId}`);
    }
    const nextRuleId = RULE_IDS[index + 1];
    const end =
      nextRuleId === undefined
        ? rubric.length
        : rubric.indexOf(`## ${nextRuleId} `, start + 1);
    const section = rubric.slice(start, end < 0 ? rubric.length : end);
    for (const subsection of RUBRIC_SUBSECTIONS) {
      if (!section.includes(subsection)) {
        fail(`${ruleId} missing rubric subsection: ${subsection}`);
      }
    }
    const fixture = section.match(
      /### Fixture\s+`code-structure\/([a-z0-9]+(?:-[a-z0-9]+)*)`/,
    )?.[1];
    if (!fixture) {
      fail(`${ruleId} must reference one code-structure fixture`);
    }
    fixtureReferences.set(ruleId, fixture);
  }
  return fixtureReferences;
}

export function validateFixtureCases(cases, root) {
  if (!Array.isArray(cases) || cases.length < 6) {
    fail('code-structure fixtures must define at least six cases');
  }

  const caseIds = new Set();
  const coveredRules = new Set();
  const coveredVerdicts = new Set();
  const coveredCategories = new Set();

  for (const [index, fixture] of cases.entries()) {
    if (!exactKeys(fixture, CASE_KEYS)) {
      fail(`case ${index} has an invalid closed shape`);
    }
    if (
      typeof fixture.caseId !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fixture.caseId) ||
      caseIds.has(fixture.caseId)
    ) {
      fail(`case ${index} has an invalid or duplicate caseId`);
    }
    caseIds.add(fixture.caseId);

    if (!VERDICTS.has(fixture.expectedVerdict)) {
      fail(`${fixture.caseId} has an invalid verdict`);
    }
    if (!CATEGORIES.has(fixture.category)) {
      fail(`${fixture.caseId} has an invalid category`);
    }
    validateRuleIds(
      fixture.reviewedRuleIds,
      `${fixture.caseId}.reviewedRuleIds`,
    );
    if (!Array.isArray(fixture.expectedFindings)) {
      fail(`${fixture.caseId}.expectedFindings must be an array`);
    }
    const primaryRuleIds = new Set();
    const findingRuleIds = new Set();
    for (const [findingIndex, finding] of fixture.expectedFindings.entries()) {
      if (!exactKeys(finding, EXPECTED_FINDING_KEYS)) {
        fail(
          `${fixture.caseId}.expectedFindings[${findingIndex}] has an invalid closed shape`,
        );
      }
      if (!RULE_IDS.includes(finding.primaryRuleId)) {
        fail(
          `${fixture.caseId}.expectedFindings[${findingIndex}].primaryRuleId is invalid`,
        );
      }
      if (primaryRuleIds.has(finding.primaryRuleId)) {
        fail(`${fixture.caseId} repeats primary rule ${finding.primaryRuleId}`);
      }
      primaryRuleIds.add(finding.primaryRuleId);
      findingRuleIds.add(finding.primaryRuleId);
      validateRuleIds(
        finding.relatedRuleIds,
        `${fixture.caseId}.expectedFindings[${findingIndex}].relatedRuleIds`,
      );
      if (finding.relatedRuleIds.includes(finding.primaryRuleId)) {
        fail(
          `${fixture.caseId}.expectedFindings[${findingIndex}] repeats its primary rule`,
        );
      }
      finding.relatedRuleIds.forEach((ruleId) => findingRuleIds.add(ruleId));
      if (typeof finding.blocking !== 'boolean') {
        fail(
          `${fixture.caseId}.expectedFindings[${findingIndex}].blocking must be boolean`,
        );
      }
    }
    if (
      !Array.isArray(fixture.expectedSignalCodes) ||
      new Set(fixture.expectedSignalCodes).size !==
        fixture.expectedSignalCodes.length ||
      fixture.expectedSignalCodes.some(
        (code) =>
          typeof code !== 'string' ||
          !code.startsWith('STRUCT-SIGNAL-'),
      )
    ) {
      fail(`${fixture.caseId}.expectedSignalCodes is invalid`);
    }
    const hasBlockingFinding = fixture.expectedFindings.some(
      (finding) => finding.blocking,
    );
    const hasSuggestion = fixture.expectedFindings.some(
      (finding) => !finding.blocking,
    );
    const derivedVerdict = hasBlockingFinding
      ? 'REFACTOR_REQUIRED'
      : hasSuggestion
        ? 'PASS_WITH_SUGGESTIONS'
        : 'PASS';
    if (fixture.expectedVerdict !== derivedVerdict) {
      fail(
        `${fixture.caseId} expectedVerdict disagrees with expectedFindings`,
      );
    }
    if (
      [...findingRuleIds].some(
        (ruleId) => !fixture.reviewedRuleIds.includes(ruleId),
      )
    ) {
      fail(`${fixture.caseId} decision rules must be included in reviewedRuleIds`);
    }
    if (
      fixture.category === 'blocking' &&
      fixture.expectedVerdict !== 'REFACTOR_REQUIRED'
    ) {
      fail(`${fixture.caseId} blocking category requires REFACTOR_REQUIRED`);
    }
    if (
      fixture.category === 'false-positive' &&
      (fixture.expectedVerdict !== 'PASS' ||
        fixture.expectedFindings.length > 0)
    ) {
      fail(`${fixture.caseId} false-positive category must have no findings`);
    }
    if (
      typeof fixture.source !== 'string' ||
      !fixture.source.startsWith(
        'tooling/review-fixtures/code-structure/',
      ) ||
      !fs.existsSync(path.resolve(root, fixture.source))
    ) {
      fail(`${fixture.caseId} references a missing or external source fixture`);
    }
    if (
      typeof fixture.rationale !== 'string' ||
      fixture.rationale.trim().length < 20
    ) {
      fail(`${fixture.caseId} requires a concrete rationale`);
    }

    const actualSignalCodes = analyzeFiles(root, [fixture.source], {
      includeFixtures: true,
    }).signals.map((signal) => signal.code);
    if (
      JSON.stringify(actualSignalCodes) !==
      JSON.stringify(fixture.expectedSignalCodes)
    ) {
      fail(
        `${fixture.caseId} signal mismatch: expected ${fixture.expectedSignalCodes.join(',') || 'none'}, got ${actualSignalCodes.join(',') || 'none'}`,
      );
    }

    fixture.reviewedRuleIds.forEach((ruleId) => coveredRules.add(ruleId));
    coveredVerdicts.add(fixture.expectedVerdict);
    coveredCategories.add(fixture.category);
  }

  for (const ruleId of RULE_IDS) {
    if (!coveredRules.has(ruleId)) {
      fail(`fixture matrix does not cover ${ruleId}`);
    }
  }
  for (const verdict of VERDICTS) {
    if (!coveredVerdicts.has(verdict)) {
      fail(`fixture matrix does not cover ${verdict}`);
    }
  }
  for (const category of CATEGORIES) {
    if (!coveredCategories.has(category)) {
      fail(`fixture matrix does not cover category ${category}`);
    }
  }

  return {
    caseCount: cases.length,
    caseIds: [...caseIds].sort(),
    coveredRules: [...coveredRules].sort(),
    coveredVerdicts: [...coveredVerdicts].sort(),
    coveredCategories: [...coveredCategories].sort(),
  };
}

export function run() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDirectory, '../../../..');
  const relative = (file) => path.join(root, file);
  const fixtureFile = relative(
    'tooling/review-fixtures/code-structure/cases.json',
  );
  const skillFile = relative(
    'tooling/skills/pt-code-structure-review/SKILL.md',
  );
  const rubricFile = relative(
    'tooling/skills/pt-code-structure-review/references/rubric.md',
  );
  const examplesFile = relative(
    'tooling/skills/pt-code-structure-review/references/examples.md',
  );
  const signalsFile = relative(
    'tooling/skills/pt-code-structure-review/scripts/structure-signals.mjs',
  );
  const signalsTestFile = relative(
    'tooling/skills/pt-code-structure-review/scripts/structure-signals.test.mjs',
  );
  const decisionFile = relative(
    'tooling/scripts/review/code_structure_decision.py',
  );
  const decisionTestFile = relative(
    'tooling/scripts/review/code_structure_decision_test.py',
  );
  const routeFile = relative('tooling/scripts/review/route-change.sh');
  const runnerFile = relative('tooling/scripts/review/run.sh');
  const reviewMakeFile = relative('tooling/make/review.mk');
  const frameworkFile = relative('docs/global/code-review-framework.md');
  const agentsFile = relative('AGENTS.md');
  const githubReviewFile = relative(
    'tooling/skills/pt-github-review/SKILL.md',
  );
  const qualityCheckFile = relative(
    'tooling/skills/pt-quality-check/SKILL.md',
  );
  const completionAuditorFile = relative(
    'tooling/skills/pt-completion-auditor/SKILL.md',
  );
  const devWorkflowFile = relative('tooling/skills/pt-dev-workflow/SKILL.md');
  const qualityEvidenceFile = relative('tooling/scripts/quality-evidence.py');

  [
    fixtureFile,
    skillFile,
    rubricFile,
    examplesFile,
    signalsFile,
    signalsTestFile,
    decisionFile,
    decisionTestFile,
    routeFile,
    runnerFile,
    reviewMakeFile,
    frameworkFile,
    agentsFile,
    githubReviewFile,
    qualityCheckFile,
    completionAuditorFile,
    devWorkflowFile,
    qualityEvidenceFile,
  ].forEach(requireFile);

  const cases = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  const result = validateFixtureCases(cases, root);
  const skill = requireMarkers(skillFile, [
    'name: pt-code-structure-review',
    'PASS_WITH_SUGGESTIONS',
    'REFACTOR_REQUIRED',
    'investigation signals only',
    'fixture validator proves schema and reference integrity',
    'never approves a merge',
  ]);
  const rubric = fs.readFileSync(rubricFile, 'utf8');
  const contract = `${skill}\n${rubric}`;
  const description = skill.match(/^description: (.+)$/m)?.[1] ?? '';
  if (
    !skill.startsWith('---\nname: pt-code-structure-review\n') ||
    description.length === 0 ||
    /["'<>]/.test(description) ||
    description.includes(': ')
  ) {
    fail('Skill frontmatter name or description is invalid');
  }
  const rubricFixtures = validateRubric(rubric);
  for (const [ruleId, caseId] of rubricFixtures.entries()) {
    if (!result.caseIds.includes(caseId)) {
      fail(`${ruleId} references missing fixture case: ${caseId}`);
    }
  }

  for (const ruleId of RULE_IDS) {
    if (!contract.includes(ruleId)) {
      fail(`Skill contract does not define ${ruleId}`);
    }
  }

  const routingCases = [
    'Makefile',
    'tooling/make/review.mk',
    'apps/station/app/service/member.go',
    'apps/desktop/src/page.tsx',
    'tooling/scripts/check.py',
    'model/domain/demo/demo.pb.go',
    'apps/mobile/src/gen/proto/chat_pb.ts',
    'generated/chat_pb2.py',
    'generated/chat.ts',
    'gen/proto/chat.ts',
    'src/domain.generated.d.ts',
    'vendor/library/source.go',
    'third_party/library/source.ts',
    'tooling/review-fixtures/code-structure/passing/cohesive-service.ts',
    'docs/global/code-review-framework.md',
  ];
  for (const sourcePath of routingCases) {
    const route = execFileSync(
      'bash',
      [routeFile, '--changed-file', sourcePath],
      { cwd: root, encoding: 'utf8' },
    );
    const routed = route.includes('[code-structure]');
    if (routed !== isReviewableSource(sourcePath)) {
      fail(`route and signal source classification differ for ${sourcePath}`);
    }
  }
  const normalizedRoute = execFileSync(
    'bash',
    [routeFile, '--changed-file', './tooling/scripts/review/run.sh'],
    { cwd: root, encoding: 'utf8' },
  );
  requireMarkers(routeFile, ['sed -E', 'invalid format']);
  for (const profile of ['code-structure', 'review-system', 'skill']) {
    if (!normalizedRoute.includes(`[${profile}]`)) {
      fail(`normalized changed path did not select ${profile}`);
    }
  }
  try {
    execFileSync(
      'bash',
      [routeFile, '--changed-file', 'src/example.ts', '--format', 'json'],
      { cwd: root, encoding: 'utf8', stdio: 'pipe' },
    );
    fail('route-change must reject unsupported output formats');
  } catch (error) {
    if (error?.status !== 2) {
      throw error;
    }
  }

  requireMarkers(runnerFile, [
    'Code structure signals',
    'pt-code-structure-review/scripts/structure-signals.mjs',
    'code_structure_decision.py verify',
  ]);
  requireMarkers(signalsFile, ['--classify-stdin', 'isReviewableSource']);
  requireMarkers(signalsTestFile, SIGNAL_CODES);
  requireMarkers(examplesFile, SIGNAL_CODES);
  requireMarkers(decisionFile, [
    'code-structure-review-decision',
    'source_identity',
    'rubricHash',
    'primaryRuleId',
    'relatedRuleIds',
  ]);
  requireMarkers(reviewMakeFile, ['review-structure-signals']);
  requireMarkers(frameworkFile, [
    'STRUCT-01 DOMAIN_FIDELITY',
    'STRUCT-09 TESTABLE_BOUNDARY',
    'advisory',
  ]);
  requireMarkers(agentsFile, ['pt-code-structure-review']);
  requireMarkers(githubReviewFile, [
    'pt-code-structure-review',
    'REFACTOR_REQUIRED',
  ]);
  requireMarkers(qualityCheckFile, [
    'code_structure_decision.py verify',
    'source-bound decision',
  ]);
  requireMarkers(completionAuditorFile, ['pt-code-structure-review']);
  requireMarkers(devWorkflowFile, ['pt-code-structure-review']);
  requireMarkers(qualityEvidenceFile, [
    'collect_latest_decision',
    '"code_structure": code_structure',
  ]);

  process.stdout.write(
    `code-structure-fixture-schema: pass (${result.caseCount} cases, ${rubricFixtures.size} rubric links)\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`[CODE_STRUCTURE_FIXTURE_INVALID] ${error.message}\n`);
    process.exitCode = 1;
  }
}

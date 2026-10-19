#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCalibration } from './calibration.mjs';
import {
  ExperienceDesignError,
  canonicalDigest,
  fail,
} from './canonical.mjs';
import {
  evaluateExperienceCase,
  exitCodeForDisposition,
} from './evaluator.mjs';
import { validateHoldoutLedger } from './holdout.mjs';
import { ExperienceReviewError } from './review-result-schema.mjs';
import { validateReviewReceipt } from './review-receipt.mjs';
import {
  loadExperienceCase,
  loadGrammar,
  loadRuleCatalog,
  loadTrustedIssuers,
  validateSources,
} from './schema.mjs';
import { validateSourceFence } from './source-fence.mjs';
import { controlPlaneVersionDigest } from './source-version.mjs';
import {
  evaluatePrototypeAdmission,
  parseReviewResult,
  validateReviewResult,
} from './validator.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../../..');
const DEFAULT_RULES_PATH = path.join(
  REPO_ROOT,
  'docs/architecture/engineering/experience-design/rules.json',
);
const DEFAULT_GRAMMAR_PATH = path.join(
  REPO_ROOT,
  'docs/client/common/ui-identity/grammar-bindings.json',
);
const DEFAULT_ISSUERS_PATH = path.join(
  SCRIPT_DIR,
  'fixtures/trusted-issuers.json',
);
const DEFAULT_FIXTURES_ROOT = path.join(SCRIPT_DIR, 'fixtures');

function parseOptions(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (
      ![
        'rules',
        'grammar',
        'trusted-issuers',
        'expect-disposition',
        'repo-root',
        'package-root',
        'run-envelope',
        'case',
        'manifest',
        'rubric',
      ].includes(key)
    ) {
      fail('ED_CLI_USAGE', `unknown option --${key}`);
    }
    const optionValue = args[index + 1];
    if (optionValue === undefined || optionValue.startsWith('--')) {
      fail('ED_CLI_USAGE', `--${key} requires a path`);
    }
    options[key] = [
      'rules',
      'grammar',
      'trusted-issuers',
      'repo-root',
      'package-root',
    ].includes(key)
      ? path.resolve(optionValue)
      : optionValue;
    index += 1;
  }
  return { positional, options };
}

function loadInputs(options) {
  const rulesPath = options.rules ?? DEFAULT_RULES_PATH;
  const grammarPath = options.grammar ?? DEFAULT_GRAMMAR_PATH;
  const issuersPath = options['trusted-issuers'] ?? DEFAULT_ISSUERS_PATH;
  return {
    paths: { rulesPath, grammarPath, issuersPath },
    ruleCatalog: loadRuleCatalog(rulesPath),
    grammar: loadGrammar(grammarPath),
    trustedIssuers: loadTrustedIssuers(issuersPath),
    evaluatorVersionDigest: controlPlaneVersionDigest(),
  };
}

function validateCase(casePath, options) {
  const sources = loadInputs(options);
  const loaded = loadExperienceCase(path.resolve(casePath), sources);
  return {
    ok: true,
    kind: 'peers-touch-experience-case-validation',
    schemaVersion: 1,
    caseId: loaded.case.id,
    calibration: loaded.case.calibration,
    claim: loaded.case.claim,
    digests: loaded.digests,
  };
}

function evaluateCase(casePath, options) {
  const sources = loadInputs(options);
  const loaded = loadExperienceCase(path.resolve(casePath), sources);
  const result = evaluateExperienceCase(loaded, {
    ruleCatalog: sources.ruleCatalog,
    grammar: sources.grammar,
    evaluatorVersionDigest: sources.evaluatorVersionDigest,
    repoRoot: options['repo-root'] ?? REPO_ROOT,
  });
  const expected = options['expect-disposition'];
  if (
    expected !== undefined
    && ![
      'changes-required',
      'ready-for-independent-review',
      'unproven',
    ].includes(expected)
  ) {
    fail('ED_CLI_USAGE', `unsupported disposition ${expected}`);
  }
  if (expected !== undefined && result.disposition !== expected) {
    fail('ED_EXPECTATION_MISMATCH', 'evaluation disposition did not match', {
      expected,
      actual: result.disposition,
    });
  }
  Object.defineProperty(result, 'exitCode', {
    enumerable: false,
    value:
      expected === undefined
        ? exitCodeForDisposition(result.disposition, sources.ruleCatalog)
        : 0,
  });
  return result;
}

function readJson(sourcePath, context) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(sourcePath), 'utf8'));
  } catch (error) {
    fail('ED_CLI_INPUT_INVALID', `${context} is unreadable JSON`, {
      path: sourcePath,
      reason: error.message,
    });
  }
}

function readReviewJson(sourcePath, context) {
  try {
    return parseReviewResult(
      fs.readFileSync(path.resolve(sourcePath), 'utf8'),
      context,
    );
  } catch (error) {
    if (error instanceof ExperienceReviewError) throw error;
    throw new ExperienceReviewError(
      'EDX_RESULT_INVALID',
      `${context} cannot be read: ${error.message}`,
    );
  }
}

function requireReviewVerifyOptions(options) {
  const required = [
    'repo-root',
    'package-root',
    'run-envelope',
    'case',
    'manifest',
    'rubric',
  ];
  const missing = required.filter((key) => options[key] === undefined);
  if (missing.length > 0) {
    throw new ExperienceReviewError(
      'EDX_BINDING_INVALID',
      `review-verify requires ${missing.join(', ')}`,
    );
  }
}

function validateReviewResultFile(resultPath) {
  return validateReviewResult(readReviewJson(resultPath, 'ReviewResult'));
}

function verifyReviewResultFile(resultPath, options) {
  requireReviewVerifyOptions(options);
  const result = readReviewJson(resultPath, 'ReviewResult');
  return {
    ...validateReviewResult(result),
    sourceFence: validateSourceFence(result, {
      repoRoot: options['repo-root'],
      packageRoot: options['package-root'],
      runEnvelopePath: options['run-envelope'],
      casePath: options.case,
      manifestPath: options.manifest,
      rubricPath: options.rubric,
    }),
  };
}

function evaluateReviewAdmission(resultPath, decisionPath) {
  const result = readReviewJson(resultPath, 'ReviewResult');
  const decision = readReviewJson(
    decisionPath,
    'IndependentReviewDecision',
  );
  return evaluatePrototypeAdmission(result, decision);
}

function validateReview(casePath, resultPath, receiptPath, options) {
  const sources = loadInputs(options);
  const loadedCase = loadExperienceCase(path.resolve(casePath), sources);
  const suppliedResult = readJson(resultPath, 'evaluation result');
  const expectedResult = evaluateExperienceCase(loadedCase, {
    ruleCatalog: sources.ruleCatalog,
    grammar: sources.grammar,
    evaluatorVersionDigest: sources.evaluatorVersionDigest,
    repoRoot: options['repo-root'] ?? REPO_ROOT,
  });
  if (canonicalDigest(suppliedResult) !== canonicalDigest(expectedResult)) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'evaluation result is not current for the supplied case and sources',
    );
  }
  const receipt = readJson(receiptPath, 'review receipt');
  return {
    ok: true,
    kind: 'peers-touch-experience-review-validation',
    schemaVersion: 1,
    ...validateReviewReceipt(receipt, {
      loadedCase,
      result: suppliedResult,
      trustedIssuers: sources.trustedIssuers,
    }),
  };
}

function usage() {
  return [
    'usage:',
    '  experience-design.mjs validate <case.json> [source options]',
    '  experience-design.mjs evaluate <case.json> [--expect-disposition <value>] [source options]',
    '  experience-design.mjs validate-sources [source options]',
    '  experience-design.mjs validate-review <case.json> <result.json> <receipt.json> [source options]',
    '  experience-design.mjs review-validate <review-result.json>',
    '  experience-design.mjs review-verify <review-result.json> --repo-root <path> --package-root <path> --run-envelope <path> --case <path> --manifest <path> --rubric <path>',
    '  experience-design.mjs review-admission <review-result.json> <independent-review.json>',
    '  experience-design.mjs calibrate [source options]',
    '  experience-design.mjs validate-holdouts [source options]',
    '  experience-design.mjs check [source options]',
    '',
    'source options:',
    '  --rules <path>',
    '  --grammar <path>',
    '  --trusted-issuers <path>',
    '  --repo-root <path>',
    '  --package-root <path>',
  ].join('\n');
}

export function runCli(argv) {
  const [command, ...rest] = argv;
  const { positional, options } = parseOptions(rest);
  if (command === 'review-validate') {
    if (positional.length !== 1) {
      throw new ExperienceReviewError(
        'EDX_RESULT_INVALID',
        'review-validate requires exactly one ReviewResult path',
      );
    }
    return validateReviewResultFile(positional[0]);
  }
  if (command === 'review-verify') {
    if (positional.length !== 1) {
      throw new ExperienceReviewError(
        'EDX_RESULT_INVALID',
        'review-verify requires exactly one ReviewResult path',
      );
    }
    return verifyReviewResultFile(positional[0], options);
  }
  if (command === 'review-admission') {
    if (positional.length !== 2) {
      throw new ExperienceReviewError(
        'EDX_RESULT_INVALID',
        'review-admission requires ReviewResult and IndependentReviewDecision paths',
      );
    }
    return evaluateReviewAdmission(positional[0], positional[1]);
  }
  if (command === 'validate') {
    if (positional.length !== 1) {
      fail('ED_CLI_USAGE', 'validate requires exactly one case path');
    }
    return validateCase(positional[0], options);
  }
  if (command === 'validate-sources') {
    if (positional.length !== 0) {
      fail('ED_CLI_USAGE', 'validate-sources does not accept positional input');
    }
    return validateSources({
      ruleCatalogPath: options.rules ?? DEFAULT_RULES_PATH,
      grammarPath: options.grammar ?? DEFAULT_GRAMMAR_PATH,
      trustedIssuersPath:
        options['trusted-issuers'] ?? DEFAULT_ISSUERS_PATH,
    });
  }
  if (command === 'evaluate') {
    if (positional.length !== 1) {
      fail('ED_CLI_USAGE', 'evaluate requires exactly one case path');
    }
    return evaluateCase(positional[0], options);
  }
  if (command === 'validate-review') {
    if (positional.length !== 3) {
      fail(
        'ED_CLI_USAGE',
        'validate-review requires case, result, and receipt paths',
      );
    }
    return validateReview(
      positional[0],
      positional[1],
      positional[2],
      options,
    );
  }
  if (
    ['calibrate', 'validate-holdouts', 'check'].includes(command)
    && positional.length !== 0
  ) {
    fail('ED_CLI_USAGE', `${command} does not accept positional input`);
  }
  if (command === 'calibrate') {
    const sources = loadInputs(options);
    return runCalibration({
      fixturesRoot: DEFAULT_FIXTURES_ROOT,
      ruleCatalog: sources.ruleCatalog,
      grammar: sources.grammar,
      trustedIssuers: sources.trustedIssuers,
      repoRoot: options['repo-root'] ?? REPO_ROOT,
    });
  }
  if (command === 'validate-holdouts') {
    const sources = loadInputs(options);
    return validateHoldoutLedger({
      fixturesRoot: DEFAULT_FIXTURES_ROOT,
      ruleCatalog: sources.ruleCatalog,
      grammar: sources.grammar,
      trustedIssuers: sources.trustedIssuers,
      repoRoot: options['repo-root'] ?? REPO_ROOT,
    });
  }
  if (command === 'check') {
    const sources = loadInputs(options);
    const sourceValidation = validateSources({
      ruleCatalogPath: sources.paths.rulesPath,
      grammarPath: sources.paths.grammarPath,
      trustedIssuersPath: sources.paths.issuersPath,
    });
    const calibration = runCalibration({
      fixturesRoot: DEFAULT_FIXTURES_ROOT,
      ruleCatalog: sources.ruleCatalog,
      grammar: sources.grammar,
      trustedIssuers: sources.trustedIssuers,
      repoRoot: options['repo-root'] ?? REPO_ROOT,
    });
    const holdouts = validateHoldoutLedger({
      fixturesRoot: DEFAULT_FIXTURES_ROOT,
      ruleCatalog: sources.ruleCatalog,
      grammar: sources.grammar,
      trustedIssuers: sources.trustedIssuers,
      repoRoot: options['repo-root'] ?? REPO_ROOT,
    });
    return {
      ok: true,
      kind: 'peers-touch-experience-control-plane-check',
      schemaVersion: 1,
      sourceValidation,
      calibration,
      holdouts,
    };
  }
  fail('ED_CLI_USAGE', usage());
}

function main() {
  try {
    const result = runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (Number.isInteger(result.exitCode)) process.exitCode = result.exitCode;
  } catch (error) {
    if (error instanceof ExperienceReviewError) {
      process.stderr.write(`${JSON.stringify(error.toJSON(), null, 2)}\n`);
      process.exitCode = 1;
      return;
    }
    const normalized =
      error instanceof ExperienceDesignError
        ? error
        : new ExperienceDesignError(
          'ED_INTERNAL_ERROR',
          error instanceof Error ? error.message : String(error),
        );
    process.stderr.write(`${JSON.stringify(normalized.toJSON(), null, 2)}\n`);
    process.exitCode = normalized.code === 'ED_CLI_USAGE' ? 64 : 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

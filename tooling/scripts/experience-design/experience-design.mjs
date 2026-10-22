#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCalibration } from './calibration.mjs';
import { evaluatePrototypeAdmission } from './admission.mjs';
import { runComparativeCalibration } from './comparative-calibration.mjs';
import {
  assertCurrentComparisonEvaluation,
  evaluatePairedExperienceCase,
} from './comparative-evaluator.mjs';
import {
  projectTargetContracts,
  validateBlindReview,
  validateBlindedDeltaReport,
  validateCausalDeltaReport,
  validateCurrentPeersBinding,
  validateDispositionReview,
  validateIdentityMap,
} from './comparative-review.mjs';
import {
  loadPairedExperienceCase,
  readContainedJson,
} from './comparative-schema.mjs';
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
  validateSources,
} from './schema.mjs';
import { validateSourceFence } from './source-fence.mjs';
import { controlPlaneVersionDigest } from './source-version.mjs';
import {
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
    if (Object.hasOwn(options, key)) fail('ED_CLI_USAGE', `duplicate option --${key}`);
    if (
      ![
        'rules',
        'grammar',
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
  return {
    paths: { rulesPath, grammarPath },
    ruleCatalog: loadRuleCatalog(rulesPath),
    grammar: loadGrammar(grammarPath),
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
      `source-bound review requires ${missing.join(', ')}`,
    );
  }
}

function requirePackageRoot(options, command) {
  if (options['package-root'] === undefined) {
    fail('ED_CLI_USAGE', `${command} requires --package-root`);
  }
  return options['package-root'];
}

function readComparativeJson(packageRoot, sourcePath, context) {
  return readContainedJson(
    packageRoot,
    sourcePath,
    context,
    'EDX_COMPARE_PAIR_STALE',
  ).value;
}

function validateComparativeBlindChain(
  pairPath,
  evaluationPath,
  reportPath,
  reviewPath,
  options,
) {
  const packageRoot = requirePackageRoot(options, 'comparative review');
  const loaded = loadPairedExperienceCase(pairPath, packageRoot);
  const suppliedEvaluation = readComparativeJson(
    packageRoot,
    evaluationPath,
    'ComparisonEvaluation',
  );
  const evaluation = assertCurrentComparisonEvaluation(
    loaded,
    suppliedEvaluation,
    { evaluatorVersionDigest: controlPlaneVersionDigest() },
  );
  const blindedReport = readComparativeJson(
    packageRoot,
    reportPath,
    'BlindedDeltaReport',
  );
  const blindReview = readComparativeJson(
    packageRoot,
    reviewPath,
    'BlindReview',
  );
  validateBlindedDeltaReport(blindedReport, evaluation);
  validateBlindReview(blindReview, evaluation, blindedReport);
  return {
    packageRoot,
    loaded,
    evaluation,
    blindedReport,
    blindReview,
  };
}

function validateComparativeDispositionChain(
  [
    pairPath,
    evaluationPath,
    reportPath,
    blindReviewPath,
    identityPath,
    causalPath,
    dispositionReviewPath,
  ],
  options,
) {
  const chain = validateComparativeBlindChain(
    pairPath,
    evaluationPath,
    reportPath,
    blindReviewPath,
    options,
  );
  const identityMap = readComparativeJson(
    chain.packageRoot,
    identityPath,
    'IdentityMap',
  );
  const priorAuthorIds = [
    ...chain.evaluation.authorIds,
    chain.blindedReport.authorId,
    chain.blindReview.reviewerId,
  ];
  validateIdentityMap(identityMap, {
    pairDigest: chain.loaded.digests.pair,
    evaluationDigest: canonicalDigest(chain.evaluation),
    reportDigest: canonicalDigest(chain.blindedReport),
    blindReviewDigest: canonicalDigest(chain.blindReview),
    blindReview: chain.blindReview,
    forbiddenAuthorIds: priorAuthorIds,
  });
  const sources = loadInputs(options);
  const peersBinding = validateCurrentPeersBinding(identityMap, {
    packageRoot: chain.packageRoot,
    ruleCatalog: sources.ruleCatalog,
    grammar: sources.grammar,
    evaluatorVersionDigest: sources.evaluatorVersionDigest,
    repoRoot: options['repo-root'] ?? REPO_ROOT,
  });
  const causalReport = readComparativeJson(
    chain.packageRoot,
    causalPath,
    'CausalDeltaReport',
  );
  validateCausalDeltaReport(causalReport, {
    blindedReport: chain.blindedReport,
    blindReview: chain.blindReview,
    identityMap,
    peersBinding,
    forbiddenAuthorIds: priorAuthorIds,
  });
  const dispositionReview = readComparativeJson(
    chain.packageRoot,
    dispositionReviewPath,
    'DispositionReview',
  );
  const forbiddenAuthorIds = [
    ...priorAuthorIds,
    identityMap.revealedById,
  ];
  validateDispositionReview(dispositionReview, {
    causalReport,
    forbiddenAuthorIds,
  });
  return {
    ...chain,
    identityMap,
    peersBinding,
    causalReport,
    dispositionReview,
    forbiddenAuthorIds,
  };
}

function reviewSourceInputs(options) {
  requireReviewVerifyOptions(options);
  return {
    repoRoot: options['repo-root'],
    packageRoot: options['package-root'],
    runEnvelopePath: options['run-envelope'],
    casePath: options.case,
    manifestPath: options.manifest,
    rubricPath: options.rubric,
  };
}

function validateReviewResultFile(resultPath) {
  return validateReviewResult(readReviewJson(resultPath, 'ReviewResult'));
}

function verifyReviewResultFile(resultPath, options) {
  requireReviewVerifyOptions(options);
  const result = readReviewJson(resultPath, 'ReviewResult');
  return {
    ...validateReviewResult(result),
    sourceFence: validateSourceFence(result, reviewSourceInputs(options)),
  };
}

function evaluateReviewAdmission(resultPath, decisionPath, options) {
  const result = readReviewJson(resultPath, 'ReviewResult');
  const decision = readReviewJson(
    decisionPath,
    'IndependentReviewDecision',
  );
  return evaluatePrototypeAdmission(result, decision, reviewSourceInputs(options));
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
    '  experience-design.mjs review-admission <review-result.json> <independent-review.json> --repo-root <path> --package-root <path> --run-envelope <path> --case <path> --manifest <path> --rubric <path>',
    '  experience-design.mjs compare-validate <paired-case.json> --package-root <path>',
    '  experience-design.mjs compare-evaluate <paired-case.json> --package-root <path>',
    '  experience-design.mjs compare-review-blind <paired-case.json> <comparison-evaluation.json> <blinded-deltas.json> <blind-review.json> --package-root <path>',
    '  experience-design.mjs compare-review-disposition <paired-case.json> <comparison-evaluation.json> <blinded-deltas.json> <blind-review.json> <identity-map.json> <causal-deltas.json> <disposition-review.json> --package-root <path> [source options]',
    '  experience-design.mjs compare-project-target <paired-case.json> <comparison-evaluation.json> <blinded-deltas.json> <blind-review.json> <identity-map.json> <causal-deltas.json> <disposition-review.json> --package-root <path> [source options]',
    '  experience-design.mjs compare-calibrate [--package-root <path>]',
    '  experience-design.mjs calibrate [source options]',
    '  experience-design.mjs validate-holdouts [source options]',
    '  experience-design.mjs check [source options]',
    '',
    'source options:',
    '  --rules <path>',
    '  --grammar <path>',
    '  --repo-root <path>',
    '  --package-root <path>',
  ].join('\n');
}

export function runCli(argv) {
  const [command, ...rest] = argv;
  const { positional, options } = parseOptions(rest);
  const allowedOptions = {
    'review-validate': [],
    'review-verify': ['repo-root', 'package-root', 'run-envelope', 'case', 'manifest', 'rubric'],
    'review-admission': ['repo-root', 'package-root', 'run-envelope', 'case', 'manifest', 'rubric'],
    'compare-validate': ['package-root'],
    'compare-evaluate': ['package-root'],
    'compare-review-blind': ['package-root'],
    'compare-review-disposition': ['rules', 'grammar', 'repo-root', 'package-root'],
    'compare-project-target': ['rules', 'grammar', 'repo-root', 'package-root'],
    'compare-calibrate': ['package-root'],
    validate: ['rules', 'grammar'],
    'validate-sources': ['rules', 'grammar'],
    evaluate: ['rules', 'grammar', 'repo-root', 'expect-disposition'],
    'validate-review': ['rules', 'grammar', 'repo-root'],
    calibrate: ['rules', 'grammar', 'repo-root', 'package-root'],
    'validate-holdouts': ['rules', 'grammar', 'repo-root', 'package-root'],
    check: ['rules', 'grammar', 'repo-root', 'package-root'],
  };
  for (const key of Object.keys(options)) {
    if (!allowedOptions[command]?.includes(key)) {
      fail('ED_CLI_USAGE', `${command} does not consume --${key}`);
    }
  }
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
    return evaluateReviewAdmission(positional[0], positional[1], options);
  }
  if (command === 'compare-validate') {
    if (positional.length !== 1) {
      fail('ED_CLI_USAGE', 'compare-validate requires one paired case path');
    }
    const packageRoot = requirePackageRoot(options, command);
    const loaded = loadPairedExperienceCase(positional[0], packageRoot);
    return {
      ok: true,
      kind: 'peers-touch-paired-experience-validation',
      schemaVersion: 1,
      caseId: loaded.pair.id,
      digests: loaded.digests,
      legIds: loaded.legs
        .map((leg) => leg.descriptor.id)
        .sort(),
    };
  }
  if (command === 'compare-evaluate') {
    if (positional.length !== 1) {
      fail('ED_CLI_USAGE', 'compare-evaluate requires one paired case path');
    }
    const packageRoot = requirePackageRoot(options, command);
    const loaded = loadPairedExperienceCase(positional[0], packageRoot);
    return evaluatePairedExperienceCase(loaded, {
      evaluatorVersionDigest: controlPlaneVersionDigest(),
    });
  }
  if (command === 'compare-review-blind') {
    if (positional.length !== 4) {
      fail(
        'ED_CLI_USAGE',
        'compare-review-blind requires pair, evaluation, blinded report, and blind review',
      );
    }
    const chain = validateComparativeBlindChain(
      ...positional,
      options,
    );
    return {
      ok: true,
      kind: 'peers-touch-comparison-blind-review-validation',
      schemaVersion: 1,
      evaluationDigest: canonicalDigest(chain.evaluation),
      reportDigest: canonicalDigest(chain.blindedReport),
      reviewDigest: canonicalDigest(chain.blindReview),
      decision: chain.blindReview.decision,
    };
  }
  if (command === 'compare-review-disposition') {
    if (positional.length !== 7) {
      fail(
        'ED_CLI_USAGE',
        'compare-review-disposition requires the complete seven-artifact chain',
      );
    }
    const chain = validateComparativeDispositionChain(positional, options);
    return {
      ok: true,
      kind: 'peers-touch-comparison-disposition-review-validation',
      schemaVersion: 1,
      peersBindingDigest: chain.peersBinding.bindingDigest,
      causalDeltaDigest: canonicalDigest(chain.causalReport),
      reviewDigest: canonicalDigest(chain.dispositionReview),
      decision: chain.dispositionReview.decision,
    };
  }
  if (command === 'compare-project-target') {
    if (positional.length !== 7) {
      fail(
        'ED_CLI_USAGE',
        'compare-project-target requires the complete seven-artifact chain',
      );
    }
    const chain = validateComparativeDispositionChain(positional, options);
    return projectTargetContracts(
      chain.causalReport,
      chain.dispositionReview,
      { forbiddenAuthorIds: chain.forbiddenAuthorIds },
    );
  }
  if (command === 'compare-calibrate') {
    if (positional.length !== 0) {
      fail('ED_CLI_USAGE', 'compare-calibrate does not accept positional input');
    }
    return runComparativeCalibration({
      fixturesRoot: options['package-root'] ?? DEFAULT_FIXTURES_ROOT,
      evaluatorVersionDigest: controlPlaneVersionDigest(),
    });
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
      fixturesRoot: options['package-root'] ?? DEFAULT_FIXTURES_ROOT,
      ruleCatalog: sources.ruleCatalog,
      grammar: sources.grammar,
      repoRoot: options['repo-root'] ?? REPO_ROOT,
    });
  }
  if (command === 'validate-holdouts') {
    const sources = loadInputs(options);
    return validateHoldoutLedger({
      fixturesRoot: options['package-root'] ?? DEFAULT_FIXTURES_ROOT,
      ruleCatalog: sources.ruleCatalog,
      grammar: sources.grammar,
      repoRoot: options['repo-root'] ?? REPO_ROOT,
    });
  }
  if (command === 'check') {
    const sources = loadInputs(options);
    const sourceValidation = validateSources({
      ruleCatalogPath: sources.paths.rulesPath,
      grammarPath: sources.paths.grammarPath,
    });
    const calibration = runCalibration({
      fixturesRoot: options['package-root'] ?? DEFAULT_FIXTURES_ROOT,
      ruleCatalog: sources.ruleCatalog,
      grammar: sources.grammar,
      repoRoot: options['repo-root'] ?? REPO_ROOT,
    });
    const holdouts = validateHoldoutLedger({
      fixturesRoot: options['package-root'] ?? DEFAULT_FIXTURES_ROOT,
      ruleCatalog: sources.ruleCatalog,
      grammar: sources.grammar,
      repoRoot: options['repo-root'] ?? REPO_ROOT,
    });
    const comparativeCalibration = runComparativeCalibration({
      fixturesRoot: options['package-root'] ?? DEFAULT_FIXTURES_ROOT,
      evaluatorVersionDigest: sources.evaluatorVersionDigest,
    });
    return {
      ok: true,
      kind: 'peers-touch-experience-control-plane-check',
      schemaVersion: 1,
      sourceValidation,
      calibration,
      comparativeCalibration,
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

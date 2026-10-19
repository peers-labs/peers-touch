#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ExperienceReviewError,
  fail,
} from './schema.mjs';
import { validateSourceFence } from './source-fence.mjs';
import {
  evaluatePrototypeAdmission,
  parseReviewResult,
  validateReviewResult,
} from './validator.mjs';

function readJson(relative, label) {
  if (typeof relative !== 'string' || relative.trim() === '') {
    fail('EDX_RESULT_INVALID', `${label} path is required`);
  }
  return parseReviewResult(fs.readFileSync(relative, 'utf8'), label);
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag.startsWith('--') || value === undefined) {
      fail('EDX_RESULT_INVALID', `unsupported argument ${flag}`);
    }
    const key = {
      '--repo-root': 'repoRoot',
      '--package-root': 'packageRoot',
      '--run-envelope': 'runEnvelopePath',
      '--case': 'casePath',
      '--manifest': 'manifestPath',
      '--rubric': 'rubricPath',
    }[flag];
    if (key === undefined) {
      fail('EDX_RESULT_INVALID', `unsupported argument ${flag}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requireVerifyOptions(options) {
  const required = [
    'repoRoot',
    'packageRoot',
    'runEnvelopePath',
    'casePath',
    'manifestPath',
    'rubricPath',
  ];
  const missing = required.filter((key) => options[key] === undefined);
  if (missing.length > 0) {
    fail(
      'EDX_BINDING_INVALID',
      `verify requires ${missing.join(', ')}`,
    );
  }
}

export function runCli(argv) {
  const [command, resultPath, ...rest] = argv;
  if (!['validate', 'verify', 'admission'].includes(command)) {
    fail(
      'EDX_RESULT_INVALID',
      'command must be validate, verify, or admission',
    );
  }
  const result = readJson(resultPath, 'ReviewResult');
  if (command === 'validate') {
    if (rest.length > 0) {
      fail('EDX_RESULT_INVALID', 'validate accepts only a ReviewResult path');
    }
    return validateReviewResult(result);
  }
  if (command === 'admission') {
    if (rest.length !== 1) {
      fail(
        'EDX_RESULT_INVALID',
        'admission requires one IndependentReviewDecision path',
      );
    }
    const decision = readJson(rest[0], 'IndependentReviewDecision');
    return evaluatePrototypeAdmission(result, decision);
  }
  const options = parseOptions(rest);
  requireVerifyOptions(options);
  return {
    ...validateReviewResult(result),
    sourceFence: validateSourceFence(result, options),
  };
}

function main() {
  try {
    const output = runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    const normalized = error instanceof ExperienceReviewError
      ? error
      : new ExperienceReviewError(
        'EDX_RESULT_INVALID',
        error.message,
      );
    process.stderr.write(`${JSON.stringify(normalized.toJSON())}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { realpath } from 'node:fs/promises';

import { isDirectInvocation } from '../lib/machine-dev-paths.mjs';
import { inspectGitWorkspace } from './git-workspace.mjs';

export class CompletionReviewError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CompletionReviewError';
    this.code = code;
    this.details = details;
    this.detail = details;
  }

  toJSON() {
    return {
      ok: false,
      error: {
        type: this.name,
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

function fail(code, message, details = {}) {
  throw new CompletionReviewError(code, message, details);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function array(value, field, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    fail('COMPLETION_REVIEW_INVALID', `${field} must be an array`, { field });
  }
  return value.map(canonicalize);
}

function changedPaths(root) {
  const tracked = execFileSync(
    'git',
    ['diff', '--name-only', 'HEAD', '--'],
    { cwd: root, encoding: 'utf8' },
  );
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' },
  );
  return [...new Set(`${tracked}\n${untracked}`.split('\n').filter(Boolean))]
    .sort();
}

function normalizeScopePaths(value) {
  return array(value ?? [], 'scopePaths').map((item, index) => {
    if (
      typeof item !== 'string' ||
      item === '' ||
      path.isAbsolute(item) ||
      item.split('/').includes('..')
    ) {
      fail('COMPLETION_REVIEW_INVALID', 'scopePaths contains an invalid path', {
        index,
      });
    }
    return item.replaceAll('\\', '/').replace(/\/+$/, '');
  });
}

function pathInScope(candidate, scopePaths) {
  return scopePaths.some(
    (prefix) =>
      prefix === '.' ||
      candidate === prefix ||
      candidate.startsWith(`${prefix}/`),
  );
}

function validateEvidence(evidence, source) {
  return array(evidence, 'evidenceRefs').map((item, index) => {
    if (
      !isObject(item) ||
      typeof item.kind !== 'string' ||
      !['PASS', 'FAIL', 'UNPROVEN', 'NOT_RUN'].includes(item.result) ||
      typeof item.ref !== 'string' ||
      !isObject(item.source) ||
      item.source.commit !== source.commit ||
      item.source.workspaceDigest !== source.workspaceDigest
    ) {
      fail(
        'COMPLETION_REVIEW_EVIDENCE_STALE',
        'evidence must bind the current source',
        { index },
      );
    }
    return canonicalize(item);
  });
}

export async function prepareStandaloneCompletionReview(options = {}) {
  const root = await realpath(path.resolve(options.repoRoot ?? process.cwd()));
  const source = inspectGitWorkspace(root, {
    excludePaths: options.excludePaths ?? ['.dev-workflow'],
  });
  const obligations = array(
    options.obligations,
    'obligations',
    { required: true },
  );
  const evidenceRefs = validateEvidence(options.evidenceRefs ?? [], source);
  const scopePaths = normalizeScopePaths(options.scopePaths);
  const changed = changedPaths(root).filter(
    (item) => !item.startsWith('.dev-workflow/'),
  );
  const outOfScope =
    scopePaths.length === 0
      ? []
      : changed.filter((item) => !pathInScope(item, scopePaths));
  const material = {
    schemaVersion: 1,
    kind: 'peers-touch-standalone-completion-review',
    source,
    obligations,
    scopePaths,
    changedPaths: changed,
    outOfScope,
    evidenceRefs,
  };
  return {
    ok: true,
    mode: 'standalone',
    material,
    obligationsDigest: digest(obligations),
    evidenceDigest: digest(evidenceRefs),
    materialDigest: digest(material),
    reviewable:
      evidenceRefs.length > 0 &&
      evidenceRefs.every((item) => item.result === 'PASS') &&
      outOfScope.length === 0,
  };
}

export async function assessStandaloneCompletionReview(options = {}) {
  const prepared = await prepareStandaloneCompletionReview(options);
  const findings = array(options.findings ?? [], 'findings').map(
    (finding, index) => {
      if (
        !isObject(finding) ||
        !['P0', 'P1', 'P2'].includes(finding.severity) ||
        typeof finding.title !== 'string' ||
        typeof finding.status !== 'string' ||
        !['OPEN', 'RESOLVED'].includes(finding.status) ||
        !Array.isArray(finding.evidenceRefs)
      ) {
        fail('COMPLETION_REVIEW_INVALID', 'finding is invalid', { index });
      }
      return canonicalize(finding);
    },
  );
  const verdict =
    !prepared.reviewable ||
    findings.some(
      (finding) =>
        ['P0', 'P1'].includes(finding.severity) &&
        finding.status === 'OPEN',
    )
      ? 'FAIL'
      : 'PASS';
  return {
    ...prepared,
    findings,
    verdict,
    assessmentDigest: digest({
      materialDigest: prepared.materialDigest,
      findings,
      verdict,
    }),
  };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (
      ![
        '--repo-root',
        '--scope-paths',
        '--obligations',
        '--evidence',
        '--findings',
      ].includes(token)
    ) {
      fail('COMPLETION_REVIEW_USAGE', `unsupported option: ${token}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail('COMPLETION_REVIEW_USAGE', `missing value for ${token}`);
    }
    options[token.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

function jsonOption(options, name, fallback) {
  try {
    return options[name] === undefined
      ? fallback
      : JSON.parse(options[name]);
  } catch (error) {
    fail('COMPLETION_REVIEW_USAGE', `${name} is not valid JSON`, {
      cause: String(error),
    });
  }
}

export async function runCompletionReviewCli(argv = process.argv.slice(2)) {
  const { command, options } = parseArguments(argv);
  const input = {
    repoRoot: options['repo-root'],
    scopePaths:
      options['scope-paths']
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean) ?? [],
    obligations: jsonOption(options, 'obligations', null),
    evidenceRefs: jsonOption(options, 'evidence', []),
    findings: jsonOption(options, 'findings', []),
  };
  if (command === 'standalone' || command === 'prepare') {
    return prepareStandaloneCompletionReview(input);
  }
  if (command === 'assess') {
    return assessStandaloneCompletionReview(input);
  }
  fail('COMPLETION_REVIEW_USAGE', 'command must be standalone, prepare, or assess');
}

if (isDirectInvocation(import.meta.url)) {
  try {
    process.stdout.write(
      `${JSON.stringify(
        canonicalize(await runCompletionReviewCli()),
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    const typed =
      error instanceof CompletionReviewError
        ? error
        : new CompletionReviewError(
            'COMPLETION_REVIEW_INTERNAL_ERROR',
            error?.message ?? String(error),
          );
    process.stderr.write(`${JSON.stringify(typed.toJSON())}\n`);
    process.exitCode = 1;
  }
}

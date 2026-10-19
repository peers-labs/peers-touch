import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  assertSourceHead,
  assertString,
  fail,
} from './review-result-schema.mjs';
import {
  sha256Bytes,
  validateReviewResult,
} from './validator.mjs';

function resolveInside(root, relative, context) {
  assertString(relative, context);
  if (path.isAbsolute(relative)) {
    fail('EDX_BINDING_INVALID', `${context} must be repository-relative`);
  }
  const absolute = path.resolve(root, relative);
  const normalizedRoot = `${root}${path.sep}`;
  if (!absolute.startsWith(normalizedRoot)) {
    fail('EDX_BINDING_INVALID', `${context} escapes the repository root`);
  }
  let real;
  try {
    real = fs.realpathSync(absolute);
  } catch (error) {
    fail(
      'EDX_BINDING_INVALID',
      `${context} cannot be read`,
      { reason: error.message },
    );
  }
  if (!real.startsWith(normalizedRoot)) {
    fail('EDX_BINDING_INVALID', `${context} resolves outside the repository`);
  }
  return real;
}

function currentSourceHead(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fail(
      'EDX_BINDING_INVALID',
      'repository HEAD cannot be resolved',
      { reason: result.stderr.trim() },
    );
  }
  return assertSourceHead(result.stdout.trim(), 'repository HEAD');
}

function digestSourceBlob(bytes, algorithm) {
  if (algorithm === 'sha256') {
    return createHash('sha256').update(bytes).digest('hex');
  }
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

function sourceLineCount(bytes) {
  const text = bytes.toString('utf8').replaceAll('\r\n', '\n');
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function reviewSourceLocations(result) {
  return [
    ...result.facts.map((fact) => fact.source),
    ...result.contracts.map((contract) => contract.source),
    ...result.journeyStateGraph.states.map((state) => state.source),
    ...result.journeyStateGraph.edges.flatMap((edge) => edge.sourceRefs),
  ];
}

export function validateSourceFence(
  result,
  {
    repoRoot,
    packageRoot,
    runEnvelopePath,
    casePath,
    manifestPath,
    rubricPath,
  },
) {
  validateReviewResult(result);
  const root = fs.realpathSync(repoRoot);
  const packageBase = fs.realpathSync(packageRoot);
  const sourceHead = currentSourceHead(root);
  if (sourceHead !== result.evaluationBinding.sourceHead) {
    fail(
      'EDX_BINDING_INVALID',
      'current repository HEAD does not match ReviewResult',
    );
  }

  const digestInputs = [
    ['runEnvelopeDigest', runEnvelopePath],
    ['caseDigest', casePath],
    ['manifestDigest', manifestPath],
    ['rubricDigest', rubricPath],
  ];
  for (const [field, relative] of digestInputs) {
    const absolute = resolveInside(packageBase, relative, field);
    const actual = sha256Bytes(fs.readFileSync(absolute));
    if (actual !== result.evaluationBinding[field]) {
      fail('EDX_BINDING_INVALID', `${field} does not match ${relative}`);
    }
  }

  const lineCounts = new Map();
  for (const blob of result.evaluationBinding.sourceBlobs) {
    const absolute = resolveInside(root, blob.path, `source blob ${blob.path}`);
    const bytes = fs.readFileSync(absolute);
    const actual = digestSourceBlob(
      bytes,
      result.evaluationBinding.sourceBlobAlgorithm,
    );
    if (actual !== blob.digest) {
      fail(
        'EDX_BINDING_INVALID',
        `source blob digest mismatch for ${blob.path}`,
      );
    }
    lineCounts.set(blob.path, sourceLineCount(bytes));
  }
  for (const source of reviewSourceLocations(result)) {
    if (source.lineEnd > lineCounts.get(source.path)) {
      fail(
        'EDX_BINDING_INVALID',
        `source range exceeds current file for ${source.path}`,
        {
          lineEnd: source.lineEnd,
          lineCount: lineCounts.get(source.path),
        },
      );
    }
  }
  return {
    ok: true,
    sourceHead,
    sourceBlobCount: result.evaluationBinding.sourceBlobs.length,
  };
}

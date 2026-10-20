import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  assertSourceHead,
  assertString,
  assertStableId,
  assertSha256Digest,
  assertSourceBlobDigest,
  fail,
} from './review-result-schema.mjs';
import { validateExperienceCaseValue, loadGrammar, loadRuleCatalog } from './schema.mjs';
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

function readPackageJson(bytes, context) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('EDX_BINDING_INVALID', `${context} must be readable JSON`);
  }
}

function requireShape(value, keys, context) {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value)
    || !isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort())
  ) {
    fail('EDX_BINDING_INVALID', `${context} has an invalid field set`);
  }
}

function verifyPackageLinks(result, inputs, paths, root, packageBase) {
  const binding = result.evaluationBinding;
  const envelope = readPackageJson(inputs.get('runEnvelopeDigest'), 'run envelope');
  const manifest = readPackageJson(inputs.get('manifestDigest'), 'review manifest');
  requireShape(envelope, ['kind', 'schemaVersion', 'packageId', 'sourceHead', 'manifest', 'rubric', 'cases'], 'run envelope');
  requireShape(manifest, ['kind', 'schemaVersion', 'packageId', 'sourceHead', 'sourceBlobAlgorithm', 'cases'], 'review manifest');
  for (const [value, kind] of [
    [envelope, 'peers-touch-experience-review-envelope'],
    [manifest, 'peers-touch-experience-review-manifest'],
  ]) {
    if (value.kind !== kind || value.schemaVersion !== 1
      || value.packageId !== binding.packageId || value.sourceHead !== binding.sourceHead) {
      fail('EDX_BINDING_INVALID', `${kind} identity does not match EvaluationBinding`);
    }
  }
  for (const [field, digestField] of [['manifest', 'manifestDigest'], ['rubric', 'rubricDigest']]) {
    requireShape(envelope[field], ['path', 'digest'], `run envelope ${field}`);
    if (envelope[field].path !== paths.get(digestField)
      || envelope[field].digest !== binding[digestField]) {
      fail('EDX_BINDING_INVALID', `run envelope ${field} reference does not match input`);
    }
  }
  if (manifest.sourceBlobAlgorithm !== binding.sourceBlobAlgorithm
    || !Array.isArray(envelope.cases) || !Array.isArray(manifest.cases)
    || envelope.cases.length === 0 || envelope.cases.length !== manifest.cases.length) {
    fail('EDX_BINDING_INVALID', 'review package case/source inventory is invalid');
  }
  const ids = new Set();
  const casePaths = new Set();
  for (const entry of manifest.cases) {
    const keys = ['id', 'path', 'format', 'digest', 'sourceBlobs'];
    if (entry?.format === 'experience-case-json') keys.push('canonicalDigests');
    requireShape(entry, keys, 'review manifest case');
    assertStableId(entry.id, 'review manifest case ID');
    assertSha256Digest(entry.digest, 'review manifest case digest');
    resolveInside(packageBase, entry.path, 'review manifest case path');
    if (!Array.isArray(entry.sourceBlobs) || entry.sourceBlobs.length === 0) {
      fail('EDX_BINDING_INVALID', 'review manifest case requires source blobs');
    }
    const sourcePaths = [];
    for (const blob of entry.sourceBlobs) {
      requireShape(blob, ['path', 'digest'], 'review manifest source blob');
      resolveInside(root, blob.path, 'review manifest source path');
      assertSourceBlobDigest(blob.digest, binding.sourceBlobAlgorithm, 'review manifest source digest');
      sourcePaths.push(blob.path);
    }
    if (new Set(sourcePaths).size !== sourcePaths.length
      || !isDeepStrictEqual(sourcePaths, [...sourcePaths].sort())) {
      fail('EDX_BINDING_INVALID', 'review manifest sources must be unique and sorted');
    }
    if (ids.has(entry.id) || casePaths.has(entry.path)) {
      fail('EDX_BINDING_INVALID', 'review manifest case ID or path is duplicated');
    }
    ids.add(entry.id);
    casePaths.add(entry.path);
    if (!['source-backed-markdown', 'experience-case-json'].includes(entry.format)) {
      fail('EDX_BINDING_INVALID', 'review manifest case format is unsupported');
    }
    if (entry.format === 'experience-case-json') {
      requireShape(entry.canonicalDigests, ['case', 'contract', 'candidate'], 'canonical case projection');
      Object.values(entry.canonicalDigests).forEach((digest) => assertSha256Digest(digest, 'canonical case projection digest'));
    }
    const declared = envelope.cases.filter((item) => item?.id === entry.id);
    if (declared.length !== 1) fail('EDX_BINDING_INVALID', 'envelope case inventory differs from manifest');
    requireShape(declared[0], ['id', 'path', 'digest'], 'run envelope case');
    if (declared[0].path !== entry.path || declared[0].digest !== entry.digest) {
      fail('EDX_BINDING_INVALID', 'envelope case reference differs from manifest');
    }
  }
  const selected = manifest.cases.find((entry) => entry.path === paths.get('caseDigest'));
  if (selected === undefined || selected.digest !== binding.caseDigest
    || !isDeepStrictEqual(selected.sourceBlobs, binding.sourceBlobs)) {
    fail('EDX_BINDING_INVALID', 'selected case or source inventory differs from EvaluationBinding');
  }
  if (selected.format === 'experience-case-json') {
    const loaded = validateExperienceCaseValue(readPackageJson(inputs.get('caseDigest'), 'canonical case'), {
      ruleCatalog: loadRuleCatalog(path.join(root, 'docs/architecture/engineering/experience-design/rules.json')),
      grammar: loadGrammar(path.join(root, 'docs/client/common/ui-identity/grammar-bindings.json')),
    });
    requireShape(selected.canonicalDigests, ['case', 'contract', 'candidate'], 'canonical case projection');
    if (loaded.case.id !== selected.id || ['case', 'contract', 'candidate'].some(
      (field) => selected.canonicalDigests[field] !== loaded.digests[field],
    )) {
      fail('EDX_BINDING_INVALID', 'canonical case identity or projection digests differ');
    }
  }
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
  } = {},
) {
  validateReviewResult(result);
  if ([repoRoot, packageRoot, runEnvelopePath, casePath, manifestPath, rubricPath]
    .some((value) => typeof value !== 'string' || value.trim() === '')) {
    fail('EDX_BINDING_INVALID', 'source verification requires explicit repository, package and input paths');
  }
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
  const inputs = new Map();
  for (const [field, relative] of digestInputs) {
    const absolute = resolveInside(packageBase, relative, field);
    const bytes = fs.readFileSync(absolute);
    inputs.set(field, bytes);
    const actual = sha256Bytes(bytes);
    if (actual !== result.evaluationBinding[field]) {
      fail('EDX_BINDING_INVALID', `${field} does not match ${relative}`);
    }
  }
  verifyPackageLinks(result, inputs, new Map(digestInputs), root, packageBase);

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

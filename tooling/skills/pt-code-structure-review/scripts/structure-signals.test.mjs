import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeSource,
  classifySourcePath,
  isGeneratedSource,
  isReviewableSource,
  parseArguments,
  readStdinText,
  StructureSignalError,
} from './structure-signals.mjs';

test('switches inherited stdin to blocking mode before synchronous reads', () => {
  let blocking = null;
  const stream = {
    _handle: {
      setBlocking(value) {
        blocking = value;
      },
    },
  };
  const text = readStdinText(stream, (descriptor, encoding) => {
    assert.equal(descriptor, 0);
    assert.equal(encoding, 'utf8');
    assert.equal(blocking, true);
    return 'tooling/scripts/check.py\n';
  });

  assert.equal(text, 'tooling/scripts/check.py\n');
});

test('classifies authored and generated source paths deterministically', () => {
  assert.equal(isReviewableSource('apps/station/app/service/member.go'), true);
  assert.equal(isReviewableSource('./apps/station/app/service/member.go'), true);
  assert.equal(isReviewableSource('apps/desktop/src/page.tsx'), true);
  assert.equal(isReviewableSource('tooling/scripts/check.py'), true);
  assert.equal(isReviewableSource('tooling/make/review.mk'), true);
  assert.equal(isReviewableSource('model/domain/chat/chat.pb.go'), false);
  assert.equal(isReviewableSource('apps/mobile/src/gen/proto/chat.ts'), false);
  assert.equal(isReviewableSource('gen/proto/chat.ts'), false);
  assert.equal(isReviewableSource('generated/chat.ts'), false);
  assert.equal(isReviewableSource('generated/chat_pb2.py'), false);
  assert.equal(isReviewableSource('src/domain.generated.d.ts'), false);
  assert.equal(isReviewableSource('vendor/library/source.go'), false);
  assert.equal(isReviewableSource('third_party/library/source.ts'), false);
  assert.equal(isReviewableSource('node_modules/library/source.js'), false);
  assert.equal(
    isReviewableSource(
      'tooling/review-fixtures/code-structure/simple-rule/rule.ts',
    ),
    false,
  );
  assert.equal(isGeneratedSource('src/domain.generated.ts'), true);
  assert.deepEqual(classifySourcePath('generated/chat.ts'), {
    path: 'generated/chat.ts',
    status: 'SKIPPED',
    reason: 'generated-source',
  });
  assert.deepEqual(classifySourcePath('docs/design.md'), {
    path: 'docs/design.md',
    status: 'SKIPPED',
    reason: 'unsupported-file-kind',
  });
  assert.deepEqual(classifySourcePath('src/service.ts'), {
    path: 'src/service.ts',
    status: 'REVIEW',
    reason: 'authored-source',
  });
  assert.deepEqual(classifySourcePath('../outside.ts'), {
    path: '../outside.ts',
    status: 'SKIPPED',
    reason: 'invalid-path',
  });
});

test('emits advisory signals with stable codes and rule hints', () => {
  const imports = Array.from(
    { length: 20 },
    (_, index) => `import value${index} from './value-${index}.js';`,
  );
  const nested = [
    'export async function run(request) {',
    '  if (request) {',
    '    if (request.user) {',
    '      if (request.user.session) {',
    '        if (request.user.session.token) {',
    '          if (request.user.session.token.value) {',
    '            if (request.user.session.token.value.length) {',
    '              if (request.user.session.token.value.length > 1) {',
    '                if (request.user.session.token.value.length > 2) {',
    '                  await fetch(request.url);',
    '                }',
    '              }',
    '            }',
    '          }',
    '        }',
    '      }',
    '    }',
    '  }',
    '}',
  ];
  const source = [...imports, ...nested].join('\n');
  const results = analyzeSource('src/workflow.ts', source);
  const codes = results.map((result) => result.code);

  assert.deepEqual(codes, [
    'STRUCT-SIGNAL-IMPORT-FANOUT',
    'STRUCT-SIGNAL-INDENT-DEPTH',
  ]);
  assert.equal(results.every((result) => result.blocking === false), true);
  assert.deepEqual(results[0].ruleHints, [
    'STRUCT-03',
    'STRUCT-04',
    'STRUCT-05',
  ]);
});

test('large declarative content remains an advisory signal only', () => {
  const source = Array.from(
    { length: 500 },
    (_, index) => `  key${index}: '${index}',`,
  ).join('\n');
  const results = analyzeSource('src/catalog.ts', source);

  assert.deepEqual(
    results.map((result) => result.code),
    ['STRUCT-SIGNAL-FILE-LINES'],
  );
  assert.equal(results[0].blocking, false);
});

test('counts physical lines without treating the final newline as a line', () => {
  const below = `${Array.from({ length: 499 }, () => 'value').join('\n')}\n`;
  const atThreshold = `${Array.from({ length: 500 }, () => 'value').join('\n')}\n`;

  assert.deepEqual(analyzeSource('src/below.ts', below), []);
  assert.deepEqual(
    analyzeSource('src/threshold.ts', atThreshold).map((result) => result.code),
    ['STRUCT-SIGNAL-FILE-LINES'],
  );
});

test('counts unique import dependencies and recognizes destructured require', () => {
  const duplicateImports = Array.from(
    { length: 20 },
    (_, index) => `import { value${index} } from './shared.js';`,
  ).join('\n');
  const uniqueRequires = Array.from(
    { length: 20 },
    (_, index) => `const { value } = require('./value-${index}.js');`,
  ).join('\n');

  assert.deepEqual(analyzeSource('src/duplicates.ts', duplicateImports), []);
  assert.deepEqual(
    analyzeSource('src/requires.cjs', uniqueRequires).map(
      (result) => result.code,
    ),
    ['STRUCT-SIGNAL-IMPORT-FANOUT'],
  );
});

test('parses supported CLI options and rejects unknown options', () => {
  assert.deepEqual(parseArguments(['--range', 'main...HEAD', '--format', 'json']), {
    range: 'main...HEAD',
    fixtureDir: null,
    format: 'json',
    classifyStdin: false,
    filesStdin: false,
  });
  assert.equal(parseArguments(['--classify-stdin']).classifyStdin, true);
  assert.equal(parseArguments(['--files-stdin']).filesStdin, true);
  assert.throws(
    () => parseArguments(['--unknown']),
    (error) =>
      error instanceof StructureSignalError &&
      error.code === 'STRUCTURE_SIGNALS_USAGE',
  );
  assert.throws(
    () => parseArguments(['--range']),
    (error) =>
      error instanceof StructureSignalError &&
      error.code === 'STRUCTURE_SIGNALS_USAGE',
  );
  assert.throws(
    () => parseArguments(['--classify-stdin', '--fixture-dir', 'fixtures']),
    (error) =>
      error instanceof StructureSignalError &&
      error.code === 'STRUCTURE_SIGNALS_USAGE',
  );
  assert.throws(
    () => parseArguments(['--classify-stdin', '--files-stdin']),
    (error) =>
      error instanceof StructureSignalError &&
      error.code === 'STRUCTURE_SIGNALS_USAGE',
  );
  assert.throws(
    () => parseArguments(['--files-stdin', '--range', 'HEAD']),
    (error) =>
      error instanceof StructureSignalError &&
      error.code === 'STRUCTURE_SIGNALS_USAGE',
  );
});

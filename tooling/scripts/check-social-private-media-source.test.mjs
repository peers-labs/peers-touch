import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_GENERATOR_TEST,
  REQUIRED_GO_TESTS,
  REQUIRED_RUNNER_TEST,
  REQUIRED_RUST_TESTS,
  REQUIRED_VITEST_TESTS,
  validateGoTestEvents,
  validateNodeTap,
  validateNodeTestSource,
  validateRustTestList,
  validateRustTestOutput,
  validateVitestReport,
} from './check-social-private-media-source.mjs';

function goEvent(Action, Test) {
  return JSON.stringify({ Action, Package: 'example.test', Test });
}

function passingGoOutput() {
  return REQUIRED_GO_TESTS.flatMap((name) => [
    goEvent('run', name),
    goEvent('pass', name),
  ]).join('\n');
}

function passingRustList() {
  return REQUIRED_RUST_TESTS.map((name) => `${name}: test`).join('\n');
}

function passingRustOutput() {
  return REQUIRED_RUST_TESTS.map((name) => `test ${name} ... ok`).join('\n');
}

function vitestReport(status = 'passed') {
  return JSON.stringify({
    testResults: [{
      assertionResults: REQUIRED_VITEST_TESTS.map((title) => ({
        status,
        title,
      })),
    }],
  });
}

test('accepts one passing terminal result for every required language test', () => {
  assert.equal(
    validateNodeTap(`TAP version 13\nok 1 - ${REQUIRED_GENERATOR_TEST}\n`).status,
    'PASS',
  );
  assert.equal(validateGoTestEvents(passingGoOutput()).status, 'PASS');
  assert.equal(validateRustTestList(passingRustList()).status, 'PASS');
  assert.equal(validateRustTestOutput(passingRustOutput()).status, 'PASS');
  assert.equal(validateVitestReport(vitestReport()).status, 'PASS');
});

test('private-media source runner rejects missing skipped duplicate and zero-result tests', () => {
  assert.equal(
    validateNodeTestSource(
      `test('${REQUIRED_RUNNER_TEST}', () => {});`,
      REQUIRED_RUNNER_TEST,
    ).status,
    'PASS',
  );
  assert.throws(
    () => validateNodeTestSource('', REQUIRED_RUNNER_TEST),
    /missing/,
  );
  assert.throws(
    () => validateNodeTestSource(
      `test.skip('${REQUIRED_RUNNER_TEST}', () => {});`,
      REQUIRED_RUNNER_TEST,
    ),
    /skipped/,
  );
  assert.throws(
    () => validateNodeTestSource(
      [
        `test('${REQUIRED_RUNNER_TEST}', () => {});`,
        `test('${REQUIRED_RUNNER_TEST}', () => {});`,
      ].join('\n'),
      REQUIRED_RUNNER_TEST,
    ),
    /duplicated/,
  );

  assert.throws(() => validateNodeTap('TAP version 13\n'), /zero required/);
  assert.throws(
    () => validateNodeTap(
      `ok 1 - ${REQUIRED_GENERATOR_TEST} # SKIP unavailable\n`,
    ),
    /skipped/,
  );
  assert.throws(
    () => validateNodeTap(
      [
        `ok 1 - ${REQUIRED_GENERATOR_TEST}`,
        `ok 2 - ${REQUIRED_GENERATOR_TEST}`,
      ].join('\n'),
    ),
    /duplicate/,
  );

  assert.throws(
    () => validateGoTestEvents(goEvent('pass', 'TestUnrelated')),
    /zero required/,
  );
  assert.throws(
    () => validateGoTestEvents(
      REQUIRED_GO_TESTS.map((name) => goEvent('run', name)).join('\n'),
    ),
    /no terminal result/,
  );
  assert.throws(
    () => validateGoTestEvents(
      `${passingGoOutput()}\n${goEvent('skip', REQUIRED_GO_TESTS[0])}`,
    ),
    /skipped/,
  );
  assert.throws(
    () => validateGoTestEvents(
      `${passingGoOutput()}\n${goEvent('pass', REQUIRED_GO_TESTS[0])}`,
    ),
    /duplicate/,
  );

  assert.throws(
    () => validateRustTestList('unrelated::test: test'),
    /zero required/,
  );
  assert.throws(
    () => validateRustTestList(
      REQUIRED_RUST_TESTS.slice(1).map((name) => `${name}: test`).join('\n'),
    ),
    /missing/,
  );
  assert.throws(
    () => validateRustTestList(`${passingRustList()}\n${REQUIRED_RUST_TESTS[0]}: test`),
    /duplicated/,
  );
  assert.throws(
    () => validateRustTestOutput(
      passingRustOutput().replace(
        `test ${REQUIRED_RUST_TESTS[0]} ... ok`,
        `test ${REQUIRED_RUST_TESTS[0]} ... ignored`,
      ),
    ),
    /skipped/,
  );

  assert.throws(
    () => validateVitestReport(JSON.stringify({ testResults: [] })),
    /zero required/,
  );
  assert.throws(
    () => validateVitestReport(vitestReport('skipped')),
    /skipped/,
  );
  const duplicateVitest = JSON.parse(vitestReport());
  duplicateVitest.testResults.push(duplicateVitest.testResults[0]);
  assert.throws(
    () => validateVitestReport(JSON.stringify(duplicateVitest)),
    /duplicate/,
  );
});

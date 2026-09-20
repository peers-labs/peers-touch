import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_POSTGRES_TESTS,
  runContentPreKeyPostgresTests,
  validateGoTestEvents,
} from './run-content-prekey-postgres-tests.mjs';

function event(Action, Test) {
  return JSON.stringify({ Action, Test });
}

function passingOutput() {
  return REQUIRED_POSTGRES_TESTS.flatMap((name) => [
    event('run', name),
    event('pass', name),
  ]).join('\n');
}

test('accepts one passing terminal event for every required PostgreSQL test', () => {
  assert.deepEqual(validateGoTestEvents(passingOutput()), {
    status: 'PASS',
    passed: [...REQUIRED_POSTGRES_TESTS],
  });
});

test('rejects zero matches, missing terminal events, failures, and skips', () => {
  assert.throws(() => validateGoTestEvents(event('pass', 'TestUnrelated')), /zero/);
  assert.throws(
    () =>
      validateGoTestEvents(
        REQUIRED_POSTGRES_TESTS.map((name) => event('run', name)).join('\n'),
      ),
    /no terminal event/,
  );
  assert.throws(
    () =>
      validateGoTestEvents(
        passingOutput().replace(
          event('pass', REQUIRED_POSTGRES_TESTS[0]),
          event('fail', REQUIRED_POSTGRES_TESTS[0]),
        ),
      ),
    /did not pass/,
  );
  assert.throws(
    () =>
      validateGoTestEvents(
        `${passingOutput()}\n${event(
          'skip',
          `${REQUIRED_POSTGRES_TESTS[3]}/publish`,
        )}`,
      ),
    /required test skipped/,
  );
});

test('requires the PostgreSQL DSN before spawning go test', () => {
  let called = false;
  assert.throws(
    () =>
      runContentPreKeyPostgresTests({
        projectRoot: '/repo',
        environment: {},
        runCommand() {
          called = true;
        },
      }),
    /MESSAGING_TEST_POSTGRES_DSN is required/,
  );
  assert.equal(called, false);
});

test('runs the exact package and checked test manifest', () => {
  let invocation;
  const result = runContentPreKeyPostgresTests({
    projectRoot: '/repo',
    environment: { MESSAGING_TEST_POSTGRES_DSN: 'postgres://test' },
    runCommand(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, stdout: passingOutput(), stderr: '' };
    },
  });

  assert.equal(result.status, 'PASS');
  assert.equal(invocation.command, 'go');
  assert.equal(invocation.options.cwd, '/repo/apps/station');
  assert.deepEqual(invocation.args.slice(0, 5), [
    'test',
    '-json',
    '-count=1',
    '-run',
    `^(?:${REQUIRED_POSTGRES_TESTS.join('|')})$`,
  ]);
  assert.equal(invocation.args.at(-1), './app/subserver/key_exchange');
});

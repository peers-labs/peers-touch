#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_POSTGRES_TESTS = Object.freeze([
  'TestContentPreKeyPostgresPublicationReceiptContention',
  'TestContentPreKeyPostgresPublicationReceiptConflictingContention',
  'TestContentPreKeyPostgresPublicationAllExistingRollsBackPendingReceipt',
  'TestContentPreKeyPostgresPublicationReceiptGrowthBound',
  'TestContentPreKeyPostgresPublicationReplayAfterProfileRotation',
  'TestContentPreKeyPostgresPublicationReplayRejectsRevokedEndpoint',
  'TestContentPreKeyPostgresPublicationRevocationRace',
  'TestContentPreKeyPostgresPublicationReplayRevocationRace',
  'TestContentPreKeyPostgresClaimRevocationRace',
  'TestContentPreKeyPostgresPublicationReceiptPoolActorLockOrder',
  'TestContentPreKeyPostgresPoolLockOrder',
  'TestContentPreKeyPostgresConcurrentInitialRecoveryPublication',
]);

function fail(message) {
  throw new Error(`content PreKey PostgreSQL tests: ${message}`);
}

export function validateGoTestEvents(output) {
  const terminal = new Map();
  let matchedEvents = 0;

  for (const [index, line] of output.split('\n').entries()) {
    if (line.trim() === '') continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      fail(`invalid go test JSON on line ${index + 1}: ${error.message}`);
    }
    if (typeof event.Test !== 'string') continue;
    const required = REQUIRED_POSTGRES_TESTS.find(
      (name) => event.Test === name || event.Test.startsWith(`${name}/`),
    );
    if (!required) continue;
    matchedEvents += 1;
    if (event.Action === 'skip') {
      fail(`required test skipped: ${event.Test}`);
    }
    if (event.Test === required && ['pass', 'fail'].includes(event.Action)) {
      terminal.set(required, event.Action);
    }
  }

  if (matchedEvents === 0) fail('go test produced zero required test events');
  const missing = REQUIRED_POSTGRES_TESTS.filter((name) => !terminal.has(name));
  if (missing.length > 0) {
    fail(`required tests have no terminal event: ${missing.join(', ')}`);
  }
  const failed = REQUIRED_POSTGRES_TESTS.filter(
    (name) => terminal.get(name) !== 'pass',
  );
  if (failed.length > 0) fail(`required tests did not pass: ${failed.join(', ')}`);

  return { status: 'PASS', passed: [...REQUIRED_POSTGRES_TESTS] };
}

export function runContentPreKeyPostgresTests({
  projectRoot,
  environment = process.env,
  runCommand = spawnSync,
}) {
  if (!environment.MESSAGING_TEST_POSTGRES_DSN?.trim()) {
    fail('MESSAGING_TEST_POSTGRES_DSN is required');
  }
  const pattern = `^(?:${REQUIRED_POSTGRES_TESTS.join('|')})$`;
  const result = runCommand(
    'go',
    [
      'test',
      '-json',
      '-count=1',
      '-run',
      pattern,
      './app/subserver/key_exchange',
    ],
    {
      cwd: path.join(projectRoot, 'apps/station'),
      env: environment,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.error) fail(`failed to execute go test: ${result.error.message}`);
  const validation = validateGoTestEvents(String(result.stdout ?? ''));
  if (result.status !== 0) {
    fail(`go test exited with status ${result.status}: ${String(result.stderr ?? '').trim()}`);
  }
  return validation;
}

export function main() {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  );
  process.stdout.write(
    `${JSON.stringify(runContentPreKeyPostgresTests({ projectRoot }))}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

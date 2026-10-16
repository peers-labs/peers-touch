import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateCompletionSnapshot } from './completion-audit-schema.mjs';

const SKILL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

function fixture(name) {
  return JSON.parse(
    readFileSync(
      path.join(SKILL_ROOT, 'fixtures', `${name}.json`),
      'utf8',
    ),
  );
}

test('standalone close-ready requires and accepts a closed receipt', () => {
  const report = evaluateCompletionSnapshot(
    fixture('standalone-close-ready'),
  );

  assert.equal(report.status, 'PASS');
  assert.equal(report.mode, 'standalone');
  assert.equal(report.claimClass, 'close-ready');
  assert.equal(report.blockers.length, 0);
});

test('tracked close-ready reports every live owner and pending resource', () => {
  const report = evaluateCompletionSnapshot(
    fixture('tracked-close-blocked'),
  );

  assert.equal(report.status, 'BLOCKED');
  assert.deepEqual(
    report.blockers.map((blocker) => blocker.checkId),
    [
      'close.receipt',
      'close.resource-matrix',
      'close.declaration',
      'close.projections',
      'close.mount',
    ],
  );
});

test('standalone implementation-ready rejects tracked state', () => {
  const snapshot = fixture('standalone-close-ready');
  snapshot.claimClass = 'implementation-ready';
  snapshot.declaration.state = 'ACTIVE';
  snapshot.mount = { mountId: 'mount-unexpected', state: 'mounted' };

  const report = evaluateCompletionSnapshot(snapshot);

  assert.equal(report.status, 'BLOCKED');
  assert.ok(
    report.blockers.some(
      (blocker) => blocker.checkId === 'standalone.unmounted',
    ),
  );
});

test('tracked delivery-ready requires completed run and terminal Session', () => {
  const snapshot = fixture('tracked-close-blocked');
  snapshot.claimClass = 'delivery-ready';
  snapshot.closeReceipt = null;
  snapshot.declaration.state = 'ACTIVE';
  snapshot.run.state = 'completed';
  snapshot.session.state = 'FUNCTIONAL_RUNNING';

  const report = evaluateCompletionSnapshot(snapshot);

  assert.equal(report.status, 'BLOCKED');
  assert.deepEqual(report.blockers, [
    {
      checkId: 'tracked.session-terminal',
      message: 'tracked delivery requires a terminal Development Session',
    },
  ]);
});

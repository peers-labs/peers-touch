import assert from 'node:assert/strict';
import test from 'node:test';

import { resourceFixture } from './fixtures/resource-owner.mjs';
import { readResourceState } from './machine-dev-resource-contract.mjs';

function writeContent(f, device, target) {
  const op = f.owner.propose({ resourceId: device.id, action: 'use', target });
  if (op.status === 'pending') f.owner.decide(op.id, 'force', op.impactDigest);
  f.owner.begin(op.id);
  f.owner.installDuringUse(op.id, f.appPath);
  return f.owner.finish(op.id);
}

test('ResourceOverwriteJourney: shared profiles see actual writer and each replacement needs its own decision', (t) => {
  const f = resourceFixture(t);
  const [device] = f.create();
  const target = { bundleId: 'test.app', source: f.source(), purpose: 'first' };
  writeContent(f, device, target);
  f.setProfile('beta');
  f.owner.assign({ count: 1, purpose: 'Shared' });
  const same = f.owner.propose({ resourceId: device.id, action: 'use', target });
  assert.equal(same.status, 'ready');
  f.owner.decide(same.id, 'cancel', same.impactDigest);
  const op = f.owner.propose({ resourceId: device.id, action: 'use', target: { ...target, purpose: 'second' } });
  assert.equal(op.status, 'pending');
  assert.equal(op.impact.name, 'Device 1');
  assert.equal(op.impact.sharedProfiles.length, 2);
  assert.throws(() => f.owner.begin(op.id), { code: 'RESOURCE_DECISION_REQUIRED' });
  f.owner.decide(op.id, 'decline', op.impactDigest);
  assert.equal(f.owner.inspectAssignments().devices[0].content.purpose, 'first');
  const approved = f.owner.propose({ resourceId: device.id, action: 'use', target: { ...target, purpose: 'second' } });
  f.owner.decide(approved.id, 'force', approved.impactDigest);
  f.owner.begin(approved.id);
  f.owner.installDuringUse(approved.id, f.appPath);
  f.owner.finish(approved.id);
  assert.throws(() => f.owner.begin(approved.id), { code: 'RESOURCE_DECISION_REQUIRED' });
  f.setProfile('alpha');
  const view = f.owner.inspectAssignments().devices[0];
  assert.equal(view.content.purpose, 'second');
  assert.equal(view.lastWriter.profile, 'beta');
  assert.equal(f.owner.propose({ resourceId: device.id, action: 'delete' }).status, 'pending');
});

test('post-notice sharing, holder and source races invalidate the exact decision', (t) => {
  const f = resourceFixture(t);
  const [device] = f.create();
  const op = f.owner.propose({ resourceId: device.id, action: 'delete' });
  f.owner.decide(op.id, 'force', op.impactDigest);
  f.setProfile('beta');
  f.owner.assign({ count: 1, purpose: 'Joined after notice' });
  f.setProfile('alpha');
  assert.throws(() => f.owner.begin(op.id), { code: 'RESOURCE_DECISION_STALE' });
  let current = readResourceState({ home: f.home }).operations.find((item) => item.id === op.id);
  assert.equal(current.status, 'pending');
  assert.equal(current.impact.sharedProfiles.length, 2);
  assert.throws(() => f.owner.decide(op.id, 'force', op.impactDigest), { code: 'RESOURCE_DECISION_STALE' });
  f.owner.decide(op.id, 'force', current.impactDigest);
  f.holders.push({ resourceKind: 'simulator.ios', resourceId: device.providerId, workspaceId: 'other', leaseId: 'other' });
  assert.throws(() => f.owner.begin(op.id), { code: 'RESOURCE_DECISION_STALE' });
  current = readResourceState({ home: f.home }).operations.find((item) => item.id === op.id);
  f.owner.decide(op.id, 'force', current.impactDigest);
  f.setDigest('changed bytes');
  assert.throws(() => f.owner.begin(op.id), { code: 'RUNTIME_IDENTITY_MISMATCH' });
});

test('partial mutation and interrupted deletion keep provider identity and truthful retry state', (t) => {
  const f = resourceFixture(t);
  const [device] = f.create();
  const op = f.owner.propose({ resourceId: device.id, action: 'delete' });
  f.owner.decide(op.id, 'force', op.impactDigest);
  f.owner.begin(op.id);
  const failed = f.owner.finish(op.id, new Error('delete failed'));
  assert.equal(failed.progress, 'cleanup-failed');
  assert.equal(failed.providerId, device.providerId);
  assert.equal(f.devices.size, 1);
  const retry = f.owner.propose({ resourceId: device.id, action: 'delete' });
  f.owner.decide(retry.id, 'force', retry.impactDigest);
  f.owner.begin(retry.id);
  assert.throws(() => f.owner.propose({ resourceId: device.id, action: 'boot' }), { code: 'RESOURCE_RECOVERY_REQUIRED' });
  f.devices.delete(device.providerId);
  const recovered = f.owner.recoverOperation(retry.id);
  assert.equal(recovered.progress, 'removed');
  assert.equal(recovered.content, null);
  assert.equal(recovered.sharedProfiles.length, 1);
  assert.equal(f.owner.detach(device.id).deleted, false);
});

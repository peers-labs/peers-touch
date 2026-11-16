import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import { machineResourcesPath } from '../lib/machine-dev-paths.mjs';
import { resourceFixture } from './fixtures/resource-owner.mjs';
import { profileResourceRequirements } from './machine-dev-resource-contract.mjs';
import { readResourceState } from './machine-dev-resource-contract.mjs';

test('Profile parser projects optional requirements without machine IDs or quantity defaults', () => {
  assert.deepEqual(profileResourceRequirements({}), []);
  assert.throws(() => profileResourceRequirements({ PT_MOBILE_IOS_RUNTIME: 'runtime' }),
    { code: 'PROFILE_UNAVAILABLE' });
  const [requirement] = profileResourceRequirements({
    PT_MOBILE_IOS_RUNTIME: 'runtime', PT_MOBILE_IOS_DEVICE_TYPE: 'phone', PT_MOBILE_IOS_DATA: 'fresh',
  });
  assert.equal(requirement.data, 'fresh');
  assert.ok(!Object.hasOwn(requirement, 'count'));
});

test('ResourceIdAssignmentJourney: arbitrary count, shared references, purpose and detach preserve physical content', (t) => {
  const f = resourceFixture(t);
  const initial = f.create(3);
  assert.equal(initial.length, 3);
  assert.equal(new Set(initial.map((item) => item.id)).size, 3);
  f.setProfile('beta');
  const shared = f.owner.assign({ count: 2, purpose: 'Review' });
  assert.equal(shared.devices.length, 2);
  assert.deepEqual(shared.devices[0].sharedProfiles.map((ref) => ref.profile).sort(), ['alpha', 'beta']);
  const id = shared.devices[0].id;
  const providerId = shared.devices[0].providerId;
  const before = structuredClone(f.devices.get(providerId));
  assert.equal(f.owner.detach(id).deleted, false);
  assert.deepEqual(f.devices.get(providerId), before);
  f.setProfile('alpha');
  assert.equal(f.owner.inspectAssignments().devices.length, 3);
  assert.deepEqual(f.owner.inspectAssignments().devices.find((item) => item.id === id).sharedProfiles.map((ref) => ref.profile), ['alpha']);
});

test('readable discovery disambiguates duplicate names and rejects stale list selections', (t) => {
  const f = resourceFixture(t);
  const initial = f.create(2);
  const state = readResourceState({ home: f.home });
  state.instances.forEach((item) => { item.displayName = 'Same device'; });
  writeFileSync(machineResourcesPath(f.home), JSON.stringify(state));
  f.setProfile('beta');
  assert.throws(() => f.owner.assign({ names: ['Same device'], purpose: 'Named' }),
    { code: 'RESOURCE_NAME_AMBIGUOUS' });
  const discovery = f.owner.discover();
  const key = discovery.devices[0].selectionKey;
  const assigned = f.owner.assign({
    selectionKeys: [key], snapshot: discovery.snapshot, purpose: 'Chosen',
  }).devices[0];
  assert.equal(assigned.providerId, discovery.devices[0].observation.providerId);
  const stale = f.owner.discover();
  f.devices.get(initial[0].providerId).name = 'Renamed provider';
  assert.throws(() => f.owner.assign({ selectionKeys: [key], snapshot: stale.snapshot, purpose: 'Stale' }),
    { code: 'RESOURCE_SELECTION_STALE' });
  assert.equal(f.owner.inspectAssignments().devices[0].id, assigned.id);
});

test('creation persists nonce before provider mutation and recovers without allocating twice', (t) => {
  const f = resourceFixture(t);
  const create = f.provider.create;
  let interrupted = true;
  f.provider.create = (intent) => {
    const persisted = readResourceState({ home: f.home });
    assert.equal(persisted.instances[0].preparation.nonce, intent.nonce);
    const device = create(intent);
    if (interrupted) {
      interrupted = false;
      throw new Error('crash after provider create before publication');
    }
    return device;
  };
  assert.throws(() => f.create(1, 'recover'), /crash/);
  assert.equal(f.devices.size, 1);
  assert.equal(readResourceState({ home: f.home }).instances[0].progress, 'preparing');
  const recovered = f.create(1, 'recover');
  assert.equal(f.devices.size, 1);
  assert.equal(recovered[0].progress, 'present');
  assert.throws(() => f.create(2, 'recover'), { code: 'RESOURCE_PREPARATION_MISMATCH' });
});

test('provider alias records fail closed and actual holders block detach', (t) => {
  const f = resourceFixture(t);
  const [device] = f.create();
  f.holders.push({ resourceKind: 'simulator.ios', resourceId: device.providerId, workspaceId: 'other' });
  assert.throws(() => f.owner.detach(device.id), { code: 'PHYSICAL_RESOURCE_CONFLICT' });
  f.holders.length = 0;
  const file = machineResourcesPath(f.home);
  const state = JSON.parse(readFileSync(file, 'utf8'));
  state.instances.push({ ...state.instances[0], id: `ios-${'f'.repeat(24)}` });
  writeFileSync(file, JSON.stringify(state));
  assert.throws(() => readResourceState({ home: f.home }), { code: 'RESOURCE_PROVIDER_COLLISION' });
});

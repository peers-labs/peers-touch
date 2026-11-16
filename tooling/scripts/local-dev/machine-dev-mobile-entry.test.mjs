import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import { resourceFixture } from './fixtures/resource-owner.mjs';

test('Mobile entries have one UUID owner and connect-only Station behavior', () => {
  const outer = readFileSync(new URL('./mobile-ios-sim.sh', import.meta.url), 'utf8');
  const inner = readFileSync(new URL('../../../apps/mobile/scripts/ios-dev-sim.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(outer, /station-dev\.sh|station\s+(?:start|restart|reset)/);
  assert.match(inner, /resource-run-ios/);
  assert.match(inner, /resource-use-install/);
  assert.match(inner, /-destination "id=\$IOS_UDID"/);
  assert.doesNotMatch(inner, /simctl (?:create|delete|boot)|tauri ios dev/);
});

test('a source change during a native build rejects installation before provider mutation', (t) => {
  const f = resourceFixture(t);
  const [device] = f.create();
  const op = f.owner.propose({ resourceId: device.id, action: 'use', target: { bundleId: 'test.app' } });
  f.owner.begin(op.id);
  f.setDigest('different source bytes');
  assert.throws(() => f.owner.installDuringUse(op.id, f.appPath), { code: 'RUNTIME_IDENTITY_MISMATCH' });
  assert.equal(f.devices.get(device.providerId).installed, null);
});

test('runtime readback rejects a replaced installation and cannot start two mutations', (t) => {
  const f = resourceFixture(t);
  const [device] = f.create();
  const first = f.owner.propose({ resourceId: device.id, action: 'use', target: { bundleId: 'test.app' } });
  const second = f.owner.propose({ resourceId: device.id, action: 'boot' });
  f.owner.begin(first.id);
  assert.throws(() => f.owner.begin(second.id), { code: 'RESOURCE_OPERATION_ACTIVE' });
  f.owner.installDuringUse(first.id, f.appPath);
  f.devices.get(device.providerId).installed.artifactDigest = 'replaced';
  assert.equal(f.owner.finish(first.id).content.verified, false);
});

test('invalid bundle identity cannot replace the admitted native application', (t) => {
  const f = resourceFixture(t);
  const [device] = f.create();
  const operation = f.owner.propose({ resourceId: device.id, action: 'use', target: { bundleId: 'test.app' } });
  f.owner.begin(operation.id);
  f.provider.bundleIdentity = () => 'another.app';
  writeFileSync(`${f.appPath}/unexpected.txt`, 'wrong app');
  assert.throws(() => f.owner.installDuringUse(operation.id, f.appPath), { code: 'RESOURCE_ARTIFACT_INVALID' });
  assert.equal(f.devices.get(device.providerId).installed, null);
});

test('native source markers, endpoint ownership and references are checked before installation', (t) => {
  const f = resourceFixture(t);
  const [device] = f.create();
  const operation = f.owner.propose({ resourceId: device.id, action: 'use', target: { bundleId: 'test.app' } });
  f.owner.begin(operation.id);
  const identity = f.provider.nativeIdentity;
  f.provider.nativeIdentity = () => ({ ...identity(), workspaceDigest: 'old' });
  assert.throws(() => f.owner.installDuringUse(operation.id, f.appPath), { code: 'RESOURCE_NATIVE_IDENTITY_UNPROVEN' });
  assert.equal(f.devices.get(device.providerId).installed, null);
  f.provider.nativeIdentity = identity;
  f.setProfile('beta');
  f.owner.assign({ count: 1, purpose: 'Late reader' });
  f.setProfile('alpha');
  assert.throws(() => f.owner.installDuringUse(operation.id, f.appPath), { code: 'RESOURCE_DECISION_STALE' });
  f.provider.devEndpointUsers = () => [{ providerId: 'foreign', name: 'Manual device' }];
  assert.throws(() => f.owner.checkDevEndpoint(device.providerId, 'http://127.0.0.1:7573'), { code: 'RESOURCE_ENDPOINT_CONFLICT' });
});

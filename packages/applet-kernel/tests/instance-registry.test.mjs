// Standalone Node test for DefaultInstanceRegistry.
//
// Imports from the package barrel (../dist/index.js) which the integrator wires
// up later. A deterministic fake clock keeps timestamp assertions stable.

import assert from 'node:assert/strict';

import { DefaultInstanceRegistry } from '../dist/index.js';

// Injected fake clock: `t` is advanced manually to control timestamps.
let t = 1000;
const clock = { now: () => t };

function makeInput(overrides = {}) {
  return {
    appletId: 'com.example.app',
    instanceId: 'inst-1',
    sessionId: 'session-secret',
    manifestVersion: '1.0.0',
    platform: 'desktop',
    ...overrides,
  };
}

// create registers with materializing state and correct timestamps.
{
  t = 1000;
  const registry = new DefaultInstanceRegistry(clock);
  const instance = registry.create(makeInput());

  assert.equal(instance.state, 'materializing');
  assert.equal(instance.createdAt, 1000);
  assert.equal(instance.lastTouchedAt, 1000);
  assert.equal(instance.lastVisibleAt, 0);
  assert.equal(instance.lastHiddenAt, 0);
  assert.equal(instance.memoryEstimate, 0);
  assert.equal(instance.crashCount, 0);
  assert.equal(instance.appletId, 'com.example.app');
  assert.equal(instance.manifestVersion, '1.0.0');
  assert.equal(instance.platform, 'desktop');
  assert.deepEqual(registry.get('inst-1'), instance);
}

// duplicate instanceId throws.
{
  const registry = new DefaultInstanceRegistry(clock);
  registry.create(makeInput());
  assert.throws(() => registry.create(makeInput()));
}

// setState to 'visible' sets lastVisibleAt.
{
  const registry = new DefaultInstanceRegistry(clock);
  registry.create(makeInput());
  const updated = registry.setState('inst-1', 'visible', 2000);

  assert.equal(updated.state, 'visible');
  assert.equal(updated.lastVisibleAt, 2000);
  assert.equal(updated.lastTouchedAt, 2000);
  assert.equal(updated.lastHiddenAt, 0);
}

// setState to 'hidden-warm' sets lastHiddenAt.
{
  const registry = new DefaultInstanceRegistry(clock);
  registry.create(makeInput());
  const updated = registry.setState('inst-1', 'hidden-warm', 3000);

  assert.equal(updated.state, 'hidden-warm');
  assert.equal(updated.lastHiddenAt, 3000);
  assert.equal(updated.lastTouchedAt, 3000);
  assert.equal(updated.lastVisibleAt, 0);
}

// setState on a missing instance returns undefined.
{
  const registry = new DefaultInstanceRegistry(clock);
  assert.equal(registry.setState('missing', 'visible', 5000), undefined);
}

// touch updates lastTouchedAt.
{
  t = 1000;
  const registry = new DefaultInstanceRegistry(clock);
  registry.create(makeInput());
  registry.touch('inst-1', 4200);
  assert.equal(registry.get('inst-1').lastTouchedAt, 4200);
}

// incrementCrashCount returns incrementing values.
{
  const registry = new DefaultInstanceRegistry(clock);
  registry.create(makeInput());
  assert.equal(registry.incrementCrashCount('inst-1'), 1);
  assert.equal(registry.incrementCrashCount('inst-1'), 2);
  assert.equal(registry.get('inst-1').crashCount, 2);
}

// listByState filters correctly.
{
  const registry = new DefaultInstanceRegistry(clock);
  registry.create(makeInput({ instanceId: 'a' }));
  registry.create(makeInput({ instanceId: 'b' }));
  registry.create(makeInput({ instanceId: 'c' }));
  registry.setState('a', 'visible', 6000);
  registry.setState('b', 'visible', 6000);

  const visible = registry.listByState('visible');
  assert.equal(visible.length, 2);
  assert.deepEqual(visible.map((i) => i.instanceId).sort(), ['a', 'b']);
  assert.equal(registry.listByState('materializing').length, 1);
  assert.equal(registry.list().length, 3);
}

// remove deletes.
{
  const registry = new DefaultInstanceRegistry(clock);
  registry.create(makeInput());
  registry.remove('inst-1');
  assert.equal(registry.get('inst-1'), undefined);
  assert.equal(registry.list().length, 0);
}

process.stdout.write('PASS instance-registry tests\n');

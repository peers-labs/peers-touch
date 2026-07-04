// Standalone Node test for DefaultResourceScheduler.
//
// Imports from the package barrel (../dist/index.js) which the integrator wires
// up later. A deterministic fake clock plus explicit `now` values passed to the
// scheduler keep every TTL/LRU assertion crisp. The scheduler is pure: it only
// returns events, so these tests inspect the returned envelopes and never expect
// registry mutation.

import assert from 'node:assert/strict';

import {
  DefaultInstanceRegistry,
  DefaultResourceScheduler,
  DESKTOP_RESOURCE_POLICY,
} from '../dist/index.js';

// Injected fake clock; scheduler decisions use the explicit `now` argument, so
// this only seeds create()'s initial timestamps before setState overrides them.
const clock = { now: () => 0 };
const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

// Small, sharp policy so overflow/TTL boundaries are easy to reason about.
const POLICY = {
  lruSize: 2,
  maxSuspended: 2,
  hiddenWarmTtlMs: 1000,
  suspendedTtlMs: 2000,
  pausedTtlMs: 500,
};

function makeScheduler(policy = POLICY) {
  const registry = new DefaultInstanceRegistry(clock);
  const scheduler = new DefaultResourceScheduler({
    registry,
    policy,
    clock,
    logger: noopLogger,
  });
  return { registry, scheduler };
}

function seed(registry, instanceId, state, at) {
  registry.create({
    appletId: 'com.example.app',
    instanceId,
    sessionId: `session-${instanceId}`,
    manifestVersion: '1.0.0',
    platform: 'desktop',
  });
  registry.setState(instanceId, state, at);
}

function eventsFor(events, instanceId) {
  return events.filter((event) => event.instanceId === instanceId);
}

// DESKTOP_RESOURCE_POLICY is exported and shaped as expected.
{
  assert.equal(DESKTOP_RESOURCE_POLICY.lruSize, 4);
  assert.equal(typeof DESKTOP_RESOURCE_POLICY.hiddenWarmTtlMs, 'number');
}

// hidden-warm past hiddenWarmTtlMs → 'suspend' event for that instance.
{
  const { registry, scheduler } = makeScheduler();
  seed(registry, 'hw', 'hidden-warm', 1000);

  const events = scheduler.sweep(2500);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'suspend');
  assert.equal(events[0].instanceId, 'hw');
  assert.equal(events[0].reason, 'ttl-hidden-warm');
  assert.equal(events[0].timestamp, 2500);
  // Purity: registry state is untouched by the sweep.
  assert.equal(registry.get('hw').state, 'hidden-warm');
}

// suspended past suspendedTtlMs → 'destroy' event.
{
  const { registry, scheduler } = makeScheduler();
  seed(registry, 'sp', 'suspended', 1000);

  const events = scheduler.sweep(4000);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'destroy');
  assert.equal(events[0].instanceId, 'sp');
  assert.equal(events[0].reason, 'ttl-suspended');
}

// LRU with 3 warm instances (lruSize 2): oldest non-visible is suspended and the
// visible instance is never emitted. `now` is kept inside TTL so this exercises
// LRU alone.
{
  const { registry, scheduler } = makeScheduler();
  seed(registry, 'old-hw', 'hidden-warm', 2000);
  seed(registry, 'new-hw', 'hidden-warm', 2100);
  seed(registry, 'vis', 'visible', 2200);

  const events = scheduler.sweep(2500);
  assert.equal(events.length, 1);
  assert.equal(events[0].instanceId, 'old-hw');
  assert.equal(events[0].type, 'suspend');
  assert.equal(events[0].reason, 'lru-evict');
  // Visible instance must never be scheduled for reclamation by a sweep.
  assert.equal(eventsFor(events, 'vis').length, 0);
}

// Memory pressure: critical destroys all non-visible; moderate destroys one
// oldest suspended; low emits nothing.
{
  const { registry, scheduler } = makeScheduler();
  seed(registry, 'v', 'visible', 2200);
  seed(registry, 's1', 'suspended', 1000);
  seed(registry, 's2', 'suspended', 2000);
  seed(registry, 'h', 'hidden-warm', 2100);

  const low = scheduler.onMemoryPressure('low', 5000);
  assert.equal(low.length, 0);

  const moderate = scheduler.onMemoryPressure('moderate', 5000);
  assert.equal(moderate.length, 1);
  assert.equal(moderate[0].type, 'destroy');
  assert.equal(moderate[0].instanceId, 's1');

  const critical = scheduler.onMemoryPressure('critical', 5000);
  assert.equal(critical.length, 3);
  assert.ok(critical.every((event) => event.type === 'destroy'));
  assert.deepEqual(
    critical.map((event) => event.instanceId).sort(),
    ['h', 's1', 's2'],
  );
  assert.equal(eventsFor(critical, 'v').length, 0);
}

// An instance suspended by TTL is not double-scheduled by LRU in the same sweep.
// With four hidden-warm instances and lruSize 2, the oldest is past TTL. Without
// dedup it would be picked by both the TTL pass and the LRU pass; the scheduler
// must emit exactly one event for it.
{
  const { registry, scheduler } = makeScheduler();
  seed(registry, 'a', 'hidden-warm', 1000); // past TTL when now = 2500
  seed(registry, 'b', 'hidden-warm', 2000);
  seed(registry, 'c', 'hidden-warm', 2100);
  seed(registry, 'd', 'hidden-warm', 2200);

  const events = scheduler.sweep(2500);
  const aEvents = eventsFor(events, 'a');
  assert.equal(aEvents.length, 1);
  assert.equal(aEvents[0].reason, 'ttl-hidden-warm');
  // TTL removes 'a' from the warm set, so LRU evicts the next oldest ('b').
  const bEvents = eventsFor(events, 'b');
  assert.equal(bEvents.length, 1);
  assert.equal(bEvents[0].reason, 'lru-evict');
  assert.equal(events.length, 2);
}

process.stdout.write('PASS resource-scheduler tests\n');

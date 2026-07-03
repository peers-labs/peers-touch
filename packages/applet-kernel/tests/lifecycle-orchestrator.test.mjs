// Standalone lifecycle-orchestrator behavior tests.
//
// Verifies the Orchestrator against the frozen state machine and the surface
// side-effect ordering documented in architecture §3/§6. Runs on the built barrel
// (../dist/index.js) so it exercises the same artifact consumers import.

import assert from 'node:assert/strict';

import { DefaultLifecycleOrchestrator, DefaultInstanceRegistry } from '../dist/index.js';

// Records every surface command so tests can assert ordering and payloads.
function createFakeAdapter() {
  const calls = [];
  return {
    platform: 'desktop',
    calls,
    onLifecycleEvent() {
      return () => {};
    },
    async applySurfaceCommand(command, target) {
      calls.push({ command, target });
    },
    estimateMemory() {
      return undefined;
    },
  };
}

function createFakeSessions() {
  const destroyed = [];
  return {
    destroyed,
    async create() {
      return 'session-x';
    },
    async renew() {},
    async destroy(sessionId) {
      destroyed.push(sessionId);
    },
  };
}

const fakeClock = { now: () => 0 };
const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

async function run() {
  const registry = new DefaultInstanceRegistry(fakeClock);
  const adapter = createFakeAdapter();
  const sessions = createFakeSessions();
  const orchestrator = new DefaultLifecycleOrchestrator({
    registry,
    sessions,
    adapter,
    clock: fakeClock,
    logger: noopLogger,
  });

  // Seed a materializing instance and advance it into visibility via `ready`.
  registry.create({
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    sessionId: 'session-1',
    manifestVersion: '1.0.0',
    platform: 'desktop',
  });
  registry.setState('inst-1', 'materializing', 1);

  const ready = await orchestrator.dispatch({
    type: 'ready',
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    timestamp: 2,
  });
  assert.equal(ready.accepted, true);
  assert.equal(ready.from, 'materializing');
  assert.equal(ready.to, 'visible');
  assert.equal(registry.get('inst-1').state, 'visible');
  // `ready` performs no surface command.
  assert.equal(adapter.calls.length, 0);

  // hide: visible -> hidden-warm, surface backgrounded.
  const hide = await orchestrator.dispatch({
    type: 'hide',
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    timestamp: 3,
  });
  assert.equal(hide.accepted, true);
  assert.equal(hide.to, 'hidden-warm');
  assert.equal(registry.get('inst-1').state, 'hidden-warm');
  assert.equal(adapter.calls.at(-1).command, 'hide');

  // show: hidden-warm -> visible, surface foregrounded.
  const show = await orchestrator.dispatch({
    type: 'show',
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    timestamp: 4,
  });
  assert.equal(show.accepted, true);
  assert.equal(show.to, 'visible');
  assert.equal(registry.get('inst-1').state, 'visible');
  assert.equal(adapter.calls.at(-1).command, 'show');

  // Illegal transition: `restore` is only legal from `suspended`.
  const surfaceCallsBefore = adapter.calls.length;
  const illegal = await orchestrator.dispatch({
    type: 'restore',
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    timestamp: 5,
  });
  assert.equal(illegal.accepted, false);
  assert.equal(illegal.from, 'visible');
  assert.ok(illegal.rejectedReason.startsWith('illegal-transition'));
  // Rejected transition must not touch state or surface.
  assert.equal(registry.get('inst-1').state, 'visible');
  assert.equal(adapter.calls.length, surfaceCallsBefore);

  // Unknown instance rejects as instance-not-found.
  const missing = await orchestrator.dispatch({
    type: 'hide',
    appletId: 'com.demo.notes',
    instanceId: 'ghost',
    timestamp: 6,
  });
  assert.equal(missing.accepted, false);
  assert.equal(missing.from, 'cold');
  assert.equal(missing.rejectedReason, 'instance-not-found');

  // destroy: reclaims surface, session, and registry record.
  const destroy = await orchestrator.dispatch({
    type: 'destroy',
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    timestamp: 7,
  });
  assert.equal(destroy.accepted, true);
  assert.equal(destroy.to, 'destroyed');
  assert.equal(adapter.calls.at(-1).command, 'destroy');
  assert.deepEqual(sessions.destroyed, ['session-1']);
  assert.equal(registry.get('inst-1'), undefined);

  // error (crash): visible -> destroyed, records crash, reclaims everything.
  registry.create({
    appletId: 'com.demo.notes',
    instanceId: 'inst-crash',
    sessionId: 'session-2',
    manifestVersion: '1.0.0',
    platform: 'desktop',
  });
  registry.setState('inst-crash', 'visible', 8);
  const crash = await orchestrator.dispatch({
    type: 'error',
    appletId: 'com.demo.notes',
    instanceId: 'inst-crash',
    timestamp: 9,
    reason: 'unhandled-error',
  });
  assert.equal(crash.accepted, true);
  assert.equal(crash.from, 'visible');
  assert.equal(crash.to, 'destroyed');
  assert.equal(adapter.calls.at(-1).command, 'destroy');
  assert.deepEqual(sessions.destroyed, ['session-1', 'session-2']);
  assert.equal(registry.get('inst-crash'), undefined);

  process.stdout.write('PASS lifecycle-orchestrator tests\n');
}

await run();

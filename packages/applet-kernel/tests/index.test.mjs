// Aggregate kernel test entry (package.json `test` runs this after build).
//
// Runs every module suite in-process, then a composition-root smoke test that
// wires the full AppletKernel and drives a keep-alive sequence end to end. Each
// module suite prints its own `PASS ...` line and throws on failure.

import assert from 'node:assert/strict';

import {
  AppletKernel,
  DESKTOP_RESOURCE_POLICY,
} from '../dist/index.js';

// Import order matches the layered build-up: registry → session → orchestrator
// → scheduler → permission. Any assertion failure aborts the whole run.
await import('./instance-registry.test.mjs');
await import('./session-manager.test.mjs');
await import('./lifecycle-orchestrator.test.mjs');
await import('./resource-scheduler.test.mjs');
await import('./permission-manager.test.mjs');

// --- Composition-root integration smoke -------------------------------------
// Proves AppletKernel wires the five modules together and that the Scheduler →
// Orchestrator hand-off (propose events, single-writer disposes) works.
{
  let t = 0;
  const clock = { now: () => t };
  const noopLogger = { debug() {}, info() {}, warn() {}, error() {} };

  const surfaceCalls = [];
  const adapter = {
    platform: 'desktop',
    onLifecycleEvent() {
      return () => {};
    },
    async applySurfaceCommand(command, target) {
      surfaceCalls.push({ command, target });
    },
    estimateMemory() {
      return undefined;
    },
  };

  const destroyedSessions = [];
  const sessionBackend = {
    async createSession() {
      return 'session-token';
    },
    async renewSession() {},
    async destroySession(sessionId) {
      destroyedSessions.push(sessionId);
    },
  };

  const auditRecords = [];
  const auditSink = { record: (entry) => auditRecords.push(entry) };

  const kernel = new AppletKernel({
    clock,
    logger: noopLogger,
    adapter,
    policy: DESKTOP_RESOURCE_POLICY,
    sessionBackend,
    auditSink,
  });

  // launch → materialize → ready → visible, then keep-alive hide/show.
  kernel.registry.create({
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    sessionId: 'session-1',
    manifestVersion: '1.0.0',
    platform: 'desktop',
  });

  const ready = await kernel.dispatch({
    type: 'ready',
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    timestamp: 1,
  });
  assert.equal(ready.accepted, true);
  assert.equal(kernel.registry.get('inst-1').state, 'visible');

  await kernel.dispatch({
    type: 'hide',
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    timestamp: 2,
  });
  assert.equal(kernel.registry.get('inst-1').state, 'hidden-warm');

  await kernel.dispatch({
    type: 'show',
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    timestamp: 3,
  });
  // Keep-alive: switching back does not recreate the instance record.
  assert.equal(kernel.registry.get('inst-1').state, 'visible');

  // Permission gating flows through the same kernel instance.
  kernel.permissions.registerGrants('inst-1', ['storage.get']);
  assert.equal(kernel.permissions.check('inst-1', 'com.demo.notes', 'storage.get').granted, true);
  assert.equal(kernel.permissions.check('inst-1', 'com.demo.notes', 'network.request').granted, false);
  assert.ok(auditRecords.length >= 2);

  // TTL sweep: hide the instance far in the past, advance beyond hidden-warm TTL,
  // and let the kernel run the scheduler → orchestrator hand-off. The instance
  // must land in `suspended` via a real dispatched transition.
  await kernel.dispatch({
    type: 'hide',
    appletId: 'com.demo.notes',
    instanceId: 'inst-1',
    timestamp: 4,
  });
  t = DESKTOP_RESOURCE_POLICY.hiddenWarmTtlMs + 10;
  const sweepResults = await kernel.runSweep(t);
  assert.ok(sweepResults.some((r) => r.accepted && r.to === 'suspended'));
  assert.equal(kernel.registry.get('inst-1').state, 'suspended');

  // Critical memory pressure reclaims the suspended instance.
  const pressureResults = await kernel.handleMemoryPressure('critical', t + 1);
  assert.ok(pressureResults.some((r) => r.accepted && r.to === 'destroyed'));
  assert.equal(kernel.registry.get('inst-1'), undefined);
  assert.deepEqual(destroyedSessions, ['session-1']);

  process.stdout.write('PASS applet-kernel composition-root integration\n');
}

process.stdout.write('PASS applet-kernel all suites\n');

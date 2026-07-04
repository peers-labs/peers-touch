#!/usr/bin/env node
// Contract tests for the applet lifecycle state machine.
//
// Source of truth: docs/architecture/applet-runtime/applet-lifecycle-architecture.md
//   §3 状态转换事件表, §10 数据模型, §11 验收标准 (切换保活事件顺序).
//
// Run after building the package: the imports resolve against dist/.
import assert from 'node:assert/strict';
import {
  APPLET_LIFECYCLE_STATES,
  APPLET_LIFECYCLE_EVENT_TYPES,
  isValidTransition,
  nextState,
} from '../dist/index.js';

// --- State / event surface matches architecture §10 ------------------------
assert.deepEqual([...APPLET_LIFECYCLE_STATES], [
  'cold', 'materializing', 'visible', 'hidden-warm', 'paused', 'suspended', 'destroyed',
]);
assert.deepEqual([...APPLET_LIFECYCLE_EVENT_TYPES], [
  'launch', 'ready', 'show', 'hide', 'pause', 'resume',
  'suspend', 'restore', 'destroy', 'memory-pressure', 'error',
]);

// --- Legal transitions (architecture §3 状态转换事件表) ----------------------
assert.equal(nextState('cold', 'launch'), 'materializing');
assert.equal(nextState('materializing', 'ready'), 'visible');
assert.equal(nextState('visible', 'hide'), 'hidden-warm');
assert.equal(nextState('hidden-warm', 'show'), 'visible');
assert.equal(nextState('paused', 'show'), 'visible');
assert.equal(nextState('suspended', 'show'), 'visible');
assert.equal(nextState('visible', 'pause'), 'paused');
assert.equal(nextState('hidden-warm', 'pause'), 'paused');
assert.equal(nextState('hidden-warm', 'suspend'), 'suspended');
assert.equal(nextState('paused', 'suspend'), 'suspended');
assert.equal(nextState('suspended', 'restore'), 'visible');

// resume is context-sensitive: paused → visible OR hidden-warm
assert.equal(isValidTransition('paused', 'resume', 'visible'), true);
assert.equal(isValidTransition('paused', 'resume', 'hidden-warm'), true);
assert.equal(isValidTransition('paused', 'resume', 'suspended'), false);
assert.equal(isValidTransition('visible', 'resume', 'visible'), false);

// destroy is legal from any non-cold, non-destroyed state
for (const from of ['materializing', 'visible', 'hidden-warm', 'paused', 'suspended']) {
  assert.equal(isValidTransition(from, 'destroy', 'destroyed'), true, `destroy from ${from}`);
}
assert.equal(isValidTransition('cold', 'destroy', 'destroyed'), false);
assert.equal(isValidTransition('destroyed', 'destroy', 'destroyed'), false);
assert.equal(nextState('cold', 'destroy'), undefined);

// --- Illegal transitions are rejected (architecture §3 完备性) --------------
assert.equal(isValidTransition('cold', 'ready', 'visible'), false);
assert.equal(isValidTransition('visible', 'restore', 'visible'), false);
assert.equal(isValidTransition('visible', 'launch', 'materializing'), false);
assert.equal(isValidTransition('materializing', 'show', 'visible'), false);
assert.equal(isValidTransition('destroyed', 'show', 'visible'), false);
assert.equal(isValidTransition('cold', 'suspend', 'suspended'), false);
assert.equal(nextState('materializing', 'hide'), undefined);

// --- Keep-alive switch sequence (architecture §11: hide→show→hide→show) -----
// A→B→A tab switching must not require rebuild: each step stays legal.
let stateA = 'visible';
let stateB = 'visible';
// hide(A)
assert.equal(nextState(stateA, 'hide'), 'hidden-warm');
stateA = 'hidden-warm';
// show(B) — B was hidden-warm, becomes visible
assert.equal(nextState('hidden-warm', 'show'), 'visible');
stateB = 'visible';
// hide(B)
assert.equal(nextState(stateB, 'hide'), 'hidden-warm');
stateB = 'hidden-warm';
// show(A) — instant restore from hidden-warm, no cold start
assert.equal(nextState(stateA, 'show'), 'visible');
stateA = 'visible';
assert.equal(stateA, 'visible');

// --- Memory-pressure / error signals resolve into suspend/destroy -----------
assert.equal(isValidTransition('suspended', 'memory-pressure', 'destroyed'), true);
assert.equal(isValidTransition('hidden-warm', 'memory-pressure', 'suspended'), true);
assert.equal(isValidTransition('visible', 'memory-pressure', 'suspended'), false);
assert.equal(isValidTransition('cold', 'memory-pressure', 'destroyed'), false);
assert.equal(isValidTransition('visible', 'error', 'destroyed'), true);

process.stdout.write('PASS applet lifecycle contract tests\n');

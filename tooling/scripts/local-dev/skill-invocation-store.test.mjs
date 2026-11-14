import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isSkillToolName,
  readAllSkillEvents,
  readSkillEvents,
  readSkillInvocations,
  recordSkillEvent,
} from './skill-invocation-store.mjs';
import {
  workspaceIdForRoot,
  worktreeSkillEventLogPath,
} from '../lib/machine-dev-paths.mjs';

const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'skill-events-root-'));

function base(overrides = {}) {
  return {
    workspaceRoot,
    host: 'trae',
    event: 'PRE_TOOL_USE',
    toolName: 'Write',
    at: new Date('2026-11-13T00:00:00.000Z'),
    ...overrides,
  };
}

test('records each pre-tool event verbatim into the worktree-local log', () => {
  recordSkillEvent(base({ toolName: 'Write' }));
  recordSkillEvent(base({ toolName: 'Skill', at: new Date('2026-11-13T00:00:01.000Z') }));

  const expectedFile = worktreeSkillEventLogPath(workspaceRoot);
  assert.equal(
    expectedFile,
    path.join(workspaceRoot, '.dev-workflow', 'observations', 'skill-events.jsonl'),
  );
  assert.equal(existsSync(expectedFile), true);

  const events = readSkillEvents({ workspaceRoot });
  assert.equal(events.length, 2);
  assert.equal(events[0].toolName, 'Write');
  assert.equal(events[0].host, 'trae');
  assert.equal(events[0].isSkill, false);
  assert.equal(events[1].toolName, 'Skill');
  assert.equal(events[1].isSkill, true);
});

test('projects only skill-classified invocations', () => {
  const invocations = readSkillInvocations({ workspaceRoot });
  assert.deepEqual(invocations.map((entry) => entry.toolName), ['Skill']);
});

test('rejects invalid hosts, events, and tool names', () => {
  const invalidCode = (error) => error.code === 'SKILL_EVENT_INVALID';
  assert.throws(() => recordSkillEvent(base({ host: 'unknown' })), invalidCode);
  assert.throws(() => recordSkillEvent(base({ event: 'STOP' })), invalidCode);
  assert.throws(() => recordSkillEvent(base({ toolName: '' })), invalidCode);
  assert.throws(
    () => recordSkillEvent(base({ toolName: 'x'.repeat(129) })),
    invalidCode,
  );
});

test('classifier is conservative and host-neutral', () => {
  assert.equal(isSkillToolName('Skill'), true);
  assert.equal(isSkillToolName('run_skill'), true);
  assert.equal(isSkillToolName('Write'), false);
  assert.equal(isSkillToolName('local_shell_exec'), false);
  assert.equal(isSkillToolName(''), false);
});

test('a missing log reads as an empty list, not an error', () => {
  const emptyRoot = mkdtempSync(path.join(tmpdir(), 'skill-events-empty-'));
  assert.deepEqual(readSkillEvents({ workspaceRoot: emptyRoot }), []);
  rmSync(emptyRoot, { recursive: true, force: true });
});

test('collector pulls every worktree log and attributes events by workspaceId', () => {
  const otherRoot = mkdtempSync(path.join(tmpdir(), 'skill-events-other-'));
  try {
    recordSkillEvent({
      workspaceRoot: otherRoot,
      host: 'codex',
      event: 'PRE_TOOL_USE',
      toolName: 'Skill',
      at: new Date('2026-11-13T00:00:02.000Z'),
    });

    const { events, errors } = readAllSkillEvents({
      workspaceRoots: [workspaceRoot, otherRoot],
    });
    assert.deepEqual(errors, []);
    const ids = new Set(events.map((event) => event.workspaceId));
    assert.deepEqual(
      [...ids].sort(),
      [workspaceIdForRoot(workspaceRoot), workspaceIdForRoot(otherRoot)].sort(),
    );
    assert.equal(events.every((event) => event.at), true);
    assert.equal(events[0].at <= events[events.length - 1].at, true);
  } finally {
    rmSync(otherRoot, { recursive: true, force: true });
  }
});

test('collector isolates one corrupt log without dropping healthy worktrees', () => {
  const corruptRoot = mkdtempSync(path.join(tmpdir(), 'skill-events-corrupt-'));
  try {
    const corruptFile = worktreeSkillEventLogPath(corruptRoot);
    mkdirSync(path.dirname(corruptFile), { recursive: true, mode: 0o700 });
    writeFileSync(corruptFile, '{not valid json\n', { mode: 0o600 });

    const { events, errors } = readAllSkillEvents({
      workspaceRoots: [workspaceRoot, corruptRoot],
    });
    assert.equal(events.length > 0, true);
    assert.deepEqual(
      errors.map((error) => error.workspaceId),
      [workspaceIdForRoot(corruptRoot)],
    );
  } finally {
    rmSync(corruptRoot, { recursive: true, force: true });
  }
});

test('collector skips worktrees without a log and reports unresolved roots', () => {
  const missingRoot = mkdtempSync(path.join(tmpdir(), 'skill-events-missing-'));
  const goneRoot = path.join(missingRoot, 'already-removed');
  try {
    const { events, errors } = readAllSkillEvents({
      workspaceRoots: [workspaceRoot, missingRoot, goneRoot],
    });
    assert.equal(events.length > 0, true);
    assert.deepEqual(
      errors.map((error) => error.code),
      ['SKILL_EVENT_ROOT_UNRESOLVED'],
    );
  } finally {
    rmSync(missingRoot, { recursive: true, force: true });
  }
});

test.after(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

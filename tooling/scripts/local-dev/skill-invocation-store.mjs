// Append-only record of pre-tool tool names, stored inside each worktree.
//
// Why this exists: hooks cannot hard-block and skills are markdown instructions
// rather than executable entry points, so the only trustworthy "did the agent
// run a workflow skill" signal is the host PreToolUse payload's tool name.
// This store records that name verbatim for every tool call. It never guesses
// whether a call is a skill — classification stays a separate, reviewable
// rule so an unverified host cannot silently produce false compliance evidence.
//
// The log lives under the worktree's gitignored .dev-workflow directory because
// host hook subprocesses are only guaranteed write access inside the executing
// worktree. Cross-worktree reads are a pull performed by unsandboxed tooling.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';

import {
  workspaceIdForRoot,
  worktreeSkillEventLogPath,
} from '../lib/machine-dev-paths.mjs';
import { registeredCanonicalRoots } from './machine-dev-registry.mjs';

const HOSTS = new Set(['trae', 'codex', 'cursor', 'cli']);
const MAX_TOOL_NAME = 128;
const RECORDED_EVENTS = new Set(['PRE_TOOL_USE', 'POST_TOOL_USE']);

export class SkillInvocationError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SkillInvocationError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new SkillInvocationError(code, message, detail);
}

// A deliberately conservative classifier. It only matches names that clearly
// encode "skill"; host-specific tool names discovered from real TRAE payloads
// are added here after evidence, never assumed ahead of time.
const SKILL_TOOL_PATTERN = /skill/i;

export function isSkillToolName(toolName) {
  return typeof toolName === 'string'
    && toolName.length > 0
    && toolName.length <= MAX_TOOL_NAME
    && SKILL_TOOL_PATTERN.test(toolName);
}

function normalizeRecord(input) {
  if (!input || typeof input !== 'object') {
    fail('SKILL_EVENT_INVALID', 'skill event must be an object');
  }
  const { host, event, toolName, at } = input;
  if (!HOSTS.has(host)) {
    fail('SKILL_EVENT_INVALID', 'reporter host is invalid', { host });
  }
  if (!RECORDED_EVENTS.has(event)) {
    fail('SKILL_EVENT_INVALID', 'only tool use events are recorded', { event });
  }
  if (typeof toolName !== 'string' || toolName.length === 0 || toolName.length > MAX_TOOL_NAME) {
    fail('SKILL_EVENT_INVALID', 'tool name is invalid', { toolName });
  }
  const time = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(time.getTime())) {
    fail('SKILL_EVENT_INVALID', 'timestamp is invalid', { at });
  }
  return {
    host,
    event,
    toolName,
    isSkill: isSkillToolName(toolName),
    at: time.toISOString(),
  };
}

/**
 * Append one pre-tool event. Best effort by contract: callers must let a
 * failure degrade to a diagnostic instead of changing the hook decision.
 */
export function recordSkillEvent(options = {}) {
  const record = normalizeRecord(options);
  const workspaceRoot = options.workspaceRoot;
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    fail('SKILL_EVENT_INVALID', 'workspace root is required');
  }
  const file = options.file ?? worktreeSkillEventLogPath(workspaceRoot);
  mkdirSync(file.replace(/[^/]+$/, ''), { recursive: true, mode: 0o700 });
  // O_APPEND keeps a short single-line write contiguous; the log is diagnostic,
  // not an authority, so a heavyweight lock would add cost without new safety.
  appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return record;
}

function resolveLogFile(options) {
  if (options.file) return options.file;
  if (typeof options.workspaceRoot !== 'string' || options.workspaceRoot.length === 0) {
    fail('SKILL_EVENT_INVALID', 'workspace root is required');
  }
  return worktreeSkillEventLogPath(options.workspaceRoot);
}

/** Read all recorded events, tolerating a missing log but rejecting corrupt rows. */
export function readSkillEvents(options = {}) {
  const file = resolveLogFile(options);
  if (!existsSync(file)) return [];
  const rows = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());
  return rows.map((line, index) => {
    try {
      const parsed = JSON.parse(line);
      return normalizeRecord(parsed);
    } catch (error) {
      fail('SKILL_EVENT_INVALID', `corrupt event on line ${index + 1}`, {
        cause: String(error),
      });
    }
  });
}

/** Project only the events whose tool name matches the skill classifier. */
export function readSkillInvocations(options = {}) {
  return readSkillEvents(options).filter((record) => record.isSkill);
}

// Pull-based cross-worktree collection. Explicit workspaceRoots override
// machine registry discovery; every event is attributed to its source
// workspaceId at read time because the on-disk rows intentionally stay
// worktree-local and carry no machine-level identity.
export function readAllSkillEvents(options = {}) {
  const events = [];
  const errors = [];
  let roots;
  try {
    roots = Array.isArray(options.workspaceRoots)
      ? [...new Set(options.workspaceRoots)]
      : registeredCanonicalRoots(options);
  } catch (error) {
    return {
      events,
      errors: [
        {
          workspaceId: null,
          code: error.code ?? 'WORKSPACE_REGISTRY_INVALID',
          message: error.message,
        },
      ],
    };
  }
  for (const candidate of roots) {
    let workspaceRoot;
    try {
      workspaceRoot = realpathSync(candidate);
    } catch {
      errors.push({
        workspaceId: null,
        code: 'SKILL_EVENT_ROOT_UNRESOLVED',
        message: `cannot resolve worktree root: ${candidate}`,
      });
      continue;
    }
    const workspaceId = workspaceIdForRoot(workspaceRoot);
    try {
      for (const record of readSkillEvents({ workspaceRoot })) {
        events.push({ ...record, workspaceId });
      }
    } catch (error) {
      errors.push({
        workspaceId,
        code: error.code ?? 'SKILL_EVENT_INVALID',
        message: error.message,
      });
    }
  }
  events.sort((left, right) =>
    left.at.localeCompare(right.at)
    || left.workspaceId.localeCompare(right.workspaceId),
  );
  errors.sort((left, right) =>
    String(left.workspaceId).localeCompare(String(right.workspaceId)),
  );
  return { events, errors };
}

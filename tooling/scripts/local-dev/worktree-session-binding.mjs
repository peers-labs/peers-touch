import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';

// Session-scoped worktree binding.
//
// SessionStart binds the IDE session to exactly one git worktree (the single
// workspace folder). PreToolUse then refuses mutating tools whose cwd / target
// path resolves to a different worktree. The guard fails OPEN on any
// unresolvable state: it must never lock a developer out of normal work, and
// re-binding is only possible through the explicit machine-dev entrypoint.

export const SESSION_WORKTREE_BINDING_KIND = 'peers-touch-session-worktree-binding';
const HEAD = /^[0-9a-f]{40}$/;

export class SessionBindingError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SessionBindingError';
    this.code = code;
    this.detail = detail;
  }
}

function gitTopLevel(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function gitValue(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

export function bindingPathForStateRoot(stateRoot) {
  return path.join(stateRoot, 'session-worktree.json');
}

export function bindingLockPathForStateRoot(stateRoot) {
  return path.join(stateRoot, 'session-worktree.lock');
}

function readBindingFile(file) {
  if (!existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (
    !parsed
    || parsed.kind !== SESSION_WORKTREE_BINDING_KIND
    || typeof parsed.canonicalRoot !== 'string'
    || typeof parsed.name !== 'string'
  ) {
    return null;
  }
  return parsed;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function acquireLock(file, timeoutMs = 2000) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      writeFileSync(
        file,
        `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      return () => {
        try {
          unlinkSync(file);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const meta = JSON.parse(readFileSync(file, 'utf8'));
        if (!processIsAlive(meta.pid)) {
          unlinkSync(file);
          continue;
        }
      } catch {
        // Stale/unreadable lock: leave it for the timeout guard.
      }
      if (Date.now() >= deadline) {
        throw new SessionBindingError(
          'SESSION_BINDING_LOCKED',
          'session worktree binding writer is busy',
        );
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function writeAtomic(file, record) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = path.join(
    path.dirname(file),
    `.session-worktree.${process.pid}.${randomBytes(8).toString('hex')}`,
  );
  let fd;
  try {
    fd = openSync(tmp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    renameSync(tmp, file);
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } catch {
      // Already closed above.
    }
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

function captureBinding(canonicalRoot, source) {
  const head = gitValue(canonicalRoot, ['rev-parse', 'HEAD']);
  const branch =
    gitValue(canonicalRoot, ['branch', '--show-current']) || 'detached';
  return {
    kind: SESSION_WORKTREE_BINDING_KIND,
    workspaceId: workspaceIdForRoot(canonicalRoot),
    canonicalRoot,
    name: path.basename(canonicalRoot),
    branch,
    head,
    source,
    boundAt: new Date().toISOString(),
  };
}

// Bind on SessionStart. Only a single unambiguous workspace root binds.
// Returns {status, binding|null, reason}. Never throws for an ambiguous or
// non-git workspace (fail-open, log only).
export function bindSessionWorktree({
  stateRoot,
  workspaceRoots = [],
  source = 'session-start',
}) {
  try {
    const roots = [...new Set(
      workspaceRoots
        .map((value) => (typeof value === 'string' ? gitTopLevel(value) : null))
        .filter((value) => typeof value === 'string'),
    )];
    const file = bindingPathForStateRoot(stateRoot);
    const lock = bindingLockPathForStateRoot(stateRoot);
    const release = acquireLock(lock);
    try {
      const existing = readBindingFile(file);
      if (existing) {
        return {
          status: 'ALREADY_BOUND',
          binding: existing,
          reason: 'session worktree binding already exists',
        };
      }
      if (roots.length !== 1) {
        return {
          status: 'UNRESOLVED',
          binding: null,
          reason:
            roots.length === 0
              ? 'no single git worktree resolved from workspace roots'
              : 'multiple worktree roots open; refusing to guess',
        };
      }
      const binding = captureBinding(roots[0], source);
      if (!HEAD.test(binding.head ?? '')) {
        return {
          status: 'UNRESOLVED',
          binding: null,
          reason: 'bound worktree HEAD is unresolvable',
        };
      }
      writeAtomic(file, binding);
      return {
        status: 'BOUND',
        binding,
        reason: `session bound to worktree ${binding.name}`,
      };
    } finally {
      release();
    }
  } catch (error) {
    return {
      status: 'UNAVAILABLE',
      binding: null,
      reason: error?.message ?? String(error),
    };
  }
}

export function readSessionBinding(stateRoot) {
  try {
    return readBindingFile(bindingPathForStateRoot(stateRoot));
  } catch {
    return null;
  }
}

// Resolve the worktree a tool invocation targets from its cwd and explicit
// target file paths. Returns the git toplevel or null.
export function resolveInvocationWorktree({
  toolWorkingDirectory,
  targetFilepaths = [],
  installationRoot,
}) {
  const candidates = [];
  if (typeof toolWorkingDirectory === 'string' && toolWorkingDirectory) {
    candidates.push(toolWorkingDirectory);
  }
  for (const value of targetFilepaths) {
    if (typeof value !== 'string' || !value) continue;
    candidates.push(
      path.isAbsolute(value)
        ? value
        : path.resolve(toolWorkingDirectory ?? installationRoot ?? '.', value),
    );
  }
  const roots = [...new Set(
    candidates.map((candidate) => {
      // git rev-parse needs a directory; resolve file targets to their dir.
      let resolved = candidate;
      try {
        // lstat is unavailable here; use dirname for paths with an extension.
        if (/\.[a-z0-9]+$/i.test(path.basename(candidate))) {
          resolved = path.dirname(candidate);
        }
      } catch {
        resolved = candidate;
      }
      return gitTopLevel(resolved);
    }).filter(Boolean),
  )];
  if (roots.length === 0) return null;
  return roots.length === 1 ? roots[0] : roots;
}

// Evaluate a mutating tool call against the session binding.
// Returns null when allowed, or a deny descriptor {boundRoot, invokedRoot}.
export function detectWorktreeDrift({
  binding,
  invocationRoot,
}) {
  if (!binding?.canonicalRoot || invocationRoot == null) return null;
  const invoked = Array.isArray(invocationRoot)
    ? invocationRoot
    : [invocationRoot];
  const drifted = invoked.filter(
    (root) => root && root !== binding.canonicalRoot,
  );
  if (drifted.length === 0) return null;
  return {
    boundRoot: binding.canonicalRoot,
    boundName: binding.name,
    invokedRoot: drifted,
  };
}

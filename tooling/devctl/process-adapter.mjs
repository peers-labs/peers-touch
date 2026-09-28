import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DevctlError, ERROR_CODES } from './errors.mjs';
import {
  readRuntimeState,
  removeRuntimeState,
  writeRuntimeState,
} from './runtime-state.mjs';

export function commandFingerprint(command, args) {
  return createHash('sha256')
    .update(JSON.stringify([path.resolve(command), ...args]))
    .digest('hex');
}

export function inspectProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }

  if (process.platform === 'win32') {
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
      'if ($null -eq $p) { exit 3 }',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '[pscustomobject]@{ ProcessId = $p.ProcessId; CommandLine = $p.CommandLine; CreationDate = $p.CreationDate.ToUniversalTime().ToString("o") } | ConvertTo-Json -Compress',
    ].join('; ');
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
    );
    if (result.status !== 0 || !result.stdout.trim()) {
      return undefined;
    }
    const observed = JSON.parse(result.stdout);
    return {
      pid: Number(observed.ProcessId),
      commandLine: observed.CommandLine ?? '',
      startedAt: observed.CreationDate
        ? new Date(observed.CreationDate).toISOString()
        : undefined,
    };
  }

  const result = spawnSync(
    'ps',
    ['-p', String(pid), '-o', 'state=', '-o', 'lstart=', '-o', 'command='],
    { encoding: 'utf8', timeout: 10_000 },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return undefined;
  }
  const line = result.stdout.trim();
  const match = /^(\S+)\s+(.{24})\s+(.*)$/u.exec(line);
  if (!match || match[1].startsWith('Z')) {
    return undefined;
  }
  return {
    pid,
    commandLine: match[3],
    startedAt: new Date(match[2]).toISOString(),
  };
}

export function processMatches(record, observed) {
  if (!observed || observed.pid !== record.pid) {
    return false;
  }
  if (
    record.observedStartedAt
    && observed.startedAt
    && record.observedStartedAt !== observed.startedAt
  ) {
    return false;
  }
  const commandLine = observed.commandLine.toLowerCase();
  return record.identityTokens.every((token) =>
    commandLine.includes(String(token).toLowerCase()),
  );
}

export function inspectManagedProcess(stateDirectory, service) {
  const record = readRuntimeState(stateDirectory, service);
  if (!record) {
    return { status: 'absent' };
  }
  const observed = inspectProcess(record.pid);
  if (!observed) {
    return { status: 'stale', record };
  }
  if (!processMatches(record, observed)) {
    return { status: 'foreign', record, observed };
  }
  return { status: 'running', record, observed };
}

function windowsCommand(command, args) {
  if (!/\.(cmd|bat)$/iu.test(command)) {
    return { command, args };
  }
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', 'call', command, ...args],
  };
}

export function spawnManaged({
  stateDirectory,
  service,
  profile,
  worktreeId,
  command,
  args = [],
  cwd,
  environment,
  logPath,
  ports = [],
  readinessUrl,
  identityTokens = [],
  sourceCommit,
}) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.openSync(logPath, 'a');
  const invocation = process.platform === 'win32'
    ? windowsCommand(command, args)
    : { command, args };
  let child;
  try {
    child = spawn(invocation.command, invocation.args, {
      cwd,
      env: environment,
      detached: true,
      windowsHide: false,
      stdio: ['ignore', log, log],
    });
  } finally {
    fs.closeSync(log);
  }
  child.unref();

  const observed = inspectProcess(child.pid);
  const tokens = identityTokens.length > 0
    ? identityTokens
    : [path.basename(command), ...args.filter((arg) => !arg.startsWith('-'))];
  const record = {
    service,
    profile,
    worktreeId,
    pid: child.pid,
    command,
    args,
    commandFingerprint: commandFingerprint(command, args),
    identityTokens: tokens,
    ports,
    startedAt: new Date().toISOString(),
    observedStartedAt: observed?.startedAt,
    logPath,
    readinessUrl,
    ...(sourceCommit ? { sourceCommit } : {}),
  };
  writeRuntimeState(stateDirectory, record);
  return record;
}

function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!inspectProcess(pid)) {
      return true;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  return !inspectProcess(pid);
}

export function stopManagedProcess(stateDirectory, service, timeoutMs = 5_000) {
  const managed = inspectManagedProcess(stateDirectory, service);
  if (managed.status === 'absent') {
    return managed;
  }
  if (managed.status === 'stale') {
    removeRuntimeState(stateDirectory, service);
    return managed;
  }
  if (managed.status === 'foreign') {
    throw new DevctlError(
      ERROR_CODES.PROCESS_IDENTITY_MISMATCH,
      `Refusing to stop foreign process for ${service}`,
      { service, pid: managed.record.pid },
    );
  }

  if (process.platform === 'win32') {
    const result = spawnSync(
      'taskkill.exe',
      ['/PID', String(managed.record.pid), '/T'],
      { encoding: 'utf8', windowsHide: true, timeout: timeoutMs },
    );
    if (result.status !== 0 && inspectProcess(managed.record.pid)) {
      spawnSync(
        'taskkill.exe',
        ['/PID', String(managed.record.pid), '/T', '/F'],
        { encoding: 'utf8', windowsHide: true, timeout: timeoutMs },
      );
    }
  } else {
    try {
      process.kill(-managed.record.pid, 'SIGTERM');
    } catch {
      process.kill(managed.record.pid, 'SIGTERM');
    }
    if (!waitForExit(managed.record.pid, timeoutMs)) {
      try {
        process.kill(-managed.record.pid, 'SIGKILL');
      } catch {
        process.kill(managed.record.pid, 'SIGKILL');
      }
    }
  }

  if (inspectProcess(managed.record.pid)) {
    throw new DevctlError(
      ERROR_CODES.PROCESS_IDENTITY_MISMATCH,
      `Managed process did not stop: ${service}`,
      { service, pid: managed.record.pid },
    );
  }
  removeRuntimeState(stateDirectory, service);
  return { status: 'stopped', record: managed.record };
}

export function isPortListening(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

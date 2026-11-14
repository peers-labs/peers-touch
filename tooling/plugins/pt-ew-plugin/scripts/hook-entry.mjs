#!/usr/bin/env node

import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  machineWorkspacesPath,
  workspaceIdForRoot,
} from '../../../scripts/lib/machine-dev-paths.mjs';

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!['--host', '--event', '--workspace'].includes(name) || !value) {
      throw new Error(`Unsupported hook argument: ${name ?? '<missing>'}`);
    }
    options[name.slice(2)] = value;
  }
  return options;
}

export function workspaceContext(workspaceFile) {
  if (!workspaceFile) return { workspaceRoots: [] };
  let descriptor;
  let parsed;
  try {
    descriptor = realpathSync(workspaceFile);
    if (!lstatSync(descriptor).isFile()) {
      throw new Error('descriptor is not a file');
    }
    parsed = JSON.parse(readFileSync(descriptor, 'utf8'));
  } catch {
    throw new Error('TRAE_WORKSPACE_DESCRIPTOR_INVALID');
  }
  if (!Array.isArray(parsed?.folders) || parsed.folders.length === 0) {
    throw new Error('TRAE_WORKSPACE_DESCRIPTOR_INVALID');
  }
  // Resilient to stale worktree entries: a single missing folder must not
  // invalidate the whole multi-root descriptor (a removed sibling worktree
  // otherwise silently disables every hook). Missing/non-directory entries are
  // skipped and reported; only zero resolvable roots is a hard failure.
  const workspaceRoots = [];
  const skippedFolders = [];
  for (const folder of parsed.folders) {
    const value =
      typeof folder === 'string'
        ? folder
        : folder !== null && typeof folder === 'object'
          ? folder.path
          : null;
    if (typeof value !== 'string' || !value.trim()) {
      skippedFolders.push({ value, reason: 'invalid-folder-entry' });
      continue;
    }
    try {
      const candidate = realpathSync(
        path.resolve(path.dirname(descriptor), value),
      );
      if (!lstatSync(candidate).isDirectory()) {
        skippedFolders.push({ value, reason: 'not-a-directory' });
        continue;
      }
      workspaceRoots.push(candidate);
    } catch {
      skippedFolders.push({ value, reason: 'unresolved' });
    }
  }
  if (workspaceRoots.length === 0) {
    throw new Error('TRAE_WORKSPACE_DESCRIPTOR_INVALID');
  }
  return {
    workspaceRoots: [...new Set(workspaceRoots)],
    skippedFolders,
  };
}

async function readInput(stream, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('HOOK_PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  const source = Buffer.concat(chunks).toString('utf8').trim();
  return source ? JSON.parse(source) : {};
}

function localDevModuleUrl(name) {
  const script = realpathSync(fileURLToPath(import.meta.url));
  return pathToFileURL(
    path.resolve(
      path.dirname(script),
      '..',
      '..',
      '..',
      'scripts',
      'local-dev',
      name,
    ),
  );
}

// Lazily import the real recorder so hook startup stays unchanged and the
// dependency remains optional to module load.
async function defaultRecordSkill(record) {
  const store = await import(localDevModuleUrl('skill-invocation-store.mjs'));
  return store.recordSkillEvent(record);
}

function installationRoot() {
  const script = realpathSync(fileURLToPath(import.meta.url));
  return realpathSync(
    path.resolve(path.dirname(script), '..', '..', '..', '..'),
  );
}

export async function reportHookObservation(
  normalized,
  executionRoot,
  options = {},
) {
  if (!executionRoot) return { status: 'NOOP' };
  try {
    const report =
      options.report ??
      (await import(localDevModuleUrl('worktree-observation-store.mjs')))
        .reportWorktreeObservation;
    return {
      status: 'REPORTED',
      observation: report({
        workspaceRoot: executionRoot,
        host: normalized.host,
        event: normalized.hostEvent,
        minimumIntervalMs: 15_000,
      }),
    };
  } catch (error) {
    return {
      status: 'UNAVAILABLE',
      code: error.code ?? 'WORKTREE_OBSERVATION_FAILED',
    };
  }
}

export async function runHook({
  argv = process.argv.slice(2),
  input = process.stdin,
  report,
  recordSkill = defaultRecordSkill,
} = {}) {
  const options = parseArguments(argv);
  const payload = await readInput(input);
  const [adapters, kernel] = await Promise.all([
    import(localDevModuleUrl('workflow-host-adapters.mjs')),
    import(localDevModuleUrl('workflow-kernel.mjs')),
  ]);
  const workspace = workspaceContext(options.workspace);
  const normalized = adapters.normalizeHostPayload(payload, {
    ...options,
    installationRoot: installationRoot(),
    ...workspace,
  });
  // Per-worktree guard state root. SessionStart binds here; PreToolUse reads
  // the same binding and blocks mutating tools that escape this worktree.
  const worktreeStateRoot = path.join(
    machineWorkspacesPath(),
    workspaceIdForRoot(installationRoot()),
  );
  const result = await kernel.evaluateWorkflowEvent(normalized, {
    worktreeStateRoot,
  });
  await reportHookObservation(normalized, result.executionRoot, { report });
  // Best-effort skill/tool trace. It must never change the advisory hook
  // decision: a write failure degrades to a diagnostic and the allow/context
  // response is still returned.
  if (normalized.valid
    && (normalized.event === 'PRE_TOOL_USE' || normalized.event === 'POST_TOOL_USE')
    && normalized.toolName
    && result.executionRoot) {
    try {
      await recordSkill({
        host: normalized.host,
        event: normalized.event,
        toolName: normalized.toolName,
        at: new Date(),
        workspaceRoot: result.executionRoot,
      });
    } catch (error) {
      // Non-fatal: observability must not block the tool or the workflow.
      process.stderr.write(`skill event trace unavailable: ${error?.code ?? String(error)}\n`);
    }
  }
  const response = adapters.renderHostResponse(options.host, result, normalized);
  return response;
}

async function main() {
  const hostIndex = process.argv.indexOf('--host');
  const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : 'trae';
  const eventIndex = process.argv.indexOf('--event');
  const event = eventIndex >= 0 ? process.argv[eventIndex + 1] : 'PreToolUse';
  try {
    process.stdout.write(`${JSON.stringify(await runHook())}\n`);
  } catch (error) {
    const adapters = await import(
      localDevModuleUrl('workflow-host-adapters.mjs')
    );
    process.stdout.write(
      `${JSON.stringify(adapters.renderHostFailure(host, event, error))}\n`,
    );
  }
}

if (process.argv[1] &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}

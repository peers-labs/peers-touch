#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  isDirectInvocation,
  workspaceIdForRoot,
  workspaceStatePath,
} from '../lib/machine-dev-paths.mjs';
import {
  loadPlanPackage,
  validateRepositoryPath,
} from './plan-package.mjs';

export const WORKSPACE_PLAN_BINDING_KIND =
  'peers-touch-workspace-plan-binding';
export const WORKSPACE_PLAN_BINDING_SCHEMA_VERSION = 1;

const BINDING_KEYS = new Set([
  'schemaVersion',
  'kind',
  'workspaceId',
  'canonicalRoot',
  'planId',
  'planPath',
  'boundAt',
  'boundBy',
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class WorkspacePlanBindingError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'WorkspacePlanBindingError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new WorkspacePlanBindingError(code, message, details);
}

function requiredText(value, field, pattern = undefined) {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.includes('\0') ||
    value.includes('\n') ||
    (pattern && !pattern.test(value))
  ) {
    fail('WORKSPACE_PLAN_BINDING_INVALID', `${field} is invalid`, { field });
  }
  return value;
}

function canonicalWorkspace(root) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(root);
  } catch (error) {
    fail(
      'WORKTREE_IDENTITY_UNAVAILABLE',
      'workspace root cannot be resolved',
      { root, cause: String(error) },
    );
  }
  let gitRoot;
  try {
    gitRoot = realpathSync(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: canonicalRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    );
  } catch (error) {
    fail(
      'WORKTREE_IDENTITY_UNAVAILABLE',
      'workspace is not a Git worktree',
      { root: canonicalRoot, cause: String(error) },
    );
  }
  if (gitRoot !== canonicalRoot) {
    fail(
      'WORKTREE_IDENTITY_MISMATCH',
      'workspace root is not the Git worktree root',
      { requested: canonicalRoot, actual: gitRoot },
    );
  }
  let branch;
  try {
    branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: canonicalRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    fail(
      'WORKTREE_IDENTITY_UNAVAILABLE',
      'workspace branch cannot be resolved',
      { root: canonicalRoot, cause: String(error) },
    );
  }
  if (!branch) {
    fail(
      'WORKTREE_IDENTITY_UNAVAILABLE',
      'detached worktree cannot own a Plan binding',
    );
  }
  return {
    branch,
    canonicalRoot,
    workspaceId: workspaceIdForRoot(canonicalRoot),
  };
}

function canonicalTimestamp(value) {
  const parsed = Date.parse(value);
  return (
    typeof value === 'string' &&
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value
  );
}

function validateBinding(value, workspace) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== BINDING_KEYS.size ||
    Object.keys(value).some((key) => !BINDING_KEYS.has(key)) ||
    value.schemaVersion !== WORKSPACE_PLAN_BINDING_SCHEMA_VERSION ||
    value.kind !== WORKSPACE_PLAN_BINDING_KIND ||
    typeof value.workspaceId !== 'string' ||
    !/^[0-9a-f]{16}$/.test(value.workspaceId) ||
    typeof value.canonicalRoot !== 'string' ||
    !path.isAbsolute(value.canonicalRoot) ||
    typeof value.planId !== 'string' ||
    !IDENTIFIER.test(value.planId) ||
    typeof value.planPath !== 'string' ||
    !canonicalTimestamp(value.boundAt)
  ) {
    fail(
      'WORKSPACE_PLAN_BINDING_INVALID',
      'workspace Plan binding schema is invalid',
    );
  }
  requiredText(value.boundBy, 'boundBy');
  try {
    validateRepositoryPath(value.planPath, 'planPath');
  } catch (error) {
    fail(
      'WORKSPACE_PLAN_BINDING_INVALID',
      'workspace Plan binding path is invalid',
      { cause: String(error) },
    );
  }
  if (
    value.workspaceId !== workspace.workspaceId ||
    value.canonicalRoot !== workspace.canonicalRoot
  ) {
    fail(
      'WORKSPACE_PLAN_BINDING_MISMATCH',
      'workspace Plan binding belongs to another worktree',
      {
        boundWorkspaceId: value.workspaceId,
        actualWorkspaceId: workspace.workspaceId,
      },
    );
  }
  return value;
}

function readBindingFile(file, workspace) {
  if (!existsSync(file)) {
    fail(
      'WORKSPACE_PLAN_BINDING_REQUIRED',
      'workspace has no immutable Plan binding',
      { workspaceId: workspace.workspaceId },
    );
  }
  const metadata = lstatSync(file);
  const ownedByCurrentUser =
    typeof process.getuid !== 'function' || metadata.uid === process.getuid();
  if (!metadata.isFile() || !ownedByCurrentUser) {
    fail(
      'WORKSPACE_PLAN_BINDING_INVALID',
      'workspace Plan binding must be an owner-controlled regular file',
    );
  }
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(
      'WORKSPACE_PLAN_BINDING_INVALID',
      'workspace Plan binding is not valid JSON',
      { cause: String(error) },
    );
  }
  return validateBinding(value, workspace);
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  let descriptor;
  try {
    descriptor = openSync(directory, 'r');
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function publishImmutable(file, value) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    linkSync(temporary, file);
    syncDirectory(directory);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return true;
}

export function workspacePlanBindingPath(options = {}) {
  return path.join(
    workspaceStatePath({
      home: options.home,
      repoRoot: options.repoRoot,
      workspaceId: options.workspaceId,
    }),
    'workflow',
    'plan-binding.json',
  );
}

async function loadBoundPlan(workspace, binding) {
  const absolutePlan = path.resolve(
    workspace.canonicalRoot,
    ...binding.planPath.split('/'),
  );
  let planPackage;
  try {
    planPackage = await loadPlanPackage(absolutePlan, {
      repoRoot: workspace.canonicalRoot,
    });
  } catch (error) {
    fail(
      'WORKSPACE_BOUND_PLAN_UNAVAILABLE',
      'bound Plan Package is unavailable or invalid',
      {
        planId: binding.planId,
        planPath: binding.planPath,
        cause: error?.message ?? String(error),
      },
    );
  }
  const actualPlanPath = path
    .relative(workspace.canonicalRoot, planPackage.path)
    .split(path.sep)
    .join('/');
  const mismatches = {};
  for (const [field, expected, actual] of [
    ['planId', binding.planId, planPackage.manifest.planId],
    ['planPath', binding.planPath, actualPlanPath],
    [
      'workspaceId',
      workspace.workspaceId,
      planPackage.manifest.binding.workspaceId,
    ],
    ['branch', workspace.branch, planPackage.manifest.binding.branch],
  ]) {
    if (expected !== actual) mismatches[field] = { expected, actual };
  }
  if (Object.keys(mismatches).length > 0) {
    fail(
      'WORKSPACE_PLAN_BINDING_MISMATCH',
      'bound Plan Package identity does not match the workspace binding',
      { mismatches },
    );
  }
  return planPackage;
}

export async function resolveWorkspacePlanBinding(options = {}) {
  const workspace = canonicalWorkspace(options.repoRoot ?? process.cwd());
  const file = workspacePlanBindingPath({
    home: options.home,
    repoRoot: workspace.canonicalRoot,
  });
  const binding = readBindingFile(file, workspace);
  const planPackage = await loadBoundPlan(workspace, binding);
  return {
    ...binding,
    bindingFile: file,
    planStatus: planPackage.manifest.status,
    branch: planPackage.manifest.binding.branch,
  };
}

export async function bindWorkspacePlan(options = {}) {
  const workspace = canonicalWorkspace(options.repoRoot ?? process.cwd());
  const owner = requiredText(options.owner, 'owner');
  const requestedPlan = requiredText(options.plan, 'plan');
  const absolutePlan = path.isAbsolute(requestedPlan)
    ? requestedPlan
    : path.resolve(workspace.canonicalRoot, requestedPlan);
  let planPackage;
  try {
    planPackage = await loadPlanPackage(absolutePlan, {
      repoRoot: workspace.canonicalRoot,
    });
  } catch (error) {
    fail(
      'WORKSPACE_BOUND_PLAN_UNAVAILABLE',
      'requested Plan Package is unavailable or invalid',
      { cause: error?.message ?? String(error) },
    );
  }
  const planPath = path
    .relative(workspace.canonicalRoot, planPackage.path)
    .split(path.sep)
    .join('/');
  const mismatches = {};
  for (const [field, expected, actual] of [
    [
      'workspaceId',
      workspace.workspaceId,
      planPackage.manifest.binding.workspaceId,
    ],
    ['branch', workspace.branch, planPackage.manifest.binding.branch],
  ]) {
    if (expected !== actual) mismatches[field] = { expected, actual };
  }
  if (Object.keys(mismatches).length > 0) {
    fail(
      'WORKSPACE_PLAN_BINDING_MISMATCH',
      'requested Plan Package belongs to another workspace',
      { mismatches },
    );
  }
  const binding = {
    schemaVersion: WORKSPACE_PLAN_BINDING_SCHEMA_VERSION,
    kind: WORKSPACE_PLAN_BINDING_KIND,
    workspaceId: workspace.workspaceId,
    canonicalRoot: workspace.canonicalRoot,
    planId: planPackage.manifest.planId,
    planPath,
    boundAt: (options.now ?? new Date()).toISOString(),
    boundBy: owner,
  };
  const file = workspacePlanBindingPath({
    home: options.home,
    repoRoot: workspace.canonicalRoot,
  });
  if (!publishImmutable(file, binding)) {
    const current = readBindingFile(file, workspace);
    if (
      current.planId !== binding.planId ||
      current.planPath !== binding.planPath
    ) {
      fail(
        'WORKSPACE_PLAN_REBIND_DENIED',
        'workspace Plan binding is immutable',
        {
          current: {
            planId: current.planId,
            planPath: current.planPath,
          },
          requested: {
            planId: binding.planId,
            planPath: binding.planPath,
          },
        },
      );
    }
    await loadBoundPlan(workspace, current);
    return { ...current, bindingFile: file, created: false };
  }
  return { ...binding, bindingFile: file, created: true };
}

function parseArguments(argv) {
  const [action, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];
    if (!token.startsWith('--') || value === undefined || value.startsWith('--')) {
      fail('WORKSPACE_PLAN_BINDING_USAGE', `invalid option: ${token}`);
    }
    const key = token.slice(2);
    if (!['repo-root', 'home', 'plan', 'owner'].includes(key)) {
      fail('WORKSPACE_PLAN_BINDING_USAGE', `unsupported option: ${token}`);
    }
    options[
      {
        'repo-root': 'repoRoot',
        home: 'home',
        plan: 'plan',
        owner: 'owner',
      }[key]
    ] = value;
    index += 1;
  }
  return { action, options };
}

function output(value, stream = process.stdout) {
  stream.write(`${JSON.stringify({ ok: true, binding: value }, null, 2)}\n`);
}

export async function runCli(argv) {
  const { action, options } = parseArguments(argv);
  if (action === 'bind') {
    output(await bindWorkspacePlan(options));
    return;
  }
  if (action === 'resolve') {
    output(await resolveWorkspacePlanBinding(options));
    return;
  }
  fail(
    'WORKSPACE_PLAN_BINDING_USAGE',
    'action must be bind or resolve',
  );
}

if (isDirectInvocation(import.meta.url)) {
  try {
    await runCli(process.argv.slice(2));
  } catch (error) {
    const payload =
      error instanceof WorkspacePlanBindingError
        ? {
            ok: false,
            error: {
              code: error.code,
              message: error.message,
              ...(error.details === undefined
                ? {}
                : { details: error.details }),
            },
          }
        : {
            ok: false,
            error: {
              code: 'WORKSPACE_PLAN_BINDING_INTERNAL_ERROR',
              message: String(error),
            },
          };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
    process.exitCode = 2;
  }
}

import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  developmentWorkLedgerPath,
  machineLeasePath,
  machineLeaseRoot,
  machineRegistryLockPath,
  machineRegistryPath,
  repoRoot,
  workspaceIdForRoot,
  workspaceStatePath,
} from '../lib/machine-dev-paths.mjs';
import { processStartIdentity, readLedger } from './dev-work-ledger.mjs';
import { LIVE_STATES } from './dev-work-schema.mjs';

export const MACHINE_REGISTRY_KIND = 'peers-touch-machine-dev-registry';
export const MACHINE_REGISTRY_AUTHORITY = 'machine-control-plane';
export const MACHINE_REGISTRY_SCHEMA_VERSION = 1;
export const STATION_CAPABILITIES = new Set([
  'station.connect',
  'station.deploy',
  'station.reset',
]);
export const LEASE_RESOURCE_KINDS = new Set([
  'local.slot',
  'station.deploy',
  'station.reset',
]);

const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const HEAD_PATTERN = /^[0-9a-f]{40,64}$/;
const REGISTRY_LOCK_TIMEOUT_MS = 5_000;
const REGISTRATION_KEYS = new Set([
  'workspaceId',
  'canonicalRoot',
  'name',
  'branch',
  'head',
  'profile',
  'slot',
  'allowedCapabilities',
  'purpose',
  'owner',
  'registeredAt',
  'updatedAt',
  'updatedBy',
]);
const AUTHORITATIVE_REGISTRY_KEYS = new Set([
  'schemaVersion',
  'kind',
  'authority',
  'updatedAt',
  'registrations',
  // Bootstrap audit and D07 migration fields remain diagnostic until their
  // owning workstream closes them. Runtime resolution never consumes them.
  'generatedAt',
  'machine',
  'roots',
  'environmentRepository',
  'discovery',
  'registrationState',
  'runtime',
  'acceptanceEvidenceMigration',
]);

export class MachineDevError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'MachineDevError';
    this.code = code;
    this.detail = detail;
  }
}

export function fail(code, message, detail = {}) {
  throw new MachineDevError(code, message, detail);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function requiredText(value, field, maxLength = 1024) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_ARGUMENT', `${field} must be a non-empty string`, { field });
  }
  const normalized = value.trim();
  if (
    normalized.length > maxLength ||
    normalized.includes('\0') ||
    normalized.includes('\n')
  ) {
    fail('INVALID_ARGUMENT', `${field} is invalid`, { field });
  }
  return normalized;
}

function requiredIdentifier(value, field) {
  const normalized = requiredText(value, field, 128);
  if (!IDENTIFIER.test(normalized)) {
    fail('INVALID_ARGUMENT', `${field} has an invalid identifier`, { field });
  }
  return normalized;
}

function requiredSlot(value) {
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 0 || slot > 99) {
    fail('INVALID_ARGUMENT', 'slot must be an integer within 0..99');
  }
  return slot;
}

function requiredBudget(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) {
    fail(
      'INVALID_ARGUMENT',
      'budgetSeconds must be an integer within 1..86400',
    );
  }
  return seconds;
}

export function parseCapabilities(value) {
  const capabilities = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  const unique = [...new Set(capabilities)];
  for (const capability of unique) {
    if (!STATION_CAPABILITIES.has(capability)) {
      fail('INVALID_ARGUMENT', `unsupported Station capability: ${capability}`);
    }
  }
  return unique.sort();
}

function normalizeIsoTimestamp(value, field) {
  const parsed = Date.parse(value);
  if (typeof value !== 'string' || !Number.isFinite(parsed)) {
    fail('MACHINE_REGISTRY_INVALID', `${field} is invalid`);
  }
  return new Date(parsed).toISOString();
}

function validateIsoTimestamp(value, field) {
  if (normalizeIsoTimestamp(value, field) !== value) {
    fail('MACHINE_REGISTRY_INVALID', `${field} is not canonical`);
  }
}

function gitValue(root, args, field, code = 'WORKTREE_IDENTITY_UNAVAILABLE') {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    fail(code, `cannot resolve ${field}`, {
      root,
      cause: String(error),
    });
  }
}

export function captureWorkspace(workspaceRoot = repoRoot) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(workspaceRoot);
  } catch (error) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', 'workspace root is unavailable', {
      root: workspaceRoot,
      cause: String(error),
    });
  }
  const gitRoot = realpathSync(
    gitValue(canonicalRoot, ['rev-parse', '--show-toplevel'], 'Git worktree root'),
  );
  if (gitRoot !== canonicalRoot) {
    fail(
      'WORKTREE_IDENTITY_MISMATCH',
      'workspace root is not the Git worktree root',
      { requested: canonicalRoot, actual: gitRoot },
    );
  }
  const branch = gitValue(
    canonicalRoot,
    ['branch', '--show-current'],
    'workspace branch',
  );
  if (!branch) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', 'detached worktree is unsupported');
  }
  const head = gitValue(canonicalRoot, ['rev-parse', 'HEAD'], 'workspace HEAD');
  if (!HEAD_PATTERN.test(head)) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', 'workspace HEAD is invalid');
  }
  return {
    workspaceId: workspaceIdForRoot(canonicalRoot),
    canonicalRoot,
    name: path.basename(canonicalRoot),
    branch,
    head,
  };
}

function parseEnvFile(file) {
  const values = {};
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) {
      fail('PROFILE_UNAVAILABLE', 'profile contains an invalid assignment', {
        file,
        line: index + 1,
      });
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      fail('PROFILE_UNAVAILABLE', 'profile contains an invalid variable name', {
        file,
        line: index + 1,
      });
    }
    if (
      value.length >= 2 &&
      ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"')))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function resolveEnvRepository(workspaceRoot, requestedEnvRepo) {
  const candidate = requestedEnvRepo
    ? path.resolve(requestedEnvRepo)
    : path.join(path.dirname(workspaceRoot), 'env');
  let canonical;
  try {
    canonical = realpathSync(candidate);
  } catch (error) {
    fail('PROFILE_UNAVAILABLE', 'environment repository is unavailable', {
      envRepo: candidate,
      cause: String(error),
    });
  }
  if (
    gitValue(
      canonical,
      ['rev-parse', '--is-inside-work-tree'],
      'environment repository',
      'PROFILE_UNAVAILABLE',
    ) !== 'true'
  ) {
    fail('PROFILE_UNAVAILABLE', 'environment repository is not a Git worktree', {
      envRepo: canonical,
    });
  }
  return canonical;
}

function trackedFile(envRepo, relative, label) {
  gitValue(
    envRepo,
    ['ls-files', '--error-unmatch', relative],
    label,
    'PROFILE_UNAVAILABLE',
  );
}

function requireCleanDefinition(envRepo, relativeDirectory, profile) {
  const status = gitValue(
    envRepo,
    ['status', '--porcelain', '--untracked-files=all', '--', relativeDirectory],
    'environment definition state',
    'PROFILE_UNAVAILABLE',
  );
  if (status) {
    fail(
      'PROFILE_UNAVAILABLE',
      'selected profile has dirty or untracked environment definitions',
      { profile, changes: status.split('\n') },
    );
  }
}

function normalizedHost(url, field) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail('PROFILE_UNAVAILABLE', `${field} is not a valid URL`, { value: url });
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    fail('PROFILE_UNAVAILABLE', `${field} must be an HTTP(S) URL`, {
      value: url,
    });
  }
  return parsed.hostname.toLowerCase();
}

function isLoopback(host) {
  const normalized = host.toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('127.')
  );
}

function resolveDeployDefinition(envRepo, deployEnvironment) {
  const matches = [];
  const profilesRoot = path.join(envRepo, 'peers-touch');
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(
        profilesRoot,
        entry.name,
        'deploy',
        `${deployEnvironment}.env.example`,
      );
      if (existsSync(candidate)) matches.push(candidate);
    }
  }
  matches.sort();
  if (matches.length !== 1) {
    fail(
      'PROFILE_UNAVAILABLE',
      'deploy environment must resolve to exactly one tracked definition',
      { deployEnvironment, matches },
    );
  }
  const file = realpathSync(matches[0]);
  const relative = path.relative(envRepo, file).replaceAll(path.sep, '/');
  trackedFile(envRepo, relative, 'deploy environment');
  const relativeDirectory = relative.split('/').slice(0, 2).join('/');
  requireCleanDefinition(envRepo, relativeDirectory, relativeDirectory);
  return { file, values: parseEnvFile(file) };
}

function environmentAuthorizationHelperPath() {
  return fileURLToPath(
    new URL('./environment-creation-authorization.py', import.meta.url),
  );
}

export function resolveProfileDefinition(options) {
  const workspaceRoot = captureWorkspace(options.workspaceRoot ?? repoRoot)
    .canonicalRoot;
  const profile = requiredIdentifier(options.profile, 'profile');
  const envRepo = resolveEnvRepository(workspaceRoot, options.envRepo);
  const relativeDirectory = `peers-touch/${profile}`;
  const relativeProfile = `${relativeDirectory}/profile.env.example`;
  let profileFile = path.join(envRepo, relativeProfile);
  let sourceState = 'tracked-clean';

  if (existsSync(profileFile)) {
    trackedFile(envRepo, relativeProfile, 'profile definition');
    requireCleanDefinition(envRepo, relativeDirectory, profile);
  } else {
    profileFile = path.join(
      workspaceRoot,
      '.local',
      'dev',
      'profiles',
      `${profile}.env`,
    );
    if (!existsSync(profileFile)) {
      fail('PROFILE_UNAVAILABLE', 'selected profile does not exist', {
        profile,
        expected: [
          path.join(envRepo, relativeProfile),
          profileFile,
        ],
      });
    }
    try {
      execFileSync(
        options.python ?? 'python3',
        [
          environmentAuthorizationHelperPath(),
          'verify',
          '--workspace-root',
          workspaceRoot,
          '--profile',
          profile,
          '--profile-file',
          profileFile,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (error) {
      fail(
        'ENVIRONMENT_CREATION_AUTHORIZATION_INVALID',
        'machine-local profile lacks a valid consumed authorization receipt',
        { profile, cause: error?.stderr?.toString().trim() || String(error) },
      );
    }
    sourceState = 'authorized-local';
  }

  const values = parseEnvFile(profileFile);
  if (values.PT_DEV_PROFILE !== profile) {
    fail('PROFILE_UNAVAILABLE', 'profile identity does not match its directory', {
      selected: profile,
      declared: values.PT_DEV_PROFILE ?? null,
    });
  }
  const stationMode = requiredText(
    values.PT_STATION_MODE,
    'PT_STATION_MODE',
    32,
  );
  if (!['local', 'compose', 'remote'].includes(stationMode)) {
    fail('PROFILE_UNAVAILABLE', 'profile has an unsupported Station mode', {
      stationMode,
    });
  }
  const stationUrl = requiredText(
    values.PT_STATION_URL,
    'PT_STATION_URL',
    2048,
  );
  const stationHost = normalizedHost(stationUrl, 'PT_STATION_URL');
  const deployEnvironment = values.PT_STATION_DEPLOY_ENV?.trim() || null;
  let deploy = null;
  if (deployEnvironment) {
    requiredIdentifier(deployEnvironment, 'PT_STATION_DEPLOY_ENV');
    deploy = resolveDeployDefinition(envRepo, deployEnvironment);
  }

  return {
    profile,
    profileFile,
    sourceState,
    envRepo,
    stationMode,
    stationUrl,
    stationHost,
    stationDeployEnvironment: deployEnvironment,
    stationDeployFile: deploy?.file ?? null,
    stationDeployHost: deploy?.values.PT_DEPLOY_HOST?.trim() || null,
  };
}

function validateProfileCapabilities(definition, capabilities) {
  const requiresStationMutation = capabilities.some((capability) =>
    ['station.deploy', 'station.reset'].includes(capability),
  );
  if (!requiresStationMutation) return;
  if (definition.stationMode !== 'remote') {
    fail(
      'PROFILE_UNAVAILABLE',
      'Station deploy/reset requires a remote profile',
      { stationMode: definition.stationMode },
    );
  }
  if (isLoopback(definition.stationHost)) {
    fail(
      'PROFILE_UNAVAILABLE',
      'Station deploy/reset rejects a loopback Station URL',
      { stationUrl: definition.stationUrl },
    );
  }
  if (
    !definition.stationDeployEnvironment ||
    !definition.stationDeployFile ||
    !definition.stationDeployHost
  ) {
    fail(
      'PROFILE_UNAVAILABLE',
      'remote Station mutation requires one tracked deploy environment',
      { profile: definition.profile },
    );
  }
  if (
    definition.stationHost.toLowerCase() !==
    definition.stationDeployHost.toLowerCase()
  ) {
    fail('DEPLOY_TARGET_MISMATCH', 'profile and deploy target hosts differ', {
      profileHost: definition.stationHost,
      deployHost: definition.stationDeployHost,
      deployEnvironment: definition.stationDeployEnvironment,
    });
  }
}

function normalizeRegistration(value) {
  if (!isObject(value)) {
    fail('MACHINE_REGISTRY_INVALID', 'registration must be an object');
  }
  const normalized = {
    workspaceId: value.workspaceId,
    canonicalRoot: value.canonicalRoot,
    name: value.name,
    branch: value.branch,
    head: value.head,
    profile: value.profile,
    slot: value.slot,
    allowedCapabilities: value.allowedCapabilities,
    purpose: value.purpose,
    owner: value.owner,
    registeredAt: value.registeredAt,
    updatedAt: value.updatedAt,
    updatedBy: value.updatedBy,
  };
  if (
    !/^[0-9a-f]{16}$/.test(normalized.workspaceId) ||
    !path.isAbsolute(normalized.canonicalRoot) ||
    workspaceIdForCanonicalPath(normalized.canonicalRoot) !==
      normalized.workspaceId ||
    path.basename(normalized.canonicalRoot) !== normalized.name ||
    !HEAD_PATTERN.test(normalized.head)
  ) {
    fail('MACHINE_REGISTRY_INVALID', 'registration identity is invalid', {
      workspaceId: normalized.workspaceId,
    });
  }
  for (const field of ['name', 'branch', 'profile', 'purpose', 'owner', 'updatedBy']) {
    requiredText(normalized[field], field);
  }
  normalized.slot = requiredSlot(normalized.slot);
  normalized.allowedCapabilities = parseCapabilities(
    normalized.allowedCapabilities,
  );
  normalized.registeredAt = normalizeIsoTimestamp(
    normalized.registeredAt,
    'registeredAt',
  );
  normalized.updatedAt = normalizeIsoTimestamp(
    normalized.updatedAt,
    'updatedAt',
  );
  return normalized;
}

function workspaceIdForCanonicalPath(canonicalRoot) {
  return createHash('sha256')
    .update(canonicalRoot)
    .digest('hex')
    .slice(0, 16);
}

function validateRegistry(registry) {
  if (
    !isObject(registry) ||
    registry.schemaVersion !== MACHINE_REGISTRY_SCHEMA_VERSION ||
    registry.kind !== MACHINE_REGISTRY_KIND ||
    registry.authority !== MACHINE_REGISTRY_AUTHORITY ||
    !Array.isArray(registry.registrations) ||
    Object.keys(registry).some((key) => !AUTHORITATIVE_REGISTRY_KEYS.has(key))
  ) {
    fail('MACHINE_REGISTRY_INVALID', 'machine registry schema is invalid');
  }
  validateIsoTimestamp(registry.updatedAt, 'updatedAt');
  const workspaceIds = new Set();
  const slots = new Set();
  registry.registrations = registry.registrations.map((entry) => {
    if (
      Object.keys(entry).length !== REGISTRATION_KEYS.size ||
      Object.keys(entry).some((key) => !REGISTRATION_KEYS.has(key))
    ) {
      fail('MACHINE_REGISTRY_INVALID', 'registration fields are invalid');
    }
    const normalized = normalizeRegistration(entry);
    if (workspaceIds.has(normalized.workspaceId)) {
      fail('MACHINE_REGISTRY_INVALID', 'workspace is registered more than once');
    }
    if (slots.has(normalized.slot)) {
      fail('MACHINE_REGISTRY_INVALID', 'local slot is allocated more than once');
    }
    workspaceIds.add(normalized.workspaceId);
    slots.add(normalized.slot);
    return normalized;
  });
  return registry;
}

export function readRegistry(file, { requireAuthority = true } = {}) {
  if (!existsSync(file)) {
    if (requireAuthority) {
      fail('WORKSPACE_UNREGISTERED', 'machine registry does not exist');
    }
    return null;
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail('MACHINE_REGISTRY_INVALID', 'machine registry is not valid JSON', {
      cause: String(error),
    });
  }
  if (
    registry?.schemaVersion !== MACHINE_REGISTRY_SCHEMA_VERSION ||
    registry?.kind !== MACHINE_REGISTRY_KIND ||
    !['observed-snapshot', MACHINE_REGISTRY_AUTHORITY].includes(
      registry?.authority,
    ) ||
    !Array.isArray(registry.registrations)
  ) {
    fail('MACHINE_REGISTRY_INVALID', 'machine registry header is invalid');
  }
  if (registry.authority !== MACHINE_REGISTRY_AUTHORITY) {
    if (requireAuthority) {
      fail(
        'WORKSPACE_UNREGISTERED',
        'machine registry is an observed snapshot, not runtime authority',
      );
    }
    return registry;
  }
  return validateRegistry(registry);
}

function promoteRegistry(registry, now) {
  const base = registry ?? {};
  const observedRegistrations =
    base.authority !== MACHINE_REGISTRY_AUTHORITY &&
    Array.isArray(base.registrations)
      ? base.registrations
      : [];
  const registrations =
    base.authority === MACHINE_REGISTRY_AUTHORITY &&
    Array.isArray(base.registrations)
    ? base.registrations.map(normalizeRegistration)
    : [];
  const discovery =
    observedRegistrations.length > 0
      ? {
          ...(isObject(base.discovery) ? base.discovery : {}),
          observedRegistrations,
        }
      : base.discovery;
  return validateRegistry({
    ...base,
    ...(discovery === undefined ? {} : { discovery }),
    schemaVersion: MACHINE_REGISTRY_SCHEMA_VERSION,
    kind: MACHINE_REGISTRY_KIND,
    authority: MACHINE_REGISTRY_AUTHORITY,
    updatedAt: now.toISOString(),
    registrations,
  });
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

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function acquireRegistryLock(lockFile, timeoutMs = REGISTRY_LOCK_TIMEOUT_MS) {
  mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const temp = path.join(
      path.dirname(lockFile),
      `.${path.basename(lockFile)}.${process.pid}.${randomBytes(8).toString('hex')}`,
    );
    const processStart = processStartIdentity();
    if (!processStart) {
      fail(
        'MACHINE_REGISTRY_INVALID',
        'cannot establish registry-lock process identity',
      );
    }
    writeFileSync(
      temp,
      `${JSON.stringify({
        pid: process.pid,
        processStart,
        createdAt: new Date().toISOString(),
      })}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    try {
      linkSync(temp, lockFile);
      unlinkSync(temp);
      return () => {
        try {
          unlinkSync(lockFile);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      unlinkSync(temp);
      if (error?.code !== 'EEXIST') throw error;
      let metadata;
      try {
        metadata = JSON.parse(readFileSync(lockFile, 'utf8'));
      } catch (readError) {
        fail('MACHINE_REGISTRY_INVALID', 'registry lock metadata is invalid', {
          cause: String(readError),
        });
      }
      const live = processIsAlive(metadata?.pid);
      const actualStart = live ? processStartIdentity(metadata.pid) : null;
      if (!live || actualStart !== metadata?.processStart) {
        try {
          unlinkSync(lockFile);
        } catch (unlinkError) {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        }
        continue;
      }
      if (Date.now() >= deadline) {
        fail('MACHINE_REGISTRY_LOCKED', 'timed out acquiring registry lock');
      }
      sleep(50);
    }
  }
}

function syncDirectory(directory) {
  let fd;
  try {
    fd = openSync(directory, 'r');
    fsyncSync(fd);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeRegistryAtomic(file, registry) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(8).toString('hex')}`,
  );
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(canonicalize(registry), null, 2)}\n`);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, file);
    syncDirectory(path.dirname(file));
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function mutateRegistry(options, mutation) {
  const home = options.home;
  const file = options.registryPath ?? machineRegistryPath(home);
  const lock = options.lockPath ?? machineRegistryLockPath(home);
  const now = options.now ?? new Date();
  const release = acquireRegistryLock(lock, options.lockTimeoutMs);
  try {
    const current = readRegistry(file, { requireAuthority: false });
    const registry = promoteRegistry(current, now);
    const output = mutation(registry, now);
    registry.updatedAt = now.toISOString();
    validateRegistry(registry);
    writeRegistryAtomic(file, registry);
    const readback = readRegistry(file);
    return { output, registry: readback };
  } finally {
    release();
  }
}

function assertSlotAvailable(registry, workspaceId, slot) {
  const conflict = registry.registrations.find(
    (entry) => entry.workspaceId !== workspaceId && entry.slot === slot,
  );
  if (conflict) {
    fail('LOCAL_SLOT_CONFLICT', 'local slot is allocated to another workspace', {
      slot,
      workspaceId: conflict.workspaceId,
    });
  }
}

function registrationForWorkspace(registry, workspaceId) {
  const registration = registry.registrations.find(
    (entry) => entry.workspaceId === workspaceId,
  );
  if (!registration) {
    fail('WORKSPACE_UNREGISTERED', 'workspace is not registered', {
      workspaceId,
    });
  }
  return registration;
}

function leaseHelperPath() {
  return fileURLToPath(new URL('./machine-dev-lease.py', import.meta.url));
}

function machineDevScriptPath() {
  return fileURLToPath(new URL('./machine-dev.mjs', import.meta.url));
}

export function observeLeases(options = {}) {
  const home = options.home;
  try {
    const output = execFileSync(
      options.python ?? 'python3',
      [
        leaseHelperPath(),
        'status',
        '--lease-root',
        options.leaseRoot ?? machineLeaseRoot(home),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(output);
  } catch (error) {
    fail('RUNTIME_IDENTITY_MISMATCH', 'cannot inspect OS-held leases', {
      cause: error?.stderr?.toString().trim() || String(error),
    });
  }
}

function assertWorkspaceHasNoLease(options, workspaceId) {
  const observation = observeLeases(options);
  const active = observation.activeLeases.filter(
    (lease) => lease.workspaceId === workspaceId,
  );
  if (active.length > 0) {
    fail(
      'STATION_CAPABILITY_CONFLICT',
      'workspace binding cannot change while it holds runtime leases',
      { activeLeases: active },
    );
  }
}

export function registerWorkspace(options) {
  const workspace = captureWorkspace(options.workspaceRoot ?? repoRoot);
  const profile = requiredIdentifier(options.profile, 'profile');
  const slot = requiredSlot(options.slot);
  const allowedCapabilities = parseCapabilities(options.capabilities);
  const purpose = requiredText(options.purpose, 'purpose', 1024);
  const owner = requiredText(options.owner, 'owner', 256);
  const definition = resolveProfileDefinition({
    workspaceRoot: workspace.canonicalRoot,
    envRepo: options.envRepo,
    profile,
  });
  validateProfileCapabilities(definition, allowedCapabilities);

  return mutateRegistry(options, (registry, now) => {
    if (
      registry.registrations.some(
        (entry) => entry.workspaceId === workspace.workspaceId,
      )
    ) {
      fail('WORKSPACE_ALREADY_REGISTERED', 'workspace is already registered', {
        workspaceId: workspace.workspaceId,
      });
    }
    assertSlotAvailable(registry, workspace.workspaceId, slot);
    const timestamp = now.toISOString();
    const registration = {
      ...workspace,
      profile,
      slot,
      allowedCapabilities,
      purpose,
      owner,
      registeredAt: timestamp,
      updatedAt: timestamp,
      updatedBy: owner,
    };
    registry.registrations.push(registration);
    registry.registrations.sort((left, right) =>
      left.workspaceId.localeCompare(right.workspaceId),
    );
    return registration;
  }).output;
}

export function updateWorkspace(options) {
  const workspace = captureWorkspace(options.workspaceRoot ?? repoRoot);
  return mutateRegistry(options, (registry, now) => {
    assertWorkspaceHasNoLease(options, workspace.workspaceId);
    const current = registrationForWorkspace(registry, workspace.workspaceId);
    if (current.canonicalRoot !== workspace.canonicalRoot) {
      fail(
        'WORKTREE_IDENTITY_MISMATCH',
        'registered root does not match current canonical root',
      );
    }
    const profile = options.profile
      ? requiredIdentifier(options.profile, 'profile')
      : current.profile;
    const slot =
      options.slot === undefined ? current.slot : requiredSlot(options.slot);
    const allowedCapabilities =
      options.capabilities === undefined
        ? current.allowedCapabilities
        : parseCapabilities(options.capabilities);
    const purpose =
      options.purpose === undefined
        ? current.purpose
        : requiredText(options.purpose, 'purpose', 1024);
    const owner =
      options.owner === undefined
        ? current.owner
        : requiredText(options.owner, 'owner', 256);
    const definition = resolveProfileDefinition({
      workspaceRoot: workspace.canonicalRoot,
      envRepo: options.envRepo,
      profile,
    });
    validateProfileCapabilities(definition, allowedCapabilities);
    assertSlotAvailable(registry, workspace.workspaceId, slot);

    const updated = {
      ...current,
      ...workspace,
      profile,
      slot,
      allowedCapabilities,
      purpose,
      owner,
      updatedAt: now.toISOString(),
      updatedBy: owner,
    };
    registry.registrations[
      registry.registrations.findIndex(
        (entry) => entry.workspaceId === workspace.workspaceId,
      )
    ] = updated;
    return updated;
  }).output;
}

export function slotPorts(slotValue) {
  const slot = requiredSlot(slotValue);
  return {
    station: 18_080 + slot * 100,
    desktopAppGateway: 3_030 + slot * 100,
    desktopAppWeb: 3_210 + slot * 100,
    desktopWebGateway: 3_031 + slot * 100,
    desktopWebWeb: 3_211 + slot * 100,
    mobileWeb: 5_173 + slot * 100,
  };
}

export function checkWorkspace(options = {}) {
  const workspace = captureWorkspace(options.workspaceRoot ?? repoRoot);
  const home = options.home;
  const registry = readRegistry(options.registryPath ?? machineRegistryPath(home));
  const registration = registrationForWorkspace(
    registry,
    workspace.workspaceId,
  );
  if (
    registration.canonicalRoot !== workspace.canonicalRoot ||
    registration.branch !== workspace.branch ||
    registration.head !== workspace.head
  ) {
    fail(
      'WORKTREE_IDENTITY_MISMATCH',
      'registered workspace identity does not match current Git state',
      { registered: registration, actual: workspace },
    );
  }
  if (
    options.workspaceId &&
    options.workspaceId !== registration.workspaceId
  ) {
    fail('WORKTREE_IDENTITY_MISMATCH', 'workspaceId assertion failed', {
      expected: options.workspaceId,
      actual: registration.workspaceId,
    });
  }
  if (options.profile && options.profile !== registration.profile) {
    fail('WORKSPACE_BINDING_MISSING', 'profile assertion failed', {
      expected: options.profile,
      actual: registration.profile,
    });
  }
  if (
    options.slot !== undefined &&
    requiredSlot(options.slot) !== registration.slot
  ) {
    fail('WORKSPACE_BINDING_MISSING', 'slot assertion failed', {
      expected: Number(options.slot),
      actual: registration.slot,
    });
  }
  const capabilities = parseCapabilities(options.capabilities);
  const missingCapabilities = capabilities.filter(
    (item) => !registration.allowedCapabilities.includes(item),
  );
  if (missingCapabilities.length > 0) {
    fail(
      'AUTHORIZATION_REQUIRED',
      'workspace binding does not allow requested Station capabilities',
      { missingCapabilities },
    );
  }
  if (options.budgetSeconds !== undefined) {
    requiredBudget(options.budgetSeconds);
  }
  const definition = resolveProfileDefinition({
    workspaceRoot: workspace.canonicalRoot,
    envRepo: options.envRepo,
    profile: registration.profile,
  });
  validateProfileCapabilities(definition, capabilities);
  return {
    authority: registry.authority,
    binding: registration,
    profile: definition,
    ports: slotPorts(registration.slot),
    workspaceStateRoot: workspaceStatePath({
      home,
      repoRoot: workspace.canonicalRoot,
    }),
  };
}

function validateRuntimeIntent(options, binding, resourceKind, resourceId) {
  const now = options.now ?? new Date();
  const file =
    options.workLedgerPath ??
    developmentWorkLedgerPath(options.home);
  const ledger = readLedger(file, now);
  const declaration = Object.values(ledger.declarations).find((candidate) => {
    if (
      candidate.workspaceId !== binding.workspaceId ||
      candidate.branch !== binding.branch ||
      candidate.sourceHead !== binding.head ||
      !LIVE_STATES.has(candidate.state) ||
      Date.parse(candidate.expiresAt) <= now.getTime()
    ) {
      return false;
    }
    const hasProfile = candidate.runtimeClaims.some(
      (claim) =>
        claim.kind === 'profile' &&
        claim.resourceId === binding.profile,
    );
    const hasResource = candidate.runtimeClaims.some(
      (claim) =>
        claim.kind === resourceKind &&
        claim.resourceId === resourceId &&
        claim.mode === 'exclusive',
    );
    return hasProfile && hasResource;
  });
  if (!declaration) {
    fail(
      'RUNTIME_INTENT_MISSING',
      'no active Development declaration owns this runtime resource',
      {
        workspaceId: binding.workspaceId,
        profile: binding.profile,
        resourceKind,
        resourceId,
      },
    );
  }
  return declaration;
}

export function prepareLease(options) {
  const resourceKind = requiredText(
    options.resourceKind,
    'resourceKind',
    64,
  );
  if (!LEASE_RESOURCE_KINDS.has(resourceKind)) {
    fail('INVALID_ARGUMENT', `unsupported lease resource kind: ${resourceKind}`);
  }
  const resourceId = requiredIdentifier(options.resourceId, 'resourceId');
  const budgetSeconds = requiredBudget(options.budgetSeconds);
  const requiredCapabilities =
    resourceKind === 'local.slot'
      ? []
      : resourceKind === 'station.deploy'
        ? ['station.connect', 'station.deploy']
        : [resourceKind];
  const resolved = checkWorkspace({
    ...options,
    capabilities: requiredCapabilities,
    budgetSeconds,
  });
  if (
    resourceKind === 'local.slot' &&
    String(resolved.binding.slot) !== resourceId
  ) {
    fail('WORKSPACE_BINDING_MISSING', 'local slot lease does not match binding', {
      requested: resourceId,
      bound: resolved.binding.slot,
    });
  }
  if (
    resourceKind === 'station.deploy' &&
    resolved.profile.stationDeployEnvironment !== resourceId
  ) {
    fail('DEPLOY_TARGET_MISMATCH', 'deploy lease does not match bound profile', {
      requested: resourceId,
      bound: resolved.profile.stationDeployEnvironment,
    });
  }
  if (
    resourceKind === 'station.reset' &&
    options.resetAuthorizedScope !== resourceId
  ) {
    fail(
      'AUTHORIZATION_REQUIRED',
      'station.reset requires an exact run-scoped authorization',
      { resourceId },
    );
  }
  const declaration = validateRuntimeIntent(
    options,
    resolved.binding,
    resourceKind,
    resourceId,
  );
  return {
    resourceKind,
    resourceId,
    budgetSeconds,
    workspaceId: resolved.binding.workspaceId,
    leaseFile:
      options.leaseFile ??
      machineLeasePath(
        resourceKind,
        resourceId,
        options.home,
      ),
    declarationId: declaration.declarationId,
  };
}

function registrationState(registration) {
  try {
    const workspace = captureWorkspace(registration.canonicalRoot);
    if (
      workspace.workspaceId !== registration.workspaceId ||
      workspace.branch !== registration.branch ||
      workspace.head !== registration.head
    ) {
      return {
        activity: 'stale',
        reason: 'registered source identity does not match current Git state',
      };
    }
    return { activity: 'idle', reason: null };
  } catch (error) {
    return {
      activity: 'stale',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
export function validateLeaseRequest(options) {
  const home = options.home;
  const release = acquireRegistryLock(
    options.lockPath ?? machineRegistryLockPath(home),
    options.lockTimeoutMs,
  );
  try {
    return prepareLease(options);
  } finally {
    release();
  }
}

export function verifyHeldLease(options) {
  const workspace = captureWorkspace(options.workspaceRoot ?? repoRoot);
  const resourceKind = requiredText(options.resourceKind, 'resourceKind', 64);
  const resourceId = requiredIdentifier(options.resourceId, 'resourceId');
  const leaseFd = Number(
    requiredText(
      options.leaseFd ?? process.env.PT_MACHINE_LEASE_FD,
      'PT_MACHINE_LEASE_FD',
      16,
    ),
  );
  if (!Number.isInteger(leaseFd) || leaseFd < 3) {
    fail(
      'RUNTIME_IDENTITY_MISMATCH',
      'inherited lease file descriptor is invalid',
    );
  }
  const leaseId = requiredText(
    options.leaseId ?? process.env.PT_MACHINE_LEASE_ID,
    'PT_MACHINE_LEASE_ID',
    128,
  );
  const leaseFile =
    options.leaseFile ??
    machineLeasePath(
      resourceKind,
      resourceId,
      options.home,
    );
  try {
    const output = execFileSync(
      options.python ?? 'python3',
      [
        leaseHelperPath(),
        'verify-held',
        '--lease-file',
        leaseFile,
        '--lease-fd',
        '3',
        '--lease-id',
        leaseId,
        '--resource-kind',
        resourceKind,
        '--resource-id',
        resourceId,
        '--workspace-id',
        workspace.workspaceId,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe', leaseFd],
      },
    );
    const held = JSON.parse(output);
    validateLeaseRequest({
      ...options,
      budgetSeconds: options.budgetSeconds ?? 1,
      resetAuthorizedScope:
        options.resetAuthorizedScope ??
        process.env.PT_MACHINE_LEASE_RESET_SCOPE,
    });
    return {
      ...held,
      validation: 'current',
    };
  } catch (error) {
    if (error instanceof MachineDevError) throw error;
    fail('RUNTIME_IDENTITY_MISMATCH', 'inherited lease is not valid', {
      cause: String(error),
    });
  }
}

export function statusAll(options = {}) {
  const home = options.home;
  const file = options.registryPath ?? machineRegistryPath(home);
  const registry = readRegistry(file, { requireAuthority: false });
  const leases = observeLeases(options);
  const authoritative =
    registry?.authority === MACHINE_REGISTRY_AUTHORITY;
  const registrations = (
    authoritative ? registry.registrations : []
  ).map((raw) => {
    let normalized;
    try {
      normalized = normalizeRegistration(raw);
    } catch (error) {
      return {
        workspaceId: raw?.workspaceId ?? null,
        activity: 'stale',
        reason: error.message,
      };
    }
    const state = registrationState(normalized);
    if (
      leases.activeLeases.some(
        (lease) => lease.workspaceId === normalized.workspaceId,
      )
    ) {
      state.activity = 'active';
      state.reason = null;
    }
    let profileState = 'available';
    let profileError = null;
    try {
      resolveProfileDefinition({
        workspaceRoot: normalized.canonicalRoot,
        envRepo: options.envRepo,
        profile: normalized.profile,
      });
    } catch (error) {
      profileState = 'blocked';
      profileError = {
        code: error.code ?? 'PROFILE_UNAVAILABLE',
        message: error.message,
      };
    }
    return {
      ...normalized,
      ...state,
      profileState,
      profileError,
    };
  });
  const unregisteredObservations = {
    ...(isObject(registry?.discovery) ? registry.discovery : {}),
  };
  if (!authoritative && (registry?.registrations?.length ?? 0) > 0) {
    unregisteredObservations.observedRegistrations = registry.registrations;
  }
  return {
    observedAt: new Date().toISOString(),
    authority: registry?.authority ?? 'missing',
    registrations,
    activeLeases: leases.activeLeases,
    staleLeaseMetadata: leases.staleMetadata,
    unregisteredObservations:
      Object.keys(unregisteredObservations).length > 0
        ? unregisteredObservations
        : null,
  };
}

export function buildLeaseCommand(options) {
  const request = prepareLease(options);
  const validationCommand = [
    process.execPath,
    machineDevScriptPath(),
    'validate-lease',
    '--workspace-root',
    options.workspaceRoot ?? repoRoot,
    '--resource-kind',
    request.resourceKind,
    '--resource-id',
    request.resourceId,
    '--budget-seconds',
    String(request.budgetSeconds),
  ];
  if (options.envRepo) {
    validationCommand.push('--env-repo', options.envRepo);
  }
  if (options.home) {
    validationCommand.push('--home', options.home);
  }
  if (options.resetAuthorizedScope) {
    validationCommand.push(
      '--reset-authorized-scope',
      options.resetAuthorizedScope,
    );
  }
  const arguments_ = [
    leaseHelperPath(),
    'run',
    '--lease-file',
    request.leaseFile,
    '--resource-kind',
    request.resourceKind,
    '--resource-id',
    request.resourceId,
    '--workspace-id',
    request.workspaceId,
    '--budget-seconds',
    String(request.budgetSeconds),
    '--validation-command-json',
    JSON.stringify(validationCommand),
  ];
  if (options.resetAuthorizedScope) {
    arguments_.push(
      '--reset-authorized-scope',
      options.resetAuthorizedScope,
    );
  }
  arguments_.push('--', ...options.command);
  return {
    executable: options.python ?? 'python3',
    arguments: arguments_,
    request,
  };
}

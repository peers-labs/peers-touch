import fs from 'node:fs';
import path from 'node:path';
import {
  checkWorkspace,
  MachineDevError,
  updateWorkspace,
} from '../scripts/local-dev/machine-dev-registry.mjs';
import { DevctlError, ERROR_CODES, fail } from './errors.mjs';

const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|CREDENTIAL)/i;

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseEnvText(text, source = '<memory>') {
  const values = {};

  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const match = line.match(ASSIGNMENT);
    if (!match) {
      fail(
        ERROR_CODES.PROFILE_INVALID,
        `Invalid declarative assignment at ${source}:${index + 1}`,
        { source, line: index + 1 },
      );
    }

    const [, key, rawValue] = match;
    if (/[$`]|\$\(|[<>|;&]/u.test(rawValue)) {
      fail(
        ERROR_CODES.PROFILE_INVALID,
        `Executable shell syntax is not allowed at ${source}:${index + 1}`,
        { source, line: index + 1, key },
      );
    }
    values[key] = unquote(rawValue.trim());
  }

  return values;
}

export function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fail(ERROR_CODES.PROFILE_REQUIRED, `Profile file not found: ${filePath}`, {
      filePath,
    });
  }
  return parseEnvText(fs.readFileSync(filePath, 'utf8'), filePath);
}

export function worktreeId(root) {
  return path.basename(path.resolve(root));
}

export function localDevPaths(root) {
  const localDev = path.join(root, '.local', 'dev');
  return {
    localDev,
    profiles: path.join(localDev, 'profiles'),
    active: path.join(localDev, 'active'),
    state: path.join(localDev, 'state'),
    data: path.join(localDev, 'data'),
    logs: path.join(localDev, 'logs'),
    pids: path.join(localDev, 'pids'),
  };
}

export function resolveEnvRepo(root, environment = process.env) {
  const candidates = [
    environment.PT_ENV_REPO,
    path.join(path.dirname(root), 'env'),
  ].filter(Boolean);

  return candidates.find((candidate) =>
    fs.existsSync(path.join(path.resolve(candidate), 'peers-touch')),
  );
}

function selectedProfileName(activePath) {
  try {
    return path.basename(fs.realpathSync(activePath), '.env');
  } catch {
    return path.basename(activePath, '.env');
  }
}

function machineOperation(operation) {
  try {
    return operation();
  } catch (error) {
    if (error instanceof MachineDevError) {
      throw new DevctlError(error.code, error.message, error.detail);
    }
    throw error;
  }
}

function applyMachineAllocation(profile, resolved) {
  const allocated = {
    ...profile,
    PT_DEV_SLOT: String(resolved.binding.slot),
    PT_DESKTOP_APP_GATEWAY_PORT: String(resolved.ports.desktopAppGateway),
    PT_DESKTOP_APP_WEB_PORT: String(resolved.ports.desktopAppWeb),
    PT_DESKTOP_WEB_GATEWAY_PORT: String(resolved.ports.desktopWebGateway),
    PT_DESKTOP_WEB_WEB_PORT: String(resolved.ports.desktopWebWeb),
    PT_MOBILE_WEB_PORT: String(resolved.ports.mobileWeb),
  };

  if (['local', 'compose'].includes(allocated.PT_STATION_MODE)) {
    allocated.PT_STATION_PORT = String(resolved.ports.station);
    allocated.PT_STATION_URL = `http://127.0.0.1:${resolved.ports.station}`;
  }
  return allocated;
}

export function validateProfile(profile, expectedName, filePath) {
  const required = [
    'PT_DEV_PROFILE',
    'PT_DEV_SLOT',
    'PT_STATION_MODE',
    'PT_STATION_NAME',
    'PT_STATION_URL',
    'PT_STATION_PORT',
    'PT_DESKTOP_APP_GATEWAY_PORT',
    'PT_DESKTOP_APP_WEB_PORT',
    'PT_DESKTOP_WEB_GATEWAY_PORT',
    'PT_DESKTOP_WEB_WEB_PORT',
  ];
  const missing = required.filter((key) => !profile[key]);
  if (missing.length > 0) {
    fail(
      ERROR_CODES.PROFILE_INVALID,
      `Profile is missing required fields: ${missing.join(', ')}`,
      { filePath, missing },
    );
  }

  if (expectedName && profile.PT_DEV_PROFILE !== expectedName) {
    fail(
      ERROR_CODES.PROFILE_INVALID,
      `Profile identity mismatch: selected=${expectedName} declared=${profile.PT_DEV_PROFILE}`,
      { filePath, selected: expectedName, declared: profile.PT_DEV_PROFILE },
    );
  }

  if (!['local', 'compose', 'remote'].includes(profile.PT_STATION_MODE)) {
    fail(
      ERROR_CODES.PROFILE_INVALID,
      `Unsupported PT_STATION_MODE: ${profile.PT_STATION_MODE}`,
      { filePath, value: profile.PT_STATION_MODE },
    );
  }

  const portKeys = required.filter((key) => key.endsWith('_PORT'));
  for (const key of portKeys) {
    const port = Number(profile[key]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fail(ERROR_CODES.PROFILE_INVALID, `Invalid port in ${key}: ${profile[key]}`, {
        filePath,
        key,
      });
    }
  }

  return profile;
}

export function resolveProfile(root, environment = process.env) {
  const paths = localDevPaths(root);
  const explicit = environment.PT_DEV_PROFILE_FILE
    ? path.resolve(environment.PT_DEV_PROFILE_FILE)
    : undefined;

  if (explicit) {
    const name = path.basename(explicit, '.env');
    const profile = validateProfile(readEnvFile(explicit), name, explicit);
    return {
      profile,
      reference: {
        worktreeId: worktreeId(root),
        workspaceRoot: path.resolve(root),
        profileName: name,
        activePath: explicit,
        resolvedPath: explicit,
        canonical: false,
      },
      paths: {
        ...paths,
        profileData: path.join(paths.data, name),
        profileLogs: path.join(paths.logs, name),
        profilePids: path.join(paths.pids, name),
        profileState: path.join(paths.state, name),
      },
    };
  }

  const resolved = machineOperation(() => checkWorkspace({
    workspaceRoot: root,
    envRepo: environment.PT_ENV_REPO,
    home: environment.HOME,
  }));
  const name = resolved.binding.profile;
  const resolvedPath = resolved.profile.profileFile;
  const profile = applyMachineAllocation(
    validateProfile(readEnvFile(resolvedPath), name, resolvedPath),
    resolved,
  );
  const runtimeRoot = path.join(
    resolved.workspaceStateRoot,
    'runtime',
    name,
  );

  return {
    profile,
    reference: {
      worktreeId: worktreeId(root),
      workspaceId: resolved.binding.workspaceId,
      workspaceRoot: resolved.binding.canonicalRoot,
      profileName: name,
      activePath: resolvedPath,
      resolvedPath,
      canonical: resolved.profile.sourceState === 'tracked-clean',
      authority: resolved.authority,
    },
    paths: {
      ...paths,
      profileData: path.join(runtimeRoot, 'data'),
      profileLogs: path.join(runtimeRoot, 'logs'),
      profilePids: path.join(runtimeRoot, 'pids'),
      profileState: path.join(runtimeRoot, 'state'),
    },
  };
}

export function listProfiles(root, environment = process.env) {
  const paths = localDevPaths(root);
  const envRepo = resolveEnvRepo(root, environment);
  const names = new Set();

  if (fs.existsSync(paths.profiles)) {
    for (const entry of fs.readdirSync(paths.profiles, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.env')) {
        names.add(path.basename(entry.name, '.env'));
      }
    }
  }

  const canonicalRoot = envRepo && path.join(envRepo, 'peers-touch');
  if (canonicalRoot && fs.existsSync(canonicalRoot)) {
    for (const entry of fs.readdirSync(canonicalRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory()
        && entry.name !== '0-tpl'
        && fs.existsSync(path.join(canonicalRoot, entry.name, 'profile.env.example'))
      ) {
        names.add(entry.name);
      }
    }
  }

  let active;
  try {
    active = checkWorkspace({
      workspaceRoot: root,
      envRepo: environment.PT_ENV_REPO,
      home: environment.HOME,
    }).binding.profile;
  } catch {
    active = undefined;
  }
  return [...names].sort().map((name) => ({ name, active: name === active }));
}

export function activateProfile(root, name, environment = process.env) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(name)) {
    fail(ERROR_CODES.PROFILE_INVALID, `Invalid profile name: ${name}`, { name });
  }
  machineOperation(() => updateWorkspace({
    workspaceRoot: root,
    envRepo: environment.PT_ENV_REPO,
    home: environment.HOME,
    profile: name,
  }));
  return resolveProfile(root, environment);
}

export function initializeProfile(root, name, slot = 0) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(name)) {
    fail(ERROR_CODES.PROFILE_INVALID, `Invalid profile name: ${name}`, { name });
  }
  if (!Number.isInteger(slot) || slot < 0 || slot > 400) {
    fail(ERROR_CODES.PROFILE_INVALID, `Invalid profile slot: ${slot}`, { slot });
  }

  const paths = localDevPaths(root);
  fs.mkdirSync(paths.profiles, { recursive: true });
  const destination = path.join(paths.profiles, `${name}.env`);
  if (fs.existsSync(destination)) {
    fail(ERROR_CODES.PROFILE_INVALID, `Profile already exists: ${destination}`, {
      destination,
    });
  }

  const stationPort = 18080 + slot * 100;
  const lines = [
    `# Profile: ${name} (slot ${slot})`,
    '# Generated by: devctl profile init',
    '',
    `PT_DEV_PROFILE=${name}`,
    `PT_DEV_SLOT=${slot}`,
    '',
    'PT_STATION_MODE=compose',
    `PT_STATION_NAME=${name}`,
    `PT_STATION_URL=http://127.0.0.1:${stationPort}`,
    `PT_STATION_PORT=${stationPort}`,
    `PT_STATION_DB_NAME=peers_touch_${name.replaceAll('-', '_')}`,
    `PT_STATION_COMPOSE_PROJECT=pt_${name.replaceAll('-', '_')}`,
    'PT_STATION_COMPOSE_ENV_FILE=',
    'PT_STATION_DEPLOY_ENV=',
    'PT_STATION_DEPLOY_BRANCH=',
    'PT_STATION_HEALTH_URL=',
    '',
    `PT_DESKTOP_APP_GATEWAY_PORT=${3030 + slot * 100}`,
    `PT_DESKTOP_APP_WEB_PORT=${3210 + slot * 100}`,
    `PT_DESKTOP_WEB_GATEWAY_PORT=${3031 + slot * 100}`,
    `PT_DESKTOP_WEB_WEB_PORT=${3211 + slot * 100}`,
    `PT_MOBILE_WEB_PORT=${5173 + slot * 100}`,
    `PT_MOBILE_DEFAULT_STATION_URL=http://127.0.0.1:${stationPort}`,
    '',
  ];
  fs.writeFileSync(destination, lines.join('\n'), { flag: 'wx', mode: 0o600 });
  return destination;
}

export function redactProfile(profile) {
  return Object.fromEntries(
    Object.entries(profile).map(([key, value]) => [
      key,
      SECRET_NAME.test(key) && value ? '<redacted>' : value,
    ]),
  );
}

export function normalizeConfiguredPath(value, platform = process.platform) {
  if (!value || platform !== 'win32') {
    return value;
  }
  const match = value.match(/^\/([A-Za-z])\/(.*)$/u);
  return match ? `${match[1].toUpperCase()}:\\${match[2].replaceAll('/', '\\')}` : value;
}

export function runtimeEnvironment(resolved, environment = process.env) {
  const profile = resolved.profile;
  const configuredBins = [
    'PT_GO_BIN',
    'PT_PYTHON_BIN',
    'PT_NODE_BIN',
    'PT_NPM_BIN',
    'PT_PROTOC_BIN',
  ]
    .map((key) => normalizeConfiguredPath(profile[key]))
    .filter(Boolean);

  return {
    ...environment,
    ...profile,
    PATH: [...configuredBins, environment.PATH ?? ''].join(path.delimiter),
    PROJECT_ROOT: resolved.reference.workspaceRoot
      ?? path.resolve(resolved.reference.activePath, '..', '..', '..', '..'),
    LOCAL_DEV_DIR: resolved.paths.localDev,
    PT_DEV_DATA: resolved.paths.profileData,
    PT_DEV_LOGS: resolved.paths.profileLogs,
    PT_DEV_PIDS: resolved.paths.profilePids,
  };
}

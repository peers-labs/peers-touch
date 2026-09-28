import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { findExecutable } from './doctor.mjs';
import { DevctlError, ERROR_CODES } from './errors.mjs';
import { probeHttp, waitForHttp } from './health.mjs';
import {
  inspectManagedProcess,
  inspectProcess,
  isPortListening,
  spawnManaged,
  stopManagedProcess,
} from './process-adapter.mjs';
import { resolveProfile, runtimeEnvironment } from './profile.mjs';

const SERVICE = 'station';

function writeIfChanged(filePath, content) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) {
    return;
  }
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, filePath);
}

function stationValues(resolved) {
  const { profile, paths } = resolved;
  const stationUrl = profile.PT_STATION_URL;
  return {
    stationUrl,
    healthUrl: profile.PT_STATION_HEALTH_URL
      || `${stationUrl}/api/oauth/providers`,
    port: Number(profile.PT_STATION_PORT),
    mode: profile.PT_STATION_MODE,
    stationDirectory: path.join(
      path.resolve(paths.localDev, '..', '..'),
      'apps',
      'station',
      'app',
    ),
    runtimeDirectory: path.join(paths.profileData, 'station-runtime'),
    configDirectory: path.join(paths.profileData, 'station-conf'),
    databasePath: path.join(paths.profileData, 'station.db'),
    identityPath: path.join(
      paths.profileData,
      'station-runtime',
      'data',
      'station-libp2p.key',
    ),
    ossPath: path.join(paths.profileData, 'oss'),
    authSecretPath: path.join(paths.profileData, 'auth-secret'),
    binaryPath: path.join(
      paths.profileData,
      process.platform === 'win32' ? 'station.exe' : 'station',
    ),
    logPath: path.join(paths.profileLogs, 'station.log'),
    buildLogPath: path.join(paths.profileLogs, 'station-build.log'),
    remoteDeployLogPath: path.join(paths.profileLogs, 'station-remote-deploy.log'),
  };
}

function localCommit(root) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  const commit = result.stdout?.trim();
  if (result.status !== 0 || !/^[0-9a-f]{40,64}$/u.test(commit ?? '')) {
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      'Current Git commit is unavailable',
      { status: result.status },
    );
  }
  return commit;
}

async function probeStationBuild(stationUrl, timeoutMs = 3_000) {
  const url = `${stationUrl.replace(/\/+$/u, '')}/app-meta/version`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, url };
    }
    const payload = await response.json();
    const version =
      payload?.data && typeof payload.data === 'object'
        ? payload.data
        : payload;
    const commit = version?.build_commit;
    if (
      version?.service !== 'peers-touch-station'
      || typeof commit !== 'string'
      || !/^[0-9a-f]{7,64}$/u.test(commit)
    ) {
      return { ok: false, status: response.status, url, error: 'invalid build identity' };
    }
    return { ok: true, status: response.status, url, commit };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function commitsMatch(expected, actual) {
  return expected.startsWith(actual) || actual.startsWith(expected);
}

export function prepareStationConfig(root, resolved) {
  const values = stationValues(resolved);
  const slot = Number(resolved.profile.PT_DEV_SLOT);
  const turnPort = Number(
    resolved.profile.PT_STATION_TURN_PORT || 3478 + slot * 100,
  );
  const bootstrapPort = Number(
    resolved.profile.PT_STATION_BOOTSTRAP_PORT || 4001 + slot * 100,
  );
  const sourceDirectory = path.join(values.stationDirectory, 'conf');
  fs.mkdirSync(values.configDirectory, { recursive: true });
  fs.mkdirSync(values.ossPath, { recursive: true });
  for (const name of ['config', 'data', 'cache', 'logs', 'run', 'temp']) {
    fs.mkdirSync(path.join(values.runtimeDirectory, name), { recursive: true });
  }

  const databasePath = values.databasePath.replaceAll('\\', '/');
  const ossPath = values.ossPath.replaceAll('\\', '/');
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.yml')) {
      const content = fs.readFileSync(path.join(sourceDirectory, entry.name), 'utf8')
        .replaceAll('/tmp/peers-touch-local.db', databasePath)
        .replaceAll('./data/libp2p.key', './data/station-libp2p.key')
        .replaceAll('${PEERS_NODE_SERVER_SUBSERVER_OSS_STORE_PATH}', ossPath)
        .replace(/address:\s*:18080/gu, `address: :${values.port}`)
        .replaceAll('http://127.0.0.1:18080', values.stationUrl)
        .replace(/(\n\s+port:\s*)3478(\s*\n)/gu, `$1${turnPort}$2`)
        .replaceAll('/ip4/0.0.0.0/tcp/4001', `/ip4/0.0.0.0/tcp/${bootstrapPort}`);
      writeIfChanged(path.join(values.configDirectory, entry.name), content);
    }
  }
  writeIfChanged(
    path.join(values.configDirectory, 'server.host.local.yml'),
    `peers:\n  node:\n    server:\n      baseurl: "${values.stationUrl}"\n`,
  );
  return path.join(values.configDirectory, 'peers-sqlite.yml');
}

function ensureAuthSecret(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${randomBytes(32).toString('hex')}\n`, {
      mode: 0o600,
    });
  }
  return fs.readFileSync(filePath, 'utf8').trim();
}

function runCompose(root, resolved, action, environment) {
  const profile = resolved.profile;
  const composeFile = path.join(root, 'tooling', 'docker', 'compose.yml');
  const envFile = profile.PT_STATION_COMPOSE_ENV_FILE
    || path.join(root, 'tooling', 'docker', '.env');
  if (!fs.existsSync(composeFile) || !fs.existsSync(envFile)) {
    throw new DevctlError(
      ERROR_CODES.PROFILE_INVALID,
      `Compose configuration is missing: ${composeFile} / ${envFile}`,
    );
  }
  const args = [
    'compose',
    '-f',
    composeFile,
    '--env-file',
    envFile,
    '--profile',
    'infra',
    '--profile',
    'station',
    action,
  ];
  if (action === 'up') {
    args.push('-d', 'postgres', 'station');
  } else {
    args.push('station');
  }
  const result = spawnSync('docker', args, {
    cwd: root,
    env: {
      ...runtimeEnvironment(resolved, environment),
      COMPOSE_PROJECT_NAME:
        profile.PT_STATION_COMPOSE_PROJECT || `pt-${profile.PT_DEV_PROFILE}`,
      STATION_PORT: profile.PT_STATION_PORT,
      POSTGRES_DB: profile.PT_STATION_DB_NAME || 'peers_touch',
      PEERS_NODE_LABEL: profile.PT_STATION_NAME || 'local',
    },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      `Docker Compose Station ${action} failed`,
      { stderr: result.stderr.trim() },
    );
  }
}

function parseStructuredRemoteFailure(output) {
  const lines = output.trim().split(/\r?\n/u);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].trimStart().startsWith('{')) continue;
    try {
      const payload = JSON.parse(lines.slice(index).join('\n'));
      if (
        payload?.status === 'BLOCKED'
        && typeof payload.code === 'string'
        && typeof payload.message === 'string'
      ) {
        return payload;
      }
    } catch {
      // Continue searching for the start of a trailing JSON error payload.
    }
  }
  return null;
}

function remoteDeployError(result, output, values, resolved) {
  const details = {
    profile: resolved.reference.profileName,
    deployEnvironment: resolved.profile.PT_STATION_DEPLOY_ENV,
    status: result.status,
    cause: result.error?.message,
    deployLogPath: values.remoteDeployLogPath,
  };
  const structured = parseStructuredRemoteFailure(output);
  if (structured) {
    return new DevctlError(
      structured.code,
      structured.message,
      {
        ...details,
        upstream: structured.detail ?? {},
      },
    );
  }
  if (output.includes('BLOCKED:dirty-remote-worktree')) {
    return new DevctlError(
      ERROR_CODES.REMOTE_SOURCE_DIRTY,
      `Remote deployment worktree is dirty; see ${values.remoteDeployLogPath}`,
      details,
    );
  }
  const missingEnvironment = output.match(/Couldn't find env file:\s*(.+)/u);
  if (missingEnvironment) {
    return new DevctlError(
      ERROR_CODES.REMOTE_ENV_REQUIRED,
      `Remote Station environment is missing: ${missingEnvironment[1].trim()}`,
      details,
    );
  }
  const timedOut =
    result.error?.code === 'ETIMEDOUT'
    || (result.status === null && result.signal === 'SIGTERM');
  return new DevctlError(
    timedOut ? ERROR_CODES.START_TIMEOUT : ERROR_CODES.REMOTE_DEPLOY_FAILED,
    timedOut
      ? `Remote Station deployment timed out; see ${values.remoteDeployLogPath}`
      : `Remote Station deployment failed; see ${values.remoteDeployLogPath}`,
    details,
  );
}

function runRemoteStationBridge(root, resolved, environment) {
  if (process.platform === 'win32') {
    throw new DevctlError(
      ERROR_CODES.UNSUPPORTED_MODE,
      'Remote Station deployment requires the reviewed Unix deployment adapter',
      { profile: resolved.reference.profileName },
    );
  }
  const runtimeEnv = runtimeEnvironment(resolved, environment);
  const bash = findExecutable('bash', runtimeEnv);
  const values = stationValues(resolved);
  const script = path.join(
    root,
    'tooling',
    'scripts',
    'local-dev',
    'station-dev.sh',
  );
  if (!bash || !fs.existsSync(script)) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      'Remote Station deployment adapter is unavailable',
      {
        profile: resolved.reference.profileName,
        script,
      },
    );
  }
  fs.mkdirSync(resolved.paths.profileLogs, { recursive: true });
  const stdio = ['ignore', 'pipe', 'pipe'];
  const leaseFd = Number(runtimeEnv.PT_MACHINE_LEASE_FD);
  if (Number.isInteger(leaseFd) && leaseFd >= 3) {
    while (stdio.length <= leaseFd) stdio.push('ignore');
    stdio[leaseFd] = leaseFd;
  }
  const result = spawnSync(bash, [script], {
    cwd: root,
    env: runtimeEnv,
    encoding: 'utf8',
    stdio,
    timeout: 1_800_000,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  fs.writeFileSync(values.remoteDeployLogPath, output);
  if (result.error || result.status !== 0) {
    throw remoteDeployError(result, output, values, resolved);
  }
}

export async function stationStatus(root, environment = process.env) {
  const resolved = resolveProfile(root, environment);
  const values = stationValues(resolved);
  const managed = inspectManagedProcess(resolved.paths.profileState, SERVICE);
  const [health, build] = await Promise.all([
    probeHttp(values.healthUrl),
    values.mode === 'remote'
      ? probeStationBuild(values.stationUrl)
      : Promise.resolve(null),
  ]);
  return {
    profile: resolved.reference.profileName,
    mode: values.mode,
    url: values.stationUrl,
    health,
    build,
    process: managed,
  };
}

export async function startStation(root, environment = process.env) {
  const resolved = resolveProfile(root, environment);
  const values = stationValues(resolved);
  if (values.mode === 'remote') {
    const expectedCommit = localCommit(root);
    const existing = await stationStatus(root, environment);
    if (
      existing.health.ok
      && existing.build?.ok
      && commitsMatch(expectedCommit, existing.build.commit)
    ) {
      return {
        ...existing,
        deployed: false,
        delegated: true,
        reused: true,
      };
    }
    runRemoteStationBridge(root, resolved, environment);
    await waitForHttp(values.healthUrl, { label: 'Remote Station' });
    const deployed = await stationStatus(root, environment);
    if (
      !deployed.build?.ok
      || !commitsMatch(expectedCommit, deployed.build.commit)
    ) {
      throw new DevctlError(
        ERROR_CODES.REMOTE_SOURCE_MISMATCH,
        'Remote Station build identity does not match the current Git commit',
        {
          expectedCommit,
          observedCommit: deployed.build?.commit ?? null,
          versionUrl: deployed.build?.url ?? null,
        },
      );
    }
    return {
      ...deployed,
      deployed: true,
      delegated: true,
      deployLogPath: values.remoteDeployLogPath,
    };
  }
  const existing = await stationStatus(root, environment);
  if (existing.health.ok) {
    if (values.mode === 'compose' || existing.process.status === 'running') {
      return { ...existing, reused: true };
    }
    throw new DevctlError(
      ERROR_CODES.PORT_CONFLICT,
      `Station endpoint is healthy but is not owned by devctl: ${values.stationUrl}`,
      { port: values.port, processStatus: existing.process.status },
    );
  }
  if (await isPortListening(values.port)) {
    throw new DevctlError(
      ERROR_CODES.PORT_CONFLICT,
      `Station port is occupied by an unmanaged process: ${values.port}`,
      { port: values.port },
    );
  }

  if (values.mode === 'compose') {
    runCompose(root, resolved, 'up', environment);
    await waitForHttp(values.healthUrl, { label: 'Station' });
    return stationStatus(root, environment);
  }
  const runtimeEnv = runtimeEnvironment(resolved, environment);
  const go = findExecutable('go', runtimeEnv);
  if (!go) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      'Go is required to build the local Station',
    );
  }
  fs.mkdirSync(resolved.paths.profileLogs, { recursive: true });
  const configPath = prepareStationConfig(root, resolved);
  const build = spawnSync(go, ['build', '-o', values.binaryPath, '.'], {
    cwd: values.stationDirectory,
    env: runtimeEnv,
    encoding: 'utf8',
    windowsHide: true,
  });
  fs.writeFileSync(
    values.buildLogPath,
    `${build.stdout ?? ''}${build.stderr ?? ''}`,
  );
  if (build.status !== 0) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      `Local Station build failed; see ${values.buildLogPath}`,
      { status: build.status },
    );
  }

  const commit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).stdout.trim();
  const childEnv = {
    ...runtimeEnv,
    PEERS_AUTH_SECRET: ensureAuthSecret(values.authSecretPath),
    PEERS_PROFILE: resolved.profile.PT_DEV_PROFILE,
    PEERS_TOUCH_BUILD_COMMIT: commit,
    PEERS_TOUCH_BUILD_LABEL: `local-${resolved.profile.PT_DEV_PROFILE}`,
    PEERS_TOUCH_BUILD_TIME: new Date().toISOString(),
  };
  const appDataRoot = path.join(resolved.paths.profileData, 'station-appdata');
  if (process.platform === 'win32') {
    childEnv.LOCALAPPDATA = appDataRoot;
    childEnv.APPDATA = path.join(appDataRoot, 'roaming');
  } else {
    childEnv.XDG_CONFIG_HOME = path.join(appDataRoot, 'config');
    childEnv.XDG_DATA_HOME = path.join(appDataRoot, 'data');
    childEnv.XDG_CACHE_HOME = path.join(appDataRoot, 'cache');
    childEnv.XDG_STATE_HOME = path.join(appDataRoot, 'state');
    childEnv.TMPDIR = path.join(appDataRoot, 'temp');
  }
  const record = spawnManaged({
    stateDirectory: resolved.paths.profileState,
    service: SERVICE,
    profile: resolved.reference.profileName,
    worktreeId: resolved.reference.worktreeId,
    command: values.binaryPath,
    args: [`--config=${configPath}`],
    cwd: values.runtimeDirectory,
    environment: childEnv,
    logPath: values.logPath,
    ports: [values.port],
    readinessUrl: values.healthUrl,
    identityTokens: [path.basename(values.binaryPath), configPath],
  });
  try {
    await waitForHttp(values.healthUrl, {
      label: 'Station',
      processAlive: () => Boolean(inspectProcess(record.pid)),
    });
  } catch (error) {
    stopManagedProcess(resolved.paths.profileState, SERVICE);
    throw error;
  }
  return stationStatus(root, environment);
}

export async function stopStation(root, environment = process.env) {
  const resolved = resolveProfile(root, environment);
  if (resolved.profile.PT_STATION_MODE === 'compose') {
    runCompose(root, resolved, 'stop', environment);
    return stationStatus(root, environment);
  }
  if (resolved.profile.PT_STATION_MODE === 'remote') {
    throw new DevctlError(
      ERROR_CODES.UNSUPPORTED_MODE,
      `Remote Station stop is not available through native devctl on ${process.platform}`,
    );
  }
  const result = stopManagedProcess(resolved.paths.profileState, SERVICE);
  return { profile: resolved.reference.profileName, result };
}

export async function restartStation(root, environment = process.env) {
  const resolved = resolveProfile(root, environment);
  if (resolved.profile.PT_STATION_MODE === 'remote') {
    return startStation(root, environment);
  }
  await stopStation(root, environment);
  return startStation(root, environment);
}

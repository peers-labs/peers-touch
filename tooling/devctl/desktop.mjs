import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { findExecutable } from './doctor.mjs';
import { DevctlError, ERROR_CODES } from './errors.mjs';
import { probeHttp, waitForPort } from './health.mjs';
import {
  inspectManagedProcess,
  inspectProcess,
  isPortListening,
  spawnManaged,
  stopManagedProcess,
} from './process-adapter.mjs';
import { resolveProfile, runtimeEnvironment } from './profile.mjs';

function desktopValues(root, resolved, mode) {
  const appMode = mode === 'app';
  const profile = resolved.profile;
  const runtimeProfile = `${profile.PT_DEV_PROFILE}-${mode}`;
  return {
    mode,
    runtimeProfile,
    desktopDirectory: path.join(root, 'apps', 'desktop'),
    gatewayPort: Number(
      appMode
        ? profile.PT_DESKTOP_APP_GATEWAY_PORT
        : profile.PT_DESKTOP_WEB_GATEWAY_PORT,
    ),
    webPort: Number(
      appMode
        ? profile.PT_DESKTOP_APP_WEB_PORT
        : profile.PT_DESKTOP_WEB_WEB_PORT,
    ),
    viteService: `desktop-${mode}-vite`,
    tauriService: `desktop-${mode}-tauri`,
    storageRoot: path.join(resolved.paths.profileData, `desktop-${mode}`),
    viteLog: path.join(resolved.paths.profileLogs, `desktop-${mode}-vite.log`),
    tauriLog: path.join(resolved.paths.profileLogs, `desktop-${mode}-tauri.log`),
    appletLog: path.join(resolved.paths.profileLogs, 'desktop-applets-build.log'),
    appletStamp: path.join(resolved.paths.localDev, 'cache', 'applets-build.sha256'),
    viteScript: path.join(
      root,
      'apps',
      'desktop',
      'node_modules',
      'vite',
      'bin',
      'vite.js',
    ),
    tauriScript: path.join(
      root,
      'apps',
      'desktop',
      'node_modules',
      '@tauri-apps',
      'cli',
      'tauri.js',
    ),
    configPath: path.join(
      resolved.paths.profileData,
      `desktop-${mode}-tauri.conf.json`,
    ),
  };
}

function appletSourceFingerprint(root) {
  const hash = createHash('sha256');
  const excluded = new Set(['node_modules', 'dist', 'target', '.git']);
  const roots = [
    path.join(root, 'pnpm-lock.yaml'),
    path.join(root, 'package.json'),
    path.join(root, 'apps', 'desktop', 'package.json'),
    path.join(root, 'apps', 'applets'),
    path.join(root, 'packages', 'applet-contract'),
  ];
  const pending = [...roots];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!fs.existsSync(current)) {
      continue;
    }
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (!excluded.has(entry.name)) {
          pending.push(path.join(current, entry.name));
        }
      }
    } else {
      files.push(current);
    }
  }
  for (const filePath of files.sort()) {
    hash.update(path.relative(root, filePath));
    hash.update(fs.readFileSync(filePath));
  }
  return hash.digest('hex');
}

function validateMode(mode) {
  if (!['app', 'web'].includes(mode)) {
    throw new DevctlError(
      ERROR_CODES.UNSUPPORTED_MODE,
      `Unsupported Desktop mode: ${mode}`,
      { mode },
    );
  }
}

function writeTauriOverride(values, worktreeId) {
  const suffix = worktreeId.replace(/[^A-Za-z0-9]+/gu, '-').replace(/-$/u, '');
  const config = {
    identifier: `com.peertouch.dev.${suffix}.${values.mode}`,
    build: {
      devUrl: `http://127.0.0.1:${values.webPort}`,
      beforeDevCommand: null,
    },
  };
  if (values.mode === 'web') {
    config.app = { windows: [{ create: false }] };
  }
  fs.mkdirSync(path.dirname(values.configPath), { recursive: true });
  fs.writeFileSync(values.configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function pnpmInvocation(pnpm) {
  if (process.platform !== 'win32') {
    return { command: pnpm, prefix: [] };
  }
  const script = path.join(
    path.dirname(pnpm),
    'node_modules',
    'pnpm',
    'bin',
    'pnpm.cjs',
  );
  if (!fs.existsSync(script)) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      `Unable to resolve the pnpm JavaScript entrypoint from ${pnpm}`,
      { pnpm, expected: script },
    );
  }
  return { command: process.execPath, prefix: [script] };
}

export function desktopTauriArguments(configPath, environment = process.env) {
  const args = ['dev', '--no-watch'];
  if (environment.PT_DESKTOP_E2E === 'true') {
    args.push('--features', 'e2e-testing');
  }
  args.push('--config', configPath);
  return args;
}

function runAppletBuild(root, pnpm, environment, values) {
  const fingerprint = appletSourceFingerprint(root);
  if (
    fs.existsSync(values.appletStamp)
    && fs.readFileSync(values.appletStamp, 'utf8').trim() === fingerprint
    && fs.existsSync(path.join(root, 'apps', 'desktop', 'applets-dist', 'index.json'))
  ) {
    return { built: false, fingerprint };
  }
  const invocation = pnpmInvocation(pnpm);
  const result = spawnSync(
    invocation.command,
    [...invocation.prefix, 'applets:build'],
    {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  fs.mkdirSync(path.dirname(values.appletLog), { recursive: true });
  fs.writeFileSync(values.appletLog, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  if (result.status !== 0) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      `Applet build failed; see ${values.appletLog}`,
      { status: result.status },
    );
  }
  fs.mkdirSync(path.dirname(values.appletStamp), { recursive: true });
  fs.writeFileSync(values.appletStamp, `${fingerprint}\n`);
  return { built: true, fingerprint };
}

function windowsDeveloperEnvironment(environment) {
  if (process.platform !== 'win32') {
    return environment;
  }
  const vsDevCmdCandidates = [
    environment.PT_VSDEVCMD,
    'C:\\BuildTools\\Common7\\Tools\\VsDevCmd.bat',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\Tools\\VsDevCmd.bat',
  ].filter(Boolean);
  const vsDevCmd = vsDevCmdCandidates.find((candidate) => fs.existsSync(candidate));
  if (!vsDevCmd) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      'Visual Studio Build Tools developer environment is required for Desktop',
      { candidates: vsDevCmdCandidates },
    );
  }
  const result = spawnSync(
    environment.ComSpec ?? process.env.ComSpec ?? 'cmd.exe',
    ['/d', '/s', '/c', 'call', vsDevCmd, '-arch=x64', '>nul', '&&', 'set'],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      `Unable to load Visual Studio developer environment from ${vsDevCmd}`,
      { stderr: result.stderr.trim() },
    );
  }
  const developerEnvironment = { ...environment };
  for (const line of result.stdout.split(/\r?\n/u)) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      developerEnvironment[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  delete developerEnvironment.CC;
  delete developerEnvironment.CXX;
  delete developerEnvironment.AR;
  developerEnvironment.VSLANG = '1033';
  developerEnvironment.OPENSSL_SRC_PERL =
    environment.OPENSSL_SRC_PERL || 'C:\\Strawberry\\perl\\bin\\perl.exe';
  return developerEnvironment;
}

async function assertPortsAvailable(values) {
  for (const [label, port] of [
    ['Vite', values.webPort],
    ['Gateway', values.gatewayPort],
  ]) {
    if (await isPortListening(port)) {
      throw new DevctlError(
        ERROR_CODES.PORT_CONFLICT,
        `${label} port is occupied by an unmanaged process: ${port}`,
        { label, port },
      );
    }
  }
}

export async function desktopStatus(
  root,
  mode = 'app',
  environment = process.env,
) {
  validateMode(mode);
  const resolved = resolveProfile(root, environment);
  const values = desktopValues(root, resolved, mode);
  const [viteReady, gatewayReady] = await Promise.all([
    probeHttp(`http://127.0.0.1:${values.webPort}/`),
    isPortListening(values.gatewayPort),
  ]);
  return {
    profile: resolved.reference.profileName,
    mode,
    runtimeProfile: values.runtimeProfile,
    web: {
      url: `http://127.0.0.1:${values.webPort}/`,
      health: viteReady,
      process: inspectManagedProcess(
        resolved.paths.profileState,
        values.viteService,
      ),
    },
    gateway: {
      port: values.gatewayPort,
      listening: gatewayReady,
      process: inspectManagedProcess(
        resolved.paths.profileState,
        values.tauriService,
      ),
    },
  };
}

export async function startDesktop(
  root,
  mode = 'app',
  environment = process.env,
) {
  validateMode(mode);
  const resolved = resolveProfile(root, environment);
  const values = desktopValues(root, resolved, mode);
  const existing = await desktopStatus(root, mode, environment);
  if (
    existing.web.health.ok
    && existing.gateway.listening
    && existing.web.process.status === 'running'
    && existing.gateway.process.status === 'running'
  ) {
    return { ...existing, reused: true };
  }
  if (
    existing.web.process.status === 'foreign'
    || existing.gateway.process.status === 'foreign'
  ) {
    throw new DevctlError(
      ERROR_CODES.PROCESS_IDENTITY_MISMATCH,
      `Desktop ${mode} has a foreign runtime-state record`,
    );
  }
  await assertPortsAvailable(values);
  const stationHealth = await probeHttp(
    resolved.profile.PT_STATION_HEALTH_URL
      || `${resolved.profile.PT_STATION_URL}/api/oauth/providers`,
  );
  if (!stationHealth.ok) {
    throw new DevctlError(
      ERROR_CODES.START_TIMEOUT,
      `Station is not healthy for Desktop ${mode}`,
      { stationHealth },
    );
  }

  const runtimeEnv = runtimeEnvironment(resolved, environment);
  const pnpm = findExecutable('pnpm', runtimeEnv);
  if (!pnpm) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      'pnpm is required to start Desktop',
    );
  }
  fs.mkdirSync(values.storageRoot, { recursive: true });
  for (const toolScript of [values.viteScript, values.tauriScript]) {
    if (!fs.existsSync(toolScript)) {
      throw new DevctlError(
        ERROR_CODES.DEPENDENCY_MISSING,
        `Desktop tool entrypoint is missing: ${toolScript}`,
        { toolScript },
      );
    }
  }
  runAppletBuild(root, pnpm, runtimeEnv, values);
  writeTauriOverride(values, resolved.reference.worktreeId);

  const childEnvironment = windowsDeveloperEnvironment({
    ...runtimeEnv,
    PT_PROFILE: values.runtimeProfile,
    PT_CLIENT_SURFACE: mode === 'app' ? 'desktop' : 'browser',
    PEERS_STATION_URL: resolved.profile.PT_STATION_URL,
    PEERS_STATION_MODE: resolved.profile.PT_STATION_MODE,
    PEERS_STORAGE_ROOT: values.storageRoot,
    PT_GATEWAY_PORT: String(values.gatewayPort),
    VITE_GATEWAY_PORT: String(values.gatewayPort),
    CARGO_BUILD_JOBS: environment.CARGO_BUILD_JOBS ?? '1',
  });

  const vite = spawnManaged({
    stateDirectory: resolved.paths.profileState,
    service: values.viteService,
    profile: resolved.reference.profileName,
    worktreeId: resolved.reference.worktreeId,
    command: process.execPath,
    args: [
      values.viteScript,
      '--host',
      '127.0.0.1',
      '--port',
      String(values.webPort),
    ],
    cwd: values.desktopDirectory,
    environment: childEnvironment,
    logPath: values.viteLog,
    ports: [values.webPort],
    readinessUrl: `http://127.0.0.1:${values.webPort}/`,
    identityTokens: ['vite', String(values.webPort)],
  });

  try {
    await waitForPort(values.webPort, {
      label: `Desktop ${mode} Vite`,
      processAlive: () => Boolean(inspectProcess(vite.pid)),
    });
    const tauri = spawnManaged({
      stateDirectory: resolved.paths.profileState,
      service: values.tauriService,
      profile: resolved.reference.profileName,
      worktreeId: resolved.reference.worktreeId,
      command: process.execPath,
      args: [
        values.tauriScript,
        ...desktopTauriArguments(values.configPath, childEnvironment),
      ],
      cwd: values.desktopDirectory,
      environment: childEnvironment,
      logPath: values.tauriLog,
      ports: [values.gatewayPort],
      identityTokens: ['tauri', path.basename(values.configPath)],
    });
    await waitForPort(values.gatewayPort, {
      label: `Desktop ${mode} Gateway`,
      processAlive: () => Boolean(inspectProcess(tauri.pid)),
      timeoutMs: 1_800_000,
    });
    const status = await desktopStatus(root, mode, environment);
    if (
      !status.web.health.ok
      || !status.gateway.listening
      || status.web.process.status !== 'running'
      || status.gateway.process.status !== 'running'
    ) {
      throw new DevctlError(
        ERROR_CODES.START_TIMEOUT,
        `Desktop ${mode} did not reach a fully healthy managed state`,
        { status },
      );
    }
    return status;
  } catch (error) {
    for (const service of [values.tauriService, values.viteService]) {
      try {
        stopManagedProcess(resolved.paths.profileState, service);
      } catch {
        // Preserve the original startup error.
      }
    }
    throw error;
  }
}

export async function stopDesktop(
  root,
  mode = 'app',
  environment = process.env,
) {
  validateMode(mode);
  const resolved = resolveProfile(root, environment);
  const values = desktopValues(root, resolved, mode);
  const results = [];
  for (const service of [values.tauriService, values.viteService]) {
    results.push(stopManagedProcess(resolved.paths.profileState, service));
  }
  return { profile: resolved.reference.profileName, mode, results };
}

export async function restartDesktop(
  root,
  mode = 'app',
  environment = process.env,
) {
  await stopDesktop(root, mode, environment);
  return startDesktop(root, mode, environment);
}

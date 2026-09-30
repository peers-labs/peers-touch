import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { findExecutable } from './doctor.mjs';
import { DevctlError, ERROR_CODES } from './errors.mjs';
import { probeHttp, waitForHttp, waitForPort } from './health.mjs';
import {
  inspectManagedProcess,
  inspectProcess,
  isPortListening,
  spawnManaged,
  stopManagedProcess,
} from './process-adapter.mjs';
import { resolveProfile, runtimeEnvironment } from './profile.mjs';
import { startStation } from './station.mjs';

export function desktopViteReadinessUrl(webPort) {
  return `http://127.0.0.1:${webPort}/src/services/desktop_api.ts`;
}

export function desktopViteEntryUrl(webPort) {
  return `http://127.0.0.1:${webPort}/src/main.tsx`;
}

export async function warmDesktopViteModuleGraph(
  webPort,
  fetchModule = fetch,
  maxModules = 2_000,
) {
  const origin = `http://127.0.0.1:${webPort}`;
  const queue = [desktopViteEntryUrl(webPort)];
  const seen = new Set();
  while (queue.length > 0) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    if (seen.size >= maxModules) {
      throw new DevctlError(
        ERROR_CODES.CHECK_FAILED,
        `Desktop Vite module graph exceeded ${maxModules} modules`,
        { url, modules: seen.size },
      );
    }
    seen.add(url);
    const response = await fetchModule(url);
    if (!response.ok) {
      throw new DevctlError(
        ERROR_CODES.START_TIMEOUT,
        `Desktop Vite module graph failed at ${url}`,
        { url, status: response.status },
      );
    }
    const body = await response.text();
    const imports =
      /(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)["']([^"']+)["']/gu;
    for (const match of body.matchAll(imports)) {
      if (!match[1].startsWith('/')) continue;
      const imported = new URL(match[1], url);
      if (imported.origin === origin && !seen.has(imported.href)) {
        queue.push(imported.href);
      }
    }
  }
  return { ok: true, url: desktopViteEntryUrl(webPort), modules: seen.size };
}

export async function waitForDesktopVite(
  webPort,
  mode,
  processAlive,
  waitForReady = waitForHttp,
  warmModuleGraph = warmDesktopViteModuleGraph,
  stabilize = (durationMs) =>
    new Promise((resolve) => setTimeout(resolve, durationMs)),
) {
  const url = desktopViteReadinessUrl(webPort);
  const options = {
    label: `Desktop ${mode} Vite`,
    processAlive,
  };
  await waitForReady(url, options);
  await warmModuleGraph(webPort);
  await stabilize(3_000);
  return waitForReady(url, options);
}

export function desktopFrontendLogState(content) {
  if (content.includes('React app mounted — dismissing boot fallback')) {
    return { ready: true };
  }
  const failure = content
    .split(/\r?\n/u)
    .find(
      (line) =>
        line.includes('RESOURCE LOAD ERROR') ||
        line.includes('MODULE RETRY ERROR') ||
        line.includes('TIMEOUT: React did not mount'),
    );
  return failure ? { ready: false, failure } : { ready: false };
}

export async function waitForDesktopFrontend(
  logPath,
  {
    fromOffset = 0,
    timeoutMs = 90_000,
    intervalMs = 250,
    processAlive,
    readLog = () =>
      fs.existsSync(logPath)
        ? fs.readFileSync(logPath, 'utf8').slice(fromOffset)
        : '',
    wait = (durationMs) =>
      new Promise((resolve) => setTimeout(resolve, durationMs)),
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (processAlive && !processAlive()) {
      throw new DevctlError(
        ERROR_CODES.START_TIMEOUT,
        'Desktop Tauri exited before the renderer mounted',
        { logPath },
      );
    }
    const state = desktopFrontendLogState(readLog());
    if (state.ready) return state;
    if (state.failure) {
      throw new DevctlError(
        ERROR_CODES.START_TIMEOUT,
        'Desktop renderer failed before React mounted',
        { logPath, failure: state.failure },
      );
    }
    await wait(intervalMs);
  }
  throw new DevctlError(
    ERROR_CODES.START_TIMEOUT,
    `Desktop renderer did not mount within ${timeoutMs}ms`,
    { logPath },
  );
}

function desktopValues(root, resolved, mode) {
  const appMode = mode === 'app';
  const profile = resolved.profile;
  const runtimeProfile = `${profile.PT_DEV_PROFILE}-${mode}`;
  const webPort = Number(
    appMode
      ? profile.PT_DESKTOP_APP_WEB_PORT
      : profile.PT_DESKTOP_WEB_WEB_PORT,
  );
  return {
    mode,
    runtimeProfile,
    desktopDirectory: path.join(root, 'apps', 'desktop'),
    gatewayPort: Number(
      appMode
        ? profile.PT_DESKTOP_APP_GATEWAY_PORT
        : profile.PT_DESKTOP_WEB_GATEWAY_PORT,
    ),
    webPort,
    viteReadinessUrl: desktopViteReadinessUrl(webPort),
    viteService: `desktop-${mode}-vite`,
    tauriService: `desktop-${mode}-tauri`,
    storageRoot: path.join(resolved.paths.profileData, `desktop-${mode}`),
    viteLog: path.join(resolved.paths.profileLogs, `desktop-${mode}-vite.log`),
    tauriLog: path.join(resolved.paths.profileLogs, `desktop-${mode}-tauri.log`),
    appletLog: path.join(resolved.paths.profileLogs, 'desktop-applets-build.log'),
    dependencyLog: path.join(
      resolved.paths.profileLogs,
      'desktop-dependencies-install.log',
    ),
    generatedSourceLog: path.join(
      resolved.paths.profileLogs,
      'desktop-generated-sources.log',
    ),
    appletStamp: path.join(resolved.paths.localDev, 'cache', 'applets-build.sha256'),
    protoRoot: path.join(root, 'model'),
    protoOutput: path.join(root, 'apps', 'desktop', 'src', 'gen', 'proto'),
    modelBuildScript: path.join(root, 'model', 'build.sh'),
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

function desktopProtoRequirements(values) {
  const domainRoot = path.join(values.protoRoot, 'domain');
  const pending = fs.existsSync(domainRoot) ? [domainRoot] : [];
  const requirements = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (
        entry.name.endsWith('.proto')
        && !absolute.endsWith(path.join('ai_box', 'ai_box_message.proto'))
      ) {
        const relative = path.relative(values.protoRoot, absolute);
        requirements.push({
          source: absolute,
          output: path.join(
            values.protoOutput,
            relative.replace(/\.proto$/u, '_pb.ts'),
          ),
        });
      }
    }
  }
  return requirements.sort((left, right) =>
    left.source.localeCompare(right.source));
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

export function desktopRuntimeIdentity(values, environment = process.env) {
  return {
    profile: environment.PT_PROFILE ?? values.runtimeProfile,
    storageRoot: environment.PEERS_STORAGE_ROOT ?? values.storageRoot,
  };
}

export function ensureDesktopDependencies(
  root,
  invocation,
  environment,
  values,
  runCommand = spawnSync,
) {
  const requiredTools = [values.viteScript, values.tauriScript];
  const missingBefore = requiredTools.filter(
    (toolScript) => !fs.existsSync(toolScript),
  );
  if (missingBefore.length === 0) {
    return { installed: false, missingBefore };
  }

  const result = runCommand(
    invocation.command,
    [...invocation.prefix, 'install', '--frozen-lockfile'],
    {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600_000,
    },
  );
  fs.mkdirSync(path.dirname(values.dependencyLog), { recursive: true });
  fs.writeFileSync(
    values.dependencyLog,
    `${result.stdout ?? ''}${result.stderr ?? ''}`,
  );
  if (result.error || result.status !== 0) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      `Desktop dependency installation failed; see ${values.dependencyLog}`,
      {
        status: result.status,
        signal: result.signal,
        cause: result.error?.message,
        missingTools: missingBefore,
      },
    );
  }

  const missingAfter = requiredTools.filter(
    (toolScript) => !fs.existsSync(toolScript),
  );
  if (missingAfter.length > 0) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      `Desktop dependencies are incomplete after installation; see ${values.dependencyLog}`,
      { missingTools: missingAfter },
    );
  }
  return { installed: true, missingBefore };
}

export function ensureDesktopGeneratedSources(
  root,
  environment,
  values,
  runCommand = spawnSync,
) {
  const requirements = desktopProtoRequirements(values);
  const missingBefore = requirements
    .filter(({ output }) => !fs.existsSync(output))
    .map(({ output }) => output);
  if (missingBefore.length === 0) {
    return { generated: false, missingBefore };
  }

  const bash = findExecutable('bash', environment);
  if (!bash || !fs.existsSync(values.modelBuildScript)) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      'Desktop generated-source builder is unavailable',
      { bash, modelBuildScript: values.modelBuildScript },
    );
  }
  const result = runCommand(bash, [values.modelBuildScript], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 600_000,
  });
  fs.mkdirSync(path.dirname(values.generatedSourceLog), { recursive: true });
  fs.writeFileSync(
    values.generatedSourceLog,
    `${result.stdout ?? ''}${result.stderr ?? ''}`,
  );
  if (result.error || result.status !== 0) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      `Desktop generated-source preparation failed; see ${values.generatedSourceLog}`,
      {
        status: result.status,
        signal: result.signal,
        cause: result.error?.message,
        missingOutputs: missingBefore,
      },
    );
  }

  const missingAfter = requirements
    .filter(({ output }) => !fs.existsSync(output))
    .map(({ output }) => output);
  if (missingAfter.length > 0) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      `Desktop generated sources are incomplete; see ${values.generatedSourceLog}`,
      { missingOutputs: missingAfter },
    );
  }
  return { generated: true, missingBefore };
}

function runAppletBuild(root, invocation, environment, values) {
  const fingerprint = appletSourceFingerprint(root);
  if (
    fs.existsSync(values.appletStamp)
    && fs.readFileSync(values.appletStamp, 'utf8').trim() === fingerprint
    && fs.existsSync(path.join(root, 'apps', 'desktop', 'applets-dist', 'index.json'))
  ) {
    return { built: false, fingerprint };
  }
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

export function reconcileDesktopRuntime(
  stateDirectory,
  values,
  existing,
  sourceCommit,
  stopProcess = stopManagedProcess,
) {
  const processStates = [
    existing.web.process,
    existing.gateway.process,
  ];
  if (processStates.some(({ status }) => status === 'foreign')) {
    throw new DevctlError(
      ERROR_CODES.PROCESS_IDENTITY_MISMATCH,
      `Desktop ${values.mode} has a foreign runtime-state record`,
    );
  }
  const reusable =
    existing.web.health.ok
    && existing.gateway.listening
    && processStates.every(({ status }) => status === 'running')
    && processStates.every(
      ({ record }) => record.sourceCommit === sourceCommit,
    );
  if (reusable) {
    return { reused: true, stopped: [] };
  }
  return {
    reused: false,
    stopped: [values.tauriService, values.viteService].map((service) =>
      stopProcess(stateDirectory, service)),
  };
}

export async function desktopStatus(
  root,
  mode = 'app',
  environment = process.env,
) {
  validateMode(mode);
  const resolved = resolveProfile(root, environment);
  const values = desktopValues(root, resolved, mode);
  const runtimeIdentity = desktopRuntimeIdentity(values, environment);
  const [viteReady, gatewayReady] = await Promise.all([
    probeHttp(values.viteReadinessUrl),
    isPortListening(values.gatewayPort),
  ]);
  return {
    profile: resolved.reference.profileName,
    mode,
    runtimeProfile: runtimeIdentity.profile,
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
  const runtimeEnv = runtimeEnvironment(resolved, environment);
  const runtimeIdentity = desktopRuntimeIdentity(values, environment);
  const pnpm = findExecutable('pnpm', runtimeEnv);
  if (!pnpm) {
    throw new DevctlError(
      ERROR_CODES.DEPENDENCY_MISSING,
      'pnpm is required to start Desktop',
    );
  }
  const pnpmCommand = pnpmInvocation(pnpm);
  const dependencyState = ensureDesktopDependencies(
    root,
    pnpmCommand,
    runtimeEnv,
    values,
  );
  const sourceCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).stdout?.trim();
  if (!/^[0-9a-f]{40,64}$/u.test(sourceCommit ?? '')) {
    throw new DevctlError(
      ERROR_CODES.CHECK_FAILED,
      'Current Git commit is unavailable for Desktop runtime ownership',
    );
  }
  const existing = await desktopStatus(root, mode, environment);
  const reconciliation = reconcileDesktopRuntime(
    resolved.paths.profileState,
    values,
    existing,
    sourceCommit,
  );
  const generatedSourceState = ensureDesktopGeneratedSources(
    root,
    runtimeEnv,
    values,
  );
  await startStation(root, environment);
  if (reconciliation.reused) {
    return {
      ...existing,
      dependenciesInstalled: dependencyState.installed,
      generatedSourcesPrepared: generatedSourceState.generated,
      reused: true,
    };
  }
  await assertPortsAvailable(values);

  fs.mkdirSync(runtimeIdentity.storageRoot, { recursive: true });
  runAppletBuild(root, pnpmCommand, runtimeEnv, values);
  writeTauriOverride(values, resolved.reference.worktreeId);

  const childEnvironment = windowsDeveloperEnvironment({
    ...runtimeEnv,
    PT_PROFILE: runtimeIdentity.profile,
    PT_CLIENT_SURFACE: mode === 'app' ? 'desktop' : 'browser',
    PEERS_STATION_URL: resolved.profile.PT_STATION_URL,
    PEERS_STATION_MODE: resolved.profile.PT_STATION_MODE,
    PEERS_STORAGE_ROOT: runtimeIdentity.storageRoot,
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
      '--force',
      '--host',
      '127.0.0.1',
      '--port',
      String(values.webPort),
    ],
    cwd: values.desktopDirectory,
    environment: childEnvironment,
    logPath: values.viteLog,
    ports: [values.webPort],
    readinessUrl: values.viteReadinessUrl,
    identityTokens: ['vite', String(values.webPort)],
    sourceCommit,
  });

  try {
    await waitForDesktopVite(
      values.webPort,
      mode,
      () => Boolean(inspectProcess(vite.pid)),
    );
    const tauriLogOffset = fs.existsSync(values.tauriLog)
      ? fs.statSync(values.tauriLog).size
      : 0;
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
      sourceCommit,
    });
    await waitForPort(values.gatewayPort, {
      label: `Desktop ${mode} Gateway`,
      processAlive: () => Boolean(inspectProcess(tauri.pid)),
      timeoutMs: 1_800_000,
    });
    await waitForDesktopFrontend(values.tauriLog, {
      fromOffset: tauriLogOffset,
      processAlive: () => Boolean(inspectProcess(tauri.pid)),
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
    return {
      ...status,
      dependenciesInstalled: dependencyState.installed,
      generatedSourcesPrepared: generatedSourceState.generated,
    };
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

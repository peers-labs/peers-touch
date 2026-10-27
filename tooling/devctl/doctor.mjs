import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveProfile, runtimeEnvironment } from './profile.mjs';

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat', ''];

// Station needs ~20 GB free for images, module caches and a first build;
// ~4 GB RAM is the floor for Go + Tauri + Postgres running together.
const REQUIRED_DISK_BYTES = 20 * 1024 ** 3;
const REQUIRED_MEMORY_BYTES = 4 * 1024 ** 3;

function executableCandidates(command, environment) {
  const pathEntries = (environment.PATH ?? '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? WINDOWS_EXECUTABLE_EXTENSIONS
    : [''];
  return pathEntries.flatMap((directory) =>
    extensions.map((extension) => path.join(directory, `${command}${extension}`)),
  );
}

export function findExecutable(command, environment = process.env) {
  if (path.isAbsolute(command) && fs.existsSync(command)) {
    return command;
  }
  return executableCandidates(command, environment).find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function runCommand(executable, args, environment, timeout = 10_000) {
  const invocation = process.platform === 'win32' && /\.(cmd|bat)$/iu.test(executable)
    ? {
      command: environment.ComSpec ?? process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${executable}" ${args.join(' ')}`],
    }
    : { command: executable, args };
  return spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    env: environment,
    windowsHide: true,
    timeout,
  });
}

function versionOf(executable, args = ['--version'], environment = process.env) {
  if (!executable) {
    return undefined;
  }
  const result = runCommand(executable, args, environment);
  if (result.error || result.status !== 0) {
    return undefined;
  }
  return `${result.stdout}${result.stderr}`.trim().split(/\r?\n/u)[0];
}

function toolCheck(id, command, requiredFor, environment, options = {}) {
  const executable = findExecutable(command, environment);
  if (!executable) {
    return {
      id,
      status: options.optional ? 'warn' : 'fail',
      requiredFor,
      remediation: options.remediation
        ?? `Install ${command} (or run "make dev-up") and add it to PATH`,
    };
  }
  return {
    id,
    status: 'pass',
    requiredFor,
    observed: `${executable} (${versionOf(executable, options.versionArgs, environment) ?? 'version unavailable'})`,
  };
}

function dockerChecks(requiredFor, environment, optional) {
  const checks = [];
  const docker = findExecutable('docker', environment);
  if (!docker) {
    checks.push({
      id: 'docker',
      status: optional ? 'warn' : 'fail',
      requiredFor,
      remediation: process.platform === 'linux'
        ? 'Install Docker Engine with the compose plugin (or run "make dev-up")'
        : 'Install Docker Desktop (or run "make dev-up")',
    });
    return checks;
  }
  checks.push({
    id: 'docker',
    status: 'pass',
    requiredFor,
    observed: docker,
  });

  const info = runCommand(docker, ['info', '--format', '{{.ServerVersion}}'], environment);
  if (info.error || info.status !== 0) {
    checks.push({
      id: 'docker-daemon',
      status: optional ? 'warn' : 'fail',
      requiredFor,
      remediation: process.platform === 'darwin'
        ? 'Start Docker Desktop (first launch needs a manual EULA acceptance)'
        : 'Start the daemon: sudo systemctl enable --now docker',
    });
  } else {
    checks.push({
      id: 'docker-daemon',
      status: 'pass',
      requiredFor,
      observed: `Engine ${info.stdout.trim()}`,
    });
  }

  const compose = runCommand(docker, ['compose', 'version', '--short'], environment);
  if (compose.error || compose.status !== 0) {
    checks.push({
      id: 'docker-compose',
      status: optional ? 'warn' : 'fail',
      requiredFor,
      remediation: 'Install the Docker Compose v2 plugin (docker-compose-plugin); "docker-compose" v1 is not supported',
    });
  } else {
    checks.push({
      id: 'docker-compose',
      status: 'pass',
      requiredFor,
      observed: compose.stdout.trim(),
    });
  }
  return checks;
}

function availableDiskBytes(targetPath) {
  if (process.platform === 'linux' || process.platform === 'darwin') {
    const result = spawnSync('df', ['-Pk', targetPath], { encoding: 'utf8' });
    if (result.status === 0) {
      const line = result.stdout.trim().split(/\r?\n/u)[1];
      const available = Number(line?.split(/\s+/u)[3]);
      if (Number.isFinite(available)) {
        return available * 1024;
      }
    }
    return undefined;
  }
  return undefined;
}

function totalMemoryBytes() {
  if (process.platform === 'linux') {
    try {
      const match = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemTotal:\s+(\d+)\s+kB/mu);
      if (match) {
        return Number(match[1]) * 1024;
      }
    } catch {
      return undefined;
    }
  }
  if (process.platform === 'darwin') {
    const result = spawnSync('sysctl', ['-n', 'hw.memsize'], { encoding: 'utf8' });
    if (result.status === 0) {
      const value = Number(result.stdout.trim());
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }
  return undefined;
}

function resourceChecks(root) {
  const checks = [];
  const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

  const disk = availableDiskBytes(root);
  if (disk === undefined) {
    checks.push({
      id: 'disk-space',
      status: 'warn',
      requiredFor: ['all'],
      observed: 'cannot determine free disk space on this platform',
    });
  } else {
    checks.push({
      id: 'disk-space',
      status: disk >= REQUIRED_DISK_BYTES ? 'pass' : 'fail',
      requiredFor: ['all'],
      observed: `${gib(disk)} free (need >= ${gib(REQUIRED_DISK_BYTES)})`,
      ...(disk >= REQUIRED_DISK_BYTES ? {} : {
        remediation: 'Free disk space before running "make dev-up"',
      }),
    });
  }

  const memory = totalMemoryBytes();
  if (memory === undefined) {
    checks.push({
      id: 'memory',
      status: 'warn',
      requiredFor: ['all'],
      observed: 'cannot determine total memory on this platform',
    });
  } else {
    checks.push({
      id: 'memory',
      status: memory >= REQUIRED_MEMORY_BYTES ? 'pass' : 'fail',
      requiredFor: ['all'],
      observed: `${gib(memory)} total (need >= ${gib(REQUIRED_MEMORY_BYTES)})`,
      ...(memory >= REQUIRED_MEMORY_BYTES ? {} : {
        remediation: 'Free memory or use a machine with at least 4 GiB RAM',
      }),
    });
  }
  return checks;
}

function windowsLinkerCheck(environment) {
  const linker = findExecutable('link', environment);
  if (linker) {
    return {
      id: 'windows-sdk-linker',
      status: 'pass',
      requiredFor: ['desktop'],
      observed: linker,
    };
  }
  const candidates = [
    environment.PT_VSDEVCMD,
    'C:\\BuildTools\\Common7\\Tools\\VsDevCmd.bat',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools\\Common7\\Tools\\VsDevCmd.bat',
  ].filter(Boolean);
  const vsDevCmd = candidates.find((candidate) => fs.existsSync(candidate));
  if (vsDevCmd) {
    return {
      id: 'windows-sdk-linker',
      status: 'pass',
      requiredFor: ['desktop'],
      observed: `${vsDevCmd} (loaded automatically for Desktop)`,
    };
  }
  return {
    id: 'windows-sdk-linker',
    status: 'warn',
    requiredFor: ['desktop'],
    remediation: 'Install Visual Studio Build Tools with the MSVC x64 workload',
  };
}

// resolveProfile throws when the worktree is not registered or no profile is
// active. Doctor treats that as "toolchain only" instead of failing outright,
// so `make doctor` works both before and after profile activation.
function tryResolveProfile(root, environment) {
  try {
    return resolveProfile(root, environment);
  } catch (error) {
    return {
      toolchainOnly: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runDoctor(root, environment = process.env, options = {}) {
  const forcedToolchainOnly = options.toolchainOnly === true;
  const resolved = forcedToolchainOnly
    ? { toolchainOnly: true, reason: 'requested with --toolchain' }
    : tryResolveProfile(root, environment);
  const toolchainOnly = resolved.toolchainOnly === true;
  const runtimeEnv = toolchainOnly
    ? environment
    : runtimeEnvironment(resolved, environment);

  // A remote profile needs neither a local Docker engine nor a local Go
  // toolchain: Desktop talks to the remote Station directly.
  const stationMode = toolchainOnly
    ? 'compose'
    : resolved.profile.PT_STATION_MODE;
  const stationToolsOptional = stationMode === 'remote';

  const checks = [
    toolCheck('git', 'git', ['all'], runtimeEnv),
    toolCheck('make', 'make', ['all'], runtimeEnv),
    toolCheck('node', 'node', ['all'], runtimeEnv),
    toolCheck('pnpm', 'pnpm', ['checks', 'desktop', 'mobile'], runtimeEnv, {
      remediation: 'Enable pnpm via corepack (or run "make dev-up")',
    }),
    toolCheck('python3', 'python3', ['tooling', 'profile-lifecycle'], runtimeEnv),
    toolCheck('go', 'go', ['station'], runtimeEnv, {
      optional: stationToolsOptional,
      remediation: 'Install Go (or run "make dev-up")',
    }),
    toolCheck('protoc', 'protoc', ['station', 'generated-contracts'], runtimeEnv, {
      optional: stationToolsOptional,
      remediation: 'Install protoc (or run "make dev-up")',
    }),
    toolCheck('cargo', 'cargo', ['desktop'], runtimeEnv, {
      optional: true,
      remediation: 'Install Rust via rustup (or run "make dev-up")',
    }),
    toolCheck('rustc', 'rustc', ['desktop'], runtimeEnv, {
      optional: true,
      remediation: 'Install Rust via rustup (or run "make dev-up")',
    }),
    ...dockerChecks(['station'], runtimeEnv, stationToolsOptional),
    ...resourceChecks(root),
  ];

  if (process.platform === 'win32') {
    checks.push(
      windowsLinkerCheck(runtimeEnv),
      toolCheck('clang-cl', 'clang-cl', ['optional-native-node-bindings'], runtimeEnv, {
        optional: true,
        remediation: 'Install the optional ClangCL workload to enable native Node accelerators',
      }),
    );
  }

  if (!toolchainOnly) {
    const profileDirectories = [
      resolved.paths.profileData,
      resolved.paths.profileLogs,
      resolved.paths.profilePids,
      resolved.paths.profileState,
    ];
    for (const directory of profileDirectories) {
      try {
        fs.mkdirSync(directory, { recursive: true });
        fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
        checks.push({
          id: `directory:${path.basename(directory)}`,
          status: 'pass',
          requiredFor: ['runtime'],
          observed: directory,
        });
      } catch (error) {
        checks.push({
          id: `directory:${path.basename(directory)}`,
          status: 'fail',
          requiredFor: ['runtime'],
          observed: directory,
          remediation: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const summary = checks.reduce(
    (result, check) => ({ ...result, [check.status]: result[check.status] + 1 }),
    { pass: 0, warn: 0, fail: 0 },
  );
  return {
    schemaVersion: 2,
    platform: process.platform,
    profile: toolchainOnly ? null : resolved.reference.profileName,
    stationMode: toolchainOnly ? null : stationMode,
    toolchainOnly,
    checks,
    summary,
    os: {
      type: os.type(),
      release: os.release(),
      arch: process.arch,
    },
  };
}

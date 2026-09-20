import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveProfile, runtimeEnvironment } from './profile.mjs';

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.exe', '.cmd', '.bat', ''];

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

function versionOf(executable, args = ['--version'], environment = process.env) {
  if (!executable) {
    return undefined;
  }
  const invocation = process.platform === 'win32' && /\.(cmd|bat)$/iu.test(executable)
    ? {
        command: environment.ComSpec ?? process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', `"${executable}" ${args.join(' ')}`],
      }
    : { command: executable, args };
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    env: environment,
    windowsHide: true,
    timeout: 10_000,
  });
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
      remediation: options.remediation ?? `Install ${command} and add it to PATH`,
    };
  }
  return {
    id,
    status: 'pass',
    requiredFor,
    observed: `${executable} (${versionOf(executable, options.versionArgs, environment) ?? 'version unavailable'})`,
  };
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

export function runDoctor(root, environment = process.env) {
  const resolved = resolveProfile(root, environment);
  const runtimeEnv = runtimeEnvironment(resolved, environment);
  const checks = [
    toolCheck('node', 'node', ['all'], runtimeEnv),
    toolCheck('pnpm', 'pnpm', ['checks', 'desktop'], runtimeEnv),
    toolCheck('go', 'go', ['station'], runtimeEnv),
    toolCheck('cargo', 'cargo', ['desktop'], runtimeEnv),
    toolCheck('rustc', 'rustc', ['desktop'], runtimeEnv),
    toolCheck('protoc', 'protoc', ['station', 'generated-contracts'], runtimeEnv),
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

  const summary = checks.reduce(
    (result, check) => ({ ...result, [check.status]: result[check.status] + 1 }),
    { pass: 0, warn: 0, fail: 0 },
  );
  return {
    schemaVersion: 1,
    platform: process.platform,
    profile: resolved.reference.profileName,
    checks,
    summary,
  };
}

#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks } from './checks.mjs';
import {
  desktopStatus,
  restartDesktop,
  startDesktop,
  stopDesktop,
} from './desktop.mjs';
import { runDoctor } from './doctor.mjs';
import { DevctlError, ERROR_CODES, serializeError } from './errors.mjs';
import {
  activateProfile,
  initializeProfile,
  listProfiles,
  redactProfile,
  resolveProfile,
} from './profile.mjs';
import {
  restartStation,
  startStation,
  stationStatus,
  stopStation,
} from './station.mjs';

function defaultRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new DevctlError(
      ERROR_CODES.PROFILE_INVALID,
      `Option ${name} requires a value`,
    );
  }
  args.splice(index, 2);
  return value;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

function writeJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeHelp() {
  process.stdout.write(`Peers-Touch developer control plane

Usage:
  devctl profile list
  devctl profile init <name> [--slot <n>]
  devctl profile activate <name>
  devctl config [--json]
  devctl doctor [--json]
  devctl check [desktop|all] [--json]
  devctl station start|check|status|stop|restart [--json]
  devctl desktop start|status|stop|restart [--json]
  devctl status [--json]
  devctl stop [station|desktop|all]
  devctl restart [station|desktop|all]

Global options:
  --root <path>   Override repository root (primarily for tests)
`);
}

function formatConfig(resolved) {
  const values = redactProfile(resolved.profile);
  const lines = [
    '',
    'Active Profile',
    '==============',
    `  Worktree: ${resolved.reference.worktreeId}`,
    `  File: ${resolved.reference.resolvedPath}`,
    `  Source: ${resolved.reference.canonical ? 'canonical env repository' : 'local profile'}`,
    '',
    'Configuration:',
    ...Object.entries(values).map(([key, value]) => `  ${key}=${value}`),
    '',
  ];
  return lines.join('\n');
}

function formatDoctor(report) {
  const lines = [
    '',
    `Developer Environment Doctor (${report.platform}, profile=${report.profile})`,
    '================================================================',
  ];
  for (const check of report.checks) {
    const suffix = check.observed ? `: ${check.observed}` : '';
    lines.push(`  [${check.status.toUpperCase()}] ${check.id}${suffix}`);
    if (check.remediation) {
      lines.push(`         ${check.remediation}`);
    }
  }
  lines.push(
    '',
    `Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail`,
    '',
  );
  return lines.join('\n');
}

function writeResult(label, result, json) {
  if (json) {
    writeJson({ ok: true, result });
  } else {
    process.stdout.write(`[OK] ${label}\n`);
  }
}

export async function run(argv = process.argv.slice(2), environment = process.env) {
  const args = [...argv];
  const root = path.resolve(takeOption(args, '--root') ?? defaultRoot());
  const json = takeFlag(args, '--json');
  const [command, subcommand, value] = args;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    writeHelp();
    return 0;
  }

  if (command === 'profile') {
    if (subcommand === 'list') {
      const profiles = listProfiles(root, environment);
      if (json) {
        writeJson({ ok: true, profiles });
      } else {
        process.stdout.write(
          `Available profiles:\n${profiles.map((item) =>
            `  ${item.active ? '*' : ' '} ${item.name}`).join('\n')}\n`,
        );
      }
      return 0;
    }

    if (subcommand === 'activate' && value) {
      const resolved = activateProfile(root, value, environment);
      if (json) {
        writeJson({ ok: true, profile: resolved.reference });
      } else {
        process.stdout.write(
          `[OK] Active profile: ${resolved.reference.profileName} (worktree: ${resolved.reference.worktreeId})\n`,
        );
      }
      return 0;
    }

    if (subcommand === 'init' && value) {
      const slotText = takeOption(args, '--slot') ?? '0';
      const slot = Number(slotText);
      const filePath = initializeProfile(root, value, slot);
      if (json) {
        writeJson({ ok: true, filePath });
      } else {
        process.stdout.write(`[OK] Created profile: ${filePath}\n`);
      }
      return 0;
    }
  }

  if (command === 'config') {
    const resolved = resolveProfile(root, environment);
    if (json) {
      writeJson({
        ok: true,
        profile: resolved.reference,
        configuration: redactProfile(resolved.profile),
      });
    } else {
      process.stdout.write(formatConfig(resolved));
    }
    return 0;
  }

  if (command === 'doctor') {
    const report = runDoctor(root, environment);
    if (json) {
      writeJson({ ok: report.summary.fail === 0, ...report });
    } else {
      process.stdout.write(formatDoctor(report));
    }
    return report.summary.fail === 0 ? 0 : 1;
  }

  if (
    command === 'check'
    && (
      !subcommand
      || [
        'desktop',
        'all',
        'desktop-social-wire',
        'mobile-social-wire',
        'social-runtime-boundaries',
      ].includes(
        subcommand,
      )
    )
  ) {
    const target = subcommand ?? 'all';
    const results = runChecks(root, target);
    if (json) {
      writeJson({ ok: true, results });
    } else {
      for (const result of results) {
        process.stdout.write(`[OK] ${result.name}\n`);
      }
    }
    return 0;
  }

  if (command === 'station') {
    let result;
    if (subcommand === 'start') {
      result = await startStation(root, environment);
    } else if (subcommand === 'check') {
      result = await stationStatus(root, environment);
      if (!result.health.ok) {
        throw new DevctlError(
          ERROR_CODES.START_TIMEOUT,
          `Station is not healthy: ${result.health.url}`,
          result,
        );
      }
    } else if (subcommand === 'status') {
      result = await stationStatus(root, environment);
    } else if (subcommand === 'stop') {
      result = await stopStation(root, environment);
    } else if (subcommand === 'restart') {
      result = await restartStation(root, environment);
    } else {
      throw new DevctlError(
        ERROR_CODES.UNSUPPORTED_MODE,
        `Unsupported Station command: ${subcommand ?? '<missing>'}`,
      );
    }
    writeResult(`station ${subcommand}`, result, json);
    return 0;
  }

  if (command === 'desktop') {
    if (args.length !== 2) {
      throw new DevctlError(
        ERROR_CODES.UNSUPPORTED_MODE,
        `Unexpected Desktop arguments: ${args.slice(2).join(' ')}`,
        { arguments: args.slice(2) },
      );
    }
    let result;
    if (subcommand === 'start') {
      result = await startDesktop(root, environment);
    } else if (subcommand === 'status') {
      result = await desktopStatus(root, environment);
    } else if (subcommand === 'stop') {
      result = await stopDesktop(root, environment);
    } else if (subcommand === 'restart') {
      result = await restartDesktop(root, environment);
    } else {
      throw new DevctlError(
        ERROR_CODES.UNSUPPORTED_MODE,
        `Unsupported Desktop command: ${subcommand ?? '<missing>'}`,
      );
    }
    writeResult(`desktop ${subcommand}`, result, json);
    return 0;
  }

  if (command === 'status') {
    const [station, desktop] = await Promise.all([
      stationStatus(root, environment),
      desktopStatus(root, environment),
    ]);
    writeResult('status', { station, desktop }, json);
    return 0;
  }

  if (command === 'stop') {
    const target = subcommand ?? 'all';
    const result = {};
    if (target === 'station' || target === 'all') {
      result.station = await stopStation(root, environment);
    }
    if (target === 'desktop' || target === 'all') {
      result.desktop = await stopDesktop(root, environment);
    }
    if (!['station', 'desktop', 'all'].includes(target)) {
      throw new DevctlError(
        ERROR_CODES.UNSUPPORTED_MODE,
        `Unsupported stop target: ${target}`,
      );
    }
    writeResult(`stop ${target}`, result, json);
    return 0;
  }

  if (command === 'restart') {
    const target = subcommand ?? 'all';
    const result = {};
    if (target === 'station' || target === 'all') {
      result.station = await restartStation(root, environment);
    }
    if (target === 'desktop' || target === 'all') {
      result.desktop = await restartDesktop(root, environment);
    }
    if (!['station', 'desktop', 'all'].includes(target)) {
      throw new DevctlError(
        ERROR_CODES.UNSUPPORTED_MODE,
        `Unsupported restart target: ${target}`,
      );
    }
    writeResult(`restart ${target}`, result, json);
    return 0;
  }

  throw new DevctlError(
    ERROR_CODES.UNSUPPORTED_MODE,
    `Unsupported command: ${args.join(' ')}`,
    { command, subcommand },
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  run()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      writeJson(serializeError(error), process.stderr);
      process.exitCode = error instanceof DevctlError ? 2 : 1;
    });
}

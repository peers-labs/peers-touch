import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const runtimeInputs = [
  {
    env: 'PEERS_ATELIER_FULL_E2E_STATION_URL',
    purpose: 'real Station base URL used by Desktop Host service binding',
  },
  {
    env: 'PEERS_ATELIER_FULL_E2E_DESKTOP_APP',
    purpose: 'real Desktop app bundle or launch command under test',
  },
  {
    env: 'PEERS_ATELIER_FULL_E2E_IDE',
    purpose: 'real IDE target for atelier.workspace.open native launch proof',
  },
  {
    env: 'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE',
    purpose: 'production provider/model/runtime profile used outside scripted gate server paths',
  },
];

export function parseJsonObject(value, label) {
  const source = value.startsWith('@') ? readFileSync(path.resolve(value.slice(1)), 'utf8') : value;
  const parsed = JSON.parse(source);
  assert.equal(typeof parsed, 'object', `${label} must be a JSON object`);
  assert.notEqual(parsed, null, `${label} must be a JSON object`);
  assert.equal(Array.isArray(parsed), false, `${label} must be a JSON object`);
  return parsed;
}

export function parseProviderProfile(value, label) {
  const profile = parseJsonObject(value, label);
  assert.equal(typeof profile.profileRef, 'string', `${label} must include non-empty profileRef`);
  assert.ok(profile.profileRef.trim(), `${label} must include non-empty profileRef`);
  assert.notEqual(profile.syntheticOnly, true, `${label} must not be syntheticOnly`);
  assert.notEqual(profile.controlledOnly, true, `${label} must not be controlledOnly`);
  assert.notEqual(profile.controlledFixture, true, `${label} must not be controlledFixture`);
  assert.notEqual(profile.evidenceClass, 'CONTROLLED_LOCAL_UPSTREAM', `${label} must not use controlled local evidence class`);
  return profile;
}

export function parseDesktopLaunchSpec(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('cmd:')) {
    const commandText = trimmed.slice('cmd:'.length).trim();
    assert.ok(commandText, 'PEERS_ATELIER_FULL_E2E_DESKTOP_APP cmd: value must include command');
    assert.equal(
      /[;&|`$<>]/.test(commandText),
      false,
      'PEERS_ATELIER_FULL_E2E_DESKTOP_APP cmd: value must not require shell metacharacters',
    );
    const parts = commandText.split(/\s+/).filter(Boolean);
    assert.ok(parts.length > 0, 'PEERS_ATELIER_FULL_E2E_DESKTOP_APP cmd: value must include executable');
    return {
      kind: 'cmd',
      command: parts[0],
      args: parts.slice(1),
      cwd: process.cwd(),
    };
  }

  const executablePath = path.resolve(trimmed);
  assert.ok(existsSync(executablePath), 'PEERS_ATELIER_FULL_E2E_DESKTOP_APP must be an existing path or cmd:<launch command>');
  return {
    kind: 'path',
    command: executablePath,
    args: [],
    cwd: path.dirname(executablePath),
  };
}

export function redactRuntimeInputValues(value, env = process.env) {
  let redacted = String(value);
  const rawValues = runtimeInputs
    .flatMap((input) => {
      const rawValue = env[input.env];
      if (typeof rawValue !== 'string' || rawValue.length === 0) {
        return [];
      }
      const values = [[input.env, rawValue]];
      if (rawValue.startsWith('@') && rawValue.length > 1) {
        values.push([input.env, path.resolve(rawValue.slice(1))]);
      }
      return values;
    })
    .sort(([, left], [, right]) => right.length - left.length);
  for (const [envName, rawValue] of rawValues) {
    redacted = redacted.split(rawValue).join(`[REDACTED_RUNTIME_INPUT:${envName}]`);
  }
  return redacted;
}

export function sanitizeRuntimeInputStatus(status, env = process.env) {
  return {
    env: status.env,
    purpose: status.purpose,
    status: status.status,
    rawValueRedacted: status.status !== 'MISSING',
    ...(status.reason ? { reason: redactRuntimeInputValues(status.reason, env) } : {}),
  };
}

export function validateRuntimeInput(input, env = process.env) {
  const value = env[input.env];
  if (!value) {
    return { ...input, status: 'MISSING' };
  }
  try {
    if (input.env === 'PEERS_ATELIER_FULL_E2E_STATION_URL') {
      const parsed = new URL(value);
      assert.ok(['http:', 'https:'].includes(parsed.protocol), `${input.env} must be http(s)`);
      assert.ok(parsed.hostname, `${input.env} must include hostname`);
      assert.equal(parsed.username, '', `${input.env} must not include username`);
      assert.equal(parsed.password, '', `${input.env} must not include password`);
    } else if (input.env === 'PEERS_ATELIER_FULL_E2E_DESKTOP_APP') {
      parseDesktopLaunchSpec(value);
    } else if (input.env === 'PEERS_ATELIER_FULL_E2E_IDE') {
      assert.ok(value.trim(), `${input.env} must be non-empty`);
    } else if (input.env === 'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE') {
      parseProviderProfile(value, input.env);
    }
    return { ...input, status: 'PRESENT' };
  } catch (error) {
    return {
      ...input,
      status: 'INVALID',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

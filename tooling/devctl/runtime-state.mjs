import fs from 'node:fs';
import path from 'node:path';
import { DevctlError, ERROR_CODES } from './errors.mjs';

const SCHEMA_VERSION = 1;

export function stateFile(stateDirectory, service) {
  return path.join(stateDirectory, `${service}.json`);
}

export function writeRuntimeState(stateDirectory, record) {
  fs.mkdirSync(stateDirectory, { recursive: true });
  const target = stateFile(stateDirectory, record.service);
  const temporary = `${target}.${process.pid}.tmp`;
  const serialized = `${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    ...record,
  }, null, 2)}\n`;
  fs.writeFileSync(temporary, serialized, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return target;
}

export function readRuntimeState(stateDirectory, service) {
  const target = stateFile(stateDirectory, service);
  if (!fs.existsSync(target)) {
    return undefined;
  }

  let record;
  try {
    record = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    throw new DevctlError(
      ERROR_CODES.PROCESS_IDENTITY_MISMATCH,
      `Runtime state is unreadable: ${target}`,
      { target, cause: error instanceof Error ? error.message : String(error) },
    );
  }

  if (
    record.schemaVersion !== SCHEMA_VERSION
    || record.service !== service
    || !Number.isInteger(record.pid)
    || !Array.isArray(record.identityTokens)
  ) {
    throw new DevctlError(
      ERROR_CODES.PROCESS_IDENTITY_MISMATCH,
      `Runtime state has an invalid schema: ${target}`,
      { target, service },
    );
  }
  return record;
}

export function removeRuntimeState(stateDirectory, service) {
  fs.rmSync(stateFile(stateDirectory, service), { force: true });
}

#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONTENT_PREKEY_ERRORS = Object.freeze([
  ['CONTENT_PREKEY_FORBIDDEN', 30201],
  ['CONTENT_PREKEY_INVALID_MATERIAL', 30202],
  ['CONTENT_PREKEY_POOL_NOT_FOUND', 30203],
  ['CONTENT_PREKEY_STALE_EPOCH', 30204],
  ['CONTENT_PREKEY_REPLAY_CONFLICT', 30205],
  ['CONTENT_PREKEY_POOL_DEPLETED', 30206],
  ['CONTENT_PREKEY_PAYLOAD_TOO_LARGE', 30207],
  ['CONTENT_PREKEY_QUOTA_EXCEEDED', 30208],
  ['CONTENT_PREKEY_DEPENDENCY_UNAVAILABLE', 30209],
]);

export const MINIMUM_LOCALE_VERSION = '0.5.6';

function fail(message) {
  throw new Error(`content PreKey error parity: ${message}`);
}

function assertOccurrence(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(`${label} must occur exactly once; found ${matches.length}`);
  }
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function versionTuple(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) fail(`locale metadata version is invalid: ${version}`);
  return match.slice(1).map(Number);
}

function assertMinimumVersion(actual, minimum) {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return;
    if (left[index] < right[index]) {
      fail(`locale metadata version ${actual} is below ${minimum}`);
    }
  }
}

export function validateContentPreKeyErrors({
  protoText,
  goText,
  goMessagesText,
  desktopText,
  mobileText,
  enText,
  zhText,
  metadataText,
}) {
  const en = parseJson(enText, 'English error catalog');
  const zh = parseJson(zhText, 'Chinese error catalog');
  const metadata = parseJson(metadataText, 'locale metadata');

  for (const [name, code] of CONTENT_PREKEY_ERRORS) {
    assertOccurrence(
      protoText,
      new RegExp(`\\bERROR_CODE_${name}\\s*=\\s*${code}\\s*;`, 'g'),
      `proto ${name}`,
    );
    assertOccurrence(
      goText,
      new RegExp(
        `\\bErrorCode_ERROR_CODE_${name}\\s+ErrorCode\\s*=\\s*${code}\\b`,
        'g',
      ),
      `Go ${name}`,
    );
    assertOccurrence(
      goMessagesText,
      new RegExp(
        `\\bErrorCode_ERROR_CODE_${name}\\s*:\\s*"[^"]+"`,
        'g',
      ),
      `Go message ${name}`,
    );
    for (const [label, text] of [
      ['Desktop', desktopText],
      ['Mobile', mobileText],
    ]) {
      assertOccurrence(
        text,
        new RegExp(`\\b${name}\\s*=\\s*${code}\\b`, 'g'),
        `${label} ${name}`,
      );
    }

    const key = `error.${code}`;
    for (const [label, catalog, text] of [
      ['English', en, enText],
      ['Chinese', zh, zhText],
    ]) {
      assertOccurrence(
        text,
        new RegExp(`"${key.replace('.', '\\.')}"\\s*:`, 'g'),
        `${label} ${key}`,
      );
      if (typeof catalog[key] !== 'string' || catalog[key].trim() === '') {
        fail(`${label} ${key} must be a non-empty string`);
      }
    }
  }

  assertMinimumVersion(metadata.version, MINIMUM_LOCALE_VERSION);
  return {
    status: 'PASS',
    errorCount: CONTENT_PREKEY_ERRORS.length,
    localeVersion: metadata.version,
  };
}

export function checkContentPreKeyErrors(projectRoot) {
  const read = (relative) => readFileSync(path.join(projectRoot, relative), 'utf8');
  return validateContentPreKeyErrors({
    protoText: read('model/domain/error/error.proto'),
    goText: read('apps/station/frame/touch/model/error.pb.go'),
    goMessagesText: read('apps/station/frame/touch/model/errors.go'),
    desktopText: read('apps/desktop/src/gen/proto/domain/error/error_pb.ts'),
    mobileText: read('apps/mobile/src/gen/proto/domain/error/error_pb.ts'),
    enText: read('packages/locales/en/errors.json'),
    zhText: read('packages/locales/zh-CN/errors.json'),
    metadataText: read('packages/locales/metadata.json'),
  });
}

export function main() {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  );
  process.stdout.write(`${JSON.stringify(checkContentPreKeyErrors(projectRoot))}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

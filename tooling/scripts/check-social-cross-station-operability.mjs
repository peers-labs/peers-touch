#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_PRIVATE_STATE_KEYS = Object.freeze([
  'AUDIENCE_REQUIRED',
  'CHECKING_PRIVATE_READINESS',
  'CHECKING_REMOTE_READINESS',
  'READY_PRIVATE',
  'PRIVATE_UNSUPPORTED',
  'RECIPIENT_KEY_UNAVAILABLE',
  'AUDIENCE_TOO_LARGE',
  'PUBLISHING',
  'UNKNOWN_COMMIT',
  'PUBLISH_FAILED',
  'LOADING_AUTHORIZED_RESOURCE',
  'WAITING_FOR_PRIVATE_KEY',
  'RECOVERY_REQUIRED',
  'RECOVERY_KEY_UNAVAILABLE',
  'DECRYPTING',
  'AUTHENTICATION_REQUIRED',
  'NOT_FOUND_OR_NOT_AUTHORIZED',
  'INTEGRITY_FAILURE',
  'PRIVATE_UNSUPPORTED_ON_DEVICE',
  'DELETED_OR_REVOKED',
]);

export const REQUIRED_PRIVATE_MEDIA_KEYS = Object.freeze([
  'MEDIA_PLACEHOLDER',
  'MEDIA_GRANT_PENDING',
  'MEDIA_DOWNLOADING',
  'MEDIA_DECRYPTING',
  'MEDIA_READY',
  'MEDIA_ACCESS_DENIED',
  'MEDIA_INTEGRITY_FAILURE',
  'MEDIA_OFFLINE_RETRYABLE',
]);

export const REQUIRED_PRIVATE_REACTION_KEYS = Object.freeze([
  'REACTION_PENDING',
  'REACTION_RETRYING',
  'REACTION_REJECTED',
]);

export const REQUIRED_PRIVATE_REVOCATION_REASONS = Object.freeze([
  'RESOURCE_DELETED',
  'RELATIONSHIP_REVOKED',
  'RECIPIENT_BLOCKED',
]);

export const ALLOWED_METRIC_NAMES = new Set([
  'social_cross_station_delivery_latency_seconds',
  'social_cross_station_delivery_total',
  'social_cross_station_interaction_latency_seconds',
  'social_cross_station_interaction_total',
  'social_cross_station_object_stream_latency_seconds',
  'social_cross_station_object_stream_total',
  'social_cross_station_prekey_claim_latency_seconds',
  'social_cross_station_prekey_claim_total',
  'social_cross_station_reconcile_total',
  'social_cross_station_recovery_total',
  'social_cross_station_replay_total',
  'social_cross_station_revocation_total',
]);

export const ALLOWED_METRIC_LABELS = new Set([
  'operation',
  'outcome',
  'payload_kind',
  'reason',
  'stage',
]);

const SENSITIVE_OBSERVABILITY_TOKENS = [
  'actorptid',
  'ciphertext',
  'contentkey',
  'deviceid',
  'envelope',
  'frameid',
  'commentid',
  'circleid',
  'objectbytes',
  'objectid',
  'payload',
  'postid',
  'privatekey',
  'ptid',
  'recoveryphrase',
  'resourceid',
  'targetstationpeerid',
];

function fail(message) {
  throw new Error(`cross-Station Social operability: ${message}`);
}

function parseJson(text, label) {
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      fail(`${label} root must be an object`);
    }
    return value;
  } catch (error) {
    if (String(error.message).startsWith('cross-Station Social operability:')) {
      throw error;
    }
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function keysWithPrefix(value, prefix) {
  return Object.keys(value)
    .filter((key) => key.startsWith(prefix))
    .sort((left, right) => left.localeCompare(right));
}

function requireLocaleKey(locale, label, key) {
  if (typeof locale[key] !== 'string' || locale[key].trim() === '') {
    fail(`${label} ${key} must be a non-empty string`);
  }
}

function requireExactOccurrence(text, pattern, label) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(`${label} must occur exactly once; found ${matches.length}`);
  }
}

function requireOccurrence(text, pattern, label) {
  if (!pattern.test(text)) {
    fail(`${label} is missing`);
  }
}

export function validateMetricDescriptors(
  descriptors,
  { requireComplete = true } = {},
) {
  const names = new Set(descriptors.map((descriptor) => descriptor.name));
  if (requireComplete) {
    const missing = [...ALLOWED_METRIC_NAMES]
      .filter((name) => !names.has(name));
    if (missing.length > 0) {
      fail(`required metrics are missing: ${missing.join(', ')}`);
    }
  }
  for (const descriptor of descriptors) {
    if (!ALLOWED_METRIC_NAMES.has(descriptor.name)) {
      fail(`metric ${descriptor.name} is not allowlisted`);
    }
    const expectedSuffix = descriptor.kind === 'histogram' ? '_seconds' : '_total';
    if (!descriptor.name.endsWith(expectedSuffix)) {
      fail(`metric ${descriptor.name} has an invalid ${descriptor.kind} suffix`);
    }
    const labels = [...descriptor.labels];
    if (
      labels.length !== new Set(labels).size
      || labels.some((label) => !ALLOWED_METRIC_LABELS.has(label))
    ) {
      fail(`metric ${descriptor.name} has unbounded or duplicate labels`);
    }
    const expectedObjectStreamLabels = {
      social_cross_station_object_stream_latency_seconds: ['stage', 'outcome'],
      social_cross_station_object_stream_total: ['stage', 'outcome', 'reason'],
    }[descriptor.name];
    if (
      expectedObjectStreamLabels
      && JSON.stringify(labels) !== JSON.stringify(expectedObjectStreamLabels)
    ) {
      fail(
        `metric ${descriptor.name} labels must be `
        + expectedObjectStreamLabels.join(', '),
      );
    }
  }
}

function extractMetricDescriptors(texts) {
  const constants = new Map();
  const descriptors = [];
  for (const text of texts) {
    for (
      const match of text.matchAll(
        /\b([A-Za-z][A-Za-z0-9_]*)\s*=\s*"(social_cross_station_[a-z0-9_]+)"/gu,
      )
    ) {
      constants.set(match[1], match[2]);
    }
  }
  for (const text of texts) {
    const pattern = /\.(Counter|Histogram)\(\s*("(?:social_cross_station_[a-z0-9_]+)"|[A-Za-z][A-Za-z0-9_]*)\s*,\s*"[^"]*"([\s\S]*?)\)/gu;
    for (const match of text.matchAll(pattern)) {
      const name = match[2].startsWith('"')
        ? match[2].slice(1, -1)
        : constants.get(match[2]);
      if (!name?.startsWith('social_cross_station_')) continue;
      const labels = [...match[3].matchAll(/"([a-z][a-z0-9_]*)"/gu)]
        .map((label) => label[1]);
      descriptors.push({
        kind: match[1] === 'Histogram' ? 'histogram' : 'counter',
        name,
        labels,
      });
    }
    for (const match of text.matchAll(/"social_cross_station_[a-z0-9_]+"/gu)) {
      const name = match[0].slice(1, -1);
      if (!descriptors.some((descriptor) => descriptor.name === name)) {
        fail(`metric ${name} is not declared through Counter or Histogram`);
      }
    }
  }
  return descriptors;
}

function loggingCalls(text) {
  const calls = [];
  const startPattern = /(?:\blog\.|\blogger\.|\bconsole\.|\bfmt\.Print)[A-Za-z]*\s*\(/gu;
  for (const match of text.matchAll(startPattern)) {
    let depth = 1;
    let quote = '';
    let escaped = false;
    let index = match.index + match[0].length;
    for (; index < text.length && depth > 0; index += 1) {
      const character = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote) {
        if (character === '\\') {
          escaped = true;
        } else if (character === quote) {
          quote = '';
        }
        continue;
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
      }
    }
    calls.push(text.slice(match.index, index));
  }
  return calls;
}

function validatePrivacySafeLogs(texts) {
  for (const text of texts) {
    if (/debug-point|https?:\/\/10\.\d+\.\d+\.\d+/iu.test(text)) {
      fail('debug transport or hard-coded private telemetry endpoint is present');
    }
    for (const call of loggingCalls(text)) {
      const normalized = call.replaceAll('_', '').toLowerCase();
      const sensitive = SENSITIVE_OBSERVABILITY_TOKENS.find(
        (token) => normalized.includes(token),
      );
      if (sensitive) {
        fail(`privacy-bearing log field is present: ${sensitive}`);
      }
    }
  }
}

function validateObjectStreamMetricContract(helperText, usageTexts) {
  for (const value of [
    'recipient_proxy',
    'source_read',
    'accepted',
    'rejected',
    'interrupted',
    'retryable',
    'none',
    'not_found',
    'range_invalid',
    'integrity',
    'dependency',
    'cancelled',
  ]) {
    requireOccurrence(
      helperText,
      new RegExp(`= "${value}"`, 'gu'),
      `typed private-object metric value ${value}`,
    );
  }
  for (const fragment of [
    'validFederatedPrivateObjectStreamObservation(stage, outcome, reason)',
    'm.total.Inc(string(stage), string(outcome), string(reason))',
    'string(stage),',
    'string(outcome),',
  ]) {
    if (!helperText.includes(fragment)) {
      fail(`private-object metric helper is missing ${fragment}`);
    }
  }
  if (!helperText.includes('panic(')) {
    fail('private-object metric helper does not fail closed on an invalid tuple');
  }
  for (const text of usageTexts) {
    if (/streamMetrics\.(?:total|latency)\.(?:Inc|Observe)\s*\(/gu.test(text)) {
      fail('private-object metrics are called directly outside the validated helper');
    }
  }
}

export function validateSocialCrossStationOperability({
  enMomentsText,
  zhMomentsText,
  enErrorsText,
  zhErrorsText,
  errorProtoText,
  errorGoText,
  desktopErrorText,
  mobileErrorText,
  errorResolverText,
  privateNativeText,
  privateRevocationText,
  objectStreamMetricText,
  objectStreamUsageTexts = [],
  metricTexts = [],
  logTexts = [],
}) {
  const enMoments = parseJson(enMomentsText, 'English Moments locale');
  const zhMoments = parseJson(zhMomentsText, 'Chinese Moments locale');
  const enErrors = parseJson(enErrorsText, 'English error locale');
  const zhErrors = parseJson(zhErrorsText, 'Chinese error locale');

  for (const prefix of [
    'moments.private.state.',
    'moments.private.media.',
    'moments.reaction.status.',
    'moments.private.revocation.',
  ]) {
    const enKeys = keysWithPrefix(enMoments, prefix);
    const zhKeys = keysWithPrefix(zhMoments, prefix);
    if (JSON.stringify(enKeys) !== JSON.stringify(zhKeys)) {
      fail(`${prefix} locale parity mismatch`);
    }
    for (const key of enKeys) {
      requireLocaleKey(enMoments, 'English', key);
      requireLocaleKey(zhMoments, 'Chinese', key);
    }
  }

  for (const state of REQUIRED_PRIVATE_STATE_KEYS) {
    requireOccurrence(
      privateNativeText,
      new RegExp(`'${state}'`, 'gu'),
      `typed private state ${state}`,
    );
    requireLocaleKey(enMoments, 'English', `moments.private.state.${state}.title`);
    requireLocaleKey(
      enMoments,
      'English',
      `moments.private.state.${state}.description`,
    );
    requireLocaleKey(zhMoments, 'Chinese', `moments.private.state.${state}.title`);
    requireLocaleKey(
      zhMoments,
      'Chinese',
      `moments.private.state.${state}.description`,
    );
  }
  for (const state of REQUIRED_PRIVATE_MEDIA_KEYS) {
    requireOccurrence(
      privateNativeText,
      new RegExp(`'${state}'`, 'gu'),
      `typed private media state ${state}`,
    );
    requireLocaleKey(enMoments, 'English', `moments.private.media.${state}`);
    requireLocaleKey(zhMoments, 'Chinese', `moments.private.media.${state}`);
  }
  for (const state of REQUIRED_PRIVATE_REACTION_KEYS) {
    requireOccurrence(
      privateNativeText,
      new RegExp(`'${state}'`, 'gu'),
      `typed private Reaction state ${state}`,
    );
    requireLocaleKey(enMoments, 'English', `moments.reaction.status.${state}`);
    requireLocaleKey(zhMoments, 'Chinese', `moments.reaction.status.${state}`);
  }
  for (const key of ['moments.reaction.retry', 'moments.reaction.retryUnavailable']) {
    requireLocaleKey(enMoments, 'English', key);
    requireLocaleKey(zhMoments, 'Chinese', key);
  }
  for (const reason of REQUIRED_PRIVATE_REVOCATION_REASONS) {
    requireOccurrence(
      privateRevocationText,
      new RegExp(`'${reason}'`, 'gu'),
      `typed private revocation reason ${reason}`,
    );
    requireLocaleKey(
      enMoments,
      'English',
      `moments.private.revocation.${reason}.title`,
    );
    requireLocaleKey(
      enMoments,
      'English',
      `moments.private.revocation.${reason}.description`,
    );
    requireLocaleKey(
      zhMoments,
      'Chinese',
      `moments.private.revocation.${reason}.title`,
    );
    requireLocaleKey(
      zhMoments,
      'Chinese',
      `moments.private.revocation.${reason}.description`,
    );
  }
  for (const marker of [
    'eventBus.publish(EVENT.MOMENT_REVOKED',
    'eventBus.subscribe(EVENT.MOMENT_REVOKED',
    'unknown-private-revocation',
  ]) {
    requireOccurrence(
      privateRevocationText,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu'),
      `private revocation EventBus marker ${marker}`,
    );
  }

  const errorPattern = /ERROR_CODE_((?:CONTENT_PREKEY|SOCIAL_PRIVATE|FEDERATED_SOCIAL)_[A-Z0-9_]+)\s*=\s*(\d+)\s*;/gu;
  const errors = [...errorProtoText.matchAll(errorPattern)];
  if (errors.length === 0) {
    fail('no typed Social or Content PreKey errors were found');
  }
  for (const [, name, code] of errors) {
    requireExactOccurrence(
      errorGoText,
      new RegExp(`ErrorCode_ERROR_CODE_${name}\\s+ErrorCode\\s*=\\s*${code}\\b`, 'gu'),
      `Go error ${name}`,
    );
    for (const [label, text] of [
      ['Desktop', desktopErrorText],
      ['Mobile', mobileErrorText],
    ]) {
      requireExactOccurrence(
        text,
        new RegExp(`\\b${name}\\s*=\\s*${code}\\b`, 'gu'),
        `${label} error ${name}`,
      );
    }
    const localeKey = `error.${code}`;
    requireLocaleKey(enErrors, 'English', localeKey);
    requireLocaleKey(zhErrors, 'Chinese', localeKey);
  }
  if (
    !errorResolverText.includes('const key = `error.${code}`')
    || !privateNativeText.includes('error_code ?? value.errorCode')
  ) {
    fail('typed Social errors are not connected to the shared error mapping');
  }

  const metricDescriptors = extractMetricDescriptors(metricTexts);
  validateMetricDescriptors(metricDescriptors);
  validateObjectStreamMetricContract(
    objectStreamMetricText,
    objectStreamUsageTexts,
  );
  validatePrivacySafeLogs(logTexts);
  return {
    status: 'PASS',
    localeKeyCount: keysWithPrefix(enMoments, 'moments.private.').length,
    typedErrorCount: errors.length,
    metricCount: metricDescriptors.length,
    privacyFilesChecked: logTexts.length,
  };
}

function filesUnder(root, relative) {
  const directory = path.join(root, relative);
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...filesUnder(root, path.join(relative, entry.name)));
    } else if (entry.isFile() && /\.(?:go|rs|ts|tsx)$/u.test(entry.name)) {
      result.push(absolute);
    }
  }
  return result;
}

export function checkSocialCrossStationOperability(projectRoot) {
  const read = (relative) => fs.readFileSync(path.join(projectRoot, relative), 'utf8');
  const objectStreamMetricPath =
    'apps/station/app/subserver/social/application/federated_private_object_metrics.go';
  const stationFiles = [
    ...filesUnder(projectRoot, 'apps/station/app/subserver/social'),
    ...filesUnder(projectRoot, 'apps/station/frame/core/federation'),
  ];
  return validateSocialCrossStationOperability({
    enMomentsText: read('packages/locales/en/moments.json'),
    zhMomentsText: read('packages/locales/zh-CN/moments.json'),
    enErrorsText: read('packages/locales/en/errors.json'),
    zhErrorsText: read('packages/locales/zh-CN/errors.json'),
    errorProtoText: read('model/domain/error/error.proto'),
    errorGoText: read('apps/station/frame/touch/model/error.pb.go'),
    desktopErrorText: read('apps/desktop/src/gen/proto/domain/error/error_pb.ts'),
    mobileErrorText: read('apps/mobile/src/gen/proto/domain/error/error_pb.ts'),
    errorResolverText: read('apps/desktop/src/i18n/error-resolver.ts'),
    privateNativeText: read('apps/desktop/src/services/privateMomentsNative.ts'),
    privateRevocationText: [
      read('apps/desktop/src/kernel/events/types.ts'),
      read('apps/desktop/src/services/eventStream.ts'),
      read('apps/desktop/src/runtimes/momentsRuntime.ts'),
      read('apps/desktop/src/store/privateMoments.ts'),
    ].join('\n'),
    objectStreamMetricText: read(objectStreamMetricPath),
    objectStreamUsageTexts: stationFiles
      .filter((file) => file !== path.join(projectRoot, objectStreamMetricPath))
      .map((file) => fs.readFileSync(file, 'utf8')),
    metricTexts: stationFiles.map((file) => fs.readFileSync(file, 'utf8')),
    logTexts: stationFiles.map((file) => fs.readFileSync(file, 'utf8')),
  });
}

export function main() {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  );
  process.stdout.write(
    `${JSON.stringify(checkSocialCrossStationOperability(projectRoot))}\n`,
  );
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

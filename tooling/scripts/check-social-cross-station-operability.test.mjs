import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_METRIC_NAMES,
  REQUIRED_PRIVATE_MEDIA_KEYS,
  REQUIRED_PRIVATE_STATE_KEYS,
  validateMetricDescriptors,
  validateSocialCrossStationOperability,
} from './check-social-cross-station-operability.mjs';

const ERROR_ENTRIES = [
  ['CONTENT_PREKEY_FORBIDDEN', 30201],
  ['CONTENT_PREKEY_DEPENDENCY_UNAVAILABLE', 30209],
];

function locale(prefixes = {}) {
  return {
    ...Object.fromEntries(
      REQUIRED_PRIVATE_STATE_KEYS.flatMap((state) => [
        [`moments.private.state.${state}.title`, `${state} title`],
        [`moments.private.state.${state}.description`, `${state} description`],
      ]),
    ),
    ...Object.fromEntries(
      REQUIRED_PRIVATE_MEDIA_KEYS.map((state) => [
        `moments.private.media.${state}`,
        `${state} label`,
      ]),
    ),
    ...prefixes,
  };
}

function fixture(overrides = {}) {
  const errors = Object.fromEntries(
    ERROR_ENTRIES.map(([, code]) => [`error.${code}`, `message ${code}`]),
  );
  return {
    enMomentsText: JSON.stringify(locale()),
    zhMomentsText: JSON.stringify(locale()),
    enErrorsText: JSON.stringify(errors),
    zhErrorsText: JSON.stringify(errors),
    errorProtoText: ERROR_ENTRIES.map(
      ([name, code]) => `ERROR_CODE_${name} = ${code};`,
    ).join('\n'),
    errorGoText: ERROR_ENTRIES.map(
      ([name, code]) => `ErrorCode_ERROR_CODE_${name} ErrorCode = ${code}`,
    ).join('\n'),
    desktopErrorText: ERROR_ENTRIES.map(
      ([name, code]) => `${name} = ${code},`,
    ).join('\n'),
    mobileErrorText: ERROR_ENTRIES.map(
      ([name, code]) => `${name} = ${code},`,
    ).join('\n'),
    errorResolverText: 'const key = `error.${code}`;',
    privateNativeText: [
      ...REQUIRED_PRIVATE_STATE_KEYS.map((state) => `'${state}'`),
      ...REQUIRED_PRIVATE_MEDIA_KEYS.map((state) => `'${state}'`),
      'error_code ?? value.errorCode',
    ].join('\n'),
    objectStreamMetricText: [
      'stageRecipient = "recipient_proxy"',
      'stageSource = "source_read"',
      'outcomeAccepted = "accepted"',
      'outcomeRejected = "rejected"',
      'outcomeInterrupted = "interrupted"',
      'outcomeRetryable = "retryable"',
      'reasonNone = "none"',
      'reasonNotFound = "not_found"',
      'reasonRangeInvalid = "range_invalid"',
      'reasonIntegrity = "integrity"',
      'reasonDependency = "dependency"',
      'reasonCancelled = "cancelled"',
      'if !validFederatedPrivateObjectStreamObservation(stage, outcome, reason) {',
      '  panic("invalid")',
      '}',
      'm.total.Inc(string(stage), string(outcome), string(reason))',
      'm.latency.Observe(1, string(stage), string(outcome),)',
    ].join('\n'),
    metricTexts: [[...ALLOWED_METRIC_NAMES].map((name) => {
      if (name === 'social_cross_station_object_stream_latency_seconds') {
        return `metrics.Get().Histogram("${name}", "Latency histogram", []float64{1}, "stage", "outcome")`;
      }
      if (name === 'social_cross_station_object_stream_total') {
        return `metrics.Get().Counter("${name}", "Transition counter", "stage", "outcome", "reason")`;
      }
      return name.endsWith('_seconds')
        ? `metrics.Get().Histogram("${name}", "Latency histogram", []float64{1}, "stage")`
        : `metrics.Get().Counter("${name}", "Transition counter", "outcome")`;
    }).join('\n')],
    logTexts: ['log.Infof(ctx, "[social] delivery completed")'],
    ...overrides,
  };
}

test('accepts locale, typed error, metric, and privacy contracts', () => {
  const result = validateSocialCrossStationOperability(fixture());
  assert.equal(result.status, 'PASS');
  assert.equal(result.typedErrorCount, 2);
  assert.equal(result.metricCount, ALLOWED_METRIC_NAMES.size);
});

test('rejects locale parity and missing typed state mapping', () => {
  const values = fixture();
  const zh = locale();
  delete zh['moments.private.state.RECIPIENT_KEY_UNAVAILABLE.title'];
  assert.throws(
    () => validateSocialCrossStationOperability({
      ...values,
      zhMomentsText: JSON.stringify(zh),
    }),
    /locale parity mismatch/,
  );
  assert.throws(
    () => validateSocialCrossStationOperability({
      ...values,
      privateNativeText: values.privateNativeText.replace(
        "'UNKNOWN_COMMIT'",
        '',
      ),
    }),
    /typed private state UNKNOWN_COMMIT is missing/,
  );
});

test('rejects typed error parity drift', () => {
  const values = fixture();
  assert.throws(
    () => validateSocialCrossStationOperability({
      ...values,
      desktopErrorText: values.desktopErrorText.replace(
        'CONTENT_PREKEY_FORBIDDEN = 30201',
        'CONTENT_PREKEY_FORBIDDEN = 39999',
      ),
    }),
    /Desktop error CONTENT_PREKEY_FORBIDDEN/,
  );
});

test('rejects unbounded metric names and labels', () => {
  assert.throws(
    () => validateMetricDescriptors([]),
    /required metrics are missing/,
  );
  assert.throws(
    () => validateMetricDescriptors([
      {
        kind: 'counter',
        name: 'social_cross_station_actor_total',
        labels: ['actor_ptid'],
      },
    ], { requireComplete: false }),
    /not allowlisted/,
  );
  assert.throws(
    () => validateMetricDescriptors([
      {
        kind: 'counter',
        name: 'social_cross_station_delivery_total',
        labels: ['actor_ptid'],
      },
    ], { requireComplete: false }),
    /unbounded or duplicate labels/,
  );
  assert.throws(
    () => validateMetricDescriptors([
      {
        kind: 'counter',
        name: 'social_cross_station_object_stream_total',
        labels: ['outcome', 'reason'],
      },
    ], { requireComplete: false }),
    /labels must be stage, outcome, reason/,
  );
});

test('rejects direct private-object metric calls outside the validated helper', () => {
  const values = fixture();
  assert.throws(
    () => validateSocialCrossStationOperability({
      ...values,
      objectStreamUsageTexts: [
        'service.streamMetrics.total.Inc(stage, outcome, reason)',
      ],
    }),
    /called directly outside the validated helper/,
  );
});

test('rejects privacy-bearing logs and debug endpoints', () => {
  const values = fixture();
  assert.throws(
    () => validateSocialCrossStationOperability({
      ...values,
      logTexts: ['log.Warnf(ctx, "frameId=%s", frameID)'],
    }),
    /privacy-bearing log field/,
  );
  assert.throws(
    () => validateSocialCrossStationOperability({
      ...values,
      logTexts: ['logger.warn("delivery", { actor_ptid: actor })'],
    }),
    /privacy-bearing log field/,
  );
  assert.throws(
    () => validateSocialCrossStationOperability({
      ...values,
      logTexts: [
        [
          'logger.Warn(',
          '  ctx,',
          '  "delivery failed",',
          '  "payload",',
          '  body,',
          ')',
        ].join('\n'),
      ],
    }),
    /privacy-bearing log field/,
  );
  for (const field of ['author_ptid', 'owner_ptid', 'target_ptid']) {
    assert.throws(
      () => validateSocialCrossStationOperability({
        ...values,
        logTexts: [`logger.Info(ctx, "event", "${field}", value)`],
      }),
      /privacy-bearing log field/,
    );
  }
  assert.throws(
    () => validateSocialCrossStationOperability({
      ...values,
      logTexts: ['http.Post("http://10.0.0.31:7784/event")'],
    }),
    /hard-coded private telemetry endpoint/,
  );
});

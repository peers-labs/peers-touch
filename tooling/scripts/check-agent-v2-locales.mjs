#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ERROR_LOCALE_KEYS = Object.freeze([
  'agent.errors.queueFull',
  'agent.errors.duplicateConflict',
  'agent.errors.activeMutationConflict',
  'agent.errors.forbiddenActor',
  'agent.errors.unauthorizedResource',
  'agent.errors.runtimeUnavailable',
  'agent.errors.incompatibleCapability',
  'agent.errors.resumeUnavailable',
  'agent.errors.executorUnavailable',
  'agent.errors.clientLeaseExpired',
  'agent.errors.clientPermissionDenied',
  'agent.errors.targetDisconnected',
  'agent.errors.invalidResourceReference',
  'agent.errors.providerCredentialMissing',
  'agent.errors.providerRateLimit',
  'agent.errors.providerModelUnavailable',
  'agent.errors.providerTimeout',
  'agent.errors.contextOverflow',
  'agent.errors.contextInvalidReference',
  'agent.errors.attachmentRejected',
  'agent.errors.toolUnknown',
  'agent.errors.toolUnknownSideEffect',
  'agent.errors.toolApprovalDenied',
  'agent.errors.toolApprovalExpired',
  'agent.errors.toolLoopBudgetExhausted',
  'agent.errors.lifecycleCancelled',
  'agent.errors.lifecycleInterrupted',
  'agent.errors.lifecycleStaleVersion',
  'agent.errors.lifecycleTerminalMutation',
  'agent.errors.homeProjectionStale',
  'agent.errors.homeSliceUnavailable',
  'agent.errors.homeReadinessUnresolved',
  'agent.errors.capabilityManifestMissing',
  'agent.errors.capabilityManifestNotFound',
  'agent.errors.capabilityManifestVersionStale',
  'agent.errors.capabilityManifestSchemaInvalid',
  'agent.errors.capabilityBindingVersionConflict',
  'agent.errors.capabilityUnavailable',
  'agent.errors.capabilityPolicyInvalid',
  'agent.errors.capabilityExecutorUnavailable',
  'agent.errors.capabilityLeaseExpired',
  'agent.errors.capabilityCancelled',
  'agent.errors.capabilityTimeout',
  'agent.errors.capabilityDisconnected',
  'agent.errors.capabilityCleanupFailed',
  'agent.errors.capabilityUnknownSideEffect',
  'agent.errors.capabilityStaleFence',
  'agent.errors.connectorOAuthExpired',
  'agent.errors.connectorScopeDenied',
  'agent.errors.connectorResourceRemoved',
  'agent.errors.connectorManifestStale',
  'agent.errors.connectorDisconnected',
  'agent.errors.connectorProviderRevoked',
  'agent.errors.connectorRevocationUnconfirmed',
  'agent.errors.evaluationDatasetRevisionConflict',
  'agent.errors.evaluationTargetSnapshotInvalid',
  'agent.errors.evaluationRunNotCancellable',
  'agent.errors.evaluationCaseRetryConflict',
  'agent.errors.evaluationEvaluatorUnavailable',
  'agent.errors.evaluationIdempotencyConflict',
  'agent.errors.evaluationCancelAckTimeout',
  'agent.errors.evaluationBenchmarkRevisionConflict',
  'agent.errors.evaluationTestCaseRevisionConflict',
  'agent.errors.evaluationRetentionConflict',
  'agent.errors.evaluationFailed',
  'agent.errors.canvasSingleAgentNotReady',
]);

export const RECOVERY_ACTION_IDS = Object.freeze([
  'editQueue',
  'openOriginal',
  'reloadLatest',
  'switchAccount',
  'removeResource',
  'selectRuntime',
  'chooseCompatibleModel',
  'confirmReset',
  'reconnectExecutor',
  'reconcile',
  'openPermissionSettings',
  'reconnect',
  'chooseResourceAgain',
  'configureCredential',
  'retryLater',
  'chooseModel',
  'retry',
  'reduceContext',
  'removeReference',
  'removeAttachment',
  'chooseTool',
  'continueWithoutTool',
  'requestAgain',
  'inspectBudget',
  'recover',
  'openResult',
  'retryUnavailableSlice',
  'resolveReadiness',
  'chooseManifest',
  'editSchema',
  'reloadAndReapply',
  'selectCompatibleTarget',
  'correctPolicy',
  'reconcileOrTakeOver',
  'retryAsNewOperation',
  'openManualRecovery',
  'openSideEffectReview',
  'reconnectOAuth',
  'reauthorizeScopes',
  'chooseResource',
  'resyncAndRebind',
  'reloadDataset',
  'reselectTarget',
  'openTerminalResults',
  'openExistingChildOrUseNewKey',
  'retryWhenEvaluatorReady',
]);

export const STABLE_ERROR_CODES = Object.freeze([
  'ADMISSION_QUEUE_FULL',
  'ADMISSION_DUPLICATE_CONFLICT',
  'ADMISSION_ACTIVE_MUTATION_CONFLICT',
  'OWNERSHIP_FORBIDDEN_ACTOR',
  'OWNERSHIP_UNAUTHORIZED_RESOURCE',
  'RUNTIME_UNAVAILABLE',
  'RUNTIME_INCOMPATIBLE_CAPABILITY',
  'RUNTIME_RESUME_UNAVAILABLE',
  'CLIENT_EXECUTOR_UNAVAILABLE',
  'CLIENT_LEASE_EXPIRED',
  'CLIENT_PERMISSION_DENIED',
  'CLIENT_TARGET_DISCONNECTED',
  'CLIENT_INVALID_RESOURCE_REFERENCE',
  'PROVIDER_CREDENTIAL_MISSING',
  'PROVIDER_RATE_LIMIT',
  'PROVIDER_MODEL_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'CONTEXT_OVERFLOW',
  'CONTEXT_INVALID_REFERENCE',
  'CONTEXT_ATTACHMENT_REJECTED',
  'TOOL_UNKNOWN',
  'TOOL_UNKNOWN_SIDE_EFFECT',
  'TOOL_APPROVAL_DENIED',
  'TOOL_APPROVAL_EXPIRED',
  'TOOL_LOOP_BUDGET_EXHAUSTED',
  'LIFECYCLE_CANCELLED',
  'LIFECYCLE_INTERRUPTED',
  'LIFECYCLE_STALE_VERSION',
  'LIFECYCLE_TERMINAL_MUTATION',
  'HOME_PROJECTION_STALE',
  'HOME_SLICE_UNAVAILABLE',
  'HOME_READINESS_UNRESOLVED',
  'CAPABILITY_MANIFEST_NOT_FOUND',
  'CAPABILITY_MANIFEST_VERSION_STALE',
  'CAPABILITY_MANIFEST_SCHEMA_INVALID',
  'CAPABILITY_BINDING_VERSION_CONFLICT',
  'CAPABILITY_UNAVAILABLE',
  'CAPABILITY_POLICY_INVALID',
  'CAPABILITY_EXECUTOR_UNAVAILABLE',
  'CAPABILITY_LEASE_EXPIRED',
  'CAPABILITY_CANCELLED',
  'CAPABILITY_TIMEOUT',
  'CAPABILITY_DISCONNECTED',
  'CAPABILITY_CLEANUP_FAILED',
  'CAPABILITY_UNKNOWN_SIDE_EFFECT',
  'CAPABILITY_STALE_FENCE',
  'CONNECTOR_OAUTH_EXPIRED',
  'CONNECTOR_SCOPE_DENIED',
  'CONNECTOR_RESOURCE_REMOVED',
  'CONNECTOR_MANIFEST_STALE',
  'CONNECTOR_DISCONNECTED',
  'CONNECTOR_PROVIDER_REVOKED',
  'CONNECTOR_REVOCATION_UNCONFIRMED',
  'EVALUATION_DATASET_REVISION_CONFLICT',
  'EVALUATION_TARGET_SNAPSHOT_INVALID',
  'EVALUATION_RUN_NOT_CANCELLABLE',
  'EVALUATION_CASE_RETRY_CONFLICT',
  'EVALUATION_EVALUATOR_UNAVAILABLE',
  'EVALUATION_IDEMPOTENCY_CONFLICT',
  'EVALUATION_CANCEL_ACK_TIMEOUT',
  'EVALUATION_BENCHMARK_REVISION_CONFLICT',
  'EVALUATION_TEST_CASE_REVISION_CONFLICT',
  'EVALUATION_RETENTION_CONFLICT',
  'EVALUATION_FAILED',
  'AGENT_CANVAS_SINGLE_AGENT_NOT_READY',
]);

// These roots are the source-backed receiver surfaces that can render Agent
// failures. Stable codes belong in contracts and mappings, never in UI copy.
export const RECEIVER_SOURCE_ROOTS = Object.freeze([
  'apps/desktop/src/components',
  'apps/desktop/src/pages',
  'apps/mobile/src/components',
  'apps/mobile/src/features/chat',
  'apps/mobile/src/pages',
]);

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const RECOVERY_LOCALE_KEYS = RECOVERY_ACTION_IDS.map((id) => `agent.recovery.${id}`);

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function difference(left, right) {
  const rightSet = new Set(right);
  return sorted(left.filter((value) => !rightSet.has(value)));
}

function withoutDebugPointRegions(content) {
  return content.replace(
    /^\s*\/\/ #region debug-point\b[\s\S]*?^\s*\/\/ #endregion[^\n]*$/gm,
    '',
  );
}

export function parseLocale(text, label) {
  let locale;
  try {
    locale = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: invalid JSON: ${error.message}`);
  }
  if (!locale || Array.isArray(locale) || typeof locale !== 'object') {
    throw new Error(`${label}: locale root must be an object`);
  }

  const keyMatches = [...text.matchAll(/^\s*"((?:\\.|[^"\\])*)"\s*:/gm)];
  const keys = keyMatches.map((match) => JSON.parse(`"${match[1]}"`));
  const duplicates = sorted(keys.filter((key, index) => keys.indexOf(key) !== index));
  if (duplicates.length > 0) {
    throw new Error(`${label}: duplicate keys: ${[...new Set(duplicates)].join(', ')}`);
  }
  if (keys.length !== Object.keys(locale).length) {
    throw new Error(`${label}: locale must be a flat object with string keys`);
  }
  return locale;
}

function requireExactKeyset(locale, label, prefix, expected) {
  const actual = Object.keys(locale).filter((key) => key.startsWith(prefix));
  const missing = difference(expected, actual);
  const extra = difference(actual, expected);
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label}: ${prefix} keyset mismatch; missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`,
    );
  }
}

export function validateLocaleTexts({ enText, zhText, sourceFiles = [] }) {
  const en = parseLocale(enText, 'packages/locales/en/agent.json');
  const zh = parseLocale(zhText, 'packages/locales/zh-CN/agent.json');
  const enKeys = Object.keys(en);
  const zhKeys = Object.keys(zh);
  const missingInZh = difference(enKeys, zhKeys);
  const missingInEn = difference(zhKeys, enKeys);
  if (missingInZh.length > 0 || missingInEn.length > 0) {
    throw new Error(
      `Agent locale parity mismatch; missingInZh=[${missingInZh.join(', ')}] missingInEn=[${missingInEn.join(', ')}]`,
    );
  }

  for (const [label, locale] of [['en', en], ['zh-CN', zh]]) {
    for (const [key, value] of Object.entries(locale)) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${label}: ${key} must be a non-empty string`);
      }
      const leakedCode = STABLE_ERROR_CODES.find((code) => value.includes(code));
      if (leakedCode) {
        throw new Error(`${label}: ${key} exposes stable code ${leakedCode} as user copy`);
      }
    }
    requireExactKeyset(locale, label, 'agent.errors.', ERROR_LOCALE_KEYS);
    requireExactKeyset(locale, label, 'agent.recovery.', RECOVERY_LOCALE_KEYS);
  }

  for (const { file, content } of sourceFiles) {
    const receiverCopySource = withoutDebugPointRegions(content);
    const leakedCode = STABLE_ERROR_CODES.find(
      (code) => receiverCopySource.includes(code),
    );
    if (leakedCode) {
      throw new Error(`${file}: receiver source hardcodes stable code ${leakedCode} as user copy`);
    }
  }

  return {
    localeKeyCount: enKeys.length,
    errorKeyCount: ERROR_LOCALE_KEYS.length,
    recoveryKeyCount: RECOVERY_LOCALE_KEYS.length,
    receiverSourceCount: sourceFiles.length,
  };
}

async function collectSourceFiles(repoRoot) {
  const files = [];
  async function visit(relativePath) {
    const absolutePath = path.join(repoRoot, relativePath);
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const child = path.join(relativePath, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push({
          file: child,
          content: await fs.readFile(path.join(repoRoot, child), 'utf8'),
        });
      }
    }
  }
  for (const root of RECEIVER_SOURCE_ROOTS) {
    await visit(root);
  }
  return files;
}

export async function runChecker(repoRoot) {
  const [enText, zhText, sourceFiles] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'packages/locales/en/agent.json'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'packages/locales/zh-CN/agent.json'), 'utf8'),
    collectSourceFiles(repoRoot),
  ]);
  return validateLocaleTexts({ enText, zhText, sourceFiles });
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const repoRoot = path.resolve(path.dirname(scriptPath), '../..');
  try {
    const result = await runChecker(repoRoot);
    process.stdout.write(
      `PASS Agent V2 locales: ${result.localeKeyCount} parity keys, `
      + `${result.errorKeyCount} errors, ${result.recoveryKeyCount} recoveries, `
      + `${result.receiverSourceCount} receiver sources\n`,
    );
  } catch (error) {
    process.stderr.write(`FAIL Agent V2 locales: ${error.message}\n`);
    process.exitCode = 1;
  }
}

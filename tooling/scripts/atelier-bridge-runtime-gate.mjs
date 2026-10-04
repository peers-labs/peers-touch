import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const contract = JSON.parse(
  fsSync.readFileSync(
    path.join(repoRoot, 'apps/applets/atelier/contracts/atelier-projection.contract.json'),
    'utf8',
  ),
);
const malformedResponseFixtures = JSON.parse(
  fsSync.readFileSync(
    path.join(repoRoot, 'apps/applets/atelier/contracts/atelier-malformed-response-fixtures.json'),
    'utf8',
  ),
);
const evidenceDir = path.join(repoRoot, 'tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-bridge-runtime-gate.json');
const coveredPaths = [
  'browser Atelier bridge runtime validates projection snapshots and malformed projection events fail closed',
  'browser Atelier bridge runtime preserves last valid projection during stale seq, malformed patch, event apply failures, stale snapshot success/failure responses after fresher projection events or local model intents, and current snapshot failure typed recovery',
  'browser Atelier bridge runtime keeps fresh snapshot responses reconciling until refreshed projection subscribe settles and maps rejected refreshed subscribe to typed recovery',
  'browser Atelier bridge runtime keeps initial projection subscription reconciling until Host subscribe ack settles and maps rejected ack to typed recovery',
  'browser Atelier bridge runtime ignores stale initial subscription ack resolve or rejection after subscription replacement',
  'browser Atelier applet bridge ignores late subscribe rejections after release without listener delivery duplicate unsubscribe or unhandled rejection',
  'browser Atelier applet bridge release-before-late subscribe reject source unit matrix covers listener delivery duplicate unsubscribe and unhandled rejection isolation',
  'browser Atelier prototype typed subscription rejection sanitized cause source unit matrix preserves recovery code and strips execution-shaped fields',
  'browser Atelier prototype projection event typed subscription rejection reason sanitization source unit matrix strips execution-shaped reason text before message and cause construction',
  'browser Atelier prototype projection event typed subscription rejection code whitelist source unit matrix keeps only known recovery codes in Error.cause',
  'browser Atelier applet bridge typed subscription rejection reason and warning sanitization source unit matrix strips execution-shaped fields',
  'browser Atelier bridge runtime bounds dedupe cache and still rejects stale replay after eviction',
  'browser Atelier bridge runtime manages projection subscription lifecycle, topic correlation, cleanup, release-before-reject cleanup, typed recovery mapping, and structured Host error-code recovery taxonomy',
  'browser Atelier bridge runtime maps current non-snapshot Host failures to auth-denied, disconnected, and generic error recovery without mutating projection state',
  'browser Atelier applet bridge rejects malformed non-snapshot provider, feedback, memory, rerun, workspace, artifact body, and artifact preview responses',
  'browser Atelier applet bridge rejects execution-shaped fields in every non-snapshot Host typed response before runtime ownership can observe them',
  'browser Atelier bridge runtime rejects decimal and unsafe projection event/replay sequence numbers before state or cursor use',
  'browser Atelier prototype rejects task purge intents unless projected task status is deleted before runtime calls',
  'browser Atelier prototype marks unresolved TaskGraph artifact and gate evidence refs before display',
  'browser Atelier prototype recovery view matrix covers generated view status, retry, severity, and symbol taxonomy',
  'browser Atelier prototype recovery view source unit matrix covers generated severity symbol and retry taxonomy',
  'browser Atelier prototype render consumes status action policy for empty create-project and retry affordances',
  'browser Atelier prototype status action policy keeps primary action and visibility flags mutually consistent',
  'browser Atelier prototype status action policy matrix is exhaustive against generated view statuses',
  'browser Atelier prototype status action policy source unit matrix covers every generated view status without execution payload fields',
  'browser Atelier bridge runtime snapshot clone fails closed for executable capability values, forbidden capability keys or paths, and circular projection references before JSON cloning',
  'browser Atelier bridge runtime snapshot clone rejects non-plain projection objects before JSON cloning while preserving plain and null-prototype projection dictionaries',
  'browser Atelier bridge runtime snapshot clone rejects undefined array values and non-finite projection numbers before JSON cloning while preserving finite numbers and omittable optional object fields',
  'browser Atelier bridge runtime snapshot clone only omits registered optional undefined object fields and rejects required or unregistered undefined object fields before JSON cloning',
  'browser Atelier bridge runtime snapshot clone rejects prototype pollution keys before JSON cloning while preserving safe null-prototype projection dictionaries',
  'browser Atelier bridge runtime snapshot clone rejects sparse projection array holes before JSON cloning while preserving dense projection arrays',
  'browser Atelier bridge runtime snapshot clone rejects symbol-keyed or non-enumerable own projection properties before JSON cloning',
  'browser Atelier bridge runtime snapshot clone rejects accessor own projection properties before Object.entries or JSON cloning can invoke them',
  'browser Atelier bridge runtime snapshot clone isolates accepted projections from source snapshot mutations after cloning',
  'browser Atelier mock runtime getSnapshot clones status and state so external snapshot mutations cannot pollute runtime state',
  'browser Atelier mock runtime construction clones seed state so seed mutations cannot pollute runtime state',
  'browser Atelier mock runtime async action returns cloned snapshots so async return mutations cannot pollute runtime state',
  'browser Atelier mock runtime transition state is cloned on ownership transfer so returned projection mutations cannot pollute runtime state',
  'browser Atelier bridge runtime clones accepted Host projections on ownership transfer so Host projection mutations cannot pollute runtime state',
  'browser Atelier bridge runtime clones accepted projection event patches on ownership transfer so event patch mutations cannot pollute runtime state',
  'browser Atelier bridge runtime ignores released projection subscription callbacks by subscription generation so released Host callbacks cannot mutate runtime state',
  'browser Atelier bridge runtime ignores pre-cleanup projection subscription callbacks until cleanup contract is validated so malformed subscriptions cannot mutate runtime state',
  'browser Atelier bridge runtime ignores stale projection refresh results after newer projection revisions so stale refresh failures cannot overwrite current runtime status',
  'browser Atelier bridge runtime guards non-promise projection refresh settlement so synchronous projection events keep current runtime status',
  'browser Atelier bridge runtime guards subscription recovery status against stale projection refresh success so auth-denied surfaces remain fail-closed',
  'browser Atelier bridge runtime guards subscription setup and cleanup recovery status against stale projection refresh success so disconnected surfaces remain fail-closed',
  'browser Atelier bridge runtime guards non-snapshot call status settlement against projection recovery revisions so auth-denied surfaces remain fail-closed',
  'browser Atelier bridge runtime guards non-snapshot call failure settlement against projection recovery revisions so auth-denied surfaces remain fail-closed',
  'browser Atelier prototype page surface unit matrix covers every generated view status so loading empty disconnected and auth-denied states stay mutually exclusive',
    'browser Atelier prototype default shell is synced to the official single-column projection shape without app-level left or right rails',
];
const doesNotProve = [
  'real Desktop Host event stream producer behavior',
  'real Station SSE network failure matrix',
  'real cross-restart cursor recovery',
  'real Desktop product window UI',
  'real provider, feedback, memory, rerun, workspace, artifact body, or artifact preview backend side effects',
  'complete Host + Station + applet E2E',
];

function writeEvidence(status, errorMessage) {
  const proves = status === 'PASS' ? coveredPaths : [];
  fsSync.mkdirSync(evidenceDir, { recursive: true });
  fsSync.writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        status,
        evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
        appletId: 'peers.atelier',
        gate: 'atelier:bridge-runtime-gate',
        coveredPaths: proves,
        notCovered: doesNotProve,
        claimBoundary: {
          readiness: 'NOT_READY',
          proves,
          doesNotProve,
        },
        command: 'pnpm run atelier:bridge-runtime-gate',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}
const prototypePageSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/Page.tsx'),
  'utf8',
);
const prototypeTypesSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/types.ts'),
  'utf8',
);
const prototypePreviewSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/preview.tsx'),
  'utf8',
);
const prototypePluginsSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/plugins.tsx'),
  'utf8',
);
const prototypeBlocksSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/blocks.tsx'),
  'utf8',
);
const prototypeRuntimeSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/runtime.ts'),
  'utf8',
);
const prototypeComposerSubmitSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeComposerSubmit.ts'),
  'utf8',
);
const prototypeComposerSubmitTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeComposerSubmit.test.ts'),
  'utf8',
);
const prototypeMessageProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeMessageProjection.ts'),
  'utf8',
);
const prototypeMessageProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeMessageProjection.test.ts'),
  'utf8',
);
const prototypeCreateProjectProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeCreateProjectProjection.ts'),
  'utf8',
);
const prototypeCreateProjectProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeCreateProjectProjection.test.ts'),
  'utf8',
);
const prototypeRunTargetPickerProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeRunTargetPickerProjection.ts'),
  'utf8',
);
const prototypeRunTargetPickerProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeRunTargetPickerProjection.test.ts'),
  'utf8',
);
const prototypeWorkspaceSnapshotOwnershipSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeWorkspaceSnapshotOwnership.ts'),
  'utf8',
);
const prototypeWorkspaceSnapshotOwnershipTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeWorkspaceSnapshotOwnership.test.ts'),
  'utf8',
);
const prototypeContextProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeContextProjection.ts'),
  'utf8',
);
const prototypeContextProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeContextProjection.test.ts'),
  'utf8',
);
const prototypeBridgeRuntimeSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/bridgeRuntime.ts'),
  'utf8',
);
const prototypeBridgeProjectionEventPolicySource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeBridgeProjectionEventPolicy.ts'),
  'utf8',
);
const prototypeBridgeProjectionEventPolicyTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeBridgeProjectionEventPolicy.test.ts'),
  'utf8',
);
const prototypeBridgeRuntimeCallPolicySource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeBridgeRuntimeCallPolicy.ts'),
  'utf8',
);
const prototypeBridgeRuntimeCallPolicyTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeBridgeRuntimeCallPolicy.test.ts'),
  'utf8',
);
const prototypeBridgeRuntimeOwnershipTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeBridgeRuntimeOwnership.test.ts'),
  'utf8',
);
const prototypeRuntimeSnapshotIsolationTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeRuntimeSnapshotIsolation.test.ts'),
  'utf8',
);
const prototypeRuntimeBootstrapSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/runtimeBootstrap.ts'),
  'utf8',
);
const prototypeTaskOrganizerProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeTaskOrganizerProjection.ts'),
  'utf8',
);
const prototypeTaskOrganizerProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeTaskOrganizerProjection.test.ts'),
  'utf8',
);
const prototypeNegotiationProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeNegotiationProjection.ts'),
  'utf8',
);
const prototypeNegotiationProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeNegotiationProjection.test.ts'),
  'utf8',
);
const prototypeArtifactPreviewProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeArtifactPreviewProjection.ts'),
  'utf8',
);
const prototypeArtifactPreviewProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeArtifactPreviewProjection.test.ts'),
  'utf8',
);
const prototypeDiffCardProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeDiffCardProjection.ts'),
  'utf8',
);
const prototypeDiffCardProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeDiffCardProjection.test.ts'),
  'utf8',
);
const prototypeProviderCapabilityCommandSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeProviderCapabilityCommand.ts'),
  'utf8',
);
const prototypeProviderCapabilityCommandTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeProviderCapabilityCommand.test.ts'),
  'utf8',
);
const prototypeBudgetProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeBudgetProjection.ts'),
  'utf8',
);
const prototypeBudgetProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeBudgetProjection.test.ts'),
  'utf8',
);
const prototypeProviderCapabilityDiscoverySource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeProviderCapabilityDiscovery.ts'),
  'utf8',
);
const prototypeProviderCapabilityDiscoveryTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeProviderCapabilityDiscovery.test.ts'),
  'utf8',
);
const prototypeProviderCapabilityPanelProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeProviderCapabilityPanelProjection.ts'),
  'utf8',
);
const prototypeProviderCapabilityPanelProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeProviderCapabilityPanelProjection.test.ts'),
  'utf8',
);
const prototypeRecoveryViewSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeRecoveryView.ts'),
  'utf8',
);
const prototypeRecoveryViewTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeRecoveryView.test.ts'),
  'utf8',
);
const prototypeProjectHealthProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeProjectHealthProjection.ts'),
  'utf8',
);
const prototypeProjectHealthProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeProjectHealthProjection.test.ts'),
  'utf8',
);
const prototypeRightRailProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeRightRailProjection.ts'),
  'utf8',
);
const prototypeRightRailProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeRightRailProjection.test.ts'),
  'utf8',
);
const prototypeTaskGraphPanelProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeTaskGraphPanelProjection.ts'),
  'utf8',
);
const prototypeTaskGraphPanelProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeTaskGraphPanelProjection.test.ts'),
  'utf8',
);
const prototypeTaskGraphNodeProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeTaskGraphNodeProjection.ts'),
  'utf8',
);
const prototypeTaskGraphNodeProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeTaskGraphNodeProjection.test.ts'),
  'utf8',
);
const prototypeFeedbackPolicySource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeFeedbackPolicy.ts'),
  'utf8',
);
const prototypeFeedbackPolicyTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeFeedbackPolicy.test.ts'),
  'utf8',
);
const prototypeWorkspaceOpenStatusSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeWorkspaceOpenStatus.ts'),
  'utf8',
);
const prototypeWorkspaceOpenStatusTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeWorkspaceOpenStatus.test.ts'),
  'utf8',
);
const prototypeDecisionChoiceSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeDecisionChoice.ts'),
  'utf8',
);
const prototypeDecisionChoiceTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeDecisionChoice.test.ts'),
  'utf8',
);
const prototypeTaskLifecycleIntentSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeTaskLifecycleIntent.ts'),
  'utf8',
);
const prototypeTaskLifecycleIntentTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeTaskLifecycleIntent.test.ts'),
  'utf8',
);
const prototypeConfirmationResultSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeConfirmationResult.ts'),
  'utf8',
);
const prototypeConfirmationResultTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeConfirmationResult.test.ts'),
  'utf8',
);
const prototypeProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/projection.ts'),
  'utf8',
);
const appletBridgeSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/appletBridge.ts'),
  'utf8',
);
const prototypeEngineTraceSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/engineTrace.tsx'),
  'utf8',
);
const prototypeEngineTraceProjectionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeEngineTraceProjection.ts'),
  'utf8',
);
const prototypeEngineTraceProjectionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeEngineTraceProjection.test.ts'),
  'utf8',
);
assert.ok(
  appletBridgeSource.includes('ATELIER_PROJECTION_EVENT_TOPIC') &&
    appletBridgeSource.includes("invokeProjectionSubscription(host, 'events.subscribe'") &&
    appletBridgeSource.includes("'events.unsubscribe'") &&
    appletBridgeSource.includes('return Object.assign(cleanup, { ready });') &&
    !appletBridgeSource.includes('projectionStream') &&
    !appletBridgeSource.includes('ATELIER_PROJECTION_SUBSCRIPTION_METHOD'),
  'Browser prototype applet bridge must use only the canonical Host event topic',
);
assert.ok(
  prototypeBridgeRuntimeSource.includes("event.patch.kind === 'snapshot.invalidate'") &&
    prototypeBridgeRuntimeSource.includes("void callSnapshot('atelier.workspace.load', {})") &&
    prototypeBridgeRuntimeSource.includes('hasProjectionSeqGap(event, lastSeqByScope)') &&
    prototypeBridgeRuntimeSource.includes('const ready = projectionSubscriptionReady(cleanup);') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('reconciles canonical invalidation through authoritative workspace readback') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('does not apply a gap event before authoritative workspace readback') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('keeps projection subscription reconciling until Host subscribe ack settles'),
  'Browser prototype runtime must reconcile canonical invalidations and sequence gaps after Host subscription readiness',
);
assert.ok(
  prototypeRuntimeBootstrapSource.includes('HOST_RUNTIMES.has(sdk.runtime)') &&
    prototypeRuntimeBootstrapSource.includes('bridge: createAppletSdkAtelierBridge(sdk)') &&
    prototypeRuntimeBootstrapSource.includes('toProjectionSnapshot(emptyHostState())') &&
    !prototypeRuntimeBootstrapSource.includes('projectionStream') &&
    !prototypeRuntimeBootstrapSource.includes('__ATELIER_PROJECTION_STREAM__'),
  'Browser prototype bootstrap must not own Station stream configuration',
);
assert.doesNotMatch(
  appletBridgeSource + prototypeRuntimeBootstrapSource,
  /atelier\.events\.subscribe|\/agent\/events\/subscribe|\/sub-agent\/agent\/events\/subscribe/,
  'Browser prototype must not retain private Agent event transports',
);
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-bridge-runtime-gate-'));
const outfile = path.join(tempDir, 'gate.mjs');

const testSource = `
import assert from 'node:assert/strict';
import { createBridgeAtelierRuntime } from './packages/prototypes/desktop/applets/atelier/src/bridgeRuntime.ts';
import { assertAtelierProjectionSnapshot, parseAtelierProjectionEvent } from './packages/prototypes/desktop/applets/atelier/src/projection.ts';
import { derivePrototypePageSurface, derivePrototypeRecoveryView, derivePrototypeStatusActionPolicy, isPrototypeStatusActionPolicyConsistent, prototypeStatusForScenario, resolvePrototypeStatusScenario } from './packages/prototypes/desktop/applets/atelier/src/prototypeRecoveryView.ts';
import {
  ATELIER_PROJECTION_EVENT_TOPIC,
  ATELIER_PROTOTYPE_RECOVERY_SEVERITY_BY_STATUS,
  ATELIER_PROTOTYPE_RECOVERY_SYMBOL_BY_STATUS,
  ATELIER_RECOVERY_RETRYABLE_KINDS,
  ATELIER_VIEW_STATUSES,
  ATELIER_VIEW_SURFACE,
} from './packages/prototypes/desktop/applets/atelier/src/projection.contract.generated.ts';

const providerCapabilityMalformedResponseFixtures = ${JSON.stringify(malformedResponseFixtures.providerCapabilities, null, 2)};
const nonArtifactCapabilityMalformedResponseFixtures = ${JSON.stringify(malformedResponseFixtures.nonArtifactCapabilities, null, 2)};
const artifactBodyMalformedResponseFixtures = ${JSON.stringify(malformedResponseFixtures.artifactBody, null, 2)};
const artifactPreviewMalformedResponseFixtures = ${JSON.stringify(malformedResponseFixtures.artifactPreview, null, 2)};
const prototypeRecoveryViewTestSource = ${JSON.stringify(prototypeRecoveryViewTestSource)};
const prototypeBridgeRuntimeOwnershipTestSource = ${JSON.stringify(prototypeBridgeRuntimeOwnershipTestSource)};

function snapshot(taskId = 'task-1') {
  return {
    version: ${JSON.stringify(contract.version)},
    selectedTaskId: taskId,
    workspace: {
      budgetSpent: 0,
      budgetCap: 10,
      budget: {
        status: 'warning',
        summary: '$0 / $10',
        decisionHint: 'Station will raise a budget DecisionCard before halt/resume.',
        dimensions: [
          { id: 'money', label: 'Money', used: 0, cap: 10, unit: '$', percent: 0, status: 'ok' },
          { id: 'tokens', label: 'Tokens', used: 78000, cap: 100000, unit: 'tok', percent: 78, status: 'warning' },
          { id: 'time', label: 'Time', used: 46, cap: 60, unit: 'min', percent: 77, status: 'warning' },
          { id: 'cap', label: 'Cap', used: 3, cap: 4, unit: 'runs', percent: 75, status: 'warning' },
        ],
      },
      model: 'openrouter-3o',
      tasks: taskId ? [{ id: taskId, project: 'peers-touch', title: 'Bridge gate', status: 'active' }] : [],
      streams: taskId ? { [taskId]: [] } : {},
      todos: {},
      contexts: {},
      artifacts: {},
      gates: {},
    },
  };
}

function validProjectProjection(overrides = {}) {
  return {
    id: 'project-1',
    goal: 'Ship Atelier projection guard',
    title: 'Atelier projection guard',
    state: 'executing',
    workspaceRef: 'pt-workspace://task/task-1?workspace=workspace-1',
    goalOwnerSignoff: false,
    residualRisks: [],
    openBlockers: [],
    memoryCandidates: [],
    completion: {
      noOpenBlockers: true,
      l0L1AcceptancePassed: false,
      l2HumanSignoffComplete: false,
      residualRisksLogged: false,
      memoryCandidatesGenerated: false,
    },
    milestoneTree: {
      rootId: 'milestone-1',
      milestones: [{
        id: 'milestone-1',
        title: 'Guard projection',
        state: 'active',
        taskIds: ['task-1'],
        acceptancePredicateIds: ['predicate-1'],
        openBlockers: [],
      }],
      edges: [],
    },
    taskGraph: {
      rootTaskIds: ['task-1'],
      tasks: [{
        id: 'task-1',
        title: 'Guard projection',
        state: 'running',
        agentRole: 'Verifier',
        artifactIds: ['artifact-1'],
        gateIds: ['gate-1'],
      }],
      edges: [{ from: 'task-1', to: 'task-2', type: 'blocks' }],
      parallelPolicy: 'serial_only',
    },
    defects: [],
    ...overrides,
  };
}

function bridgeWithCall(call) {
  let listener;
  return {
    bridge: {
      call,
      subscribeProjection(nextListener) {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      },
    },
    emit(event) {
      listener?.(event);
    },
  };
}

function deferredPromise() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function appletHostWithInvoke(response) {
  const calls = [];
  return {
    calls,
    host: {
      async invoke(method, params) {
        calls.push({ method, params });
        return response;
      },
      onEvent() {
        return () => {};
      },
    },
  };
}

function appletHostWithEventTracking(response) {
  const calls = [];
  const eventSubscriptions = [];
  const eventUnsubscriptions = [];
  const handlers = new Map();
  return {
    calls,
    eventSubscriptions,
    eventUnsubscriptions,
    emit(topic, payload) {
      handlers.get(topic)?.(payload);
    },
    host: {
      async invoke(method, params) {
        calls.push({ method, params });
        return response;
      },
      onEvent(topic, handler) {
        eventSubscriptions.push({ topic, handler });
        handlers.set(topic, handler);
        return () => {
          eventUnsubscriptions.push({ topic });
          handlers.delete(topic);
        };
      },
    },
  };
}

async function testProjectionGuards() {
  assert.throws(() => assertAtelierProjectionSnapshot({ version: ${JSON.stringify(contract.version)} }));
  for (const invalidWorkspacePatch of [
    { selectedTaskId: 'task-unknown' },
    { tasks: [{ id: '', project: 'peers-touch', title: 'empty task id', status: 'active' }] },
    { tasks: [{ id: 'task-1', project: '', title: 'empty project', status: 'active' }] },
    { tasks: [{ id: 'task-1', project: 'peers-touch', title: '', status: 'active' }] },
    { tasks: [{ id: 'task-1', project: 'peers-touch', title: 'bad status', status: 'running' }] },
    { tasks: [{ id: 'task-1', project: 'peers-touch', title: 'bad workspace target', status: 'active', workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'file:///tmp/ws', label: 'workspace' } }] },
    { tasks: [{ id: 'task-1', project: 'peers-touch', title: 'bad workspace target missing task id', status: 'active', workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'pt-workspace://task/?workspace=ws-1', label: 'workspace' } }] },
    { tasks: [{ id: 'task-1', project: 'peers-touch', title: 'bad workspace target missing workspace query', status: 'active', workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'pt-workspace://task/task-1', label: 'workspace' } }] },
    { tasks: [{ id: 'task-1', project: 'peers-touch', title: 'bad workspace target empty workspace query', status: 'active', workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'pt-workspace://task/task-1?workspace=', label: 'workspace' } }] },
    { tasks: [{ id: 'task-1', project: 'peers-touch', title: 'bad workspace target mismatched task id', status: 'active', workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'pt-workspace://task/task-2?workspace=ws-1', label: 'workspace' } }] },
    { tasks: [{ id: 'task-1', project: 'peers-touch', title: 'bad workspace target mismatched workspace query', status: 'active', workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'pt-workspace://task/task-1?workspace=ws-2', label: 'workspace' } }] },
    { tasks: [{ id: 'task-1', project: 'peers-touch', title: 'bad workspace target host', status: 'active', workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'pt-workspace://file/tmp/ws?workspace=ws-1', label: 'workspace' } }] },
    { streams: { 'task-1': [{ kind: 'agent', text: 'missing id', done: true }] } },
    { streams: { '': [] } },
    { streams: { 'task-unknown': [] } },
    { todos: { 'task-1': [{ id: 'todo-1', text: '', status: 'todo' }] } },
    { todos: { 'task-unknown': [] } },
    { contexts: { 'task-1': { usedPct: -1, files: [{ name: 'README.md', group: 'files' }] } } },
    { contexts: { 'task-1': { usedPct: 101, files: [{ name: 'README.md', group: 'files' }] } } },
    { contexts: { 'task-1': { usedPct: 50, files: [{ name: '', group: 'files' }] } } },
    { contexts: { 'task-unknown': { usedPct: 50, files: [{ name: 'README.md', group: 'files' }] } } },
    { projects: [validProjectProjection({ title: 'bad project state', state: 'active' })] },
    { projects: [validProjectProjection({ milestoneTree: { ...validProjectProjection().milestoneTree, milestones: [{ ...validProjectProjection().milestoneTree.milestones[0], title: 'bad milestone state', state: 'open' }] } })] },
    { projects: [validProjectProjection({ taskGraph: { ...validProjectProjection().taskGraph, tasks: [{ ...validProjectProjection().taskGraph.tasks[0], title: 'bad task graph node state', state: 'blocked' }] } })] },
    { projects: [validProjectProjection({ openBlockers: [{ id: 'blocker-1', owner: 'Risk', severity: 'fatal', state: 'open', evidenceRef: 'artifact-1', reason: 'bad severity' }] })] },
    { projects: [validProjectProjection({ residualRisks: [{ id: 'risk-1', desc: 'bad risk state', state: 'ignored', evidenceRef: 'artifact-1', owner: 'Risk' }] })] },
    { projects: [validProjectProjection({ memoryCandidates: [{ id: 'memory-1', type: 'random_note', content: 'bad type', evidenceRefs: ['artifact-1'], scope: 'project', confirmed: false, feeds: ['planner'] }] })] },
    { projects: [validProjectProjection({ memoryCandidates: [{ id: 'memory-1', type: 'workflow_improvement', content: '', evidenceRefs: ['artifact-1'], scope: 'project', confirmed: false, feeds: ['planner'] }] })] },
    { projects: [validProjectProjection({ memoryCandidates: [{ id: 'memory-1', type: 'workflow_improvement', content: 'bad scope', evidenceRefs: ['artifact-1'], scope: 'workspace', confirmed: false, feeds: ['planner'] }] })] },
    { projects: [validProjectProjection({ memoryCandidates: [{ id: 'memory-1', type: 'workflow_improvement', content: 'bad feed', evidenceRefs: ['artifact-1'], scope: 'project', confirmed: false, feeds: ['executor'] }] })] },
    { projects: [validProjectProjection({ taskGraph: { ...validProjectProjection().taskGraph, edges: [{ from: 'task-1', to: 'task-2', type: 'depends_on' }] } })] },
    { projects: [validProjectProjection({ taskGraph: { ...validProjectProjection().taskGraph, parallelPolicy: 'parallel_all' } })] },
    { projects: [validProjectProjection({ policy: { id: 'policy-1', hardDeny: true, rules: [{ id: 'rule-1', scope: 'filesystem', expr: 'deny shell', severity: 'block' }] } })] },
    { projects: [validProjectProjection({ policy: { id: 'policy-1', hardDeny: true, rules: [{ id: 'rule-1', scope: 'command', expr: 'deny shell', severity: 'fatal' }] } })] },
    { projects: [validProjectProjection({ policy: { id: 'policy-1', hardDeny: true, rules: [{ id: 'rule-1', scope: 'command', expr: '', severity: 'block' }] } })] },
    { projects: [validProjectProjection({ defects: [{ id: 'defect-1', taskId: 'task-1', source: 'scanner', state: 'proposed', evidenceRef: 'artifact-1', proposal: { summary: 'bad source', expectedChange: 'reject malformed source', targetRefs: ['artifact-1'] } }] })] },
    { projects: [validProjectProjection({ defects: [{ id: 'defect-1', taskId: 'task-1', source: 'gate', state: 'ignored', evidenceRef: 'artifact-1', proposal: { summary: 'bad state', expectedChange: 'reject malformed state', targetRefs: ['artifact-1'] } }] })] },
    { projects: [validProjectProjection({ defects: [{ id: 'defect-1', taskId: 'task-1', source: 'gate', state: 'proposed', evidenceRef: '', proposal: { summary: 'empty evidence', expectedChange: 'reject empty evidence ref', targetRefs: ['artifact-1'] } }] })] },
    { projects: [validProjectProjection({ defects: [{ id: 'defect-1', taskId: 'task-1', source: 'gate', state: 'proposed', evidenceRef: 'artifact-1', proposal: { summary: 'empty targets', expectedChange: 'reject empty target refs', targetRefs: [] } }] })] },
    { projects: [validProjectProjection({ defects: [{ id: 'defect-1', taskId: 'task-1', source: 'gate', state: 'proposed', evidenceRef: 'artifact-1', proposal: { summary: 'empty target', expectedChange: 'reject empty target ref', targetRefs: [''] } }] })] },
    { replay: { '': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
    { replay: { 'task-unknown': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
    { replay: { 'task-1': { source: '', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1.5, replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: Number.MAX_SAFE_INTEGER + 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1.5, nextEventSeq: 2, hasMore: false } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: Number.MAX_SAFE_INTEGER + 1, nextEventSeq: 2, hasMore: false } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: -1, hasMore: false } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2.5, hasMore: false } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: Number.MAX_SAFE_INTEGER + 1, hasMore: false } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false, checkpointId: '' } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false, checkpointEventSeq: -1 } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false, checkpointEventSeq: 2.5 } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false, checkpointEventSeq: Number.MAX_SAFE_INTEGER + 1 } } },
    { artifacts: { 'task-unknown': [] } },
    { artifacts: { 'task-1': [{ id: '', name: 'empty artifact', kind: 'markdown', meta: 'bad' }] } },
    { artifacts: { 'task-1': [{ id: 'artifact-bad-body-ref', name: 'bad body ref', kind: 'markdown', meta: 'bad', bodyRef: 'file:///tmp/leak' }] } },
    { artifacts: { 'task-1': [{ id: 'artifact-bad-body-ref-url', name: 'bad body ref url', kind: 'markdown', meta: 'bad', bodyRef: 'https://example.invalid/body' }] } },
    { artifacts: { 'task-1': [{ id: 'artifact-bad-body-ref-shape', name: 'bad body ref shape', kind: 'markdown', meta: 'bad', bodyRef: 'artifact://task-1/body' }] } },
    { artifacts: { 'task-1': [{ id: 'artifact-body-leak', name: 'body leak', kind: 'markdown', meta: 'bad', markdown: '# leaked body' }] } },
    { artifacts: { 'task-1': [{ id: 'artifact-bad-paths', name: 'bad paths', kind: 'diff', meta: 'bad', paths: ['ok', 42] }] } },
    { artifacts: { 'task-1': [{ id: 'artifact-preview-target-empty', name: 'empty preview target', kind: 'markdown', meta: 'bad', previewTarget: {} }] } },
    { artifacts: { 'task-1': [{ id: 'artifact-preview-target-missing-sandbox', name: 'missing sandbox', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', bodyRef: 'artifact://task-1/artifact-preview/body' } }] } },
      { artifacts: { 'task-1': [{ id: 'artifact-preview-target-bad-sandbox-ref-shape', name: 'bad sandbox ref shape', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task 1/artifact-preview/preview', bodyRef: 'artifact://task-1/artifact-preview/body' } }] } },
    { artifacts: { 'task-1': [{ id: 'artifact-preview-target-missing-body', name: 'missing body', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview' } }] } },
    { artifacts: { 'task-1': [{ id: 'artifact-bad-preview-target', name: 'bad preview target', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', url: 'https://example.invalid' } }] } },
    { gates: { 'task-1': [{ id: '', name: 'empty gate', status: 'failed', summary: 'bad', checks: [] }] } },
    { gates: { 'task-1': [{ id: 'gate-1', name: 'bad check', status: 'failed', summary: 'bad', checks: [{ name: '', status: 'failed' }] }] } },
    { gates: { 'task-1': [{ id: 'gate-1', name: 'bad artifact ids', status: 'failed', summary: 'bad', checks: [], artifactIds: ['ok', 42] }] } },
    { gates: { 'task-unknown': [] } },
    { budget: { status: 'halted', summary: '$1 / $10', dimensions: [{ id: 'money', label: 'Money', used: 1, cap: 10, unit: '$', percent: 10, status: 'ok' }] } },
    { budget: { status: 'warning', summary: '', dimensions: [{ id: 'money', label: 'Money', used: 1, cap: 10, unit: '$', percent: 10, status: 'ok' }] } },
    { budget: { status: 'warning', summary: '$1 / $10', dimensions: [] } },
    { budget: { status: 'warning', summary: '$1 / $10', dimensions: [{ id: 'money', label: 'Money', used: -1, cap: 10, unit: '$', percent: 10, status: 'ok' }] } },
    { budget: { status: 'warning', summary: '$1 / $10', dimensions: [{ id: 'money', label: 'Money', used: 1, cap: 10, unit: '$', percent: 101, status: 'ok' }] } },
    { budget: { status: 'warning', summary: '$1 / $10', dimensions: [{ id: 'money', label: 'Money', used: 1, cap: 10, unit: '$', percent: 10, status: 'halted' }] } },
  ]) {
    const invalidSnapshot = snapshot('task-1');
    if ('selectedTaskId' in invalidWorkspacePatch) {
      invalidSnapshot.selectedTaskId = invalidWorkspacePatch.selectedTaskId;
    } else {
      invalidSnapshot.workspace = { ...invalidSnapshot.workspace, ...invalidWorkspacePatch };
    }
    assert.throws(
      () => assertAtelierProjectionSnapshot(invalidSnapshot),
      'invalid workspace projection must fail closed: ' + JSON.stringify(invalidWorkspacePatch),
    );
  }
  assert.equal(parseAtelierProjectionEvent({ id: 'evt-bad', seq: 1, receivedAt: 'now', patch: { kind: 'unknown' } }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-decimal-seq',
    seq: 1.5,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-unsafe-seq',
    seq: Number.MAX_SAFE_INTEGER + 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-empty-top-level-task',
    seq: 1,
    taskId: '',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-empty-patch-task',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: '', blocks: [] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-stream-block',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [{ kind: 'agent', text: 'missing id', done: true }] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-stream-kind',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [{ id: 'block-unknown', kind: 'raw_patch', text: 'must not render raw patch' }] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-user-stream-required-fields',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [{ id: 'user-missing-text', kind: 'user' }] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-decision-stream-required-fields',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [{ id: 'decision-missing-options', kind: 'decision', question: 'Approve?', spentSoFar: '$1', rollbackImpact: 'none' }] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-artifact-stream-required-fields',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [{ id: 'artifact-missing-producer', kind: 'artifact', name: 'report', fileKind: 'report' }] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-nego-stance',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [{ id: 'nego-bad-stance', kind: 'nego', summary: 'bad stance', agentCount: 1, converged: false, voices: [{ role: 'Planner', stance: 'approval', text: 'invalid stance' }], consensus: 'pending' }] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-nego-empty-voice-fields',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [{ id: 'nego-empty-fields', kind: 'nego', summary: 'empty fields', agentCount: 1, converged: false, voices: [{ role: '', stance: 'objection', text: '', evidenceRef: '', sessionId: '', roundId: '', voiceId: '', objectionId: '' }], consensus: 'pending' }] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-diff-stream-block',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [{ id: 'diff-bad', kind: 'diff', files: 1, added: 2, removed: 0, paths: ['src/a.ts', ''] }] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-diff-stream-empty-paths',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [{ id: 'diff-empty-paths', kind: 'diff', files: 1, added: 2, removed: 0, paths: [] }] },
  }), null);
  assert.ok(parseAtelierProjectionEvent(JSON.stringify({
    id: 'evt-diff-valid',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [{ id: 'diff-1', kind: 'diff', files: 2, added: 12, removed: 3, paths: ['src/a.ts', 'src/b.ts'] }] },
  })));
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-empty-upsert-id',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'task.upsert', task: { id: '', project: 'peers-touch', title: 'empty id', status: 'active' }, select: true },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-task-upsert-status',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'task.upsert', task: { id: 'task-1', project: 'peers-touch', title: 'bad status', status: 'running' }, select: true },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-task-upsert-workspace-target',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'task.upsert',
      task: {
        id: 'task-1',
        project: 'peers-touch',
        title: 'bad workspace target',
        status: 'active',
        workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'file:///tmp/ws', label: 'workspace' },
      },
      select: true,
    },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-task-upsert-workspace-target-prefix-only',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'task.upsert',
      task: {
        id: 'task-1',
        project: 'peers-touch',
        title: 'bad workspace target prefix only',
        status: 'active',
        workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'pt-workspace://task/task-1?workspace=ws-2', label: 'workspace' },
      },
      select: true,
    },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-task-upsert-workspace-target-task-mismatch',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'task.upsert',
      task: {
        id: 'task-1',
        project: 'peers-touch',
        title: 'bad workspace target task mismatch',
        status: 'active',
        workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'pt-workspace://task/task-2?workspace=ws-1', label: 'workspace' },
      },
      select: true,
    },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-empty-artifact-id',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: '', name: 'empty artifact', kind: 'markdown', meta: 'bad' } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-artifact-body-leak',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-body-leak', name: 'body leak', kind: 'markdown', meta: 'bad', markdown: '# leaked body' } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-artifact-bad-body-ref-file',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-bad-body-ref-file', name: 'bad body ref', kind: 'markdown', meta: 'bad', bodyRef: 'file:///tmp/leak' } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-artifact-bad-body-ref-url',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-bad-body-ref-url', name: 'bad body ref', kind: 'markdown', meta: 'bad', bodyRef: 'https://example.invalid/body' } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-artifact-bad-body-ref-shape',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-bad-body-ref-shape', name: 'bad body ref shape', kind: 'markdown', meta: 'bad', bodyRef: 'artifact://task-1/body' } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-artifact-preview-target-url-leak',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-url-leak', name: 'bad preview target', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', url: 'https://example.invalid' } } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-artifact-preview-target-empty',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-empty', name: 'empty preview target', kind: 'markdown', meta: 'bad', previewTarget: {} } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-artifact-preview-target-missing-sandbox',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-missing-sandbox', name: 'missing sandbox', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', bodyRef: 'artifact://task-1/artifact-preview/body' } } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-artifact-preview-target-missing-body',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-missing-body', name: 'missing body', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview' } } },
  }), null);
    assert.equal(parseAtelierProjectionEvent({
      id: 'evt-artifact-preview-target-bad-sandbox-ref-shape',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-bad-sandbox-ref-shape', name: 'bad sandbox ref shape', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact preview/preview', bodyRef: 'artifact://task-1/artifact-preview/body' } } },
    }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-artifact-preview-target-bad-body-ref',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-bad-body-ref', name: 'bad body ref', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview', bodyRef: 'https://example.invalid/body' } } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-artifact-preview-target-bad-body-ref-shape',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-bad-body-ref-shape', name: 'bad body ref shape', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview', bodyRef: 'artifact://task-1/body' } } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-empty-gate-id',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'gate.upsert', taskId: 'task-1', gate: { id: '', name: 'empty gate', status: 'failed', summary: 'bad', checks: [] } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-gate-check',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'gate.upsert', taskId: 'task-1', gate: { id: 'gate-1', name: 'bad check', status: 'failed', summary: 'bad', checks: [{ name: '', status: 'failed' }] } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-gate-artifact-ids',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'gate.upsert', taskId: 'task-1', gate: { id: 'gate-1', name: 'bad artifact ids', status: 'failed', summary: 'bad', checks: [], artifactIds: ['ok', 42] } },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-todo-item',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'todo.replace', taskId: 'task-1', todos: [{ id: 'todo-1', text: '', status: 'todo' }] },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-empty-decision-block',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'decision.resolved', taskId: 'task-1', blockId: '', choice: 'continue' },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-empty-decision-choice',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'decision.resolved', taskId: 'task-1', blockId: 'decision-1', choice: '' },
  }), null);
  assert.equal(parseAtelierProjectionEvent({
    id: 'evt-malformed-context',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'context.replace', taskId: 'task-1', context: { usedPct: 50, files: [{ name: '', group: 'files' }] } },
  }), null);
  assert.ok(parseAtelierProjectionEvent({
    id: 'evt-ok',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: { kind: 'stream.append', taskId: 'task-1', blocks: [] },
  }));
}

async function testBridgeRejectsMalformedInitialSnapshot() {
  const malformedInitialSnapshot = snapshot('task-1');
  malformedInitialSnapshot.workspace.tasks[0].id = '';
  assert.throws(
    () => createBridgeAtelierRuntime({
      bridge: bridgeWithCall(async () => snapshot('task-1')).bridge,
      initialSnapshot: malformedInitialSnapshot,
    }),
    /Invalid Atelier projection snapshot/,
    'bridge runtime must reject malformed initial projection snapshot before creating runtime state',
  );
}

async function testBridgeLoadAndEventReplay() {
  const harness = bridgeWithCall(async () => snapshot());
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot(''),
  });

  assert.equal(runtime.getSnapshot().status?.kind, 'loading');
  const afterLoad = await runtime.loadWorkspace();
  assert.equal(afterLoad.status?.kind, 'ready');

  const seen = [];
  const unsubscribe = runtime.subscribe((next) => seen.push(next));
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.equal(seen.at(-2)?.status?.kind, 'reconciling');
  assert.equal(seen.at(-1)?.status?.kind, 'ready');

  harness.emit({
    id: 'evt-1',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [{ kind: 'agent', id: 'block-1', text: 'first', done: true }],
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.equal(runtime.getSnapshot().status?.lastEventSeq, 1);
  harness.emit({
    id: 'evt-1',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [{ kind: 'agent', id: 'block-1', text: 'duplicate', done: true }],
    },
  });
  harness.emit({
    id: 'evt-stale',
    seq: 0,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [{ kind: 'agent', id: 'block-stale', text: 'stale', done: true }],
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'degraded');
  assert.equal(runtime.getSnapshot().status?.lastEventSeq, 0);
  assert.deepEqual(runtime.getSnapshot().state.stream['task-1'].map((block) => block.id), ['block-1']);
  harness.emit({
    id: 'evt-2',
    seq: 2,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [{ kind: 'agent', id: 'block-2', text: 'second', done: true }],
    },
  });

  const stream = runtime.getSnapshot().state.stream['task-1'];
  assert.deepEqual(stream.map((block) => block.id), ['block-1', 'block-2']);
  assert.equal(runtime.getSnapshot().status?.lastEventSeq, 2);
  assert.ok(seen.length >= 2);
  unsubscribe();
}

async function testBridgeDedupeCacheEvictsBoundedlyAndSeqGuardRejectsReplay() {
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  await runtime.loadWorkspace();
  const unsubscribe = runtime.subscribe(() => {});

  for (let seq = 1; seq <= 501; seq += 1) {
    harness.emit({
      id: 'evt-dedupe-cache-' + seq,
      seq,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'stream.append',
        taskId: 'task-1',
        blocks: [{ kind: 'agent', id: 'block-dedupe-cache-' + seq, text: 'bounded event ' + seq, done: true }],
      },
    });
  }
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.equal(runtime.getSnapshot().status?.lastEventSeq, 501);
  assert.equal(runtime.getSnapshot().state.stream['task-1'].length, 501);

  harness.emit({
    id: 'evt-dedupe-cache-1',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [{ kind: 'agent', id: 'block-evicted-stale-replay', text: 'evicted stale replay', done: true }],
    },
  });

  assert.equal(runtime.getSnapshot().status?.kind, 'degraded');
  assert.equal(runtime.getSnapshot().status?.lastEventSeq, 1);
  assert.equal(runtime.getSnapshot().state.stream['task-1'].length, 501);
  assert.equal(
    runtime.getSnapshot().state.stream['task-1'].some((block) => block.id === 'block-evicted-stale-replay'),
    false,
  );
  unsubscribe();
}

async function testBridgeRejectsStaleSeqPerScopeOnly() {
  const initialSnapshot = snapshot('task-1');
  initialSnapshot.workspace.tasks.push({ id: 'task-2', project: 'peers-touch', title: 'Second task', status: 'active' });
  initialSnapshot.workspace.streams['task-2'] = [];
  const harness = bridgeWithCall(async () => initialSnapshot);
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot,
  });
  await runtime.loadWorkspace();
  const unsubscribe = runtime.subscribe(() => {});

  harness.emit({
    id: 'evt-task-1-seq-2',
    seq: 2,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [{ kind: 'agent', id: 'task-1-block-2', text: 'task 1 latest', done: true }],
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');

  harness.emit({
    id: 'evt-task-1-stale-seq-1',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [{ kind: 'agent', id: 'task-1-stale', text: 'stale task 1 event', done: true }],
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'degraded');
  assert.deepEqual(runtime.getSnapshot().state.stream['task-1'].map((block) => block.id), ['task-1-block-2']);

  harness.emit({
    id: 'evt-task-2-seq-1',
    seq: 1,
    taskId: 'task-2',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-2',
      blocks: [{ kind: 'agent', id: 'task-2-block-1', text: 'task 2 first', done: true }],
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.deepEqual(runtime.getSnapshot().state.stream['task-2'].map((block) => block.id), ['task-2-block-1']);
  assert.deepEqual(runtime.getSnapshot().state.stream['task-1'].map((block) => block.id), ['task-1-block-2']);

  harness.emit({
    id: 'evt-workspace-seq-1',
    seq: 1,
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'task.upsert',
      task: { id: 'task-3', project: 'peers-touch', title: 'Workspace scoped task', status: 'active' },
      select: false,
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.ok(runtime.getSnapshot().state.tasks.some((task) => task.id === 'task-3'));

  unsubscribe();
}

async function testBridgeRejectsMismatchedEventPatchTaskScopeAndRecovers() {
  const initialSnapshot = snapshot('task-1');
  initialSnapshot.workspace.tasks.push({ id: 'task-2', project: 'peers-touch', title: 'Second task', status: 'active' });
  initialSnapshot.workspace.streams['task-2'] = [];
  const harness = bridgeWithCall(async () => initialSnapshot);
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot,
  });
  await runtime.loadWorkspace();
  const unsubscribe = runtime.subscribe(() => {});

  harness.emit({
    id: 'evt-snapshot-with-task-scope',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'snapshot',
      snapshot: initialSnapshot,
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'error');
  assert.ok(runtime.getSnapshot().state.tasks.some((task) => task.id === 'task-1'));

  harness.emit({
    id: 'evt-task-upsert-mismatched-task-scope',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'task.upsert',
      task: { id: 'task-3', project: 'peers-touch', title: 'mismatched upsert scope', status: 'active' },
      select: false,
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'error');
  assert.equal(runtime.getSnapshot().state.tasks.some((task) => task.id === 'task-3'), false);

  harness.emit({
    id: 'evt-task-2-seq-2',
    seq: 2,
    taskId: 'task-2',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-2',
      blocks: [{ kind: 'agent', id: 'task-2-block-2', text: 'task 2 latest', done: true }],
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.deepEqual(runtime.getSnapshot().state.stream['task-2'].map((block) => block.id), ['task-2-block-2']);

  harness.emit({
    id: 'evt-mismatched-task-1-task-2-seq-1',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-2',
      blocks: [{ kind: 'agent', id: 'task-2-cross-scope-stale', text: 'must be rejected', done: true }],
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'error');
  assert.deepEqual(runtime.getSnapshot().state.stream['task-2'].map((block) => block.id), ['task-2-block-2']);

  harness.emit({
    id: 'evt-task-2-seq-3',
    seq: 3,
    taskId: 'task-2',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-2',
      blocks: [{ kind: 'agent', id: 'task-2-block-3', text: 'task 2 recovered', done: true }],
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.deepEqual(runtime.getSnapshot().state.stream['task-2'].map((block) => block.id), ['task-2-block-2', 'task-2-block-3']);
  unsubscribe();
}

async function testBridgeSubscriptionReferenceLifecycle() {
  let subscribeCount = 0;
  let cleanupCount = 0;
  let listener;
  const runtime = createBridgeAtelierRuntime({
    bridge: {
      async call() {
        return snapshot();
      },
      subscribeProjection(nextListener) {
        subscribeCount += 1;
        listener = nextListener;
        return () => {
          cleanupCount += 1;
          listener = undefined;
        };
      },
    },
    initialSnapshot: snapshot('task-1'),
  });

  const releaseA = runtime.subscribe(() => {});
  const releaseB = runtime.subscribe(() => {});
  assert.equal(subscribeCount, 1);
  assert.equal(cleanupCount, 0);
  assert.ok(listener);

  releaseA();
  assert.equal(cleanupCount, 0);
  assert.ok(listener);

  releaseB();
  assert.equal(cleanupCount, 1);
  assert.equal(listener, undefined);

  const releaseC = runtime.subscribe(() => {});
  assert.equal(subscribeCount, 2);
  releaseC();
  assert.equal(cleanupCount, 2);
}

async function testBridgeInitialSubscriptionAckSettlement() {
  const { createBridgeAtelierRuntime } = await import('./packages/prototypes/desktop/applets/atelier/src/bridgeRuntime.ts');
  const ready = deferredPromise();
  const runtime = createBridgeAtelierRuntime({
    bridge: {
      async call() {
        return snapshot('task-1');
      },
      subscribeProjection() {
        return Object.assign(() => undefined, { ready: ready.promise });
      },
    },
    initialSnapshot: snapshot('task-1'),
  });

  const release = runtime.subscribe(() => {});
  assert.equal(runtime.getSnapshot().status?.kind, 'reconciling');
  ready.resolve();
  await Promise.resolve();
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  release();

  const rejectedReady = deferredPromise();
  const rejectedRuntime = createBridgeAtelierRuntime({
    bridge: {
      async call() {
        return snapshot('task-1');
      },
      subscribeProjection() {
        return Object.assign(() => undefined, { ready: rejectedReady.promise });
      },
    },
    initialSnapshot: snapshot('task-1'),
  });
  const rejectedRelease = rejectedRuntime.subscribe(() => {});
  assert.equal(rejectedRuntime.getSnapshot().status?.kind, 'reconciling');
  rejectedReady.reject(Object.assign(new Error('Host denied projection subscribe'), { code: 'FORBIDDEN' }));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(rejectedRuntime.getSnapshot().status?.kind, 'auth-denied');
  rejectedRelease();
}

async function testBridgeStaleInitialSubscriptionAckSettlementIsolation() {
  const { createBridgeAtelierRuntime } = await import('./packages/prototypes/desktop/applets/atelier/src/bridgeRuntime.ts');
  for (const staleSettlement of ['resolve', 'reject']) {
    const firstReady = deferredPromise();
    const secondReady = deferredPromise();
    const cleanups = [];
    const runtime = createBridgeAtelierRuntime({
      bridge: {
        async call() {
          return snapshot('task-1');
        },
        subscribeProjection() {
          const ready = cleanups.length === 0 ? firstReady.promise : secondReady.promise;
          const cleanup = Object.assign(() => undefined, { ready });
          cleanups.push(cleanup);
          return cleanup;
        },
      },
      initialSnapshot: snapshot('task-1'),
    });

    const releaseFirst = runtime.subscribe(() => {});
    assert.equal(runtime.getSnapshot().status?.kind, 'reconciling');
    releaseFirst();

    const releaseSecond = runtime.subscribe(() => {});
    assert.equal(cleanups.length, 2);
    if (staleSettlement === 'resolve') {
      firstReady.resolve();
      await Promise.resolve();
    } else {
      firstReady.reject(Object.assign(new Error('ignored stale subscription rejection'), { code: 'FORBIDDEN' }));
      await Promise.resolve();
      await Promise.resolve();
    }
    assert.equal(runtime.getSnapshot().status?.kind, 'reconciling');

    secondReady.resolve();
    await Promise.resolve();
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.doesNotMatch(
      JSON.stringify(runtime.getSnapshot()),
      /ignored stale subscription rejection|provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/,
    );
    releaseSecond();
  }
}

async function testBridgeListenerFailuresDoNotPoisonOtherSubscribers() {
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  const warned = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warned.push(args);
  };
  const seen = [];
  const releaseThrowing = runtime.subscribe((next) => {
    next.state.tasks[0].title = 'listener-mutated-title';
    throw new Error('listener failed');
  });
  const releaseHealthy = runtime.subscribe((next) => {
    seen.push(next);
  });

  try {
    harness.emit({
      id: 'evt-listener-isolation',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'task.upsert',
        task: { id: 'task-1', project: 'peers-touch', title: 'Bridge listener isolation', status: 'active' },
        select: true,
      },
    });
  } finally {
    console.warn = originalWarn;
    releaseThrowing();
    releaseHealthy();
  }

  assert.equal(warned.length >= 1, true);
  assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge listener isolation');
  assert.equal(seen.at(-1)?.state.tasks[0].title, 'Bridge listener isolation');
  assert.equal(seen.at(-1)?.status?.kind, 'ready');
}

async function testBridgeSubscriptionFailuresPreserveSnapshot() {
  const runtime = createBridgeAtelierRuntime({
    bridge: {
      async call() {
        return snapshot('task-1');
      },
      subscribeProjection() {
        throw new Error('PERMISSION_DENIED unauthorized projection stream');
      },
    },
    initialSnapshot: snapshot('task-1'),
  });
  const seen = [];

  const release = runtime.subscribe((next) => {
    seen.push(next);
  });
  try {
    assert.equal(runtime.getSnapshot().status?.kind, 'auth-denied');
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate');
    assert.equal(seen.at(-1)?.status?.kind, 'auth-denied');
    assert.equal(seen.at(-1)?.state.tasks[0].title, 'Bridge gate');
  } finally {
    release();
  }
}

async function testBridgeMalformedUnsubscribeDoesNotStickSubscription() {
  let subscribeCount = 0;
  let cleanupCount = 0;
  let malformed = true;
  const runtime = createBridgeAtelierRuntime({
    bridge: {
      async call() {
        return snapshot('task-1');
      },
      subscribeProjection() {
        subscribeCount += 1;
        if (malformed) return { invalid: true };
        return () => {
          cleanupCount += 1;
        };
      },
    },
    initialSnapshot: snapshot('task-1'),
  });

  const releaseMalformed = runtime.subscribe(() => {});
  assert.equal(subscribeCount, 1);
  assert.equal(runtime.getSnapshot().status?.kind, 'disconnected');
  assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate');
  releaseMalformed();
  assert.equal(cleanupCount, 0);

  malformed = false;
  const releaseValid = runtime.subscribe(() => {});
  assert.equal(subscribeCount, 2);
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  releaseValid();
  assert.equal(cleanupCount, 1);
}

async function testBridgeCleanupFailureClearsSubscriptionAndPreservesSnapshot() {
  let subscribeCount = 0;
  let cleanupShouldThrow = true;
  let listener;
  const runtime = createBridgeAtelierRuntime({
    bridge: {
      async call() {
        return snapshot('task-1');
      },
      subscribeProjection(nextListener) {
        subscribeCount += 1;
        listener = nextListener;
        return () => {
          listener = undefined;
          if (cleanupShouldThrow) throw new Error('projection stream cleanup disconnected');
        };
      },
    },
    initialSnapshot: snapshot('task-1'),
  });
  const warned = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warned.push(args);
  };

  const releaseFailing = runtime.subscribe(() => {});
  try {
    releaseFailing();
    assert.equal(warned.length >= 1, true);
    assert.equal(runtime.getSnapshot().status?.kind, 'disconnected');
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate');
    assert.equal(listener, undefined);

    cleanupShouldThrow = false;
    const releaseRecovered = runtime.subscribe(() => {});
    assert.equal(subscribeCount, 2);
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    releaseRecovered();
  } finally {
    console.warn = originalWarn;
  }
}

async function testBridgeEventApplyFailurePreservesSnapshotAndRecovers() {
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  const release = runtime.subscribe(() => {});

  try {
    assert.doesNotThrow(() => {
      harness.emit({
        id: 'evt-invalid-snapshot',
        seq: 1,
        receivedAt: new Date().toISOString(),
        patch: {
          kind: 'snapshot',
          snapshot: { version: ${JSON.stringify(contract.version)} },
        },
      });
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'error');
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate');

    harness.emit({
      id: 'evt-recovered-after-invalid-snapshot',
      seq: 2,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'task.upsert',
        task: { id: 'task-1', project: 'peers-touch', title: 'Recovered projection event', status: 'active' },
        select: true,
      },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Recovered projection event');
  } finally {
    release();
  }
}

async function testBridgeRejectsMalformedProjectionEventsAndRecovers() {
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  const release = runtime.subscribe(() => {});

  try {
    assert.doesNotThrow(() => {
      harness.emit({
        id: 'evt-malformed-projection-event',
        seq: 1,
        receivedAt: new Date().toISOString(),
        patch: { kind: 'unknown' },
      });
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'error');
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate');

    harness.emit(JSON.stringify({
      id: 'evt-recovered-after-malformed-event',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'task.upsert',
        task: { id: 'task-1', project: 'peers-touch', title: 'Recovered from malformed event', status: 'active' },
        select: true,
      },
    }));
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Recovered from malformed event');
  } finally {
    release();
  }
}

async function testBridgeRejectsEmptyTaskScopeEventsAndRecovers() {
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  const release = runtime.subscribe(() => {});

  try {
    assert.doesNotThrow(() => {
      harness.emit({
        id: 'evt-empty-task-scope',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: {
          kind: 'stream.append',
          taskId: '',
          blocks: [{ kind: 'agent', id: 'block-empty-scope', text: 'empty task scope', done: true }],
        },
      });
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'error');
    assert.equal(runtime.getSnapshot().state.stream[''], undefined);
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate');

    harness.emit({
      id: 'evt-recovered-after-empty-task-scope',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'stream.append',
        taskId: 'task-1',
        blocks: [{ kind: 'agent', id: 'block-after-empty-scope', text: 'recovered', done: true }],
      },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.deepEqual(runtime.getSnapshot().state.stream['task-1'].map((block) => block.id), ['block-after-empty-scope']);
  } finally {
    release();
  }
}

async function testBridgeRejectsUnknownTaskScopeEventsAndRecovers() {
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  const release = runtime.subscribe(() => {});

  try {
    harness.emit({
      id: 'evt-unknown-task-scope',
      seq: 1,
      taskId: 'task-unknown',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'stream.append',
        taskId: 'task-unknown',
        blocks: [{ kind: 'agent', id: 'block-orphan', text: 'orphan block', done: true }],
      },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'error');
    assert.equal(runtime.getSnapshot().state.stream['task-unknown'], undefined);
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate');

    harness.emit({
      id: 'evt-recovered-after-unknown-task-scope',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'stream.append',
        taskId: 'task-1',
        blocks: [{ kind: 'agent', id: 'block-after-unknown-scope', text: 'recovered', done: true }],
      },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.deepEqual(runtime.getSnapshot().state.stream['task-1'].map((block) => block.id), ['block-after-unknown-scope']);
  } finally {
    release();
  }
}

async function testBridgeRejectsMalformedStreamBlocksAndRecovers() {
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  const release = runtime.subscribe(() => {});

  try {
    assert.doesNotThrow(() => {
      harness.emit({
        id: 'evt-malformed-stream-block',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: {
          kind: 'stream.append',
          taskId: 'task-1',
          blocks: [{ kind: 'agent', text: 'missing block id', done: true }],
        },
      });
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'error');
    assert.deepEqual(runtime.getSnapshot().state.stream['task-1'], []);

    harness.emit({
      id: 'evt-malformed-decision-stream-required-fields',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'stream.append',
        taskId: 'task-1',
        blocks: [{ id: 'decision-missing-options', kind: 'decision', question: 'Approve?', spentSoFar: '$1', rollbackImpact: 'none' }],
      },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'error');
    assert.deepEqual(runtime.getSnapshot().state.stream['task-1'], []);

    harness.emit({
      id: 'evt-malformed-diff-stream-block',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'stream.append',
        taskId: 'task-1',
        blocks: [{ id: 'diff-bad', kind: 'diff', files: 1, added: 2, removed: 0, paths: ['src/a.ts', ''] }],
      },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'error');
    assert.deepEqual(runtime.getSnapshot().state.stream['task-1'], []);

    harness.emit({
      id: 'evt-recovered-after-malformed-stream-block',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'stream.append',
        taskId: 'task-1',
        blocks: [{ kind: 'agent', id: 'block-after-malformed-stream-block', text: 'recovered', done: true }],
      },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.deepEqual(runtime.getSnapshot().state.stream['task-1'].map((block) => block.id), ['block-after-malformed-stream-block']);
  } finally {
    release();
  }
}

async function testBridgeRejectsEmptyUpsertEntityIdsAndRecovers() {
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  const release = runtime.subscribe(() => {});

  try {
    for (const event of [
      {
        id: 'evt-empty-task-upsert-id',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'task.upsert', task: { id: '', project: 'peers-touch', title: 'empty task', status: 'active' }, select: true },
      },
      {
        id: 'evt-empty-artifact-upsert-id',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: '', name: 'empty artifact', kind: 'markdown', meta: 'bad' } },
      },
      {
        id: 'evt-artifact-upsert-body-leak',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-body-leak', name: 'body leak', kind: 'markdown', meta: 'bad', markdown: '# leaked body' } },
      },
      {
        id: 'evt-artifact-upsert-bad-body-ref-file',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-bad-body-ref-file', name: 'bad body ref', kind: 'markdown', meta: 'bad', bodyRef: 'file:///tmp/leak' } },
      },
      {
        id: 'evt-artifact-upsert-bad-body-ref-url',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-bad-body-ref-url', name: 'bad body ref', kind: 'markdown', meta: 'bad', bodyRef: 'https://example.invalid/body' } },
      },
      {
        id: 'evt-artifact-upsert-bad-body-ref-shape',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-bad-body-ref-shape', name: 'bad body ref shape', kind: 'markdown', meta: 'bad', bodyRef: 'artifact://task-1/body' } },
      },
      {
        id: 'evt-artifact-upsert-body-ref-task-mismatch',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-body-ref-task-mismatch', name: 'bad body ref task', kind: 'markdown', meta: 'bad', bodyRef: 'artifact://task-2/artifact-body-ref-task-mismatch/body' } },
      },
      {
        id: 'evt-artifact-upsert-body-ref-artifact-mismatch',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-body-ref-artifact-mismatch', name: 'bad body ref artifact', kind: 'markdown', meta: 'bad', bodyRef: 'artifact://task-1/artifact-other/body' } },
      },
      {
        id: 'evt-artifact-upsert-preview-target-url-leak',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-url-leak', name: 'bad preview target', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', url: 'https://example.invalid' } } },
      },
      {
        id: 'evt-artifact-upsert-preview-target-empty',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-empty', name: 'empty preview target', kind: 'markdown', meta: 'bad', previewTarget: {} } },
      },
      {
        id: 'evt-artifact-upsert-preview-target-missing-sandbox',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-missing-sandbox', name: 'missing sandbox', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', bodyRef: 'artifact://task-1/artifact-preview/body' } } },
      },
      {
        id: 'evt-artifact-upsert-preview-target-missing-body',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-missing-body', name: 'missing body', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview' } } },
      },
      {
        id: 'evt-artifact-upsert-preview-target-bad-body-ref-shape',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-bad-body-ref-shape', name: 'bad body ref shape', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview', bodyRef: 'artifact://task-1/body' } } },
      },
      {
        id: 'evt-artifact-upsert-preview-target-task-mismatch',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-task-mismatch', name: 'bad preview target task', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-2/artifact-preview-target-task-mismatch/preview', bodyRef: 'artifact://task-1/artifact-preview-target-task-mismatch/body' } } },
      },
      {
        id: 'evt-artifact-upsert-preview-target-artifact-mismatch',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'artifact.upsert', taskId: 'task-1', artifact: { id: 'artifact-preview-target-artifact-mismatch', name: 'bad preview target artifact', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact-other/preview', bodyRef: 'artifact://task-1/artifact-preview-target-artifact-mismatch/body' } } },
      },
      {
        id: 'evt-empty-gate-upsert-id',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'gate.upsert', taskId: 'task-1', gate: { id: '', name: 'empty gate', status: 'failed', summary: 'bad', checks: [] } },
      },
      {
        id: 'evt-gate-upsert-malformed-check',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'gate.upsert', taskId: 'task-1', gate: { id: 'gate-1', name: 'bad check', status: 'failed', summary: 'bad', checks: [{ name: '', status: 'failed' }] } },
      },
      {
        id: 'evt-gate-upsert-malformed-artifact-ids',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'gate.upsert', taskId: 'task-1', gate: { id: 'gate-1', name: 'bad artifact ids', status: 'failed', summary: 'bad', checks: [], artifactIds: ['ok', 42] } },
      },
    ]) {
      assert.doesNotThrow(() => harness.emit(event));
      assert.equal(runtime.getSnapshot().status?.kind, 'error');
      assert.equal(runtime.getSnapshot().selectedTaskId, 'task-1');
      assert.equal(runtime.getSnapshot().state.tasks.some((task) => task.id === ''), false);
      assert.equal(runtime.getSnapshot().state.artifacts['task-1'], undefined);
      assert.equal(runtime.getSnapshot().state.gates['task-1'], undefined);
    }

    harness.emit({
      id: 'evt-recovered-after-empty-upsert-id',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'artifact.upsert',
        taskId: 'task-1',
        artifact: { id: 'artifact-after-empty-upsert-id', name: 'recovered artifact', kind: 'markdown', meta: 'ok' },
      },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.deepEqual(runtime.getSnapshot().state.artifacts['task-1'].map((artifact) => artifact.id), ['artifact-after-empty-upsert-id']);
  } finally {
    release();
  }
}

async function testBridgeRejectsMalformedTodoItemsAndRecovers() {
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  const release = runtime.subscribe(() => {});

  try {
    for (const event of [
      {
        id: 'evt-empty-todo-id',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'todo.replace', taskId: 'task-1', todos: [{ id: '', text: 'empty id', status: 'todo' }] },
      },
      {
        id: 'evt-empty-todo-text',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'todo.replace', taskId: 'task-1', todos: [{ id: 'todo-empty-text', text: '', status: 'todo' }] },
      },
      {
        id: 'evt-unknown-todo-status',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'todo.replace', taskId: 'task-1', todos: [{ id: 'todo-unknown-status', text: 'bad status', status: 'blocked' }] },
      },
    ]) {
      assert.doesNotThrow(() => harness.emit(event));
      assert.equal(runtime.getSnapshot().status?.kind, 'error');
      assert.equal(runtime.getSnapshot().state.todos['task-1'], undefined);
    }

    harness.emit({
      id: 'evt-recovered-after-malformed-todo',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'todo.replace',
        taskId: 'task-1',
        todos: [{ id: 'todo-after-malformed', text: 'recovered todo', status: 'running' }],
      },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.deepEqual(runtime.getSnapshot().state.todos['task-1'].map((todo) => todo.id), ['todo-after-malformed']);
  } finally {
    release();
  }
}

async function testBridgeRejectsEmptyDecisionResolutionAndRecovers() {
  const initialSnapshot = snapshot('task-1');
  initialSnapshot.workspace.streams['task-1'] = [{
    kind: 'decision',
    id: 'decision-1',
    question: 'Continue?',
    spentSoFar: '$0',
    options: [{ text: 'continue', recommended: true }],
    rollbackImpact: 'none',
  }];
  const harness = bridgeWithCall(async () => initialSnapshot);
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot,
  });
  const release = runtime.subscribe(() => {});

  try {
    for (const event of [
      {
        id: 'evt-empty-decision-block',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'decision.resolved', taskId: 'task-1', blockId: '', choice: 'continue' },
      },
      {
        id: 'evt-empty-decision-choice',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'decision.resolved', taskId: 'task-1', blockId: 'decision-1', choice: '' },
      },
    ]) {
      assert.doesNotThrow(() => harness.emit(event));
      assert.equal(runtime.getSnapshot().status?.kind, 'error');
      assert.equal(runtime.getSnapshot().state.stream['task-1'][0].chosen, undefined);
    }

    harness.emit({
      id: 'evt-recovered-after-empty-decision-resolution',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: { kind: 'decision.resolved', taskId: 'task-1', blockId: 'decision-1', choice: 'continue' },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.equal(runtime.getSnapshot().state.stream['task-1'][0].chosen, 'continue');
  } finally {
    release();
  }
}

async function testBridgeRejectsMalformedTaskContextAndRecovers() {
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  const release = runtime.subscribe(() => {});

  try {
    for (const event of [
      {
        id: 'evt-context-missing-files',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'context.replace', taskId: 'task-1', context: { usedPct: 42 } },
      },
      {
        id: 'evt-context-non-finite-used',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'context.replace', taskId: 'task-1', context: { usedPct: Number.NaN, files: [] } },
      },
      {
        id: 'evt-context-empty-file-name',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'context.replace', taskId: 'task-1', context: { usedPct: 42, files: [{ name: '', group: 'files' }] } },
      },
      {
        id: 'evt-context-invalid-file-group',
        seq: 1,
        taskId: 'task-1',
        receivedAt: new Date().toISOString(),
        patch: { kind: 'context.replace', taskId: 'task-1', context: { usedPct: 42, files: [{ name: 'src/App.tsx', group: 'source' }] } },
      },
    ]) {
      assert.doesNotThrow(() => harness.emit(event));
      assert.equal(runtime.getSnapshot().status?.kind, 'error');
      assert.equal(runtime.getSnapshot().state.context['task-1'], undefined);
    }

    harness.emit({
      id: 'evt-recovered-after-malformed-context',
      seq: 1,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'context.replace',
        taskId: 'task-1',
        context: { usedPct: 42, files: [{ name: 'src/App.tsx', group: 'files' }] },
      },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.equal(runtime.getSnapshot().state.context['task-1'].usedPct, 42);
    assert.deepEqual(runtime.getSnapshot().state.context['task-1'].files.map((file) => file.name), ['src/App.tsx']);
  } finally {
    release();
  }
}

async function testBridgeErrorStatuses() {
  const copyByKind = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind;
  const authHarness = bridgeWithCall(async () => {
    throw new Error('PERMISSION_DENIED unauthorized');
  });
  const authRuntime = createBridgeAtelierRuntime({
    bridge: authHarness.bridge,
    initialSnapshot: snapshot(''),
  });
  const authSnapshot = await authRuntime.loadWorkspace();
  assert.equal(authSnapshot.status?.kind, 'auth-denied');
  assert.equal(authSnapshot.status?.title, copyByKind['auth-denied'].title, 'bridge auth-denied status title copy failed');
  assert.equal(authSnapshot.status?.detail, copyByKind['auth-denied'].detail, 'bridge auth-denied status detail copy failed');

  const disconnectedHarness = bridgeWithCall(async () => {
    throw new Error('network stream disconnected');
  });
  const disconnectedRuntime = createBridgeAtelierRuntime({
    bridge: disconnectedHarness.bridge,
    initialSnapshot: snapshot(''),
  });
  const disconnectedSnapshot = await disconnectedRuntime.loadWorkspace();
  assert.equal(disconnectedSnapshot.status?.kind, 'disconnected');
  assert.equal(disconnectedSnapshot.status?.title, copyByKind.disconnected.title, 'bridge disconnected status title copy failed');
  assert.equal(disconnectedSnapshot.status?.detail, copyByKind.disconnected.detail, 'bridge disconnected status detail copy failed');

  const invalidHarness = bridgeWithCall(async () => ({ version: ${JSON.stringify(contract.version)} }));
  const invalidRuntime = createBridgeAtelierRuntime({
    bridge: invalidHarness.bridge,
    initialSnapshot: snapshot(''),
  });
  const invalidSnapshot = await invalidRuntime.loadWorkspace();
  assert.equal(invalidSnapshot.status?.kind, 'error');
  assert.equal(invalidSnapshot.status?.title, copyByKind.error.title, 'bridge error status title copy failed');
  assert.equal(invalidSnapshot.status?.detail, 'Invalid Atelier projection snapshot', 'bridge error status must preserve dynamic detail message');

  const emptyErrorHarness = bridgeWithCall(async () => {
    throw new Error('');
  });
  const emptyErrorRuntime = createBridgeAtelierRuntime({
    bridge: emptyErrorHarness.bridge,
    initialSnapshot: snapshot(''),
  });
  const emptyErrorSnapshot = await emptyErrorRuntime.loadWorkspace();
  assert.equal(emptyErrorSnapshot.status?.kind, 'error');
  assert.equal(emptyErrorSnapshot.status?.title, copyByKind.error.title, 'bridge empty error status title copy failed');
  assert.equal(emptyErrorSnapshot.status?.detail, copyByKind.error.detail, 'bridge empty error fallback detail copy failed');
}

async function testBridgeRuntimeStatusCopyTaxonomy() {
  const copyByKind = ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind;
  const harness = bridgeWithCall(async () => snapshot('task-1'));
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  const initialStatus = runtime.getSnapshot().status;
  assert.equal(initialStatus?.kind, 'loading');
  assert.equal(initialStatus?.title, copyByKind.loading.title, 'bridge loading status title copy failed');
  assert.equal(initialStatus?.detail, copyByKind.loading.detail, 'bridge loading status detail copy failed');

  const seen = [];
  const release = runtime.subscribe((next) => {
    if (next.status) seen.push(next.status);
  });
  try {
    assert.equal(seen[0]?.kind, 'reconciling');
    assert.equal(seen[0]?.title, copyByKind.reconciling.title, 'bridge reconciling status title copy failed');
    assert.equal(seen[0]?.detail, copyByKind.reconciling.detail, 'bridge reconciling status detail copy failed');
    assert.equal(seen[1]?.kind, 'ready');

    harness.emit({
      id: 'evt-bridge-copy-ready',
      seq: 3,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'stream.append',
        taskId: 'task-1',
        blocks: [{ kind: 'agent', id: 'copy-ready-block', text: 'ready copy', done: true }],
      },
    });
    const readyStatusAfterEvent = runtime.getSnapshot().status;
    assert.equal(readyStatusAfterEvent?.kind, 'ready');
    assert.equal(readyStatusAfterEvent?.title, copyByKind.ready.title, 'bridge event ready status title copy failed');
    assert.equal(readyStatusAfterEvent?.detail, copyByKind.ready.detail, 'bridge event ready status detail copy failed');

    harness.emit({
      id: 'evt-bridge-copy-degraded',
      seq: 2,
      taskId: 'task-1',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'stream.append',
        taskId: 'task-1',
        blocks: [{ kind: 'agent', id: 'copy-degraded-block', text: 'stale copy', done: true }],
      },
    });
    const degradedStatusAfterStaleEvent = runtime.getSnapshot().status;
    assert.equal(degradedStatusAfterStaleEvent?.kind, 'degraded');
    assert.equal(degradedStatusAfterStaleEvent?.title, copyByKind.degraded.title, 'bridge degraded status title copy failed');
    assert.equal(degradedStatusAfterStaleEvent?.detail, copyByKind.degraded.detail, 'bridge degraded status detail copy failed');
  } finally {
    release();
  }
}

async function testAppletBridgeNormalizesHostErrorEnvelopes() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const hostErrorCases = [
    {
      name: 'resolved forbidden error envelope',
      response: { error: { code: 'FORBIDDEN', message: 'Station denied Atelier projection access' } },
      expectedStatus: 'auth-denied',
      expectedMessage: /FORBIDDEN Station denied Atelier projection access/,
      expectedCode: 'FORBIDDEN',
    },
    {
      name: 'rejected network error object',
      reject: { code: 'NETWORK_DISCONNECTED', message: 'Station projection stream disconnected' },
      expectedStatus: 'disconnected',
      expectedMessage: /NETWORK_DISCONNECTED Station projection stream disconnected/,
      expectedCode: 'NETWORK_DISCONNECTED',
    },
    {
      name: 'rejected Error with code property',
      reject: Object.assign(new Error('Desktop Host request timed out'), { code: 'TIMEOUT' }),
      expectedStatus: 'disconnected',
      expectedMessage: /TIMEOUT Desktop Host request timed out/,
      expectedCode: 'TIMEOUT',
    },
    {
      name: 'code-only forbidden envelope maps structurally',
      response: { error: { code: 'PERMISSION_DENIED', message: 'Access rejected without legacy auth keyword' } },
      expectedStatus: 'auth-denied',
      expectedMessage: /PERMISSION_DENIED Access rejected without legacy auth keyword/,
      expectedCode: 'PERMISSION_DENIED',
    },
    {
      name: 'code-only disconnected envelope maps structurally',
      response: { error: { code: 'CONNECTION_CLOSED', message: 'Station closed channel' } },
      expectedStatus: 'disconnected',
      expectedMessage: /CONNECTION_CLOSED Station closed channel/,
      expectedCode: 'CONNECTION_CLOSED',
    },
    {
      name: 'unknown structured code remains generic error',
      response: { error: { code: 'CAPABILITY_FAILED', message: 'Host returned bad response shape' } },
      expectedStatus: 'error',
      expectedMessage: /CAPABILITY_FAILED Host returned bad response shape/,
      expectedCode: 'CAPABILITY_FAILED',
    },
  ];

  for (const testCase of hostErrorCases) {
    const host = {
      async invoke(method, params) {
        assert.equal(method, 'atelier.workspace.load');
        assert.deepEqual(params, {});
        if ('reject' in testCase) throw testCase.reject;
        return testCase.response;
      },
      onEvent() {
        return () => {};
      },
    };
    const runtime = createBridgeAtelierRuntime({
      bridge: createAppletSdkAtelierBridge(host),
      initialSnapshot: snapshot(''),
    });
    const loaded = await runtime.loadWorkspace();
    assert.equal(loaded.status?.kind, testCase.expectedStatus, testCase.name);
    await assert.rejects(
      async () => {
        try {
          await createAppletSdkAtelierBridge(host).call({ method: 'atelier.workspace.load', payload: {} });
        } catch (error) {
          if (testCase.expectedCode) {
            assert.equal(error?.code, testCase.expectedCode, testCase.name);
          }
          throw error;
        }
      },
      testCase.expectedMessage,
      testCase.name,
    );
  }
}

async function testBridgeNonSnapshotErrorsUpdateStatus() {
  for (const { error, expectedKind, expectedRetryable, expectedMessage } of [
    {
      error: new Error('FORBIDDEN provider discovery'),
      expectedKind: 'auth-denied',
      expectedRetryable: false,
      expectedMessage: /FORBIDDEN provider discovery/,
    },
    {
      error: Object.assign(new Error('opaque provider discovery'), { code: 'CONNECTION_CLOSED' }),
      expectedKind: 'disconnected',
      expectedRetryable: true,
      expectedMessage: /opaque provider discovery/,
    },
    {
      error: new Error('CAPABILITY_FAILED provider discovery'),
      expectedKind: 'error',
      expectedRetryable: true,
      expectedMessage: /CAPABILITY_FAILED provider discovery/,
    },
  ]) {
    const harness = bridgeWithCall(async (request) => {
      assert.equal(request.method, 'atelier.provider.capabilities');
      throw error;
    });
    const runtime = createBridgeAtelierRuntime({
      bridge: harness.bridge,
      initialSnapshot: snapshot('task-1'),
    });
    await assert.rejects(
      () => runtime.listProviderCapabilities({ taskId: 'task-1' }),
      expectedMessage,
    );
    assert.equal(runtime.getSnapshot().status?.kind, expectedKind);
    assert.equal(runtime.getSnapshot().status?.retryable, expectedRetryable);
    assert.equal(runtime.getSnapshot().state.selectedTaskId, 'task-1');
  }
}

async function testBridgeNonSnapshotSuccessRestoresStatus() {
  const harness = bridgeWithCall(async (request) => {
    if (request.method === 'atelier.workspace.load') return snapshot('task-1');
    if (request.method === 'atelier.provider.capabilities') {
      return {
        source: 'station.provider.capabilities',
        capabilities: [],
      };
    }
    if (request.method === 'atelier.memory.confirmCandidate') {
      return {
        accepted: true,
        feedbackId: 'feedback-memory-1',
        memoryId: 'memory-1',
        status: 'confirmed',
        source: 'atelier.memory.confirmCandidate',
        alreadyDone: false,
      };
    }
    assert.equal(request.method, 'atelier.feedback.confirmRerun');
    return {
      accepted: true,
      feedbackId: 'feedback-rerun-1',
      taskId: 'task-1',
      rerunTaskId: 'task-rerun-1',
      status: 'created',
      source: 'atelier.feedback.confirmRerun',
      alreadyDone: false,
      started: false,
    };
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  await runtime.loadWorkspace();
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  await runtime.listProviderCapabilities({ taskId: 'task-1' });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  await runtime.confirmMemoryCandidate({ taskId: 'task-1', feedbackId: 'feedback-memory-1' });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  await runtime.confirmRerun({ taskId: 'task-1', feedbackId: 'feedback-rerun-1' });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
}

async function testBridgeNonSnapshotStaleSuccessDoesNotClearNewerError() {
  let resolveProviderCapabilities;
  const providerCapabilities = new Promise((resolve) => {
    resolveProviderCapabilities = resolve;
  });
  const harness = bridgeWithCall(async (request) => {
    if (request.method === 'atelier.workspace.load') return snapshot('task-1');
    if (request.method === 'atelier.provider.capabilities') return providerCapabilities;
    assert.equal(request.method, 'atelier.memory.confirmCandidate');
    throw new Error('FORBIDDEN memory confirmation');
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  await runtime.loadWorkspace();
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');

  const staleSuccess = runtime.listProviderCapabilities({ taskId: 'task-1' });
  assert.equal(runtime.getSnapshot().status?.kind, 'loading');
  await assert.rejects(
    () => runtime.confirmMemoryCandidate({ taskId: 'task-1', feedbackId: 'feedback-memory-1' }),
    /FORBIDDEN memory confirmation/,
  );
  assert.equal(runtime.getSnapshot().status?.kind, 'auth-denied');

  resolveProviderCapabilities({
    source: 'station.provider.capabilities',
    capabilities: [],
  });
  await staleSuccess;
  assert.equal(runtime.getSnapshot().status?.kind, 'auth-denied');
}

async function testBridgeNonSnapshotStaleFailureDoesNotClearNewerSuccess() {
  let rejectProviderCapabilities;
  const providerCapabilities = new Promise((_, reject) => {
    rejectProviderCapabilities = reject;
  });
  const harness = bridgeWithCall(async (request) => {
    if (request.method === 'atelier.workspace.load') return snapshot('task-1');
    if (request.method === 'atelier.provider.capabilities') return providerCapabilities;
    assert.equal(request.method, 'atelier.memory.confirmCandidate');
    return {
      accepted: true,
      feedbackId: 'feedback-memory-1',
      memoryId: 'memory-1',
      status: 'confirmed',
      source: 'atelier.memory.confirmCandidate',
      alreadyDone: false,
    };
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  await runtime.loadWorkspace();
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');

  const staleFailure = runtime.listProviderCapabilities({ taskId: 'task-1' });
  assert.equal(runtime.getSnapshot().status?.kind, 'loading');
  await runtime.confirmMemoryCandidate({ taskId: 'task-1', feedbackId: 'feedback-memory-1' });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');

  rejectProviderCapabilities(new Error('FORBIDDEN provider discovery'));
  await assert.rejects(() => staleFailure, /FORBIDDEN provider discovery/);
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
}

async function testBridgeSnapshotStaleSuccessDoesNotOverwriteNewerSnapshot() {
  let resolveLoadWorkspace;
  const loadWorkspace = new Promise((resolve) => {
    resolveLoadWorkspace = resolve;
  });
  const harness = bridgeWithCall(async (request) => {
    if (request.method === 'atelier.workspace.load') return loadWorkspace;
    assert.equal(request.method, 'atelier.message.send');
    return snapshot('task-newer');
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-initial'),
  });

  const staleSuccess = runtime.loadWorkspace();
  assert.equal(runtime.getSnapshot().status?.kind, 'loading');
  const newerSnapshot = await runtime.sendMessage({ taskId: 'task-initial', text: 'newer snapshot owner' });
  assert.equal(newerSnapshot.state.selectedTaskId, 'task-newer');
  assert.equal(runtime.getSnapshot().state.selectedTaskId, 'task-newer');
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');

  resolveLoadWorkspace(snapshot('task-stale'));
  const staleResult = await staleSuccess;
  assert.equal(staleResult.state.selectedTaskId, 'task-newer');
  assert.equal(runtime.getSnapshot().state.selectedTaskId, 'task-newer');
  assert.equal(runtime.getSnapshot().state.tasks.some((task) => task.id === 'task-stale'), false);
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
}

async function testBridgeSnapshotStaleSuccessDoesNotOverwriteFresherEvent() {
  let resolveLoadWorkspace;
  const loadWorkspace = new Promise((resolve) => {
    resolveLoadWorkspace = resolve;
  });
  const harness = bridgeWithCall(async (request) => {
    assert.equal(request.method, 'atelier.workspace.load');
    return loadWorkspace;
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });

  const release = runtime.subscribe(() => {});
  const staleSuccess = runtime.loadWorkspace();
  assert.equal(runtime.getSnapshot().status?.kind, 'loading');

  harness.emit({
    id: 'evt-fresher-than-load-workspace',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [{ kind: 'agent', id: 'block-from-fresher-event', text: 'fresher event owns projection', done: true }],
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.deepEqual(runtime.getSnapshot().state.stream['task-1'].map((block) => block.id), ['block-from-fresher-event']);

  resolveLoadWorkspace(snapshot('task-stale'));
  const staleResult = await staleSuccess;
  assert.deepEqual(staleResult.state.stream['task-1'].map((block) => block.id), ['block-from-fresher-event']);
  assert.deepEqual(runtime.getSnapshot().state.stream['task-1'].map((block) => block.id), ['block-from-fresher-event']);
  assert.equal(runtime.getSnapshot().state.tasks.some((task) => task.id === 'task-stale'), false);
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  release();
}

async function testBridgeSnapshotStaleFailureDoesNotClearFresherEvent() {
  let rejectLoadWorkspace;
  const loadWorkspace = new Promise((_, reject) => {
    rejectLoadWorkspace = reject;
  });
  const harness = bridgeWithCall(async (request) => {
    assert.equal(request.method, 'atelier.workspace.load');
    return loadWorkspace;
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });

  const release = runtime.subscribe(() => {});
  const staleFailure = runtime.loadWorkspace();
  assert.equal(runtime.getSnapshot().status?.kind, 'loading');

  harness.emit({
    id: 'evt-fresher-than-failed-load-workspace',
    seq: 1,
    taskId: 'task-1',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'stream.append',
      taskId: 'task-1',
      blocks: [{ kind: 'agent', id: 'block-survives-stale-failure', text: 'fresher event survives stale failure', done: true }],
    },
  });
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.deepEqual(runtime.getSnapshot().state.stream['task-1'].map((block) => block.id), ['block-survives-stale-failure']);

  rejectLoadWorkspace(new Error('FORBIDDEN stale workspace load after fresher event'));
  const staleResult = await staleFailure;
  assert.deepEqual(staleResult.state.stream['task-1'].map((block) => block.id), ['block-survives-stale-failure']);
  assert.deepEqual(runtime.getSnapshot().state.stream['task-1'].map((block) => block.id), ['block-survives-stale-failure']);
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  release();
}

async function testBridgeSnapshotStaleSuccessAfterLocalModelIntentRestoresStatus() {
  let resolveLoadWorkspace;
  const loadWorkspace = new Promise((resolve) => {
    resolveLoadWorkspace = resolve;
  });
  const harness = bridgeWithCall(async (request) => {
    assert.equal(request.method, 'atelier.workspace.load');
    return loadWorkspace;
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });

  const staleSuccess = runtime.loadWorkspace();
  assert.equal(runtime.getSnapshot().status?.kind, 'loading');
  await runtime.setModel('local-model-intent');
  assert.equal(runtime.getSnapshot().state.model, 'local-model-intent');
  assert.equal(runtime.getSnapshot().status?.kind, 'loading');

  resolveLoadWorkspace(snapshot('task-stale'));
  const staleResult = await staleSuccess;
  assert.equal(staleResult.state.model, 'local-model-intent');
  assert.equal(runtime.getSnapshot().state.model, 'local-model-intent');
  assert.equal(runtime.getSnapshot().state.tasks.some((task) => task.id === 'task-stale'), false);
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
}

async function testBridgeSnapshotStaleFailureAfterLocalModelIntentRestoresStatus() {
  let rejectLoadWorkspace;
  const loadWorkspace = new Promise((_, reject) => {
    rejectLoadWorkspace = reject;
  });
  const harness = bridgeWithCall(async (request) => {
    assert.equal(request.method, 'atelier.workspace.load');
    return loadWorkspace;
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });

  const staleFailure = runtime.loadWorkspace();
  assert.equal(runtime.getSnapshot().status?.kind, 'loading');
  await runtime.setModel('local-model-intent-after-failure');
  assert.equal(runtime.getSnapshot().state.model, 'local-model-intent-after-failure');
  assert.equal(runtime.getSnapshot().status?.kind, 'loading');

  rejectLoadWorkspace(new Error('FORBIDDEN stale workspace load after local model intent'));
  const staleResult = await staleFailure;
  assert.equal(staleResult.state.model, 'local-model-intent-after-failure');
  assert.equal(runtime.getSnapshot().state.model, 'local-model-intent-after-failure');
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
}

async function testBridgeSnapshotCurrentFailureStillWritesTypedRecovery() {
  for (const { error, expectedKind, expectedRetryable } of [
    {
      error: new Error('PERMISSION_DENIED current workspace load'),
      expectedKind: 'auth-denied',
      expectedRetryable: false,
    },
    {
      error: Object.assign(new Error('opaque current workspace load'), { code: 'CONNECTION_CLOSED' }),
      expectedKind: 'disconnected',
      expectedRetryable: true,
    },
    {
      error: new Error('CAPABILITY_FAILED current workspace load'),
      expectedKind: 'error',
      expectedRetryable: true,
    },
  ]) {
    const harness = bridgeWithCall(async (request) => {
      assert.equal(request.method, 'atelier.workspace.load');
      throw error;
    });
    const runtime = createBridgeAtelierRuntime({
      bridge: harness.bridge,
      initialSnapshot: snapshot('task-1'),
    });

    const failedSnapshot = await runtime.loadWorkspace();
    assert.equal(failedSnapshot.status?.kind, expectedKind);
    assert.equal(failedSnapshot.status?.retryable, expectedRetryable);
    assert.equal(runtime.getSnapshot().status?.kind, expectedKind);
    assert.equal(runtime.getSnapshot().status?.retryable, expectedRetryable);
    assert.equal(runtime.getSnapshot().state.selectedTaskId, 'task-1');
  }
}

async function testBridgeSnapshotStaleFailureDoesNotClearNewerSnapshot() {
  let rejectLoadWorkspace;
  const loadWorkspace = new Promise((_, reject) => {
    rejectLoadWorkspace = reject;
  });
  const harness = bridgeWithCall(async (request) => {
    if (request.method === 'atelier.workspace.load') return loadWorkspace;
    assert.equal(request.method, 'atelier.message.send');
    return snapshot('task-newer');
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-initial'),
  });

  const staleFailure = runtime.loadWorkspace();
  assert.equal(runtime.getSnapshot().status?.kind, 'loading');
  await runtime.sendMessage({ taskId: 'task-initial', text: 'newer snapshot owner' });
  assert.equal(runtime.getSnapshot().state.selectedTaskId, 'task-newer');
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');

  rejectLoadWorkspace(new Error('FORBIDDEN stale workspace load'));
  const staleResult = await staleFailure;
  assert.equal(staleResult.state.selectedTaskId, 'task-newer');
  assert.equal(runtime.getSnapshot().state.selectedTaskId, 'task-newer');
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
}

function testPrototypeRecoveryViewMatrix() {
  const cases = [
    ['loading shows loading symbol', { kind: 'loading', title: 'Loading', detail: 'Loading' }, { severity: 'info', symbol: '◌', retryVisible: false }],
    ['empty shows creation affordance', { kind: 'empty', title: 'Empty', detail: 'Empty' }, { severity: 'info', symbol: '+', retryVisible: false }],
    ['auth-denied is danger without retry', { kind: 'auth-denied', title: 'Denied', detail: 'Denied', retryable: false }, { severity: 'danger', symbol: '!', retryVisible: false }],
    ['auth-denied ignores stale retryable flag', { kind: 'auth-denied', title: 'Denied', detail: 'Denied', retryable: true }, { severity: 'danger', symbol: '!', retryVisible: false }],
    ['disconnected is warning retry state', { kind: 'disconnected', title: 'Disconnected', detail: 'Disconnected', retryable: true }, { severity: 'warning', symbol: '↻', retryVisible: true }],
    ['degraded uses warning symbol but is not retryable outside generated retryable kinds', { kind: 'degraded', title: 'Degraded', detail: 'Degraded', retryable: true, lastEventSeq: 7 }, { severity: 'warning', symbol: '↻', retryVisible: false }],
    ['reconciling is warning without retry unless marked', { kind: 'reconciling', title: 'Reconciling', detail: 'Reconciling' }, { severity: 'warning', symbol: '↻', retryVisible: false }],
    ['error is danger without retry unless marked', { kind: 'error', title: 'Error', detail: 'Error' }, { severity: 'danger', symbol: '!', retryVisible: false }],
    ['error obeys generated retryable kind when runtime marks retryable', { kind: 'error', title: 'Error', detail: 'Error', retryable: true }, { severity: 'danger', symbol: '!', retryVisible: true }],
    ['ready shows steady-state success symbol', { kind: 'ready', title: 'Ready', detail: 'Ready' }, { severity: 'info', symbol: '✓', retryVisible: false }],
  ];
  for (const [name, status, expected] of cases) {
    assert.deepEqual(derivePrototypeRecoveryView(status), expected, 'prototype recovery view matrix failed: ' + name);
  }
  assert.deepEqual(
    [...new Set(cases.map(([, status]) => status.kind))].sort(),
    [...ATELIER_VIEW_STATUSES].sort(),
    'prototype recovery view matrix must cover every generated view status',
  );
  assert.deepEqual(
    Object.fromEntries(cases.map(([, status, expected]) => [status.kind, expected.severity])),
    ATELIER_PROTOTYPE_RECOVERY_SEVERITY_BY_STATUS,
    'prototype recovery severity matrix must match generated severity taxonomy',
  );
  assert.deepEqual(
    Object.fromEntries(cases.map(([, status, expected]) => [status.kind, expected.symbol])),
    ATELIER_PROTOTYPE_RECOVERY_SYMBOL_BY_STATUS,
    'prototype recovery symbol matrix must match generated symbol taxonomy',
  );
  assert.deepEqual(
    [...new Set(cases.filter(([, status, expected]) => status.retryable === true && expected.retryVisible).map(([, status]) => status.kind))].sort(),
    [...ATELIER_RECOVERY_RETRYABLE_KINDS].sort(),
    'prototype recovery retry visibility matrix must cover every generated retryable recovery kind',
  );
  assert.ok(
    prototypeRecoveryViewTestSource.includes('uses generated severity and symbol taxonomy for stable prototype visuals') &&
      prototypeRecoveryViewTestSource.includes('shows retry only when runtime retryable and generated retry taxonomy agree') &&
      prototypeRecoveryViewTestSource.includes('derivePrototypeRecoveryView(prototypeStatusForScenario') &&
      prototypeRecoveryViewTestSource.includes('retryable: true') &&
      prototypeRecoveryViewTestSource.includes('retryVisible: false'),
    'prototype recovery view generated source unit matrix must be present in prototypeRecoveryView.test.ts',
  );
  const actionPolicyCases = [
    ['ready empty exposes create-project only', { status: { kind: 'ready', title: 'Ready', detail: 'Ready' }, streamLength: 0 }, { primaryAction: 'create-project', createProjectVisible: true, retryVisible: false }],
    ['empty status exposes create-project only', { status: { kind: 'empty', title: 'Empty', detail: 'Empty' }, streamLength: 0 }, { primaryAction: 'create-project', createProjectVisible: true, retryVisible: false }],
    ['loading exposes no primary action', { status: { kind: 'loading', title: 'Loading', detail: 'Loading' }, streamLength: 2 }, { primaryAction: 'none', createProjectVisible: false, retryVisible: false }],
    ['auth-denied exposes no retry or create action', { status: { kind: 'auth-denied', title: 'Denied', detail: 'Denied', retryable: true }, streamLength: 2 }, { primaryAction: 'none', createProjectVisible: false, retryVisible: false }],
    ['disconnected exposes retry only', { status: { kind: 'disconnected', title: 'Disconnected', detail: 'Disconnected', retryable: true }, streamLength: 2 }, { primaryAction: 'retry', createProjectVisible: false, retryVisible: true }],
    ['error exposes retry only when retryable', { status: { kind: 'error', title: 'Error', detail: 'Error', retryable: true }, streamLength: 0 }, { primaryAction: 'retry', createProjectVisible: false, retryVisible: true }],
    ['degraded preserves stream without primary action', { status: { kind: 'degraded', title: 'Degraded', detail: 'Degraded', lastEventSeq: 7 }, streamLength: 2 }, { primaryAction: 'none', createProjectVisible: false, retryVisible: false }],
  ];
  for (const [name, input, expected] of actionPolicyCases) {
    const actual = derivePrototypeStatusActionPolicy(input);
    assert.deepEqual(actual, expected, 'prototype status action policy matrix failed: ' + name);
    assert.equal(isPrototypeStatusActionPolicyConsistent(actual), true, 'prototype status action policy must keep primary action and visibility flags consistent: ' + name);
    assert.deepEqual(
      Object.keys(actual).sort(),
      ['createProjectVisible', 'primaryAction', 'retryVisible'],
      'prototype status action policy must expose only projection UI fields: ' + name,
    );
    assert.doesNotMatch(
      JSON.stringify(actual),
      /provider\.invoke|gate\.run|artifact\.write|trace\.write|checkpoint\.write|resume\.execute|memory\.write|input_snapshot|shell|file\.write|run\.execute/,
      'prototype status action policy must stay projection-only: ' + name,
    );
  }
  assert.deepEqual(
    [...new Set(actionPolicyCases.map(([, , expected]) => expected.primaryAction))].sort(),
    ['create-project', 'none', 'retry'],
    'prototype status action policy matrix must cover create, retry, and no-action outcomes',
  );
  for (const [name, policy] of [
    ['create action without create visibility', { primaryAction: 'create-project', createProjectVisible: false, retryVisible: false }],
    ['retry action with both actions visible', { primaryAction: 'retry', createProjectVisible: true, retryVisible: true }],
    ['none action with retry visible', { primaryAction: 'none', createProjectVisible: false, retryVisible: true }],
  ]) {
    assert.equal(isPrototypeStatusActionPolicyConsistent(policy), false, 'prototype status action policy consistency guard must reject ' + name);
  }
  function expectedPrototypeGeneratedStatusActionPolicy(status, streamLength) {
    if (status === 'empty' || (status === 'ready' && streamLength === 0)) {
      return { primaryAction: 'create-project', createProjectVisible: true, retryVisible: false };
    }
    if (status === 'disconnected' || status === 'error') {
      return { primaryAction: 'retry', createProjectVisible: false, retryVisible: true };
    }
    return { primaryAction: 'none', createProjectVisible: false, retryVisible: false };
  }
  for (const streamLength of [0, 2]) {
    const coveredStatuses = [];
    for (const status of ATELIER_VIEW_STATUSES) {
      const policy = derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario(status), streamLength });
      coveredStatuses.push(status);
      assert.deepEqual(policy, expectedPrototypeGeneratedStatusActionPolicy(status, streamLength), 'prototype generated view status action policy matrix failed: ' + status + ' streamLength=' + streamLength);
      assert.equal(isPrototypeStatusActionPolicyConsistent(policy), true, 'prototype generated view status action policy must be consistent: ' + status + ' streamLength=' + streamLength);
    }
    assert.deepEqual(coveredStatuses, [...ATELIER_VIEW_STATUSES], 'prototype status action policy generated matrix must cover every generated view status for streamLength=' + streamLength);
  }
  assert.ok(
    prototypeRecoveryViewTestSource.includes('covers every generated view status in the action policy matrix') &&
      prototypeRecoveryViewTestSource.includes('derivePrototypeStatusActionPolicy({ status: prototypeStatusForScenario(status), streamLength })') &&
      prototypeRecoveryViewTestSource.includes("Object.keys(policy).sort()).toEqual(['createProjectVisible', 'primaryAction', 'retryVisible'])") &&
      prototypeRecoveryViewTestSource.includes('provider\\\\.invoke|gate\\\\.run|artifact\\\\.write'),
    'prototype status action policy generated source unit matrix must be present in prototypeRecoveryView.test.ts',
  );
  const pageSurfaceCases = [
    ['ready empty shows empty affordance', { status: { kind: 'ready', title: 'Ready', detail: 'Ready' }, streamLength: 0 }, { recoveryStatus: undefined, emptyVisible: true, streamVisible: false }],
    ['ready stream shows stream only', { status: { kind: 'ready', title: 'Ready', detail: 'Ready' }, streamLength: 2 }, { recoveryStatus: undefined, emptyVisible: false, streamVisible: true }],
    ['loading owns page surface', { status: { kind: 'loading', title: 'Loading', detail: 'Loading' }, streamLength: 2 }, { recoveryStatus: { kind: 'loading', title: 'Loading', detail: 'Loading' }, emptyVisible: false, streamVisible: false }],
    ['empty status owns recovery panel without duplicate empty affordance', { status: { kind: 'empty', title: 'Empty', detail: 'Empty' }, streamLength: 0 }, { recoveryStatus: { kind: 'empty', title: 'Empty', detail: 'Empty' }, emptyVisible: false, streamVisible: false }],
    ['disconnected empty stream shows recovery panel without empty affordance', { status: { kind: 'disconnected', title: 'Disconnected', detail: 'Disconnected', retryable: true }, streamLength: 0 }, { recoveryStatus: { kind: 'disconnected', title: 'Disconnected', detail: 'Disconnected', retryable: true }, emptyVisible: false, streamVisible: false }],
    ['disconnected preserves stream with recovery panel', { status: { kind: 'disconnected', title: 'Disconnected', detail: 'Disconnected', retryable: true }, streamLength: 2 }, { recoveryStatus: { kind: 'disconnected', title: 'Disconnected', detail: 'Disconnected', retryable: true }, emptyVisible: false, streamVisible: true }],
    ['auth-denied empty stream shows recovery panel without empty affordance', { status: { kind: 'auth-denied', title: 'Denied', detail: 'Denied' }, streamLength: 0 }, { recoveryStatus: { kind: 'auth-denied', title: 'Denied', detail: 'Denied' }, emptyVisible: false, streamVisible: false }],
    ['auth-denied preserves stream with recovery panel', { status: { kind: 'auth-denied', title: 'Denied', detail: 'Denied' }, streamLength: 2 }, { recoveryStatus: { kind: 'auth-denied', title: 'Denied', detail: 'Denied' }, emptyVisible: false, streamVisible: true }],
    ['reconciling empty shows recovery panel without empty affordance', { status: { kind: 'reconciling', title: 'Reconciling', detail: 'Reconciling' }, streamLength: 0 }, { recoveryStatus: { kind: 'reconciling', title: 'Reconciling', detail: 'Reconciling' }, emptyVisible: false, streamVisible: false }],
    ['degraded preserves stream with recovery panel', { status: { kind: 'degraded', title: 'Degraded', detail: 'Degraded', lastEventSeq: 7 }, streamLength: 2 }, { recoveryStatus: { kind: 'degraded', title: 'Degraded', detail: 'Degraded', lastEventSeq: 7 }, emptyVisible: false, streamVisible: true }],
    ['error empty stream shows recovery panel without empty affordance', { status: { kind: 'error', title: 'Error', detail: 'Error', retryable: true }, streamLength: 0 }, { recoveryStatus: { kind: 'error', title: 'Error', detail: 'Error', retryable: true }, emptyVisible: false, streamVisible: false }],
    ['error preserves stream with recovery panel', { status: { kind: 'error', title: 'Error', detail: 'Error', retryable: true }, streamLength: 2 }, { recoveryStatus: { kind: 'error', title: 'Error', detail: 'Error', retryable: true }, emptyVisible: false, streamVisible: true }],
    ['missing status with stream shows stream', { status: undefined, streamLength: 2 }, { recoveryStatus: undefined, emptyVisible: false, streamVisible: true }],
  ];
  for (const [name, input, expected] of pageSurfaceCases) {
    assert.deepEqual(derivePrototypePageSurface(input), expected, 'prototype page surface matrix failed: ' + name);
  }
  assert.deepEqual(
    [...new Set(pageSurfaceCases.map(([, input]) => input.status?.kind).filter(Boolean))].sort(),
    [...ATELIER_VIEW_STATUSES].sort(),
    'prototype page surface matrix must cover every generated view status',
  );

  const scenarioCases = [
    ['loading query scenario', '?atelierStatus=loading', { kind: 'loading', retryable: undefined }],
    ['empty query scenario', '?atelierStatus=empty', { kind: 'empty', retryable: undefined }],
    ['ready query scenario', '?atelierStatus=ready', { kind: 'ready', retryable: undefined }],
    ['reconciling query scenario', '?atelierStatus=reconciling', { kind: 'reconciling', retryable: undefined }],
    ['degraded query scenario', '?atelierStatus=degraded', { kind: 'degraded', retryable: undefined }],
    ['disconnected query scenario', '?atelierStatus=disconnected', { kind: 'disconnected', retryable: true }],
    ['auth-denied query scenario', '?atelierStatus=auth-denied', { kind: 'auth-denied', retryable: false }],
    ['error query scenario', '?atelierStatus=error', { kind: 'error', retryable: true }],
  ];
  for (const [name, search, expected] of scenarioCases) {
    const scenario = resolvePrototypeStatusScenario(search);
    assert.equal(scenario, expected.kind, 'prototype controlled status scenario query failed: ' + name);
    const status = prototypeStatusForScenario(scenario);
    assert.equal(status.kind, expected.kind, 'prototype controlled status scenario kind failed: ' + name);
    assert.equal(status.retryable, expected.retryable, 'prototype controlled status scenario retry boundary failed: ' + name);
    assert.equal(status.title, ATELIER_VIEW_SURFACE.prototypeStatusScenarioCopyByStatus[expected.kind].title, 'prototype controlled status scenario title copy failed: ' + name);
    assert.equal(status.detail, ATELIER_VIEW_SURFACE.prototypeStatusScenarioCopyByStatus[expected.kind].detail, 'prototype controlled status scenario detail copy failed: ' + name);
  }
  assert.deepEqual(
    scenarioCases.map(([, , expected]) => expected.kind).sort(),
    [...ATELIER_VIEW_STATUSES].sort(),
    'prototype controlled status scenarios must cover every generated view status',
  );
  assert.equal(resolvePrototypeStatusScenario('?atelierStatus=execute'), undefined, 'prototype controlled status scenario must reject execution-shaped status');
  assert.equal(resolvePrototypeStatusScenario('?atelierStatus=runtime.logs.subscribe'), undefined, 'prototype controlled status scenario must reject runtime capability-shaped status');
}

async function testAppletBridgeCanonicalTopicLifecycle() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const initialSnapshot = snapshot('task-cleanup');
  const harness = appletHostWithEventTracking(initialSnapshot);
  const bridge = createAppletSdkAtelierBridge(harness.host);

  const seen = [];
  const unsubscribe = bridge.subscribeProjection((payload) => {
    seen.push(payload);
  });
  await unsubscribe.ready;
  assert.deepEqual(harness.calls.map((call) => call.method), ['events.subscribe']);
  assert.deepEqual(
    harness.calls.find((call) => call.method === 'events.subscribe')?.params,
    { topic: ATELIER_PROJECTION_EVENT_TOPIC },
  );
  assert.deepEqual(harness.eventSubscriptions.map((entry) => entry.topic), [ATELIER_PROJECTION_EVENT_TOPIC]);

  harness.emit(ATELIER_PROJECTION_EVENT_TOPIC, {
    id: 'evt-before-successful-release',
    seq: 8,
    taskId: 'task-cleanup',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'task.upsert',
      task: { id: 'task-cleanup', project: 'peers-touch', title: 'before successful release', status: 'active' },
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, 'evt-before-successful-release');

  unsubscribe();
  assert.deepEqual(harness.eventUnsubscriptions.map((entry) => entry.topic), [ATELIER_PROJECTION_EVENT_TOPIC]);
  assert.deepEqual(harness.calls.at(-1), {
    method: 'events.unsubscribe',
    params: { topic: ATELIER_PROJECTION_EVENT_TOPIC },
  });
  harness.emit(ATELIER_PROJECTION_EVENT_TOPIC, {
    id: 'evt-after-successful-release',
    seq: 9,
    taskId: 'task-cleanup',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'task.upsert',
      task: { id: 'task-cleanup', project: 'peers-touch', title: 'after successful release', status: 'active' },
    },
  });
  assert.equal(
    seen.some((payload) => payload.id === 'evt-after-successful-release'),
    false,
    'successful subscription release must remove the local event handler before late Host events',
  );
  unsubscribe();
  assert.equal(
    harness.calls.filter((call) => call.method === 'events.unsubscribe').length,
    1,
    'successful subscription release cleanup must be idempotent',
  );
}

async function testAppletBridgeSuccessfulReleaseHandlesRejectedTopicUnsubscribe() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const calls = [];
  const warnings = [];
  const unhandledRejections = [];
  const handlers = new Map();
  const originalWarn = console.warn;
  const onUnhandledRejection = (reason) => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);
  console.warn = (...args) => {
    warnings.push(args.map((arg) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '));
  };
  try {
    const bridge = createAppletSdkAtelierBridge({
      async invoke(method, params) {
        calls.push({ method, params });
        if (method === 'events.unsubscribe') {
          throw new Error('rejected successful release topic unsubscribe');
        }
        return snapshot('task-release-unsubscribe-rejected');
      },
      onEvent(topic, handler) {
        handlers.set(topic, handler);
        return () => {
          handlers.delete(topic);
        };
      },
    });

    const seen = [];
    const unsubscribe = bridge.subscribeProjection((payload) => {
      seen.push(payload);
    });
    await unsubscribe.ready;
    assert.equal(handlers.has(ATELIER_PROJECTION_EVENT_TOPIC), true);

    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));
    handlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.({
      id: 'evt-after-rejected-successful-release-unsubscribe',
      seq: 6,
      taskId: 'task-release-unsubscribe-rejected',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'task.upsert',
        task: { id: 'task-release-unsubscribe-rejected', project: 'peers-touch', title: 'should not apply after rejected successful release unsubscribe', status: 'active' },
      },
    });
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(calls.map((call) => call.method), [
      'events.subscribe',
      'events.unsubscribe',
    ]);
    assert.deepEqual(
      calls.find((call) => call.method === 'events.unsubscribe')?.params,
      { topic: ATELIER_PROJECTION_EVENT_TOPIC },
      'successful release must request Host topic unsubscribe even when Host rejects cleanup',
    );
    assert.equal(handlers.has(ATELIER_PROJECTION_EVENT_TOPIC), false);
    assert.deepEqual(seen, []);
    assert.equal(unhandledRejections.length, 0);
    assert.equal(
      warnings.filter((warning) => warning.includes('rejected successful release topic unsubscribe')).length,
      1,
      'successful release Host topic unsubscribe rejection must be observed without unhandled rejection',
    );
    assert.match(
      JSON.stringify(warnings),
      /rejected successful release topic unsubscribe/,
      'successful release Host topic unsubscribe rejection warning must preserve non-execution reason',
    );
    assert.doesNotMatch(
      JSON.stringify(warnings),
      /provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute/,
      'successful release Host topic unsubscribe rejection warning must not leak execution-shaped fields',
    );
  } finally {
    console.warn = originalWarn;
    process.off('unhandledRejection', onUnhandledRejection);
  }
}

async function testAppletBridgeCorrelatesCustomProjectionTopicAcrossLifecycle() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const initialSnapshot = snapshot('task-topic');
  const harness = appletHostWithEventTracking(initialSnapshot);
  const customProjectionEventTopic = ATELIER_PROJECTION_EVENT_TOPIC + '.custom';
  const bridge = createAppletSdkAtelierBridge(harness.host, {
    projectionEventTopic: customProjectionEventTopic,
  });
  const seen = [];

  const unsubscribe = bridge.subscribeProjection((payload) => {
    seen.push(payload);
  });
  assert.deepEqual(
    harness.calls.find((call) => call.method === 'events.subscribe')?.params,
    { topic: customProjectionEventTopic },
  );
  assert.deepEqual(harness.eventSubscriptions.map((entry) => entry.topic), [customProjectionEventTopic]);

  harness.emit(ATELIER_PROJECTION_EVENT_TOPIC, {
    id: 'evt-wrong-topic',
    seq: 4,
    taskId: 'task-topic',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'task.upsert',
      task: { id: 'task-topic', project: 'peers-touch', title: 'wrong topic', status: 'active' },
    },
  });
  assert.equal(seen.length, 0);

  harness.emit(customProjectionEventTopic, {
    id: 'evt-custom-topic',
    seq: 4,
    taskId: 'task-topic',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'task.upsert',
      task: { id: 'task-topic', project: 'peers-touch', title: 'custom topic', status: 'active' },
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, 'evt-custom-topic');

  unsubscribe();
  assert.deepEqual(harness.eventUnsubscriptions.map((entry) => entry.topic), [customProjectionEventTopic]);
  assert.deepEqual(harness.calls.at(-1), {
    method: 'events.unsubscribe',
    params: { topic: customProjectionEventTopic },
  });
}

async function testAppletBridgeHandlesRejectedSubscriptionInvokes() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const calls = [];
  const warnings = [];
  const unhandledRejections = [];
  const handlers = new Map();
  const originalWarn = console.warn;
  const onUnhandledRejection = (reason) => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);
  console.warn = (...args) => {
    warnings.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    const bridge = createAppletSdkAtelierBridge({
      async invoke(method, params) {
        calls.push({ method, params });
        if (method === 'events.subscribe' || method === 'events.unsubscribe') {
          throw new Error('rejected ' + method);
        }
        return snapshot('task-rejected-subscription');
      },
      onEvent(topic, handler) {
        handlers.set(topic, handler);
        return () => {
          handlers.delete(topic);
        };
      },
    });

    const seen = [];
    const unsubscribe = bridge.subscribeProjection((payload) => {
      seen.push(payload);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    handlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.({
      id: 'evt-after-rejected-subscription-invoke',
      seq: 10,
      taskId: 'task-rejected-subscription',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'task.upsert',
        task: { id: 'task-rejected-subscription', project: 'peers-touch', title: 'rejected invoke listener still attached', status: 'active' },
      },
    });
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(calls.map((call) => call.method), [
      'events.subscribe',
      'events.unsubscribe',
    ]);
    assert.deepEqual(
      calls.find((call) => call.method === 'events.unsubscribe')?.params,
      { topic: ATELIER_PROJECTION_EVENT_TOPIC },
      'rejected events.subscribe must release the Host projection topic',
    );
    assert.equal(
      calls.filter((call) => call.method === 'events.unsubscribe').length,
      1,
      'release after rejected events.subscribe cleanup must not duplicate Host topic unsubscribe',
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, 'atelier.projection.subscription-rejected');
    assert.equal(seen[0].method, 'events.subscribe');
    assert.equal(
      seen.some((payload) => payload.id === 'evt-after-rejected-subscription-invoke'),
      false,
    );
    assert.equal(unhandledRejections.length, 0);
    assert.equal(warnings.filter((warning) => warning.includes('Atelier applet bridge')).length, 2);
  } finally {
    console.warn = originalWarn;
    process.off('unhandledRejection', onUnhandledRejection);
  }
}

async function testAppletBridgeMalformedEventCleanupFailsClosed() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const calls = [];
  const seen = [];
  let installedHandler;
  const bridge = createAppletSdkAtelierBridge({
    async invoke(method, params) {
      calls.push({ method, params });
      return snapshot('task-malformed-event-cleanup');
    },
    onEvent(topic, handler) {
      assert.equal(topic, ATELIER_PROJECTION_EVENT_TOPIC);
      installedHandler = handler;
      return { malformed: 'unsubscribe cleanup' };
    },
  });

  assert.throws(
    () => bridge.subscribeProjection((payload) => {
      seen.push(payload);
    }),
    /malformed unsubscribe cleanup/,
  );
  installedHandler?.({
    id: 'evt-after-malformed-event-cleanup',
    seq: 14,
    taskId: 'task-malformed-event-cleanup',
    receivedAt: new Date().toISOString(),
    patch: {
      kind: 'task.upsert',
      task: { id: 'task-malformed-event-cleanup', project: 'peers-touch', title: 'should not apply after malformed event cleanup', status: 'active' },
    },
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(seen, []);
}

async function testAppletBridgeReleasedSubscriptionIgnoresLateRejectedInvokes() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const calls = [];
  const warnings = [];
  const unhandledRejections = [];
  const handlers = new Map();
  let rejectEventSubscribe;
  const originalWarn = console.warn;
  const onUnhandledRejection = (reason) => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);
  console.warn = (...args) => {
    warnings.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    const bridge = createAppletSdkAtelierBridge({
      async invoke(method, params) {
        calls.push({ method, params });
        if (method === 'events.subscribe') {
          return new Promise((_, reject) => {
            rejectEventSubscribe = reject;
          });
        }
        if (method === 'events.unsubscribe') return undefined;
        return snapshot('task-release-before-reject');
      },
      onEvent(topic, handler) {
        handlers.set(topic, handler);
        return () => {
          handlers.delete(topic);
        };
      },
    });

    const seen = [];
    const unsubscribe = bridge.subscribeProjection((payload) => {
      seen.push(payload);
    });
    assert.deepEqual([...handlers.keys()], [ATELIER_PROJECTION_EVENT_TOPIC]);

    unsubscribe();
    assert.equal(handlers.has(ATELIER_PROJECTION_EVENT_TOPIC), false);
    rejectEventSubscribe(new Error('late rejected events.subscribe'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(calls.map((call) => call.method), [
      'events.subscribe',
      'events.unsubscribe',
    ]);
    assert.deepEqual(seen, []);
    assert.equal(unhandledRejections.length, 0);
    assert.equal(warnings.filter((warning) => warning.includes('Atelier applet bridge')).length, 1);
  } finally {
    console.warn = originalWarn;
    process.off('unhandledRejection', onUnhandledRejection);
  }
}

async function testAppletBridgeMissingEventBridgeFailsClosed() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const initialSnapshot = snapshot('task-missing-events');
  const runtime = createBridgeAtelierRuntime({
    bridge: createAppletSdkAtelierBridge({
      async invoke(method, params) {
        assert.equal(method, 'atelier.workspace.load');
        assert.deepEqual(params, {});
        return initialSnapshot;
      },
    }),
    initialSnapshot,
  });
  const seen = [];
  const release = runtime.subscribe((next) => {
    seen.push(next);
  });
  try {
    assert.equal(runtime.getSnapshot().status?.kind, 'disconnected');
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate');
    assert.equal(seen.at(-1)?.status?.kind, 'disconnected');
  } finally {
    release();
  }
}

async function testAppletBridgeSubscriptionRejectionMapsTypedRecovery() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  for (const testCase of [
    {
      name: 'event broker auth rejection',
      rejectedMethod: 'events.subscribe',
      reason: 'opaque projection subscription rejected',
      code: 'FORBIDDEN',
      expectedStatus: 'auth-denied',
    },
  ]) {
    const handlers = new Map();
    const initialSnapshot = snapshot('task-subscription-recovery');
    const bridge = createAppletSdkAtelierBridge({
      async invoke(method) {
        if (method === testCase.rejectedMethod) {
          throw Object.assign(new Error(testCase.reason), { code: testCase.code });
        }
        return initialSnapshot;
      },
      onEvent(topic, handler) {
        handlers.set(topic, handler);
        return () => {
          handlers.delete(topic);
        };
      },
    });
    const runtime = createBridgeAtelierRuntime({ bridge, initialSnapshot });
    const release = runtime.subscribe(() => {});
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.doesNotMatch(testCase.reason, /forbidden|permission|unauthori[sz]ed|network|disconnect|closed|timeout/i);
      assert.equal(runtime.getSnapshot().status?.kind, testCase.expectedStatus, testCase.name);
      assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate', testCase.name);
      handlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.({
        id: 'evt-after-typed-subscription-rejection',
        seq: 4,
        taskId: 'task-subscription-recovery',
        receivedAt: new Date().toISOString(),
        patch: {
          kind: 'task.upsert',
          task: { id: 'task-subscription-recovery', project: 'peers-touch', title: 'should not apply after rejection', status: 'active' },
        },
      });
      assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate', testCase.name);
    } finally {
      release();
    }
  }
}

async function testAppletBridgeForwardsMalformedEventsToRuntimeGuard() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const initialSnapshot = snapshot('task-guard');
  const harness = appletHostWithEventTracking(initialSnapshot);
  const bridge = createAppletSdkAtelierBridge(harness.host);
  const runtime = createBridgeAtelierRuntime({ bridge, initialSnapshot });
  const release = runtime.subscribe(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    harness.emit(ATELIER_PROJECTION_EVENT_TOPIC, {
      id: 'evt-applet-malformed',
      seq: 1,
      receivedAt: new Date().toISOString(),
      patch: { kind: 'unknown' },
    });
    assert.equal(runtime.getSnapshot().status?.kind, 'error');
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Bridge gate');

    harness.emit(ATELIER_PROJECTION_EVENT_TOPIC, JSON.stringify({
      id: 'evt-applet-recovered',
      seq: 1,
      taskId: 'task-guard',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'task.upsert',
        task: { id: 'task-guard', project: 'peers-touch', title: 'Applet bridge recovered', status: 'active' },
        select: true,
      },
    }));
    assert.equal(runtime.getSnapshot().status?.kind, 'ready');
    assert.equal(runtime.getSnapshot().state.tasks[0].title, 'Applet bridge recovered');
  } finally {
    release();
  }
}

async function testAppletBridgeAllowsWorkspaceOpenResponse() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const harness = appletHostWithInvoke({
    accepted: true,
    opened: false,
    workspaceUri: 'pt-workspace://task/task-1?workspace=peers-touch',
    mode: 'host_intent',
    reason: 'accepted',
  });
  const bridge = createAppletSdkAtelierBridge(harness.host);
  const response = await bridge.call({
    method: 'atelier.workspace.open',
    payload: {
      taskId: 'task-1',
      workspaceUri: 'pt-workspace://task/task-1?workspace=peers-touch',
      ideHint: 'vscode',
    },
  });
  assert.equal(response.accepted, true);
  assert.equal(harness.calls.at(-1)?.method, 'atelier.workspace.open');
}

async function testBridgeAllowsArtifactBodyFetchResponse() {
  const bodyResponse = {
    taskId: 'task-1',
    artifactId: 'artifact-1',
    bodyRef: 'artifact://task-1/artifact-1/body',
    bodyKind: 'markdown',
    bodyHash: 'sha256:prototype',
    bodySize: 11,
    text: '# Prototype',
    truncated: false,
    retentionStatus: 'active',
  };
  const bridgeHarness = bridgeWithCall(async (request) => {
    assert.equal(request.method, 'atelier.artifact.body.fetch');
    assert.deepEqual(request.payload, {
      taskId: 'task-1',
      artifactId: 'artifact-1',
      bodyRef: 'artifact://task-1/artifact-1/body',
      expectedHash: 'sha256:prototype',
    });
    return bodyResponse;
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: bridgeHarness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  assert.deepEqual(
    await runtime.fetchArtifactBody({
      taskId: 'task-1',
      artifactId: 'artifact-1',
      bodyRef: 'artifact://task-1/artifact-1/body',
      expectedHash: 'sha256:prototype',
    }),
    bodyResponse,
  );

  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const appletHarness = appletHostWithInvoke(bodyResponse);
  const appletBridge = createAppletSdkAtelierBridge(appletHarness.host);
  assert.deepEqual(
    await appletBridge.call({
      method: 'atelier.artifact.body.fetch',
      payload: {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        bodyRef: 'artifact://task-1/artifact-1/body',
        expectedHash: 'sha256:prototype',
      },
    }),
    bodyResponse,
  );
  assert.equal(appletHarness.calls.at(-1)?.method, 'atelier.artifact.body.fetch');
}

async function testBridgeAllowsArtifactPreviewOpenResponse() {
  const previewResponse = {
    accepted: true,
    opened: true,
    prepared: true,
    taskId: 'task-1',
    artifactId: 'artifact-1',
    sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
    bodyRef: 'artifact://task-1/artifact-1/body',
    kind: 'markdown',
    mode: 'sandbox_manifest',
    rendererSessionId: 'atelier-preview:task-1:artifact-1',
    rendererOwner: 'desktop_host',
    rendererMode: 'host_sandbox_manifest',
    rendererStatus: 'rendered',
    rendererCapabilities: [
      'sandbox_manifest_validation',
      'artifact_body_binding',
      'host_owned_renderer_session',
      'host_visual_renderer_surface',
    ],
    reason: 'rendered',
  };
  const bridgeHarness = bridgeWithCall(async (request) => {
    assert.equal(request.method, 'atelier.artifact.preview.open');
    assert.deepEqual(request.payload, {
      taskId: 'task-1',
      artifactId: 'artifact-1',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
      kind: 'markdown',
      mode: 'sandbox_manifest',
    });
    return previewResponse;
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: bridgeHarness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  assert.deepEqual(
    await runtime.openArtifactPreview({
      taskId: 'task-1',
      artifactId: 'artifact-1',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
      kind: 'markdown',
      mode: 'sandbox_manifest',
    }),
    previewResponse,
  );

  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const appletHarness = appletHostWithInvoke(previewResponse);
  const appletBridge = createAppletSdkAtelierBridge(appletHarness.host);
  assert.deepEqual(
    await appletBridge.call({
      method: 'atelier.artifact.preview.open',
      payload: {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
        bodyRef: 'artifact://task-1/artifact-1/body',
        kind: 'markdown',
        mode: 'sandbox_manifest',
      },
    }),
    previewResponse,
  );
  assert.equal(appletHarness.calls.at(-1)?.method, 'atelier.artifact.preview.open');
}

async function testAppletBridgeAllowsConfirmationResponses() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const memoryResponse = {
    accepted: true,
    feedbackId: 'feedback-memory-1',
    memoryId: 'memory-1',
    status: 'confirmed',
    source: 'atelier.memory.confirmCandidate',
    alreadyDone: false,
  };
  const memoryHarness = appletHostWithInvoke(memoryResponse);
  const memoryBridge = createAppletSdkAtelierBridge(memoryHarness.host);
  assert.deepEqual(
    await memoryBridge.call({
      method: 'atelier.memory.confirmCandidate',
      payload: { taskId: 'task-1', feedbackId: 'feedback-memory-1' },
    }),
    memoryResponse,
  );
  assert.equal(memoryHarness.calls.at(-1)?.method, 'atelier.memory.confirmCandidate');

  const rerunResponse = {
    accepted: true,
    feedbackId: 'feedback-rerun-1',
    taskId: 'task-1',
    rerunTaskId: 'task-rerun-1',
    status: 'created',
    source: 'atelier.feedback.confirmRerun',
    alreadyDone: false,
    started: false,
  };
  const rerunHarness = appletHostWithInvoke(rerunResponse);
  const rerunBridge = createAppletSdkAtelierBridge(rerunHarness.host);
  assert.deepEqual(
    await rerunBridge.call({
      method: 'atelier.feedback.confirmRerun',
      payload: { taskId: 'task-1', feedbackId: 'feedback-rerun-1' },
    }),
    rerunResponse,
  );
  assert.equal(rerunHarness.calls.at(-1)?.method, 'atelier.feedback.confirmRerun');
}

async function testAppletBridgeRejectsMalformedNonSnapshotResponses() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  for (const [method, payload, malformedResponse] of [
    ...providerCapabilityMalformedResponseFixtures.map((fixture) => [fixture.method, fixture.payload, fixture.response]),
    ...nonArtifactCapabilityMalformedResponseFixtures.map((fixture) => [fixture.method, fixture.payload, fixture.response]),
    ...artifactBodyMalformedResponseFixtures.map((fixture) => [fixture.method, fixture.payload, fixture.response]),
    ...artifactPreviewMalformedResponseFixtures.map((fixture) => [fixture.method, fixture.payload, fixture.response]),
  ]) {
    const bridge = createAppletSdkAtelierBridge(appletHostWithInvoke(malformedResponse).host);
    await assert.rejects(
      () => bridge.call({ method, payload }),
      /did not return a valid typed response/,
      method + ' must reject malformed non-snapshot response',
    );
  }
  const validTypedResponseForbiddenFieldCases = [
    [
      'atelier.provider.capabilities',
      {},
      {
        capabilities: [],
        source: 'station.provider.capabilities',
        shellExecute: { command: 'open .' },
      },
    ],
    [
      'atelier.feedback.submit',
      { taskId: 'task-1', blockId: 'block-1', signal: 'positive' },
      {
        accepted: true,
        feedbackId: 'feedback-1',
        memoryCandidate: { status: 'ignored', reason: 'projection-only', requiresConfirmation: false, confirmationMode: 'none', feeds: [] },
        rerunIntent: { status: 'ignored', reason: 'projection-only', requiresConfirmation: false, confirmationMode: 'none', feeds: [] },
        providerInvoke: { provider: 'model' },
      },
    ],
    [
      'atelier.memory.confirmCandidate',
      { taskId: 'task-1', feedbackId: 'feedback-1' },
      {
        accepted: true,
        feedbackId: 'feedback-1',
        memoryId: 'memory-1',
        status: 'accepted',
        source: 'station.memory',
        alreadyDone: false,
        'memory.write': { id: 'memory-1' },
      },
    ],
    [
      'atelier.feedback.confirmRerun',
      { taskId: 'task-1', feedbackId: 'feedback-1' },
      {
        accepted: true,
        feedbackId: 'feedback-1',
        taskId: 'task-1',
        rerunTaskId: 'task-rerun-1',
        status: 'started',
        source: 'station.rerun',
        alreadyDone: false,
        started: true,
        runtimeExecute: { taskId: 'task-rerun-1' },
      },
    ],
    [
      'atelier.workspace.open',
      { taskId: 'task-1', workspaceUri: 'pt-workspace://task/task-1?workspace=ws-1' },
      {
        accepted: true,
        opened: false,
        workspaceUri: 'pt-workspace://task/task-1?workspace=ws-1',
        mode: 'host_owned_intent',
        reason: 'Host owns IDE launch.',
        shellExecute: { command: 'code .' },
      },
    ],
    [
      'atelier.artifact.body.fetch',
      {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        bodyRef: 'artifact://task-1/artifact-1/body',
        expectedHash: 'sha256:body-1',
      },
      {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        bodyRef: 'artifact://task-1/artifact-1/body',
        bodyKind: 'text',
        bodyHash: 'sha256:body-1',
        bodySize: 12,
        text: 'hello world',
        truncated: false,
        retentionStatus: 'available',
        gateRun: { gate: 'unit' },
      },
    ],
    [
      'atelier.artifact.preview.open',
      {
        taskId: 'task-1',
        artifactId: 'artifact-1',
        sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
        bodyRef: 'artifact://task-1/artifact-1/body',
      },
      {
        accepted: true,
        opened: false,
        prepared: true,
        taskId: 'task-1',
        artifactId: 'artifact-1',
        sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
        bodyRef: 'artifact://task-1/artifact-1/body',
        kind: 'html',
        mode: 'sandbox_manifest',
        rendererSessionId: 'atelier-preview:artifact-1',
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        rendererStatus: 'prepared_not_opened',
        rendererCapabilities: ['host_visual_renderer_surface'],
        reason: 'Host owns artifact preview rendering.',
        nested: { 'provider.invoke': { provider: 'model' } },
      },
    ],
  ];
  const coveredMethods = [];
  for (const [method, payload, response] of validTypedResponseForbiddenFieldCases) {
    const bridge = createAppletSdkAtelierBridge(appletHostWithInvoke(response).host);
    coveredMethods.push(method);
    await assert.rejects(
      () => bridge.call({ method, payload }),
      /forbidden capability/,
      method + ' must reject valid typed response shape when it carries execution-shaped fields',
    );
  }
  assert.deepEqual(coveredMethods, [
    'atelier.provider.capabilities',
    'atelier.feedback.submit',
    'atelier.memory.confirmCandidate',
    'atelier.feedback.confirmRerun',
    'atelier.workspace.open',
    'atelier.artifact.body.fetch',
    'atelier.artifact.preview.open',
  ]);
  assert.ok(
    prototypeBridgeRuntimeOwnershipTestSource.includes('rejects execution-shaped fields in every non-snapshot Host response before runtime ownership can observe them') &&
      prototypeBridgeRuntimeOwnershipTestSource.includes('createAppletSdkAtelierBridge({') &&
      prototypeBridgeRuntimeOwnershipTestSource.includes('coveredMethods).toEqual([') &&
      prototypeBridgeRuntimeOwnershipTestSource.includes('shellExecute') &&
      prototypeBridgeRuntimeOwnershipTestSource.includes('providerInvoke') &&
      prototypeBridgeRuntimeOwnershipTestSource.includes("'memory.write'") &&
      prototypeBridgeRuntimeOwnershipTestSource.includes('runtimeExecute') &&
      prototypeBridgeRuntimeOwnershipTestSource.includes('gateRun') &&
      prototypeBridgeRuntimeOwnershipTestSource.includes("'provider.invoke'"),
    'prototype bridge non-snapshot Host response forbidden-field source unit matrix must be present in prototypeBridgeRuntimeOwnership.test.ts',
  );
}

await testProjectionGuards();
await testBridgeRejectsMalformedInitialSnapshot();
await testBridgeLoadAndEventReplay();
await testBridgeDedupeCacheEvictsBoundedlyAndSeqGuardRejectsReplay();
await testBridgeRejectsStaleSeqPerScopeOnly();
await testBridgeRejectsMismatchedEventPatchTaskScopeAndRecovers();
await testBridgeSubscriptionReferenceLifecycle();
await testBridgeInitialSubscriptionAckSettlement();
await testBridgeStaleInitialSubscriptionAckSettlementIsolation();
await testBridgeListenerFailuresDoNotPoisonOtherSubscribers();
await testBridgeSubscriptionFailuresPreserveSnapshot();
await testBridgeMalformedUnsubscribeDoesNotStickSubscription();
await testBridgeCleanupFailureClearsSubscriptionAndPreservesSnapshot();
await testBridgeEventApplyFailurePreservesSnapshotAndRecovers();
await testBridgeRejectsMalformedProjectionEventsAndRecovers();
await testBridgeRejectsEmptyTaskScopeEventsAndRecovers();
await testBridgeRejectsUnknownTaskScopeEventsAndRecovers();
await testBridgeRejectsMalformedStreamBlocksAndRecovers();
await testBridgeRejectsEmptyUpsertEntityIdsAndRecovers();
await testBridgeRejectsMalformedTodoItemsAndRecovers();
await testBridgeRejectsEmptyDecisionResolutionAndRecovers();
await testBridgeRejectsMalformedTaskContextAndRecovers();
await testBridgeErrorStatuses();
await testBridgeRuntimeStatusCopyTaxonomy();
await testAppletBridgeNormalizesHostErrorEnvelopes();
await testBridgeNonSnapshotStaleSuccessDoesNotClearNewerError();
await testBridgeNonSnapshotStaleFailureDoesNotClearNewerSuccess();
await testBridgeSnapshotStaleSuccessDoesNotOverwriteNewerSnapshot();
await testBridgeSnapshotStaleSuccessDoesNotOverwriteFresherEvent();
await testBridgeSnapshotStaleFailureDoesNotClearFresherEvent();
await testBridgeSnapshotStaleSuccessAfterLocalModelIntentRestoresStatus();
await testBridgeSnapshotStaleFailureAfterLocalModelIntentRestoresStatus();
await testBridgeSnapshotCurrentFailureStillWritesTypedRecovery();
await testBridgeSnapshotStaleFailureDoesNotClearNewerSnapshot();
await testBridgeNonSnapshotErrorsUpdateStatus();
await testBridgeNonSnapshotSuccessRestoresStatus();
testPrototypeRecoveryViewMatrix();
await testAppletBridgeCanonicalTopicLifecycle();
await testAppletBridgeSuccessfulReleaseHandlesRejectedTopicUnsubscribe();
await testAppletBridgeCorrelatesCustomProjectionTopicAcrossLifecycle();
await testAppletBridgeHandlesRejectedSubscriptionInvokes();
await testAppletBridgeMalformedEventCleanupFailsClosed();
await testAppletBridgeReleasedSubscriptionIgnoresLateRejectedInvokes();
await testAppletBridgeMissingEventBridgeFailsClosed();
await testAppletBridgeSubscriptionRejectionMapsTypedRecovery();
await testAppletBridgeForwardsMalformedEventsToRuntimeGuard();
await testAppletBridgeAllowsWorkspaceOpenResponse();
await testBridgeAllowsArtifactBodyFetchResponse();
await testBridgeAllowsArtifactPreviewOpenResponse();
await testAppletBridgeAllowsConfirmationResponses();
await testAppletBridgeRejectsMalformedNonSnapshotResponses();
`;

try {
  const esbuildPath = resolveEsbuildPath();
  const { build } = await import(pathToFileURL(esbuildPath).href);
  await build({
    stdin: {
      contents: testSource,
      resolveDir: repoRoot,
      sourcefile: 'atelier-bridge-runtime-gate.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'silent',
  });
  await import(pathToFileURL(outfile).href);
  writeEvidence('PASS');
  process.stdout.write('Atelier bridge runtime gate passed.\n');
} catch (error) {
  writeEvidence('FAIL', error instanceof Error ? error.message : String(error));
  console.error('Atelier bridge runtime gate failed:');
  console.error(error);
  process.exitCode = 1;
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}

function resolveEsbuildPath() {
  try {
    return require.resolve('esbuild', {
      paths: [
        repoRoot,
        path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier'),
      ],
    });
  } catch {
    const pnpmStore = path.join(repoRoot, 'node_modules/.pnpm');
    const candidates = fsSync.existsSync(pnpmStore)
      ? fsSync
          .readdirSync(pnpmStore)
          .filter((entry) => entry.startsWith('esbuild@'))
          .sort()
          .reverse()
          .map((entry) => path.join(pnpmStore, entry, 'node_modules/esbuild/lib/main.js'))
      : [];
    const match = candidates.find((candidate) => fsSync.existsSync(candidate));
    if (match) return match;
    throw new Error('Cannot resolve esbuild from repo dependencies');
  }
}

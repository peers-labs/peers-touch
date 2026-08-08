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
const prototypeRuntimeBootstrapPolicySource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeRuntimeBootstrap.ts'),
  'utf8',
);
const prototypeRuntimeBootstrapPolicyTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeRuntimeBootstrap.test.ts'),
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
const prototypeProjectionSubscriptionSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeProjectionSubscription.ts'),
  'utf8',
);
const prototypeProjectionSubscriptionTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/prototypeProjectionSubscription.test.ts'),
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
  prototypePageSource.includes('Prototype-only inline disclosure: terminal panel is not wired to shell or execute capability.') &&
    prototypePageSource.includes('Prototype-only inline disclosure: outline panel is not wired to a real task graph panel.'),
  'Browser prototype single-column shell must disclose Terminal/Outline as prototype-only inline placeholders',
);
assert.ok(
  appletBridgeSource.includes('ATELIER_ARTIFACT_PREVIEW_OPEN_MODES') &&
    appletBridgeSource.includes('isArtifactPreviewOpenMode(value.mode)') &&
    appletBridgeSource.includes('isArtifactPreviewOpenRendererOwner(value.rendererOwner)') &&
    appletBridgeSource.includes('isArtifactPreviewOpenRendererMode(value.rendererMode)') &&
    appletBridgeSource.includes('isArtifactPreviewOpenRendererStatus(value.rendererStatus)') &&
    !appletBridgeSource.includes("value.mode === 'sandbox_manifest'") &&
    !appletBridgeSource.includes("value.rendererOwner === 'desktop_host'") &&
    !appletBridgeSource.includes("value.rendererMode === 'host_sandbox_manifest'") &&
    !appletBridgeSource.includes("value.rendererStatus === 'prepared_not_opened'"),
  'Browser prototype applet bridge artifact preview response guard must consume generated Host renderer descriptor taxonomy',
);
  assert.ok(
    appletBridgeSource.includes('buildPrototypeProjectionStreamPayload({') &&
      appletBridgeSource.includes('let lastProjectionStreamPayloadKey') &&
      appletBridgeSource.includes('refreshProjectionSubscription(projection)') &&
      appletBridgeSource.includes('subscribeProjectionStream(activeProjectionListener, activeProjectionCloseAfterRejectedSubscribe, projection)') &&
      prototypeBridgeRuntimeSource.includes('refreshProjectionSubscription?(projection: AtelierProjectionSnapshot): Promise<void> | void') &&
      prototypeBridgeRuntimeSource.includes('bridge.refreshProjectionSubscription?.(projection)') &&
      prototypeBridgeRuntimeSource.includes('snapshot = withStatus(nextSnapshot, reconcilingStatus())') &&
      prototypeBridgeRuntimeSource.includes('latestProjectionRefreshToken') &&
      appletBridgeSource.includes('return invokeProjectionSubscription(host, ATELIER_PROJECTION_SUBSCRIPTION_METHOD, projectionStreamPayload).catch') &&
      prototypeProjectionSubscriptionSource.includes('ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority') &&
      prototypeProjectionSubscriptionSource.includes('projectionTaskIdResolvers') &&
      prototypeProjectionSubscriptionSource.includes("certificationMode === 'product-window-e2e'") &&
      prototypeProjectionSubscriptionSource.includes('createGoal.trim().length > 0') &&
      prototypeProjectionSubscriptionSource.includes('controllerSelectedTaskId: ({ selectedTaskId }') &&
      prototypeProjectionSubscriptionSource.includes('export function projectionTaskIdFromSubscription') &&
      prototypeProjectionSubscriptionSource.includes('export function projectionAfterEventSeqFromSnapshot') &&
      prototypeProjectionSubscriptionSource.includes('export function compactProjectionStreamPayload') &&
      prototypeProjectionSubscriptionSource.includes('export function buildPrototypeProjectionStreamPayload') &&
      prototypeProjectionSubscriptionTestSource.includes('uses certification-created and controller selected task sources before snapshot fallback') &&
      prototypeProjectionSubscriptionTestSource.includes('builds payloads from certification-created and controller selected task source priority only') &&
      prototypeProjectionSubscriptionSource.includes('const agentId = input.agentId.trim();') &&
      prototypeProjectionSubscriptionSource.includes('if (!agentId) return undefined;') &&
      prototypeProjectionSubscriptionSource.includes('if (taskId) payload.taskId = taskId;') &&
      prototypeProjectionSubscriptionSource.includes('Number.isSafeInteger(value)') &&
      prototypeProjectionSubscriptionSource.includes('input.preserveZeroCursor === true && input.afterEventSeq === 0') &&
      prototypeProjectionSubscriptionTestSource.includes('uses generated task id source priority with explicit intent before snapshot fallback') &&
      prototypeProjectionSubscriptionTestSource.includes('falls back to selected task and then first snapshot task without inventing task ids') &&
      prototypeProjectionSubscriptionTestSource.includes('trims required agent id and rejects empty projection stream payloads fail-closed') &&
      prototypeProjectionSubscriptionTestSource.includes('rejects empty agent id before building Host projection stream payloads') &&
      prototypeProjectionSubscriptionTestSource.includes('omits empty task id and zero replay cursor fields from Host subscription payload') &&
      prototypeProjectionSubscriptionTestSource.includes('omits decimal and unsafe replay cursor values from Host subscription payload') &&
      prototypeProjectionSubscriptionTestSource.includes('lets explicit stream cursor override snapshot replay cursor') &&
      prototypeProjectionSubscriptionTestSource.includes('falls back to snapshot replay cursor without adding task execution fields') &&
      appletBridgeSource.includes('Atelier projection stream agentId missing') &&
      !appletBridgeSource.includes('return snapshot?.selectedTaskId || snapshot?.workspace.tasks[0]?.id'),
    'Browser prototype applet bridge projection stream taskId fallback order must derive from generated eventSubscription contract',
  );
  assert.ok(
    appletBridgeSource.includes('ATELIER_ARTIFACT_BODY_REF_SHAPE') &&
      appletBridgeSource.includes('ATELIER_ARTIFACT_SANDBOX_REF_SHAPE') &&
      appletBridgeSource.includes('isArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE)') &&
      appletBridgeSource.includes('isArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE)') &&
      !appletBridgeSource.includes('^artifact:\\/\\/') &&
      !appletBridgeSource.includes('^atelier-sandbox:\\/\\/') &&
      prototypeProjectionSource.includes('ATELIER_ARTIFACT_BODY_REF_SHAPE') &&
      prototypeProjectionSource.includes('ATELIER_ARTIFACT_SANDBOX_REF_SHAPE') &&
      prototypeProjectionSource.includes('isArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE, taskId, artifactId)') &&
      prototypeProjectionSource.includes('isArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE, taskId, artifactId)') &&
      !prototypeProjectionSource.includes('ARTIFACT_BODY_REF_PATTERN') &&
      !prototypeProjectionSource.includes('ATELIER_ARTIFACT_PREVIEW_TARGET_SANDBOX_REF_SCHEMES'),
    'Browser prototype artifact ref guards must consume generated body/sandbox ref shape descriptors',
  );
assert.ok(
  appletBridgeSource.includes('ATELIER_PROVIDER_CAPABILITY_SCOPES') &&
    appletBridgeSource.includes('isProviderCapabilityScope(value.scope)') &&
    appletBridgeSource.includes('value.readOnly === ATELIER_PROVIDER_CAPABILITY_READ_ONLY') &&
    !appletBridgeSource.includes("value.scope === 'station-provider'") &&
    !appletBridgeSource.includes('value.readOnly === true'),
  'Browser prototype applet bridge provider capability response guard must consume generated descriptor taxonomy',
);
assert.ok(
  appletBridgeSource.includes('ATELIER_WORKSPACE_OPEN_URI_SCHEMES') &&
    appletBridgeSource.includes('ATELIER_WORKSPACE_OPEN_URI_SHAPE') &&
    appletBridgeSource.includes('function isWorkspaceOpenUriScheme') &&
    appletBridgeSource.includes('isWorkspaceOpenUriScheme(uri.protocol.slice(0, -1))') &&
    appletBridgeSource.includes('uri.hostname === shape.host') &&
    appletBridgeSource.includes('uri.searchParams.getAll(shape.workspaceQueryKey)') &&
    appletBridgeSource.includes('taskPath.length === shape.taskPathSegments') &&
    !appletBridgeSource.includes("uri.protocol === 'pt-workspace:'") &&
    !appletBridgeSource.includes("uri.hostname === 'task'") &&
    !appletBridgeSource.includes("uri.searchParams.getAll('workspace')") &&
    prototypeProjectionSource.includes('ATELIER_WORKSPACE_OPEN_URI_SCHEMES') &&
    prototypeProjectionSource.includes('ATELIER_WORKSPACE_OPEN_URI_SHAPE') &&
    prototypeProjectionSource.includes('function isWorkspaceOpenUriScheme') &&
    prototypeProjectionSource.includes('isWorkspaceOpenUriScheme(uri.protocol.slice(0, -1))') &&
    prototypeProjectionSource.includes('uri.hostname === shape.host') &&
    prototypeProjectionSource.includes('uri.searchParams.getAll(shape.workspaceQueryKey)') &&
    prototypeProjectionSource.includes('taskPath.length === shape.taskPathSegments') &&
    !prototypeProjectionSource.includes("uri.protocol === 'pt-workspace:'") &&
    !prototypeProjectionSource.includes("uri.hostname === 'task'") &&
    !prototypeProjectionSource.includes("uri.searchParams.getAll('workspace')"),
  'Browser prototype workspace URI guards must consume generated URI scheme and shape taxonomy',
);
assert.ok(
  appletBridgeSource.includes('ATELIER_PROJECTION_EVENT_TOPIC') &&
    appletBridgeSource.includes('ATELIER_PROJECTION_SUBSCRIPTION_METHOD') &&
    appletBridgeSource.includes('const DEFAULT_PROJECTION_EVENT_TOPIC = ATELIER_PROJECTION_EVENT_TOPIC') &&
    appletBridgeSource.includes('invokeProjectionSubscription(host, ATELIER_PROJECTION_SUBSCRIPTION_METHOD') &&
    !appletBridgeSource.includes("const DEFAULT_PROJECTION_EVENT_TOPIC = 'atelier.projection.event'") &&
      !appletBridgeSource.includes("invokeProjectionSubscription(host, 'atelier.events.subscribe'"),
  'Atelier applet bridge projection topic and subscription method must derive from generated contract',
);
assert.ok(
  prototypePageSource.includes('ATELIER_TASK_INTENT_PRESETS') &&
    prototypePageSource.includes('type TaskIntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];') &&
    prototypePageSource.includes("const [mode, setMode] = useState<TaskIntentPreset>('work');") &&
    prototypePageSource.includes('ATELIER_TASK_INTENT_PRESETS.map((m) => (') &&
    prototypePageSource.includes('onClick={() => setMode(m)}') &&
    prototypePageSource.includes('intentPreset: mode') &&
    !prototypePageSource.includes("(['work', 'code', 'design'] as const).map((m) => (") &&
    !prototypePageSource.includes('atelier.ide.mode') &&
    !prototypePageSource.includes('ide.mode.switch') &&
    !prototypePageSource.includes('workspace.mode.switch') &&
    !prototypePageSource.includes('runtime.mode.switch') &&
    !prototypePageSource.includes('provider.runtime.override'),
  'Browser prototype Work/Code/Design toggle must stay declarative intentPreset only and must not switch IDE/workspace/provider runtime',
);
assert.ok(
  prototypeRuntimeSource.includes('ATELIER_TASK_INTENT_PRESETS') &&
    prototypeCreateProjectProjectionSource.includes('ATELIER_DEFAULT_TASK_INTENT_PRESET') &&
      prototypeCreateProjectProjectionSource.includes('ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING') &&
    prototypeRuntimeSource.includes('AtelierViewStatus') &&
    prototypeRuntimeSource.includes('export type IntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];') &&
    prototypeRuntimeSource.includes('buildPrototypeCreateProjectProjection({') &&
    prototypeCreateProjectProjectionSource.includes('export function prototypeCreateProjectIntentPresetMetadata') &&
    prototypeCreateProjectProjectionSource.includes('ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING[intentPreset]') &&
    prototypeCreateProjectProjectionSource.includes('ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING[ATELIER_DEFAULT_TASK_INTENT_PRESET]') &&
    prototypeCreateProjectProjectionSource.includes('export function prototypeCreateProjectWorkspaceUri') &&
    prototypeCreateProjectProjectionSource.includes('export function prototypeCreateProjectAcknowledgement') &&
    prototypeCreateProjectProjectionSource.includes('export function buildPrototypeCreateProjectProjection') &&
    prototypeCreateProjectProjectionTestSource.includes('derives intent preset metadata from generated create-from-goal mapping') &&
    prototypeCreateProjectProjectionTestSource.includes('builds canonical prototype workspace URIs without exposing file or shell paths') &&
    prototypeCreateProjectProjectionTestSource.includes('builds a projection-only task, stream, and empty buckets for create-from-goal') &&
    prototypeCreateProjectProjectionTestSource.includes('falls back to a new-task title and default project without creating execution payloads') &&
    !prototypeRuntimeSource.includes('pt-workspace://task/${encodeURIComponent(id)}') &&
    !prototypeRuntimeSource.includes('intentPresetMetadata(input.intentPreset)') &&
    !prototypeRuntimeSource.includes("export type IntentPreset = 'work' | 'code' | 'design';"),
  'Browser prototype runtime createProjectFromGoal projection must derive from generated taxonomy through a pure helper',
);
assert.ok(
  prototypeRuntimeSource.includes('ATELIER_RUN_TARGET_KINDS') &&
      prototypeRuntimeSource.includes('ATELIER_AGENT_FLOW_IDS') &&
    prototypeRuntimeSource.includes('export type RunTargetKind = (typeof ATELIER_RUN_TARGET_KINDS)[number];') &&
      prototypeRuntimeSource.includes('export type AgentFlowId = (typeof ATELIER_AGENT_FLOW_IDS)[number];') &&
    prototypeRuntimeSource.includes("kind: Extract<RunTargetKind, 'model'>;") &&
      prototypeRuntimeSource.includes("kind: Extract<RunTargetKind, 'agents'>;") &&
      prototypeRuntimeSource.includes('flowId?: AgentFlowId;') &&
    !prototypeRuntimeSource.includes('kind: RunTargetKind;') &&
    !prototypeRuntimeSource.includes("kind: 'model' | 'agents';") &&
      !prototypeRuntimeSource.includes('flowId?: string;') &&
        prototypeRunTargetPickerProjectionSource.includes('ATELIER_AGENT_FLOW_DESCRIPTORS') &&
      prototypeRunTargetPickerProjectionSource.includes('ATELIER_DIRECT_RUN_MODELS') &&
        prototypePageSource.includes('ATELIER_DEFAULT_AGENT_FLOW_ID') &&
      prototypeRunTargetPickerProjectionSource.includes('ATELIER_DIRECT_RUN_MODELS.map((model) => ({') &&
        prototypeRunTargetPickerProjectionSource.includes('ATELIER_AGENT_FLOW_DESCRIPTORS.map((flow) => ({') &&
      !prototypePageSource.includes('const MODELS = [') &&
        !prototypePageSource.includes('const AGENT_FLOW_DETAILS') &&
      !prototypePageSource.includes('const AGENT_FLOWS:') &&
    prototypePageSource.includes('type RunKind = RunTargetKind;') &&
      prototypePageSource.includes('useState<RunKind>(ATELIER_DEFAULT_RUN_TARGET_KIND)') &&
        prototypePageSource.includes('useState<AgentFlowId>(ATELIER_DEFAULT_AGENT_FLOW_ID)') &&
        !prototypePageSource.includes('useState<AgentFlowId>(ATELIER_AGENT_FLOW_IDS[0])') &&
      !prototypePageSource.includes('useState<RunKind>(ATELIER_RUN_TARGET_KINDS[0])') &&
      !prototypePageSource.includes("useState<RunKind>('agents')") &&
    prototypeRunTargetPickerProjectionSource.includes('ATELIER_RUN_TARGET_KINDS.map((kind) => ({') &&
    prototypeRunTargetPickerProjectionSource.includes('export function buildPrototypeModelSelectionRequestKey') &&
    prototypeRunTargetPickerProjectionSource.includes('return `task:${taskId}|model:${model}`;') &&
    prototypeRunTargetPickerProjectionSource.includes('export function shouldApplyPrototypeModelSelectionSnapshot') &&
    prototypePageSource.includes('derivePrototypeRunTargetPickerView({ runKind, model, flowId, tab })') &&
    prototypePageSource.includes('modelSelectionRequestKeyRef.current = buildPrototypeModelSelectionRequestKey({ taskId: selected })') &&
    prototypePageSource.includes('modelSelectionRequestKeyRef.current = requestKey') &&
    prototypePageSource.includes('shouldApplyPrototypeModelSelectionSnapshot({') &&
      prototypePageSource.includes('Model selection is intent-only; failures reuse bridge recovery status.') &&
      prototypePageSource.includes('setRuntimeStatus(buildPrototypeBridgeStatusFromError(error));') &&
    prototypePageSource.includes('pickerView.tabs.map((runTab) => (') &&
    prototypePageSource.includes('pickerView.modelOptions.map((option) => (') &&
    prototypePageSource.includes('pickerView.flowOptions.map((option) => {') &&
    prototypeRunTargetPickerProjectionTestSource.includes('renders generated run target tabs without local execution semantics') &&
    prototypeRunTargetPickerProjectionTestSource.includes('keys model selection snapshots by selected task and model without execution payloads') &&
    prototypeRunTargetPickerProjectionTestSource.includes('rejects stale model selection snapshots after task or model ownership changes') &&
    prototypeRunTargetPickerProjectionTestSource.includes('marks generated direct model options as picked metadata only') &&
    prototypeRunTargetPickerProjectionTestSource.includes('marks generated agent flow options and batch badges as display-only metadata') &&
    !prototypePageSource.includes('runtime.setModel(m).then(applySnapshot);') &&
    !prototypePageSource.includes("type RunKind = 'model' | 'agents';") &&
    !prototypePageSource.includes("([['model', '⚡ 直接模型'], ['agents', '👥 Agents']] as const).map"),
  'Browser prototype run target kind type and tabs must derive from generated run target taxonomy',
);
assert.ok(
  prototypePageSource.includes('workspaceSnapshotRequestKeyRef.current = loadRequestKey') &&
    prototypePageSource.includes("source: 'load'") &&
    prototypePageSource.includes("source: 'reload'") &&
    prototypePageSource.includes("source: 'subscription'") &&
    prototypePageSource.includes('workspaceSnapshotSequenceRef.current =') &&
    prototypePageSource.includes('shouldApplyPrototypeWorkspaceSnapshot({') &&
    prototypePageSource.includes('buildPrototypeBridgeStatusFromError(error)') &&
    prototypePageSource.includes('}).catch((error) => {') &&
    prototypeWorkspaceSnapshotOwnershipSource.includes('export function buildPrototypeWorkspaceSnapshotRequestKey') &&
    prototypeWorkspaceSnapshotOwnershipSource.includes('return `source:${input.source}|seq:${sequence}`;') &&
    prototypeWorkspaceSnapshotOwnershipSource.includes('export function shouldApplyPrototypeWorkspaceSnapshot') &&
    prototypeWorkspaceSnapshotOwnershipTestSource.includes('keys workspace snapshots by source and monotonic sequence without execution payloads') &&
    prototypeWorkspaceSnapshotOwnershipTestSource.includes('rejects stale workspace load snapshots after newer reload or subscription ownership changes') &&
    prototypeWorkspaceSnapshotOwnershipTestSource.includes('rejects stale workspace load errors after newer reload or subscription ownership changes') &&
    !prototypePageSource.includes('runtime.loadWorkspace().then(applySnapshot);'),
  'Browser prototype workspace load/reload/subscription snapshots must reject stale async workspace snapshots',
);
assert.ok(
  prototypePageSource.includes('run: buildPrototypeRunTarget({ runKind, model: state.model, flowId })') &&
    prototypeComposerSubmitSource.includes("if (input.runKind === 'model')") &&
    prototypeComposerSubmitSource.includes("return { kind: 'model', model: input.model };") &&
    prototypeComposerSubmitSource.includes("return { kind: 'agents', model: input.model, flowId: input.flowId };") &&
    !prototypePageSource.includes('run: { kind: runKind, model: state.model, flowId }'),
  'Browser prototype createProjectFromGoal must not send flowId with DirectRun model intent',
);
assert.ok(
  prototypePageSource.includes('Read-only Station provider capabilities. Click inserts a slash command; execution remains Station-owned.') &&
    prototypePageSource.includes('derivePrototypeProviderCapabilityPanelProjectionView({ capabilities, loading })') &&
    prototypePageSource.includes('capabilityPanelView.visibleCapabilities') &&
    prototypePageSource.includes('capabilityPanelView.hiddenCapabilityCount') &&
    prototypePageSource.includes('capabilityPanelView.emptyVisible') &&
    prototypePageSource.includes('more Station provider capability descriptors hidden in the compact prototype panel.') &&
    prototypeProviderCapabilityPanelProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.providerCapabilities') &&
    prototypeProviderCapabilityPanelProjectionSource.includes("countLabel: input.loading ? 'loading' : String(input.capabilities.length)") &&
    prototypeProviderCapabilityPanelProjectionSource.includes('emptyVisible: !input.loading && input.capabilities.length === 0') &&
    prototypeProviderCapabilityPanelProjectionTestSource.includes('uses the generated display limit for visible provider capability descriptors') &&
    prototypeProviderCapabilityPanelProjectionTestSource.includes('does not report hidden descriptors when capabilities fit the generated limit') &&
    prototypeProviderCapabilityPanelProjectionTestSource.includes('shows loading instead of count while discovery is pending') &&
    prototypeProviderCapabilityPanelProjectionTestSource.includes('shows empty state only after non-loading discovery returns no descriptors') &&
    prototypePageSource.includes('onClick={() => onInsertCommand(capability.slashCommand)}') &&
    prototypePageSource.includes('buildPrototypeProviderCapabilityCommandIntent({ command })') &&
    prototypePageSource.includes('appendPrototypeProviderCapabilityCommand({') &&
    prototypeProviderCapabilityCommandSource.includes("if (!command.startsWith('/')) return { status: 'invalid' };") &&
    prototypeProviderCapabilityCommandSource.includes("return { status: 'insert', command };") &&
    prototypeProviderCapabilityCommandTestSource.includes('builds insert-only intents for slash commands') &&
    prototypeProviderCapabilityCommandTestSource.includes('rejects non-slash commands before mutating the draft') &&
    prototypeProviderCapabilityCommandTestSource.includes('appends slash commands to existing draft text without sending a message') &&
    prototypePageSource.includes('derivePrototypeProviderCapabilityDiscoveryView(response)') &&
    prototypePageSource.includes('prototypeProviderCapabilityDiscoveryErrorStatus(error)') &&
    prototypePageSource.includes('providerCapabilitiesRequestKeyRef.current = requestKey') &&
    prototypePageSource.includes('shouldApplyPrototypeProviderCapabilityDiscoveryResponse({') &&
    prototypeRuntimeSource.includes('buildPrototypeProviderCapabilitiesResponse()') &&
    prototypeProviderCapabilityDiscoverySource.includes('export function buildPrototypeProviderCapabilitiesResponse') &&
    prototypeProviderCapabilityDiscoverySource.includes('export function buildPrototypeProviderCapabilityDiscoveryRequestKey') &&
    prototypeProviderCapabilityDiscoverySource.includes("return taskId ? `task:${taskId}` : 'workspace';") &&
    prototypeProviderCapabilityDiscoverySource.includes('export function shouldApplyPrototypeProviderCapabilityDiscoveryResponse') &&
    prototypeProviderCapabilityDiscoverySource.includes("source: 'prototype.station.provider.capabilities'") &&
    prototypeProviderCapabilityDiscoverySource.includes('scope: ATELIER_PROVIDER_CAPABILITY_SCOPE') &&
    prototypeProviderCapabilityDiscoverySource.includes('readOnly: ATELIER_PROVIDER_CAPABILITY_READ_ONLY') &&
    prototypeProviderCapabilityDiscoverySource.includes('capabilities: response.capabilities') &&
    prototypeProviderCapabilityDiscoverySource.includes("source: response.source") &&
    prototypeProviderCapabilityDiscoverySource.includes("'provider capabilities unavailable'") &&
    prototypeProviderCapabilityDiscoveryTestSource.includes('builds read-only Station provider capability descriptors without invoking providers') &&
    prototypeProviderCapabilityDiscoveryTestSource.includes('projects Station provider capability discovery responses without invoking providers') &&
    prototypeProviderCapabilityDiscoveryTestSource.includes('uses runtime error messages for provider capability discovery failures') &&
    prototypeProviderCapabilityDiscoveryTestSource.includes('uses a bounded fallback for unknown provider capability discovery failures') &&
    prototypeProviderCapabilityDiscoveryTestSource.includes('keys provider capability discovery by selected task or workspace scope') &&
    prototypeProviderCapabilityDiscoveryTestSource.includes('rejects stale provider capability discovery responses without execution payloads') &&
    !prototypeRuntimeSource.includes('function mockProviderCapabilities') &&
    !prototypeRuntimeSource.includes("source: 'prototype.station.provider.capabilities'") &&
    !prototypeRuntimeSource.includes("slashCommand: '/implement'") &&
    !prototypePageSource.includes('atelier.provider.invoke') &&
    !prototypePageSource.includes('skills.invoke') &&
    !prototypePageSource.includes('provider.invoke') &&
    !prototypePageSource.includes('model.run') &&
    !prototypePageSource.includes('cli.execute'),
  'Browser prototype provider capabilities panel must stay read-only discovery and must only insert slash commands',
);
assert.ok(
  prototypePageSource.includes('derivePrototypeRightRailProjection({') &&
    prototypePageSource.includes("rightRailProjection.surface === 'project'") &&
    prototypeRightRailProjectionSource.includes("surface: 'project'") &&
    prototypeRightRailProjectionSource.includes("surface: 'legacyTodo'") &&
    prototypeRightRailProjectionSource.includes("surface: 'empty'") &&
    prototypeRightRailProjectionSource.includes('project.id === input.selectedTask?.projectId') &&
    prototypeRightRailProjectionSource.includes('project.taskGraph.tasks.some((node) => node.id === input.selectedTaskId)') &&
    prototypeRightRailProjectionTestSource.includes('selects Station project projection by selected task projectId') &&
    prototypeRightRailProjectionTestSource.includes('selects Station project projection by TaskGraph node membership') &&
    prototypeRightRailProjectionTestSource.includes('falls back to legacy Todo projection when no Station project matches') &&
    prototypeRightRailProjectionTestSource.includes('keeps Context projection independent from project and Todo surface selection') &&
    !prototypeRightRailProjectionSource.includes('provider.invoke') &&
    !prototypeRightRailProjectionSource.includes('model.run') &&
    !prototypeRightRailProjectionSource.includes('cli.execute') &&
    !prototypeRightRailProjectionSource.includes('memory.write') &&
    !prototypeRightRailProjectionSource.includes('input_snapshot'),
  'Browser prototype right rail projection selector must stay pure projection surface selection',
);
  assert.ok(
    prototypePageSource.includes('Atelier — single-column projection shell') &&
      prototypePageSource.includes('one content rail with task intent, stream, composer, and read-only Station') &&
      prototypePageSource.includes('Task organizer') &&
      prototypePageSource.includes('single-column projection section') &&
      prototypePageSource.includes('Provider capability section') &&
      prototypePageSource.includes('Workspace projection') &&
      prototypePageSource.includes('read-only Station sections') &&
      prototypePageSource.includes('Former rail affordances now live inside the content rail') &&
      !prototypePageSource.includes('PanelToggleButton') &&
      !prototypePageSource.includes('railOpen') &&
      !prototypePageSource.includes('railRightOpen') &&
      !prototypePageSource.includes('Left rail') &&
      !prototypePageSource.includes('Right panel'),
    'Browser prototype default shell must stay synced to the official single-column projection shape without app-level left/right rails',
  );
assert.ok(
  prototypePageSource.includes('derivePrototypeTaskGraphPanelProjectionView(project)') &&
    prototypePageSource.includes('graphView.visibleRootTaskIds') &&
    prototypePageSource.includes('graphView.hiddenRootTaskIdCount') &&
    prototypePageSource.includes('graphView.visibleEdges') &&
    prototypePageSource.includes('graphView.hiddenEdgeCount') &&
    prototypePageSource.includes('graphView.visibleNodes') &&
    prototypePageSource.includes('graphView.hiddenNodeCount') &&
    prototypePageSource.includes('graphView.integratorRequired') &&
    prototypeTaskGraphPanelProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphRootIds') &&
    prototypeTaskGraphPanelProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphEdges') &&
    prototypeTaskGraphPanelProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodes') &&
    prototypeTaskGraphPanelProjectionSource.includes("integratorRequired: project.taskGraph.parallelPolicy === 'integrator_required'") &&
    prototypeTaskGraphPanelProjectionTestSource.includes('uses generated display limits for root ids, edges, and nodes') &&
    prototypeTaskGraphPanelProjectionTestSource.includes('does not report hidden panel entries when projections fit generated limits') &&
    prototypeTaskGraphPanelProjectionTestSource.includes('projects integrator-required policy as display state only') &&
    !prototypeTaskGraphPanelProjectionSource.includes('taskGraph.schedule') &&
    !prototypeTaskGraphPanelProjectionSource.includes('taskGraph.execute') &&
    !prototypeTaskGraphPanelProjectionSource.includes('taskGraph.replan') &&
    !prototypeTaskGraphPanelProjectionSource.includes('integrator.merge.execute') &&
    !prototypeTaskGraphPanelProjectionSource.includes('artifact.produce') &&
    !prototypeTaskGraphPanelProjectionSource.includes('gate.run'),
  'Browser prototype TaskGraph panel helper must stay bounded read-only projection display',
);
assert.ok(
  prototypePageSource.includes('derivePrototypeTaskGraphNodeProjectionView(node, { artifactsByTask, gatesByTask })') &&
    prototypePageSource.includes('TASK_GRAPH_NODE_TONE_COLORS[nodeView.tone]') &&
    prototypeTaskGraphNodeProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodeRefs') &&
    prototypeTaskGraphNodeProjectionSource.includes('ATELIER_PROJECTION_CONTRACT.readOnlyProjectionSurfaces.task_graph.evidenceRefResolution') &&
    prototypeTaskGraphNodeProjectionSource.includes('evidenceRefResolution.unresolvedLabel') &&
    prototypeTaskGraphNodeProjectionSource.includes('visibleArtifactRefs') &&
    prototypeTaskGraphNodeProjectionSource.includes('hiddenArtifactCount') &&
    prototypeTaskGraphNodeProjectionSource.includes('unresolvedArtifactCount') &&
    prototypeTaskGraphNodeProjectionSource.includes('visibleGateRefs') &&
    prototypeTaskGraphNodeProjectionSource.includes('hiddenGateCount') &&
    prototypeTaskGraphNodeProjectionSource.includes('unresolvedGateCount') &&
    prototypeTaskGraphNodeProjectionTestSource.includes('uses generated display limits for node artifact and gate refs') &&
    prototypeTaskGraphNodeProjectionTestSource.includes('does not report hidden refs when projected refs fit the generated limit') &&
    prototypeTaskGraphNodeProjectionTestSource.includes('marks task graph evidence refs unresolved unless projected artifact and gate ids exist in workspace maps') &&
    prototypeTaskGraphNodeProjectionTestSource.includes("label: 'artifact-missing (unresolved)'") &&
    prototypeTaskGraphNodeProjectionTestSource.includes('maps known Station node states to display glyphs and tones') &&
    prototypeTaskGraphNodeProjectionTestSource.includes('keeps unknown node states as muted projection display without creating actions') &&
    !prototypeTaskGraphNodeProjectionSource.includes('provider.invoke') &&
    !prototypeTaskGraphNodeProjectionSource.includes('taskGraph.schedule') &&
    !prototypeTaskGraphNodeProjectionSource.includes('taskGraph.execute') &&
    !prototypeTaskGraphNodeProjectionSource.includes('taskGraph.replan') &&
    !prototypeTaskGraphNodeProjectionSource.includes('integrator.merge.execute') &&
    !prototypeTaskGraphNodeProjectionSource.includes('artifact.produce') &&
    !prototypeTaskGraphNodeProjectionSource.includes('gate.run'),
  'Browser prototype TaskGraph node helper must stay bounded read-only projection display',
);
assert.ok(
  prototypePageSource.includes('Prototype run target selector only writes Station-owned run intent; the applet does not invoke providers, run models, or execute CLI.') &&
    prototypePageSource.includes("onClick={() => { onPickModel(option.model); setOpen(false); }}") &&
        prototypePageSource.includes("onClick={() => { onPickFlow(option.id); setOpen(false); }}") &&
    prototypeRunTargetPickerProjectionSource.includes("batchBadgeLabel: flow.batch === 1 ? '可切换' : '第二批'") &&
    prototypeRunTargetPickerProjectionSource.includes("batchBadgeTone: flow.batch === 1 ? 'success' : 'muted'") &&
    !prototypePageSource.includes('runtime.invokeProvider') &&
    !prototypePageSource.includes('provider.invoke') &&
    !prototypePageSource.includes('model.run') &&
    !prototypePageSource.includes('runModel') &&
    !prototypePageSource.includes('cli.execute') &&
    !prototypePageSource.includes('executeCli'),
  'Browser prototype run target picker must stay Station-owned intent only and must not expose provider/model/CLI execution',
);
assert.ok(
  prototypePageSource.includes('buildPrototypeComposerSubmitIntent({') &&
    prototypePageSource.includes("setComposerMode('goal');") &&
    prototypePageSource.includes('runtime.createProjectFromGoal({') &&
    prototypePageSource.includes("composerSubmitRequestKeyRef.current = buildPrototypeComposerSubmitRequestKey({ kind: 'message', taskId: selected })") &&
    prototypePageSource.includes('composerSubmitRequestKeyRef.current = requestKey') &&
    prototypePageSource.includes('shouldApplyPrototypeComposerSubmitSnapshot({') &&
      prototypePageSource.includes('Composer submit is Station-owned intent; failures reuse bridge recovery status.') &&
      prototypePageSource.includes('setRuntimeStatus(buildPrototypeBridgeStatusFromError(error));') &&
    prototypePageSource.includes('goal: intent.goal') &&
    prototypeComposerSubmitSource.includes('export function buildPrototypeComposerSubmitRequestKey') &&
    prototypeComposerSubmitSource.includes('return `kind:${input.kind}|task:${taskId}|text:${text}|run:${runKind}|model:${model}|flow:${flowId}`;') &&
    prototypeComposerSubmitSource.includes('export function shouldApplyPrototypeComposerSubmitSnapshot') &&
    prototypeComposerSubmitSource.includes("export type PrototypeComposerMode = 'message' | 'goal'") &&
    prototypeComposerSubmitSource.includes("input.composerMode === 'goal' || !selectedTaskId") &&
    prototypeComposerSubmitSource.includes("return { status: 'create', goal: text };") &&
    prototypeComposerSubmitSource.includes("status: 'message'") &&
    prototypeComposerSubmitTestSource.includes('keys composer submit snapshots by kind, task/text, and run metadata without execution payloads') &&
    prototypeComposerSubmitTestSource.includes('rejects stale composer submit snapshots after task, text, or run ownership changes') &&
    prototypeComposerSubmitTestSource.includes('routes goal composer submissions to create-from-goal with user-entered text') &&
    prototypeComposerSubmitTestSource.includes('routes selected message composer submissions to text-only message intents') &&
    prototypeRuntimeSource.includes('buildPrototypeMessageProjection({') &&
    prototypeMessageProjectionSource.includes('export function buildPrototypeMessageProjection') &&
    prototypeMessageProjectionSource.includes('PROTOTYPE_MESSAGE_WAITING_FOR_STATION_TEXT') &&
    prototypeMessageProjectionTestSource.includes('appends trimmed user text and a Station-waiting projection acknowledgement') &&
    prototypeMessageProjectionTestSource.includes('creates a stream bucket for a selected task without mutating task-owned side buckets') &&
    prototypeMessageProjectionTestSource.includes('keeps empty message submissions as no-op projection updates') &&
    prototypeMessageProjectionTestSource.includes('keeps message projection text-only without execution-shaped payload fields') &&
    !prototypeRuntimeSource.includes('function userBlock') &&
    !prototypeRuntimeSource.includes('function agentBlock') &&
    !prototypePageSource.includes(`runtime.createProjectFromGoal({
        goal: intent.goal,
        intentPreset: mode,
        project: selectedTask?.project ?? 'peers-touch',
        run: buildPrototypeRunTarget({ runKind, model: state.model, flowId }),
      }).then(applySnapshot);`) &&
    !prototypePageSource.includes('runtime.sendMessage({\n      taskId: intent.taskId,\n      text: intent.text,\n    }).then(applySnapshot);') &&
    !prototypePageSource.includes("goal: '新任务'") &&
    !prototypePageSource.includes('goal: "新任务"'),
  'Browser prototype New task/message flow must use pure helpers for create routing and text-only message projection',
);
const prototypeDecisionCardStart = prototypeBlocksSource.indexOf('export function DecisionCard({');
const prototypeDecisionCardEnd = prototypeBlocksSource.indexOf('\n\n/* ── artifact card', prototypeDecisionCardStart);
const prototypeDecisionCardSource =
  prototypeDecisionCardStart >= 0 && prototypeDecisionCardEnd > prototypeDecisionCardStart
    ? prototypeBlocksSource.slice(prototypeDecisionCardStart, prototypeDecisionCardEnd)
    : '';
const prototypeChooseStart = prototypePageSource.indexOf('const choose = (blockId: string, opt: string) => {');
const prototypeChooseEnd = prototypePageSource.indexOf('\n\n  const sendDraft', prototypeChooseStart);
const prototypeChooseSource =
  prototypeChooseStart >= 0 && prototypeChooseEnd > prototypeChooseStart
    ? prototypePageSource.slice(prototypeChooseStart, prototypeChooseEnd)
    : '';
assert.ok(
  prototypeDecisionCardSource.includes('Agent 不替你决定') &&
    prototypeDecisionCardSource.includes('derivePrototypeDecisionCardView(b)') &&
    prototypeDecisionCardSource.includes('decisionView.optionViews.map') &&
    prototypeDecisionCardSource.includes('if (o.clickable) onChoose(b.id, o.text);') &&
    prototypeDecisionCardSource.includes('已选择「{decisionView.chosenLabel}」，Agent 继续推进。') &&
    prototypeChooseSource.includes('buildPrototypeDecisionChoiceIntent({') &&
    prototypeChooseSource.includes('void runtime.resolveDecision({') &&
    prototypePageSource.includes('decisionChoiceRequestKeyRef.current = buildPrototypeDecisionChoiceRequestKey({ taskId: selected })') &&
    prototypeChooseSource.includes('decisionChoiceRequestKeyRef.current = requestKey') &&
    prototypeChooseSource.includes('shouldApplyPrototypeDecisionChoiceSnapshot({') &&
      prototypeChooseSource.includes('Decision choices are human intent data; failures reuse bridge recovery status.') &&
      prototypeChooseSource.includes('setRuntimeStatus(buildPrototypeBridgeStatusFromError(error));') &&
    prototypeChooseSource.includes('choice: intent.choice') &&
    prototypeDecisionChoiceSource.includes('export function buildPrototypeDecisionChoiceRequestKey') &&
    prototypeDecisionChoiceSource.includes('return `task:${taskId}|block:${blockId}|choice:${choice}`;') &&
    prototypeDecisionChoiceSource.includes('export function shouldApplyPrototypeDecisionChoiceSnapshot') &&
    prototypeDecisionChoiceSource.includes("status: 'resolve'") &&
    prototypeDecisionChoiceSource.includes('if (!taskId || !blockId || !choice) return { status:') &&
    prototypeRuntimeSource.includes('buildPrototypeDecisionResolveProjection({') &&
    prototypeDecisionChoiceSource.includes('export function buildPrototypeDecisionResolveProjection') &&
    prototypeDecisionChoiceSource.includes('export function derivePrototypeDecisionCardView') &&
    prototypeDecisionChoiceSource.includes('const picked = Boolean(chosen && chosen === option.text);') &&
    prototypeDecisionChoiceSource.includes('const primary = picked || Boolean(option.recommended && !chosen);') &&
    prototypeDecisionChoiceSource.includes('const disabled = Boolean(chosen && !picked);') &&
    prototypeDecisionChoiceSource.includes('clickable: !disabled') &&
    prototypeDecisionChoiceTestSource.includes('builds trimmed Station-owned human decision resolve intents') &&
    prototypeDecisionChoiceTestSource.includes('keys decision choice snapshot requests by task, block, and choice without execution payloads') &&
    prototypeDecisionChoiceTestSource.includes('rejects stale decision choice snapshots after task, block, or choice ownership changes') &&
    prototypeDecisionChoiceTestSource.includes('keeps resume-shaped option text as human choice data, not an applet action') &&
    prototypeDecisionChoiceTestSource.includes('marks the recommended option primary before the human chooses') &&
    prototypeDecisionChoiceTestSource.includes('keeps the chosen option active and disables the other projected choices') &&
    prototypeDecisionChoiceTestSource.includes('treats resume-shaped option text as display data without execution affordances') &&
    prototypeDecisionChoiceTestSource.includes('projects a trimmed human decision choice onto only the matching DecisionCard block') &&
    prototypeDecisionChoiceTestSource.includes('keeps invalid decision projection input as a no-op state update') &&
    prototypeDecisionChoiceTestSource.includes('keeps resume-shaped resolved choices as projection data without execution payloads') &&
    !prototypeChooseSource.includes('runtime.resolveDecision({\n      taskId: intent.taskId,\n      blockId: intent.blockId,\n      choice: intent.choice,\n    }).then(applySnapshot);') &&
    !prototypeRuntimeSource.includes('? { ...block, chosen: input.choice }') &&
    !prototypeDecisionCardSource.includes('const picked =') &&
    !prototypeDecisionCardSource.includes('const disabled =') &&
    !prototypeDecisionCardSource.includes('resume') &&
    !prototypeDecisionCardSource.includes('rerun') &&
    !prototypeDecisionCardSource.includes('execute') &&
    !prototypeDecisionCardSource.includes('provider.invoke') &&
    !prototypeDecisionCardSource.includes('gate.rerun') &&
    !prototypeDecisionCardSource.includes('taskGraph.diff.apply') &&
    !prototypeChooseSource.includes('resume') &&
    !prototypeChooseSource.includes('rerun') &&
    !prototypeChooseSource.includes('execute') &&
    !prototypeChooseSource.includes('provider.invoke') &&
    !prototypeChooseSource.includes('gate.rerun') &&
    !prototypeChooseSource.includes('taskGraph.diff.apply'),
  'Browser prototype decision card must stay human-choice resolve intent only and must not expose resume/rerun/execute/provider capabilities',
);
const prototypeNegoRowStart = prototypeBlocksSource.indexOf('export function NegoRow({');
const prototypeNegoRowEnd = prototypeBlocksSource.indexOf('\n\n/* ── inline decision card', prototypeNegoRowStart);
const prototypeNegoRowSource =
  prototypeNegoRowStart >= 0 && prototypeNegoRowEnd > prototypeNegoRowStart
    ? prototypeBlocksSource.slice(prototypeNegoRowStart, prototypeNegoRowEnd)
    : '';
assert.ok(
  prototypeNegoRowSource.includes('export function NegoRow({') &&
    prototypeNegoRowSource.includes('const [open, setOpen] = useState(false);') &&
    prototypeNegoRowSource.includes('const negoView = derivePrototypeNegotiationProjectionView(b);') &&
    prototypeNegoRowSource.includes('onClick={() => setOpen((v) => !v)}') &&
    prototypeNegoRowSource.includes('negoView.visibleVoiceViews.map') &&
    prototypeNegoRowSource.includes('more Station negotiation voices hidden in the compact prototype row.') &&
    prototypeNegoRowSource.includes('noEvidenceObjection') &&
    prototypeNegoRowSource.includes('无证据 → 降级为「疑虑」（反附和）') &&
    prototypeNegoRowSource.includes('{b.consensus}') &&
    prototypeNegotiationProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.negotiationVoices') &&
    prototypeNegotiationProjectionSource.includes("voice.stance === 'objection' && !voice.evidenceRef") &&
    prototypeNegotiationProjectionSource.includes("statusLabel: block.converged ? '已收敛' : '未收敛'") &&
    prototypeNegotiationProjectionTestSource.includes('uses the generated display limit for visible Station negotiation voices') &&
    prototypeNegotiationProjectionTestSource.includes('does not report hidden voices at the generated display limit') &&
    prototypeNegotiationProjectionTestSource.includes('marks no-evidence objections as display-only concerns') &&
    prototypeNegotiationProjectionTestSource.includes('maps convergence to display status without producing consensus actions') &&
    prototypeNegotiationProjectionTestSource.includes('supports empty voice projections without creating negotiation runtime work') &&
    !prototypeNegotiationProjectionSource.includes('agent.invoke') &&
    !prototypeNegotiationProjectionSource.includes('atelier.agent') &&
    !prototypeNegotiationProjectionSource.includes('orchestration.start') &&
    !prototypeNegotiationProjectionSource.includes('negotiation.run') &&
    !prototypeNegotiationProjectionSource.includes('provider.invoke') &&
    !prototypeNegotiationProjectionSource.includes('runtime.invokeProvider') &&
    !prototypeNegotiationProjectionSource.includes('runtime.execute') &&
    !prototypeNegotiationProjectionSource.includes('gate.rerun') &&
    !prototypeNegotiationProjectionSource.includes('taskGraph.diff.apply') &&
    !prototypeNegoRowSource.includes('agent.invoke') &&
    !prototypeNegoRowSource.includes('atelier.agent') &&
    !prototypeNegoRowSource.includes('orchestration.start') &&
    !prototypeNegoRowSource.includes('negotiation.run') &&
    !prototypeNegoRowSource.includes('provider.invoke') &&
    !prototypeNegoRowSource.includes('runtime.invokeProvider') &&
    !prototypeNegoRowSource.includes('runtime.execute') &&
    !prototypeNegoRowSource.includes('gate.rerun') &&
    !prototypeNegoRowSource.includes('taskGraph.diff.apply'),
  'Browser prototype negotiation row must stay read-only Station voice projection and must not expose agent orchestration/provider execution capabilities',
);
assert.ok(
  prototypeTypesSource.includes('export type AtelierNegotiationVoiceStance =') &&
    prototypeTypesSource.includes('ATELIER_PROJECTION_CONTRACT.negotiationProjection.voiceStances') &&
    prototypeTypesSource.includes('sessionId?: string') &&
    prototypeTypesSource.includes('roundId?: string') &&
    prototypeTypesSource.includes('voiceId?: string') &&
    prototypeTypesSource.includes('objectionId?: string'),
  'Browser prototype NegoVoice stance and trace ids must stay generated-contract derived',
);
assert.ok(
  prototypeEngineTraceSource.includes('prototype-only multi-engine negotiation trace renderer') &&
    prototypeEngineTraceSource.includes('Renders the local demo output of `runSession`') &&
    prototypeEngineTraceSource.includes('Station remains the execution/orchestration source of truth.') &&
    prototypeEngineTraceProjectionSource.includes("PROTOTYPE_ENGINE_TRACE_DISCLOSURE = 'Prototype-only local trace；真实编排归 Station'") &&
    prototypeEngineTraceSource.includes('derivePrototypeEngineTraceProjectionView({ collaboration: input, engineId })') &&
    prototypeEngineTraceSource.includes('derivePrototypeEngineTraceTurnView(t)') &&
    prototypeEngineTraceSource.includes('derivePrototypeEngineTraceRoundView(r)') &&
    prototypeEngineTraceSource.includes('<span>{disclosure}</span>') &&
    prototypeEngineTraceProjectionSource.includes('const policy = getPolicy(input.engineId);') &&
    prototypeEngineTraceProjectionSource.includes('if (!policy) return null;') &&
    prototypeEngineTraceProjectionSource.includes('const trace = runSession(policy, input.collaboration);') &&
    prototypeEngineTraceProjectionTestSource.includes('fails closed for unknown prototype engine ids without starting orchestration') &&
    prototypeEngineTraceProjectionTestSource.includes('summarizes local demo trace while disclosing Station orchestration ownership') &&
    prototypeEngineTraceProjectionTestSource.includes('does not expose provider/runtime execution shaped actions in the local trace view') &&
    prototypeEngineTraceProjectionTestSource.includes('marks evidence-less objections as display-only concerns') &&
    prototypeEngineTraceProjectionTestSource.includes('derives parallel round layout without creating parallel execution') &&
    !prototypeEngineTraceSource.includes('const policy = getPolicy(engineId);') &&
    !prototypeEngineTraceSource.includes('const trace = runSession(policy, input);') &&
    prototypePageSource.includes('render the prototype-only local trace') &&
    prototypePageSource.includes('without claiming applet orchestration') &&
    prototypePageSource.includes('return <EngineTrace key={b.id} input={collab} engineId={flowId} />;') &&
    !prototypeEngineTraceSource.includes('agent.invoke') &&
    !prototypeEngineTraceSource.includes('atelier.agent') &&
    !prototypeEngineTraceSource.includes('orchestration.start') &&
    !prototypeEngineTraceSource.includes('provider.invoke') &&
    !prototypeEngineTraceSource.includes('runtime.invokeProvider') &&
    !prototypeEngineTraceSource.includes('runtime.execute') &&
    !prototypeEngineTraceSource.includes('gate.rerun') &&
    !prototypeEngineTraceSource.includes('taskGraph.diff.apply') &&
    !prototypePageSource.includes('orchestration.start') &&
    !prototypePageSource.includes('provider.invoke') &&
    !prototypePageSource.includes('runtime.invokeProvider'),
  'Browser prototype EngineTrace must stay prototype-only local trace disclosure and must not expose agent/provider execution capabilities',
);
const prototypeFeedbackBarStart = prototypeBlocksSource.indexOf('function FeedbackBar({');
const prototypeFeedbackBarEnd = prototypeBlocksSource.indexOf('\n\n/* ── agent reply', prototypeFeedbackBarStart);
const prototypeFeedbackBarSource =
  prototypeFeedbackBarStart >= 0 && prototypeFeedbackBarEnd > prototypeFeedbackBarStart
    ? prototypeBlocksSource.slice(prototypeFeedbackBarStart, prototypeFeedbackBarEnd)
    : '';
const prototypeFeedbackFlowStart = prototypePageSource.indexOf('const submitFeedback = (blockId: string, signal: AtelierFeedbackSignal) => {');
const prototypeFeedbackFlowEnd = prototypePageSource.indexOf('\n\n  const openWorkspace', prototypeFeedbackFlowStart);
const prototypeFeedbackFlowSource =
  prototypeFeedbackFlowStart >= 0 && prototypeFeedbackFlowEnd > prototypeFeedbackFlowStart
    ? prototypePageSource.slice(prototypeFeedbackFlowStart, prototypeFeedbackFlowEnd)
    : '';
assert.ok(
  prototypeBlocksSource.includes('ATELIER_FEEDBACK_SIGNALS') &&
    prototypeBlocksSource.includes('const FEEDBACK_SIGNAL_LABELS: Record<AtelierFeedbackSignal, string>') &&
      appletBridgeSource.includes('ATELIER_MEMORY_CANDIDATE_FEEDS') &&
      appletBridgeSource.includes('value.feeds.every(isFeedbackFeed)') &&
      appletBridgeSource.includes('feeds.includes(value)') &&
      !appletBridgeSource.includes("value === 'planner' || value === 'risk' || value === 'verifier'") &&
    prototypeFeedbackBarSource.includes('ATELIER_FEEDBACK_SIGNALS.map((signal) => button(signal, FEEDBACK_SIGNAL_LABELS[signal]))') &&
    !prototypeFeedbackBarSource.includes("button('positive', '👍')") &&
    prototypeFeedbackBarSource.includes('if (!busy) onFeedback(blockId, signal);') &&
    prototypeFeedbackBarSource.includes('if (!memoryConfirming) onConfirmMemoryCandidate();') &&
    prototypeFeedbackBarSource.includes('if (!rerunConfirming) onConfirmRerun();') &&
    prototypeFeedbackFlowSource.includes('void runtime.submitFeedback({ taskId: selected, blockId, signal })') &&
      prototypeFeedbackFlowSource.includes('derivePrototypeFeedbackPolicyView({ signal, response })') &&
      prototypePageSource.includes('feedbackRequestKeyRef.current = buildPrototypeFeedbackRequestKey({ taskId: selected })') &&
      prototypeFeedbackFlowSource.includes('const requestKey = buildPrototypeFeedbackRequestKey({ taskId: selected, blockId, signal })') &&
      prototypeFeedbackFlowSource.includes('feedbackRequestKeyRef.current = requestKey') &&
      prototypeFeedbackFlowSource.includes('shouldApplyPrototypeFeedbackResponse({') &&
      prototypeFeedbackFlowSource.includes("setMemoryConfirmationFeedbackId('')") &&
      prototypeFeedbackFlowSource.includes("setRerunConfirmationFeedbackId('')") &&
      prototypeRuntimeSource.includes('buildPrototypeFeedbackResponse({') &&
      prototypeFeedbackPolicySource.includes('export function buildPrototypeFeedbackResponse') &&
      prototypeFeedbackPolicySource.includes('export function buildPrototypeFeedbackRequestKey') &&
      prototypeFeedbackPolicySource.includes('export function shouldApplyPrototypeFeedbackResponse') &&
      prototypeFeedbackPolicySource.includes('return `task:${taskId}|block:${blockId}|signal:${signal}`;') &&
      prototypeFeedbackPolicySource.includes('prototype records only a weak memory candidate signal') &&
      prototypeFeedbackPolicySource.includes('prototype records rerun intent and waits for Station rerun review confirmation') &&
      prototypeFeedbackPolicySource.includes('response.memoryCandidate.confirmationMode === ATELIER_MEMORY_CONFIRMATION_MODE') &&
      prototypeFeedbackPolicySource.includes('response.rerunIntent.confirmationMode === ATELIER_RERUN_CONFIRMATION_MODE') &&
      prototypeFeedbackPolicySource.includes('Station memory confirmation required') &&
      prototypeFeedbackPolicySource.includes('Station rerun review required') &&
      prototypeFeedbackPolicyTestSource.includes('builds positive feedback as a weak Station memory candidate without writing memory') &&
      prototypeFeedbackPolicyTestSource.includes('builds negative feedback with risk feed routing but no execution payloads') &&
      prototypeFeedbackPolicyTestSource.includes('builds regenerate feedback as a Station rerun review intent without rerunning locally') &&
      prototypeFeedbackPolicyTestSource.includes('builds neutral feedback as acknowledgement only') &&
      prototypeFeedbackPolicyTestSource.includes('uses generated memory confirmation mode for positive memory candidates') &&
      prototypeFeedbackPolicyTestSource.includes('uses generated rerun confirmation mode for regenerate feedback') &&
      prototypeFeedbackPolicyTestSource.includes('does not show confirmation affordances when confirmation mode does not match generated modes') &&
      prototypeFeedbackPolicyTestSource.includes('keys feedback submission by task, block, and signal without execution payloads') &&
      prototypeFeedbackPolicyTestSource.includes('rejects stale feedback responses after task or signal ownership changes') &&
      !prototypeRuntimeSource.includes('function mockFeedbackResponse') &&
      !prototypeRuntimeSource.includes("confirmationMode: 'station_memory_review'") &&
      !prototypeRuntimeSource.includes("confirmationMode: 'station_rerun_review'") &&
    prototypeFeedbackFlowSource.includes('void runtime.confirmMemoryCandidate({ taskId: memoryConfirmationTaskId, feedbackId: memoryConfirmationFeedbackId })') &&
    prototypeFeedbackFlowSource.includes('void runtime.confirmRerun({ taskId: rerunConfirmationTaskId, feedbackId: rerunConfirmationFeedbackId })') &&
    prototypePageSource.includes("memoryConfirmationRequestKeyRef.current = buildPrototypeConfirmationRequestKey({ kind: 'memory', taskId: selected })") &&
    prototypePageSource.includes("rerunConfirmationRequestKeyRef.current = buildPrototypeConfirmationRequestKey({ kind: 'rerun', taskId: selected })") &&
    prototypeFeedbackFlowSource.includes("kind: 'memory'") &&
    prototypeFeedbackFlowSource.includes("kind: 'rerun'") &&
    prototypeFeedbackFlowSource.includes('memoryConfirmationRequestKeyRef.current = requestKey') &&
    prototypeFeedbackFlowSource.includes('rerunConfirmationRequestKeyRef.current = requestKey') &&
    prototypeFeedbackFlowSource.includes('shouldApplyPrototypeConfirmationResponse({') &&
    prototypeFeedbackFlowSource.includes('setMemoryConfirming(false)') &&
    prototypeFeedbackFlowSource.includes('setRerunConfirming(false)') &&
    prototypeFeedbackFlowSource.includes('derivePrototypeMemoryConfirmationStatus(response)') &&
    prototypeFeedbackFlowSource.includes('derivePrototypeRerunConfirmationStatus(response)') &&
    prototypeFeedbackFlowSource.includes('prototypeMemoryConfirmationErrorStatus(error)') &&
    prototypeFeedbackFlowSource.includes('prototypeRerunConfirmationErrorStatus(error)') &&
    prototypeRuntimeSource.includes('buildPrototypeMemoryConfirmationResponse(input)') &&
    prototypeRuntimeSource.includes('buildPrototypeRerunConfirmationResponse(input)') &&
    prototypeConfirmationResultSource.includes('export function buildPrototypeMemoryConfirmationResponse') &&
    prototypeConfirmationResultSource.includes('export function buildPrototypeRerunConfirmationResponse') &&
    prototypeConfirmationResultSource.includes('export function buildPrototypeConfirmationRequestKey') &&
    prototypeConfirmationResultSource.includes('export function shouldApplyPrototypeConfirmationResponse') &&
    prototypeConfirmationResultSource.includes('return `kind:${input.kind}|task:${taskId}|feedback:${feedbackId}|block:${blockId}`;') &&
    prototypeConfirmationResultSource.includes('source: ATELIER_MEMORY_CONFIRMATION_MODE') &&
    prototypeConfirmationResultSource.includes('source: ATELIER_RERUN_CONFIRMATION_MODE') &&
    prototypeConfirmationResultSource.includes('memory-confirmed:${response.memoryId}') &&
    prototypeConfirmationResultSource.includes('rerun-confirmed:${response.rerunTaskId}') &&
    prototypeConfirmationResultTestSource.includes('builds memory confirmation as a Station-owned response without writing memory') &&
    prototypeConfirmationResultTestSource.includes('builds rerun confirmation as a Station-owned response without rerunning locally') &&
    prototypeConfirmationResultTestSource.includes('shows Station-owned memory confirmation result ids') &&
    prototypeConfirmationResultTestSource.includes('shows Station-owned rerun task result ids') &&
    prototypeConfirmationResultTestSource.includes('keys confirmation requests by kind, task, feedback, and block without execution payloads') &&
    prototypeConfirmationResultTestSource.includes('rejects stale confirmation responses after task, feedback, or kind ownership changes') &&
    prototypeConfirmationResultTestSource.includes('uses a bounded fallback for unknown memory confirmation failures') &&
    prototypeConfirmationResultTestSource.includes('uses a bounded fallback for unknown rerun confirmation failures') &&
    !prototypeRuntimeSource.includes('memoryId: `prototype-memory-${input.feedbackId}`') &&
    !prototypeRuntimeSource.includes('rerunTaskId: `prototype-rerun-${input.feedbackId}`') &&
    !prototypeRuntimeSource.includes('source: ATELIER_MEMORY_CONFIRMATION_MODE') &&
    !prototypeRuntimeSource.includes('source: ATELIER_RERUN_CONFIRMATION_MODE') &&
    prototypeFeedbackFlowSource.includes('reloadWorkspace();') &&
    !prototypeFeedbackBarSource.includes('runtime.') &&
    !prototypeFeedbackBarSource.includes('provider.invoke') &&
    !prototypeFeedbackBarSource.includes('memory.write') &&
    !prototypeFeedbackBarSource.includes('atelier.rerun') &&
    !prototypeFeedbackBarSource.includes('runtime.rerun') &&
    !prototypeFeedbackBarSource.includes('execute') &&
    !prototypeFeedbackFlowSource.includes('provider.invoke') &&
    !prototypeFeedbackFlowSource.includes('runtime.invokeProvider') &&
    !prototypeFeedbackFlowSource.includes('memory.write') &&
    !prototypeFeedbackFlowSource.includes('atelier.memory.write') &&
    !prototypeFeedbackFlowSource.includes('atelier.rerun') &&
    !prototypeFeedbackFlowSource.includes('runtime.rerun') &&
    !prototypeFeedbackFlowSource.includes('runtime.execute') &&
    !prototypeFeedbackFlowSource.includes('gate.rerun') &&
    !prototypeFeedbackFlowSource.includes('taskGraph.diff.apply') &&
    !prototypeFeedbackFlowSource.includes('cli.execute'),
  'Browser prototype FeedbackBar confirmations must stay Station-owned policy intents and must not expose direct memory write/rerun/execute/provider capabilities',
);
assert.ok(
  prototypePageSource.includes('Host intent only; accepts pt-workspace://, no file URL, shell, or execute capability.') &&
    prototypePageSource.includes('Host intent · no file/shell/execute') &&
    prototypePageSource.includes('workspaceOpenRequestKeyRef.current = buildPrototypeWorkspaceOpenRequestKey({ taskId: selected })') &&
    prototypePageSource.includes('const requestKey = buildPrototypeWorkspaceOpenRequestKey({') &&
    prototypePageSource.includes('workspaceOpenRequestKeyRef.current = requestKey') &&
    prototypePageSource.includes('shouldApplyPrototypeWorkspaceOpenResponse({') &&
    prototypePageSource.includes('setWorkspaceOpenSubmitting(false)') &&
    prototypePageSource.includes("setWorkspaceOpenStatus('')") &&
    prototypePageSource.includes('derivePrototypeWorkspaceOpenStatus(response)') &&
    prototypeRuntimeSource.includes('buildPrototypeWorkspaceOpenResponse(input)') &&
    prototypeWorkspaceOpenStatusSource.includes('export function buildPrototypeWorkspaceOpenResponse') &&
    prototypeWorkspaceOpenStatusSource.includes('export function buildPrototypeWorkspaceOpenRequestKey') &&
    prototypeWorkspaceOpenStatusSource.includes('export function shouldApplyPrototypeWorkspaceOpenResponse') &&
    prototypeWorkspaceOpenStatusSource.includes('return `task:${taskId}|workspace:${workspaceUri}|ide:${ideHint}`;') &&
    prototypeWorkspaceOpenStatusSource.includes('opened: false') &&
    prototypeWorkspaceOpenStatusSource.includes('Prototype records a Host-owned workspace open intent without launching an IDE.') &&
    prototypeWorkspaceOpenStatusSource.includes("response.opened ? 'opened' : 'host_intent_accepted'") &&
    prototypeWorkspaceOpenStatusTestSource.includes('builds a Host-owned workspace open intent without claiming IDE launch') &&
    prototypeWorkspaceOpenStatusTestSource.includes('shows accepted Host intent without claiming the IDE opened') &&
    prototypeWorkspaceOpenStatusTestSource.includes('shows opened only when the Host response explicitly proves opened=true') &&
    prototypeWorkspaceOpenStatusTestSource.includes('keys workspace open requests by task, workspace URI, and IDE hint without launch payloads') &&
    prototypeWorkspaceOpenStatusTestSource.includes('rejects stale workspace open responses after task or target ownership changes') &&
    !prototypeRuntimeSource.includes("mode: 'prototype_host_intent'") &&
    !prototypeRuntimeSource.includes('Prototype records a Host-owned workspace open intent without launching an IDE.') &&
    !prototypePageSource.includes('openExternalUrl') &&
    !prototypePageSource.includes('shell.execute') &&
    !prototypePageSource.includes('execute.shell') &&
    !prototypePageSource.includes('file.open') &&
    !prototypePageSource.includes('workspace.file.open'),
  'Browser prototype Open in IDE must stay Host workspace.open intent only and must not expose file/shell/execute',
);
assert.ok(
  prototypePageSource.includes('derivePrototypeBudgetProjectionView({ budget, fallbackPercent, fallbackLabel })') &&
    prototypePageSource.includes('prototypeBudgetToneColorKey(budgetView.tone)') &&
    prototypeBudgetProjectionSource.includes('Read-only Station budget projection; halt, cap increase, and resume stay in Station decision routing.') &&
    prototypeBudgetProjectionSource.includes('progressPercent: clampBudgetPercent') &&
    prototypeBudgetProjectionSource.includes("tone === 'blocked' || tone === 'danger'") &&
    prototypeBudgetProjectionTestSource.includes('builds a fallback read-only budget projection when Station budget is absent') &&
    prototypeBudgetProjectionTestSource.includes('uses Station budget projection dimensions and clamps progress display percent') &&
    prototypeBudgetProjectionTestSource.includes('keeps fallback title on Station-owned routing') &&
    prototypeBudgetProjectionTestSource.includes('maps budget tones to display color keys without creating budget actions') &&
    !prototypeBudgetProjectionSource.includes('budget.write') &&
    !prototypeBudgetProjectionSource.includes('budget.halt') &&
    !prototypeBudgetProjectionSource.includes('budget.resume') &&
    !prototypeBudgetProjectionSource.includes('provider.invoke') &&
    !prototypeBudgetProjectionSource.includes('model.run') &&
    !prototypeBudgetProjectionSource.includes('cli.execute'),
  'Browser prototype budget projection helper must stay display-only and Station-owned',
);
assert.ok(
  prototypePageSource.includes('Read-only Station context projection: no Workspace file discovery, no Run input_snapshot write, and no') &&
    prototypeContextProjectionSource.includes('ATELIER_CONTEXT_FILE_GROUPS') &&
    prototypePageSource.includes('ATELIER_DEFAULT_CONTEXT_FILE_GROUP') &&
    prototypePageSource.includes('useState<ContextFileGroup>(ATELIER_DEFAULT_CONTEXT_FILE_GROUP)') &&
    prototypePageSource.includes('derivePrototypeContextProjectionView({ ctx, tab })') &&
    prototypePageSource.includes('contextView.tabs.map((contextTab) =>') &&
    prototypePageSource.includes('contextView.visibleFiles.map((f) =>') &&
    prototypePageSource.includes('contextView.hiddenFileCount') &&
    prototypeContextProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.contextFileRefs') &&
    prototypeContextProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.contextOtherRefs') &&
    prototypeContextProjectionSource.includes('ATELIER_CONTEXT_FILE_GROUPS.map((group) => ({') &&
    prototypeContextProjectionSource.includes('const filesForTab = input.ctx.files.filter((file) => file.group === input.tab);') &&
    prototypeContextProjectionTestSource.includes('renders generated context tabs without creating workspace discovery actions') &&
    prototypeContextProjectionTestSource.includes('uses generated file ref display limit for Station-projected file refs') &&
    prototypeContextProjectionTestSource.includes('uses generated other ref display limit independently from file refs') &&
    prototypeContextProjectionTestSource.includes('clamps context usage display without mutating Station context projection') &&
    prototypeTypesSource.includes('export type ContextFileGroup = (typeof ATELIER_CONTEXT_FILE_GROUPS)[number];') &&
    prototypeTypesSource.includes('group: ContextFileGroup;') &&
    !prototypePageSource.includes('useState<ContextFileGroup>(ATELIER_CONTEXT_FILE_GROUPS[0])') &&
    !prototypePageSource.includes("useState<'files' | 'other'>('files')") &&
    !prototypePageSource.includes("(['files', 'other'] as const).map((k) =>") &&
    !prototypeTypesSource.includes("group: 'files' | 'other'") &&
    prototypePageSource.includes('Host+Station+applet E2E proof in this prototype gate.') &&
    !prototypePageSource.includes('workspace.files.discover') &&
    !prototypePageSource.includes('WorkspaceFileDiscovery') &&
    !prototypePageSource.includes('context.files.refresh') &&
    !prototypePageSource.includes('input_snapshot.write') &&
    !prototypePageSource.includes('inputSnapshot.write'),
  'Browser prototype Context panel must stay read-only Station projection and must not expose workspace discovery or input snapshot writes',
);
assert.ok(
  prototypePageSource.includes('Read-only Station TaskGraph projection. The applet does not schedule, execute, or replan nodes.') &&
    prototypePageSource.includes('Parallel policy: {graphView.parallelPolicy}') &&
    prototypePageSource.includes('graphView.integratorRequired') &&
    prototypePageSource.includes('graphView.visibleRootTaskIds') &&
    prototypePageSource.includes('graphView.hiddenRootTaskIdCount') &&
    prototypePageSource.includes('graphView.visibleEdges') &&
    prototypePageSource.includes('graphView.hiddenEdgeCount') &&
    prototypePageSource.includes('nodeView.visibleArtifactRefs') &&
    prototypePageSource.includes('nodeView.hiddenArtifactCount') &&
    prototypePageSource.includes('nodeView.unresolvedArtifactCount') &&
    prototypePageSource.includes('nodeView.visibleGateRefs') &&
    prototypePageSource.includes('nodeView.hiddenGateCount') &&
    prototypePageSource.includes('nodeView.unresolvedGateCount') &&
    !prototypePageSource.includes('taskGraph.schedule') &&
    !prototypePageSource.includes('taskGraph.execute') &&
    !prototypePageSource.includes('taskGraph.replan') &&
    !prototypePageSource.includes('taskGraph.diff.apply') &&
    !prototypePageSource.includes('integrator.merge.execute'),
  'Browser prototype TaskGraph panel must stay read-only Station projection and must not expose scheduling/execution/replan capabilities',
);
assert.ok(
  prototypePageSource.includes('Read-only Station project health projection. The applet does not accept, waive, or mutate project state.') &&
    prototypePageSource.includes('derivePrototypeProjectHealthProjectionView(project)') &&
    prototypePageSource.includes('healthView.hiddenBlockerCount') &&
    prototypePageSource.includes('healthView.hiddenRiskCount') &&
    prototypePageSource.includes('healthView.hiddenMilestoneCount') &&
    prototypePageSource.includes('healthView.hiddenMemoryCandidateCount') &&
    prototypePageSource.includes('healthView.hiddenPolicyRuleCount') &&
    prototypePageSource.includes('healthView.hiddenDefectCount') &&
    prototypePageSource.includes('formatPrototypeProjectHealthMilestoneDetail(milestone)') &&
    prototypeProjectHealthProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems') &&
    prototypeProjectHealthProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthMilestones') &&
    prototypeProjectHealthProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.milestoneRefs') &&
    prototypeProjectHealthProjectionTestSource.includes('uses generated display limits for Project Health compact lists') &&
    prototypeProjectHealthProjectionTestSource.includes('treats missing policy as an empty read-only projection') &&
    prototypeProjectHealthProjectionTestSource.includes('formats milestone predicate and blocker refs with generated ref limits') &&
    !prototypePageSource.includes('project.health.accept') &&
    !prototypePageSource.includes('project.health.waive') &&
    !prototypePageSource.includes('project.state.mutate') &&
    !prototypePageSource.includes('acceptancePredicate.evaluate') &&
    !prototypePageSource.includes('policy.engine.run') &&
    !prototypePageSource.includes('defect.lifecycle.mutate'),
  'Browser prototype Project Health panel must stay read-only Station projection and must not expose project mutation/evaluator capabilities',
);
assert.ok(
  prototypePageSource.includes('title="Projection reload only; no execution, rerun, or provider invoke."') &&
    prototypePageSource.includes('resolvePrototypeStatusScenario(window.location.search)') &&
    prototypePageSource.includes('const visibleRuntimeStatus = scenarioStatus ?? runtimeStatus;') &&
    prototypePageSource.includes('derivePrototypePageSurface({ status: visibleRuntimeStatus, streamLength: stream.length })') &&
    prototypePageSource.includes('const statusActionPolicy = derivePrototypeStatusActionPolicy({ status: visibleRuntimeStatus, streamLength: stream.length });') &&
    prototypePageSource.includes('pageSurface.streamVisible ? stream.map(renderBlock) : null') &&
    prototypePageSource.includes('<RecoveryPanel status={recoveryStatus} retryVisible={statusActionPolicy.retryVisible} onRetry={reloadWorkspace} />') &&
    prototypePageSource.includes('statusActionPolicy.createProjectVisible ?') &&
    prototypePageSource.includes('retryVisible: boolean;') &&
    !prototypePageSource.includes('retryVisible ?? recoveryView.retryVisible') &&
    prototypeRuntimeSource.includes('return buildPrototypeRuntimeReadyStatus(state);') &&
    prototypeRecoveryViewSource.includes('export function buildPrototypeRuntimeReadyStatus') &&
    prototypeRecoveryViewSource.includes("prototypeStatusForScenario(state.tasks.length === 0 ? 'empty' : 'ready')") &&
    prototypeBridgeRuntimeSource.includes('return buildPrototypeBridgeLoadingStatus();') &&
    prototypeBridgeRuntimeSource.includes('return buildPrototypeBridgeEventStatus(lastEventSeq);') &&
    prototypeBridgeRuntimeSource.includes('return buildPrototypeBridgeReconcilingStatus();') &&
    prototypeBridgeRuntimeSource.includes('return buildPrototypeBridgeDegradedStatus(lastEventSeq);') &&
    prototypeBridgeRuntimeSource.includes('return buildPrototypeBridgeStatusFromError(error);') &&
    prototypeRecoveryViewSource.includes('export function buildPrototypeBridgeLoadingStatus') &&
    prototypeRecoveryViewSource.includes('export function buildPrototypeBridgeAuthDeniedStatus') &&
    prototypeRecoveryViewSource.includes('export function buildPrototypeBridgeStatusFromError') &&
    prototypeRecoveryViewSource.includes('export function prototypeBridgeRecoveryKindFromError') &&
    prototypeRecoveryViewSource.includes('isPrototypeRecord(error.error)') &&
    prototypeRecoveryViewSource.includes('ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind.loading') &&
    prototypeRecoveryViewSource.includes("ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind['auth-denied']") &&
    prototypeRecoveryViewSource.includes('ATELIER_VIEW_SURFACE.bridgeRuntimeRecoveryCodeKindByCode') &&
    prototypeRecoveryViewTestSource.includes('builds loading, ready, reconciling, and degraded status from generated bridge copy') &&
    prototypeRecoveryViewTestSource.includes('builds disconnected/auth-denied/error recovery statuses without execution payloads') &&
    prototypeRecoveryViewTestSource.includes('classifies structured Host error codes before legacy message fallback') &&
    prototypeRecoveryViewTestSource.includes("error: { code: 'STREAM_DISCONNECTED'") &&
    prototypeRecoveryViewTestSource.includes('uses legacy message fallback only when structured recovery code is absent') &&
    prototypeRecoveryViewTestSource.includes('uses the generated empty status copy when no task projection exists') &&
    prototypeRecoveryViewTestSource.includes('uses the generated ready status copy when at least one task projection exists') &&
    prototypeRecoveryViewTestSource.includes('keeps retryable recovery surfaces above implicit empty affordance') &&
    prototypeRecoveryViewTestSource.includes('covers every generated view status in the page surface matrix') &&
    !prototypeRuntimeSource.includes("title: '还没有 Atelier 任务'") &&
    !prototypeRuntimeSource.includes("title: 'Projection 已连接'") &&
    !prototypeBridgeRuntimeSource.includes('ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind.loading') &&
    !prototypeBridgeRuntimeSource.includes("ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind['auth-denied']") &&
    !prototypeBridgeRuntimeSource.includes('ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind.disconnected') &&
    !prototypeBridgeRuntimeSource.includes('ATELIER_VIEW_SURFACE.bridgeRuntimeStatusCopyByKind.error') &&
    !prototypeBridgeRuntimeSource.includes('ATELIER_VIEW_SURFACE.bridgeRuntimeRecoveryCodeKindByCode') &&
    !prototypeBridgeRuntimeSource.includes('function bridgeRuntimeRecoveryKindFromError') &&
    prototypePageSource.includes("source: 'reload'") &&
    prototypePageSource.includes('shouldApplyPrototypeWorkspaceSnapshot({'),
  'Browser prototype recovery retry must reload projection only, keep page surface derived, and must not expose execution/rerun/provider invoke',
);
assert.ok(
  prototypeBridgeRuntimeSource.includes('createPrototypeBridgeProjectionEventMemory()') &&
    prototypeBridgeRuntimeSource.includes('prototypeBridgeProjectionSubscriptionRejectedError(incomingEvent)') &&
    prototypeBridgeRuntimeSource.includes('canApplyPrototypeBridgeProjectionPatch(snapshot, event.patch)') &&
    prototypeBridgeRuntimeSource.includes('rememberPrototypeBridgeProjectionEvent(event, projectionEventMemory)') &&
    prototypeBridgeRuntimeSource.includes('rememberPrototypeBridgeProjectionSeq(event, projectionEventMemory)') &&
    prototypeBridgeRuntimeSource.includes('applyPrototypeBridgeProjectionPatch(snapshot, event.patch)') &&
    !prototypeBridgeRuntimeSource.includes('function applyPatch') &&
    !prototypeBridgeRuntimeSource.includes('function canApplyPatchToKnownTask') &&
    !prototypeBridgeRuntimeSource.includes('const MAX_SEEN_EVENT_KEYS') &&
    !prototypeBridgeRuntimeSource.includes('function rememberProjectionEvent') &&
    !prototypeBridgeRuntimeSource.includes('function rememberProjectionSeq') &&
    !prototypeBridgeRuntimeSource.includes('function projectionSubscriptionRejectedError') &&
    prototypeBridgeProjectionEventPolicySource.includes('export function applyPrototypeBridgeProjectionPatch') &&
    prototypeBridgeProjectionEventPolicySource.includes('export function canApplyPrototypeBridgeProjectionPatch') &&
    prototypeBridgeProjectionEventPolicySource.includes('export const MAX_PROTOTYPE_BRIDGE_PROJECTION_EVENT_KEYS = 500') &&
    prototypeBridgeProjectionEventPolicySource.includes('export function rememberPrototypeBridgeProjectionEvent') &&
    prototypeBridgeProjectionEventPolicySource.includes('export function rememberPrototypeBridgeProjectionSeq') &&
    prototypeBridgeProjectionEventPolicySource.includes('export function prototypeBridgeProjectionSubscriptionRejectedError') &&
    prototypeBridgeProjectionEventPolicySource.includes('const sanitizedCause: Record<string, unknown> = {') &&
    prototypeBridgeProjectionEventPolicySource.includes('cause: sanitizedCause') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('keeps task-scoped patches fail-closed unless the task is known or being created') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('applies projection patches without creating execution capabilities') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('deduplicates projection events with a bounded cache and keeps stale replay fail-closed by scope seq') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('tracks stale sequence rejection per workspace or task scope') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('builds stable subscription rejection errors without exposing execution payloads'),
  'Browser prototype bridge runtime must delegate projection event policy to pure helper with unit coverage',
);
assert.ok(
  prototypeBridgeProjectionEventPolicyTestSource.includes("providerInvoke: { provider: 'model' }") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("runtimeExecute: { taskId: 'task-1' }") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("input_snapshot: { prompt: 'must not leak' }") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("shellExecute: { command: 'open .' }") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("method: 'unknown'") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("reason: 'unknown rejection'") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('/provider\\.invoke|providerInvoke|runtime\\.execute|runtimeExecute|shell|memory\\.write|input_snapshot|run\\.execute/'),
  'Atelier prototype typed subscription rejection sanitized cause source unit matrix must preserve recovery code while stripping execution-shaped fields',
);
assert.ok(
  prototypeBridgeProjectionEventPolicySource.includes('function sanitizePrototypeProjectionSubscriptionReason(reason: string): string') &&
    prototypeBridgeProjectionEventPolicySource.includes('forbiddenPrototypeProjectionSubscriptionReasonPatterns') &&
    prototypeBridgeProjectionEventPolicySource.includes('sanitizePrototypeProjectionSubscriptionReason(value.reason)') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('sanitizes typed subscription rejection reason text before message and cause construction') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("reason: 'providerInvoke runtimeExecute shellExecute input_snapshot should not leak'") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes(
      'Atelier projection stream subscription atelier.events.subscribe rejected: Host projection subscription rejected',
    ) &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("reason: 'Host projection subscription rejected'") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('/provider\\.invoke|providerInvoke|runtime\\.execute|runtimeExecute|shellExecute|memory\\.write|input_snapshot|run\\.execute/'),
  'Atelier prototype projection event typed subscription rejection reason sanitization source unit matrix must strip execution-shaped reason text before message and cause construction',
);
assert.ok(
  prototypeBridgeProjectionEventPolicySource.includes('function sanitizePrototypeProjectionSubscriptionCode(code: string): string | undefined') &&
    prototypeBridgeProjectionEventPolicySource.includes('ATELIER_VIEW_SURFACE.bridgeRuntimeRecoveryCodeKindByCode') &&
    prototypeBridgeProjectionEventPolicySource.includes('sanitizePrototypeProjectionSubscriptionCode(value.code)') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('keeps only known typed subscription rejection recovery codes in sanitized cause') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("code: 'connection_closed'") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("code: 'CONNECTION_CLOSED'") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("code: 'providerInvoke runtimeExecute shellExecute input_snapshot should not leak'") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes("reason: 'host sent unknown code'") &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('/providerInvoke|runtimeExecute|shellExecute|input_snapshot/'),
  'Atelier prototype projection event typed subscription rejection code whitelist source unit matrix must keep only known recovery codes in Error.cause',
);
assert.ok(
  appletBridgeSource.includes('function projectionSubscriptionErrorReason(error: unknown): string') &&
    appletBridgeSource.includes('forbiddenProjectionSubscriptionReasonPatterns') &&
    appletBridgeSource.includes('reason: projectionSubscriptionErrorReason(error)') &&
    appletBridgeSource.includes('console.warn(`Atelier applet bridge ${method} rejected`, {') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('sanitizes rejected subscribe reason text before emitting typed recovery payload') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes("new Error('provider.invoke providerInvoke runtime.execute runtimeExecute shellExecute input_snapshot should not leak')") &&
    prototypeBridgeRuntimeOwnershipTestSource.includes("reason: 'Host projection subscription rejected'") &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('expect(warnings).toHaveLength(1)') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('JSON.stringify({ seen, warnings })'),
  'Atelier applet bridge typed subscription rejection reason and warning sanitization source unit matrix must strip execution-shaped fields while preserving structured code',
);
assert.ok(
  prototypeBridgeRuntimeSource.includes('derivePrototypeBridgeCallStatusStart({') &&
    prototypeBridgeRuntimeSource.includes('shouldApplyPrototypeBridgeCallStatus({') &&
    prototypeBridgeRuntimeSource.includes('projectionRevisionAtCall,') &&
    prototypeBridgeRuntimeSource.includes('shouldApplyPrototypeBridgeSnapshotResponse({') &&
    prototypeBridgeRuntimeSource.includes('clonePrototypeBridgeRuntimeSnapshot(snapshot)') &&
    !prototypeBridgeRuntimeSource.includes('callStatusToken === latestCallStatusToken') &&
    !prototypeBridgeRuntimeSource.includes('snapshotCallToken !== latestSnapshotCallToken') &&
    !prototypeBridgeRuntimeSource.includes('projectionRevisionAtCall !== projectionRevision') &&
    prototypeBridgeRuntimeCallPolicySource.includes('export function derivePrototypeBridgeCallStatusStart') &&
    prototypeBridgeRuntimeCallPolicySource.includes('currentStatus.kind ===') &&
    prototypeBridgeRuntimeCallPolicySource.includes('export function shouldApplyPrototypeBridgeCallStatus') &&
    prototypeBridgeRuntimeCallPolicySource.includes('input.callStatusToken === input.latestCallStatusToken') &&
    prototypeBridgeRuntimeCallPolicySource.includes('input.projectionRevisionAtCall === input.projectionRevision') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('lets only the latest Host call on the current projection revision own status restoration or error display') &&
    prototypeBridgeRuntimeCallPolicySource.includes('export function shouldApplyPrototypeBridgeSnapshotResponse') &&
    prototypeBridgeRuntimeCallPolicySource.includes('input.projectionRevisionAtCall === input.projectionRevision') &&
    prototypeBridgeRuntimeCallPolicySource.includes('export function clonePrototypeBridgeRuntimeSnapshot') &&
    prototypeBridgeRuntimeCallPolicySource.includes('assertPrototypeBridgeRuntimeSnapshotCloneable(snapshot)') &&
    prototypeBridgeRuntimeCallPolicySource.includes('forbiddenCapabilityKeyPatterns') &&
    prototypeBridgeRuntimeCallPolicySource.includes('forbiddenCapabilityPathPatterns') &&
    prototypeBridgeRuntimeCallPolicySource.includes('forbiddenPrototypePollutionKeys') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime ${context} contains forbidden capability key') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime ${context} contains forbidden capability path') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime ${context} contains forbidden prototype pollution key') &&
    prototypeBridgeRuntimeCallPolicySource.includes('isPlainProjectionObject') &&
    prototypeBridgeRuntimeCallPolicySource.includes('assertDenseProjectionArray') &&
    prototypeBridgeRuntimeCallPolicySource.includes('assertProjectionObjectOwnPropertiesVisible') &&
    prototypeBridgeRuntimeCallPolicySource.includes('optionalUndefinedObjectPathPatterns') &&
    prototypeBridgeRuntimeCallPolicySource.includes('isAllowedOptionalUndefinedObjectPath(path)') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime snapshot contains non-plain projection object') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime snapshot contains undefined projection array value') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime snapshot contains sparse projection array hole') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime ${context} contains symbol-keyed projection property') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime ${context} contains non-enumerable projection property') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime ${context} contains accessor projection property') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Object.getOwnPropertyDescriptors(value)') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime snapshot contains unregistered undefined projection object field') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime snapshot contains non-finite projection number') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Number.isFinite(node)') &&
    prototypeBridgeRuntimeCallPolicySource.includes('Atelier bridge runtime ${context} contains a circular projection reference') &&
    prototypeRuntimeSource.includes('let state = cloneState(seed)') &&
    prototypeRuntimeSource.includes('status: cloneStatus(status)') &&
    prototypeRuntimeSource.includes('function cloneStatus(status: AtelierRuntimeStatus): AtelierRuntimeStatus') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('preserves the restorable status when a new Host call starts from loading') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('lets only the latest Host call on the current projection revision own status restoration or error display') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('ignores stale snapshot responses after newer snapshot calls or projection events') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('clones runtime snapshots without sharing mutable projection buckets') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries executable capability values') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries forbidden capability-shaped keys') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries nested forbidden capability paths') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('keeps read-only provider projection display fields cloneable') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries non-plain projection objects') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries date-like runtime objects') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('keeps null-prototype projection dictionaries cloneable') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries prototype pollution keys') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries nested prototype pollution keys') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries undefined projection array values') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries sparse projection array holes') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('keeps dense projection arrays cloneable') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries symbol-keyed properties') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries non-enumerable properties') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries accessor getter properties') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries accessor setter properties') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('keeps cloned snapshots isolated from source snapshot mutations after cloning') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('keeps registered optional undefined projection object fields omittable') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a required projection object field is undefined') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when an unregistered projection object field is undefined') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries non-finite projection numbers') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('keeps finite projection numbers cloneable') &&
    prototypeBridgeRuntimeCallPolicyTestSource.includes('fails closed when a projected snapshot carries circular projection references') &&
    prototypeRuntimeSnapshotIsolationTestSource.includes('keeps getSnapshot state and status isolated from external mutations') &&
    prototypeRuntimeSnapshotIsolationTestSource.includes('keeps runtime state isolated from seed mutations after construction') &&
    prototypeRuntimeSource.includes('const replaceState = (next: AtelierState, nextSelectedTaskId = selectedTaskId) => {') &&
    prototypeRuntimeSource.includes('state = cloneState(next);') &&
    prototypeRuntimeSource.includes('return replaceState({ ...state, model });') &&
    prototypeRuntimeSnapshotIsolationTestSource.includes('keeps async returned snapshots isolated from external mutations') &&
    prototypeRuntimeSnapshotIsolationTestSource.includes('keeps transition-owned state isolated from returned projection mutations') &&
    prototypeBridgeRuntimeSource.includes('return cloneSnapshot(fromProjectionSnapshot(assertAtelierProjectionSnapshot(projection)));') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('keeps initial Host projection mutations from polluting runtime-owned state') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('keeps accepted Host call projection mutations from polluting runtime-owned state') &&
    prototypeBridgeProjectionEventPolicySource.includes('const ownedPatch = cloneProjectionPatch(patch);') &&
    prototypeBridgeProjectionEventPolicySource.includes('return cloneSnapshot(fromProjectionSnapshot(ownedPatch.snapshot));') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('keeps accepted event patch object mutations from polluting runtime-owned state') &&
    prototypeBridgeProjectionEventPolicyTestSource.includes('keeps snapshot patch object mutations from polluting runtime-owned state') &&
    prototypeBridgeRuntimeSource.includes('let activeProjectionSubscriptionToken = 0;') &&
    prototypeBridgeRuntimeSource.includes('const projectionSubscriptionToken = ++activeProjectionSubscriptionToken;') &&
    prototypeBridgeRuntimeSource.includes('if (projectionSubscriptionToken !== activeProjectionSubscriptionToken) return;') &&
    prototypeBridgeRuntimeSource.includes('let subscriptionCleanupReady = false;') &&
    prototypeBridgeRuntimeSource.includes('if (!subscriptionCleanupReady) return;') &&
    prototypeBridgeRuntimeSource.includes('subscriptionCleanupReady = true;') &&
    prototypeBridgeRuntimeSource.includes('const ready = projectionSubscriptionReady(cleanup);') &&
    prototypeBridgeRuntimeSource.includes('if (unsubscribeBridge !== cleanup) return;') &&
    prototypeBridgeRuntimeSource.includes('function projectionSubscriptionReady(cleanup: unknown): Promise<void> | void') &&
    appletBridgeSource.includes('return Object.assign(cleanup, { ready });') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('ignores released Host projection subscription callbacks while accepting the next subscription generation') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('ignores pre-cleanup Host projection subscription callbacks when cleanup is malformed') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('keeps projection subscription reconciling until Host subscribe ack settles') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('maps rejected Host subscribe ack to typed recovery without first marking ready') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('ignores stale Host subscribe ack resolve after subscription replacement') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('ignores stale Host subscribe ack rejection after subscription replacement') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('ignores late subscribe rejections after release without listener delivery duplicate unsubscribe or unhandled rejection') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes("rejectEventSubscribe(new Error('late rejected events.subscribe'))") &&
    prototypeBridgeRuntimeOwnershipTestSource.includes("rejectProjectionSubscribe(new Error('late rejected atelier.events.subscribe'))") &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('expect(calls.map((call) => call.method)).toEqual([') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('expect(unhandledRejections).toHaveLength(0)') &&
    prototypeBridgeRuntimeSource.includes('const projectionRevisionAtRefresh = projectionRevision;') &&
    prototypeBridgeRuntimeSource.includes('if (projectionRevisionAtRefresh !== projectionRevision) return;') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('ignores stale projection refresh failures after a newer subscription event') &&
    prototypeBridgeRuntimeSource.includes('projectionRefreshToken === latestProjectionRefreshToken') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('keeps synchronous refresh projection events from being overwritten by non-promise settlement') &&
    prototypeBridgeRuntimeSource.includes('prototypeBridgeProjectionSubscriptionRejectedError(incomingEvent)') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('keeps subscription rejection recovery from being overwritten by stale refresh success') &&
    prototypeBridgeRuntimeSource.includes("console.warn('Atelier bridge runtime cleanup failed', error);") &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('keeps subscription cleanup recovery from being overwritten by stale refresh success') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('keeps subscription rejection recovery from being overwritten by non-snapshot call success') &&
    prototypeBridgeRuntimeOwnershipTestSource.includes('keeps subscription rejection recovery from being overwritten by non-snapshot call failure'),
  'Browser prototype bridge runtime must delegate Host call ownership and stale response policy to pure helper with unit coverage',
);
assert.ok(
  prototypeRuntimeBootstrapSource.includes('isPrototypeHostRuntime(sdk.runtime)') &&
    prototypeRuntimeBootstrapSource.includes('return createMockAtelierRuntime();') &&
    prototypeRuntimeBootstrapSource.includes('createBridgeAtelierRuntime({') &&
    prototypeRuntimeBootstrapSource.includes('createAppletSdkAtelierBridge(sdk, {') &&
    prototypeRuntimeBootstrapSource.includes('buildPrototypeEmptyHostState()') &&
    prototypeRuntimeBootstrapSource.includes('buildPrototypeProjectionStreamConfig({') &&
    prototypeRuntimeBootstrapSource.includes('projectionStream: readProjectionStreamConfig(initialSnapshot)') &&
    prototypeRuntimeBootstrapSource.includes('selectedTaskId: initialSnapshot.selectedTaskId') &&
    prototypeRuntimeBootstrapSource.includes('return normalizePrototypeProjectionStreamConfig(input);') &&
    !prototypeRuntimeBootstrapSource.includes('const HOST_RUNTIMES') &&
    !prototypeRuntimeBootstrapSource.includes("model: 'openrouter-3o'") &&
    !prototypeRuntimeBootstrapSource.includes('record.agentId.trim()') &&
    !prototypeRuntimeBootstrapSource.includes('parsed > 0') &&
    prototypeRuntimeBootstrapPolicySource.includes("export const ATELIER_PROTOTYPE_HOST_RUNTIMES = ['lynx', 'web-host'] as const") &&
    prototypeRuntimeBootstrapPolicySource.includes('model: ATELIER_DEFAULT_DIRECT_RUN_MODEL') &&
    prototypeRuntimeBootstrapPolicySource.includes('record.agentId.trim()') &&
    prototypeRuntimeBootstrapPolicySource.includes('parsed > 0') &&
    prototypeRuntimeBootstrapPolicyTestSource.includes('allows only generated host-container runtime names to use the applet bridge') &&
    prototypeRuntimeBootstrapPolicyTestSource.includes('builds an empty Host seed with generated default model and no execution payloads') &&
    prototypeRuntimeBootstrapPolicyTestSource.includes('prefers explicit global stream config over query params and omits empty query config'),
  'Browser prototype runtime bootstrap must stay wiring-only and delegate Host seed / stream normalization policy to prototypeRuntimeBootstrap helper',
);
assert.doesNotMatch(
  prototypeRuntimeBootstrapSource,
  /atelier\.workspace\.load|atelier\.events\.subscribe|events\.subscribe|provider\.invoke|runtime\.execute|shell|input_snapshot|memory\.write|run\.execute|file\.write/,
  'Browser prototype runtime bootstrap must not call Host capabilities or smuggle execution-shaped payloads during startup',
);
for (const forbiddenPrototypeTopbarCapability of [
  'terminal.open',
  'atelier.terminal.open',
  'shell.execute',
  'execute.shell',
  'outline.open',
  'atelier.outline.open',
]) {
  assert.ok(
    !prototypePageSource.includes(forbiddenPrototypeTopbarCapability),
      `Browser prototype inline placeholder must not expose ${forbiddenPrototypeTopbarCapability}`,
  );
}
assert.ok(
  prototypePreviewSource.includes('const previewRequestKey = buildPrototypeArtifactPreviewRequestKey({ taskId, artifact, capabilityView });') &&
    prototypePreviewSource.includes('safeBodyRequestKeyRef.current = requestKey') &&
    prototypePreviewSource.includes('previewOpenRequestKeyRef.current = requestKey') &&
    prototypePreviewSource.includes('shouldApplyPrototypeArtifactPreviewResponse({') &&
    prototypePreviewSource.includes('prototypeArtifactBodyFetchErrorStatus(error)') &&
    prototypePreviewSource.includes('prototypeArtifactPreviewOpenErrorStatus(error)') &&
    prototypePreviewSource.includes('setSafeBody(null)') &&
    prototypePreviewSource.includes('setPreviewOpen(null)') &&
    prototypeArtifactPreviewProjectionSource.includes('export function buildPrototypeArtifactPreviewRequestKey') &&
    prototypeArtifactPreviewProjectionSource.includes('input.artifact.bodyHash ??') &&
    prototypeArtifactPreviewProjectionSource.includes('capabilityView.bodyRef') &&
    prototypeArtifactPreviewProjectionSource.includes('capabilityView.previewBodyRef') &&
    prototypeArtifactPreviewProjectionSource.includes('capabilityView.previewSandboxRef') &&
    prototypeArtifactPreviewProjectionSource.includes('export function shouldApplyPrototypeArtifactPreviewResponse') &&
    prototypeArtifactPreviewProjectionSource.includes('export function prototypeArtifactBodyFetchErrorStatus') &&
    prototypeArtifactPreviewProjectionSource.includes('export function prototypeArtifactPreviewOpenErrorStatus') &&
    prototypeArtifactPreviewProjectionTestSource.includes('keys preview requests by Station-projected artifact refs and rejects stale responses') &&
    prototypeArtifactPreviewProjectionTestSource.includes('normalizes preview request error copy without execution payloads'),
  'Browser prototype preview must reset stale safe body/sandbox state and ignore stale Host response promises when Station-projected artifact refs change',
);
assert.ok(
  prototypePreviewSource.includes('function ArtifactMetadataPreview') &&
    prototypePreviewSource.includes('Metadata-only artifact preview') &&
    prototypePreviewSource.includes('derivePrototypeArtifactMetadataPreviewView(artifact)') &&
    prototypePreviewSource.includes('derivePrototypeArtifactPreviewCapabilityView(artifact)') &&
    prototypePreviewSource.includes('derivePrototypeArtifactTrayItemView({ artifact: a, openId })') &&
    prototypePreviewSource.includes('const intent = buildPrototypeArtifactBodyFetchIntent({ taskId, artifact, capabilityView });') &&
    prototypePreviewSource.includes("if (intent.status !== 'fetchBody') return;") &&
    prototypePreviewSource.includes('void onFetchBody(intent.input)') &&
    prototypePreviewSource.includes('const intent = buildPrototypeArtifactPreviewOpenIntent({ taskId, artifact, capabilityView });') &&
    prototypePreviewSource.includes("if (intent.status !== 'openPreview') return;") &&
    prototypePreviewSource.includes('void onOpenPreview(intent.input)') &&
    prototypePreviewSource.includes('Browser prototype no longer renders raw markdown, iframe, image, diff, URL, or source fields from projection') &&
    prototypePreviewSource.includes('<ArtifactMetadataPreview artifact={artifact} />') &&
    prototypeArtifactPreviewProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.artifactPaths') &&
    prototypeArtifactPreviewProjectionSource.includes("metadataBadge: input.artifact.kind === 'diff' ? 'metadata-only' : ''") &&
    prototypeArtifactPreviewProjectionSource.includes('canFetchSafeBody: Boolean(bodyRef)') &&
    prototypeArtifactPreviewProjectionSource.includes('canOpenSandboxPreview: Boolean(previewSandboxRef && previewBodyRef)') &&
    prototypeArtifactPreviewProjectionSource.includes('export function buildPrototypeArtifactBodyFetchIntent') &&
    prototypeArtifactPreviewProjectionSource.includes("status: 'fetchBody'") &&
    prototypeArtifactPreviewProjectionSource.includes("reason: 'missing-station-body-ref'") &&
    prototypeArtifactPreviewProjectionSource.includes('export function buildPrototypeArtifactPreviewOpenIntent') &&
    prototypeArtifactPreviewProjectionSource.includes("status: 'openPreview'") &&
    prototypeArtifactPreviewProjectionSource.includes("reason: 'missing-station-preview-target'") &&
    prototypeArtifactPreviewProjectionSource.includes('export function buildPrototypeArtifactBodyFetchResponse') &&
    prototypeArtifactPreviewProjectionSource.includes('bodyHash: input.request.expectedHash ??') &&
    prototypeArtifactPreviewProjectionSource.includes('retentionStatus:') &&
    prototypeArtifactPreviewProjectionSource.includes('prototypeArtifactSafeText') &&
    prototypeArtifactPreviewProjectionSource.includes('export function buildPrototypeArtifactPreviewOpenResponse') &&
    prototypeArtifactPreviewProjectionSource.includes('ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE') &&
    prototypeArtifactPreviewProjectionSource.includes("methodPayloads['atelier.artifact.preview.open']") &&
    prototypeArtifactPreviewProjectionSource.includes('requiredRendererCapabilities') &&
    prototypeRuntimeSource.includes('buildPrototypeArtifactBodyFetchResponse({ request: input, artifact })') &&
    prototypeRuntimeSource.includes('buildPrototypeArtifactPreviewOpenResponse(input)') &&
    prototypeArtifactPreviewProjectionTestSource.includes('keeps diff cards metadata-only without synthetic patch stats') &&
    prototypeArtifactPreviewProjectionTestSource.includes('uses generated artifact path display limits for metadata preview paths') &&
    prototypeArtifactPreviewProjectionTestSource.includes('does not synthesize safe body or sandbox refs when Station projection omits them') &&
    prototypeArtifactPreviewProjectionTestSource.includes('builds ref-only safe body fetch intents from Station projection metadata') &&
    prototypeArtifactPreviewProjectionTestSource.includes('rejects safe body fetch intent when Station projection omits bodyRef') &&
    prototypeArtifactPreviewProjectionTestSource.includes('builds ref-only sandbox preview open intents without raw renderer fields') &&
    prototypeArtifactPreviewProjectionTestSource.includes('rejects sandbox preview open intent when Station projection omits preview refs') &&
    prototypeArtifactPreviewProjectionTestSource.includes('builds prototype safe body responses from Station-projected safe text metadata') &&
    prototypeArtifactPreviewProjectionTestSource.includes('uses diff path refs as prototype safe text without exposing patch apply affordances') &&
    prototypeArtifactPreviewProjectionTestSource.includes('truncates prototype safe body responses by positive request maxBytes') &&
    prototypeArtifactPreviewProjectionTestSource.includes('falls back to bounded prototype safe text when artifact metadata is missing') &&
    prototypeArtifactPreviewProjectionTestSource.includes('builds Host sandbox preview responses from generated renderer contract metadata') &&
    !prototypeRuntimeSource.includes('text.slice(0, maxBytes)') &&
    !prototypeRuntimeSource.includes('rendererSessionId: `atelier-preview:${input.taskId}:${input.artifactId}`') &&
    !prototypeRuntimeSource.includes("rendererOwner: 'desktop_host'") &&
    !prototypeRuntimeSource.includes("rendererMode: 'host_sandbox_manifest'") &&
    !prototypeRuntimeSource.includes("rendererStatus: 'rendered'") &&
    !prototypeRuntimeSource.includes("'host_visual_renderer_surface'") &&
    !prototypePreviewSource.includes('+73') &&
    !prototypePreviewSource.includes('-11') &&
    !prototypePreviewSource.includes('artifact.markdown') &&
    !prototypePreviewSource.includes('artifact.url') &&
    !prototypePreviewSource.includes('artifact.src') &&
    !prototypePreviewSource.includes('<iframe') &&
    !prototypePreviewSource.includes('<img'),
  'Browser prototype artifact preview must stay metadata-only and must not render raw artifact projection fields',
);
assert.ok(
  prototypePreviewSource.includes('Prototype-only mock logs: real Run runtime stream is not wired.') &&
    prototypePreviewSource.includes('prototypeArtifactLogTone(log.level)') &&
    prototypeArtifactPreviewProjectionTestSource.includes('maps mock console log levels to display tones without proving real Run runtime logs') &&
    !prototypePreviewSource.includes('runtime.logs.subscribe') &&
    !prototypePreviewSource.includes('atelier.logs.subscribe') &&
    !prototypePreviewSource.includes('console.logs.subscribe'),
  'Browser prototype Console Logs panel must disclose mock logs and must not wire runtime log subscription',
);
assert.ok(
  prototypeBlocksSource.includes('derivePrototypeDiffCardProjectionView(b)') &&
    prototypeBlocksSource.includes('diffView.visiblePaths.map') &&
    prototypeBlocksSource.includes('diffView.hiddenPathCount') &&
    prototypeDiffCardProjectionSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.diffPaths') &&
    prototypeDiffCardProjectionSource.includes('summaryLabel: `${block.files} files changed`') &&
    prototypeDiffCardProjectionSource.includes('hiddenPathCount: Math.max(0, block.paths.length - visiblePaths.length)') &&
    prototypeDiffCardProjectionTestSource.includes('uses generated diff path display limit for compact stream metadata') &&
    prototypeDiffCardProjectionTestSource.includes('builds summary labels from Station-projected diff metadata only') &&
    prototypeDiffCardProjectionTestSource.includes('renders empty diff path metadata without creating patch or execution affordances') &&
    prototypeDiffCardProjectionTestSource.includes('does not report hidden paths when projected refs fit the generated limit') &&
    !prototypeBlocksSource.includes('b.paths.map((p)') &&
    !prototypeDiffCardProjectionSource.includes('provider.invoke') &&
    !prototypeDiffCardProjectionSource.includes('patch.apply') &&
    !prototypeDiffCardProjectionSource.includes('runtime.execute'),
  'Browser prototype DiffCard must derive compact Station diff metadata through a pure helper without execution or patch affordances',
);
assert.ok(
  prototypePageSource.includes('Attachment input is prototype-only: image/file upload is not wired to Host Storage or Run input_snapshot yet.') &&
    !prototypePageSource.includes('atelier.attachment.upload') &&
    !prototypePageSource.includes('attachment.upload') &&
    !prototypePageSource.includes('HostStorage.write') &&
    !prototypePageSource.includes('input_snapshot.write') &&
    !prototypePageSource.includes('inputSnapshot.write'),
  'Browser prototype attachment input must stay disclosure-only and must not wire Host Storage or Run input_snapshot writes',
);
assert.ok(
  prototypePluginsSource.includes("id: 'kanban'") &&
    prototypePluginsSource.includes("id: 'dag'") &&
    prototypeTaskOrganizerProjectionSource.includes('ATELIER_TASK_ORGANIZER_MODES.map') &&
    prototypeTaskOrganizerProjectionSource.includes('ready: mode.ready') &&
    prototypeTaskOrganizerProjectionSource.includes('ATELIER_DEFAULT_TASK_ORGANIZER_MODE') &&
    prototypePluginsSource.includes('prototypeTaskOrganizerPluginDescriptors().map') &&
    prototypePluginsSource.includes('ready: descriptor.ready') &&
    prototypePluginsSource.includes('export const DEFAULT_PLUGIN_ID = prototypeDefaultTaskOrganizerPluginId();') &&
    prototypePluginsSource.includes('export function resolveTaskPlugin(pluginId: string): TaskPlugin') &&
    prototypePluginsSource.includes('item.id === DEFAULT_PLUGIN_ID') &&
    prototypeTaskOrganizerProjectionTestSource.includes('derives plugin descriptors and default plugin id from generated contract') &&
    !prototypePluginsSource.includes('export const DEFAULT_PLUGIN_ID = ATELIER_TASK_ORGANIZER_MODES[0].id;') &&
    prototypePageSource.includes('resolveTaskPlugin(pluginId)') &&
    !prototypePageSource.includes('PLUGINS.find((p) => p.id === pluginId) ?? PLUGINS[0]') &&
    !prototypePageSource.includes('?? PLUGINS[0]') &&
    prototypePluginsSource.includes('ready: false') &&
    prototypePluginsSource.includes('未实现') &&
    prototypePluginsSource.includes('实现 TaskPlugin.render 即可，数据模型与对话流不变。') &&
    !prototypePluginsSource.includes('organizer.reorder') &&
    !prototypePluginsSource.includes('organizer.schedule') &&
    !prototypePluginsSource.includes('organizer.execute') &&
    !prototypePluginsSource.includes('organizer.replan'),
  'Browser prototype organizer Kanban/DAG plugins must stay placeholders and must not expose reorder/schedule/execute/replan',
);
assert.ok(
  prototypePluginsSource.includes('derivePrototypeTaskOrganizerRowView({') &&
    prototypePluginsSource.includes('const lifecycleStatus = taskOrganizerActionToLifecycleStatus(key);') &&
    prototypePluginsSource.includes('host.setStatus(t.id, lifecycleStatus);') &&
    prototypePluginsSource.includes('host.requestPurge(t.id);') &&
    prototypePluginsSource.includes('host.purge(t.id);') &&
    prototypePluginsSource.includes('Station 仍会校验任务处于 deleted 后才允许 purge。') &&
    prototypePluginsSource.includes('derivePrototypeTaskOrganizerFoldersView(host.tasks)') &&
    prototypePluginsSource.includes('derivePrototypeTaskOrganizerBuckets(host.tasks)') &&
    prototypeTaskOrganizerProjectionSource.includes('TASK_ORGANIZER_ACTIONS_BY_STATUS') &&
    prototypeTaskOrganizerProjectionSource.includes("if (action === 'archive') return 'archived';") &&
    prototypeTaskOrganizerProjectionSource.includes("if (action === 'delete') return 'deleted';") &&
    prototypeTaskOrganizerProjectionSource.includes("if (action === 'restore') return 'active';") &&
    prototypeTaskOrganizerProjectionSource.includes("return ATELIER_TASK_LIFECYCLE_STATES;") &&
    prototypeTaskOrganizerProjectionTestSource.includes('derives active task lifecycle actions without execution actions') &&
    prototypeTaskOrganizerProjectionTestSource.includes('derives deleted task purge confirmation labels without bypassing Station precondition') &&
    prototypeTaskOrganizerProjectionTestSource.includes('partitions projected tasks by generated workbench lifecycle status') &&
    prototypeTaskOrganizerProjectionTestSource.includes('keeps organizer lifecycle taxonomy orthogonal to execution status values') &&
    prototypePageSource.includes('buildPrototypeTaskStatusIntent({') &&
    prototypePageSource.includes('const taskStatus = state.tasks.find((task) => task.id === id)?.status;') &&
    prototypePageSource.includes('buildPrototypeTaskPurgeIntent({ taskId: id, taskStatus })') &&
    prototypePageSource.includes("taskLifecycleRequestKeyRef.current = buildPrototypeTaskLifecycleRequestKey({ kind: 'setStatus', taskId: selected })") &&
    prototypePageSource.includes("kind: 'setStatus',") &&
    prototypePageSource.includes("kind: 'purge',") &&
    prototypePageSource.includes('taskLifecycleRequestKeyRef.current = requestKey') &&
    prototypePageSource.includes('shouldApplyPrototypeTaskLifecycleSnapshot({') &&
      prototypePageSource.includes('Task lifecycle is intent-only; failures reuse bridge recovery status.') &&
      prototypePageSource.includes('setRuntimeStatus(buildPrototypeBridgeStatusFromError(error));') &&
      !prototypePageSource.includes('setStatus: (id, status: TaskStatus) => {\n          const intent = buildPrototypeTaskStatusIntent({') &&
      !prototypePageSource.includes('purge: (id) => {\n          const intent = buildPrototypeTaskPurgeIntent({ taskId: id });') &&
    prototypePageSource.includes('status: intent.taskStatus') &&
    prototypeTaskLifecycleIntentSource.includes('export function buildPrototypeTaskLifecycleRequestKey') &&
    prototypeTaskLifecycleIntentSource.includes('return `kind:${input.kind}|task:${taskId}|status:${status}`;') &&
    prototypeTaskLifecycleIntentSource.includes('export function shouldApplyPrototypeTaskLifecycleSnapshot') &&
    prototypeTaskLifecycleIntentSource.includes('ATELIER_TASK_LIFECYCLE_STATES.includes') &&
    prototypeTaskLifecycleIntentSource.includes('ATELIER_TASK_LIFECYCLE.purgeRequiresStatus') &&
    prototypeTaskLifecycleIntentSource.includes("status: 'setStatus'") &&
    prototypeTaskLifecycleIntentSource.includes("status: 'purge'") &&
    prototypeRuntimeSource.includes('buildPrototypeTaskStatusProjection({') &&
    prototypeRuntimeSource.includes('buildPrototypeTaskPurgeProjection({') &&
    prototypeTaskLifecycleIntentSource.includes('export function buildPrototypeTaskStatusProjection') &&
    prototypeTaskLifecycleIntentSource.includes('export function buildPrototypeTaskPurgeProjection') &&
    prototypeTaskLifecycleIntentTestSource.includes('builds Station-owned setStatus intents from generated lifecycle status values') &&
    prototypeTaskLifecycleIntentTestSource.includes('rejects execution-shaped status values before runtime calls') &&
    prototypeTaskLifecycleIntentTestSource.includes('builds Station-owned purge intents from task ids only') &&
    prototypeTaskLifecycleIntentTestSource.includes('rejects purge intents unless the projected task status is deleted') &&
    prototypeTaskLifecycleIntentTestSource.includes('projects generated task lifecycle status without creating execution payloads') &&
    prototypeTaskLifecycleIntentTestSource.includes('projects purge by removing task and task-owned side buckets') &&
    prototypeTaskLifecycleIntentTestSource.includes('keeps selected task when purging a non-selected task') &&
    prototypeTaskLifecycleIntentTestSource.includes('keys lifecycle snapshot requests by kind, task, and status without execution payloads') &&
    prototypeTaskLifecycleIntentTestSource.includes('rejects stale lifecycle snapshots after task, status, or operation ownership changes') &&
    !prototypeRuntimeSource.includes('tasks: state.tasks.map((task) =>') &&
    !prototypeRuntimeSource.includes('const tasks = state.tasks.filter((task) => task.id !== taskId);') &&
    !prototypePageSource.includes('runtime.setTaskStatus({\n          taskId: intent.taskId,\n          status: intent.taskStatus,\n        }).then(applySnapshot);') &&
    !prototypePageSource.includes('runtime.purgeTask(intent.taskId).then(applySnapshot);') &&
    !prototypePluginsSource.includes('task.execute') &&
    !prototypePluginsSource.includes('task.schedule') &&
    !prototypePluginsSource.includes('task.replan') &&
    !prototypePluginsSource.includes('task.deleteNow') &&
    !prototypePluginsSource.includes('task.purgeWithoutDeleted') &&
    !prototypePluginsSource.includes('organizer.execute'),
  'Browser prototype task lifecycle menu must use lifecycle status/purge intents and must not expose execution or purge bypass capabilities',
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
  ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
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
    assert.throws(() => assertAtelierProjectionSnapshot(invalidSnapshot));
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

async function testRuntimeBootstrapNormalizesProjectionStreamConfig() {
  const { normalizeProjectionStreamConfig } = await import('./packages/prototypes/desktop/applets/atelier/src/runtimeBootstrap.ts');
  const { toProjectionSnapshot } = await import('./packages/prototypes/desktop/applets/atelier/src/projection.ts');
  const { ATELIER_DEFAULT_DIRECT_RUN_MODEL } = await import('./packages/prototypes/desktop/applets/atelier/src/projection.contract.generated.ts');
  const {
    buildPrototypeEmptyHostState,
    buildPrototypeProjectionStreamConfig,
    isPrototypeHostRuntime,
  } = await import('./packages/prototypes/desktop/applets/atelier/src/prototypeRuntimeBootstrap.ts');
  assert.equal(isPrototypeHostRuntime('lynx'), true);
  assert.equal(isPrototypeHostRuntime('web-host'), true);
  assert.equal(isPrototypeHostRuntime('browser'), false);
  assert.equal(isPrototypeHostRuntime('vite'), false);
  assert.equal(isPrototypeHostRuntime('node'), false);
  assert.equal(isPrototypeHostRuntime('desktop'), false);
  assert.equal(isPrototypeHostRuntime('Lynx'), false);
  assert.equal(isPrototypeHostRuntime(' lynx '), false);
  assert.equal(isPrototypeHostRuntime('web-host-preview'), false);
  assert.equal(isPrototypeHostRuntime(''), false);
  assert.deepEqual(
    buildPrototypeEmptyHostState(),
    {
      budgetSpent: 0,
      budgetCap: 1,
      model: ATELIER_DEFAULT_DIRECT_RUN_MODEL,
      tasks: [],
      selectedTaskId: '',
      stream: {},
      todos: {},
      context: {},
      artifacts: {},
      gates: {},
    },
    'runtime bootstrap Host seed must be an empty projection surface without mock tasks or execution payloads',
  );
  assert.doesNotMatch(
    JSON.stringify(buildPrototypeEmptyHostState()),
    /provider\.invoke|runtime\.execute|shell|input_snapshot|memory\.write|run\.execute|file\.write/,
    'runtime bootstrap Host seed must not smuggle execution-shaped payloads into the applet bridge',
  );
  assert.equal(normalizeProjectionStreamConfig(undefined), undefined);
  assert.equal(normalizeProjectionStreamConfig({ agentId: '   ', taskId: 'task-1', afterEventSeq: 7 }), undefined);
  assert.deepEqual(
    normalizeProjectionStreamConfig({ agentId: ' agent-1 ', taskId: ' task-1 ', afterEventSeq: '42' }),
    { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 42 },
  );
  assert.deepEqual(
    normalizeProjectionStreamConfig({ agentId: 'agent-2', taskId: '   ', afterEventSeq: 0 }),
    { agentId: 'agent-2' },
  );
  assert.deepEqual(
    normalizeProjectionStreamConfig({ agentId: 'agent-3', afterEventSeq: 'not-a-number' }),
    { agentId: 'agent-3' },
  );
  assert.deepEqual(
    normalizeProjectionStreamConfig({ agentId: ' agent-primary ', agentIds: ['agent-fallback'], taskId: 'task-1' }),
    { agentId: 'agent-primary', taskId: 'task-1' },
    'runtime bootstrap must prefer explicit agentId before generated agentIds[0] fallback',
  );
  assert.deepEqual(
    normalizeProjectionStreamConfig({ agentIds: [' agent-from-list ', 'agent-ignored'], afterEventSeq: '7' }),
    { agentId: 'agent-from-list', afterEventSeq: 7 },
    'runtime bootstrap must support generated agentIds[0] fallback for Host global stream config',
  );
  assert.equal(
    normalizeProjectionStreamConfig({ agentIds: ['   ', 'agent-ignored'] }),
    undefined,
    'runtime bootstrap must reject empty generated agentIds[0] fallback fail-closed',
  );
  const streamConfigSnapshot = toProjectionSnapshot({
    ...buildPrototypeEmptyHostState(),
    selectedTaskId: 'snapshot-selected',
    tasks: [
      { id: 'snapshot-selected', title: 'Snapshot selected', project: 'peers-touch', status: 'active' },
      { id: 'first-task', title: 'First task', project: 'peers-touch', status: 'active' },
    ],
  });
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({
      globalConfig: { agentId: 'agent-1', taskId: ' explicit-task ' },
      selectedTaskId: 'selected-task',
      initialSnapshot: streamConfigSnapshot,
    }),
    { agentId: 'agent-1', taskId: 'explicit-task' },
    'runtime bootstrap must prefer explicit taskId before generated selected/snapshot task fallback',
  );
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({
      globalConfig: { agentId: 'agent-1' },
      selectedTaskId: ' selected-task ',
      initialSnapshot: streamConfigSnapshot,
    }),
    { agentId: 'agent-1', taskId: 'selected-task' },
    'runtime bootstrap must support generated controllerSelectedTaskId fallback',
  );
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({
      globalConfig: { agentId: 'agent-1' },
      initialSnapshot: toProjectionSnapshot({
        ...buildPrototypeEmptyHostState(),
        tasks: [{ id: 'first-task', title: 'First task', project: 'peers-touch', status: 'active' }],
      }),
    }),
    { agentId: 'agent-1', taskId: 'first-task' },
    'runtime bootstrap must support generated snapshotFirstTaskId fallback',
  );
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({
      globalConfig: { agentId: 'agent-1', certificationMode: 'product-window-e2e', createGoal: 'build atelier' },
      initialSnapshot: streamConfigSnapshot,
    }),
    { agentId: 'agent-1', taskId: 'snapshot-selected' },
    'runtime bootstrap must support generated certificationCreatedSelectedTaskId fallback',
  );
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({
      globalConfig: { agentId: ' global-agent ', taskId: ' global-task ', afterEventSeq: 12 },
      search: '?agentId=query-agent&taskId=query-task&afterEventSeq=5',
    }),
    { agentId: 'global-agent', taskId: 'global-task', afterEventSeq: 12 },
    'runtime bootstrap must prefer explicit global projection stream config over URL query params',
  );
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({
      globalConfig: { agentId: '   ', taskId: 'ignored-task', afterEventSeq: 9 },
      search: '?agentId=query-agent&taskId=&afterEventSeq=0',
    }),
    { agentId: 'query-agent' },
    'runtime bootstrap must fall back to query params when global projection stream config is invalid',
  );
  assert.equal(
    buildPrototypeProjectionStreamConfig({ search: '?taskId=task-only&afterEventSeq=4' }),
    undefined,
    'runtime bootstrap must reject query-only projection stream config without agentId',
  );
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({ search: '?agentIds=query-agent-from-list&agentIds=query-agent-ignored&afterEventSeq=8' }),
    { agentId: 'query-agent-from-list', afterEventSeq: 8 },
    'runtime bootstrap query config must support generated agentIds[0] fallback',
  );
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({ search: '?agentId=query-agent&agentIds=query-agent-from-list&taskId=query-task' }),
    { agentId: 'query-agent', taskId: 'query-task' },
    'runtime bootstrap query config must prefer agentId before generated agentIds[0] fallback',
  );
  assert.equal(
    buildPrototypeProjectionStreamConfig({ search: '?agentIds=&taskId=task-only&afterEventSeq=4' }),
    undefined,
    'runtime bootstrap query config must reject empty generated agentIds[0] fallback fail-closed',
  );
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({
      search: '?agentId=query-agent',
      selectedTaskId: ' selected-query-task ',
      initialSnapshot: streamConfigSnapshot,
    }),
    { agentId: 'query-agent', taskId: 'selected-query-task' },
    'runtime bootstrap query config must support generated controllerSelectedTaskId fallback',
  );
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({
      search: '?agentId=query-agent',
      initialSnapshot: toProjectionSnapshot({
        ...buildPrototypeEmptyHostState(),
        tasks: [{ id: 'query-first-task', title: 'Query first task', project: 'peers-touch', status: 'active' }],
      }),
    }),
    { agentId: 'query-agent', taskId: 'query-first-task' },
    'runtime bootstrap query config must support generated snapshotFirstTaskId fallback',
  );
  assert.deepEqual(
    buildPrototypeProjectionStreamConfig({
      search: '?agentId=query-agent&certificationMode=product-window-e2e&createGoal=build%20atelier',
      initialSnapshot: toProjectionSnapshot({
        ...buildPrototypeEmptyHostState(),
        selectedTaskId: 'query-created-task',
        tasks: [{ id: 'query-created-task', title: 'Query created task', project: 'peers-touch', status: 'active' }],
      }),
    }),
    { agentId: 'query-agent', taskId: 'query-created-task' },
    'runtime bootstrap query config must support generated certificationCreatedSelectedTaskId fallback',
  );
}

async function testAppletBridgeUsesReplayCursor() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const initialSnapshot = snapshot('task-cursor');
  initialSnapshot.workspace.replay = {
    'task-cursor': {
      source: 'checkpoint',
      eventCount: 10,
      replayedEventCount: 6,
      nextEventSeq: 42,
      hasMore: true,
    },
  };
  const harness = appletHostWithInvoke(initialSnapshot);
  const bridge = createAppletSdkAtelierBridge(harness.host, {
    projectionStream: { agentId: 'agent-cursor' },
    initialSnapshot,
  });
  const unsubscribe = bridge.subscribeProjection(() => {});
  assert.deepEqual(
    harness.calls.find((call) => call.method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD)?.params,
    { agentId: 'agent-cursor', taskId: 'task-cursor', afterEventSeq: 42 },
  );
  unsubscribe();
}

async function testAppletBridgeOmitsEmptyReplayCursorFields() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const emptySnapshot = snapshot('');
  const harness = appletHostWithEventTracking(emptySnapshot);
  const bridge = createAppletSdkAtelierBridge(harness.host, {
    projectionStream: { agentId: 'agent-empty-cursor' },
    initialSnapshot: emptySnapshot,
  });

  const unsubscribe = bridge.subscribeProjection(() => {});
  assert.deepEqual(
    harness.calls.find((call) => call.method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD)?.params,
    { agentId: 'agent-empty-cursor' },
  );
  unsubscribe();
}

async function testAppletBridgeRejectsEmptyProjectionStreamAgentIdFailClosed() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const emptySnapshot = snapshot('');
  const harness = appletHostWithEventTracking(emptySnapshot);
  const seen = [];
  const bridge = createAppletSdkAtelierBridge(harness.host, {
    projectionStream: { agentId: '   ', taskId: 'task-should-not-subscribe', afterEventSeq: 7 },
    initialSnapshot: emptySnapshot,
  });

  const unsubscribe = bridge.subscribeProjection((event) => {
    seen.push(event);
  });
  harness.emit(ATELIER_PROJECTION_EVENT_TOPIC, { kind: 'evt-after-empty-agent-id' });

  assert.equal(
    harness.calls.some((call) => call.method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD),
    false,
    'empty projection stream agentId must not call canonical Station subscription',
  );
  assert.equal(seen[0].kind, 'atelier.projection.subscription-rejected');
  assert.equal(seen[0].method, ATELIER_PROJECTION_SUBSCRIPTION_METHOD);
  assert.match(seen[0].reason, /agentId missing/);
  assert.equal(harness.eventUnsubscriptions.length, 1);
  assert.equal(
    harness.calls.filter((call) => call.method === 'events.unsubscribe').length,
    1,
    'empty projection stream agentId rejection must release the Host projection topic subscription',
  );
  assert.equal(seen.some((event) => event.kind === 'evt-after-empty-agent-id'), false);
  unsubscribe();
  assert.equal(
    harness.calls.filter((call) => call.method === 'events.unsubscribe').length,
    1,
    'release after fail-closed rejection must not duplicate Host topic cleanup',
  );
}

async function testAppletBridgeExplicitProjectionStreamIntentWinsOverSnapshotCursor() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const initialSnapshot = snapshot('task-snapshot-cursor');
  initialSnapshot.workspace.replay = {
    'task-snapshot-cursor': {
      source: 'checkpoint',
      eventCount: 10,
      replayedEventCount: 4,
      nextEventSeq: 42,
      hasMore: true,
    },
  };
  const harness = appletHostWithEventTracking(initialSnapshot);
  const bridge = createAppletSdkAtelierBridge(harness.host, {
    projectionStream: { agentId: 'agent-explicit', taskId: 'task-explicit', afterEventSeq: 7 },
    initialSnapshot,
  });

  const unsubscribe = bridge.subscribeProjection(() => {});
  assert.deepEqual(
    harness.calls.find((call) => call.method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD)?.params,
    { agentId: 'agent-explicit', taskId: 'task-explicit', afterEventSeq: 7 },
  );
  unsubscribe();
}

async function testAppletBridgeProductWindowZeroCursorReachesHostSubscribe() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const initialSnapshot = snapshot('task-zero-cursor');
  initialSnapshot.workspace.replay = {
    'task-zero-cursor': {
      source: 'checkpoint',
      eventCount: 10,
      replayedEventCount: 4,
      nextEventSeq: 42,
      hasMore: true,
    },
  };
  const harness = appletHostWithEventTracking(initialSnapshot);
  const bridge = createAppletSdkAtelierBridge(harness.host, {
    projectionStream: {
      agentId: 'agent-zero',
      taskId: 'task-zero-cursor',
      afterEventSeq: 0,
      preserveZeroCursor: true,
    },
    initialSnapshot,
  });

  const unsubscribe = bridge.subscribeProjection(() => {});
  assert.deepEqual(
    harness.calls.find((call) => call.method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD)?.params,
    { agentId: 'agent-zero', taskId: 'task-zero-cursor', afterEventSeq: 0 },
  );
  unsubscribe();
}

async function testBridgeRuntimeRefreshesProjectionSubscribeAfterCreatedSelectedTask() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const initialSnapshot = snapshot('');
  const createdSnapshot = snapshot('created-task');
  createdSnapshot.workspace.replay = {
    'created-task': {
      source: 'event-window',
      eventCount: 0,
      replayedEventCount: 0,
      nextEventSeq: 12,
      hasMore: false,
    },
  };
  const calls = [];
  const handlers = new Map();
  const bridge = createAppletSdkAtelierBridge({
    async invoke(method, params) {
      calls.push({ method, params });
      if (method === 'atelier.project.createFromGoal') return createdSnapshot;
      return {};
    },
    onEvent(topic, handler) {
      handlers.set(topic, handler);
      return () => {
        handlers.delete(topic);
      };
    },
  }, {
    projectionStream: {
      agentId: 'agent-created-task',
      certificationMode: 'product-window-e2e',
      createGoal: 'build atelier',
      afterEventSeq: 0,
      preserveZeroCursor: true,
    },
    initialSnapshot,
  });
  const runtime = createBridgeAtelierRuntime({
    bridge,
    initialSnapshot,
  });
  const unsubscribe = runtime.subscribe(() => {});
  assert.deepEqual(
    calls.filter((call) => call.method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD).map((call) => call.params),
    [{ agentId: 'agent-created-task', afterEventSeq: 0 }],
    'initial empty Host snapshot must subscribe only by agent and explicit zero cursor',
  );

  await runtime.createProjectFromGoal({
    goal: 'build atelier',
    intentPreset: 'work',
    run: { kind: 'model', model: 'openrouter-3o' },
  });

  const subscribePayloads = calls
    .filter((call) => call.method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD)
    .map((call) => call.params);
  assert.deepEqual(subscribePayloads, [
    { agentId: 'agent-created-task', afterEventSeq: 0 },
    { agentId: 'agent-created-task', taskId: 'created-task', afterEventSeq: 0 },
  ]);
  assert.doesNotMatch(
    JSON.stringify(subscribePayloads.at(-1)),
    /certificationMode|createGoal|selectedTaskId|provider|gate|artifact|trace|checkpoint|resume|memory|input_snapshot|shell|file|run/,
  );
  assert.equal(runtime.getSnapshot().state.selectedTaskId, 'created-task');
  unsubscribe();
}

async function testBridgeRuntimeKeepsReconcilingUntilRefreshedProjectionSubscribeSettles() {
  const initialSnapshot = snapshot('');
  const createdSnapshot = snapshot('created-task');
  const refresh = deferredPromise();
  const refreshes = [];
  const runtime = createBridgeAtelierRuntime({
    bridge: {
      async call(request) {
        if (request.method === 'atelier.project.createFromGoal') return createdSnapshot;
        return snapshot('');
      },
      subscribeProjection() {
        return () => {};
      },
      refreshProjectionSubscription(projection) {
        refreshes.push(projection.selectedTaskId);
        return refresh.promise;
      },
    },
    initialSnapshot,
  });
  const seen = [];
  const unsubscribe = runtime.subscribe((next) => {
    seen.push(next.status?.kind);
  });

  const result = await runtime.createProjectFromGoal({
    goal: 'build atelier',
    intentPreset: 'work',
    run: { kind: 'model', model: 'openrouter-3o' },
  });

  assert.deepEqual(refreshes, ['created-task']);
  assert.equal(result.state.selectedTaskId, 'created-task');
  assert.equal(result.status?.kind, 'reconciling');
  assert.equal(runtime.getSnapshot().status?.kind, 'reconciling');
  assert.equal(seen.includes('ready'), false, 'bridge runtime must not report ready before refreshed projection subscribe settles');

  refresh.resolve();
  await refresh.promise;
  await Promise.resolve();

  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.doesNotMatch(
    JSON.stringify(runtime.getSnapshot()),
    /provider\.invoke|gate\.run|artifact\.write|trace\.write|checkpoint\.write|resume\.execute|memory\.write|input_snapshot|shell|file\.write|run\.execute/,
    'bridge runtime refreshed subscribe handoff must not expose execution-shaped capabilities',
  );
  unsubscribe();
}

async function testBridgeRuntimeMapsRejectedRefreshedProjectionSubscribeToRecovery() {
  const initialSnapshot = snapshot('');
  const createdSnapshot = snapshot('created-task');
  const refresh = deferredPromise();
  const runtime = createBridgeAtelierRuntime({
    bridge: {
      async call(request) {
        if (request.method === 'atelier.project.createFromGoal') return createdSnapshot;
        return snapshot('');
      },
      subscribeProjection() {
        return () => {};
      },
      refreshProjectionSubscription() {
        return refresh.promise;
      },
    },
    initialSnapshot,
  });
  const unsubscribe = runtime.subscribe(() => {});

  const result = await runtime.createProjectFromGoal({
    goal: 'build atelier',
    intentPreset: 'work',
    run: { kind: 'model', model: 'openrouter-3o' },
  });
  assert.equal(result.status?.kind, 'reconciling');

  refresh.reject(Object.assign(new Error('CONNECTION_CLOSED refreshed subscribe'), { code: 'CONNECTION_CLOSED' }));
  await refresh.promise.catch(() => undefined);
  await Promise.resolve();

  assert.equal(runtime.getSnapshot().state.selectedTaskId, 'created-task');
  assert.equal(runtime.getSnapshot().status?.kind, 'disconnected');
  assert.equal(runtime.getSnapshot().status?.retryable, true);
  unsubscribe();
}

async function testBridgeRuntimeIgnoresStaleRefreshedProjectionSubscribeSettlement() {
  const initialSnapshot = snapshot('');
  const firstCreatedSnapshot = snapshot('created-task-one');
  const secondCreatedSnapshot = snapshot('created-task-two');
  const firstRefresh = deferredPromise();
  const secondRefresh = deferredPromise();
  const refreshes = [];
  let createCount = 0;
  const runtime = createBridgeAtelierRuntime({
    bridge: {
      async call(request) {
        if (request.method === 'atelier.project.createFromGoal') {
          createCount += 1;
          return createCount === 1 ? firstCreatedSnapshot : secondCreatedSnapshot;
        }
        return snapshot('');
      },
      subscribeProjection() {
        return () => {};
      },
      refreshProjectionSubscription(projection) {
        refreshes.push(projection.selectedTaskId);
        return refreshes.length === 1 ? firstRefresh.promise : secondRefresh.promise;
      },
    },
    initialSnapshot,
  });
  const seen = [];
  const unsubscribe = runtime.subscribe((next) => {
    seen.push({
      taskId: next.state.selectedTaskId,
      status: next.status?.kind,
    });
  });

  const firstResult = await runtime.createProjectFromGoal({
    goal: 'build atelier one',
    intentPreset: 'work',
    run: { kind: 'model', model: 'openrouter-3o' },
  });
  assert.equal(firstResult.state.selectedTaskId, 'created-task-one');
  assert.equal(firstResult.status?.kind, 'reconciling');

  const secondResult = await runtime.createProjectFromGoal({
    goal: 'build atelier two',
    intentPreset: 'work',
    run: { kind: 'model', model: 'openrouter-3o' },
  });
  assert.deepEqual(refreshes, ['created-task-one', 'created-task-two']);
  assert.equal(secondResult.state.selectedTaskId, 'created-task-two');
  assert.equal(runtime.getSnapshot().state.selectedTaskId, 'created-task-two');
  assert.equal(runtime.getSnapshot().status?.kind, 'reconciling');

  firstRefresh.reject(Object.assign(new Error('CONNECTION_CLOSED stale refreshed subscribe'), { code: 'CONNECTION_CLOSED' }));
  await firstRefresh.promise.catch(() => undefined);
  await Promise.resolve();

  assert.equal(runtime.getSnapshot().state.selectedTaskId, 'created-task-two');
  assert.equal(
    runtime.getSnapshot().status?.kind,
    'reconciling',
    'stale refreshed projection subscribe rejection must not overwrite newer reconciling surface',
  );

  secondRefresh.resolve();
  await secondRefresh.promise;
  await Promise.resolve();

  assert.equal(runtime.getSnapshot().state.selectedTaskId, 'created-task-two');
  assert.equal(runtime.getSnapshot().status?.kind, 'ready');
  assert.equal(
    seen.some((entry) => entry.taskId === 'created-task-two' && entry.status === 'disconnected'),
    false,
    'stale refreshed projection subscribe rejection must not emit disconnected for newer projection',
  );
  assert.doesNotMatch(
    JSON.stringify(runtime.getSnapshot()),
    /provider\.invoke|gate\.run|artifact\.write|trace\.write|checkpoint\.write|resume\.execute|memory\.write|input_snapshot|shell|file\.write|run\.execute/,
    'stale refreshed projection subscribe race guard must not expose execution-shaped capabilities',
  );
  unsubscribe();
}

async function testAppletBridgeUnsubscribesProjectionTopicAndStream() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const initialSnapshot = snapshot('task-cleanup');
  const harness = appletHostWithEventTracking(initialSnapshot);
  const bridge = createAppletSdkAtelierBridge(harness.host, {
    projectionStream: { agentId: 'agent-cleanup', taskId: 'task-cleanup', afterEventSeq: 7 },
    initialSnapshot,
  });

  const seen = [];
  const unsubscribe = bridge.subscribeProjection((payload) => {
    seen.push(payload);
  });
  assert.deepEqual(
    harness.calls.map((call) => call.method),
    ['events.subscribe', ATELIER_PROJECTION_SUBSCRIPTION_METHOD],
  );
  assert.deepEqual(
    harness.calls.find((call) => call.method === 'events.subscribe')?.params,
    { topic: ATELIER_PROJECTION_EVENT_TOPIC },
  );
  assert.deepEqual(
    harness.calls.find((call) => call.method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD)?.params,
    { agentId: 'agent-cleanup', taskId: 'task-cleanup', afterEventSeq: 7 },
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
    }, {
      projectionStream: { agentId: 'agent-release-unsubscribe-rejected', taskId: 'task-release-unsubscribe-rejected', afterEventSeq: 5 },
      initialSnapshot: snapshot('task-release-unsubscribe-rejected'),
    });

    const seen = [];
    const unsubscribe = bridge.subscribeProjection((payload) => {
      seen.push(payload);
    });
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
      ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
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
    projectionStream: { agentId: 'agent-topic', taskId: 'task-topic', afterEventSeq: 3 },
    initialSnapshot,
  });
  const seen = [];

  const unsubscribe = bridge.subscribeProjection((payload) => {
    seen.push(payload);
  });
  assert.deepEqual(
    harness.calls.find((call) => call.method === 'events.subscribe')?.params,
    { topic: customProjectionEventTopic },
  );
  assert.deepEqual(
    harness.calls.find((call) => call.method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD)?.params,
    { agentId: 'agent-topic', taskId: 'task-topic', afterEventSeq: 3 },
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
        if (
          method === 'events.subscribe' ||
          method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD ||
          method === 'events.unsubscribe'
        ) {
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
    }, {
      projectionStream: { agentId: 'agent-rejected-subscription', taskId: 'task-rejected-subscription', afterEventSeq: 9 },
      initialSnapshot: snapshot('task-rejected-subscription'),
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
      ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
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
    assert.equal(warnings.filter((warning) => warning.includes('Atelier applet bridge')).length, 3);
  } finally {
    console.warn = originalWarn;
    process.off('unhandledRejection', onUnhandledRejection);
  }
}

async function testAppletBridgeCanonicalSubscriptionRejectionCleansLocalEventHandler() {
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
        if (method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD) {
          throw Object.assign(new Error('opaque canonical projection stream rejection'), { code: 'CONNECTION_CLOSED' });
        }
        if (method === 'events.unsubscribe') return undefined;
        return snapshot('task-canonical-reject-cleanup');
      },
      onEvent(topic, handler) {
        handlers.set(topic, handler);
        return () => {
          handlers.delete(topic);
        };
      },
    }, {
      projectionStream: { agentId: 'agent-canonical-reject-cleanup', taskId: 'task-canonical-reject-cleanup', afterEventSeq: 11 },
      initialSnapshot: snapshot('task-canonical-reject-cleanup'),
    });

    const seen = [];
    const unsubscribe = bridge.subscribeProjection((payload) => {
      seen.push(payload);
    });
    assert.equal(handlers.has(ATELIER_PROJECTION_EVENT_TOPIC), true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(handlers.has(ATELIER_PROJECTION_EVENT_TOPIC), false);
    handlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.({
      id: 'evt-after-canonical-subscription-rejection',
      seq: 12,
      taskId: 'task-canonical-reject-cleanup',
      receivedAt: new Date().toISOString(),
      patch: {
        kind: 'task.upsert',
        task: { id: 'task-canonical-reject-cleanup', project: 'peers-touch', title: 'should not apply after canonical rejection', status: 'active' },
      },
    });
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(calls.map((call) => call.method), [
      'events.subscribe',
      ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
      'events.unsubscribe',
    ]);
    assert.deepEqual(
      calls.find((call) => call.method === 'events.unsubscribe')?.params,
      { topic: ATELIER_PROJECTION_EVENT_TOPIC },
      'rejected canonical projection subscription must release the Host projection topic',
    );
    assert.equal(
      calls.filter((call) => call.method === 'events.unsubscribe').length,
      1,
      'release after rejected canonical projection subscription cleanup must not duplicate Host topic unsubscribe',
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, 'atelier.projection.subscription-rejected');
    assert.equal(seen[0].method, ATELIER_PROJECTION_SUBSCRIPTION_METHOD);
    assert.equal(seen[0].code, 'CONNECTION_CLOSED');
    assert.equal(
      seen.some((payload) => payload.id === 'evt-after-canonical-subscription-rejection'),
      false,
    );
    assert.equal(unhandledRejections.length, 0);
    assert.equal(warnings.filter((warning) => warning.includes('Atelier applet bridge')).length, 1);
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
  }, {
    projectionStream: { agentId: 'agent-malformed-event-cleanup', taskId: 'task-malformed-event-cleanup', afterEventSeq: 13 },
    initialSnapshot: snapshot('task-malformed-event-cleanup'),
  });

  const unsubscribe = bridge.subscribeProjection((payload) => {
    seen.push(payload);
  });
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
  unsubscribe();
  unsubscribe();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls.map((call) => call.method), [
    'events.unsubscribe',
  ]);
  assert.deepEqual(
    calls[0]?.params,
    { topic: ATELIER_PROJECTION_EVENT_TOPIC },
    'malformed event cleanup must request Host topic unsubscribe fail-closed',
  );
  assert.equal(
    calls.some((call) => call.method === 'events.subscribe' || call.method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD),
    false,
    'malformed event cleanup must not start Host topic or Station projection subscription',
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'atelier.projection.subscription-rejected');
  assert.equal(seen[0].method, 'events.subscribe');
  assert.match(seen[0].reason, /malformed unsubscribe cleanup/);
  assert.equal(
    seen.some((payload) => payload.id === 'evt-after-malformed-event-cleanup'),
    false,
    'malformed event cleanup must close the local handler before late Host events',
  );
}

async function testAppletBridgeReleasedSubscriptionIgnoresLateRejectedInvokes() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const calls = [];
  const warnings = [];
  const unhandledRejections = [];
  const handlers = new Map();
  let rejectEventSubscribe;
  let rejectProjectionSubscribe;
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
        if (method === ATELIER_PROJECTION_SUBSCRIPTION_METHOD) {
          return new Promise((_, reject) => {
            rejectProjectionSubscribe = reject;
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
    }, {
      projectionStream: { agentId: 'agent-release-before-reject', taskId: 'task-release-before-reject', afterEventSeq: 3 },
      initialSnapshot: snapshot('task-release-before-reject'),
    });

    const seen = [];
    const unsubscribe = bridge.subscribeProjection((payload) => {
      seen.push(payload);
    });
    assert.deepEqual([...handlers.keys()], [ATELIER_PROJECTION_EVENT_TOPIC]);

    unsubscribe();
    assert.equal(handlers.has(ATELIER_PROJECTION_EVENT_TOPIC), false);
    rejectEventSubscribe(new Error('late rejected events.subscribe'));
    rejectProjectionSubscribe(new Error('late rejected atelier.events.subscribe'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(calls.map((call) => call.method), [
      'events.subscribe',
      ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
      'events.unsubscribe',
    ]);
    assert.deepEqual(seen, []);
    assert.equal(unhandledRejections.length, 0);
    assert.equal(warnings.filter((warning) => warning.includes('Atelier applet bridge')).length, 2);
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
    {
      name: 'Station stream network rejection',
      rejectedMethod: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
      reason: 'opaque projection subscription rejected',
      code: 'CONNECTION_CLOSED',
      expectedStatus: 'disconnected',
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
    }, {
      projectionStream: { agentId: 'agent-subscription-recovery', taskId: 'task-subscription-recovery', afterEventSeq: 3 },
      initialSnapshot,
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
  const bridge = createAppletSdkAtelierBridge(harness.host, { initialSnapshot });
  const runtime = createBridgeAtelierRuntime({ bridge, initialSnapshot });
  const release = runtime.subscribe(() => {});

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
await testRuntimeBootstrapNormalizesProjectionStreamConfig();
await testAppletBridgeUsesReplayCursor();
await testAppletBridgeOmitsEmptyReplayCursorFields();
await testAppletBridgeRejectsEmptyProjectionStreamAgentIdFailClosed();
await testAppletBridgeExplicitProjectionStreamIntentWinsOverSnapshotCursor();
await testAppletBridgeProductWindowZeroCursorReachesHostSubscribe();
await testBridgeRuntimeRefreshesProjectionSubscribeAfterCreatedSelectedTask();
await testBridgeRuntimeKeepsReconcilingUntilRefreshedProjectionSubscribeSettles();
await testBridgeRuntimeMapsRejectedRefreshedProjectionSubscribeToRecovery();
await testBridgeRuntimeIgnoresStaleRefreshedProjectionSubscribeSettlement();
await testAppletBridgeUnsubscribesProjectionTopicAndStream();
await testAppletBridgeSuccessfulReleaseHandlesRejectedTopicUnsubscribe();
await testAppletBridgeCorrelatesCustomProjectionTopicAcrossLifecycle();
await testAppletBridgeHandlesRejectedSubscriptionInvokes();
await testAppletBridgeCanonicalSubscriptionRejectionCleansLocalEventHandler();
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

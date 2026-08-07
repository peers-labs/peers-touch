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
const evidencePath = path.join(evidenceDir, 'atelier-official-frontend-gate.json');
const coveredPaths = [
  'official Atelier frontend uses service binding for Station-owned methods',
  'official Atelier frontend keeps workspace/artifact preview Host intents out of Station service binding',
  'official Atelier frontend controlled loading, empty, recovery, and status taxonomy coverage is exhaustive against generated contract statuses',
  'official Atelier frontend render consumes status action policy for empty create-project and retry affordances',
  'official Atelier frontend status action policy keeps primary action and visibility flags mutually consistent',
  'official Atelier frontend status action policy matrix is exhaustive against generated view statuses and recovery kinds',
  'official Atelier frontend status action policy source unit matrix covers every generated view status and recovery kind without execution payload fields',
  'official Atelier frontend projection subscription source unit matrix covers rejected subscribe cleanup release idempotence and late payload isolation',
  'official Atelier frontend projection stream subscribe reject source unit matrix covers Station stream cleanup late payload isolation and no unhandled rejection',
  'official Atelier frontend active typed subscription rejection source unit matrix covers recovery delivery cleanup idempotence and late event isolation',
  'official Atelier frontend typed subscription rejection code taxonomy source unit matrix covers auth-denied and disconnected recovery classification',
  'official Atelier frontend malformed typed subscription rejection source unit matrix covers fail-closed generic recovery and projection-event isolation',
  'official Atelier frontend typed subscription rejection sanitized cause source unit matrix preserves recovery code and strips execution-shaped fields',
  'official Atelier frontend typed subscription rejection reason diagnostic and warning sanitization source unit matrix strips execution-shaped fields',
  'official Atelier frontend typed subscription rejection code whitelist source unit matrix keeps only known recovery codes in Error.cause',
  'official Atelier frontend recovery transitions clear every transient workbench action field before auth-denied disconnected or error surfaces',
  'official Atelier frontend page surface unit matrix covers every generated view status so loading empty disconnected and auth-denied states stay mutually exclusive',
    'official Atelier frontend single-column recovery-state layout keeps loading empty disconnected and auth-denied surfaces above the projection content rail without app-level side rails',
  'official Atelier frontend recovery view unit matrix covers every generated recovery kind with contract-owned tone retry and label keys',
  'official Atelier frontend status pill unit matrix covers every generated view status with contract-owned tone and label keys',
  'official Atelier frontend status notice unit matrix covers every generated notice kind with contract-owned title and detail keys',
  'official Atelier frontend centered state unit matrix covers loading and empty states with contract-owned title and detail keys',
  'official Atelier frontend classifies structured Host and service error codes through generated recovery taxonomy before legacy message fallback',
  'official Atelier frontend rejects malformed service and Host capability responses through executable public client fixtures',
  'official Atelier frontend rejects decimal and unsafe projection event/replay sequence numbers before reducer or cursor use',
  'official Atelier frontend rejects task purge intents unless projected task status is deleted before service calls',
  'official Atelier frontend marks unresolved TaskGraph artifact and gate evidence refs before display',
  'official Atelier frontend keeps artifact preview metadata-only and safe-text bounded without raw iframe/image/html/diff rendering',
  'official Atelier frontend preserves projection-only forbidden capability boundaries for provider, shell, file, memory, artifact, gate, and attachment writes',
];
const doesNotProve = [
  'real Desktop product window UI',
  'real Desktop Host capability producer behavior',
  'real Station projection stream failure matrix',
  'real auth recovery or reconnect behavior against Station',
  'real artifact body fetch or Host sandbox renderer E2E',
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
        gate: 'atelier:official-frontend-gate',
        coveredPaths: proves,
        notCovered: doesNotProve,
        claimBoundary: {
          readiness: 'NOT_READY',
          proves,
          doesNotProve,
        },
        command: 'pnpm run atelier:official-frontend-gate',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}
const pageSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx'),
  'utf8',
);
const clientSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/infrastructure/capability/atelierClient.ts'),
  'utf8',
);
const serviceClientSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/infrastructure/capability/serviceClient.ts'),
  'utf8',
);
const controllerSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/useAtelierController.ts'),
  'utf8',
);
const controllerTransitionsSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/controllerTransitions.ts'),
  'utf8',
);
const projectionSubscriptionKeySource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/atelierProjectionSubscriptionKey.ts'),
  'utf8',
);
const viewStatusSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/viewStatus.ts'),
  'utf8',
);
const pageCompositionSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/pageComposition.ts'),
  'utf8',
);
const centeredStateViewSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/centeredStateView.ts'),
  'utf8',
);
const statusNoticeViewSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/statusNoticeView.ts'),
  'utf8',
);
const eventStreamRecoverySource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/eventStreamRecovery.ts'),
  'utf8',
);
const eventStreamEventGuardSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/eventStreamEventGuard.ts'),
  'utf8',
);
const artifactActionGuardsSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/artifactActionGuards.ts'),
  'utf8',
);
const messageActionGuardsSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/messageActionGuards.ts'),
  'utf8',
);
const decisionActionGuardsSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/decisionActionGuards.ts'),
  'utf8',
);
const feedbackActionGuardsSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/feedbackActionGuards.ts'),
  'utf8',
);
const confirmationActionGuardsSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/confirmationActionGuards.ts'),
  'utf8',
);
const workspaceActionGuardsSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/workspaceActionGuards.ts'),
  'utf8',
);
const projectCreateActionGuardsSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/projectCreateActionGuards.ts'),
  'utf8',
);
const providerCapabilityActionGuardsSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/providerCapabilityActionGuards.ts'),
  'utf8',
);
const officialRecoveryViewSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/officialRecoveryView.ts'),
  'utf8',
);
const statusPillViewSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/statusPillView.ts'),
  'utf8',
);
const atelierViewStateTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/atelierViewState.test.ts'),
  'utf8',
);
const controllerTransitionsTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/application/controllerTransitions.test.ts'),
  'utf8',
);
const atelierClientTestSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/infrastructure/capability/atelierClient.test.ts'),
  'utf8',
);
const atelierClientSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/infrastructure/capability/atelierClient.ts'),
  'utf8',
);
const officialFrontendPackageSource = fsSync.readFileSync(
  path.join(repoRoot, 'apps/applets/atelier/frontend/package.json'),
  'utf8',
);
const localeFiles = [
  path.join(repoRoot, 'apps/applets/atelier/frontend/locales/en.json'),
  path.join(repoRoot, 'apps/applets/atelier/frontend/locales/zh-CN.json'),
];
const messagesZhCn = JSON.parse(
  fsSync.readFileSync(path.join(repoRoot, 'apps/applets/atelier/frontend/locales/zh-CN.json'), 'utf8'),
);
const requiredPageSnippets = [
  'function BudgetBar',
  'budget?.dimensions',
  'atelier.budget.readOnly',
  'function TaskGraphPanel',
  'function TaskGraphNodeRow',
  'function TaskOrganizerPanel',
  'function TaskFoldersList',
  'function TaskFlatList',
  'function TaskOrganizerUnavailable',
  'function TodoPanel',
  'function ContextPanel',
  'function ArtifactTray',
  'function ArtifactPanel',
  'function ArtifactPreviewPanel',
  'function SafeTextPreview',
  'function ArtifactPathList',
  'function PreviewLine',
  'function GatePanel',
  'function ProviderCapabilitiesPanel',
  'function MessageComposer',
  'function GoalComposer',
  'function RunTargetSelector',
  'ATELIER_DIRECT_RUN_MODELS',
    'ATELIER_AGENT_FLOW_DESCRIPTORS',
  'function NegoVoiceList',
  'function NegoDisclosure',
  'function ProjectHealthPanel',
  'function ProjectionItemList',
  'function stanceColor',
  "flexDirection: 'column', minHeight: px(0)",
  "minWidth: px(0), padding: px(12), width: '100%'",
  "minWidth: px(0), width: '100%'",
  'function TaskLifecycleBar',
  'function TaskActionChip',
  'function readInputValue',
  'atelier.section.taskGraph',
  'atelier.section.projectHealth',
  'atelier.projectHealth.readOnly',
  'atelier.projectHealth.completion',
  'atelier.projectHealth.moreBlockers',
  'atelier.projectHealth.moreRisks',
  'atelier.projectHealth.moreMilestones',
  'atelier.taskGraph.readOnly',
  'atelier.taskGraph.empty',
  'atelier.taskGraph.artifactRefs',
  'atelier.taskGraph.gateRefs',
  'atelier.taskGraph.moreArtifactRefs',
  'atelier.taskGraph.moreGateRefs',
  'atelier.taskGraph.roots',
  'atelier.taskGraph.rootsEmpty',
  'atelier.taskGraph.rootDetail',
  'atelier.taskGraph.moreRoots',
  'atelier.taskGraph.edges',
  'atelier.taskGraph.edgesEmpty',
  'atelier.taskGraph.moreEdges',
  'atelier.taskGraph.parallelPolicy',
  'atelier.taskGraph.integratorBoundary',
  'atelier.taskGraph.moreProjected',
  'atelier.section.todos',
  'atelier.section.context',
  'atelier.context.readOnly',
  'atelier.section.artifacts',
  'atelier.section.artifactTray',
  'atelier.section.artifactPreview',
  'atelier.artifact.previewHint',
  'atelier.artifact.morePaths',
  'atelier.artifact.bodyRef',
  'atelier.artifact.bodyHash',
  'atelier.artifact.bodySize',
  'atelier.artifact.bodyKind',
  'atelier.artifact.moreProjected',
  'atelier.artifact.bodyFetch',
  'atelier.artifact.bodyFetching',
  'atelier.artifact.bodyFetchError',
  'atelier.artifact.bodyPreview',
  'atelier.artifact.bodyPreviewTruncated',
  'allLines',
  'ATELIER_PROJECTION_DISPLAY_LIMITS.safeTextPreviewLines',
  'hiddenLineCount',
  'atelier.artifact.moreBodyLines',
  'atelier.artifact.safeMarkdownPreview',
  'atelier.artifact.safeTextBoundary',
  'atelier.artifact.previewTarget',
  'atelier.artifact.previewTargetBody',
  'atelier.artifact.previewTargetKind',
  'atelier.artifact.previewTargetLabel',
  'atelier.artifact.previewTargetMode',
  'atelier.artifact.previewTargetSandbox',
  'atelier.artifact.previewOpen',
  'atelier.artifact.previewOpening',
  'atelier.artifact.previewOpenError',
  'atelier.artifact.previewOpenStatus',
  'atelier.artifact.previewBoundaryLabel',
  'atelier.artifact.previewBoundary',
  'atelier.artifact.richRenderer',
  'atelier.artifact.richRendererUnsupported',
  'atelier.section.gates',
  'atelier.gate.moreProjected',
  'atelier.gate.moreChecks',
  'atelier.gate.moreArtifacts',
  'gate.artifactIds',
  'check.detail',
  'onResolveDecision',
  'controller.createProject',
  'controller.selectArtifact',
  'controller.sendMessage',
  'controller.insertProviderCapabilityCommand',
  'controller.submitFeedback',
  'controller.openWorkspace',
  'controller.setTaskLifecycle',
  'function FeedbackBar',
  'function WorkspaceOpenButton',
  'workspaceOpenTarget',
  'atelier.section.skills',
  'atelier.skills.hint',
  'atelier.skills.moreCapabilities',
  'atelier.composer.attachmentUnsupported',
  'atelier.feedback.positive',
  'atelier.feedback.regenerate',
  'atelier.feedback.confirmMemory',
  'atelier.feedback.confirmingMemory',
  'atelier.feedback.confirmRerun',
  'atelier.feedback.confirmingRerun',
  'atelier.workspace.open',
  'atelier.workspace.openAction',
  'atelier.workspace.openBoundary',
  'atelier.artifact.runtimeLogs',
  'atelier.artifact.runtimeLogsUnsupported',
  'function TopbarToolBoundary',
  'atelier.tool.terminal',
  'atelier.tool.terminalUnsupported',
  'atelier.tool.outline',
  'atelier.tool.outlineUnsupported',
  'atelier.composer.placeholder',
  'atelier.goal.placeholder',
  'atelier.runTarget.selector',
  'atelier.runTarget.model',
  'atelier.runTarget.agents',
  'atelier.runTarget.flowSelector',
  'atelier.runTarget.modelHint',
  'atelier.runTarget.agentsHint',
  'atelier.nego.voices',
  'atelier.nego.evidence',
  'atelier.nego.concern',
  'atelier.nego.moreVoices',
  'atelier.nego.converged',
  'atelier.nego.pending',
  'atelier.task.archive',
  'atelier.task.purge',
  'atelier.task.confirmPurge',
  'atelier.task.purgeHint',
  'atelier.decision.resolving',
  'atelier.decision.moreOptions',
  'atelier.stream.moreProjected',
];
for (const snippet of requiredPageSnippets) {
  assert.ok(pageSource.includes(snippet), `Atelier official page must include ${snippet}`);
}
assert.ok(
  officialRecoveryViewSource.includes('ATELIER_VIEW_SURFACE.recovery.labelKeyByKind') &&
    !officialRecoveryViewSource.includes("titleKey: 'atelier.error.authDeniedTitle'") &&
    !officialRecoveryViewSource.includes("detailKey: 'atelier.error.disconnectedDetail'"),
  'Atelier official recovery view must derive label keys from generated recovery taxonomy',
);
assert.ok(
  pageSource.indexOf("atelier.composer.attachmentUnsupported") !== pageSource.lastIndexOf("atelier.composer.attachmentUnsupported"),
  'Atelier official page must disclose unsupported attachments in both empty GoalComposer and task MessageComposer',
);
assert.ok(
  !pageSource.includes('atelier.attachment.upload') &&
    !pageSource.includes('attachment.upload') &&
    !pageSource.includes('HostStorage.write') &&
    !pageSource.includes('input_snapshot.write') &&
    !pageSource.includes('inputSnapshot.write'),
  'Atelier official composers must stay disclosure-only for attachments and must not wire Host Storage or Run input_snapshot writes',
);
const officialIntentPresetStart = pageSource.indexOf('function IntentPresetSelector(');
const officialIntentPresetEnd = pageSource.indexOf('\nfunction RunTargetSelector', officialIntentPresetStart);
const officialIntentPresetSource =
  officialIntentPresetStart >= 0 && officialIntentPresetEnd > officialIntentPresetStart
    ? pageSource.slice(officialIntentPresetStart, officialIntentPresetEnd)
    : '';
assert.ok(
  pageSource.includes('ATELIER_TASK_INTENT_PRESETS') &&
    pageSource.includes('const INTENT_PRESET_LABEL_KEYS: Record<AtelierIntentPreset, { labelKey: string; hintKey: string }>') &&
    officialIntentPresetSource.includes('ATELIER_TASK_INTENT_PRESETS.map((option) => {') &&
    officialIntentPresetSource.includes('bindtap={() => onPresetChange(option)}') &&
    officialIntentPresetSource.includes("t('atelier.intentPreset.boundary')") &&
    !pageSource.includes('const INTENT_PRESETS: Array') &&
    !officialIntentPresetSource.includes('atelier.ide.mode') &&
    !officialIntentPresetSource.includes('ide.mode.switch') &&
    !officialIntentPresetSource.includes('workspace.mode.switch') &&
    !officialIntentPresetSource.includes('runtime.mode.switch') &&
    !officialIntentPresetSource.includes('provider.runtime.override') &&
    !officialIntentPresetSource.includes('provider.invoke'),
  'Atelier official Work/Code/Design preset selector must stay declarative intentPreset only and must not switch IDE/workspace/provider runtime',
);
const officialRunTargetStart = pageSource.indexOf('function RunTargetSelector({');
const officialRunTargetEnd = pageSource.indexOf('\nfunction ArtifactTray', officialRunTargetStart);
const officialRunTargetSource =
  officialRunTargetStart >= 0 && officialRunTargetEnd > officialRunTargetStart
    ? pageSource.slice(officialRunTargetStart, officialRunTargetEnd)
    : '';
assert.ok(
  pageSource.includes("ATELIER_RUN_TARGET_KINDS") &&
      pageSource.includes('ATELIER_DIRECT_RUN_MODELS') &&
        pageSource.includes('ATELIER_AGENT_FLOW_DESCRIPTORS') &&
    officialRunTargetSource.includes('ATELIER_RUN_TARGET_KINDS.map((kind) => {') &&
      officialRunTargetSource.includes('ATELIER_DIRECT_RUN_MODELS.map((modelId) => {') &&
        officialRunTargetSource.includes('ATELIER_AGENT_FLOW_DESCRIPTORS.map((flow) => {') &&
    officialRunTargetSource.includes('bindtap={() => onRunKindChange(kind)}') &&
    officialRunTargetSource.includes('bindtap={() => onModelChange(modelId)}') &&
        officialRunTargetSource.includes('bindtap={() => onFlowIdChange(flow.id)}') &&
      !pageSource.includes('const MODEL_OPTIONS = [') &&
        !pageSource.includes('const AGENT_FLOW_LABELS') &&
      !pageSource.includes('const AGENT_FLOWS = [') &&
    officialRunTargetSource.includes("t(runKind === 'model' ? 'atelier.runTarget.modelHint' : 'atelier.runTarget.agentsHint')") &&
    !officialRunTargetSource.includes('atelier.provider.invoke') &&
    !officialRunTargetSource.includes('provider.invoke') &&
    !officialRunTargetSource.includes('runtime.invokeProvider') &&
    !officialRunTargetSource.includes('model.run') &&
    !officialRunTargetSource.includes('runModel') &&
    !officialRunTargetSource.includes('cli.execute') &&
    !officialRunTargetSource.includes('executeCli') &&
    !officialRunTargetSource.includes("(['model', 'agents'] as const).map((kind) => {"),
  'Atelier official run target selector must stay Station-owned intent only and must not expose provider/model/CLI execution',
);
  for (const forbidden of ['<iframe', '<img', '<image', 'src={artifact.url}', 'src={artifact.src}', '直接模型']) {
  assert.ok(!pageSource.includes(forbidden), `Atelier official page must not load artifact media/url via ${forbidden}`);
}
for (const forbiddenArtifactReference of ['artifact.url', 'artifact.src', 'atelier.artifact.url', 'atelier.artifact.source']) {
  assert.ok(!pageSource.includes(forbiddenArtifactReference), `Atelier official page must not display raw artifact reference ${forbiddenArtifactReference}`);
}
assert.ok(
  serviceClientSource.includes('sdk.network.request') &&
    serviceClientSource.includes("service: 'atelier'") &&
    clientSource.includes("import { requestAtelierService } from './serviceClient'"),
  'Atelier official client must route backend service calls through serviceClient and sdk.network.request({ service: "atelier" })',
);
for (const requiredServiceCall of [
  "requestAtelierService('/v1/workspace', 'GET')",
  "requestAtelierService('/v1/projects', 'POST', payload)",
  "requestAtelierService('/v1/messages', 'POST', input)",
  "requestAtelierService('/v1/escalations:resolve', 'POST', input)",
  "requestAtelierService(`/v1/tasks/${encodeURIComponent(input.taskId)}/status`, 'PATCH', { status: input.status })",
  "requestAtelierService(`/v1/tasks/${encodeURIComponent(input.taskId)}`, 'DELETE')",
  "requestAtelierService('/v1/provider/capabilities', 'POST', taskId ? { taskId } : {})",
  "requestAtelierService('/v1/feedback/submit', 'POST', input)",
  "requestAtelierService('/v1/memory/confirm-candidate', 'POST', input)",
  "requestAtelierService('/v1/feedback/confirm-rerun', 'POST', input)",
  "requestAtelierService('/v1/artifact/body/fetch', 'POST', input)",
]) {
  assert.ok(clientSource.includes(requiredServiceCall), `Atelier official client must use service binding call ${requiredServiceCall}`);
}
for (const forbiddenInvoke of [
  'atelier.workspace.load',
  'atelier.project.createFromGoal',
  'atelier.message.send',
  'atelier.escalation.resolve',
  'atelier.task.setStatus',
  'atelier.task.purge',
  'atelier.provider.capabilities',
  'atelier.feedback.submit',
  'atelier.memory.confirmCandidate',
  'atelier.feedback.confirmRerun',
  'atelier.artifact.body.fetch',
]) {
  assert.ok(!clientSource.includes(`sdk.invoke<unknown>('${forbiddenInvoke}'`), `Atelier official client must not invoke ${forbiddenInvoke}; use service binding`);
  assert.ok(!clientSource.includes(`sdk.invoke<unknown>("${forbiddenInvoke}"`), `Atelier official client must not invoke ${forbiddenInvoke}; use service binding`);
}
assert.ok(
  clientSource.includes('agentIds') &&
    clientSource.includes('atelier.error.agentIdsRequired'),
  'Atelier official client must require explicit agentIds before project creation',
);
assert.ok(
  clientSource.includes('projectionAgentIdFromSource') &&
      clientSource.includes('ATELIER_PROJECTION_CONTRACT.eventSubscription.agentIdSourcePriority') &&
      clientSource.includes('projectionAgentIdResolvers') &&
      !clientSource.includes('return agentIdsFromSource(source)[0]') &&
    clientSource.includes('sdk.invoke(ATELIER_PROJECTION_SUBSCRIPTION_METHOD, streamConfig)'),
  'Atelier official client must derive default projection stream subscription only from explicit agentId/agentIds launch config',
);
assert.ok(
  clientSource.includes('projectionAfterEventSeqFromSnapshot') &&
    clientSource.includes('workspace.replay?.[taskId]?.nextEventSeq') &&
    clientSource.includes('projectionTaskIdFromSource') &&
      clientSource.includes('ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority') &&
      clientSource.includes('projectionTaskIdResolvers') &&
      !clientSource.includes("return snapshot?.selectedTaskId || snapshot?.workspace.tasks[0]?.id || ''") &&
    clientSource.includes('selectedTaskId: string') &&
    clientSource.includes('subscribeAtelierProjectionEvents(\n  snapshot: AtelierProjectionSnapshot | null'),
  'Atelier official client must derive default taskId/afterEventSeq from the loaded projection replay cursor',
);
assert.ok(
  clientSource.includes('function safeUnsubscribeAtelierProjectionEventTopic') &&
    clientSource.includes('void sdk.events.unsubscribe(ATELIER_PROJECTION_EVENT_TOPIC).catch') &&
    clientSource.includes('Atelier official projection event topic unsubscribe rejected') &&
    clientSource.includes('const closeSubscription = () => {') &&
    clientSource.includes('safeUnsubscribeAtelierProjectionEventTopic();') &&
    clientSource.includes('return closeSubscription;') &&
    !clientSource.includes('void sdk.events.unsubscribe(ATELIER_PROJECTION_EVENT_TOPIC);'),
  'Atelier official client must handle projection event topic unsubscribe rejection through idempotent subscribe failure and release cleanup',
);
assert.ok(
  officialFrontendPackageSource.includes('src/infrastructure/capability/*.test.ts') &&
    clientSource.includes('const closeSubscription = () => {') &&
    clientSource.includes('if (closed) return;') &&
    clientSource.includes('closed = true;') &&
    clientSource.includes('if (closed) return;') &&
    clientSource.includes('return closeSubscription;') &&
    atelierClientTestSource.includes('cleans local listener and Host topic when events.subscribe rejects before Station stream subscribe') &&
    atelierClientTestSource.includes('keeps release idempotent and blocks late event or subscription-rejected payload delivery') &&
    atelierClientTestSource.includes('expect(sdkState.unsubscribe).toHaveBeenCalledTimes(1)') &&
    atelierClientTestSource.includes("sdkState.unsubscribe.mockRejectedValueOnce(new Error('late rejected official events.unsubscribe'))") &&
    atelierClientTestSource.includes('expect(unhandledRejections).toHaveLength(0)') &&
    atelierClientTestSource.includes("reason: 'late rejected official atelier.events.subscribe'") &&
    atelierClientTestSource.includes('/provider\\.invoke|runtime\\.execute|shell|memory\\.write|input_snapshot|run\\.execute/'),
  'Atelier official projection subscription source unit matrix must cover rejected subscribe cleanup, idempotent release, late payload isolation, no unhandled rejection, and projection-only payload boundaries',
);
assert.ok(
  atelierClientTestSource.includes('cleans local listener and Host topic when atelier.events.subscribe rejects after Host topic subscribe') &&
    atelierClientTestSource.includes("streamSubscribeReady.reject(new Error('late rejected official atelier.events.subscribe invoke'))") &&
    atelierClientTestSource.includes("sdkState.unsubscribe.mockRejectedValueOnce(new Error('late rejected official events.unsubscribe after stream reject'))") &&
    atelierClientTestSource.includes("projectionEvent('evt-after-stream-reject')") &&
    atelierClientTestSource.includes('expect(unhandledRejections).toHaveLength(0)') &&
    atelierClientTestSource.includes('expect(sdkState.handlers.has(ATELIER_PROJECTION_EVENT_TOPIC)).toBe(false)') &&
    atelierClientTestSource.includes('/provider\\.invoke|runtime\\.execute|shell|memory\\.write|input_snapshot|run\\.execute/'),
  'Atelier official projection stream subscribe reject source unit matrix must cover Station stream cleanup, late payload isolation, no unhandled rejection, and projection-only payload boundaries',
);
assert.ok(
  atelierClientTestSource.includes('delivers active typed subscription rejection once then cleans listener and blocks later events') &&
    atelierClientTestSource.includes("code: 'PERMISSION_DENIED'") &&
    atelierClientTestSource.includes('Atelier projection stream subscription atelier.events.subscribe rejected') &&
    atelierClientTestSource.includes("projectionEvent('evt-after-active-typed-reject')") &&
    atelierClientTestSource.includes('expect(rejected).toHaveLength(1)') &&
    atelierClientTestSource.includes('expect(sdkState.unsubscribe).toHaveBeenCalledTimes(1)') &&
    atelierClientTestSource.includes('expect(unhandledRejections).toHaveLength(0)') &&
    atelierClientTestSource.includes('/provider\\.invoke|runtime\\.execute|shell|memory\\.write|input_snapshot|run\\.execute/'),
  'Atelier official active typed subscription rejection source unit matrix must cover recovery delivery, cleanup idempotence, late event isolation, no unhandled rejection, and projection-only payload boundaries',
);
assert.ok(
  atelierClientTestSource.includes('preserves active typed subscription rejection codes for recovery taxonomy') &&
    atelierClientTestSource.includes("code: 'FORBIDDEN'") &&
    atelierClientTestSource.includes("code: 'CONNECTION_CLOSED'") &&
    atelierClientTestSource.includes("expected: { key: 'atelier.error.authDenied', kind: 'auth-denied' }") &&
    atelierClientTestSource.includes("expected: { key: 'atelier.error.disconnected', kind: 'disconnected' }") &&
    atelierClientTestSource.includes('expect(classifyAtelierError(rejected[0])).toEqual(item.expected)') &&
    atelierClientTestSource.includes('/provider\\.invoke|runtime\\.execute|shell|memory\\.write|input_snapshot|run\\.execute/'),
  'Atelier official typed subscription rejection code taxonomy source unit matrix must cover auth-denied and disconnected recovery classification with projection-only payload boundaries',
);
assert.ok(
  atelierClientTestSource.includes('fails closed on malformed typed subscription rejection payload fields without treating them as projection events') &&
    atelierClientTestSource.includes("method: ''") &&
    atelierClientTestSource.includes("code: { nested: 'FORBIDDEN' }") &&
    atelierClientTestSource.includes("reason: { nested: 'do not trust malformed reason' }") &&
    atelierClientTestSource.includes("shellExecute: { command: 'open .' }") &&
    atelierClientTestSource.includes("Atelier projection stream subscription unknown rejected: unknown rejection") &&
    atelierClientTestSource.includes("key: 'atelier.error.loadFailed'") &&
    atelierClientTestSource.includes('expect(malformed).toEqual([])') &&
    atelierClientTestSource.includes("projectionEvent('evt-after-malformed-typed-reject')"),
  'Atelier official malformed typed subscription rejection source unit matrix must cover fail-closed generic recovery, projection event isolation, cleanup, and malformed execution-shaped field containment',
);
assert.ok(
  atelierClientSource.includes('const sanitizedCause: Record<string, unknown> = {') &&
    atelierClientSource.includes("kind: 'atelier.projection.subscription-rejected'") &&
    atelierClientSource.includes('const code = typeof value.code ===') &&
    atelierClientSource.includes('sanitizeProjectionSubscriptionCode(value.code)') &&
    atelierClientSource.includes('if (code) {') &&
    atelierClientSource.includes('cause: sanitizedCause') &&
    atelierClientTestSource.includes('sanitizes typed subscription rejection error cause while preserving valid recovery code') &&
    atelierClientTestSource.includes("providerInvoke: { provider: 'model' }") &&
    atelierClientTestSource.includes("runtimeExecute: { taskId: 'task-official-subscribe' }") &&
    atelierClientTestSource.includes("input_snapshot: { prompt: 'must not leak' }") &&
    atelierClientTestSource.includes('expect(rejected[0]?.cause).toEqual({') &&
    atelierClientTestSource.includes('expect(classifyAtelierError(rejected[0])).toEqual({') &&
    atelierClientTestSource.includes('/provider\\.invoke|providerInvoke|runtime\\.execute|runtimeExecute|shell|memory\\.write|input_snapshot|run\\.execute/'),
  'Atelier official typed subscription rejection sanitized cause source unit matrix must preserve recovery code while stripping execution-shaped fields from Error.cause',
);
assert.ok(
  atelierClientSource.includes('function sanitizeProjectionSubscriptionReason(reason: string): string') &&
    atelierClientSource.includes('forbiddenProjectionSubscriptionReasonPatterns') &&
    atelierClientSource.includes('sanitizeProjectionSubscriptionReason(value.reason)') &&
    atelierClientSource.includes('error: sanitizeProjectionSubscriptionReason(error instanceof Error ? error.message : String(error))') &&
    atelierClientSource.includes("console.warn('Atelier official projection event topic unsubscribe rejected', {") &&
    atelierClientTestSource.includes('sanitizes typed subscription rejection reason diagnostic and warning text') &&
    atelierClientTestSource.includes("reason: 'provider.invoke providerInvoke runtime.execute runtimeExecute shellExecute input_snapshot should not leak from typed rejection'") &&
    atelierClientTestSource.includes("new Error('provider.invoke providerInvoke runtime.execute runtimeExecute shellExecute input_snapshot should not leak from unsubscribe')") &&
    atelierClientTestSource.includes("reason: 'Host projection subscription rejected'") &&
    atelierClientTestSource.includes('subscribeRejectedDiagnostic?.properties?.error') &&
    atelierClientTestSource.includes('JSON.stringify({ rejected, warnings, subscribeRejectedDiagnostic })'),
  'Atelier official typed subscription rejection reason diagnostic and warning sanitization source unit matrix must strip execution-shaped fields while preserving structured code',
);
assert.ok(
  atelierClientSource.includes('function sanitizeProjectionSubscriptionCode(code: string): string | undefined') &&
    atelierClientSource.includes('ATELIER_VIEW_SURFACE.bridgeRuntimeRecoveryCodeKindByCode') &&
    atelierClientSource.includes('sanitizeProjectionSubscriptionCode(value.code)') &&
    atelierClientTestSource.includes('keeps only known typed subscription rejection recovery codes in sanitized cause') &&
    atelierClientTestSource.includes("code: 'connection_closed'") &&
    atelierClientTestSource.includes("code: 'CONNECTION_CLOSED'") &&
    atelierClientTestSource.includes("key: 'atelier.error.disconnected'") &&
    atelierClientTestSource.includes("code: 'providerInvoke runtimeExecute shellExecute input_snapshot should not leak'") &&
    atelierClientTestSource.includes("reason: 'host sent unknown code'") &&
    atelierClientTestSource.includes("key: 'atelier.error.loadFailed'") &&
    atelierClientTestSource.includes('/providerInvoke|runtimeExecute|shellExecute|input_snapshot/'),
  'Atelier official typed subscription rejection code whitelist source unit matrix must keep only known recovery codes in Error.cause',
);
assert.ok(
  controllerSource.includes('if (!state.snapshot) return undefined') &&
    controllerSource.includes('deriveAtelierProjectionSubscriptionKey(state.snapshot, state.selectedTaskId)') &&
    controllerSource.includes('subscribeAtelierProjectionEvents(') &&
    controllerSource.includes('state.snapshot,\n        subscriptionTaskId') &&
    controllerSource.includes('stateFromAtelierEventStreamConnecting()') &&
    controllerSource.includes('stateFromMalformedAtelierProjectionEvent()') &&
    controllerSource.includes('subscriptionTaskId') &&
    controllerSource.includes('subscriptionAfterEventSeq') &&
    controllerSource.includes('[hasSnapshot, subscriptionTaskId, subscriptionAfterEventSeq]') &&
    !controllerSource.includes('}, [state.selectedTaskId, state.snapshot]);'),
  'Atelier official controller must subscribe projection events after snapshot load using a stable replay cursor key',
);
assert.ok(
  projectionSubscriptionKeySource.includes('export function deriveAtelierProjectionSubscriptionKey') &&
    projectionSubscriptionKeySource.includes("selectedTaskId || snapshot?.selectedTaskId || snapshot?.workspace.tasks[0]?.id || ''") &&
    projectionSubscriptionKeySource.includes('snapshot?.workspace.replay?.[taskId]?.nextEventSeq ?? 0') &&
    projectionSubscriptionKeySource.includes('hasSnapshot: Boolean(snapshot)'),
  'Atelier official controller must centralize projection subscription key derivation for created-task resubscribe proof',
);
for (const [name, startToken, endToken] of [
  ['createProject', 'const createProject = useCallback(async () => {', '\n  const resolveDecision = useCallback'],
  ['resolveDecision', 'const resolveDecision = useCallback(async (taskId: string, blockId: string, choice: string) => {', '\n  const sendMessage = useCallback'],
  ['sendMessage', 'const sendMessage = useCallback(async () => {', '\n  const insertProviderCapabilityCommand'],
  ['setTaskLifecycle', 'const setTaskLifecycle = useCallback(async (taskId: string, action: AtelierTaskActionKind) => {', '\n  return {'],
]) {
  const start = controllerSource.indexOf(startToken);
  const end = controllerSource.indexOf(endToken, start);
  const block = start >= 0 && end > start ? controllerSource.slice(start, end) : '';
  assert.ok(
    block.includes('...stateFromAtelierSnapshot(snapshot)') &&
      block.includes('...stateFromAtelierEventStreamConnecting()') &&
      !block.includes("eventStreamState: 'live'"),
    `Atelier official ${name} snapshot success must enter reconnecting state until projection subscribe succeeds`,
  );
}
assert.ok(
  clientSource.includes('type AtelierRunTargetKind') &&
      clientSource.includes('type AtelierAgentFlowId') &&
      clientSource.includes('export type { AtelierAgentFlowId, AtelierFeedbackSignal, AtelierRunTargetKind }') &&
    !clientSource.includes("export type AtelierRunTargetKind = 'model' | 'agents';") &&
    clientSource.includes("runKind: AtelierRunTargetKind") &&
      clientSource.includes('flowId?: AtelierAgentFlowId') &&
      clientSource.includes('isAtelierAgentFlowId(source.flowId)') &&
      clientSource.includes('ATELIER_AGENT_FLOW_IDS') &&
        clientSource.includes('ATELIER_DEFAULT_RUN_TARGET_KIND') &&
      clientSource.includes('const runKind: AtelierRunTargetKind = input.runKind ?? ATELIER_DEFAULT_RUN_TARGET_KIND') &&
        !clientSource.includes("const runKind: AtelierRunTargetKind = input.runKind ?? (selectedModel ? 'model' : 'agents')") &&
      clientSource.includes("const run: Record<string, unknown> = runKind === 'model'") &&
      clientSource.includes("? { kind: 'model', model: selectedModel }") &&
      clientSource.includes(": { kind: 'agents', agentIds }") &&
    clientSource.includes("if (runKind !== 'model' && selectedFlowId)") &&
    clientSource.includes('run.flowId = selectedFlowId') &&
    !clientSource.includes('run.agentIds = agentIds') &&
    !clientSource.includes("const run: Record<string, unknown> = { kind: 'agents', agentIds }"),
  'Atelier official client must submit explicit model/agents run target intent and keep flowId/agentIds out of the DirectRun model branch',
);
assert.ok(
  clientSource.includes('export type AtelierIntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];') &&
    clientSource.includes('ATELIER_DEFAULT_TASK_INTENT_PRESET') &&
    clientSource.includes('intentPreset: input.intentPreset ?? ATELIER_DEFAULT_TASK_INTENT_PRESET') &&
    !clientSource.includes("intentPreset: input.intentPreset ?? 'work'") &&
    controllerSource.includes('ATELIER_DEFAULT_TASK_INTENT_PRESET') &&
    controllerSource.includes('useState<AtelierIntentPreset>(ATELIER_DEFAULT_TASK_INTENT_PRESET)') &&
    !controllerSource.includes("useState<AtelierIntentPreset>('work')") &&
    controllerSource.includes('intentPreset: selectedIntentPreset') &&
    pageSource.includes('ATELIER_TASK_INTENT_PRESETS.map((option) => {') &&
    pageSource.includes('IntentPresetSelector') &&
    pageSource.includes('onIntentPresetChange={controller.setSelectedIntentPreset}'),
  'Atelier official frontend must submit Work/Code/Design as a bounded declarative intentPreset',
);
for (const key of [
  'atelier.intentPreset.selector',
  'atelier.intentPreset.boundary',
  'atelier.intentPreset.work',
  'atelier.intentPreset.code',
  'atelier.intentPreset.design',
]) {
  assert.ok(localeFiles.every((file) => fsSync.readFileSync(file, 'utf8').includes(`"${key}"`)), `Atelier intent preset locale key missing: ${key}`);
}
assert.ok(
  clientSource.includes('fetchAtelierArtifactBody') &&
    clientSource.includes("requestAtelierService('/v1/artifact/body/fetch', 'POST', input)") &&
    clientSource.includes('isAtelierArtifactBodyResponse') &&
    clientSource.includes('ATELIER_ARTIFACT_BODY_KINDS') &&
    clientSource.includes('isAtelierArtifactBodyKind(record.bodyKind)') &&
    clientSource.includes('isNonEmptyString(record.taskId)') &&
    clientSource.includes('isNonEmptyString(record.artifactId)') &&
    clientSource.split('isNonEmptyString(record.artifactId)').length >= 3 &&
      clientSource.includes('ATELIER_ARTIFACT_BODY_REF_SHAPE') &&
    clientSource.includes('isAtelierArtifactBodyRef(record.bodyRef)') &&
      clientSource.includes('isAtelierArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE)') &&
      !clientSource.includes('ATELIER_ARTIFACT_BODY_REF_PATTERN') &&
    clientSource.includes('function isNonNegativeFiniteNumber') &&
    clientSource.includes('function isNonEmptyString') &&
    clientSource.includes('isNonEmptyString(record.bodyHash)') &&
    clientSource.includes('isNonEmptyString(record.retentionStatus)') &&
    clientSource.includes('Number.isFinite(value) && value >= 0') &&
    clientSource.includes('isNonNegativeFiniteNumber(record.bodySize)') &&
    !clientSource.includes("['markdown', 'diff', 'text', 'json'].includes(record.bodyKind)") &&
    !clientSource.includes('typeof record.bodySize === \'number\''),
  'Atelier official client must fetch artifact body through service binding, accept only safe text body kinds, and reject invalid body metadata',
);
assert.ok(
  clientSource.includes('openAtelierArtifactPreview') &&
    clientSource.includes("sdk.invoke<unknown>('atelier.artifact.preview.open'") &&
    clientSource.includes('isAtelierArtifactPreviewOpenResponse') &&
      clientSource.includes('ATELIER_ARTIFACT_SANDBOX_REF_SHAPE') &&
      clientSource.includes('isAtelierArtifactSandboxRef(record.sandboxRef)') &&
      clientSource.includes('isAtelierArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE)') &&
      !clientSource.includes('ATELIER_ARTIFACT_SANDBOX_REF_PATTERN') &&
    clientSource.includes('isNonEmptyString(record.kind)') &&
    clientSource.includes('isNonEmptyString(record.rendererSessionId)') &&
    clientSource.includes('record.rendererCapabilities.every(isNonEmptyString)') &&
    clientSource.includes("ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].requiredRendererCapabilities") &&
    clientSource.includes('hasRequiredAtelierArtifactPreviewRendererCapabilities(record.rendererCapabilities)') &&
    clientSource.includes('function hasRequiredAtelierArtifactPreviewRendererCapabilities(value: string[]): boolean') &&
    clientSource.includes('isNonEmptyString(record.reason)') &&
      clientSource.includes('ATELIER_ARTIFACT_PREVIEW_OPEN_MODES') &&
      clientSource.includes('isAtelierArtifactPreviewOpenMode(record.mode)') &&
      clientSource.includes('isAtelierArtifactPreviewOpenRendererOwner(record.rendererOwner)') &&
      clientSource.includes('isAtelierArtifactPreviewOpenRendererMode(record.rendererMode)') &&
      clientSource.includes('isAtelierArtifactPreviewOpenRendererStatus(record.rendererStatus)') &&
      !clientSource.includes("record.mode === 'sandbox_manifest'") &&
      !clientSource.includes("record.rendererOwner === 'desktop_host'") &&
      !clientSource.includes("record.rendererMode === 'host_sandbox_manifest'") &&
      !clientSource.includes("record.rendererStatus === 'prepared_not_opened'") &&
    !clientSource.includes("sdk.invoke<unknown>('iframe'") &&
    !clientSource.includes("sdk.invoke<unknown>('image'"),
  'Atelier official client must open artifact preview through Host sandbox manifest capability without iframe/image/raw URL rendering',
);
  assert.ok(
    controllerSource.includes('buildAtelierArtifactBodyFetchIntent') &&
      controllerSource.includes('buildAtelierArtifactPreviewOpenIntent') &&
      artifactActionGuardsSource.includes('ATELIER_ARTIFACT_BODY_REF_SHAPE') &&
      artifactActionGuardsSource.includes('ATELIER_ARTIFACT_SANDBOX_REF_SHAPE') &&
      artifactActionGuardsSource.includes('ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE') &&
      artifactActionGuardsSource.includes('ATELIER_ARTIFACT_PREVIEW_OPEN_MODES') &&
      artifactActionGuardsSource.includes('isCanonicalAtelierArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE)') &&
      artifactActionGuardsSource.includes('isCanonicalAtelierArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE)') &&
      artifactActionGuardsSource.includes('isAtelierArtifactPreviewOpenMode(mode)') &&
      !artifactActionGuardsSource.includes('/^artifact:\\/\\//') &&
      !artifactActionGuardsSource.includes('/^atelier-sandbox:\\/\\//') &&
      !controllerSource.includes("previewTarget?.mode?.trim() || 'sandbox_manifest'") &&
      !controllerSource.includes('previewTarget?.mode?.trim() || ATELIER_ARTIFACT_PREVIEW_OPEN_MODES[0]') &&
      !controllerSource.includes("mode !== 'sandbox_manifest'"),
    'Atelier official artifact preview preflight must consume generated artifact ref shape and preview-open mode descriptors through pure guards',
  );
assert.ok(
  clientSource.includes('submitAtelierFeedback') &&
    clientSource.includes("requestAtelierService('/v1/feedback/submit', 'POST', input)") &&
    clientSource.includes('isSubmitAtelierFeedbackResponse') &&
    clientSource.includes('isNonEmptyString(record.feedbackId)') &&
    clientSource.includes('isFeedbackPolicyHint') &&
    clientSource.includes('isNonEmptyString(record.status)') &&
    clientSource.includes('isNonEmptyString(record.reason)') &&
    clientSource.includes('isNonEmptyString(record.confirmationMode)') &&
    clientSource.includes('record.feeds') &&
      clientSource.includes('ATELIER_MEMORY_CANDIDATE_FEEDS') &&
      clientSource.includes('record.feeds.every(isAtelierMemoryCandidateFeed)') &&
      !clientSource.includes("new Set(['planner', 'risk', 'verifier'])"),
  'Atelier official client must submit Station-owned feedback intent and reject empty feedback response metadata',
);
assert.ok(
  clientSource.includes('confirmAtelierMemoryCandidate') &&
    clientSource.includes("requestAtelierService('/v1/memory/confirm-candidate', 'POST', input)") &&
    clientSource.includes('isConfirmAtelierMemoryCandidateResponse') &&
    clientSource.includes('isNonEmptyString(record.memoryId)') &&
    clientSource.includes('isNonEmptyString(record.source)') &&
    clientSource.includes('record.feedbackId === input.feedbackId') &&
    !clientSource.includes("sdk.invoke<unknown>('memory.write'") &&
    !clientSource.includes('memory.write'),
  'Atelier official client must confirm memory candidates through Station service binding, validate confirmation response fields, and must not write memory directly',
);
assert.ok(
  clientSource.includes('confirmAtelierFeedbackRerun') &&
    clientSource.includes("requestAtelierService('/v1/feedback/confirm-rerun', 'POST', input)") &&
    clientSource.includes('isConfirmAtelierRerunResponse') &&
    clientSource.includes('isNonEmptyString(record.taskId)') &&
    clientSource.includes('isNonEmptyString(record.rerunTaskId)') &&
    !clientSource.includes("sdk.invoke<unknown>('atelier.rerun'") &&
    !clientSource.includes("sdk.invoke<unknown>('atelier.run'") &&
    !clientSource.includes("sdk.invoke<unknown>('atelier.execute'"),
  'Atelier official client must confirm rerun through Station service binding and must not execute runs directly',
);
assert.ok(
  clientSource.includes('openAtelierWorkspace') &&
    clientSource.includes("sdk.invoke<unknown>('atelier.workspace.open'") &&
    clientSource.includes('isAtelierWorkspaceOpenResponse') &&
    clientSource.includes('isAtelierWorkspaceUri(record.workspaceUri)') &&
    clientSource.includes('ATELIER_WORKSPACE_OPEN_URI_SCHEMES') &&
    clientSource.includes('ATELIER_WORKSPACE_OPEN_URI_SHAPE') &&
    clientSource.includes('isAtelierWorkspaceOpenUriScheme(uri.protocol.slice(0, -1))') &&
    clientSource.includes('uri.hostname === shape.host') &&
    clientSource.includes('uri.searchParams.getAll(shape.workspaceQueryKey)') &&
    clientSource.includes('taskPath.length === shape.taskPathSegments') &&
    clientSource.includes('isNonEmptyString(record.mode)') &&
    clientSource.includes('isNonEmptyString(record.reason)') &&
    !clientSource.includes("uri.protocol === 'pt-workspace:'") &&
    !clientSource.includes("uri.hostname === 'task'") &&
    !clientSource.includes("uri.searchParams.getAll('workspace')") &&
    !clientSource.includes('openExternalUrl') &&
    !clientSource.includes('shell(') &&
    !clientSource.includes('shell.execute') &&
    controllerSource.includes('buildAtelierWorkspaceOpenIntent') &&
    controllerSource.includes('openAtelierWorkspace(intent)') &&
    workspaceActionGuardsSource.includes("ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open']") &&
    workspaceActionGuardsSource.includes('ATELIER_WORKSPACE_OPEN_URI_SCHEMES') &&
    workspaceActionGuardsSource.includes('ATELIER_WORKSPACE_OPEN_URI_SHAPE') &&
    workspaceActionGuardsSource.includes('containsForbiddenAtelierWorkspacePayloadActions(input.extraPayload)') &&
    workspaceActionGuardsSource.includes('intent: {') &&
    !workspaceActionGuardsSource.includes("uri.protocol === 'pt-workspace:'") &&
    !workspaceActionGuardsSource.includes("uri.hostname === 'task'") &&
    !workspaceActionGuardsSource.includes("uri.searchParams.getAll('workspace')") &&
    !workspaceActionGuardsSource.includes('openExternalUrl(') &&
    !workspaceActionGuardsSource.includes('shell('),
  'Atelier official client must submit workspace open Host intent and reject empty workspace response metadata without local file/shell open',
);
assert.ok(
  clientSource.includes('classifyAtelierError') &&
    clientSource.includes("kind: 'auth-denied'") &&
    clientSource.includes("kind: 'disconnected'"),
  'Atelier official client must classify auth-denied and disconnected errors for UI state rendering',
);
assert.ok(
  controllerSource.includes('errorKind') &&
    controllerSource.includes('viewStatus') &&
    controllerSource.includes('eventStreamState') &&
    controllerSource.includes('eventStreamError') &&
    controllerSource.includes('eventStreamErrorKind') &&
    controllerSource.includes('stateFromAtelierEventStreamError(error, Boolean(current.snapshot))') &&
    controllerSource.includes('deriveAtelierViewStatus') &&
    controllerSource.includes('nextAtelierEventStreamRetryDelayMs') &&
    controllerSource.includes('retryTimer = setTimeout(connect, retryDelayMs)') &&
    controllerSource.includes('if (retryTimer) clearTimeout(retryTimer)') &&
    controllerSource.includes('stateFromAtelierError') &&
    controllerTransitionsSource.includes('export function stateFromAtelierEventStreamError') &&
    controllerTransitionsSource.includes("eventStreamState: 'degraded'") &&
    controllerTransitionsSource.includes('pendingActionReset()') &&
    controllerSource.includes('stateFromMalformedAtelierProjectionEvent') &&
    clientSource.includes('onMalformedEvent?.(payload)') &&
    controllerTransitionsSource.includes('classifyAtelierError') &&
    viewStatusSource.includes('export function deriveAtelierViewStatus') &&
    viewStatusSource.includes('ATELIER_TYPED_RECOVERY_KINDS') &&
    viewStatusSource.includes('ATELIER_RECONCILING_EVENT_STREAM_STATE') &&
    viewStatusSource.includes('ATELIER_DEGRADED_EVENT_STREAM_STATES') &&
    viewStatusSource.includes('effectiveTypedErrorKind') &&
    viewStatusSource.includes('input.errorKind || input.eventStreamErrorKind') &&
    viewStatusSource.includes('isAtelierTypedRecoveryKind(effectiveTypedErrorKind)') &&
    viewStatusSource.includes('input.eventStreamState === ATELIER_RECONCILING_EVENT_STREAM_STATE') &&
    viewStatusSource.includes('isAtelierDegradedEventStreamState(input.eventStreamState) || input.replayHasMore') &&
    eventStreamRecoverySource.includes('ATELIER_EVENT_STREAM_RETRY_DELAYS_MS') &&
    eventStreamRecoverySource.includes('ATELIER_RECOVERY_RETRYABLE_KINDS') &&
    eventStreamRecoverySource.includes('includes(input.errorKind)') &&
    eventStreamEventGuardSource.includes("eventStreamState: 'degraded'") &&
    eventStreamEventGuardSource.includes("eventStreamErrorKind: 'invalid-projection'"),
  'Atelier official controller must preserve normalized error kind, projection sync view status, and bounded stream retry separately from localized copy',
);
assert.ok(
  pageSource.includes('errorKind') &&
    pageSource.includes('viewStatus') &&
    pageSource.includes('deriveAtelierPageSurface') &&
    pageSource.includes('pageSurface.globalErrorVisible') &&
    pageSource.includes('pageSurface.typedRecoveryKind') &&
    pageSource.includes('pageSurface.statusNotice') &&
    pageSource.includes('pageSurface.loadingVisible') &&
    pageSource.includes('statusActionPolicy.createProjectVisible') &&
    pageSource.includes('pageSurface.mainContentVisible') &&
    pageCompositionSource.includes('shouldRenderAtelierEmptyState') &&
    pageCompositionSource.includes('atelierTypedRecoveryKind') &&
    pageCompositionSource.includes('ATELIER_EMPTY_CTA_STATUS') &&
    pageCompositionSource.includes('ATELIER_TYPED_RECOVERY_KINDS') &&
    pageCompositionSource.includes('ATELIER_STATUS_NOTICE_KINDS') &&
    pageSource.includes('function StatusNotice') &&
    pageSource.includes('deriveOfficialStatusNoticeView(status)') &&
    statusNoticeViewSource.includes('ATELIER_VIEW_SURFACE.statusNoticeLabelKeyByStatus') &&
    statusNoticeViewSource.includes('function deriveOfficialStatusNoticeView') &&
    pageSource.includes("deriveOfficialCenteredStateView('loading')") &&
    pageSource.includes("deriveOfficialCenteredStateView('empty')") &&
    centeredStateViewSource.includes('ATELIER_VIEW_SURFACE.centeredStateLabelKeyByStatus') &&
    centeredStateViewSource.includes('function deriveOfficialCenteredStateView') &&
    !pageSource.includes("status === 'reconciling' ? t('atelier.status.reconcilingTitle')") &&
    !pageSource.includes("status === 'reconciling' ? t('atelier.status.reconcilingDetail')") &&
    officialRecoveryViewSource.includes('ATELIER_VIEW_SURFACE.recovery.labelKeyByKind') &&
    !officialRecoveryViewSource.includes("titleKey: 'atelier.error.authDeniedTitle'") &&
    !officialRecoveryViewSource.includes("detailKey: 'atelier.error.disconnectedDetail'") &&
    pageSource.includes('deriveOfficialRecoveryView(kind)') &&
    pageSource.includes('const statusActionPolicy = deriveOfficialStatusActionPolicy({') &&
    pageSource.includes('retryVisible={statusActionPolicy.retryVisible}') &&
    pageSource.includes('statusActionPolicy.createProjectVisible ?') &&
    pageSource.includes('retryVisible: boolean') &&
    !pageSource.includes('retryVisible ?? recoveryView.retryVisible') &&
    pageSource.includes('recoveryView.detailKey ? t(recoveryView.detailKey) : message || title') &&
    pageSource.includes('const rawMessageVisible = Boolean(message) && detail !== message;') &&
    !pageSource.includes("pageSurface.typedRecoveryKind === 'auth-denied'") &&
    clientSource.includes('type AtelierRecoveryKind') &&
    clientSource.includes('export type AtelierErrorKind = AtelierRecoveryKind;') &&
    !clientSource.includes("export type AtelierErrorKind = 'auth-denied' | 'disconnected' | 'invalid-projection' | 'agent-ids-required' | 'error';") &&
    officialRecoveryViewSource.includes('ATELIER_RECOVERY_RETRYABLE_KINDS') &&
    officialRecoveryViewSource.includes('ATELIER_RECOVERY_TONE_BY_KIND') &&
    officialRecoveryViewSource.includes('recoveryToneByKind.error') &&
    officialRecoveryViewSource.includes('satisfies Record<AtelierErrorKind, { titleKey: string; detailKey?: string }>') &&
    officialRecoveryViewSource.includes('satisfies Record<AtelierErrorKind, AtelierRecoveryTone>') &&
    !officialRecoveryViewSource.includes("?? 'danger'") &&
    !officialRecoveryViewSource.includes('Record<string, AtelierRecoveryTone>') &&
    pageSource.includes('bindtap={() => void onRetry()}') &&
    pageSource.includes("t('atelier.recovery.retryBoundary')"),
  'Atelier official page must render auth-denied, disconnected, degraded, and reconciling as distinct recovery states',
);
const officialRecoverySurfaceAnchors = [
  '{pageSurface.globalErrorVisible ? (',
  '{pageSurface.typedRecoveryKind ? (',
  '{pageSurface.statusNotice ? (',
  '{pageSurface.loadingVisible ? (',
  '{statusActionPolicy.createProjectVisible ? (',
];
const officialMainContentAnchor = '{pageSurface.mainContentVisible ? (';
for (const anchor of officialRecoverySurfaceAnchors) {
  assert.ok(
    pageSource.indexOf(anchor) >= 0 && pageSource.indexOf(anchor) < pageSource.indexOf(officialMainContentAnchor),
    'official single-column recovery-state layout must render ' + anchor + ' above the projection content rail',
  );
}
assert.ok(
  pageSource.includes("flexDirection: 'column', minHeight: px(0)") &&
    pageSource.includes("minWidth: px(0), padding: px(12), width: '100%'") &&
    pageSource.includes("minWidth: px(0), width: '100%'") &&
    !pageSource.includes('PanelToggleButton') &&
    !pageSource.includes('railOpen') &&
    !pageSource.includes('railRightOpen') &&
    !pageSource.includes('minWidth: px(360)'),
  'official single-column recovery-state layout must keep projection sections stacked without app-level side rails or desktop-only minimum widths',
);
assert.ok(
  controllerSource.includes('resolveAtelierDecision') &&
    controllerSource.includes('resolvingDecisionId') &&
    controllerSource.includes('buildAtelierDecisionResolveIntent') &&
    controllerSource.includes('pendingBlockId: state.resolvingDecisionId') &&
    controllerSource.includes('resolveAtelierDecision(intent)') &&
    clientSource.includes("requestAtelierService('/v1/escalations:resolve', 'POST', input)") &&
    decisionActionGuardsSource.includes("ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.escalation.resolve']") &&
    decisionActionGuardsSource.includes('ATELIER_DECISION_RESOLVE_REQUIRED_FIELDS') &&
    decisionActionGuardsSource.includes('ATELIER_DECISION_RESOLVE_FORBIDDEN_ACTIONS') &&
    decisionActionGuardsSource.includes('containsForbiddenAtelierDecisionPayloadActions(input.extraPayload)') &&
    decisionActionGuardsSource.includes('intent: { taskId, blockId, choice }') &&
    !decisionActionGuardsSource.includes('provider.invoke(') &&
    !decisionActionGuardsSource.includes('runtime.execute(') &&
    !decisionActionGuardsSource.includes('memory.write(') &&
    !decisionActionGuardsSource.includes('input_snapshot.write('),
  'Atelier official controller must expose decision resolving state and route only generated Station human decision intents',
);
assert.ok(
  controllerSource.includes('feedbackStatusBlockId') &&
    controllerSource.includes('feedbackStatusBlockId: intent.blockId') &&
    controllerSource.includes('feedbackStatus: normalized.error') &&
    controllerSource.includes('feedbackStatusBlockId: current.memoryConfirmationBlockId') &&
    controllerSource.includes('feedbackStatusBlockId: current.rerunConfirmationBlockId') &&
    pageSource.includes("controller.feedbackStatusBlockId === block.id ? controller.feedbackStatus : ''"),
  'Atelier official feedback status must render only on the source stream block',
);
assert.ok(
  controllerSource.includes('confirmAtelierMemoryCandidate') &&
    controllerSource.includes('memoryConfirmationFeedbackId') &&
    controllerSource.includes('memoryConfirmationTaskId') &&
    controllerSource.includes('memoryConfirmationBlockId') &&
    controllerSource.includes('memoryConfirming') &&
    controllerSource.includes('confirmMemoryCandidate') &&
      controllerSource.includes('buildAtelierMemoryConfirmIntent') &&
      controllerSource.includes('confirmAtelierMemoryCandidate(intent)') &&
      controllerSource.includes('ATELIER_MEMORY_CONFIRMATION_MODE') &&
      !controllerSource.includes("confirmationMode === 'station_memory_review'") &&
      confirmationActionGuardsSource.includes("ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.memory.confirmCandidate']") &&
      confirmationActionGuardsSource.includes('ATELIER_MEMORY_CONFIRM_FORBIDDEN_ACTIONS') &&
    controllerSource.includes('atelier.feedback.memoryConfirmed') &&
    controllerSource.includes('memoryConfirmationFeedbackId: current.memoryConfirmationFeedbackId') &&
    controllerSource.includes('memoryConfirmationTaskId: current.memoryConfirmationTaskId') &&
    controllerSource.includes('memoryConfirmationBlockId: current.memoryConfirmationBlockId'),
  'Atelier official controller must track and confirm Station-owned memory candidate reviews',
);
assert.ok(
  pageSource.includes('controller.confirmMemoryCandidate') &&
    pageSource.includes("controller.memoryConfirmationBlockId === block.id ? controller.memoryConfirmationFeedbackId : ''") &&
    pageSource.includes('controller.memoryConfirmationBlockId === block.id && controller.memoryConfirming') &&
    pageSource.includes('atelier.feedback.confirmMemory') &&
    pageSource.includes('atelier.feedback.confirmingMemory'),
  'Atelier official page must render pending memory candidate confirmation affordance only on the source block',
);
assert.ok(
  controllerSource.includes('confirmAtelierFeedbackRerun') &&
    controllerSource.includes('rerunConfirmationFeedbackId') &&
    controllerSource.includes('rerunConfirmationTaskId') &&
    controllerSource.includes('rerunConfirmationBlockId') &&
    controllerSource.includes('rerunConfirming') &&
    controllerSource.includes('confirmRerun') &&
      controllerSource.includes('buildAtelierRerunConfirmIntent') &&
      controllerSource.includes('confirmAtelierFeedbackRerun(intent)') &&
      controllerSource.includes('ATELIER_RERUN_CONFIRMATION_MODE') &&
      !controllerSource.includes("confirmationMode === 'station_rerun_review'") &&
      confirmationActionGuardsSource.includes("ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.confirmRerun']") &&
      confirmationActionGuardsSource.includes('ATELIER_RERUN_CONFIRM_FORBIDDEN_ACTIONS') &&
    controllerSource.includes('atelier.feedback.rerunConfirmed') &&
    controllerSource.includes('rerunConfirmationFeedbackId: current.rerunConfirmationFeedbackId') &&
    controllerSource.includes('rerunConfirmationTaskId: current.rerunConfirmationTaskId') &&
    controllerSource.includes('rerunConfirmationBlockId: current.rerunConfirmationBlockId'),
  'Atelier official controller must track and confirm Station-owned rerun reviews',
);
assert.ok(
  pageSource.includes('controller.confirmRerun') &&
    pageSource.includes("controller.rerunConfirmationBlockId === block.id ? controller.rerunConfirmationFeedbackId : ''") &&
    pageSource.includes('controller.rerunConfirmationBlockId === block.id && controller.rerunConfirming') &&
    pageSource.includes('atelier.feedback.confirmRerun') &&
    pageSource.includes('atelier.feedback.confirmingRerun'),
  'Atelier official page must render pending rerun confirmation affordance only on the source block',
);
const officialFeedbackBarStart = pageSource.indexOf('function FeedbackBar({');
const officialFeedbackBarEnd = pageSource.indexOf('\nfunction NegoDisclosure', officialFeedbackBarStart);
const officialFeedbackBarSource =
  officialFeedbackBarStart >= 0 && officialFeedbackBarEnd > officialFeedbackBarStart
    ? pageSource.slice(officialFeedbackBarStart, officialFeedbackBarEnd)
    : '';
const officialFeedbackFlowStart = controllerSource.indexOf('const submitFeedback = useCallback(async (taskId: string, blockId: string, signal: AtelierFeedbackSignal) => {');
const officialFeedbackFlowEnd = controllerSource.indexOf('\n  const openWorkspace = useCallback', officialFeedbackFlowStart);
const officialFeedbackFlowSource =
  officialFeedbackFlowStart >= 0 && officialFeedbackFlowEnd > officialFeedbackFlowStart
    ? controllerSource.slice(officialFeedbackFlowStart, officialFeedbackFlowEnd)
    : '';
assert.ok(
  pageSource.includes('ATELIER_FEEDBACK_SIGNALS') &&
    pageSource.includes('const FEEDBACK_SIGNAL_LABEL_KEYS: Record<AtelierFeedbackSignal, string>') &&
    officialFeedbackBarSource.includes('ATELIER_FEEDBACK_SIGNALS.map((signal) => ({') &&
    officialFeedbackBarSource.includes('label: t(FEEDBACK_SIGNAL_LABEL_KEYS[signal])') &&
    !officialFeedbackBarSource.includes("signal: 'positive'") &&
    officialFeedbackBarSource.includes('if (!busy) void onSubmitFeedback(taskId, blockId, item.signal);') &&
    officialFeedbackBarSource.includes('if (!memoryConfirming) void onConfirmMemoryCandidate();') &&
    officialFeedbackBarSource.includes('if (!rerunConfirming) void onConfirmRerun();') &&
    officialFeedbackFlowSource.includes('buildAtelierFeedbackSubmitIntent({') &&
      officialFeedbackFlowSource.includes('pendingFeedbackId: state.feedbackSubmittingId') &&
      officialFeedbackFlowSource.includes('const response = await submitAtelierFeedback(intent);') &&
      feedbackActionGuardsSource.includes("ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.submit']") &&
      feedbackActionGuardsSource.includes('ATELIER_FEEDBACK_SUBMIT_REQUIRED_FIELDS') &&
      feedbackActionGuardsSource.includes('ATELIER_FEEDBACK_SUBMIT_FORBIDDEN_ACTIONS') &&
      feedbackActionGuardsSource.includes('isAtelierFeedbackSignal') &&
      feedbackActionGuardsSource.includes('containsForbiddenAtelierFeedbackPayloadActions(input.extraPayload)') &&
      officialFeedbackFlowSource.includes('response.memoryCandidate.confirmationMode === ATELIER_MEMORY_CONFIRMATION_MODE') &&
      officialFeedbackFlowSource.includes('response.rerunIntent.confirmationMode === ATELIER_RERUN_CONFIRMATION_MODE') &&
    officialFeedbackFlowSource.includes('buildAtelierMemoryConfirmIntent({') &&
    officialFeedbackFlowSource.includes('const response = await confirmAtelierMemoryCandidate(intent);') &&
    officialFeedbackFlowSource.includes('buildAtelierRerunConfirmIntent({') &&
    officialFeedbackFlowSource.includes('const response = await confirmAtelierFeedbackRerun(intent);') &&
    confirmationActionGuardsSource.includes('containsForbiddenAtelierConfirmationPayloadActions') &&
    officialFeedbackFlowSource.includes('await load();') &&
    !officialFeedbackBarSource.includes('submitAtelierFeedback') &&
    !officialFeedbackBarSource.includes('confirmAtelierMemoryCandidate') &&
    !officialFeedbackBarSource.includes('confirmAtelierFeedbackRerun') &&
    !officialFeedbackBarSource.includes('provider.invoke') &&
    !officialFeedbackBarSource.includes('memory.write') &&
    !officialFeedbackBarSource.includes('atelier.rerun') &&
    !officialFeedbackBarSource.includes('runtime.rerun') &&
    !officialFeedbackBarSource.includes('runtime.execute') &&
    !officialFeedbackFlowSource.includes('provider.invoke') &&
    !officialFeedbackFlowSource.includes('runtime.invokeProvider') &&
    !officialFeedbackFlowSource.includes('memory.write') &&
    !officialFeedbackFlowSource.includes('atelier.memory.write') &&
    !officialFeedbackFlowSource.includes('atelier.rerun') &&
    !officialFeedbackFlowSource.includes('runtime.rerun') &&
    !officialFeedbackFlowSource.includes('runtime.execute') &&
    !officialFeedbackFlowSource.includes('gate.rerun') &&
    !officialFeedbackFlowSource.includes('taskGraph.diff.apply') &&
    !officialFeedbackFlowSource.includes('cli.execute'),
  'Atelier official FeedbackBar confirmations must stay Station-owned service policy intents and must not expose direct memory write/rerun/execute/provider capabilities',
);
assert.ok(
  controllerSource.includes('selectedProject: AtelierProjectProjection | undefined') &&
    controllerSource.includes('selectedProject: selectedProjectProjection') &&
    controllerSource.includes('workspace.projects?.find') &&
    controllerSource.includes('project.taskGraph.tasks.some((node) => node.id === state.selectedTaskId)') &&
    pageSource.includes('function TaskGraphPanel') &&
    pageSource.includes('function TaskGraphNodeRow') &&
    pageSource.includes('controller.selectedProject ?') &&
    pageSource.includes('atelier.taskGraph.readOnly') &&
    pageSource.includes('atelier.taskGraph.parallelPolicy') &&
    pageSource.includes("project.taskGraph.parallelPolicy === 'integrator_required'") &&
    pageSource.includes('atelier.taskGraph.integratorBoundary') &&
    pageSource.includes('visibleRootTaskIds') &&
    pageSource.includes('hiddenRootTaskIdCount') &&
    pageSource.includes('visibleEdges') &&
    pageSource.includes('hiddenEdgeCount') &&
    pageSource.includes('atelier.taskGraph.roots') &&
    pageSource.includes('atelier.taskGraph.edges') &&
    pageSource.includes('visibleNodeArtifactRefs') &&
    pageSource.includes('evidenceView.hiddenArtifactCount') &&
    pageSource.includes('evidenceView.unresolvedArtifactCount') &&
    pageSource.includes('visibleNodeGateRefs') &&
    pageSource.includes('evidenceView.hiddenGateCount') &&
    pageSource.includes('evidenceView.unresolvedGateCount') &&
    pageSource.includes('visibleNodeArtifactRefs.map((ref) => ref.label)') &&
    pageSource.includes('visibleNodeGateRefs.map((ref) => ref.label)') &&
    pageSource.includes('atelier.taskGraph.artifactRefs') &&
    pageSource.includes('atelier.taskGraph.gateRefs') &&
    pageSource.includes('hiddenNodeCount') &&
    pageSource.includes('atelier.taskGraph.moreProjected') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('does not schedule, execute, or replan nodes') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('Integrator identity and merge execution remain Station-owned') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('more Station TaskGraph dependency edges hidden') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('more artifact refs') &&
    messagesZhCn['atelier.taskGraph.readOnly'].includes('不调度') &&
    messagesZhCn['atelier.taskGraph.integratorBoundary'].includes('仍归 Station') &&
    messagesZhCn['atelier.taskGraph.moreEdges'].includes('依赖边') &&
    messagesZhCn['atelier.taskGraph.moreGateRefs'].includes('gate ref') &&
    pageSource.includes('<TodoPanel todos={controller.selectedTodos} />'),
  'Atelier official page must consume workspace.projects[].taskGraph as a read-only Station projection with parallel policy, roots, edges, and node evidence refs disclosure before falling back to legacy Todo',
);
const officialTaskGraphStart = pageSource.indexOf('function TaskGraphPanel({');
const officialTaskGraphEnd = pageSource.indexOf('\nfunction ContextPanel', officialTaskGraphStart);
const officialTaskGraphSource =
  officialTaskGraphStart >= 0 && officialTaskGraphEnd > officialTaskGraphStart
    ? pageSource.slice(officialTaskGraphStart, officialTaskGraphEnd)
    : '';
assert.ok(
  officialTaskGraphSource.includes("t('atelier.taskGraph.readOnly')") &&
    officialTaskGraphSource.includes('project.taskGraph.parallelPolicy') &&
    officialTaskGraphSource.includes("project.taskGraph.parallelPolicy === 'integrator_required'") &&
    officialTaskGraphSource.includes('visibleRootTaskIds') &&
    officialTaskGraphSource.includes('visibleEdges') &&
    officialTaskGraphSource.includes('visibleNodeArtifactRefs') &&
    officialTaskGraphSource.includes('evidenceView.unresolvedArtifactCount') &&
    officialTaskGraphSource.includes('visibleNodeGateRefs') &&
    officialTaskGraphSource.includes('evidenceView.unresolvedGateCount') &&
    !officialTaskGraphSource.includes('taskGraph.schedule') &&
    !officialTaskGraphSource.includes('taskGraph.execute') &&
    !officialTaskGraphSource.includes('taskGraph.replan') &&
    !officialTaskGraphSource.includes('taskGraph.diff.apply') &&
    !officialTaskGraphSource.includes('integrator.merge.execute'),
  'Atelier official TaskGraph panel must stay read-only Station projection and must not expose scheduling/execution/replan capabilities',
);
assert.ok(
  pageSource.includes('ATELIER_TASK_ORGANIZER_MODES') &&
      pageSource.includes('ATELIER_DEFAULT_TASK_ORGANIZER_MODE') &&
    pageSource.includes('type TaskOrganizerMode = AtelierTaskOrganizerMode') &&
      pageSource.includes('useState<TaskOrganizerMode>(ATELIER_DEFAULT_TASK_ORGANIZER_MODE)') &&
    pageSource.includes('TASK_ORGANIZER_LABEL_KEYS[item.id]') &&
    pageSource.includes('function TaskOrganizerPanel') &&
    !pageSource.includes("type TaskOrganizerMode = 'folders' | 'flat-list' | 'kanban' | 'dag'") &&
      !pageSource.includes("useState<TaskOrganizerMode>('folders')") &&
      !pageSource.includes('useState<TaskOrganizerMode>(ATELIER_TASK_ORGANIZER_MODES[0].id)') &&
    !pageSource.includes("id: 'folders', labelKey: 'atelier.taskOrganizer.folders', ready: true") &&
    pageSource.includes('function TaskFoldersList') &&
    pageSource.includes('function TaskFlatList') &&
    pageSource.includes('function TaskOrganizerLifecycleSection') &&
    pageSource.includes('function TaskOrganizerUnavailable') &&
    pageSource.includes('onTaskAction={controller.setTaskLifecycle}') &&
    pageSource.includes("normalizeTaskStatus(task.status) === 'active'") &&
    pageSource.includes("normalizeTaskStatus(task.status) === 'archived'") &&
    pageSource.includes("normalizeTaskStatus(task.status) === 'deleted'") &&
    pageSource.includes('purgeConfirmTaskId={purgeConfirmTaskId}') &&
    pageSource.includes("onAction(task.id, 'purge')") &&
    pageSource.includes('onSelectTask(task.id)') &&
    !pageSource.includes('const readyMode') &&
    !pageSource.includes('organizer.execute') &&
    pageSource.includes('atelier.taskOrganizer.readOnly') &&
    pageSource.includes('atelier.taskOrganizer.deletedHint') &&
    pageSource.includes('atelier.taskOrganizer.unavailableBoundary') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('does not reorder, schedule, execute, or replan tasks') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('consume Station projection and delegate task execution to Station orchestration') &&
    messagesZhCn['atelier.taskOrganizer.readOnly'].includes('不重排') &&
    messagesZhCn['atelier.taskOrganizer.deletedHint'].includes('Station') &&
    messagesZhCn['atelier.taskOrganizer.unavailableBoundary'].includes('Station orchestration'),
  'Atelier official task organizer must be a local read-only lifecycle projection view selector with disabled kanban/dag boundaries',
);
assert.ok(
  clientSource.includes('type AtelierTaskLifecycleStatus') &&
    clientSource.includes('status: AtelierTaskLifecycleStatus;') &&
    !clientSource.includes("status: 'active' | 'archived' | 'deleted';"),
  'Atelier official client setTaskStatus input must derive lifecycle status from generated contract taxonomy',
);
assert.ok(
  pageSource.includes('function TodoPanel') &&
    pageSource.includes('visibleTodos') &&
    pageSource.includes('hiddenTodoCount') &&
    pageSource.includes('atelier.todos.moreProjected') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('more legacy todo projections in Station') &&
    messagesZhCn['atelier.todos.moreProjected'].includes('Station legacy todo projection'),
  'Atelier official legacy Todo fallback must disclose hidden todo projection overflow instead of silently truncating',
);
assert.ok(
  pageSource.includes('function ProjectHealthPanel') &&
    pageSource.includes('function ProjectionItemList') &&
    pageSource.includes('project.completion.noOpenBlockers') &&
    pageSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems') &&
    pageSource.includes('hiddenBlockerCount') &&
    pageSource.includes('hiddenRiskCount') &&
    pageSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthMilestones') &&
    pageSource.includes('hiddenMilestoneCount') &&
    pageSource.includes('formatMilestoneDetail') &&
    pageSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.milestoneRefs') &&
    pageSource.includes('visiblePredicateIds') &&
    pageSource.includes('hiddenPredicateCount') &&
    pageSource.includes('visibleMilestoneBlockerRefs') &&
    pageSource.includes('hiddenMilestoneBlockerCount') &&
    pageSource.includes('hiddenMemoryCandidateCount') &&
    pageSource.includes('project.policy') &&
    pageSource.includes('project.policy?.rules ?? []') &&
    pageSource.includes('hiddenPolicyRuleCount') &&
    pageSource.includes('hiddenDefectCount') &&
    pageSource.includes('atelier.projectHealth.readOnly') &&
    pageSource.includes('atelier.projectHealth.moreBlockers') &&
    pageSource.includes('atelier.projectHealth.moreRisks') &&
    pageSource.includes('atelier.projectHealth.moreMilestones') &&
    pageSource.includes('atelier.projectHealth.predicateRefs') &&
    pageSource.includes('atelier.projectHealth.blockerRefs') &&
    pageSource.includes('atelier.projectHealth.morePredicateRefs') &&
    pageSource.includes('atelier.projectHealth.moreBlockerRefs') &&
    pageSource.includes('atelier.projectHealth.moreMemoryCandidates') &&
    pageSource.includes('atelier.projectHealth.morePolicyRules') &&
    pageSource.includes('atelier.projectHealth.moreDefects') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('Read-only Station project health projection') &&
    messagesZhCn['atelier.projectHealth.readOnly'].includes('只读 Station project health projection'),
  'Atelier official page must render Station project health projection read-only with blocker/risk/milestone predicate/blocker ref/memory/policy/defect overflow disclosure',
);
const officialProjectHealthStart = pageSource.indexOf('function ProjectHealthPanel({');
const officialProjectHealthEnd = pageSource.indexOf('\nfunction TaskGraphPanel', officialProjectHealthStart);
const officialProjectHealthSource =
  officialProjectHealthStart >= 0 && officialProjectHealthEnd > officialProjectHealthStart
    ? pageSource.slice(officialProjectHealthStart, officialProjectHealthEnd)
    : '';
assert.ok(
  officialProjectHealthSource.includes("t('atelier.projectHealth.readOnly')") &&
    officialProjectHealthSource.includes('project.completion.noOpenBlockers') &&
    officialProjectHealthSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems') &&
    officialProjectHealthSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthMilestones') &&
    officialProjectHealthSource.includes('ATELIER_PROJECTION_DISPLAY_LIMITS.milestoneRefs') &&
    officialProjectHealthSource.includes('project.policy?.rules ?? []') &&
    !officialProjectHealthSource.includes('project.openBlockers.slice(0, 3)') &&
    !officialProjectHealthSource.includes('project.residualRisks.slice(0, 3)') &&
    !officialProjectHealthSource.includes('project.milestoneTree.milestones.slice(0, 4)') &&
    !officialProjectHealthSource.includes('project.memoryCandidates.slice(0, 3)') &&
    !officialProjectHealthSource.includes('project.defects.slice(0, 3)') &&
    !officialProjectHealthSource.includes('project.health.accept') &&
    !officialProjectHealthSource.includes('project.health.waive') &&
    !officialProjectHealthSource.includes('project.state.mutate') &&
    !officialProjectHealthSource.includes('acceptancePredicate.evaluate') &&
    !officialProjectHealthSource.includes('policy.engine.run') &&
    !officialProjectHealthSource.includes('defect.lifecycle.mutate'),
  'Atelier official Project Health panel must stay read-only Station projection and must not expose project mutation/evaluator capabilities',
);
assert.ok(
  eventStreamRecoverySource.includes('ATELIER_RECOVERY_RETRYABLE_KINDS') &&
    eventStreamRecoverySource.includes("includes(input.errorKind)") &&
    !eventStreamRecoverySource.includes("input.errorKind === 'auth-denied' || input.errorKind === 'invalid-projection'"),
  'Atelier official event stream retry must consume generated retryable recovery taxonomy',
);
assert.ok(
  pageSource.includes('function ArtifactTray') &&
    pageSource.includes('function ArtifactPanel') &&
    pageSource.includes('hiddenArtifactCount') &&
    pageSource.includes('atelier.artifact.moreProjected') &&
    pageSource.includes('atelier.artifact.trayHint') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('more artifact projections in Station') &&
    messagesZhCn['atelier.artifact.moreProjected'].includes('Station artifact projection'),
  'Atelier official artifact projection lists must disclose hidden compact-rail overflow instead of silently truncating metadata',
);
assert.ok(
  pageSource.includes('function ContextPanel') &&
    pageSource.includes('function ContextRefGroup') &&
      pageSource.includes('ATELIER_CONTEXT_FILE_GROUPS') &&
      pageSource.includes('ATELIER_DEFAULT_CONTEXT_FILE_GROUP') &&
      pageSource.includes('CONTEXT_FILE_GROUP_LABEL_KEYS') &&
      pageSource.includes('CONTEXT_FILE_GROUP_MORE_KEYS') &&
      pageSource.includes('CONTEXT_FILE_GROUP_DISPLAY_LIMITS') &&
      pageSource.includes('OFFICIAL_CONTEXT_FILE_GROUPS') &&
      pageSource.includes('contextGroups.map') &&
      pageSource.includes('hiddenCount') &&
    pageSource.includes('atelier.context.moreFiles') &&
    pageSource.includes('atelier.context.moreOther') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('more context file refs in Station projection') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('more other context refs in Station projection') &&
    messagesZhCn['atelier.context.moreFiles'].includes('Station context file ref') &&
    messagesZhCn['atelier.context.moreOther'].includes('Station other context ref'),
  'Atelier official context projection must disclose hidden grouped context overflow instead of silently truncating file refs',
);
const officialContextStart = pageSource.indexOf('function ContextPanel({');
const officialContextEnd = pageSource.indexOf('\nfunction ArtifactPanel', officialContextStart);
const officialContextSource =
  officialContextStart >= 0 && officialContextEnd > officialContextStart
    ? pageSource.slice(officialContextStart, officialContextEnd)
    : '';
assert.ok(
  officialContextSource.includes("t('atelier.context.readOnly')") &&
      officialContextSource.includes('OFFICIAL_CONTEXT_FILE_GROUPS.map') &&
      officialContextSource.includes('file.group === group') &&
      officialContextSource.includes('CONTEXT_FILE_GROUP_DISPLAY_LIMITS[group]') &&
      officialContextSource.includes('CONTEXT_FILE_GROUP_LABEL_KEYS[group]') &&
      officialContextSource.includes('CONTEXT_FILE_GROUP_MORE_KEYS[group]') &&
    officialContextSource.includes('ContextRefGroup') &&
      !officialContextSource.includes("files.filter((file) => file.group === 'files')") &&
      !officialContextSource.includes("files.filter((file) => file.group === 'other')") &&
      !officialContextSource.includes("useState<'files' | 'other'>('files')") &&
      !officialContextSource.includes('ATELIER_CONTEXT_FILE_GROUPS[0]') &&
    !officialContextSource.includes('workspace.files.discover') &&
    !officialContextSource.includes('WorkspaceFileDiscovery') &&
    !officialContextSource.includes('context.files.refresh') &&
    !officialContextSource.includes('input_snapshot.write') &&
    !officialContextSource.includes('inputSnapshot.write'),
  'Atelier official Context panel must stay read-only Station projection and must not expose workspace discovery or input snapshot writes',
);
assert.ok(
  pageSource.includes('function ArtifactPathList') &&
    pageSource.includes('visiblePaths') &&
    pageSource.includes('hiddenArtifactPathCount') &&
    pageSource.includes('atelier.artifact.morePaths') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('more artifact path refs in Station projection') &&
    messagesZhCn['atelier.artifact.morePaths'].includes('Station artifact path ref'),
  'Atelier official artifact preview must disclose hidden artifact path refs instead of silently truncating metadata paths',
);
assert.ok(
  pageSource.includes('function GatePanel') &&
    pageSource.includes('hiddenGateCount') &&
    pageSource.includes('hiddenCheckCount') &&
    pageSource.includes('hiddenGateArtifactCount') &&
    pageSource.includes('atelier.gate.moreProjected') &&
    pageSource.includes('atelier.gate.moreChecks') &&
    pageSource.includes('atelier.gate.moreArtifacts') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('more gate projections in Station') &&
    messagesZhCn['atelier.gate.moreProjected'].includes('Station gate projection'),
  'Atelier official gate projection lists must disclose hidden gate/check/artifact evidence overflow instead of silently truncating evidence',
);
const officialGatePanelStart = pageSource.indexOf('function GatePanel({');
const officialGatePanelEnd = pageSource.indexOf('\nfunction SidePanel', officialGatePanelStart);
const officialGatePanelSource =
  officialGatePanelStart >= 0 && officialGatePanelEnd > officialGatePanelStart
    ? pageSource.slice(officialGatePanelStart, officialGatePanelEnd)
    : '';
assert.ok(
  officialGatePanelSource.includes('const visibleGates = gates.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.gateItems);') &&
    officialGatePanelSource.includes('const hiddenGateCount = Math.max(0, gates.length - visibleGates.length);') &&
    officialGatePanelSource.includes('const visibleChecks = gate.checks?.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.gateChecks) ?? [];') &&
    officialGatePanelSource.includes('const visibleGateArtifactIds = gate.artifactIds?.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.gateArtifactRefs) ?? [];') &&
    officialGatePanelSource.includes('const gatePassed = gate.status === GATE_STATUS_PASSED;') &&
    officialGatePanelSource.includes('backgroundColor: gatePassed ? colors.successSoft : colors.elevated') &&
    officialGatePanelSource.includes('color: gatePassed ? colors.success : colors.warning') &&
    pageSource.includes('type AtelierGateStatus = (typeof ATELIER_GATE_STATUSES)[number];') &&
    pageSource.includes("const GATE_STATUS_PASSED: AtelierGateStatus = 'passed';") &&
    !officialGatePanelSource.includes("gate.status === 'pass'") &&
    officialGatePanelSource.includes('atelier.gate.moreProjected') &&
    officialGatePanelSource.includes('atelier.gate.moreChecks') &&
    officialGatePanelSource.includes('atelier.gate.moreArtifacts') &&
    !officialGatePanelSource.includes('gate.execute') &&
    !officialGatePanelSource.includes('check.execute') &&
    !officialGatePanelSource.includes('gate.rerun') &&
    !officialGatePanelSource.includes('gate.accept') &&
    !officialGatePanelSource.includes('gateResult.submit') &&
    !officialGatePanelSource.includes('gate.produce') &&
    !officialGatePanelSource.includes('artifact.produce'),
  'Atelier official GatePanel must stay read-only Station gate projection and must not expose GateRunner execution or result submission capabilities',
);
assert.ok(
  pageSource.includes('visibleSelectedBlocks') &&
    pageSource.includes('hiddenStreamBlockCount') &&
    pageSource.includes('atelier.stream.moreProjected') &&
    pageSource.includes('function visibleDecisionOptions') &&
    pageSource.includes('option.recommended || option.text === chosen') &&
    pageSource.includes('hiddenDecisionOptionCount') &&
    pageSource.includes('atelier.decision.moreOptions') &&
    pageSource.includes('function DiffSummary') &&
    pageSource.includes('atelier.diff.filesChanged') &&
    pageSource.includes('atelier.diff.morePaths') &&
    pageSource.includes('hiddenPathCount') &&
    pageSource.includes('hiddenVoiceCount') &&
    pageSource.includes('atelier.nego.moreVoices') &&
      pageSource.includes('function NegoDisclosure') &&
      pageSource.includes('function NegoRoleMarker') &&
      pageSource.includes('NEGO_ROLE_COLORS') &&
      pageSource.includes('const roleColor = negoRoleColor(voice.role)') &&
      pageSource.includes('borderLeftWidth: px(2)') &&
      pageSource.includes("const stanceLabel = noEvidenceObjection ? t('atelier.nego.concern') : negoStanceLabel(voice.stance)") &&
      pageSource.includes('const [expanded, setExpanded] = useState(false)') &&
      pageSource.includes('if (hasDetails) setExpanded((value) => !value)') &&
      pageSource.includes('expanded ? (') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('more decision options in Station projection') &&
    messagesZhCn['atelier.decision.moreOptions'].includes('Station decision option') &&
      messagesZhCn['atelier.diff.morePaths'].includes('Station diff path ref') &&
      messagesZhCn['atelier.nego.moreVoices'].includes('Station negotiation voice') &&
      messagesZhCn['atelier.nego.converged'].includes('已收敛') &&
      messagesZhCn['atelier.nego.pending'].includes('未收敛'),
    'Atelier official central stream must disclose hidden stream blocks, diff paths, decision options, and folded negotiation details without dropping chosen/recommended options',
);
const officialNegoStart = pageSource.indexOf('function NegoDisclosure({');
const officialNegoEnd = pageSource.indexOf('\nfunction TodoPanel', officialNegoStart);
const officialNegoSource =
  officialNegoStart >= 0 && officialNegoEnd > officialNegoStart
    ? pageSource.slice(officialNegoStart, officialNegoEnd)
    : '';
assert.ok(
  officialNegoSource.includes('function NegoDisclosure') &&
    officialNegoSource.includes('const [expanded, setExpanded] = useState(false);') &&
    officialNegoSource.includes('if (hasDetails) setExpanded((value) => !value);') &&
    officialNegoSource.includes('block.consensus') &&
    officialNegoSource.includes('block.voices && block.voices.length > 0 ? <NegoVoiceList voices={block.voices} /> : null') &&
    officialNegoSource.includes('const visibleVoices = voices.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.negotiationVoices);') &&
    officialNegoSource.includes('const hiddenVoiceCount = Math.max(0, voices.length - visibleVoices.length);') &&
    officialNegoSource.includes('const roleColor = negoRoleColor(voice.role);') &&
    officialNegoSource.includes("const stanceLabel = noEvidenceObjection ? t('atelier.nego.concern') : negoStanceLabel(voice.stance);") &&
    officialNegoSource.includes('voice.evidenceRef') &&
    !officialNegoSource.includes('agent.invoke') &&
    !officialNegoSource.includes('atelier.agent') &&
    !officialNegoSource.includes('orchestration.start') &&
    !officialNegoSource.includes('negotiation.run') &&
    !officialNegoSource.includes('provider.invoke') &&
    !officialNegoSource.includes('runtime.invokeProvider') &&
    !officialNegoSource.includes('runtime.execute') &&
    !officialNegoSource.includes('gate.rerun') &&
    !officialNegoSource.includes('taskGraph.diff.apply'),
  'Atelier official negotiation disclosure must stay read-only Station voice projection and must not expose agent orchestration/provider execution capabilities',
);
const officialDecisionStart = pageSource.indexOf('const decisionLocked = Boolean(block.chosen || resolving);');
const officialDecisionEnd = pageSource.indexOf("{block.kind === 'decision' && block.rollbackImpact", officialDecisionStart);
const officialDecisionSource =
  officialDecisionStart >= 0 && officialDecisionEnd > officialDecisionStart
    ? pageSource.slice(officialDecisionStart, officialDecisionEnd)
    : '';
assert.ok(
  officialDecisionSource.includes('visibleDecisionOptions(decisionOptions, block.chosen)') &&
    officialDecisionSource.includes('hiddenDecisionOptionCount') &&
    officialDecisionSource.includes('displayedDecisionOptions.map((option) => (') &&
    officialDecisionSource.includes('if (!decisionLocked) void onResolveDecision(taskId, block.id, option.text);') &&
    officialDecisionSource.includes("t('atelier.decision.moreOptions')") &&
    !officialDecisionSource.includes('resume') &&
    !officialDecisionSource.includes('rerun') &&
    !officialDecisionSource.includes('execute') &&
    !officialDecisionSource.includes('provider.invoke') &&
    !officialDecisionSource.includes('gate.rerun') &&
    !officialDecisionSource.includes('taskGraph.diff.apply'),
  'Atelier official decision options must stay human-choice resolve intent only and must not expose resume/rerun/execute/provider capabilities',
);
assert.ok(
  pageSource.includes('function ProviderCapabilitiesPanel') &&
    pageSource.includes('visibleCapabilities') &&
    pageSource.includes('hiddenCapabilityCount') &&
    pageSource.includes('atelier.skills.moreCapabilities') &&
    fsSync.readFileSync(localeFiles[0], 'utf8').includes('more read-only Station provider capabilities') &&
    messagesZhCn['atelier.skills.moreCapabilities'].includes('只读 Station Provider capability'),
  'Atelier official provider capability discovery must disclose hidden read-only capabilities instead of silently truncating the list',
);
const officialProviderCapabilitiesStart = pageSource.indexOf('function ProviderCapabilitiesPanel({');
const officialProviderCapabilitiesEnd = pageSource.indexOf('\nfunction ContextPanel', officialProviderCapabilitiesStart);
const officialProviderCapabilitiesSource =
  officialProviderCapabilitiesStart >= 0 && officialProviderCapabilitiesEnd > officialProviderCapabilitiesStart
    ? pageSource.slice(officialProviderCapabilitiesStart, officialProviderCapabilitiesEnd)
    : '';
assert.ok(
  officialProviderCapabilitiesSource.includes('const visibleCapabilities = capabilities.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.providerCapabilities);') &&
    officialProviderCapabilitiesSource.includes('const hiddenCapabilityCount = Math.max(0, capabilities.length - visibleCapabilities.length);') &&
    officialProviderCapabilitiesSource.includes('visibleCapabilities.map((capability) => (') &&
    officialProviderCapabilitiesSource.includes('bindtap={() => onInsertCommand(capability.slashCommand)}') &&
    officialProviderCapabilitiesSource.includes('capability.slashCommand') &&
    officialProviderCapabilitiesSource.includes('atelier.skills.moreCapabilities') &&
    !officialProviderCapabilitiesSource.includes('atelier.provider.invoke') &&
    !officialProviderCapabilitiesSource.includes('skills.invoke') &&
    !officialProviderCapabilitiesSource.includes('provider.invoke') &&
    !officialProviderCapabilitiesSource.includes('model.run') &&
    !officialProviderCapabilitiesSource.includes('cli.execute'),
  'Atelier official provider capabilities panel must stay read-only discovery and must only insert slash commands',
);
assert.ok(
  clientSource.includes('loadAtelierProviderCapabilities') &&
    clientSource.includes("requestAtelierService('/v1/provider/capabilities', 'POST', taskId ? { taskId } : {})") &&
    clientSource.includes('isAtelierProviderCapabilitiesResponse') &&
    clientSource.includes('isAtelierProviderCapability') &&
    clientSource.includes('isNonEmptyString(record.source)') &&
    clientSource.includes('isNonEmptyString(record.id)') &&
    clientSource.includes('isNonEmptyString(record.label)') &&
    clientSource.includes('isNonEmptyString(record.description)') &&
    clientSource.includes('isNonEmptyString(record.slashCommand)') &&
    clientSource.includes('record.slashCommand.startsWith(\'/\')') &&
    clientSource.includes('isNonEmptyString(record.providerKind)') &&
      clientSource.includes('ATELIER_PROVIDER_CAPABILITY_SCOPES') &&
      clientSource.includes('isAtelierProviderCapabilityScope(record.scope)') &&
      clientSource.includes('record.readOnly === ATELIER_PROVIDER_CAPABILITY_READ_ONLY') &&
      !clientSource.includes("record.scope === 'station-provider'") &&
      !clientSource.includes('record.readOnly === true') &&
    !clientSource.includes("sdk.invoke<unknown>('atelier.provider.invoke'"),
  'Atelier official client must load provider capabilities through discovery-only service binding and reject empty descriptors or provider invoke',
);
const insertProviderCapabilityStart = controllerSource.indexOf('const insertProviderCapabilityCommand = useCallback((command: string) => {');
const insertProviderCapabilityEnd = controllerSource.indexOf('\n  const submitFeedback = useCallback', insertProviderCapabilityStart);
const insertProviderCapabilitySource =
  insertProviderCapabilityStart >= 0 && insertProviderCapabilityEnd > insertProviderCapabilityStart
    ? controllerSource.slice(insertProviderCapabilityStart, insertProviderCapabilityEnd)
    : '';
assert.ok(
  controllerSource.includes('buildAtelierProviderCapabilityDiscoveryIntent({') &&
    controllerSource.includes('loadAtelierProviderCapabilities(intent.taskId)') &&
    providerCapabilityActionGuardsSource.includes('buildAtelierProviderCapabilityDiscoveryIntent') &&
    providerCapabilityActionGuardsSource.includes('taskId ? { taskId } : {}') &&
    providerCapabilityActionGuardsSource.includes('containsForbiddenAtelierProviderCapabilityPayloadActions(input.extraPayload)') &&
    insertProviderCapabilitySource.includes('buildAtelierProviderCapabilityCommandInsertIntent({ command })') &&
    insertProviderCapabilitySource.includes('appendAtelierProviderCapabilityCommand({') &&
    insertProviderCapabilitySource.includes('setComposerText((current) => {') &&
    insertProviderCapabilitySource.includes('setComposerRevision((current) => current + 1);') &&
    providerCapabilityActionGuardsSource.includes("ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities']") &&
    providerCapabilityActionGuardsSource.includes('ATELIER_PROVIDER_CAPABILITY_ALLOWED_SCOPES') &&
    providerCapabilityActionGuardsSource.includes('ATELIER_PROVIDER_CAPABILITY_INSERT_READ_ONLY') &&
    providerCapabilityActionGuardsSource.includes('ATELIER_PROVIDER_CAPABILITY_FORBIDDEN_ACTIONS') &&
    providerCapabilityActionGuardsSource.includes('containsForbiddenAtelierProviderCapabilityPayloadActions(input.extraPayload)') &&
    providerCapabilityActionGuardsSource.includes("command.startsWith('/')") &&
    providerCapabilityActionGuardsSource.includes('existing ? `${existing} ${command} ` : `${command} `') &&
    !insertProviderCapabilitySource.includes('sendAtelierMessage') &&
    !insertProviderCapabilitySource.includes('requestAtelierService') &&
    !insertProviderCapabilitySource.includes('sdk.invoke') &&
    !insertProviderCapabilitySource.includes('createAtelierProjectFromGoal') &&
    !insertProviderCapabilitySource.includes('atelier.provider.invoke') &&
    !insertProviderCapabilitySource.includes('skills.invoke') &&
    !insertProviderCapabilitySource.includes('provider.invoke') &&
    !insertProviderCapabilitySource.includes('runtime.invokeProvider') &&
    !insertProviderCapabilitySource.includes('runtime.execute') &&
    !insertProviderCapabilitySource.includes('orchestration.start') &&
    !insertProviderCapabilitySource.includes('model.run') &&
    !insertProviderCapabilitySource.includes('cli.execute') &&
    !insertProviderCapabilitySource.includes('gate.rerun') &&
    !insertProviderCapabilitySource.includes('artifact.') &&
    !insertProviderCapabilitySource.includes('input_snapshot.write') &&
    !insertProviderCapabilitySource.includes('inputSnapshot.write'),
  'Atelier official provider capability insert command must only edit composer text and must not send, invoke, run, or orchestrate',
);
assert.ok(
  controllerSource.includes('sendAtelierMessage') &&
    controllerSource.includes('sendingMessage') &&
    controllerSource.includes('composerText'),
  'Atelier official controller must expose composer state and send action',
);
const projectionEventHandlerStart = controllerSource.indexOf('(event) => {');
const projectionEventHandlerEnd = controllerSource.indexOf('\n        },\n        () => {', projectionEventHandlerStart);
const projectionEventHandlerSource =
  projectionEventHandlerStart >= 0 && projectionEventHandlerEnd > projectionEventHandlerStart
    ? controllerSource.slice(projectionEventHandlerStart, projectionEventHandlerEnd)
    : '';
assert.ok(
  projectionEventHandlerSource.includes('artifactPreviewInvalidation') &&
    projectionEventHandlerSource.includes("event.patch.kind === 'artifact.upsert'") &&
    projectionEventHandlerSource.includes('event.patch.taskId === current.selectedTaskId') &&
    projectionEventHandlerSource.includes('artifactBody: null') &&
    projectionEventHandlerSource.includes('artifactPreviewOpenResponse: null') &&
    projectionEventHandlerSource.includes("artifactPreviewOpenId: ''") &&
    projectionEventHandlerSource.includes("artifactPreviewOpenError: ''"),
  'Atelier official projection artifact.upsert events for the selected task must invalidate stale artifact body and preview open state',
);
const sendMessageStart = controllerSource.indexOf('const sendMessage = useCallback(async () => {');
const sendMessageEnd = controllerSource.indexOf('\n  const insertProviderCapabilityCommand', sendMessageStart);
const sendMessageSource =
  sendMessageStart >= 0 && sendMessageEnd > sendMessageStart
    ? controllerSource.slice(sendMessageStart, sendMessageEnd)
    : '';
const clientSendMessageStart = clientSource.indexOf('export async function sendAtelierMessage(input: {');
const clientSendMessageEnd = clientSource.indexOf('\nexport async function resolveAtelierDecision', clientSendMessageStart);
const clientSendMessageSource =
  clientSendMessageStart >= 0 && clientSendMessageEnd > clientSendMessageStart
    ? clientSource.slice(clientSendMessageStart, clientSendMessageEnd)
    : '';
assert.ok(
  sendMessageSource.includes('...stateFromAtelierSnapshot(snapshot)') &&
    sendMessageSource.includes('artifactBody: null') &&
    sendMessageSource.includes('artifactPreviewOpenResponse: null') &&
    sendMessageSource.includes("artifactPreviewOpenId: ''") &&
    sendMessageSource.includes("artifactPreviewOpenError: ''"),
  'Atelier official sendMessage success must clear stale artifact body and preview open state after applying a new projection snapshot',
);
assert.ok(
  sendMessageSource.includes('buildAtelierMessageSendIntent({') &&
    sendMessageSource.includes('taskId: state.selectedTaskId') &&
    sendMessageSource.includes('text: composerText') &&
    sendMessageSource.includes('pending: state.sendingMessage') &&
    sendMessageSource.includes('const snapshot = await sendAtelierMessage(intent);') &&
    messageActionGuardsSource.includes("ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.message.send']") &&
    messageActionGuardsSource.includes('ATELIER_MESSAGE_SEND_REQUIRED_FIELDS') &&
    messageActionGuardsSource.includes('ATELIER_MESSAGE_SEND_FORBIDDEN_APPLET_FIELDS') &&
    messageActionGuardsSource.includes('ATELIER_MESSAGE_SEND_FORBIDDEN_ACTIONS') &&
    messageActionGuardsSource.includes('containsForbiddenAtelierMessagePayloadFields(input.extraPayload)') &&
    messageActionGuardsSource.includes('intent: { taskId, text }') &&
    clientSendMessageSource.includes('taskId: string;') &&
    clientSendMessageSource.includes('text: string;') &&
    clientSendMessageSource.includes("requestAtelierService('/v1/messages', 'POST', input)") &&
    !sendMessageSource.includes('run:') &&
    !sendMessageSource.includes('provider.invoke') &&
    !sendMessageSource.includes('runtime.invokeProvider') &&
    !sendMessageSource.includes('runtime.execute') &&
    !sendMessageSource.includes('model.run') &&
    !sendMessageSource.includes('input_snapshot.write') &&
    !sendMessageSource.includes('inputSnapshot.write') &&
    !clientSendMessageSource.includes('run:') &&
    !clientSendMessageSource.includes('provider.invoke') &&
    !clientSendMessageSource.includes('runtime.invokeProvider') &&
    !clientSendMessageSource.includes('runtime.execute') &&
    !clientSendMessageSource.includes('model.run') &&
    !clientSendMessageSource.includes('input_snapshot.write') &&
    !clientSendMessageSource.includes('inputSnapshot.write') &&
    !messageActionGuardsSource.includes('provider.invoke(') &&
    !messageActionGuardsSource.includes('runtime.execute(') &&
    !messageActionGuardsSource.includes('model.run(') &&
    !messageActionGuardsSource.includes('HostStorage.write('),
  'Atelier official message send must stay text-only Station intent and must not expose run/provider/execute/input snapshot capabilities',
);
assert.ok(
  controllerSource.includes('createAtelierProjectFromGoal') &&
    controllerSource.includes('createProject') &&
    controllerSource.includes('goalDraft') &&
    controllerSource.includes('creatingProject') &&
    controllerSource.includes('selectedRunKind') &&
    controllerSource.includes('setSelectedRunKind') &&
    controllerSource.includes('useState<AtelierRunTargetKind>(ATELIER_DEFAULT_RUN_TARGET_KIND)') &&
    controllerSource.includes('certificationCreate.runKind ?? ATELIER_DEFAULT_RUN_TARGET_KIND') &&
    !controllerSource.includes('useState<AtelierRunTargetKind>(ATELIER_RUN_TARGET_KINDS[0])') &&
    !controllerSource.includes("certificationCreate.runKind ?? 'agents'") &&
    controllerSource.includes('selectedModel') &&
    controllerSource.includes('setSelectedModel') &&
    controllerSource.includes('useState<string>(ATELIER_DEFAULT_DIRECT_RUN_MODEL)') &&
    !controllerSource.includes("useState('openrouter-3o')") &&
      controllerSource.includes('useState<AtelierAgentFlowId>(ATELIER_DEFAULT_AGENT_FLOW_ID)') &&
      !controllerSource.includes('useState<AtelierAgentFlowId>(ATELIER_AGENT_FLOW_IDS[0])') &&
    controllerSource.includes('selectedFlowId') &&
    controllerSource.includes('setSelectedFlowId') &&
    controllerSource.includes('buildAtelierProjectCreateIntent') &&
    controllerSource.includes('createAtelierProjectFromGoal(intent)') &&
    projectCreateActionGuardsSource.includes("ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal']") &&
    projectCreateActionGuardsSource.includes('ATELIER_TASK_INTENT_PRESETS') &&
    projectCreateActionGuardsSource.includes('ATELIER_RUN_TARGET_KINDS') &&
    projectCreateActionGuardsSource.includes('ATELIER_DIRECT_RUN_MODELS') &&
    projectCreateActionGuardsSource.includes('ATELIER_AGENT_FLOW_IDS') &&
    projectCreateActionGuardsSource.includes('const agentFlowId: AtelierAgentFlowId | undefined = runKind ===') &&
    projectCreateActionGuardsSource.includes("if (runKind === 'model')") &&
    projectCreateActionGuardsSource.includes('if (!agentFlowId)') &&
    projectCreateActionGuardsSource.includes('flowId: agentFlowId') &&
    projectCreateActionGuardsSource.includes('containsForbiddenAtelierProjectCreatePayloadActions(input.extraPayload)'),
  'Atelier official controller must expose new task creation state, selected run target intent, selected model/flow, action, explicit generated run kind default, DirectRun model flowId omission, and pure project-create intent preflight',
);
assert.ok(
  controllerSource.includes('setAtelierTaskStatus') &&
    controllerSource.includes('purgeAtelierTask') &&
    controllerSource.includes('setTaskLifecycle') &&
    controllerSource.includes('taskActionId') &&
    controllerSource.includes('purgeConfirmTaskId'),
  'Atelier official controller must expose task lifecycle state, purge confirmation, and action',
);
assert.ok(
  controllerSource.includes('fetchAtelierArtifactBody') &&
    controllerSource.includes('fetchArtifactBody') &&
    controllerSource.includes('artifactBodyFetchId') &&
    controllerSource.includes('artifactBodyError') &&
    controllerSource.includes('buildAtelierArtifactBodyFetchIntent') &&
    artifactActionGuardsSource.includes('expectedHash: input.artifact.bodyHash') &&
    artifactActionGuardsSource.includes('input.artifact.bodyRef?.trim()') &&
    artifactActionGuardsSource.includes('isCanonicalAtelierArtifactBodyRef(bodyRef)'),
  'Atelier official artifact body fetch must expose explicit state and preflight canonical bodyRef/hash metadata through pure guards',
);
const artifactBodyFetchStart = controllerSource.indexOf('const fetchArtifactBody = useCallback');
const artifactBodyFetchEnd = controllerSource.indexOf('\n  const openArtifactPreview', artifactBodyFetchStart);
const artifactBodyFetchSource =
  artifactBodyFetchStart >= 0 && artifactBodyFetchEnd > artifactBodyFetchStart
    ? controllerSource.slice(artifactBodyFetchStart, artifactBodyFetchEnd)
    : '';
assert.ok(
  controllerSource.includes('const artifactBodyRequestSeq = useRef(0)') &&
    artifactBodyFetchSource.includes('const requestSeq = ++artifactBodyRequestSeq.current') &&
    artifactBodyFetchSource.includes('isCurrentAtelierArtifactRequest') &&
    artifactBodyFetchSource.includes('currentPendingKey: current.artifactBodyFetchId') &&
    artifactBodyFetchSource.includes('return current;') &&
    artifactBodyFetchSource.includes('artifactBody: response') &&
    artifactBodyFetchSource.includes('artifactBodyError: normalized.error'),
  'Atelier official artifact body fetch must ignore stale async success/error unless the current pending key still owns the request',
);
assert.ok(
  controllerSource.includes('openAtelierArtifactPreview') &&
    controllerSource.includes('openArtifactPreview') &&
    controllerSource.includes('artifactPreviewOpenId') &&
    controllerSource.includes('buildAtelierArtifactPreviewOpenIntent') &&
    artifactActionGuardsSource.includes('input.artifact.previewTarget') &&
    artifactActionGuardsSource.includes('sandboxRef') &&
      artifactActionGuardsSource.includes('const mode = previewTarget?.mode?.trim() || ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE') &&
    artifactActionGuardsSource.includes('isCanonicalAtelierSandboxRef(sandboxRef)') &&
    artifactActionGuardsSource.includes('isAtelierArtifactPreviewOpenMode(mode)') &&
      !controllerSource.includes("mode = previewTarget?.mode?.trim() || 'sandbox_manifest'") &&
      !controllerSource.includes('mode = previewTarget?.mode?.trim() || ATELIER_ARTIFACT_PREVIEW_OPEN_MODES[0]') &&
    !controllerSource.includes("mode !== 'sandbox_manifest'"),
  'Atelier official artifact preview open intent must keep canonical ref guard in pure guards',
);
const artifactPreviewOpenStart = controllerSource.indexOf('const openArtifactPreview = useCallback');
const artifactPreviewOpenEnd = controllerSource.indexOf('\n  const setTaskLifecycle', artifactPreviewOpenStart);
const artifactPreviewOpenSource =
  artifactPreviewOpenStart >= 0 && artifactPreviewOpenEnd > artifactPreviewOpenStart
    ? controllerSource.slice(artifactPreviewOpenStart, artifactPreviewOpenEnd)
    : '';
assert.ok(
  controllerSource.includes('const artifactPreviewOpenRequestSeq = useRef(0)') &&
    artifactPreviewOpenSource.includes('const requestSeq = ++artifactPreviewOpenRequestSeq.current') &&
    artifactPreviewOpenSource.includes('isCurrentAtelierArtifactRequest') &&
    artifactPreviewOpenSource.includes('currentPendingKey: current.artifactPreviewOpenId') &&
    artifactPreviewOpenSource.includes('return current;') &&
    artifactPreviewOpenSource.includes('artifactPreviewOpenResponse: response') &&
    artifactPreviewOpenSource.includes('artifactPreviewOpenError: normalized.error'),
  'Atelier official artifact preview open must ignore stale async success/error unless the current pending key still owns the request',
);
const requiredLocaleKeys = [
  'atelier.budget.title',
  'atelier.budget.unknown',
  'atelier.budget.money',
  'atelier.budget.readOnly',
  'atelier.composer.attachmentUnsupported',
  'atelier.composer.hint',
  'atelier.composer.placeholder',
  'atelier.composer.send',
  'atelier.composer.sending',
  'atelier.error.agentIdsRequired',
  'atelier.error.authDeniedDetail',
  'atelier.error.authDeniedTitle',
  'atelier.error.disconnectedDetail',
  'atelier.error.disconnectedTitle',
  'atelier.error.invalidArtifactPreviewOpenResponse',
  'atelier.recovery.retryBoundary',
  'atelier.goal.create',
  'atelier.goal.creating',
  'atelier.goal.hint',
  'atelier.goal.placeholder',
  'atelier.goal.title',
  'atelier.gate.artifacts',
  'atelier.gate.moreProjected',
  'atelier.gate.moreChecks',
  'atelier.gate.moreArtifacts',
  'atelier.feedback.copy',
  'atelier.feedback.memoryConfirmationRequired',
  'atelier.feedback.negative',
  'atelier.feedback.positive',
  'atelier.feedback.regenerate',
  'atelier.feedback.rerunConfirmationRequired',
  'atelier.feedback.submitting',
  'atelier.feedback.confirmMemory',
  'atelier.feedback.confirmingMemory',
  'atelier.feedback.memoryConfirmed',
  'atelier.feedback.confirmRerun',
  'atelier.feedback.confirmingRerun',
  'atelier.feedback.rerunConfirmed',
  'atelier.workspace.open',
  'atelier.workspace.openAction',
  'atelier.workspace.openBoundary',
  'atelier.workspace.opening',
  'atelier.workspace.openUnavailable',
  'atelier.runTarget.selector',
  'atelier.runTarget.model',
  'atelier.runTarget.agents',
  'atelier.runTarget.flowSelector',
  'atelier.runTarget.modelHint',
  'atelier.runTarget.agentsHint',
  'atelier.intentPreset.boundary',
  'atelier.nego.concern',
  'atelier.nego.evidence',
  'atelier.nego.moreVoices',
  'atelier.nego.converged',
  'atelier.nego.pending',
  'atelier.nego.voices',
  'atelier.task.archive',
  'atelier.task.delete',
  'atelier.task.purge',
  'atelier.task.confirmPurge',
  'atelier.task.purgeHint',
  'atelier.task.restore',
  'atelier.task.updating',
  'atelier.taskOrganizer.archived',
  'atelier.taskOrganizer.dag',
  'atelier.taskOrganizer.dagUnavailable',
  'atelier.taskOrganizer.deleted',
  'atelier.taskOrganizer.deletedHint',
  'atelier.taskOrganizer.flatList',
  'atelier.taskOrganizer.folders',
  'atelier.taskOrganizer.kanban',
  'atelier.taskOrganizer.kanbanUnavailable',
  'atelier.taskOrganizer.noActive',
  'atelier.taskOrganizer.readOnly',
  'atelier.taskOrganizer.uncategorized',
  'atelier.taskOrganizer.unavailableBoundary',
  'atelier.tool.outline',
  'atelier.tool.outlineUnsupported',
  'atelier.tool.terminal',
  'atelier.tool.terminalUnsupported',
  'atelier.section.taskGraph',
  'atelier.section.projectHealth',
  'atelier.projectHealth.blockers',
  'atelier.projectHealth.completion',
  'atelier.projectHealth.confirmed',
  'atelier.projectHealth.defects',
  'atelier.projectHealth.l0L1AcceptancePassed',
  'atelier.projectHealth.l2HumanSignoffComplete',
  'atelier.projectHealth.memoryCandidates',
  'atelier.projectHealth.memoryCandidatesGenerated',
  'atelier.projectHealth.milestones',
  'atelier.projectHealth.moreBlockers',
  'atelier.projectHealth.moreDefects',
  'atelier.projectHealth.moreMemoryCandidates',
  'atelier.projectHealth.moreMilestones',
  'atelier.projectHealth.morePolicyRules',
  'atelier.projectHealth.moreRisks',
  'atelier.projectHealth.no',
  'atelier.projectHealth.noBlockers',
  'atelier.projectHealth.noDefects',
  'atelier.projectHealth.noMemoryCandidates',
  'atelier.projectHealth.noMilestones',
  'atelier.projectHealth.noOpenBlockers',
  'atelier.projectHealth.noPolicyRules',
  'atelier.projectHealth.noRisks',
  'atelier.projectHealth.pending',
  'atelier.projectHealth.predicateRefs',
  'atelier.projectHealth.blockerRefs',
  'atelier.projectHealth.morePredicateRefs',
  'atelier.projectHealth.moreBlockerRefs',
  'atelier.projectHealth.policy',
  'atelier.projectHealth.policyRules',
  'atelier.projectHealth.readOnly',
  'atelier.projectHealth.residualRisksLogged',
  'atelier.projectHealth.risks',
  'atelier.projectHealth.signoff',
  'atelier.projectHealth.workspace',
  'atelier.projectHealth.yes',
  'atelier.taskGraph.readOnly',
  'atelier.taskGraph.empty',
  'atelier.taskGraph.artifactRefs',
  'atelier.taskGraph.gateRefs',
  'atelier.taskGraph.moreArtifactRefs',
  'atelier.taskGraph.moreGateRefs',
  'atelier.taskGraph.roots',
  'atelier.taskGraph.rootsEmpty',
  'atelier.taskGraph.rootDetail',
  'atelier.taskGraph.moreRoots',
  'atelier.taskGraph.edges',
  'atelier.taskGraph.edgesEmpty',
  'atelier.taskGraph.moreEdges',
  'atelier.taskGraph.parallelPolicy',
  'atelier.taskGraph.integratorBoundary',
  'atelier.taskGraph.moreProjected',
  'atelier.section.todos',
  'atelier.todos.moreProjected',
  'atelier.section.context',
  'atelier.context.files',
  'atelier.context.moreFiles',
  'atelier.context.moreOther',
  'atelier.context.other',
  'atelier.section.artifacts',
  'atelier.section.artifactTray',
  'atelier.section.gates',
  'atelier.section.skills',
  'atelier.skills.hint',
  'atelier.status.authDenied',
  'atelier.status.degraded',
  'atelier.status.degradedDetail',
  'atelier.status.degradedTitle',
  'atelier.status.disconnected',
  'atelier.status.reconciling',
  'atelier.status.reconcilingDetail',
  'atelier.status.reconcilingTitle',
  'atelier.decision.recommended',
  'atelier.decision.resolving',
  'atelier.decision.moreOptions',
  'atelier.diff.filesChanged',
  'atelier.diff.morePaths',
  'atelier.diff.paths',
  'atelier.stream.moreProjected',
  'atelier.todos.empty',
  'atelier.taskOrganizer.readOnly',
  'atelier.taskOrganizer.unavailableBoundary',
  'atelier.context.empty',
  'atelier.context.readOnly',
  'atelier.context.moreFiles',
  'atelier.artifacts.empty',
  'atelier.skills.moreCapabilities',
  'atelier.artifact.trayHint',
  'atelier.artifact.moreProjected',
  'atelier.artifact.morePaths',
  'atelier.artifact.bodyFetch',
  'atelier.artifact.bodyFetchError',
  'atelier.artifact.bodyFetching',
  'atelier.artifact.bodyPreview',
  'atelier.artifact.bodyPreviewTruncated',
  'atelier.artifact.moreBodyLines',
  'atelier.artifact.safeMarkdownPreview',
  'atelier.artifact.safeTextBoundary',
  'atelier.artifact.noPreview',
  'atelier.artifact.paths',
  'atelier.artifact.previewTarget',
  'atelier.artifact.previewTargetBody',
  'atelier.artifact.previewTargetKind',
  'atelier.artifact.previewTargetLabel',
  'atelier.artifact.previewTargetMode',
  'atelier.artifact.previewTargetSandbox',
  'atelier.artifact.previewOpen',
  'atelier.artifact.previewOpenError',
  'atelier.artifact.previewOpening',
  'atelier.artifact.previewOpenStatus',
  'atelier.artifact.richRenderer',
  'atelier.artifact.richRendererUnsupported',
  'atelier.artifact.runtimeLogs',
  'atelier.artifact.runtimeLogsUnsupported',
  'atelier.gates.empty',
  'atelier.skills.empty',
  'atelier.skills.loading',
];
for (const localeFile of localeFiles) {
  const locale = JSON.parse(fsSync.readFileSync(localeFile, 'utf8'));
  for (const key of requiredLocaleKeys) {
    assert.equal(typeof locale[key], 'string', `${path.relative(repoRoot, localeFile)} must define ${key}`);
  }
  assert.ok(
    locale['atelier.composer.attachmentUnsupported'].includes('Host Storage') &&
      locale['atelier.composer.attachmentUnsupported'].includes('Run input_snapshot'),
    `${path.relative(repoRoot, localeFile)} must disclose that attachment upload is not wired to Host Storage or Run input_snapshot`,
  );
  assert.ok(
    locale['atelier.context.readOnly'].includes('Station context projection') &&
      locale['atelier.context.readOnly'].includes('Workspace file discovery') &&
      locale['atelier.context.readOnly'].includes('Run input_snapshot') &&
      locale['atelier.context.readOnly'].includes('E2E'),
    `${path.relative(repoRoot, localeFile)} must disclose that Context is read-only Station projection and not Workspace discovery/input_snapshot E2E`,
  );
  assert.ok(
    locale['atelier.artifact.runtimeLogsUnsupported'].includes('Console Logs') &&
      locale['atelier.artifact.runtimeLogsUnsupported'].includes('Run runtime stream'),
    `${path.relative(repoRoot, localeFile)} must disclose that Console Logs are not wired to the real Run runtime stream`,
  );
  assert.ok(
    locale['atelier.artifact.moreBodyLines'].includes('safe text') &&
      locale['atelier.artifact.moreBodyLines'].includes('80'),
    `${path.relative(repoRoot, localeFile)} must disclose local 80-line safe text preview overflow`,
  );
  assert.ok(
    locale['atelier.artifact.richRendererUnsupported'].includes('iframe') &&
      locale['atelier.artifact.richRendererUnsupported'].includes('image') &&
      locale['atelier.artifact.richRendererUnsupported'].includes('html') &&
      locale['atelier.artifact.richRendererUnsupported'].includes('Host sandbox renderer runtime'),
    `${path.relative(repoRoot, localeFile)} must disclose that iframe/image/html rendering is not wired to Host sandbox renderer runtime`,
  );
  for (const artifactKind of ['Markdown', 'web', 'image', 'diff']) {
    assert.ok(
      locale['atelier.artifact.previewBoundary'].includes(artifactKind),
      `${path.relative(repoRoot, localeFile)} must disclose metadata-only artifact preview boundary for ${artifactKind}`,
    );
  }
  for (const requiredBoundaryTerm of ['metadata-only', 'safe text fetch', 'Host sandbox manifest intent', 'iframe', 'image', 'html', 'raw URL']) {
    assert.ok(
      locale['atelier.artifact.previewBoundary'].includes(requiredBoundaryTerm),
      `${path.relative(repoRoot, localeFile)} must disclose artifact preview boundary term ${requiredBoundaryTerm}`,
    );
  }
  assert.ok(
    locale['atelier.tool.terminalUnsupported'].includes('shell') &&
      locale['atelier.tool.terminalUnsupported'].includes('execute capability'),
    `${path.relative(repoRoot, localeFile)} must disclose that Terminal is not wired to shell or execute capability`,
  );
  assert.ok(
    locale['atelier.tool.outlineUnsupported'].includes('TaskGraph panel'),
    `${path.relative(repoRoot, localeFile)} must disclose that Outline is not wired to a real TaskGraph panel`,
  );
  assert.ok(
    locale['atelier.intentPreset.boundary'].includes('Station preset') &&
      locale['atelier.intentPreset.boundary'].includes('IDE mode') &&
      locale['atelier.intentPreset.boundary'].includes('workspace runtime'),
    `${path.relative(repoRoot, localeFile)} must disclose that Work/Code/Design only selects a declarative Station preset`,
  );
  assert.ok(
    locale['atelier.runTarget.modelHint'].includes('Station-owned DirectRun intent') &&
      locale['atelier.runTarget.modelHint'].includes('run.kind=model') &&
      locale['atelier.runTarget.modelHint'].includes('run.model') &&
      locale['atelier.runTarget.modelHint'].includes('invoke provider') &&
      locale['atelier.runTarget.modelHint'].includes('run model') &&
      locale['atelier.runTarget.modelHint'].includes('execute CLI') &&
      locale['atelier.runTarget.modelHint'].includes('E2E') &&
      locale['atelier.runTarget.agentsHint'].includes('Station-owned agents intent') &&
      locale['atelier.runTarget.agentsHint'].includes('run.kind=agents') &&
      locale['atelier.runTarget.agentsHint'].includes('run.agentIds') &&
      locale['atelier.runTarget.agentsHint'].includes('run.flowId') &&
      locale['atelier.runTarget.agentsHint'].includes('invoke provider') &&
      locale['atelier.runTarget.agentsHint'].includes('execute CLI') &&
      locale['atelier.runTarget.agentsHint'].includes('E2E'),
    `${path.relative(repoRoot, localeFile)} must disclose that run target selection is only a Station-owned model/agents intent`,
  );
  assert.ok(
    locale['atelier.workspace.openBoundary'].includes('Host intent') &&
      locale['atelier.workspace.openBoundary'].includes('pt-workspace://') &&
      locale['atelier.workspace.openBoundary'].includes('file') &&
      locale['atelier.workspace.openBoundary'].includes('shell') &&
      locale['atelier.workspace.openBoundary'].includes('execute') &&
      locale['atelier.workspace.openBoundary'].includes('E2E'),
    `${path.relative(repoRoot, localeFile)} must disclose that Open in IDE only submits a Host intent and does not expose file/shell/execute`,
  );
}
for (const forbiddenComposerCapability of [
  'atelier.attachment.upload',
  'attachment.upload',
  'HostStorage.write',
  'input_snapshot.write',
  'inputSnapshot.write',
]) {
  assert.ok(!pageSource.includes(forbiddenComposerCapability), `Atelier official composer must not expose ${forbiddenComposerCapability}`);
  assert.ok(!clientSource.includes(forbiddenComposerCapability), `Atelier official client must not expose ${forbiddenComposerCapability}`);
}
for (const forbiddenContextCapability of [
  'workspace.files.discover',
  'WorkspaceFileDiscovery',
  'input_snapshot.write',
  'inputSnapshot.write',
  'context.files.refresh',
]) {
  assert.ok(!pageSource.includes(forbiddenContextCapability), `Atelier official context panel must not expose ${forbiddenContextCapability}`);
  assert.ok(!clientSource.includes(forbiddenContextCapability), `Atelier official client must not expose ${forbiddenContextCapability}`);
}
for (const forbiddenRuntimeLogCapability of [
  'atelier.logs.subscribe',
  'atelier.console.subscribe',
  'console.logs.subscribe',
  'runtime.logs.subscribe',
  'RunRuntimeStream',
]) {
  assert.ok(!pageSource.includes(forbiddenRuntimeLogCapability), `Atelier official artifact preview must not expose ${forbiddenRuntimeLogCapability}`);
  assert.ok(!clientSource.includes(forbiddenRuntimeLogCapability), `Atelier official client must not expose ${forbiddenRuntimeLogCapability}`);
}
for (const forbiddenRichRendererCapability of [
  'atelier.artifact.rich.render',
  'artifact.rich.render',
  'iframe.render',
  'image.render',
  'html.render',
  'rawUrl.render',
]) {
  assert.ok(!pageSource.includes(forbiddenRichRendererCapability), `Atelier official artifact preview must not expose ${forbiddenRichRendererCapability}`);
  assert.ok(!clientSource.includes(forbiddenRichRendererCapability), `Atelier official client must not expose ${forbiddenRichRendererCapability}`);
}
for (const forbiddenTopbarCapability of [
  'atelier.terminal.open',
  'terminal.open',
  'shell.execute',
  'execute.shell',
  'atelier.outline.open',
  'outline.open',
]) {
  assert.ok(!pageSource.includes(forbiddenTopbarCapability), `Atelier official topbar tools must not expose ${forbiddenTopbarCapability}`);
  assert.ok(!clientSource.includes(forbiddenTopbarCapability), `Atelier official client must not expose ${forbiddenTopbarCapability}`);
}
for (const topbarFunctionName of ['TopbarToolBoundary', 'ToolBoundaryPill']) {
  const start = pageSource.indexOf(`function ${topbarFunctionName}`);
  const end = pageSource.indexOf('\nfunction ', start + 1);
  const functionSource = pageSource.slice(start, end === -1 ? undefined : end);
  assert.ok(start >= 0, `Atelier official page must render ${topbarFunctionName}`);
  for (const forbiddenHandler of ['bindtap=', 'onTap=', 'onClick=', 'onPress=']) {
    assert.ok(
      !functionSource.includes(forbiddenHandler),
      `Atelier official topbar boundary ${topbarFunctionName} must stay non-interactive and not expose ${forbiddenHandler}`,
    );
  }
}
for (const forbiddenIntentPresetCapability of [
  'atelier.ide.mode',
  'ide.mode.switch',
  'workspace.mode.switch',
  'runtime.mode.switch',
]) {
  assert.ok(!pageSource.includes(forbiddenIntentPresetCapability), `Atelier official intent preset selector must not expose ${forbiddenIntentPresetCapability}`);
  assert.ok(!clientSource.includes(forbiddenIntentPresetCapability), `Atelier official client must not expose ${forbiddenIntentPresetCapability}`);
}
for (const forbiddenWorkspaceOpenCapability of [
  'openExternalUrl',
  'shell.execute',
  'execute.shell',
  'file.open',
  'workspace.file.open',
]) {
  assert.ok(!pageSource.includes(forbiddenWorkspaceOpenCapability), `Atelier official workspace open UI must not expose ${forbiddenWorkspaceOpenCapability}`);
  assert.ok(!clientSource.includes(forbiddenWorkspaceOpenCapability), `Atelier official client must not expose ${forbiddenWorkspaceOpenCapability}`);
}
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-official-frontend-gate-'));
const outfile = path.join(tempDir, 'gate.mjs');
const mockSdkPath = path.join(tempDir, 'mock-applet-sdk.ts');
await fs.writeFile(
  mockSdkPath,
  `
export const sdk = {
  invoke: async (method, payload) => globalThis.__atelierOfficialFrontendGateInvoke(method, payload),
  events: {
    on: (topic, handler) => globalThis.__atelierOfficialFrontendGateEvents.on(topic, handler),
    subscribe: async (topic) => globalThis.__atelierOfficialFrontendGateEvents.subscribe(topic),
    unsubscribe: async (topic) => globalThis.__atelierOfficialFrontendGateEvents.unsubscribe(topic),
  },
  app: {
    getLaunchOptions: async () => globalThis.__atelierOfficialFrontendGateLaunchOptions,
  },
  network: {
    request: async (request) => globalThis.__atelierOfficialFrontendGateNetworkRequest(request),
  },
};
`,
);

const testSource = `
import assert from 'node:assert/strict';
import {
  classifyAtelierError,
  confirmAtelierMemoryCandidate,
  confirmAtelierFeedbackRerun,
  fetchAtelierArtifactBody,
  loadAtelierProviderCapabilities,
  openAtelierArtifactPreview,
  openAtelierWorkspace,
  subscribeAtelierProjectionEvents,
  submitAtelierFeedback,
} from './apps/applets/atelier/frontend/src/infrastructure/capability/atelierClient.ts';
import { isAtelierProjectionSnapshot, parseAtelierProjectionEvent } from './apps/applets/atelier/frontend/src/domain/projection.ts';
import {
  MAX_ATELIER_EVENT_KEYS,
  applyAtelierProjectionEvent,
  applyAtelierProjectionEventWithResult,
  stateFromAtelierSnapshot,
} from './apps/applets/atelier/frontend/src/application/projectionReducer.ts';
import { nextAtelierEventStreamRetryDelayMs } from './apps/applets/atelier/frontend/src/application/eventStreamRecovery.ts';
import { stateFromMalformedAtelierProjectionEvent } from './apps/applets/atelier/frontend/src/application/eventStreamEventGuard.ts';
import { deriveAtelierProjectionSubscriptionKey } from './apps/applets/atelier/frontend/src/application/atelierProjectionSubscriptionKey.ts';
import {
  stateFromAtelierError,
  stateFromAtelierEventStreamConnecting,
  stateFromAtelierEventStreamError,
} from './apps/applets/atelier/frontend/src/application/controllerTransitions.ts';
import { deriveOfficialRecoveryView, deriveOfficialStatusActionPolicy, isOfficialStatusActionPolicyConsistent } from './apps/applets/atelier/frontend/src/application/officialRecoveryView.ts';
import { deriveOfficialStatusPillView } from './apps/applets/atelier/frontend/src/application/statusPillView.ts';
import { atelierTypedRecoveryKind, deriveAtelierPageSurface, shouldRenderAtelierEmptyState } from './apps/applets/atelier/frontend/src/application/pageComposition.ts';
import { deriveAtelierViewStatus } from './apps/applets/atelier/frontend/src/application/viewStatus.ts';
import { ATELIER_PROJECTION_EVENT_TOPIC, ATELIER_PROJECTION_SUBSCRIPTION_METHOD, ATELIER_RECOVERY_RETRYABLE_KINDS, ATELIER_RECOVERY_TONE_BY_KIND, ATELIER_STATUS_NOTICE_KINDS, ATELIER_TYPED_RECOVERY_KINDS, ATELIER_VIEW_STATUSES, ATELIER_VIEW_SURFACE } from './apps/applets/atelier/frontend/src/domain/projection.contract.generated.ts';

const messagesZhCn = ${JSON.stringify(messagesZhCn, null, 2)};
const statusPillViewSource = ${JSON.stringify(statusPillViewSource)};
const centeredStateViewSource = ${JSON.stringify(centeredStateViewSource)};
const atelierViewStateTestSource = ${JSON.stringify(atelierViewStateTestSource)};
const controllerTransitionsTestSource = ${JSON.stringify(controllerTransitionsTestSource)};
const capabilityResponses = [];
const serviceBoundCapabilityRequests = new Map([
  ['atelier.provider.capabilities', { service: 'atelier', method: 'POST', path: '/v1/provider/capabilities' }],
  ['atelier.feedback.submit', { service: 'atelier', method: 'POST', path: '/v1/feedback/submit' }],
  ['atelier.memory.confirmCandidate', { service: 'atelier', method: 'POST', path: '/v1/memory/confirm-candidate' }],
  ['atelier.feedback.confirmRerun', { service: 'atelier', method: 'POST', path: '/v1/feedback/confirm-rerun' }],
  ['atelier.artifact.body.fetch', { service: 'atelier', method: 'POST', path: '/v1/artifact/body/fetch' }],
]);
globalThis.__atelierOfficialFrontendGateInvoke = async (method, payload) => {
  const next = capabilityResponses.shift();
  assert.ok(next, 'unexpected sdk.invoke call: ' + method);
  assert.ok(!serviceBoundCapabilityRequests.has(next.method), next.name + ' must use network.request service binding');
  assert.equal(method, next.method, next.name);
  assert.deepEqual(payload, next.payload, next.name);
  if (next.reject) {
    throw next.reject;
  }
  return next.response;
};
globalThis.__atelierOfficialFrontendGateNetworkRequest = async (request) => {
  const next = capabilityResponses.shift();
  assert.ok(next, 'unexpected network.request call: ' + JSON.stringify(request));
  const expected = serviceBoundCapabilityRequests.get(next.method);
  assert.ok(expected, next.name + ' must use sdk.invoke Host capability');
  assert.equal(request.service, expected.service, next.name);
  assert.equal(request.method, expected.method, next.name);
  assert.equal(request.path, expected.path, next.name);
  assert.deepEqual(request.body, next.payload, next.name);
  if (next.reject) {
    throw next.reject;
  }
  return { body: next.response };
};
globalThis.__atelierOfficialFrontendGateLaunchOptions = null;
const officialEventCalls = [];
const officialEventHandlers = new Map();
let officialEventSubscribeError = null;
let officialEventUnsubscribeError = null;
globalThis.__atelierOfficialFrontendGateEvents = {
  on(topic, handler) {
    officialEventCalls.push({ method: 'on', topic });
    officialEventHandlers.set(topic, handler);
    return () => {
      officialEventCalls.push({ method: 'off', topic });
      if (officialEventHandlers.get(topic) === handler) {
        officialEventHandlers.delete(topic);
      }
    };
  },
  async subscribe(topic) {
    officialEventCalls.push({ method: 'subscribe', topic });
    if (officialEventSubscribeError) {
      throw officialEventSubscribeError;
    }
  },
  async unsubscribe(topic) {
    officialEventCalls.push({ method: 'unsubscribe', topic });
    if (officialEventUnsubscribeError) {
      throw officialEventUnsubscribeError;
    }
  },
};

function resetOfficialEventHarness() {
  officialEventCalls.splice(0);
  officialEventHandlers.clear();
  officialEventSubscribeError = null;
  officialEventUnsubscribeError = null;
  globalThis.__ATELIER_PROJECTION_STREAM__ = undefined;
  globalThis.__atelierOfficialFrontendGateLaunchOptions = null;
}

async function assertCapabilityRejectsMalformedResponse(name, method, payload, response, invoke) {
  capabilityResponses.push({ name, method, payload, response });
  await assert.rejects(invoke, /atelier\\.error\\./, name);
  assert.equal(capabilityResponses.length, 0, name + ' consumed exactly one capability response');
}

function invokeMalformedCapabilityFixture(fixture) {
  switch (fixture.method) {
    case 'atelier.provider.capabilities':
      return () => loadAtelierProviderCapabilities(fixture.payload.taskId);
    case 'atelier.feedback.submit':
      return () => submitAtelierFeedback(fixture.payload);
    case 'atelier.memory.confirmCandidate':
      return () => confirmAtelierMemoryCandidate(fixture.payload);
    case 'atelier.feedback.confirmRerun':
      return () => confirmAtelierFeedbackRerun(fixture.payload);
    case 'atelier.workspace.open':
      return () => openAtelierWorkspace(fixture.payload);
    case 'atelier.artifact.body.fetch':
      return () => fetchAtelierArtifactBody(fixture.payload);
    case 'atelier.artifact.preview.open':
      return () => openAtelierArtifactPreview(fixture.payload);
    default:
      throw new Error('unhandled malformed capability fixture method: ' + fixture.method);
  }
}

for (const fixture of ${JSON.stringify(malformedResponseFixtures.providerCapabilities, null, 2)}) {
  await assertCapabilityRejectsMalformedResponse(
    fixture.officialName,
    fixture.method,
    fixture.payload,
    fixture.response,
    invokeMalformedCapabilityFixture(fixture),
  );
}
for (const fixture of ${JSON.stringify(malformedResponseFixtures.nonArtifactCapabilities, null, 2)}) {
  await assertCapabilityRejectsMalformedResponse(
    fixture.officialName,
    fixture.method,
    fixture.payload,
    fixture.response,
    invokeMalformedCapabilityFixture(fixture),
  );
}
for (const fixture of ${JSON.stringify(malformedResponseFixtures.artifactBody, null, 2)}) {
  await assertCapabilityRejectsMalformedResponse(
    fixture.officialName,
    fixture.method,
    fixture.payload,
    fixture.response,
    invokeMalformedCapabilityFixture(fixture),
  );
}
for (const fixture of ${JSON.stringify(malformedResponseFixtures.artifactPreview, null, 2)}) {
  await assertCapabilityRejectsMalformedResponse(
    fixture.officialName,
    fixture.method,
    fixture.payload,
    fixture.response,
    invokeMalformedCapabilityFixture(fixture),
  );
}

function snapshot() {
  return {
    version: ${JSON.stringify(contract.version)},
    selectedTaskId: 'task-1',
    workspace: {
      budgetSpent: 1,
      budgetCap: 10,
      budget: {
        status: 'warning',
        summary: '$1 / $10',
        decisionHint: 'Station will raise a budget DecisionCard before halt/resume.',
        dimensions: [
          { id: 'money', label: 'Money', used: 1, cap: 10, unit: '$', percent: 10, status: 'ok' },
          { id: 'tokens', label: 'Tokens', used: 78000, cap: 100000, unit: 'tok', percent: 78, status: 'warning' },
          { id: 'time', label: 'Time', used: 46, cap: 60, unit: 'min', percent: 77, status: 'warning' },
          { id: 'cap', label: 'Cap', used: 3, cap: 4, unit: 'runs', percent: 75, status: 'warning' },
        ],
      },
      model: 'openrouter-3o',
      tasks: [{ id: 'task-1', project: 'peers-touch', title: 'Official frontend gate', status: 'active' }],
      streams: { 'task-1': [{
        id: 'decision-1',
        kind: 'decision',
        question: 'Choose downgrade strategy?',
        spentSoFar: '$1.3 / $5',
        options: [{ text: 'cache + backoff', recommended: true }],
        rollbackImpact: 'adapter branch only',
      }] },
      todos: { 'task-1': [{ id: 'todo-1', text: 'Plan', status: 'running' }] },
      contexts: { 'task-1': { usedPct: 45, files: [{ name: 'apps/station/service.go', group: 'files' }] } },
      artifacts: {},
      gates: {},
    },
  };
}

resetOfficialEventHarness();
globalThis.__ATELIER_PROJECTION_STREAM__ = {
  agentId: 'official-created-task-agent',
  certificationMode: 'product-window-e2e',
  createGoal: ' build atelier ',
};
const officialCreatedTaskInitialSnapshot = snapshot();
officialCreatedTaskInitialSnapshot.selectedTaskId = '';
officialCreatedTaskInitialSnapshot.workspace.tasks = [];
officialCreatedTaskInitialSnapshot.workspace.streams = {};
officialCreatedTaskInitialSnapshot.workspace.todos = {};
officialCreatedTaskInitialSnapshot.workspace.contexts = {};
assert.deepEqual(
  deriveAtelierProjectionSubscriptionKey(officialCreatedTaskInitialSnapshot, ''),
  { hasSnapshot: true, taskId: '', afterEventSeq: 0 },
  'official controller subscription key starts empty before Station returns the created task snapshot',
);
capabilityResponses.push({
  name: 'official created-task lifecycle initial subscribe omits taskId before created snapshot',
  method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
  payload: { agentId: 'official-created-task-agent' },
  response: { accepted: true },
});
const releaseOfficialCreatedTaskInitialSubscription = await subscribeAtelierProjectionEvents(
  officialCreatedTaskInitialSnapshot,
  '',
  () => {},
);
releaseOfficialCreatedTaskInitialSubscription();

const officialCreatedTaskFreshSnapshot = snapshot();
officialCreatedTaskFreshSnapshot.selectedTaskId = 'created-task';
officialCreatedTaskFreshSnapshot.workspace.tasks = [
  { id: 'created-task', project: 'peers-touch', title: 'Created task', status: 'active' },
];
officialCreatedTaskFreshSnapshot.workspace.replay = {
  'created-task': {
    source: 'event-window',
    eventCount: 0,
    replayedEventCount: 0,
    nextEventSeq: 23,
    hasMore: false,
  },
};
const officialCreatedTaskFreshKey = deriveAtelierProjectionSubscriptionKey(
  officialCreatedTaskFreshSnapshot,
  '',
);
assert.deepEqual(
  officialCreatedTaskFreshKey,
  { hasSnapshot: true, taskId: 'created-task', afterEventSeq: 23 },
  'official controller subscription key retargets to the Station-created selected task and replay cursor',
);
capabilityResponses.push({
  name: 'official created-task lifecycle refreshed subscribe targets created task after fresh snapshot',
  method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
  payload: { agentId: 'official-created-task-agent', taskId: 'created-task', afterEventSeq: 23 },
  response: { accepted: true },
});
const releaseOfficialCreatedTaskFreshSubscription = await subscribeAtelierProjectionEvents(
  officialCreatedTaskFreshSnapshot,
  officialCreatedTaskFreshKey.taskId,
  () => {},
);
releaseOfficialCreatedTaskFreshSubscription();
assert.equal(capabilityResponses.length, 0, 'official created-task lifecycle consumed both subscription payloads');
assert.doesNotMatch(
  JSON.stringify(officialCreatedTaskFreshKey),
  /provider|gate|artifact|trace|checkpoint|resume|memory|input_snapshot|shell|file|run/,
  'official created-task subscription key must remain projection-only metadata',
);

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

function viewInput(overrides = {}) {
  return {
    loading: false,
    error: '',
    errorKind: '',
    eventStreamErrorKind: '',
    eventStreamState: 'live',
    taskCount: 1,
    replayHasMore: false,
    ...overrides,
  };
}

function typedRejectedErrorForGate(payload) {
  const method = typeof payload.method === 'string' && payload.method.length > 0
    ? payload.method
    : 'unknown';
  const reason = typeof payload.reason === 'string' && payload.reason.length > 0
    ? payload.reason
    : 'unknown rejection';
  return new Error('Atelier projection stream subscription ' + method + ' rejected: ' + reason, {
    cause: payload,
  });
}

function event(id, seq, patch, overrides = {}) {
  return {
    id,
    seq,
    taskId: patch.taskId,
    receivedAt: new Date().toISOString(),
    patch,
    ...overrides,
  };
}

resetOfficialEventHarness();
globalThis.__ATELIER_PROJECTION_STREAM__ = { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 7 };
capabilityResponses.push({
  name: 'official projection stream subscribe success',
  method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
  payload: { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 7 },
  response: { accepted: true },
});
const receivedOfficialEvents = [];
const releaseOfficialProjectionEvents = await subscribeAtelierProjectionEvents(
  snapshot(),
  'task-1',
  (projectionEvent) => receivedOfficialEvents.push(projectionEvent.id),
);
assert.deepEqual(
  officialEventCalls.map((call) => call.method + ':' + call.topic),
  ['on:' + ATELIER_PROJECTION_EVENT_TOPIC, 'subscribe:' + ATELIER_PROJECTION_EVENT_TOPIC],
  'official projection subscription must register local topic before Station stream subscribe',
);
officialEventHandlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.(event('evt-official-subscribe-success', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'block-official-subscribe-success', kind: 'agent', text: 'live', done: true }],
}));
assert.deepEqual(receivedOfficialEvents, ['evt-official-subscribe-success']);
releaseOfficialProjectionEvents();
assert.deepEqual(
  officialEventCalls.map((call) => call.method + ':' + call.topic),
  [
    'on:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'subscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'off:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'unsubscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
  ],
  'official projection subscription release must remove local topic handler and request Host unsubscribe',
);
assert.equal(officialEventHandlers.has(ATELIER_PROJECTION_EVENT_TOPIC), false);
assert.equal(capabilityResponses.length, 0, 'official projection subscription success consumed Station stream subscribe invoke');

  resetOfficialEventHarness();
  globalThis.__ATELIER_PROJECTION_STREAM__ = { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 7 };
  officialEventSubscribeError = new Error('Host event topic subscribe rejected');
  await assert.rejects(
    () => subscribeAtelierProjectionEvents(snapshot(), 'task-1', (projectionEvent) => receivedOfficialEvents.push(projectionEvent.id)),
    /Host event topic subscribe rejected/,
    'official projection Host event-topic subscribe rejection must surface to the controller',
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    officialEventCalls.map((call) => call.method + ':' + call.topic),
    [
      'on:' + ATELIER_PROJECTION_EVENT_TOPIC,
      'subscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
      'off:' + ATELIER_PROJECTION_EVENT_TOPIC,
      'unsubscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
    ],
    'official projection Host event-topic subscribe rejection must remove local handler and request Host unsubscribe',
  );
  assert.equal(officialEventHandlers.has(ATELIER_PROJECTION_EVENT_TOPIC), false);
  officialEventHandlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.(event('evt-after-rejected-official-host-topic-subscribe', 2, {
    kind: 'stream.append',
    taskId: 'task-1',
    blocks: [{ id: 'block-after-rejected-official-host-topic-subscribe', kind: 'agent', text: 'must not deliver', done: true }],
  }));
  assert.equal(
    receivedOfficialEvents.includes('evt-after-rejected-official-host-topic-subscribe'),
    false,
    'official projection Host event-topic subscribe rejection must not keep delivering Host events after local cleanup',
  );
  assert.equal(
    capabilityResponses.length,
    0,
    'official projection Host event-topic subscribe rejection must not call Station stream subscribe',
  );

  resetOfficialEventHarness();
  globalThis.__ATELIER_PROJECTION_STREAM__ = { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 7 };
  capabilityResponses.push({
    name: 'official projection typed subscription-rejected event after subscribe',
    method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
    payload: { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 7 },
    response: { accepted: true },
  });
  const typedRejectedReceivedEvents = [];
  const typedRejectedErrors = [];
  await subscribeAtelierProjectionEvents(
    snapshot(),
    'task-1',
    (projectionEvent) => typedRejectedReceivedEvents.push(projectionEvent.id),
    undefined,
    (error) => typedRejectedErrors.push(error),
  );
  officialEventHandlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.({
    kind: 'atelier.projection.subscription-rejected',
    method: 'events.subscribe',
    code: 'FORBIDDEN',
    reason: 'opaque Host rejected Atelier projection topic',
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(typedRejectedErrors.length, 1);
  assert.equal(
    typedRejectedErrors[0].message,
    'Atelier projection stream subscription events.subscribe rejected: opaque Host rejected Atelier projection topic',
  );
  assert.deepEqual(
    classifyAtelierError(typedRejectedErrors[0]),
    { key: 'atelier.error.authDenied', kind: 'auth-denied' },
    'official typed subscription-rejected event must preserve structured code for recovery taxonomy',
  );
  assert.deepEqual(typedRejectedReceivedEvents, []);
  assert.deepEqual(
    officialEventCalls.map((call) => call.method + ':' + call.topic),
    [
      'on:' + ATELIER_PROJECTION_EVENT_TOPIC,
      'subscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
      'off:' + ATELIER_PROJECTION_EVENT_TOPIC,
      'unsubscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
    ],
    'official typed subscription-rejected event must remove local handler and request Host unsubscribe',
  );
  assert.equal(officialEventHandlers.has(ATELIER_PROJECTION_EVENT_TOPIC), false);
  officialEventHandlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.(event('evt-after-official-typed-subscription-rejected', 2, {
    kind: 'stream.append',
    taskId: 'task-1',
    blocks: [{ id: 'block-after-official-typed-subscription-rejected', kind: 'agent', text: 'must not deliver', done: true }],
  }));
  assert.deepEqual(
    typedRejectedReceivedEvents,
    [],
    'official typed subscription-rejected event must not keep delivering Host events after local cleanup',
  );
  assert.equal(
    capabilityResponses.length,
    0,
    'official typed subscription-rejected event case consumed Station stream subscribe before Host rejection payload',
  );

for (const [name, payload, expected] of [
  ['official typed subscription-rejected forbidden code hard-stops controller recovery', {
    kind: 'atelier.projection.subscription-rejected',
    method: 'events.subscribe',
    code: 'FORBIDDEN',
    reason: 'opaque Host rejected Atelier projection topic',
  }, {
    errorKind: 'auth-denied',
    viewStatus: 'auth-denied',
    retryDelayMs: null,
  }],
  ['official typed subscription-rejected connection closed code retries controller recovery', {
    kind: 'atelier.projection.subscription-rejected',
    method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
    code: 'CONNECTION_CLOSED',
    reason: 'opaque Host closed Atelier projection stream',
  }, {
    errorKind: 'disconnected',
    viewStatus: 'disconnected',
    retryDelayMs: 500,
  }],
]) {
  const typedRejectedError = typedRejectedErrorForGate(payload);
  const transition = stateFromAtelierEventStreamError(typedRejectedError, true);
  const transitionErrorKind = 'eventStreamErrorKind' in transition ? transition.eventStreamErrorKind : transition.errorKind;
  assert.equal(transitionErrorKind, expected.errorKind, name + ' classified typed subscription rejection');
  assert.equal(
    nextAtelierEventStreamRetryDelayMs({
      attempt: 0,
      errorKind: transitionErrorKind,
      hasSnapshot: true,
    }),
    expected.retryDelayMs,
    name + ' applied controller retry policy',
  );
  assert.equal(
    deriveAtelierViewStatus({
      loading: transition.loading,
      error: 'error' in transition ? transition.error : '',
      errorKind: 'errorKind' in transition ? transition.errorKind : '',
      eventStreamErrorKind: 'eventStreamErrorKind' in transition ? transition.eventStreamErrorKind : '',
      eventStreamState: 'eventStreamState' in transition ? transition.eventStreamState : 'idle',
      replayHasMore: false,
      taskCount: 1,
    }),
    expected.viewStatus,
    name + ' derived controller view status',
  );
}

for (const [name, explicitAfterEventSeq, snapshotAfterEventSeq, expectedPayload] of [
  [
    'official projection stream omits explicit zero cursor and uses snapshot replay cursor',
    0,
    9,
    { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 9 },
  ],
  [
    'official projection stream omits explicit negative cursor and uses snapshot replay cursor',
    -3,
    11,
    { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 11 },
  ],
  [
    'official projection stream omits explicit decimal cursor and uses snapshot replay cursor',
    '1.5',
    12,
    { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 12 },
  ],
  [
    'official projection stream omits unsafe integer cursor and uses snapshot replay cursor',
    '9007199254740992',
    13,
    { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 13 },
  ],
]) {
  resetOfficialEventHarness();
  globalThis.__ATELIER_PROJECTION_STREAM__ = { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: explicitAfterEventSeq };
  const cursorSnapshot = snapshot();
  cursorSnapshot.workspace.replay = {
    'task-1': {
      source: 'event-window',
      eventCount: 0,
      replayedEventCount: 0,
      nextEventSeq: snapshotAfterEventSeq,
      hasMore: false,
    },
  };
  capabilityResponses.push({
    name,
    method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
    payload: expectedPayload,
    response: { accepted: true },
  });
  const releaseCursorSubscription = await subscribeAtelierProjectionEvents(cursorSnapshot, 'task-1', () => {});
  releaseCursorSubscription();
  assert.equal(capabilityResponses.length, 0, name + ' consumed Station stream subscribe invoke');
}

for (const [name, configureLaunchSource, expectedPayload] of [
  [
    'official projection stream trims generated agentIds[0] fallback and taskId',
    () => {
      globalThis.__ATELIER_PROJECTION_STREAM__ = {
        agentId: '   ',
        agentIds: [' agent-fallback ', 'agent-ignored'],
        taskId: ' task-from-global ',
        afterEventSeq: 12,
      };
    },
    { agentId: 'agent-fallback', taskId: 'task-from-global', afterEventSeq: 12 },
  ],
  [
    'official projection stream trims launch option agentId and taskId',
    () => {
      globalThis.__atelierOfficialFrontendGateLaunchOptions = {
        query: {
          agentId: ' launch-agent ',
          taskId: ' launch-task ',
          afterEventSeq: 13,
        },
      };
    },
    { agentId: 'launch-agent', taskId: 'launch-task', afterEventSeq: 13 },
  ],
  [
    'official projection stream trims launch option generated agentIds[0] fallback',
    () => {
      globalThis.__atelierOfficialFrontendGateLaunchOptions = {
        query: {
          agentId: '   ',
          agentIds: [' launch-agent-fallback ', 'launch-agent-ignored'],
          taskId: ' launch-task-from-list ',
          afterEventSeq: 16,
        },
      };
    },
    { agentId: 'launch-agent-fallback', taskId: 'launch-task-from-list', afterEventSeq: 16 },
  ],
  [
    'official projection stream trims launch option cursor string',
    () => {
      globalThis.__atelierOfficialFrontendGateLaunchOptions = {
        query: {
          agentId: ' launch-agent ',
          taskId: ' launch-task ',
          afterEventSeq: ' 14 ',
        },
      };
    },
    { agentId: 'launch-agent', taskId: 'launch-task', afterEventSeq: 14 },
  ],
]) {
  resetOfficialEventHarness();
  configureLaunchSource();
  capabilityResponses.push({
    name,
    method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
    payload: expectedPayload,
    response: { accepted: true },
  });
  const releaseNormalizedSubscription = await subscribeAtelierProjectionEvents(snapshot(), 'task-1', () => {});
  releaseNormalizedSubscription();
  assert.equal(capabilityResponses.length, 0, name + ' consumed normalized Station stream subscribe invoke');
}

for (const [name, source, selectedTaskId, configureSnapshot, expectedPayload] of [
  [
    'official projection stream prefers product-window created selected task before explicit taskId',
    {
      agentId: 'agent-task-source',
      certificationMode: 'product-window-e2e',
      createGoal: ' build atelier ',
      taskId: ' explicit-task-ignored ',
    },
    'controller-task-ignored',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'created-task';
      projectionSnapshot.workspace.tasks = [
        { id: 'created-task', project: 'peers-touch', title: 'Created task', status: 'active' },
        { id: 'explicit-task-ignored', project: 'peers-touch', title: 'Explicit ignored', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'created-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 21,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'created-task', afterEventSeq: 21 },
  ],
  [
    'official projection stream trims product-window created selected task fallback',
    {
      agentId: 'agent-task-source',
      certificationMode: 'product-window-e2e',
      createGoal: ' build atelier ',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = ' created-trimmed-task ';
      projectionSnapshot.workspace.tasks = [
        { id: 'created-trimmed-task', project: 'peers-touch', title: 'Created trimmed task', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'created-trimmed-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 37,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'created-trimmed-task', afterEventSeq: 37 },
  ],
  [
    'official projection stream ignores blank createGoal certification task and uses explicit taskId',
    {
      agentId: 'agent-task-source',
      certificationMode: 'product-window-e2e',
      createGoal: '   ',
      taskId: ' explicit-task ',
    },
    'created-task-ignored',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'created-task-ignored';
      projectionSnapshot.workspace.tasks = [
        { id: 'created-task-ignored', project: 'peers-touch', title: 'Created task ignored', status: 'active' },
        { id: 'explicit-task', project: 'peers-touch', title: 'Explicit task', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'explicit-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 33,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'explicit-task', afterEventSeq: 33 },
  ],
  [
    'official projection stream ignores non-product certification task and uses explicit taskId',
    {
      agentId: 'agent-task-source',
      certificationMode: 'local-smoke',
      createGoal: ' build atelier ',
      taskId: ' explicit-task ',
    },
    'created-task-ignored',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'created-task-ignored';
      projectionSnapshot.workspace.tasks = [
        { id: 'created-task-ignored', project: 'peers-touch', title: 'Created task ignored', status: 'active' },
        { id: 'explicit-task', project: 'peers-touch', title: 'Explicit task', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'explicit-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 35,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'explicit-task', afterEventSeq: 35 },
  ],
  [
    'official projection stream uses explicit taskId before controller selected task',
    {
      agentId: 'agent-task-source',
      taskId: ' explicit-task ',
    },
    'controller-task-ignored',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'snapshot-selected-task-ignored';
      projectionSnapshot.workspace.tasks = [
        { id: 'explicit-task', project: 'peers-touch', title: 'Explicit task', status: 'active' },
        { id: 'controller-task-ignored', project: 'peers-touch', title: 'Controller ignored', status: 'active' },
        { id: 'snapshot-selected-task-ignored', project: 'peers-touch', title: 'Snapshot selected ignored', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'explicit-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 29,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'explicit-task', afterEventSeq: 29 },
  ],
  [
    'official projection stream ignores blank explicit taskId and uses controller selected task',
    {
      agentId: 'agent-task-source',
      taskId: '   ',
    },
    'controller-task',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'snapshot-selected-task-ignored';
      projectionSnapshot.workspace.tasks = [
        { id: 'controller-task', project: 'peers-touch', title: 'Controller selected', status: 'active' },
        { id: 'snapshot-selected-task-ignored', project: 'peers-touch', title: 'Snapshot selected ignored', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'controller-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 31,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'controller-task', afterEventSeq: 31 },
  ],
  [
    'official projection stream uses controller selected task before snapshot selected task',
    {
      agentId: 'agent-task-source',
    },
    'controller-task',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'snapshot-selected-task';
      projectionSnapshot.workspace.tasks = [
        { id: 'snapshot-selected-task', project: 'peers-touch', title: 'Snapshot selected', status: 'active' },
        { id: 'controller-task', project: 'peers-touch', title: 'Controller selected', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'controller-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 22,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'controller-task', afterEventSeq: 22 },
  ],
  [
    'official projection stream trims controller selected task fallback',
    {
      agentId: 'agent-task-source',
    },
    ' controller-trimmed-task ',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'snapshot-selected-task-ignored';
      projectionSnapshot.workspace.tasks = [
        { id: 'controller-trimmed-task', project: 'peers-touch', title: 'Controller trimmed', status: 'active' },
        { id: 'snapshot-selected-task-ignored', project: 'peers-touch', title: 'Snapshot selected ignored', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'controller-trimmed-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 38,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'controller-trimmed-task', afterEventSeq: 38 },
  ],
  [
    'official projection stream ignores blank controller selected task and uses snapshot selected task',
    {
      agentId: 'agent-task-source',
    },
    '   ',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'snapshot-selected-after-blank-controller';
      projectionSnapshot.workspace.tasks = [
        { id: 'snapshot-first-task-ignored', project: 'peers-touch', title: 'Snapshot first ignored', status: 'active' },
        { id: 'snapshot-selected-after-blank-controller', project: 'peers-touch', title: 'Snapshot selected after blank controller', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'snapshot-selected-after-blank-controller': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 45,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'snapshot-selected-after-blank-controller', afterEventSeq: 45 },
  ],
  [
    'official projection stream uses snapshot selected task before snapshot first task',
    {
      agentId: 'agent-task-source',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'snapshot-selected-task';
      projectionSnapshot.workspace.tasks = [
        { id: 'snapshot-first-task', project: 'peers-touch', title: 'Snapshot first', status: 'active' },
        { id: 'snapshot-selected-task', project: 'peers-touch', title: 'Snapshot selected', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'snapshot-selected-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 23,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'snapshot-selected-task', afterEventSeq: 23 },
  ],
  [
    'official projection stream trims snapshot selected task fallback',
    {
      agentId: 'agent-task-source',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = ' snapshot-selected-trimmed-task ';
      projectionSnapshot.workspace.tasks = [
        { id: 'snapshot-first-task-ignored', project: 'peers-touch', title: 'Snapshot first ignored', status: 'active' },
        { id: 'snapshot-selected-trimmed-task', project: 'peers-touch', title: 'Snapshot selected trimmed', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'snapshot-selected-trimmed-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 39,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'snapshot-selected-trimmed-task', afterEventSeq: 39 },
  ],
  [
    'official projection stream ignores blank snapshot selected task and uses snapshot first task',
    {
      agentId: 'agent-task-source',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = '   ';
      projectionSnapshot.workspace.tasks = [
        { id: 'snapshot-first-after-blank-snapshot', project: 'peers-touch', title: 'Snapshot first after blank snapshot', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'snapshot-first-after-blank-snapshot': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 46,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'snapshot-first-after-blank-snapshot', afterEventSeq: 46 },
  ],
  [
    'official projection stream uses snapshot first task when selected tasks are empty',
    {
      agentId: 'agent-task-source',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = '';
      projectionSnapshot.workspace.tasks = [
        { id: 'snapshot-first-task', project: 'peers-touch', title: 'Snapshot first', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'snapshot-first-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 24,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'snapshot-first-task', afterEventSeq: 24 },
  ],
  [
    'official projection stream trims snapshot first task fallback',
    {
      agentId: 'agent-task-source',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = '';
      projectionSnapshot.workspace.tasks = [
        { id: ' snapshot-first-trimmed-task ', project: 'peers-touch', title: 'Snapshot first trimmed', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'snapshot-first-trimmed-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 40,
          hasMore: false,
        },
      };
    },
    { agentId: 'agent-task-source', taskId: 'snapshot-first-trimmed-task', afterEventSeq: 40 },
  ],
]) {
  resetOfficialEventHarness();
  globalThis.__ATELIER_PROJECTION_STREAM__ = source;
  const taskSourceSnapshot = snapshot();
  configureSnapshot(taskSourceSnapshot);
  capabilityResponses.push({
    name,
    method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
    payload: expectedPayload,
    response: { accepted: true },
  });
  const releaseTaskFallbackSubscription = await subscribeAtelierProjectionEvents(taskSourceSnapshot, selectedTaskId, () => {});
  releaseTaskFallbackSubscription();
  assert.equal(capabilityResponses.length, 0, name + ' consumed generated task source priority Station stream subscribe invoke');
}

for (const [name, query, selectedTaskId, configureSnapshot, expectedPayload] of [
  [
    'official projection stream launch options prefer product-window created selected task before explicit taskId',
    {
      agentId: 'launch-agent-task-source',
      certificationMode: 'product-window-e2e',
      createGoal: ' build atelier ',
      taskId: ' launch-explicit-task-ignored ',
    },
    'launch-controller-task-ignored',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'launch-created-task';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-created-task', project: 'peers-touch', title: 'Launch created task', status: 'active' },
        { id: 'launch-explicit-task-ignored', project: 'peers-touch', title: 'Launch explicit ignored', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-created-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 25,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-created-task', afterEventSeq: 25 },
  ],
  [
    'official projection stream launch options trim product-window created selected task fallback',
    {
      agentId: 'launch-agent-task-source',
      certificationMode: 'product-window-e2e',
      createGoal: ' build atelier ',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = ' launch-created-trimmed-task ';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-created-trimmed-task', project: 'peers-touch', title: 'Launch created trimmed task', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-created-trimmed-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 41,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-created-trimmed-task', afterEventSeq: 41 },
  ],
  [
    'official projection stream launch options ignore blank createGoal certification task and use explicit taskId',
    {
      agentId: 'launch-agent-task-source',
      certificationMode: 'product-window-e2e',
      createGoal: '   ',
      taskId: ' launch-explicit-task ',
    },
    'launch-created-task-ignored',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'launch-created-task-ignored';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-created-task-ignored', project: 'peers-touch', title: 'Launch created task ignored', status: 'active' },
        { id: 'launch-explicit-task', project: 'peers-touch', title: 'Launch explicit task', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-explicit-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 34,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-explicit-task', afterEventSeq: 34 },
  ],
  [
    'official projection stream launch options ignore non-product certification task and use explicit taskId',
    {
      agentId: 'launch-agent-task-source',
      certificationMode: 'local-smoke',
      createGoal: ' build atelier ',
      taskId: ' launch-explicit-task ',
    },
    'launch-created-task-ignored',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'launch-created-task-ignored';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-created-task-ignored', project: 'peers-touch', title: 'Launch created task ignored', status: 'active' },
        { id: 'launch-explicit-task', project: 'peers-touch', title: 'Launch explicit task', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-explicit-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 36,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-explicit-task', afterEventSeq: 36 },
  ],
  [
    'official projection stream launch options use explicit taskId before controller selected task',
    {
      agentId: 'launch-agent-task-source',
      taskId: ' launch-explicit-task ',
    },
    'launch-controller-task-ignored',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'launch-snapshot-selected-task-ignored';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-explicit-task', project: 'peers-touch', title: 'Launch explicit task', status: 'active' },
        { id: 'launch-controller-task-ignored', project: 'peers-touch', title: 'Launch controller ignored', status: 'active' },
        { id: 'launch-snapshot-selected-task-ignored', project: 'peers-touch', title: 'Launch snapshot selected ignored', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-explicit-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 30,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-explicit-task', afterEventSeq: 30 },
  ],
  [
    'official projection stream launch options ignore blank explicit taskId and use controller selected task',
    {
      agentId: 'launch-agent-task-source',
      taskId: '   ',
    },
    'launch-controller-task',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'launch-snapshot-selected-task-ignored';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-controller-task', project: 'peers-touch', title: 'Launch controller selected', status: 'active' },
        { id: 'launch-snapshot-selected-task-ignored', project: 'peers-touch', title: 'Launch snapshot selected ignored', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-controller-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 32,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-controller-task', afterEventSeq: 32 },
  ],
  [
    'official projection stream launch options use controller selected task before snapshot selected task',
    {
      agentId: 'launch-agent-task-source',
    },
    'launch-controller-task',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'launch-snapshot-selected-task';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-snapshot-selected-task', project: 'peers-touch', title: 'Launch snapshot selected', status: 'active' },
        { id: 'launch-controller-task', project: 'peers-touch', title: 'Launch controller selected', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-controller-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 26,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-controller-task', afterEventSeq: 26 },
  ],
  [
    'official projection stream launch options trim controller selected task fallback',
    {
      agentId: 'launch-agent-task-source',
    },
    ' launch-controller-trimmed-task ',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'launch-snapshot-selected-task-ignored';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-controller-trimmed-task', project: 'peers-touch', title: 'Launch controller trimmed', status: 'active' },
        { id: 'launch-snapshot-selected-task-ignored', project: 'peers-touch', title: 'Launch snapshot selected ignored', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-controller-trimmed-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 42,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-controller-trimmed-task', afterEventSeq: 42 },
  ],
  [
    'official projection stream launch options ignore blank controller selected task and use snapshot selected task',
    {
      agentId: 'launch-agent-task-source',
    },
    '   ',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'launch-snapshot-selected-after-blank-controller';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-snapshot-first-task-ignored', project: 'peers-touch', title: 'Launch snapshot first ignored', status: 'active' },
        { id: 'launch-snapshot-selected-after-blank-controller', project: 'peers-touch', title: 'Launch snapshot selected after blank controller', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-snapshot-selected-after-blank-controller': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 47,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-snapshot-selected-after-blank-controller', afterEventSeq: 47 },
  ],
  [
    'official projection stream launch options use snapshot selected task before snapshot first task',
    {
      agentId: 'launch-agent-task-source',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = 'launch-snapshot-selected-task';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-snapshot-first-task', project: 'peers-touch', title: 'Launch snapshot first', status: 'active' },
        { id: 'launch-snapshot-selected-task', project: 'peers-touch', title: 'Launch snapshot selected', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-snapshot-selected-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 27,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-snapshot-selected-task', afterEventSeq: 27 },
  ],
  [
    'official projection stream launch options trim snapshot selected task fallback',
    {
      agentId: 'launch-agent-task-source',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = ' launch-snapshot-selected-trimmed-task ';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-snapshot-first-task-ignored', project: 'peers-touch', title: 'Launch snapshot first ignored', status: 'active' },
        { id: 'launch-snapshot-selected-trimmed-task', project: 'peers-touch', title: 'Launch snapshot selected trimmed', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-snapshot-selected-trimmed-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 43,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-snapshot-selected-trimmed-task', afterEventSeq: 43 },
  ],
  [
    'official projection stream launch options ignore blank snapshot selected task and use snapshot first task',
    {
      agentId: 'launch-agent-task-source',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = '   ';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-snapshot-first-after-blank-snapshot', project: 'peers-touch', title: 'Launch snapshot first after blank snapshot', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-snapshot-first-after-blank-snapshot': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 48,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-snapshot-first-after-blank-snapshot', afterEventSeq: 48 },
  ],
  [
    'official projection stream launch options use snapshot first task when selected tasks are empty',
    {
      agentId: 'launch-agent-task-source',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = '';
      projectionSnapshot.workspace.tasks = [
        { id: 'launch-snapshot-first-task', project: 'peers-touch', title: 'Launch snapshot first', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-snapshot-first-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 28,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-snapshot-first-task', afterEventSeq: 28 },
  ],
  [
    'official projection stream launch options trim snapshot first task fallback',
    {
      agentId: 'launch-agent-task-source',
    },
    '',
    (projectionSnapshot) => {
      projectionSnapshot.selectedTaskId = '';
      projectionSnapshot.workspace.tasks = [
        { id: ' launch-snapshot-first-trimmed-task ', project: 'peers-touch', title: 'Launch snapshot first trimmed', status: 'active' },
      ];
      projectionSnapshot.workspace.replay = {
        'launch-snapshot-first-trimmed-task': {
          source: 'event-window',
          eventCount: 0,
          replayedEventCount: 0,
          nextEventSeq: 44,
          hasMore: false,
        },
      };
    },
    { agentId: 'launch-agent-task-source', taskId: 'launch-snapshot-first-trimmed-task', afterEventSeq: 44 },
  ],
]) {
  resetOfficialEventHarness();
  globalThis.__atelierOfficialFrontendGateLaunchOptions = { query };
  const launchTaskSourceSnapshot = snapshot();
  configureSnapshot(launchTaskSourceSnapshot);
  capabilityResponses.push({
    name,
    method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
    payload: expectedPayload,
    response: { accepted: true },
  });
  const releaseLaunchTaskFallbackSubscription = await subscribeAtelierProjectionEvents(launchTaskSourceSnapshot, selectedTaskId, () => {});
  releaseLaunchTaskFallbackSubscription();
  assert.equal(capabilityResponses.length, 0, name + ' consumed launch options generated task source priority Station stream subscribe invoke');
}

resetOfficialEventHarness();
globalThis.__ATELIER_PROJECTION_STREAM__ = {
  agentId: '   ',
  agentIds: ['   ', 'agent-ignored'],
  taskId: ' task-from-global ',
  afterEventSeq: 15,
};
const releaseStrictEmptyAgentIdsFallback = await subscribeAtelierProjectionEvents(snapshot(), 'task-1', () => {});
releaseStrictEmptyAgentIdsFallback();
assert.deepEqual(
  officialEventCalls.map((call) => call.method + ':' + call.topic),
  [
    'on:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'subscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'off:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'unsubscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
  ],
  'official projection stream rejects empty generated agentIds[0] fallback without falling through to agentIds[1]',
);
assert.equal(
  capabilityResponses.length,
  0,
  'official projection stream empty generated agentIds[0] fallback did not invoke Station stream subscribe',
);

resetOfficialEventHarness();
globalThis.__atelierOfficialFrontendGateLaunchOptions = {
  query: {
    agentId: '   ',
    agentIds: ['   ', 'launch-agent-ignored'],
    taskId: ' launch-task-from-list ',
    afterEventSeq: 17,
  },
};
const releaseStrictEmptyLaunchAgentIdsFallback = await subscribeAtelierProjectionEvents(snapshot(), 'task-1', () => {});
releaseStrictEmptyLaunchAgentIdsFallback();
assert.deepEqual(
  officialEventCalls.map((call) => call.method + ':' + call.topic),
  [
    'on:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'subscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'off:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'unsubscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
  ],
  'official projection stream rejects empty launch option agentIds[0] fallback without falling through to agentIds[1]',
);
assert.equal(
  capabilityResponses.length,
  0,
  'official projection stream empty launch option agentIds[0] fallback did not invoke Station stream subscribe',
);

resetOfficialEventHarness();
globalThis.__atelierOfficialFrontendGateLaunchOptions = {
  query: {
    agentId: 'launch-agent',
    taskId: 'launch-task',
    certificationMode: 'product-window-e2e',
    afterEventSeq: '0',
  },
};
capabilityResponses.push({
  name: 'official projection stream launch options preserve product-window zero cursor string',
  method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
  payload: {
    agentId: 'launch-agent',
    taskId: 'launch-task',
    afterEventSeq: 0,
  },
  response: { accepted: true },
});
const releaseLaunchOptionsSubscription = await subscribeAtelierProjectionEvents(snapshot(), 'task-1', () => {});
releaseLaunchOptionsSubscription();
assert.equal(
  capabilityResponses.length,
  0,
  'official projection stream launch options query consumed Station stream subscribe invoke with product-window zero cursor string',
);
resetOfficialEventHarness();

resetOfficialEventHarness();
globalThis.__ATELIER_PROJECTION_STREAM__ = { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 7 };
officialEventUnsubscribeError = new Error('unsubscribe rejected after failed subscribe');
const originalConsoleWarn = console.warn;
const officialEventWarnings = [];
console.warn = (...args) => {
  officialEventWarnings.push(args);
};
capabilityResponses.push({
  name: 'official projection stream subscribe rejects',
  method: ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
  payload: { agentId: 'agent-1', taskId: 'task-1', afterEventSeq: 7 },
  reject: new Error('Station stream subscribe rejected'),
});
await assert.rejects(
  () => subscribeAtelierProjectionEvents(snapshot(), 'task-1', (projectionEvent) => receivedOfficialEvents.push(projectionEvent.id)),
  /Station stream subscribe rejected/,
  'official projection subscription must surface Station stream subscribe rejection',
);
await new Promise((resolve) => setTimeout(resolve, 0));
console.warn = originalConsoleWarn;
assert.deepEqual(
  officialEventCalls.map((call) => call.method + ':' + call.topic),
  [
    'on:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'subscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'off:' + ATELIER_PROJECTION_EVENT_TOPIC,
    'unsubscribe:' + ATELIER_PROJECTION_EVENT_TOPIC,
  ],
  'official projection subscribe failure must remove local handler and request Host unsubscribe',
);
assert.equal(officialEventHandlers.has(ATELIER_PROJECTION_EVENT_TOPIC), false);
officialEventHandlers.get(ATELIER_PROJECTION_EVENT_TOPIC)?.(event('evt-after-rejected-official-subscription', 2, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'block-after-rejected-official-subscription', kind: 'agent', text: 'must not deliver', done: true }],
}));
assert.equal(
  receivedOfficialEvents.includes('evt-after-rejected-official-subscription'),
  false,
  'official projection subscribe failure must not keep delivering Host events after local cleanup',
);
assert.equal(officialEventWarnings.length, 1, 'official projection unsubscribe rejection must be reported exactly once');
assert.equal(officialEventWarnings[0][0], 'Atelier official projection event topic unsubscribe rejected');
assert.equal(capabilityResponses.length, 0, 'official projection subscription failure consumed Station stream subscribe invoke');
resetOfficialEventHarness();

for (const [name, error, expected] of [
  ['uppercase permission denied maps to auth-denied', new Error('PERMISSION_DENIED Station rejected Atelier access'), { key: 'atelier.error.authDenied', kind: 'auth-denied' }],
  ['mixed-case unauthorized maps to auth-denied', new Error('UnAuthorized Station rejected Atelier access'), { key: 'atelier.error.authDenied', kind: 'auth-denied' }],
  ['forbidden maps to auth-denied', new Error('Forbidden Station rejected Atelier access'), { key: 'atelier.error.authDenied', kind: 'auth-denied' }],
  ['structured permission denied code maps without message keyword', Object.assign(new Error('Station rejected Atelier access'), { code: 'PERMISSION_DENIED' }), { key: 'atelier.error.authDenied', kind: 'auth-denied' }],
  ['structured connection closed code maps without message keyword', Object.assign(new Error('Station closed projection stream'), { code: 'CONNECTION_CLOSED' }), { key: 'atelier.error.disconnected', kind: 'disconnected' }],
  ['structured cause error code maps without message keyword', new Error('Station rejected projection stream', { cause: { error: { code: 'FORBIDDEN', message: 'Access rejected' } } }), { key: 'atelier.error.authDenied', kind: 'auth-denied' }],
  ['plain structured network error object maps without message keyword', { code: 'NETWORK_DISCONNECTED', message: 'Station stream closed' }, { key: 'atelier.error.disconnected', kind: 'disconnected' }],
  ['direct nested structured error envelope maps without message keyword', { error: { code: 'PERMISSION_DENIED', message: 'Access rejected' } }, { key: 'atelier.error.authDenied', kind: 'auth-denied' }],
  ['explicit atelier error key wins over structured cause code', new Error('atelier.error.invalidProjection', { cause: { code: 'NETWORK_DISCONNECTED' } }), { key: 'atelier.error.invalidProjection', kind: 'invalid-projection' }],
  ['mixed-case network maps to disconnected', new Error('Network request failed'), { key: 'atelier.error.disconnected', kind: 'disconnected' }],
  ['mixed-case timeout maps to disconnected', new Error('Request TimeOut while loading Atelier projection'), { key: 'atelier.error.disconnected', kind: 'disconnected' }],
  ['mixed-case disconnected maps to disconnected', new Error('Station DisConnected from projection stream'), { key: 'atelier.error.disconnected', kind: 'disconnected' }],
  ['explicit atelier error key is preserved', new Error('atelier.error.invalidProjection'), { key: 'atelier.error.invalidProjection', kind: 'invalid-projection' }],
]) {
  assert.deepEqual(classifyAtelierError(error), expected, 'official error normalization matrix failed: ' + name);
}

for (const [name, input, expected] of [
  ['loading wins over auth-denied', viewInput({ loading: true, errorKind: 'auth-denied', error: 'forbidden', taskCount: 0 }), 'loading'],
  ['auth-denied wins over generic error', viewInput({ errorKind: 'auth-denied', error: 'forbidden' }), 'auth-denied'],
  ['disconnected wins over generic error', viewInput({ errorKind: 'disconnected', error: 'offline' }), 'disconnected'],
  ['stream auth-denied wins over degraded snapshot stream', viewInput({ eventStreamErrorKind: 'auth-denied', eventStreamState: 'degraded' }), 'auth-denied'],
  ['stream disconnected wins over degraded snapshot stream', viewInput({ eventStreamErrorKind: 'disconnected', eventStreamState: 'degraded' }), 'disconnected'],
  ['generic error after typed errors', viewInput({ errorKind: 'error', error: 'failed' }), 'error'],
  ['subscribing maps to reconciling', viewInput({ eventStreamState: 'subscribing' }), 'reconciling'],
  ['degraded stream maps to degraded', viewInput({ eventStreamState: 'degraded' }), 'degraded'],
  ['partial replay maps to degraded', viewInput({ replayHasMore: true }), 'degraded'],
  ['empty workspace maps to empty', viewInput({ taskCount: 0 }), 'empty'],
  ['auth-denied wins over empty workspace', viewInput({ errorKind: 'auth-denied', error: 'forbidden', taskCount: 0 }), 'auth-denied'],
  ['disconnected wins over empty workspace', viewInput({ errorKind: 'disconnected', error: 'offline', taskCount: 0 }), 'disconnected'],
  ['stream auth-denied wins over empty workspace', viewInput({ eventStreamErrorKind: 'auth-denied', eventStreamState: 'degraded', taskCount: 0 }), 'auth-denied'],
  ['stream disconnected wins over empty workspace', viewInput({ eventStreamErrorKind: 'disconnected', eventStreamState: 'degraded', taskCount: 0 }), 'disconnected'],
  ['reconciling wins over empty workspace', viewInput({ eventStreamState: 'subscribing', taskCount: 0 }), 'reconciling'],
  ['degraded stream wins over empty workspace', viewInput({ eventStreamState: 'degraded', taskCount: 0 }), 'degraded'],
  ['partial replay wins over empty workspace', viewInput({ replayHasMore: true, taskCount: 0 }), 'degraded'],
  ['ready workspace maps to ready', viewInput({ taskCount: 2 }), 'ready'],
]) {
  assert.equal(deriveAtelierViewStatus(input), expected, 'view status matrix failed: ' + name);
}
assert.deepEqual(
  [...new Set([
    'loading',
    'auth-denied',
    'disconnected',
    'error',
    'reconciling',
    'degraded',
    'empty',
    'ready',
  ])].sort(),
  [...ATELIER_VIEW_STATUSES].sort(),
  'official view status matrix must cover every generated view status',
);

const officialStatusPillMatrix = [
  ['loading', 'info', 'atelier.status.loading'],
  ['empty', 'info', 'atelier.status.empty'],
  ['ready', 'success', 'atelier.status.ready'],
  ['reconciling', 'warning', 'atelier.status.reconciling'],
  ['degraded', 'warning', 'atelier.status.degraded'],
  ['disconnected', 'warning', 'atelier.status.disconnected'],
  ['auth-denied', 'danger', 'atelier.status.authDenied'],
  ['error', 'danger', 'atelier.status.error'],
];
for (const [status, expectedTone, expectedLabelKey] of officialStatusPillMatrix) {
  const statusPillView = deriveOfficialStatusPillView(status);
  assert.equal(statusPillView.tone, expectedTone, 'official status pill tone matrix failed: ' + status);
  assert.equal(statusPillView.labelKey, expectedLabelKey, 'official status pill label key matrix failed: ' + status);
}
assert.deepEqual(
  officialStatusPillMatrix.map(([status]) => status).sort(),
  [...ATELIER_VIEW_STATUSES].sort(),
  'official status pill tone matrix must cover every generated view status',
);
assert.ok(
  atelierViewStateTestSource.includes('covers every generated view status in the official status pill matrix') &&
    atelierViewStateTestSource.includes('ATELIER_STATUS_LABEL_KEY_BY_STATUS') &&
    atelierViewStateTestSource.includes('ATELIER_VIEW_SURFACE.recovery.statusSeverityByStatus') &&
    atelierViewStateTestSource.includes('deriveOfficialStatusPillView(viewStatus)'),
  'official status pill generated unit matrix must be present in atelierViewState.test.ts',
);
for (const [status, expectedTitleKey, expectedDetailKey] of [
  ['reconciling', 'atelier.status.reconcilingTitle', 'atelier.status.reconcilingDetail'],
  ['degraded', 'atelier.status.degradedTitle', 'atelier.status.degradedDetail'],
]) {
  const actual = ATELIER_VIEW_SURFACE.statusNoticeLabelKeyByStatus[status];
  assert.equal(actual.titleKey, expectedTitleKey, 'official status notice title key mismatch for ' + status);
  assert.equal(actual.detailKey, expectedDetailKey, 'official status notice detail key mismatch for ' + status);
}
assert.deepEqual(
  Object.keys(ATELIER_VIEW_SURFACE.statusNoticeLabelKeyByStatus).sort(),
  [...ATELIER_STATUS_NOTICE_KINDS].sort(),
  'official status notice label key matrix must cover every generated status notice kind',
);
assert.ok(
  atelierViewStateTestSource.includes('covers every generated status notice kind in the official status notice matrix') &&
    atelierViewStateTestSource.includes('deriveOfficialStatusNoticeView(statusNoticeKind)') &&
    atelierViewStateTestSource.includes('ATELIER_VIEW_SURFACE.statusNoticeLabelKeyByStatus[statusNoticeKind]') &&
    atelierViewStateTestSource.includes('ATELIER_STATUS_NOTICE_KINDS'),
  'official status notice generated unit matrix must be present in atelierViewState.test.ts',
);
for (const [status, expectedTitleKey, expectedDetailKey] of [
  ['loading', 'atelier.status.loading', 'atelier.status.loadingDetail'],
  ['empty', 'atelier.empty.title', 'atelier.empty.detail'],
]) {
  const actual = ATELIER_VIEW_SURFACE.centeredStateLabelKeyByStatus[status];
  assert.equal(actual.titleKey, expectedTitleKey, 'official centered state title key mismatch for ' + status);
  assert.equal(actual.detailKey, expectedDetailKey, 'official centered state detail key mismatch for ' + status);
}
assert.deepEqual(
  Object.keys(ATELIER_VIEW_SURFACE.centeredStateLabelKeyByStatus).sort(),
  ['empty', 'loading'],
  'official centered state label key matrix must cover loading and empty states',
);
assert.ok(
  atelierViewStateTestSource.includes('covers every generated centered state kind in the official centered state matrix') &&
    atelierViewStateTestSource.includes('deriveOfficialCenteredStateView(centeredStateKind)') &&
    atelierViewStateTestSource.includes('ATELIER_VIEW_SURFACE.centeredStateLabelKeyByStatus[centeredStateKind]') &&
    centeredStateViewSource.includes('ATELIER_VIEW_SURFACE.centeredStateLabelKeyByStatus'),
  'official centered state generated unit matrix must be present in atelierViewState.test.ts',
);
assert.ok(
  statusPillViewSource.includes('(typeof ATELIER_VIEW_SURFACE.recovery.statusSeverityByStatus)[AtelierViewStatus]') &&
    !statusPillViewSource.includes("OfficialStatusPillTone = 'info' | 'warning' | 'danger' | 'success'"),
  'official status pill tone type must derive from generated status severity taxonomy',
);

for (const [name, input, expectedEmpty, expectedRecovery] of [
  ['empty workspace shows empty CTA', { error: '', loading: false, taskCount: 0, viewStatus: 'empty' }, true, ''],
  ['auth-denied empty workspace shows typed recovery', { error: '', loading: false, taskCount: 0, viewStatus: 'auth-denied' }, false, 'auth-denied'],
  ['disconnected empty workspace shows typed recovery', { error: '', loading: false, taskCount: 0, viewStatus: 'disconnected' }, false, 'disconnected'],
  ['reconciling empty workspace hides empty CTA', { error: '', loading: false, taskCount: 0, viewStatus: 'reconciling' }, false, ''],
  ['degraded empty workspace hides empty CTA', { error: '', loading: false, taskCount: 0, viewStatus: 'degraded' }, false, ''],
  ['loading empty workspace hides empty CTA', { error: '', loading: true, taskCount: 0, viewStatus: 'loading' }, false, ''],
  ['global error owns recovery panel', { error: 'failed', loading: false, taskCount: 0, viewStatus: 'auth-denied' }, false, ''],
]) {
  assert.equal(shouldRenderAtelierEmptyState(input), expectedEmpty, 'page empty composition matrix failed: ' + name);
  assert.equal(atelierTypedRecoveryKind(input), expectedRecovery, 'page typed recovery matrix failed: ' + name);
}
const officialPageSurfaceMatrix = [
  ['global error owns page surface', { error: 'failed', loading: false, taskCount: 2, viewStatus: 'auth-denied' }, { globalErrorVisible: true, typedRecoveryKind: '', statusNotice: '', loadingVisible: false, emptyVisible: false, mainContentVisible: false }],
  ['global error suppresses loading recovery and empty surfaces', { error: 'failed', loading: true, taskCount: 0, viewStatus: 'auth-denied' }, { globalErrorVisible: true, typedRecoveryKind: '', statusNotice: '', loadingVisible: false, emptyVisible: false, mainContentVisible: false }],
  ['generic error owns page surface', { error: 'failed', loading: false, taskCount: 2, viewStatus: 'error' }, { globalErrorVisible: true, typedRecoveryKind: '', statusNotice: '', loadingVisible: false, emptyVisible: false, mainContentVisible: false }],
  ['loading owns empty page surface', { error: '', loading: true, taskCount: 0, viewStatus: 'loading' }, { globalErrorVisible: false, typedRecoveryKind: '', statusNotice: '', loadingVisible: true, emptyVisible: false, mainContentVisible: false }],
  ['empty workspace shows empty only', { error: '', loading: false, taskCount: 0, viewStatus: 'empty' }, { globalErrorVisible: false, typedRecoveryKind: '', statusNotice: '', loadingVisible: false, emptyVisible: true, mainContentVisible: false }],
  ['auth-denied empty workspace shows typed recovery only', { error: '', loading: false, taskCount: 0, viewStatus: 'auth-denied' }, { globalErrorVisible: false, typedRecoveryKind: 'auth-denied', statusNotice: '', loadingVisible: false, emptyVisible: false, mainContentVisible: false }],
  ['disconnected empty workspace shows typed recovery only', { error: '', loading: false, taskCount: 0, viewStatus: 'disconnected' }, { globalErrorVisible: false, typedRecoveryKind: 'disconnected', statusNotice: '', loadingVisible: false, emptyVisible: false, mainContentVisible: false }],
  ['auth-denied snapshot preserves main content with typed recovery', { error: '', loading: false, taskCount: 2, viewStatus: 'auth-denied' }, { globalErrorVisible: false, typedRecoveryKind: 'auth-denied', statusNotice: '', loadingVisible: false, emptyVisible: false, mainContentVisible: true }],
  ['disconnected snapshot preserves main content with typed recovery', { error: '', loading: false, taskCount: 2, viewStatus: 'disconnected' }, { globalErrorVisible: false, typedRecoveryKind: 'disconnected', statusNotice: '', loadingVisible: false, emptyVisible: false, mainContentVisible: true }],
  ['reconciling snapshot preserves main content with notice', { error: '', loading: false, taskCount: 2, viewStatus: 'reconciling' }, { globalErrorVisible: false, typedRecoveryKind: '', statusNotice: 'reconciling', loadingVisible: false, emptyVisible: false, mainContentVisible: true }],
  ['degraded snapshot preserves main content with notice', { error: '', loading: false, taskCount: 2, viewStatus: 'degraded' }, { globalErrorVisible: false, typedRecoveryKind: '', statusNotice: 'degraded', loadingVisible: false, emptyVisible: false, mainContentVisible: true }],
  ['degraded empty workspace shows notice without empty CTA', { error: '', loading: false, taskCount: 0, viewStatus: 'degraded' }, { globalErrorVisible: false, typedRecoveryKind: '', statusNotice: 'degraded', loadingVisible: false, emptyVisible: false, mainContentVisible: false }],
  ['ready snapshot shows main content only', { error: '', loading: false, taskCount: 2, viewStatus: 'ready' }, { globalErrorVisible: false, typedRecoveryKind: '', statusNotice: '', loadingVisible: false, emptyVisible: false, mainContentVisible: true }],
];
for (const [name, input, expected] of officialPageSurfaceMatrix) {
  assert.deepEqual(deriveAtelierPageSurface(input), expected, 'official page surface matrix failed: ' + name);
}
assert.deepEqual(
  [...new Set(officialPageSurfaceMatrix.map(([, input]) => input.viewStatus))].sort(),
  [...ATELIER_VIEW_STATUSES].sort(),
  'official page surface matrix must cover every generated view status',
);
assert.ok(
  atelierViewStateTestSource.includes('covers every generated view status in the official page surface matrix') &&
    atelierViewStateTestSource.includes('ATELIER_TYPED_RECOVERY_KINDS') &&
    atelierViewStateTestSource.includes('ATELIER_STATUS_NOTICE_KINDS') &&
    atelierViewStateTestSource.includes('surface.emptyVisible && surface.loadingVisible'),
  'official page surface generated unit matrix must be present in atelierViewState.test.ts',
);
assert.deepEqual(
  [...new Set(officialPageSurfaceMatrix
    .filter(([, , expected]) => expected.statusNotice)
    .map(([, , expected]) => expected.statusNotice))]
    .sort(),
  [...ATELIER_STATUS_NOTICE_KINDS].sort(),
  'official page surface status notice matrix must cover every generated status notice kind',
);
assert.deepEqual(
  ['auth-denied', 'disconnected'].sort(),
  [...ATELIER_TYPED_RECOVERY_KINDS].sort(),
  'official typed recovery matrix must cover every generated typed recovery kind',
);

const officialRecoveryViewMatrix = [
  ...Object.entries(ATELIER_VIEW_SURFACE.recovery.labelKeyByKind).map(([kind, label]) => [
    kind,
    {
      tone: ATELIER_RECOVERY_TONE_BY_KIND[kind],
      retryVisible: ATELIER_RECOVERY_RETRYABLE_KINDS.includes(kind),
      ...label,
    },
  ]),
  ['', { tone: 'danger', retryVisible: false, titleKey: 'atelier.status.error' }],
];
for (const [kind, expected] of officialRecoveryViewMatrix) {
  assert.deepEqual(deriveOfficialRecoveryView(kind), expected, 'official recovery view matrix failed: ' + kind);
}
assert.deepEqual(
  officialRecoveryViewMatrix
    .filter(([kind]) => kind)
    .map(([kind]) => kind)
    .sort(),
  Object.keys(ATELIER_VIEW_SURFACE.recovery.labelKeyByKind).sort(),
  'official recovery label key matrix must cover every generated recovery label kind',
);
assert.deepEqual(
  officialRecoveryViewMatrix
    .filter(([kind, expected]) => kind && expected.retryVisible)
    .map(([kind]) => kind)
    .sort(),
  [...ATELIER_RECOVERY_RETRYABLE_KINDS].sort(),
  'official recovery retry visibility matrix must cover every generated retryable recovery kind',
);
assert.ok(
  atelierViewStateTestSource.includes('covers every generated recovery kind in the official recovery view matrix') &&
    atelierViewStateTestSource.includes('ATELIER_RECOVERY_TONE_BY_KIND') &&
    atelierViewStateTestSource.includes('ATELIER_VIEW_SURFACE.recovery.labelKeyByKind') &&
    atelierViewStateTestSource.includes("deriveOfficialRecoveryView('')"),
  'official recovery view generated unit matrix must be present in atelierViewState.test.ts',
);
const officialStatusActionPolicyMatrix = [
  ['empty workspace exposes create-project only', { error: '', errorKind: '', loading: false, taskCount: 0, viewStatus: 'empty' }, { primaryAction: 'create-project', createProjectVisible: true, retryVisible: false }],
  ['loading workspace exposes no primary action', { error: '', errorKind: '', loading: true, taskCount: 0, viewStatus: 'loading' }, { primaryAction: 'none', createProjectVisible: false, retryVisible: false }],
  ['auth-denied typed recovery exposes no retry or create action', { error: '', errorKind: '', loading: false, taskCount: 0, viewStatus: 'auth-denied' }, { primaryAction: 'none', createProjectVisible: false, retryVisible: false }],
  ['disconnected typed recovery exposes retry only', { error: '', errorKind: '', loading: false, taskCount: 1, viewStatus: 'disconnected' }, { primaryAction: 'retry', createProjectVisible: false, retryVisible: true }],
  ['global disconnected error exposes retry only', { error: 'stream closed', errorKind: 'disconnected', loading: false, taskCount: 1, viewStatus: 'ready' }, { primaryAction: 'retry', createProjectVisible: false, retryVisible: true }],
  ['global auth-denied error exposes no retry or create action', { error: 'permission denied', errorKind: 'auth-denied', loading: false, taskCount: 1, viewStatus: 'ready' }, { primaryAction: 'none', createProjectVisible: false, retryVisible: false }],
  ['degraded notice preserves content without primary action', { error: '', errorKind: '', loading: false, taskCount: 1, viewStatus: 'degraded' }, { primaryAction: 'none', createProjectVisible: false, retryVisible: false }],
];
for (const [name, input, expected] of officialStatusActionPolicyMatrix) {
  const actual = deriveOfficialStatusActionPolicy(input);
  assert.deepEqual(actual, expected, 'official status action policy matrix failed: ' + name);
  assert.equal(isOfficialStatusActionPolicyConsistent(actual), true, 'official status action policy must keep primary action and visibility flags consistent: ' + name);
  assert.deepEqual(
    Object.keys(actual).sort(),
    ['createProjectVisible', 'primaryAction', 'retryVisible'],
    'official status action policy must expose only projection UI fields: ' + name,
  );
  assert.doesNotMatch(
    JSON.stringify(actual),
    /provider\.invoke|gate\.run|artifact\.write|trace\.write|checkpoint\.write|resume\.execute|memory\.write|input_snapshot|shell|file\.write|run\.execute/,
    'official status action policy must stay projection-only: ' + name,
  );
}
assert.deepEqual(
  [...new Set(officialStatusActionPolicyMatrix.map(([, , expected]) => expected.primaryAction))].sort(),
  ['create-project', 'none', 'retry'],
  'official status action policy matrix must cover create, retry, and no-action outcomes',
);
assert.ok(
  atelierViewStateTestSource.includes('covers every generated view status in the action policy matrix') &&
    atelierViewStateTestSource.includes('covers every generated recovery kind in global-error action policy') &&
    atelierViewStateTestSource.includes("Object.keys(policy).sort()).toEqual(['createProjectVisible', 'primaryAction', 'retryVisible'])") &&
    atelierViewStateTestSource.includes('provider\\\\.invoke|gate\\\\.run|artifact\\\\.write'),
  'official status action policy generated source unit matrix must be present in atelierViewState.test.ts',
);
for (const [name, policy] of [
  ['create action without create visibility', { primaryAction: 'create-project', createProjectVisible: false, retryVisible: false }],
  ['retry action with both actions visible', { primaryAction: 'retry', createProjectVisible: true, retryVisible: true }],
  ['none action with retry visible', { primaryAction: 'none', createProjectVisible: false, retryVisible: true }],
]) {
  assert.equal(isOfficialStatusActionPolicyConsistent(policy), false, 'official status action policy consistency guard must reject ' + name);
}
function expectedOfficialGeneratedStatusActionPolicy(viewStatus, taskCount) {
  if (viewStatus === 'empty' && taskCount === 0) {
    return { primaryAction: 'create-project', createProjectVisible: true, retryVisible: false };
  }
  if (viewStatus === 'disconnected') {
    return { primaryAction: 'retry', createProjectVisible: false, retryVisible: true };
  }
  return { primaryAction: 'none', createProjectVisible: false, retryVisible: false };
}
for (const taskCount of [0, 1]) {
  const coveredStatuses = [];
  for (const viewStatus of ATELIER_VIEW_STATUSES) {
    const policy = deriveOfficialStatusActionPolicy({
      error: '',
      errorKind: '',
      loading: viewStatus === 'loading',
      taskCount,
      viewStatus,
    });
    coveredStatuses.push(viewStatus);
    assert.deepEqual(policy, expectedOfficialGeneratedStatusActionPolicy(viewStatus, taskCount), 'official generated view status action policy matrix failed: ' + viewStatus + ' taskCount=' + taskCount);
    assert.equal(isOfficialStatusActionPolicyConsistent(policy), true, 'official generated view status action policy must be consistent: ' + viewStatus + ' taskCount=' + taskCount);
  }
  assert.deepEqual(coveredStatuses, [...ATELIER_VIEW_STATUSES], 'official status action policy generated matrix must cover every generated view status for taskCount=' + taskCount);
}
for (const errorKind of Object.keys(ATELIER_VIEW_SURFACE.recovery.labelKeyByKind)) {
  const retryVisible = ATELIER_RECOVERY_RETRYABLE_KINDS.includes(errorKind);
  const policy = deriveOfficialStatusActionPolicy({
    error: 'global recovery',
    errorKind,
    loading: false,
    taskCount: 1,
    viewStatus: 'ready',
  });
  assert.deepEqual(
    policy,
    { primaryAction: retryVisible ? 'retry' : 'none', createProjectVisible: false, retryVisible },
    'official global recovery action policy matrix failed: ' + errorKind,
  );
  assert.equal(isOfficialStatusActionPolicyConsistent(policy), true, 'official generated recovery action policy must be consistent: ' + errorKind);
}

for (const key of [
  'atelier.status.empty',
  'atelier.status.authDenied',
  'atelier.status.degraded',
  'atelier.status.disconnected',
  'atelier.status.error',
  'atelier.status.loading',
  'atelier.status.reconciling',
  'atelier.status.ready',
]) {
  const value = messagesZhCn[key];
  assert.equal(typeof value, 'string', 'zh-CN status key must exist: ' + key);
  assert.ok(value.length > 0 && !/^(Empty|Auth denied|Degraded|Disconnected|Error|Loading|Reconciling|Ready)$/.test(value), 'zh-CN status key must be localized: ' + key);
}

const eventStreamRetryCases = [
  ['first retry starts at 500ms', { attempt: 0, errorKind: 'disconnected', hasSnapshot: true }, 500],
  ['second retry backs off to 1500ms', { attempt: 1, errorKind: 'error', hasSnapshot: true }, 1500],
  ['third retry backs off to 5000ms', { attempt: 2, errorKind: 'disconnected', hasSnapshot: true }, 5000],
  ['retry stops after bounded attempts', { attempt: 3, errorKind: 'disconnected', hasSnapshot: true }, null],
  ['retry requires snapshot', { attempt: 0, errorKind: 'disconnected', hasSnapshot: false }, null],
  ['auth denied never retries', { attempt: 0, errorKind: 'auth-denied', hasSnapshot: true }, null],
  ['invalid projection never retries', { attempt: 0, errorKind: 'invalid-projection', hasSnapshot: true }, null],
  ['agent ids required never retries', { attempt: 0, errorKind: 'agent-ids-required', hasSnapshot: true }, null],
];
for (const [name, input, expected] of eventStreamRetryCases) {
  assert.equal(nextAtelierEventStreamRetryDelayMs(input), expected, 'event stream retry matrix failed: ' + name);
}
assert.deepEqual(
  [...new Set(eventStreamRetryCases.filter(([, , expected]) => expected !== null).map(([, input]) => input.errorKind))].sort(),
  [...ATELIER_RECOVERY_RETRYABLE_KINDS].sort(),
  'event stream retry matrix must cover every generated retryable recovery kind',
);
assert.deepEqual(
  [...new Set(eventStreamRetryCases.filter(([, input, expected]) => input.hasSnapshot && expected === null && input.attempt === 0).map(([, input]) => input.errorKind))].sort(),
  Object.keys(ATELIER_RECOVERY_TONE_BY_KIND).filter((kind) => !(ATELIER_RECOVERY_RETRYABLE_KINDS as readonly string[]).includes(kind)).sort(),
  'event stream retry matrix must hard-stop every generated non-retryable recovery kind',
);

const connectingTransition = stateFromAtelierEventStreamConnecting();
assert.equal(connectingTransition.loading, false, 'controller stream connecting transition must keep loaded snapshot surface visible');
assert.equal(connectingTransition.eventStreamState, 'subscribing', 'controller stream connecting transition must enter subscribing state');
assert.equal(connectingTransition.eventStreamError, '', 'controller stream connecting transition must clear stale stream error text');
assert.equal(connectingTransition.eventStreamErrorKind, '', 'controller stream connecting transition must clear stale stream error kind');
assert.equal(
  deriveAtelierViewStatus({
    loading: connectingTransition.loading,
    error: '',
    errorKind: '',
    eventStreamErrorKind: connectingTransition.eventStreamErrorKind,
    eventStreamState: connectingTransition.eventStreamState,
    replayHasMore: false,
    taskCount: 1,
  }),
  'reconciling',
  'controller stream connecting transition must derive reconciling view status',
);

for (const [name, error, hasSnapshot, expected] of [
  ['subscribe disconnected degrades existing snapshot surface', new Error('atelier.error.disconnected'), true, {
    eventStreamState: 'degraded',
    eventStreamErrorKind: 'disconnected',
    viewStatus: 'disconnected',
    retryDelayMs: 500,
  }],
  ['subscribe auth-denied degrades existing snapshot but hard-stops retry', new Error('atelier.error.authDenied'), true, {
    eventStreamState: 'degraded',
    eventStreamErrorKind: 'auth-denied',
    viewStatus: 'auth-denied',
    retryDelayMs: null,
  }],
  ['subscribe failure without snapshot becomes global disconnected load error', new Error('atelier.error.disconnected'), false, {
    errorKind: 'disconnected',
    viewStatus: 'disconnected',
    retryDelayMs: null,
  }],
  ['subscribe generic failure without snapshot becomes global error', new Error('boom'), false, {
    errorKind: 'error',
    viewStatus: 'error',
    retryDelayMs: null,
  }],
]) {
  const transition = stateFromAtelierEventStreamError(error, hasSnapshot);
  assert.equal(transition.loading, false, 'controller stream failure transition must stop loading: ' + name);
  assert.equal(transition.resolvingDecisionId, '', 'controller stream failure transition must clear resolving decision: ' + name);
  assert.equal(transition.creatingProject, false, 'controller stream failure transition must clear creating project: ' + name);
  assert.equal(transition.sendingMessage, false, 'controller stream failure transition must clear sending message: ' + name);
  assert.equal(transition.taskActionId, '', 'controller stream failure transition must clear task action id: ' + name);
  assert.equal(transition.taskActionKind, '', 'controller stream failure transition must clear task action kind: ' + name);
  assert.equal(transition.purgeConfirmTaskId, '', 'controller stream failure transition must clear purge confirmation: ' + name);
  assert.equal(
    nextAtelierEventStreamRetryDelayMs({
      attempt: 0,
      errorKind: 'eventStreamErrorKind' in transition ? transition.eventStreamErrorKind : transition.errorKind,
      hasSnapshot,
    }),
    expected.retryDelayMs,
    'controller stream failure retry taxonomy failed: ' + name,
  );
  assert.equal(
    deriveAtelierViewStatus({
      loading: transition.loading,
      error: 'error' in transition ? transition.error : '',
      errorKind: 'errorKind' in transition ? transition.errorKind : '',
      eventStreamErrorKind: 'eventStreamErrorKind' in transition ? transition.eventStreamErrorKind : '',
      eventStreamState: 'eventStreamState' in transition ? transition.eventStreamState : 'idle',
      replayHasMore: false,
      taskCount: hasSnapshot ? 1 : 0,
    }),
    expected.viewStatus,
    'controller stream failure view status failed: ' + name,
  );
  for (const [field, value] of Object.entries(expected)) {
    if (field === 'viewStatus' || field === 'retryDelayMs') continue;
    assert.equal(transition[field], value, 'controller stream failure transition field failed: ' + name + ' ' + field);
  }
}

const controllerTransientResetFields = [
  'resolvingDecisionId',
  'creatingProject',
  'sendingMessage',
  'taskActionId',
  'taskActionKind',
  'purgeConfirmTaskId',
  'providerCapabilitiesLoading',
  'feedbackSubmittingId',
  'memoryConfirming',
  'rerunConfirming',
  'workspaceOpenSubmittingId',
  'artifactBodyFetchId',
  'artifactPreviewOpenId',
];
for (const [name, error, hasSnapshot, expectedKind] of [
  ['snapshot auth-denied transient reset', new Error('atelier.error.authDenied'), true, 'auth-denied'],
  ['snapshot disconnected transient reset', new Error('atelier.error.disconnected'), true, 'disconnected'],
  ['snapshot generic transient reset', new Error('boom'), true, 'error'],
  ['load auth-denied transient reset', new Error('atelier.error.authDenied'), false, 'auth-denied'],
  ['load disconnected transient reset', new Error('atelier.error.disconnected'), false, 'disconnected'],
  ['load generic transient reset', new Error('boom'), false, 'error'],
]) {
  const transition = stateFromAtelierEventStreamError(error, hasSnapshot);
  const kind = 'eventStreamErrorKind' in transition ? transition.eventStreamErrorKind : transition.errorKind;
  assert.equal(kind, expectedKind, 'controller recovery transition must preserve typed recovery kind: ' + name);
  for (const field of controllerTransientResetFields) {
    assert.equal(
      transition[field],
      typeof transition[field] === 'boolean' ? false : '',
      'controller recovery transition must clear transient workbench action field: ' + name + ' ' + field,
    );
  }
  assert.doesNotMatch(
    JSON.stringify(transition),
    /provider\.invoke|gate\.run|artifact\.write|trace\.write|checkpoint\.write|resume\.execute|memory\.write|input_snapshot|shell|file\.write|run\.execute/,
    'controller recovery transition reset must stay projection-only: ' + name,
  );
}
assert.ok(
  controllerTransitionsTestSource.includes('clears every transient workbench action field for snapshot recovery failures') &&
    controllerTransitionsTestSource.includes('clears every transient workbench action field for no-snapshot load failures') &&
    controllerTransitionsTestSource.includes('providerCapabilitiesLoading') &&
    controllerTransitionsTestSource.includes('feedbackSubmittingId') &&
    controllerTransitionsTestSource.includes('memoryConfirming') &&
    controllerTransitionsTestSource.includes('rerunConfirming') &&
    controllerTransitionsTestSource.includes('workspaceOpenSubmittingId') &&
    controllerTransitionsTestSource.includes('artifactBodyFetchId') &&
    controllerTransitionsTestSource.includes('artifactPreviewOpenId') &&
    controllerTransitionsTestSource.includes('provider\\\\.invoke|gate\\\\.run|artifact\\\\.write'),
  'official controller recovery transition transient reset source unit matrix must be present in controllerTransitions.test.ts',
);

assert.equal(stateFromAtelierError(new Error('atelier.error.authDenied')).errorKind, 'auth-denied');
assert.equal(stateFromAtelierError(new Error('atelier.error.disconnected')).errorKind, 'disconnected');

const malformedEventState = stateFromMalformedAtelierProjectionEvent();
assert.equal(malformedEventState.loading, false);
assert.equal(malformedEventState.eventStreamState, 'degraded');
assert.equal(malformedEventState.eventStreamErrorKind, 'invalid-projection');
assert.equal(
  deriveAtelierViewStatus({
    loading: malformedEventState.loading,
    error: '',
    errorKind: '',
    eventStreamErrorKind: malformedEventState.eventStreamErrorKind,
    eventStreamState: malformedEventState.eventStreamState,
    replayHasMore: false,
    taskCount: 1,
  }),
  'degraded',
  'malformed projection event must degrade an existing snapshot surface',
);
const recoveredAfterMalformedEvent = {
  ...stateFromAtelierSnapshot(snapshot()),
  ...malformedEventState,
};
const recoveredPatch = applyAtelierProjectionEvent(recoveredAfterMalformedEvent, {
  id: 'evt-recover-after-malformed',
  seq: 1,
  taskId: 'task-1',
  receivedAt: 'now',
  patch: {
    kind: 'stream.append',
    taskId: 'task-1',
    blocks: [{ id: 'block-recover', kind: 'agent', text: 'recovered', done: true }],
  },
});
assert.equal(recoveredPatch.snapshot.workspace.streams['task-1'].at(-1)?.id, 'block-recover');

assert.equal(parseAtelierProjectionEvent({ id: 'bad', seq: 1, receivedAt: 'now', patch: { kind: 'unknown' } }), null);
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
  { todos: { 'task-1': [{ id: 'todo-1', text: 'bad status', status: 'blocked' }] } },
  { todos: { 'task-unknown': [] } },
  { contexts: { 'task-1': { usedPct: -1, files: [{ name: 'README.md', group: 'files' }] } } },
  { contexts: { 'task-1': { usedPct: 101, files: [{ name: 'README.md', group: 'files' }] } } },
  { contexts: { 'task-1': { usedPct: 50, files: [{ name: '', group: 'files' }] } } },
  { contexts: { 'task-1': { usedPct: 50, files: [{ name: 'README.md', group: 'secret' }] } } },
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
  { artifacts: { 'task-unknown': [] } },
  { artifacts: { 'task-1': [{ id: '', name: 'empty artifact', kind: 'markdown', meta: 'bad' }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-bad-body-ref', name: 'bad body ref', kind: 'markdown', meta: 'bad', bodyRef: 'file:///tmp/leak' }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-bad-body-ref-url', name: 'bad body ref url', kind: 'markdown', meta: 'bad', bodyRef: 'https://example.invalid/body' }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-bad-body-ref-shape', name: 'bad body ref shape', kind: 'markdown', meta: 'bad', bodyRef: 'artifact://task-1/body' }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-body-ref-task-mismatch', name: 'bad body ref task', kind: 'markdown', meta: 'bad', bodyRef: 'artifact://task-2/artifact-body-ref-task-mismatch/body' }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-body-ref-artifact-mismatch', name: 'bad body ref artifact', kind: 'markdown', meta: 'bad', bodyRef: 'artifact://task-1/artifact-other/body' }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-preview-target-empty', name: 'empty preview target', kind: 'markdown', meta: 'bad', previewTarget: {} }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-preview-target-missing-sandbox', name: 'missing sandbox', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', bodyRef: 'artifact://task-1/artifact-preview/body' } }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-preview-target-bad-sandbox-ref-shape', name: 'bad sandbox ref shape', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task 1/artifact-preview/preview', bodyRef: 'artifact://task-1/artifact-preview/body' } }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-preview-target-task-mismatch', name: 'bad preview target task', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-2/artifact-preview-target-task-mismatch/preview', bodyRef: 'artifact://task-1/artifact-preview-target-task-mismatch/body' } }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-preview-target-artifact-mismatch', name: 'bad preview target artifact', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact-other/preview', bodyRef: 'artifact://task-1/artifact-preview-target-artifact-mismatch/body' } }] } },
  { artifacts: { 'task-1': [{ id: 'artifact-preview-target-missing-body', name: 'missing body', kind: 'markdown', meta: 'bad', previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview' } }] } },
  { gates: { 'task-1': [{ id: '', name: 'empty gate', status: 'failed', summary: 'bad', checks: [] }] } },
  { gates: { 'task-1': [{ id: 'gate-1', name: 'bad check', status: 'failed', summary: 'bad', checks: [{ name: '', status: 'failed' }] }] } },
  { gates: { 'task-unknown': [] } },
  { budget: { status: 'halted', summary: '$1 / $10', dimensions: [{ id: 'money', label: 'Money', used: 1, cap: 10, unit: '$', percent: 10, status: 'ok' }] } },
  { budget: { status: 'warning', summary: '', dimensions: [{ id: 'money', label: 'Money', used: 1, cap: 10, unit: '$', percent: 10, status: 'ok' }] } },
  { budget: { status: 'warning', summary: '$1 / $10', dimensions: [] } },
  { budget: { status: 'warning', summary: '$1 / $10', dimensions: [{ id: 'money', label: 'Money', used: -1, cap: 10, unit: '$', percent: 10, status: 'ok' }] } },
  { budget: { status: 'warning', summary: '$1 / $10', dimensions: [{ id: 'money', label: 'Money', used: 1, cap: 10, unit: '$', percent: 101, status: 'ok' }] } },
  { budget: { status: 'warning', summary: '$1 / $10', dimensions: [{ id: 'money', label: 'Money', used: 1, cap: 10, unit: '$', percent: 10, status: 'halted' }] } },
  { replay: { '': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
  { replay: { 'task-unknown': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
  { replay: { 'task-1': { source: '', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: '1', replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1.5, replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: Number.MAX_SAFE_INTEGER + 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1.5, nextEventSeq: 2, hasMore: false } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: Number.MAX_SAFE_INTEGER + 1, nextEventSeq: 2, hasMore: false } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: -1, hasMore: false } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2.5, hasMore: false } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: Number.MAX_SAFE_INTEGER + 1, hasMore: false } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: 'no' } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false, checkpointId: '' } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false, checkpointEventSeq: -1 } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false, checkpointEventSeq: 2.5 } } },
  { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false, checkpointEventSeq: Number.MAX_SAFE_INTEGER + 1 } } },
]) {
  const invalidSnapshot = snapshot();
  if ('selectedTaskId' in invalidWorkspacePatch) {
    invalidSnapshot.selectedTaskId = invalidWorkspacePatch.selectedTaskId;
  } else {
    invalidSnapshot.workspace = { ...invalidSnapshot.workspace, ...invalidWorkspacePatch };
  }
  assert.equal(isAtelierProjectionSnapshot(invalidSnapshot), false);
}
assert.equal(parseAtelierProjectionEvent(event('evt-decimal-seq', 1.5, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-unsafe-seq', Number.MAX_SAFE_INTEGER + 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-empty-top-level-task', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [],
}, { taskId: '' })), null);
assert.equal(parseAtelierProjectionEvent(event('evt-empty-patch-task', 1, {
  kind: 'stream.append',
  taskId: '',
  blocks: [],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-snapshot-with-task-scope', 1, {
  kind: 'snapshot',
  snapshot: snapshot(),
}, { taskId: 'task-1' })), null);
assert.equal(parseAtelierProjectionEvent(event('evt-task-upsert-mismatched-task-scope', 1, {
  kind: 'task.upsert',
  task: { id: 'task-2', project: 'peers-touch', title: 'mismatched upsert scope', status: 'active' },
}, { taskId: 'task-1' })), null);
assert.equal(parseAtelierProjectionEvent(event('evt-mismatched-event-patch-task-scope', 1, {
  kind: 'stream.append',
  taskId: 'task-2',
  blocks: [{ id: 'block-mismatched-scope', kind: 'agent', text: 'must be rejected' }],
}, { taskId: 'task-1' })), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-stream-block', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ kind: 'agent', text: 'missing id' }],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-stream-kind', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'block-unknown', kind: 'raw_patch', text: 'must not render raw patch' }],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-user-stream-required-fields', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'user-missing-text', kind: 'user' }],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-decision-stream-required-fields', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'decision-missing-options', kind: 'decision', question: 'Approve?', spentSoFar: '$1', rollbackImpact: 'none' }],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-artifact-stream-required-fields', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'artifact-missing-producer', kind: 'artifact', name: 'report', fileKind: 'report' }],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-diff-stream-block', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'diff-bad', kind: 'diff', files: 1, added: 2, removed: 0, paths: ['src/a.ts', ''] }],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-diff-stream-empty-paths', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'diff-empty-paths', kind: 'diff', files: 1, added: 2, removed: 0, paths: [] }],
})), null);
assert.ok(parseAtelierProjectionEvent(JSON.stringify(event('evt-diff-valid', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'diff-1', kind: 'diff', files: 2, added: 12, removed: 3, paths: ['src/a.ts', 'src/b.ts'] }],
}))));
assert.equal(parseAtelierProjectionEvent(event('evt-empty-decision-block', 1, {
  kind: 'decision.resolved',
  taskId: 'task-1',
  blockId: '',
  choice: 'continue',
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-empty-decision-choice', 1, {
  kind: 'decision.resolved',
  taskId: 'task-1',
  blockId: 'decision-1',
  choice: '',
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-task-upsert-status', 1, {
  kind: 'task.upsert',
  task: { id: 'task-1', project: 'peers-touch', title: 'bad status', status: 'running' },
  select: true,
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-task-upsert-workspace-target', 1, {
  kind: 'task.upsert',
  task: {
    id: 'task-1',
    project: 'peers-touch',
    title: 'bad workspace target',
    status: 'active',
    workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'file:///tmp/ws', label: 'workspace' },
  },
  select: true,
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-task-upsert-workspace-target-prefix-only', 1, {
  kind: 'task.upsert',
  task: {
    id: 'task-1',
    project: 'peers-touch',
    title: 'bad workspace target prefix only',
    status: 'active',
    workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'pt-workspace://task/task-1?workspace=ws-2', label: 'workspace' },
  },
  select: true,
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-task-upsert-workspace-target-task-mismatch', 1, {
  kind: 'task.upsert',
  task: {
    id: 'task-1',
    project: 'peers-touch',
    title: 'bad workspace target task mismatch',
    status: 'active',
    workspaceOpenTarget: { workspaceId: 'ws-1', workspaceUri: 'pt-workspace://task/task-2?workspace=ws-1', label: 'workspace' },
  },
  select: true,
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-empty-artifact-id', 1, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: { id: '', name: 'empty artifact', kind: 'markdown' },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-empty-gate-id', 1, {
  kind: 'gate.upsert',
  taskId: 'task-1',
  gate: { id: '', name: 'empty gate', status: 'failed', checks: [] },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-gate-check', 1, {
  kind: 'gate.upsert',
  taskId: 'task-1',
  gate: { id: 'gate-1', name: 'bad check', status: 'failed', checks: [{ name: '', status: 'failed' }] },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-todo-item', 1, {
  kind: 'todo.replace',
  taskId: 'task-1',
  todos: [{ id: 'todo-1', text: '', status: 'todo' }],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-context-file', 1, {
  kind: 'context.replace',
  taskId: 'task-1',
  context: { usedPct: 50, files: [{ name: 'README.md', group: 'secret' }] },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-nego-stance', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{
    id: 'block-bad-stance',
    kind: 'nego',
    summary: 'invalid stance',
    agentCount: 1,
    converged: false,
    consensus: 'pending',
    voices: [{ role: 'Planner', stance: 'approval', text: 'invalid stance' }],
  }],
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-malformed-nego-empty-voice-fields', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{
    id: 'block-empty-voice-fields',
    kind: 'nego',
    summary: 'empty voice fields',
    agentCount: 1,
    converged: false,
    consensus: 'pending',
    voices: [{
      role: '',
      stance: 'objection',
      text: '',
      evidenceRef: '',
      sessionId: '',
      roundId: '',
      voiceId: '',
      objectionId: '',
    }],
  }],
})), null);
assert.ok(parseAtelierProjectionEvent(JSON.stringify(event('evt-valid', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{
    id: 'block-1',
    kind: 'nego',
    summary: '3 agents converged',
    agentCount: 3,
    converged: true,
    consensus: 'Use Station projection as truth',
    voices: [{
      role: 'Planner',
      stance: 'proposal',
      text: 'Ship the projection UI',
      evidenceRef: 'prototype/README.md',
      sessionId: 'session-1',
      roundId: 'round-1',
      voiceId: 'voice-1',
      objectionId: 'objection-1',
    }],
  }],
}))));
assert.ok(parseAtelierProjectionEvent(JSON.stringify(event('evt-decision-valid', 2, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{
    id: 'decision-2',
    kind: 'decision',
    question: 'Resume?',
    spentSoFar: '$1',
    options: [{ text: 'Resume safely', recommended: true }],
    rollbackImpact: 'none',
  }],
}))));
assert.equal(parseAtelierProjectionEvent(event('evt-bad-context', 3, {
  kind: 'context.replace',
  taskId: 'task-1',
  context: { usedPct: 'bad', files: [] },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-bad-artifact', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: { id: 'artifact-bad', paths: ['ok', 42] },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-body-leak', 3, {
    kind: 'artifact.upsert',
    taskId: 'task-1',
    artifact: { id: 'artifact-body-leak', markdown: '# leaked body' },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-bad-body-ref-file', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: { id: 'artifact-bad-body-ref-file', bodyRef: 'file:///tmp/leak' },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-bad-body-ref-url', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: { id: 'artifact-bad-body-ref-url', bodyRef: 'https://example.invalid/body' },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-bad-body-ref-shape', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: { id: 'artifact-bad-body-ref-shape', bodyRef: 'artifact://task-1/body' },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-body-ref-task-mismatch', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: { id: 'artifact-body-ref-task-mismatch', bodyRef: 'artifact://task-2/artifact-body-ref-task-mismatch/body' },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-body-ref-artifact-mismatch', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: { id: 'artifact-body-ref-artifact-mismatch', bodyRef: 'artifact://task-1/artifact-other/body' },
})), null);
for (const forbiddenBodyField of ['content', 'body', 'html', 'diff', 'patch', 'url', 'src', 'iframe']) {
  assert.equal(parseAtelierProjectionEvent(event('evt-artifact-body-leak-' + forbiddenBodyField, 3, {
    kind: 'artifact.upsert',
    taskId: 'task-1',
    artifact: { id: 'artifact-body-leak-' + forbiddenBodyField, [forbiddenBodyField]: 'leaked body' },
  })), null);
}
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-bad-hint', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: { id: 'artifact-bad-preview-hint', previewHint: 'iframe' },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-empty', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-empty',
    previewTarget: {},
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-missing-sandbox', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-missing-sandbox',
    previewTarget: { mode: 'sandbox_manifest', bodyRef: 'artifact://task-1/artifact-preview/body' },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-missing-body', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-missing-body',
    previewTarget: { mode: 'sandbox_manifest', sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview' },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-url-leak', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-url-leak',
    previewTarget: { kind: 'web', mode: 'sandbox_manifest', url: 'https://example.invalid' },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-body-leak', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-body-leak',
    previewTarget: { kind: 'markdown', mode: 'safe_text', body: '# leaked body' },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-bad-mode', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-bad-mode',
    previewTarget: {
      kind: 'markdown',
      mode: 'safe_text',
      sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview',
      bodyRef: 'artifact://task-1/artifact-preview/body',
    },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-bad-sandbox-ref', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-bad-sandbox-ref',
    previewTarget: {
      kind: 'markdown',
      mode: 'sandbox_manifest',
      sandboxRef: 'sandbox-preview-1',
      bodyRef: 'artifact://task-1/artifact-preview/body',
    },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-bad-body-ref', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-bad-body-ref',
    previewTarget: {
      kind: 'markdown',
      mode: 'sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview',
      bodyRef: 'https://example.invalid/artifact-body',
    },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-bad-sandbox-ref-shape', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-bad-sandbox-ref-shape',
    previewTarget: {
      kind: 'markdown',
      mode: 'sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact preview/preview',
      bodyRef: 'artifact://task-1/artifact-preview/body',
    },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-bad-body-ref-shape', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-bad-body-ref-shape',
    previewTarget: {
      kind: 'markdown',
      mode: 'sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview',
      bodyRef: 'artifact://task-1/body',
    },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-task-mismatch', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-task-mismatch',
    previewTarget: {
      kind: 'markdown',
      mode: 'sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-2/artifact-preview-target-task-mismatch/preview',
      bodyRef: 'artifact://task-1/artifact-preview-target-task-mismatch/body',
    },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-artifact-preview-target-artifact-mismatch', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview-target-artifact-mismatch',
    previewTarget: {
      kind: 'markdown',
      mode: 'sandbox_manifest',
      sandboxRef: 'atelier-sandbox://task-1/artifact-other/preview',
      bodyRef: 'artifact://task-1/artifact-preview-target-artifact-mismatch/body',
    },
  },
})), null);
assert.equal(parseAtelierProjectionEvent(event('evt-bad-gate', 3, {
  kind: 'gate.upsert',
  taskId: 'task-1',
  gate: { id: 'gate-bad', artifactIds: ['ok', 42] },
})), null);
assert.ok(parseAtelierProjectionEvent(event('evt-artifact-preview-valid', 3, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-preview',
    kind: 'markdown',
    previewHint: 'metadata_only',
    bodyRef: 'artifact://task-1/artifact-preview/body',
    bodyHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    bodySize: '128',
    bodyKind: 'markdown',
    previewTarget: {
      kind: 'markdown',
      mode: 'sandbox_manifest',
      label: 'Final summary preview',
      sandboxRef: 'atelier-sandbox://task-1/artifact-preview/preview',
      bodyRef: 'artifact://task-1/artifact-preview/body',
    },
    paths: ['docs/architecture/atelier/prototype/README.md'],
  },
})));

let state = stateFromAtelierSnapshot(snapshot());
state = applyAtelierProjectionEvent(state, event('evt-1', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'block-1', kind: 'agent', text: 'first' }],
}));
state = applyAtelierProjectionEvent(state, event('evt-1', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'block-duplicate', kind: 'agent', text: 'duplicate event' }],
}));
state = applyAtelierProjectionEvent(state, event('evt-stale', 0, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'block-stale', kind: 'agent', text: 'stale event' }],
}));
state = applyAtelierProjectionEvent(state, event('evt-2', 2, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'block-1', kind: 'agent', text: 'duplicate block' }, { id: 'block-2', kind: 'agent', text: 'second' }],
}));

assert.deepEqual(state.snapshot.workspace.streams['task-1'].map((block) => block.id), ['decision-1', 'block-1', 'block-2']);
assert.equal(state.lastSeqByScope['task-1'], 2);

const stateBeforeUnknownTaskPatch = state;
state = applyAtelierProjectionEvent(state, event('evt-unknown-task-stream', 3, {
  kind: 'stream.append',
  taskId: 'task-unknown',
  blocks: [{ id: 'block-orphan', kind: 'agent', text: 'orphan block' }],
}));
assert.equal(state, stateBeforeUnknownTaskPatch);
assert.equal(state.snapshot.workspace.streams['task-unknown'], undefined);
assert.equal(state.lastSeqByScope['task-unknown'], undefined);
assert.equal(state.seenEventKeys.includes('id:evt-unknown-task-stream'), false);

const duplicateOutcome = applyAtelierProjectionEventWithResult(state, event('evt-2', 2, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'block-duplicate-outcome', kind: 'agent', text: 'duplicate event outcome' }],
}));
assert.equal(duplicateOutcome.outcome, 'duplicate');
assert.equal(duplicateOutcome.state, state);

const staleOutcome = applyAtelierProjectionEventWithResult(state, event('evt-stale-outcome', 1, {
  kind: 'stream.append',
  taskId: 'task-1',
  blocks: [{ id: 'block-stale-outcome', kind: 'agent', text: 'stale event outcome' }],
}));
assert.equal(staleOutcome.outcome, 'stale');
assert.equal(staleOutcome.state, state);
assert.equal(staleOutcome.state.snapshot.workspace.streams['task-1'].some((block) => block.id === 'block-stale-outcome'), false);

const unknownTaskOutcome = applyAtelierProjectionEventWithResult(state, event('evt-unknown-task-outcome', 3, {
  kind: 'stream.append',
  taskId: 'task-unknown',
  blocks: [{ id: 'block-unknown-task-outcome', kind: 'agent', text: 'unknown task outcome' }],
}));
assert.equal(unknownTaskOutcome.outcome, 'unknown-task');
assert.equal(unknownTaskOutcome.state, state);
assert.equal(unknownTaskOutcome.state.snapshot.workspace.streams['task-unknown'], undefined);

let boundedDedupeState = stateFromAtelierSnapshot(snapshot());
for (let seq = 1; seq <= MAX_ATELIER_EVENT_KEYS + 1; seq += 1) {
  boundedDedupeState = applyAtelierProjectionEvent(boundedDedupeState, event('evt-official-dedupe-cache-' + seq, seq, {
    kind: 'stream.append',
    taskId: 'task-1',
    blocks: [{ id: 'block-official-dedupe-cache-' + seq, kind: 'agent', text: 'bounded official event ' + seq }],
  }));
}
assert.equal(boundedDedupeState.seenEventKeys.length, MAX_ATELIER_EVENT_KEYS);
assert.equal(boundedDedupeState.seenEventKeys.includes('id:evt-official-dedupe-cache-1'), false);
assert.equal(boundedDedupeState.lastSeqByScope['task-1'], MAX_ATELIER_EVENT_KEYS + 1);
const evictedStaleReplayOutcome = applyAtelierProjectionEventWithResult(
  boundedDedupeState,
  event('evt-official-dedupe-cache-1', 1, {
    kind: 'stream.append',
    taskId: 'task-1',
    blocks: [{ id: 'block-official-evicted-stale-replay', kind: 'agent', text: 'evicted stale replay' }],
  }),
);
assert.equal(evictedStaleReplayOutcome.outcome, 'stale');
assert.equal(evictedStaleReplayOutcome.state, boundedDedupeState);
assert.equal(
  evictedStaleReplayOutcome.state.snapshot.workspace.streams['task-1'].some((block) => block.id === 'block-official-evicted-stale-replay'),
  false,
);

const mismatchedEvent = parseAtelierProjectionEvent(event('evt-mismatched-task-1-task-2-seq-1', 1, {
  kind: 'stream.append',
  taskId: 'task-2',
  blocks: [{ id: 'task-2-cross-scope-stale', kind: 'agent', text: 'must be rejected' }],
}, { taskId: 'task-1' }));
assert.equal(mismatchedEvent, null);
assert.equal(state.snapshot.workspace.streams['task-2'], undefined);
assert.equal(state.lastSeqByScope['task-1'], 2);

state = applyAtelierProjectionEvent(state, event('evt-todo', 3, {
  kind: 'todo.replace',
  taskId: 'task-1',
  todos: [{ id: 'todo-2', text: 'Verify projection UI', status: 'todo' }],
}));
state = applyAtelierProjectionEvent(state, event('evt-context', 4, {
  kind: 'context.replace',
  taskId: 'task-1',
  context: { usedPct: 66, files: [{ name: 'AtelierAppletPage.tsx', group: 'files' }] },
}));
assert.equal(state.snapshot.workspace.todos['task-1'][0].id, 'todo-2');
assert.equal(state.snapshot.workspace.contexts['task-1'].usedPct, 66);

state = applyAtelierProjectionEvent(state, event('evt-decision', 5, {
  kind: 'decision.resolved',
  taskId: 'task-1',
  blockId: 'decision-1',
  choice: 'approve',
}));
assert.equal(state.snapshot.workspace.streams['task-1'][0].chosen, 'approve');
state = applyAtelierProjectionEvent(state, event('evt-artifact', 6, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-final-summary',
    kind: 'summary',
    name: 'Final summary',
    paths: ['docs/architecture/atelier/prototype/README.md'],
    url: 'https://example.invalid/artifact',
  },
}));
state = applyAtelierProjectionEvent(state, event('evt-artifact-replace', 7, {
  kind: 'artifact.upsert',
  taskId: 'task-1',
  artifact: {
    id: 'artifact-final-summary',
    kind: 'summary',
    name: 'Final summary v2',
    previewHint: 'metadata_only',
    bodyRef: 'artifact://task-1/artifact-final-summary/body',
    bodyHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    bodySize: '256',
    bodyKind: 'markdown',
    previewTarget: {
      kind: 'markdown',
      mode: 'sandbox_manifest',
      label: 'Final summary preview',
      sandboxRef: 'atelier-sandbox://task-1/artifact-final-summary/preview',
      bodyRef: 'artifact://task-1/artifact-final-summary/body',
    },
    paths: ['apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx'],
  },
}));
state = applyAtelierProjectionEvent(state, event('evt-gate', 8, {
  kind: 'gate.upsert',
  taskId: 'task-1',
  gate: {
    id: 'gate-goalkeeper',
    status: 'passed',
    checks: [{ name: 'typecheck', status: 'passed', detail: 'tsc --noEmit passed' }],
    artifactIds: ['artifact-final-summary'],
  },
}));

assert.equal(state.snapshot.workspace.artifacts['task-1'][0].id, 'artifact-final-summary');
assert.equal(state.snapshot.workspace.artifacts['task-1'].length, 1);
assert.equal(state.snapshot.workspace.artifacts['task-1'][0].name, 'Final summary v2');
assert.equal(state.snapshot.workspace.artifacts['task-1'][0].previewHint, 'metadata_only');
assert.equal(state.snapshot.workspace.artifacts['task-1'][0].bodyRef, 'artifact://task-1/artifact-final-summary/body');
assert.equal(state.snapshot.workspace.artifacts['task-1'][0].bodyKind, 'markdown');
assert.equal(state.snapshot.workspace.artifacts['task-1'][0].previewTarget?.mode, 'sandbox_manifest');
assert.equal(state.snapshot.workspace.artifacts['task-1'][0].previewTarget?.sandboxRef, 'atelier-sandbox://task-1/artifact-final-summary/preview');
assert.equal(state.snapshot.workspace.artifacts['task-1'][0].paths[0], 'apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx');
assert.equal(state.snapshot.workspace.gates['task-1'][0].id, 'gate-goalkeeper');
assert.equal(state.snapshot.workspace.gates['task-1'][0].checks[0].detail, 'tsc --noEmit passed');
assert.equal(state.snapshot.workspace.gates['task-1'][0].artifactIds[0], 'artifact-final-summary');
`;

try {
  const esbuildPath = resolveEsbuildPath();
  const { build } = await import(pathToFileURL(esbuildPath).href);
  await build({
    stdin: {
      contents: testSource,
      resolveDir: repoRoot,
      sourcefile: 'atelier-official-frontend-gate.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    plugins: [
      {
        name: 'atelier-applet-sdk-mock',
        setup(build) {
          build.onResolve({ filter: /^@peers-touch\/applet-sdk$/ }, () => ({
            path: mockSdkPath,
          }));
        },
      },
    ],
    logLevel: 'silent',
  });
  await import(pathToFileURL(outfile).href);
  writeEvidence('PASS');
  process.stdout.write('Atelier official frontend gate passed.\n');
} catch (error) {
  writeEvidence('FAIL', error instanceof Error ? error.message : String(error));
  console.error('Atelier official frontend gate failed:');
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

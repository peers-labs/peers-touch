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
assert.ok(
  prototypePageSource.includes('Prototype-only topbar tool: terminal panel is not wired to shell or execute capability.') &&
    prototypePageSource.includes('Prototype-only topbar tool: outline panel is not wired to a real task graph panel.'),
  'Browser prototype topbar must disclose Terminal/Outline as prototype-only placeholders',
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
    appletBridgeSource.includes('ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority') &&
      appletBridgeSource.includes('projectionTaskIdResolvers') &&
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
    prototypeRuntimeSource.includes('ATELIER_DEFAULT_TASK_INTENT_PRESET') &&
      prototypeRuntimeSource.includes('ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING') &&
    prototypeRuntimeSource.includes('AtelierViewStatus') &&
    prototypeRuntimeSource.includes('export type IntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];') &&
    prototypeRuntimeSource.includes('function intentPresetMetadata(intentPreset: IntentPreset = ATELIER_DEFAULT_TASK_INTENT_PRESET)') &&
      prototypeRuntimeSource.includes('ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING[intentPreset]') &&
      prototypeRuntimeSource.includes('ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING[ATELIER_DEFAULT_TASK_INTENT_PRESET]') &&
    !prototypeRuntimeSource.includes("export type IntentPreset = 'work' | 'code' | 'design';"),
  'Browser prototype runtime createProjectFromGoal intentPreset type must derive from generated Work/Code/Design taxonomy',
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
        prototypePageSource.includes('ATELIER_AGENT_FLOW_DESCRIPTORS') &&
      prototypePageSource.includes('ATELIER_DIRECT_RUN_MODELS') &&
        prototypePageSource.includes('ATELIER_DEFAULT_AGENT_FLOW_ID') &&
      prototypePageSource.includes('ATELIER_DIRECT_RUN_MODELS.map((m) => {') &&
        prototypePageSource.includes('ATELIER_AGENT_FLOW_DESCRIPTORS.map((flow) => {') &&
      !prototypePageSource.includes('const MODELS = [') &&
        !prototypePageSource.includes('const AGENT_FLOW_DETAILS') &&
      !prototypePageSource.includes('const AGENT_FLOWS:') &&
    prototypePageSource.includes('type RunKind = RunTargetKind;') &&
      prototypePageSource.includes('useState<RunKind>(ATELIER_DEFAULT_RUN_TARGET_KIND)') &&
        prototypePageSource.includes('useState<AgentFlowId>(ATELIER_DEFAULT_AGENT_FLOW_ID)') &&
        !prototypePageSource.includes('useState<AgentFlowId>(ATELIER_AGENT_FLOW_IDS[0])') &&
      !prototypePageSource.includes('useState<RunKind>(ATELIER_RUN_TARGET_KINDS[0])') &&
      !prototypePageSource.includes("useState<RunKind>('agents')") &&
    prototypePageSource.includes('ATELIER_RUN_TARGET_KINDS.map((k) => (') &&
    !prototypePageSource.includes("type RunKind = 'model' | 'agents';") &&
    !prototypePageSource.includes("([['model', '⚡ 直接模型'], ['agents', '👥 Agents']] as const).map"),
  'Browser prototype run target kind type and tabs must derive from generated run target taxonomy',
);
assert.ok(
  prototypePageSource.includes("const run = runKind === 'model'") &&
    prototypePageSource.includes("{ kind: 'model' as const, model: state.model }") &&
    prototypePageSource.includes("{ kind: 'agents' as const, model: state.model, flowId }") &&
    !prototypePageSource.includes('run: { kind: runKind, model: state.model, flowId }'),
  'Browser prototype createProjectFromGoal must not send flowId with DirectRun model intent',
);
assert.ok(
  prototypePageSource.includes('Read-only Station provider capabilities. Click inserts a slash command; execution remains Station-owned.') &&
    prototypePageSource.includes('visibleCapabilities') &&
    prototypePageSource.includes('hiddenCapabilityCount') &&
    prototypePageSource.includes('more Station provider capability descriptors hidden in the compact prototype panel.') &&
    prototypePageSource.includes('onClick={() => onInsertCommand(capability.slashCommand)}') &&
    prototypePageSource.includes("if (!slashCommand.startsWith('/')) return;") &&
    !prototypePageSource.includes('atelier.provider.invoke') &&
    !prototypePageSource.includes('skills.invoke') &&
    !prototypePageSource.includes('provider.invoke') &&
    !prototypePageSource.includes('model.run') &&
    !prototypePageSource.includes('cli.execute'),
  'Browser prototype provider capabilities panel must stay read-only discovery and must only insert slash commands',
);
assert.ok(
  prototypePageSource.includes('Prototype run target selector only writes Station-owned run intent; the applet does not invoke providers, run models, or execute CLI.') &&
    prototypePageSource.includes("onClick={() => { onPickModel(m); setOpen(false); }}") &&
        prototypePageSource.includes("onClick={() => { onPickFlow(flow.id); setOpen(false); }}") &&
    !prototypePageSource.includes('runtime.invokeProvider') &&
    !prototypePageSource.includes('provider.invoke') &&
    !prototypePageSource.includes('model.run') &&
    !prototypePageSource.includes('runModel') &&
    !prototypePageSource.includes('cli.execute') &&
    !prototypePageSource.includes('executeCli'),
  'Browser prototype run target picker must stay Station-owned intent only and must not expose provider/model/CLI execution',
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
    prototypeDecisionCardSource.includes('if (!disabled) onChoose(b.id, o.text);') &&
    prototypeDecisionCardSource.includes('const disabled = !!b.chosen && !picked;') &&
    prototypeDecisionCardSource.includes('已选择「{b.chosen}」，Agent 继续推进。') &&
    prototypeChooseSource.includes('void runtime.resolveDecision({ taskId: selected, blockId, choice: opt }).then(applySnapshot);') &&
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
    prototypeNegoRowSource.includes('const visibleVoices = b.voices.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.negotiationVoices);') &&
    prototypeNegoRowSource.includes('const hiddenVoiceCount = Math.max(0, b.voices.length - visibleVoices.length);') &&
    prototypeNegoRowSource.includes('onClick={() => setOpen((v) => !v)}') &&
    prototypeNegoRowSource.includes('visibleVoices.map((v, i) => {') &&
    prototypeNegoRowSource.includes('more Station negotiation voices hidden in the compact prototype row.') &&
    prototypeNegoRowSource.includes('const noEvidenceObjection = v.stance ===') &&
    prototypeNegoRowSource.includes('v.evidenceRef') &&
    prototypeNegoRowSource.includes('无证据 → 降级为「疑虑」（反附和）') &&
    prototypeNegoRowSource.includes('{b.consensus}') &&
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
    prototypeEngineTraceSource.includes('Prototype-only local trace；真实编排归 Station') &&
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
      prototypeFeedbackFlowSource.includes('response.memoryCandidate.confirmationMode === ATELIER_MEMORY_CONFIRMATION_MODE') &&
      prototypeFeedbackFlowSource.includes('response.rerunIntent.confirmationMode === ATELIER_RERUN_CONFIRMATION_MODE') &&
      prototypeRuntimeSource.includes('ATELIER_MEMORY_CONFIRMATION_MODE') &&
      prototypeRuntimeSource.includes('ATELIER_RERUN_CONFIRMATION_MODE') &&
      !prototypeRuntimeSource.includes("confirmationMode: 'station_memory_review'") &&
      !prototypeRuntimeSource.includes("confirmationMode: 'station_rerun_review'") &&
    prototypeFeedbackFlowSource.includes('void runtime.confirmMemoryCandidate({ taskId: memoryConfirmationTaskId, feedbackId: memoryConfirmationFeedbackId })') &&
    prototypeFeedbackFlowSource.includes('void runtime.confirmRerun({ taskId: rerunConfirmationTaskId, feedbackId: rerunConfirmationFeedbackId })') &&
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
    !prototypePageSource.includes('openExternalUrl') &&
    !prototypePageSource.includes('shell.execute') &&
    !prototypePageSource.includes('execute.shell') &&
    !prototypePageSource.includes('file.open') &&
    !prototypePageSource.includes('workspace.file.open'),
  'Browser prototype Open in IDE must stay Host workspace.open intent only and must not expose file/shell/execute',
);
assert.ok(
  prototypePageSource.includes('Read-only Station context projection: no Workspace file discovery, no Run input_snapshot write, and no') &&
    prototypePageSource.includes('ATELIER_CONTEXT_FILE_GROUPS') &&
    prototypePageSource.includes('ATELIER_DEFAULT_CONTEXT_FILE_GROUP') &&
    prototypePageSource.includes('useState<ContextFileGroup>(ATELIER_DEFAULT_CONTEXT_FILE_GROUP)') &&
    prototypePageSource.includes('ATELIER_CONTEXT_FILE_GROUPS.map((k) =>') &&
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
    prototypePageSource.includes('Parallel policy: {project.taskGraph.parallelPolicy}') &&
    prototypePageSource.includes("project.taskGraph.parallelPolicy === 'integrator_required'") &&
    prototypePageSource.includes('visibleRootTaskIds') &&
    prototypePageSource.includes('hiddenRootTaskIdCount') &&
    prototypePageSource.includes('visibleEdges') &&
    prototypePageSource.includes('hiddenEdgeCount') &&
    prototypePageSource.includes('visibleNodeArtifactIds') &&
    prototypePageSource.includes('hiddenNodeArtifactCount') &&
    prototypePageSource.includes('visibleNodeGateIds') &&
    prototypePageSource.includes('hiddenNodeGateCount') &&
    !prototypePageSource.includes('taskGraph.schedule') &&
    !prototypePageSource.includes('taskGraph.execute') &&
    !prototypePageSource.includes('taskGraph.replan') &&
    !prototypePageSource.includes('taskGraph.diff.apply') &&
    !prototypePageSource.includes('integrator.merge.execute'),
  'Browser prototype TaskGraph panel must stay read-only Station projection and must not expose scheduling/execution/replan capabilities',
);
assert.ok(
  prototypePageSource.includes('Read-only Station project health projection. The applet does not accept, waive, or mutate project state.') &&
    prototypePageSource.includes('hiddenBlockerCount') &&
    prototypePageSource.includes('hiddenRiskCount') &&
    prototypePageSource.includes('hiddenMilestoneCount') &&
    prototypePageSource.includes('hiddenMemoryCandidateCount') &&
    prototypePageSource.includes('hiddenPolicyRuleCount') &&
    prototypePageSource.includes('hiddenDefectCount') &&
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
    prototypePageSource.includes('pageSurface.streamVisible ? stream.map(renderBlock) : null') &&
    prototypePageSource.includes('<RecoveryPanel status={recoveryStatus} onRetry={reloadWorkspace} />') &&
    prototypePageSource.includes('void runtime.loadWorkspace().then(applySnapshot);'),
  'Browser prototype recovery retry must reload projection only, keep page surface derived, and must not expose execution/rerun/provider invoke',
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
    `Browser prototype topbar placeholder must not expose ${forbiddenPrototypeTopbarCapability}`,
  );
}
assert.ok(
  prototypePreviewSource.includes('artifact.bodyHash, artifact.id, bodyRef, previewBodyRef, previewSandboxRef') &&
    prototypePreviewSource.includes('setSafeBody(null)') &&
    prototypePreviewSource.includes('setPreviewOpen(null)'),
  'Browser prototype preview must reset stale safe body and sandbox session state when Station-projected artifact refs change',
);
assert.ok(
  prototypePreviewSource.includes('function ArtifactMetadataPreview') &&
    prototypePreviewSource.includes('Metadata-only artifact preview') &&
    prototypePreviewSource.includes('Browser prototype no longer renders raw markdown, iframe, image, diff, URL, or source fields from projection') &&
    prototypePreviewSource.includes('<ArtifactMetadataPreview artifact={artifact} />') &&
    !prototypePreviewSource.includes('artifact.markdown') &&
    !prototypePreviewSource.includes('artifact.url') &&
    !prototypePreviewSource.includes('artifact.src') &&
    !prototypePreviewSource.includes('<iframe') &&
    !prototypePreviewSource.includes('<img'),
  'Browser prototype artifact preview must stay metadata-only and must not render raw artifact projection fields',
);
assert.ok(
  prototypePreviewSource.includes('Prototype-only mock logs: real Run runtime stream is not wired.') &&
    prototypePreviewSource.includes('artifact.logs.map') &&
    !prototypePreviewSource.includes('runtime.logs.subscribe') &&
    !prototypePreviewSource.includes('atelier.logs.subscribe') &&
    !prototypePreviewSource.includes('console.logs.subscribe'),
  'Browser prototype Console Logs panel must disclose mock logs and must not wire runtime log subscription',
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
    prototypePluginsSource.includes('ATELIER_TASK_ORGANIZER_MODES.map') &&
    prototypePluginsSource.includes('ready: mode.ready') &&
    prototypePluginsSource.includes('ATELIER_DEFAULT_TASK_ORGANIZER_MODE') &&
    prototypePluginsSource.includes('export const DEFAULT_PLUGIN_ID = ATELIER_DEFAULT_TASK_ORGANIZER_MODE;') &&
    prototypePluginsSource.includes('export function resolveTaskPlugin(pluginId: string): TaskPlugin') &&
    prototypePluginsSource.includes('item.id === DEFAULT_PLUGIN_ID') &&
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
  prototypePluginsSource.includes("if (key === 'archive') host.setStatus(t.id, 'archived');") &&
    prototypePluginsSource.includes("else if (key === 'delete') host.setStatus(t.id, 'deleted');") &&
    prototypePluginsSource.includes("else if (key === 'restore') host.setStatus(t.id, 'active');") &&
    prototypePluginsSource.includes('host.requestPurge(t.id);') &&
    prototypePluginsSource.includes('host.purge(t.id);') &&
    prototypePluginsSource.includes('Station 仍会校验任务处于 deleted 后才允许 purge。') &&
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
import { derivePrototypePageSurface, derivePrototypeRecoveryView, prototypeStatusForScenario, resolvePrototypeStatusScenario } from './packages/prototypes/desktop/applets/atelier/src/prototypeRecoveryView.ts';
import {
  ATELIER_PROJECTION_EVENT_TOPIC,
  ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
  ATELIER_PROTOTYPE_RECOVERY_SEVERITY_BY_STATUS,
  ATELIER_PROTOTYPE_RECOVERY_SYMBOL_BY_STATUS,
  ATELIER_RECOVERY_RETRYABLE_KINDS,
  ATELIER_VIEW_STATUSES,
} from './packages/prototypes/desktop/applets/atelier/src/projection.contract.generated.ts';

const providerCapabilityMalformedResponseFixtures = ${JSON.stringify(malformedResponseFixtures.providerCapabilities, null, 2)};
const nonArtifactCapabilityMalformedResponseFixtures = ${JSON.stringify(malformedResponseFixtures.nonArtifactCapabilities, null, 2)};
const artifactBodyMalformedResponseFixtures = ${JSON.stringify(malformedResponseFixtures.artifactBody, null, 2)};
const artifactPreviewMalformedResponseFixtures = ${JSON.stringify(malformedResponseFixtures.artifactPreview, null, 2)};

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
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: -1, hasMore: false } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false, checkpointId: '' } } },
    { replay: { 'task-1': { source: 'checkpoint', eventCount: 1, replayedEventCount: 1, nextEventSeq: 2, hasMore: false, checkpointEventSeq: -1 } } },
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
  const authHarness = bridgeWithCall(async () => {
    throw new Error('PERMISSION_DENIED unauthorized');
  });
  const authRuntime = createBridgeAtelierRuntime({
    bridge: authHarness.bridge,
    initialSnapshot: snapshot(''),
  });
  const authSnapshot = await authRuntime.loadWorkspace();
  assert.equal(authSnapshot.status?.kind, 'auth-denied');

  const disconnectedHarness = bridgeWithCall(async () => {
    throw new Error('network stream disconnected');
  });
  const disconnectedRuntime = createBridgeAtelierRuntime({
    bridge: disconnectedHarness.bridge,
    initialSnapshot: snapshot(''),
  });
  const disconnectedSnapshot = await disconnectedRuntime.loadWorkspace();
  assert.equal(disconnectedSnapshot.status?.kind, 'disconnected');

  const invalidHarness = bridgeWithCall(async () => ({ version: ${JSON.stringify(contract.version)} }));
  const invalidRuntime = createBridgeAtelierRuntime({
    bridge: invalidHarness.bridge,
    initialSnapshot: snapshot(''),
  });
  const invalidSnapshot = await invalidRuntime.loadWorkspace();
  assert.equal(invalidSnapshot.status?.kind, 'error');
}

async function testAppletBridgeNormalizesHostErrorEnvelopes() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const hostErrorCases = [
    {
      name: 'resolved forbidden error envelope',
      response: { error: { code: 'FORBIDDEN', message: 'Station denied Atelier projection access' } },
      expectedStatus: 'auth-denied',
      expectedMessage: /FORBIDDEN Station denied Atelier projection access/,
    },
    {
      name: 'rejected network error object',
      reject: { code: 'NETWORK_DISCONNECTED', message: 'Station projection stream disconnected' },
      expectedStatus: 'disconnected',
      expectedMessage: /NETWORK_DISCONNECTED Station projection stream disconnected/,
    },
    {
      name: 'rejected Error with code property',
      reject: Object.assign(new Error('Desktop Host request timed out'), { code: 'TIMEOUT' }),
      expectedStatus: 'disconnected',
      expectedMessage: /TIMEOUT Desktop Host request timed out/,
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
      () => createAppletSdkAtelierBridge(host).call({ method: 'atelier.workspace.load', payload: {} }),
      testCase.expectedMessage,
      testCase.name,
    );
  }
}

async function testBridgeNonSnapshotErrorsUpdateStatus() {
  const harness = bridgeWithCall(async (request) => {
    assert.equal(request.method, 'atelier.provider.capabilities');
    throw new Error('FORBIDDEN provider discovery');
  });
  const runtime = createBridgeAtelierRuntime({
    bridge: harness.bridge,
    initialSnapshot: snapshot('task-1'),
  });
  await assert.rejects(
    () => runtime.listProviderCapabilities({ taskId: 'task-1' }),
    /FORBIDDEN provider discovery/,
  );
  assert.equal(runtime.getSnapshot().status?.kind, 'auth-denied');
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
    ['disconnected query scenario', '?atelierStatus=disconnected', { kind: 'disconnected', retryable: true }],
    ['auth-denied query scenario', '?atelierStatus=auth-denied', { kind: 'auth-denied', retryable: false }],
  ];
  for (const [name, search, expected] of scenarioCases) {
    const scenario = resolvePrototypeStatusScenario(search);
    assert.equal(scenario, expected.kind, 'prototype controlled status scenario query failed: ' + name);
    const status = prototypeStatusForScenario(scenario);
    assert.equal(status.kind, expected.kind, 'prototype controlled status scenario kind failed: ' + name);
    assert.equal(status.retryable, expected.retryable, 'prototype controlled status scenario retry boundary failed: ' + name);
  }
  assert.equal(resolvePrototypeStatusScenario('?atelierStatus=execute'), undefined, 'prototype controlled status scenario must reject execution-shaped status');
  assert.equal(resolvePrototypeStatusScenario('?atelierStatus=runtime.logs.subscribe'), undefined, 'prototype controlled status scenario must reject runtime capability-shaped status');
}

async function testRuntimeBootstrapNormalizesProjectionStreamConfig() {
  const { normalizeProjectionStreamConfig } = await import('./packages/prototypes/desktop/applets/atelier/src/runtimeBootstrap.ts');
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

async function testAppletBridgeUnsubscribesProjectionTopicAndStream() {
  const { createAppletSdkAtelierBridge } = await import('./packages/prototypes/desktop/applets/atelier/src/appletBridge.ts');
  const initialSnapshot = snapshot('task-cleanup');
  const harness = appletHostWithEventTracking(initialSnapshot);
  const bridge = createAppletSdkAtelierBridge(harness.host, {
    projectionStream: { agentId: 'agent-cleanup', taskId: 'task-cleanup', afterEventSeq: 7 },
    initialSnapshot,
  });

  const unsubscribe = bridge.subscribeProjection(() => {});
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

  unsubscribe();
  assert.deepEqual(harness.eventUnsubscriptions.map((entry) => entry.topic), [ATELIER_PROJECTION_EVENT_TOPIC]);
  assert.deepEqual(harness.calls.at(-1), {
    method: 'events.unsubscribe',
    params: { topic: ATELIER_PROJECTION_EVENT_TOPIC },
  });
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
}

await testProjectionGuards();
await testBridgeRejectsMalformedInitialSnapshot();
await testBridgeLoadAndEventReplay();
await testBridgeDedupeCacheEvictsBoundedlyAndSeqGuardRejectsReplay();
await testBridgeRejectsStaleSeqPerScopeOnly();
await testBridgeRejectsMismatchedEventPatchTaskScopeAndRecovers();
await testBridgeSubscriptionReferenceLifecycle();
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
await testAppletBridgeNormalizesHostErrorEnvelopes();
await testBridgeNonSnapshotStaleSuccessDoesNotClearNewerError();
await testBridgeNonSnapshotStaleFailureDoesNotClearNewerSuccess();
await testBridgeSnapshotStaleSuccessDoesNotOverwriteNewerSnapshot();
await testBridgeSnapshotStaleFailureDoesNotClearNewerSnapshot();
await testBridgeNonSnapshotErrorsUpdateStatus();
await testBridgeNonSnapshotSuccessRestoresStatus();
testPrototypeRecoveryViewMatrix();
await testRuntimeBootstrapNormalizesProjectionStreamConfig();
await testAppletBridgeUsesReplayCursor();
await testAppletBridgeOmitsEmptyReplayCursorFields();
await testAppletBridgeExplicitProjectionStreamIntentWinsOverSnapshotCursor();
await testAppletBridgeUnsubscribesProjectionTopicAndStream();
await testAppletBridgeCorrelatesCustomProjectionTopicAcrossLifecycle();
await testAppletBridgeHandlesRejectedSubscriptionInvokes();
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
  console.log('Atelier bridge runtime gate passed.');
} catch (error) {
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

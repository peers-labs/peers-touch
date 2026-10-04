import { useEffect, useRef, useState, type ReactNode } from 'react';
import { sdk } from '@peers-touch/applet-sdk';
import type {
  AtelierArtifactProjection,
  AtelierBudgetProjection,
  AtelierContextFile,
  AtelierDecisionOption,
  AtelierGateProjection,
  AtelierNegoVoice,
  AtelierProjectProjection,
  AtelierStreamBlock,
  AtelierTask,
  AtelierTaskContext,
  AtelierTaskNodeProjection,
  AtelierTodoItem,
} from '../../domain/projection';
import { useAtelierController, type AtelierTaskActionKind } from '../../application/useAtelierController';
import { deriveOfficialCenteredStateView } from '../../application/centeredStateView';
import { deriveAtelierPageSurface } from '../../application/pageComposition';
import {
  deriveOfficialRecoveryView,
  deriveOfficialStatusActionPolicy,
} from '../../application/officialRecoveryView';
import { deriveOfficialStatusNoticeView } from '../../application/statusNoticeView';
import { deriveOfficialStatusPillView } from '../../application/statusPillView';
import { deriveAtelierTaskGraphNodeEvidenceView } from '../../application/taskGraphEvidenceRefs';
import type {
  AtelierArtifactBodyResponse,
  AtelierArtifactPreviewOpenResponse,
  AtelierErrorKind,
  AtelierFeedbackSignal,
  AtelierIntentPreset,
  AtelierProviderCapability,
  AtelierRunTargetKind,
} from '../../infrastructure/capability/atelierClient';
import {
  ATELIER_AGENT_FLOW_DESCRIPTORS,
    ATELIER_CONTEXT_FILE_GROUPS,
    ATELIER_DEFAULT_CONTEXT_FILE_GROUP,
  ATELIER_DIRECT_RUN_MODELS,
  ATELIER_FEEDBACK_SIGNALS,
  ATELIER_GATE_STATUSES,
    ATELIER_DEFAULT_TASK_ORGANIZER_MODE,
  ATELIER_PROJECTION_DISPLAY_LIMITS,
  ATELIER_RUN_TARGET_KINDS,
  ATELIER_TASK_ORGANIZER_MODES,
  ATELIER_TASK_INTENT_PRESETS,
  type AtelierAgentFlowId,
  ATELIER_TASK_LIFECYCLE_STATES,
  type AtelierStatusNoticeKind,
  type AtelierTaskOrganizerMode,
  type AtelierTaskLifecycleStatus,
  type AtelierViewStatus,
} from '../../domain/projection.contract.generated';
import { trackAtelierArtifactGateRendered, trackAtelierArtifactPreviewOpened, trackAtelierCreatedProjectRendered, trackAtelierDecisionResolvedRendered } from '../../infrastructure/capability/atelierClient';
import { t } from '../../infrastructure/i18n/messages';

const colors = {
  background: '#f5f7fb',
  panel: '#ffffff',
  elevated: '#f8fafc',
  border: '#e5e7eb',
  text: '#111827',
  muted: '#6b7280',
  subtle: '#9ca3af',
  primary: '#2563eb',
  primarySoft: '#eff6ff',
  info: '#2563eb',
  infoSoft: '#eff6ff',
  warning: '#b45309',
  warningSoft: '#fffbeb',
  danger: '#dc2626',
  dangerSoft: '#fef2f2',
  success: '#0f766e',
  successSoft: '#ecfdf5',
};

const px = (value: number) => `${value}px`;

const INTENT_PRESET_LABEL_KEYS: Record<AtelierIntentPreset, { labelKey: string; hintKey: string }> = {
  work: { labelKey: 'atelier.intentPreset.work', hintKey: 'atelier.intentPreset.workHint' },
  code: { labelKey: 'atelier.intentPreset.code', hintKey: 'atelier.intentPreset.codeHint' },
  design: { labelKey: 'atelier.intentPreset.design', hintKey: 'atelier.intentPreset.designHint' },
};
const FEEDBACK_SIGNAL_LABEL_KEYS: Record<AtelierFeedbackSignal, string> = {
  positive: 'atelier.feedback.positive',
  negative: 'atelier.feedback.negative',
  copy: 'atelier.feedback.copy',
  regenerate: 'atelier.feedback.regenerate',
};

type ErrorKind = AtelierErrorKind | '';
  type ContextFileGroup = (typeof ATELIER_CONTEXT_FILE_GROUPS)[number];
type TaskOrganizerMode = AtelierTaskOrganizerMode;
type AtelierGateStatus = (typeof ATELIER_GATE_STATUSES)[number];
const GATE_STATUS_PASSED: AtelierGateStatus = 'passed';
  const CONTEXT_FILE_GROUP_LABEL_KEYS = {
    files: 'atelier.context.files',
    other: 'atelier.context.other',
  } satisfies Record<ContextFileGroup, string>;
  const CONTEXT_FILE_GROUP_MORE_KEYS = {
    files: 'atelier.context.moreFiles',
    other: 'atelier.context.moreOther',
  } satisfies Record<ContextFileGroup, string>;
  const CONTEXT_FILE_GROUP_DISPLAY_LIMITS = {
    files: ATELIER_PROJECTION_DISPLAY_LIMITS.contextFileRefs,
    other: ATELIER_PROJECTION_DISPLAY_LIMITS.contextOtherRefs,
  } satisfies Record<ContextFileGroup, number>;
  const OFFICIAL_CONTEXT_FILE_GROUPS = [
    ATELIER_DEFAULT_CONTEXT_FILE_GROUP,
    ...ATELIER_CONTEXT_FILE_GROUPS.filter((group) => group !== ATELIER_DEFAULT_CONTEXT_FILE_GROUP),
  ] satisfies ContextFileGroup[];

const NEGO_ROLE_COLORS: Record<string, string> = {
  GoalOwner: '#d97706',
  Architect: '#1d4ed8',
  Planner: '#2563eb',
  Risk: '#dc2626',
  Supervisor: '#7c3aed',
  Executor: '#0f766e',
  Verifier: '#16a34a',
  Integrator: '#be185d',
  Historian: '#6b7280',
};

const NEGO_STANCE_LABELS: Record<string, string> = {
  proposal: 'proposal',
  objection: 'objection',
  counter: 'counter',
  signoff: 'signoff',
};

export function AtelierAppletPage() {
  const controller = useAtelierController();
    const [taskOrganizerMode, setTaskOrganizerMode] = useState<TaskOrganizerMode>(ATELIER_DEFAULT_TASK_ORGANIZER_MODE);
  const snapshot = controller.snapshot;
  const tasks = snapshot?.workspace.tasks ?? [];
  const pageSurface = deriveAtelierPageSurface({
    error: controller.error,
    loading: controller.loading,
    taskCount: tasks.length,
    viewStatus: controller.viewStatus,
  });
  const statusActionPolicy = deriveOfficialStatusActionPolicy({
    error: controller.error,
    errorKind: controller.errorKind,
    loading: controller.loading,
    taskCount: tasks.length,
    viewStatus: controller.viewStatus,
  });
  const selectedBlocks = snapshot?.workspace.streams[controller.selectedTaskId] ?? [];
  const workspaceArtifacts = snapshot?.workspace.artifacts ?? {};
  const workspaceGates = snapshot?.workspace.gates ?? {};
  const visibleSelectedBlocks = selectedBlocks.slice(-8);
  const hiddenStreamBlockCount = Math.max(0, selectedBlocks.length - visibleSelectedBlocks.length);
  const renderedProjectionEvidenceRef = useRef('');
  const renderedCreatedProjectEvidenceRef = useRef('');
  const renderedDecisionResolutionEvidenceRef = useRef('');
  const renderedArtifactGateEvidenceRef = useRef('');
  const renderedArtifactPreviewOpenEvidenceRef = useRef('');
  const budgetLabel = snapshot
    ? `${snapshot.workspace.budget?.summary ?? `${snapshot.workspace.budgetSpent}/${snapshot.workspace.budgetCap}`} · ${snapshot.workspace.model}`
    : t('atelier.budget.unknown');

  useEffect(() => {
    const event = controller.lastAppliedProjectionEvent;
    if (!event || !('taskId' in event.patch) || event.patch.taskId !== controller.selectedTaskId) {
      return;
    }
    const renderedBlockIds = selectedBlocks.map((block) => block.id);
    const eventBlockIds = event.patch.kind === 'stream.append'
      ? event.patch.blocks.map((block) => block.id)
      : event.patch.kind === 'snapshot.invalidate'
        ? renderedBlockIds.filter((blockId) => blockId === event.id)
        : [];
    if (eventBlockIds.length === 0) {
      return;
    }
    if (!eventBlockIds.every((blockId) => renderedBlockIds.includes(blockId))) {
      return;
    }
    const evidenceKey = `${event.id}:${event.seq}:${renderedBlockIds.join(',')}`;
    if (renderedProjectionEvidenceRef.current === evidenceKey) {
      return;
    }
    renderedProjectionEvidenceRef.current = evidenceKey;
    void sdk.telemetry.track({
      name: 'atelier.projection.rendered',
      properties: {
        taskId: event.patch.taskId,
        eventId: event.id,
        eventSeq: event.seq,
        patchKind: event.patch.kind,
        eventBlockIds,
        renderedBlockIds,
        streamCount: selectedBlocks.length,
        replayLabel: controller.replayLabel,
        selectedTaskTitle: controller.selectedTask?.title ?? '',
        viewStatus: controller.viewStatus,
      },
    }).catch(() => undefined);
  }, [
    controller.lastAppliedProjectionEvent,
    controller.replayLabel,
    controller.selectedTask?.title,
    controller.selectedTaskId,
    controller.viewStatus,
    selectedBlocks,
  ]);

  useEffect(() => {
    const evidence = controller.createdProjectRenderEvidence;
    if (!evidence || evidence.taskId !== controller.selectedTaskId || !snapshot) {
      return;
    }
    const createdTask = tasks.find((task) => task.id === evidence.taskId);
    if (!createdTask) {
      return;
    }
    const createdProject = snapshot.workspace.projects?.find((project) => project.id === createdTask.projectId);
    if (!createdProject) {
      return;
    }
    const eventSeq = snapshot.workspace.replay?.[evidence.taskId]?.nextEventSeq ?? 0;
    if (eventSeq <= 0) {
      return;
    }
    const evidenceKey = `${evidence.taskId}:${eventSeq}:${createdProject.taskGraph.tasks.length}`;
    if (renderedCreatedProjectEvidenceRef.current === evidenceKey) {
      return;
    }
    renderedCreatedProjectEvidenceRef.current = evidenceKey;
    void trackAtelierCreatedProjectRendered({
      taskId: evidence.taskId,
      goal: evidence.goal,
      taskTitle: createdTask.title,
      taskCount: tasks.length,
      nodeCount: createdProject.taskGraph.tasks.length,
      eventSeq,
      runKind: evidence.runKind,
    }).catch(() => undefined);
  }, [
    controller.createdProjectRenderEvidence,
    controller.selectedTaskId,
    snapshot,
    tasks,
  ]);

  useEffect(() => {
    if (!snapshot || !controller.selectedTask) {
      return;
    }
    const renderedArtifacts = controller.selectedArtifacts;
    const renderedGates = controller.selectedGates;
    if (renderedArtifacts.length === 0 || renderedGates.length === 0) {
      return;
    }
    const eventSeq = snapshot.workspace.replay?.[controller.selectedTaskId]?.nextEventSeq ?? 0;
    if (eventSeq <= 0) {
      return;
    }
    const gateStatuses = renderedGates
      .map((gate) => gate.status ?? '')
      .filter((status, index, values) => status && values.indexOf(status) === index);
    const evidenceKey = `${controller.selectedTaskId}:${eventSeq}:${renderedArtifacts.map((artifact) => artifact.id).join(',')}:${renderedGates.map((gate) => gate.id).join(',')}`;
    if (renderedArtifactGateEvidenceRef.current === evidenceKey) {
      return;
    }
    renderedArtifactGateEvidenceRef.current = evidenceKey;
    void trackAtelierArtifactGateRendered({
      taskId: controller.selectedTaskId,
      taskTitle: controller.selectedTask.title,
      eventSeq,
      artifactCount: renderedArtifacts.length,
      artifactIds: renderedArtifacts.map((artifact) => artifact.id),
      gateCount: renderedGates.length,
      gateIds: renderedGates.map((gate) => gate.id),
      gateStatuses,
      failedGateCount: renderedGates.filter((gate) => gate.status === 'failed').length,
    }).catch(() => undefined);
  }, [
    controller.selectedArtifacts,
    controller.selectedGates,
    controller.selectedTask,
    controller.selectedTaskId,
    snapshot,
  ]);

  useEffect(() => {
    const evidence = controller.decisionResolutionRenderEvidence;
    if (!evidence || evidence.taskId !== controller.selectedTaskId || !snapshot) {
      return;
    }
    const resolvedBlock = selectedBlocks.find((block) =>
      block.kind === 'decision' &&
      block.id === evidence.blockId &&
      block.chosen === evidence.choice
    );
    if (!resolvedBlock) {
      return;
    }
    const task = tasks.find((candidate) => candidate.id === evidence.taskId);
    if (!task) {
      return;
    }
    const eventSeq = snapshot.workspace.replay?.[evidence.taskId]?.nextEventSeq ?? 0;
    if (eventSeq <= 0) {
      return;
    }
    const renderedArtifacts = snapshot.workspace.artifacts[evidence.taskId] ?? [];
    const renderedGates = snapshot.workspace.gates?.[evidence.taskId] ?? [];
    const renderedGateStatuses = renderedGates
      .map((gate) => gate.status ?? '')
      .filter((status, index, values) => status && values.indexOf(status) === index);
    const evidenceKey = `${evidence.taskId}:${evidence.blockId}:${evidence.choice}:${eventSeq}:${renderedArtifacts.length}:${renderedGates.length}`;
    if (renderedDecisionResolutionEvidenceRef.current === evidenceKey) {
      return;
    }
    renderedDecisionResolutionEvidenceRef.current = evidenceKey;
    void trackAtelierDecisionResolvedRendered({
      taskId: evidence.taskId,
      blockId: evidence.blockId,
      choice: evidence.choice,
      taskTitle: task.title,
      eventSeq,
      streamCount: selectedBlocks.length,
      artifactCount: renderedArtifacts.length,
      artifactIds: renderedArtifacts.map((artifact) => artifact.id),
      gateCount: renderedGates.length,
      gateIds: renderedGates.map((gate) => gate.id),
      gateStatuses: renderedGateStatuses,
      failedGateCount: renderedGates.filter((gate) => gate.status === 'failed').length,
    }).catch(() => undefined);
  }, [
    controller.decisionResolutionRenderEvidence,
    controller.selectedTaskId,
    selectedBlocks,
    snapshot,
    tasks,
  ]);

  useEffect(() => {
    const response = controller.artifactPreviewOpenResponse;
    const artifact = controller.selectedArtifact;
    if (!response || !artifact || response.artifactId !== artifact.id || response.taskId !== controller.selectedTaskId) {
      return;
    }
    const sandboxRef = artifact.previewTarget?.sandboxRef ?? response.sandboxRef;
    const bodyRef = artifact.previewTarget?.bodyRef ?? artifact.bodyRef ?? response.bodyRef;
    if (!sandboxRef || !bodyRef) {
      return;
    }
    const evidenceKey = `${response.taskId}:${response.artifactId}:${response.rendererSessionId}:${response.rendererStatus}`;
    if (renderedArtifactPreviewOpenEvidenceRef.current === evidenceKey) {
      return;
    }
    renderedArtifactPreviewOpenEvidenceRef.current = evidenceKey;
    void trackAtelierArtifactPreviewOpened({
      taskId: response.taskId,
      artifactId: response.artifactId,
      rendererSessionId: response.rendererSessionId,
      rendererOwner: response.rendererOwner,
      rendererMode: response.rendererMode,
      rendererStatus: response.rendererStatus,
      rendererCapabilities: response.rendererCapabilities,
      sandboxRef,
      bodyRef,
      accepted: response.accepted,
      prepared: response.prepared,
      opened: response.opened,
    }).catch(() => undefined);
  }, [
    controller.artifactPreviewOpenResponse,
    controller.selectedArtifact,
    controller.selectedTaskId,
  ]);

  return (
    <page style={{ backgroundColor: colors.background }}>
      <view style={{ flex: 1, backgroundColor: colors.background, padding: px(18) }}>
        <view style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(18), borderWidth: px(1), padding: px(16), marginBottom: px(14) }}>
          <view style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <view style={{ flex: 1, marginRight: px(12) }}>
              <text style={{ color: colors.primary, fontSize: px(11), fontWeight: '700', marginBottom: px(4) }}>{t('atelier.badge')}</text>
              <text style={{ color: colors.text, fontSize: px(26), fontWeight: '700' }}>{t('atelier.title')}</text>
              <text style={{ color: colors.muted, fontSize: px(13), lineHeight: px(20), marginTop: px(5) }}>{t('atelier.subtitle')}</text>
            </view>
            <StatusPill status={controller.viewStatus} />
          </view>
          <BudgetBar budget={snapshot?.workspace.budget} fallbackPercent={controller.budgetPercent} label={budgetLabel} />
          {controller.selectedTask?.migrationState ? (
            <view
              data-pt-collaboration-migration={controller.selectedTask.migrationState}
              data-pt-migration-goal-id={controller.selectedTask.goalId}
              data-pt-migration-source-id={controller.selectedTask.legacySourceId}
              style={{ backgroundColor: controller.selectedTask.migrationState === 'blocked' ? colors.warningSoft : colors.successSoft, borderRadius: px(8), marginTop: px(10), padding: px(8) }}
            >
              <text style={{ color: controller.selectedTask.migrationState === 'blocked' ? colors.warning : colors.success, fontSize: px(11), fontWeight: '700' }}>
                {t(`atelier.migration.${controller.selectedTask.migrationState}`)}
              </text>
              <text style={{ color: colors.muted, fontSize: px(10), marginTop: px(3) }}>
                {controller.selectedTask.migrationState === 'migrated'
                  ? `${t('atelier.migration.goalId')}: ${controller.selectedTask.goalId}`
                  : `${t('atelier.migration.blockReason')}: ${controller.selectedTask.migrationBlockReason}`}
              </text>
            </view>
          ) : null}
        </view>

        {pageSurface.globalErrorVisible ? (
          <ErrorPanel
            kind={controller.errorKind}
            message={controller.error}
            retryVisible={statusActionPolicy.retryVisible}
            onRetry={controller.load}
          />
        ) : null}
        {pageSurface.typedRecoveryKind ? (
          <ErrorPanel
            kind={pageSurface.typedRecoveryKind}
            message={controller.eventStreamError}
            retryVisible={statusActionPolicy.retryVisible}
            onRetry={controller.load}
          />
        ) : null}
        {pageSurface.statusNotice ? (
          <StatusNotice status={pageSurface.statusNotice} detail={controller.eventStreamError} />
        ) : null}

        {pageSurface.loadingVisible ? (
          <CenteredState
            {...deriveOfficialCenteredStateView('loading')}
          />
        ) : null}

        {pageSurface.emptyVisible ? (
          <view>
            <CenteredState {...deriveOfficialCenteredStateView('empty')} />
            {statusActionPolicy.createProjectVisible ? (
              <GoalComposer
                creating={controller.creatingProject}
                flowId={controller.selectedFlowId}
                intentPreset={controller.selectedIntentPreset}
                model={controller.selectedModel}
                revision={controller.goalRevision}
                runKind={controller.selectedRunKind}
                text={controller.goalDraft}
                onChange={controller.setGoalDraft}
                onCreate={controller.createProject}
                onFlowIdChange={controller.setSelectedFlowId}
                onIntentPresetChange={controller.setSelectedIntentPreset}
                onModelChange={controller.setSelectedModel}
                onRunKindChange={controller.setSelectedRunKind}
              />
            ) : null}
          </view>
        ) : null}

        {pageSurface.mainContentVisible ? (
          <view style={{ flex: 1, flexDirection: 'column', minHeight: px(0) }}>
            <view style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(16), borderWidth: px(1), marginBottom: px(12), minWidth: px(0), padding: px(12), width: '100%' }}>
              <SectionTitle title={t('atelier.section.tasks')} detail={`${tasks.length}`} />
              <GoalComposer
                creating={controller.creatingProject}
                compact
                flowId={controller.selectedFlowId}
                intentPreset={controller.selectedIntentPreset}
                model={controller.selectedModel}
                revision={controller.goalRevision}
                runKind={controller.selectedRunKind}
                text={controller.goalDraft}
                onChange={controller.setGoalDraft}
                onCreate={controller.createProject}
                onFlowIdChange={controller.setSelectedFlowId}
                onIntentPresetChange={controller.setSelectedIntentPreset}
                onModelChange={controller.setSelectedModel}
                onRunKindChange={controller.setSelectedRunKind}
              />
              <ProviderCapabilitiesPanel
                capabilities={controller.providerCapabilities}
                error={controller.providerCapabilitiesError}
                loading={controller.providerCapabilitiesLoading}
                source={controller.providerCapabilitiesSource}
                onInsertCommand={controller.insertProviderCapabilityCommand}
              />
              <TaskOrganizerPanel
                actionId={controller.taskActionId}
                actionKind={controller.taskActionKind}
                mode={taskOrganizerMode}
                purgeConfirmTaskId={controller.purgeConfirmTaskId}
                selectedTaskId={controller.selectedTaskId}
                tasks={tasks}
                onModeChange={setTaskOrganizerMode}
                onSelectTask={controller.selectTask}
                onTaskAction={controller.setTaskLifecycle}
              />
            </view>

            <view style={{ flex: 1, marginBottom: px(12), minWidth: px(0), width: '100%' }}>
              <view style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(16), borderWidth: px(1), padding: px(14), marginBottom: px(12) }}>
                <SectionTitle title={controller.selectedTask?.title ?? t('atelier.task.untitled')} detail={controller.selectedTask?.project ?? ''} />
                <WorkspaceOpenButton
                  disabled={Boolean(controller.workspaceOpenSubmittingId)}
                  status={controller.workspaceOpenStatus}
                  task={controller.selectedTask}
                  onOpen={controller.openWorkspace}
                />
                <TopbarToolBoundary />
                <view style={{ flexDirection: 'row', marginTop: px(12) }}>
                  <Metric label={t('atelier.metric.stream')} value={`${controller.streamCount}`} />
                  <Metric label={t('atelier.metric.artifacts')} value={`${controller.artifactCount}`} />
                  <Metric label={t('atelier.metric.gates')} value={`${controller.gateCount}`} />
                </view>
                <view style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(12), borderWidth: px(1), padding: px(10), marginTop: px(12) }}>
                  <text style={{ color: colors.subtle, fontSize: px(11), marginBottom: px(4) }}>{t('atelier.replay.title')}</text>
                  <text style={{ color: colors.muted, fontSize: px(12) }}>{controller.replayLabel}</text>
                </view>
                <TaskLifecycleBar
                  task={controller.selectedTask}
                  actionId={controller.taskActionId}
                  actionKind={controller.taskActionKind}
                  purgeConfirmTaskId={controller.purgeConfirmTaskId}
                  onAction={controller.setTaskLifecycle}
                />
              </view>

              <view style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(16), borderWidth: px(1), flex: 1, padding: px(14) }}>
                <SectionTitle title={t('atelier.section.stream')} detail={`${selectedBlocks.length}`} />
                <view style={{ marginTop: px(8) }}>
                  {visibleSelectedBlocks.map((block) => (
                    <StreamRow
                      key={block.id}
                      block={block}
                      feedbackStatus={controller.feedbackStatusBlockId === block.id ? controller.feedbackStatus : ''}
                      feedbackSubmittingId={controller.feedbackSubmittingId}
                      memoryConfirmationFeedbackId={controller.memoryConfirmationBlockId === block.id ? controller.memoryConfirmationFeedbackId : ''}
                      memoryConfirming={controller.memoryConfirmationBlockId === block.id && controller.memoryConfirming}
                      rerunConfirmationFeedbackId={controller.rerunConfirmationBlockId === block.id ? controller.rerunConfirmationFeedbackId : ''}
                      rerunConfirming={controller.rerunConfirmationBlockId === block.id && controller.rerunConfirming}
                      resolving={controller.resolvingDecisionId === block.id}
                      taskId={controller.selectedTaskId}
                      onSubmitFeedback={controller.submitFeedback}
                      onConfirmMemoryCandidate={controller.confirmMemoryCandidate}
                      onConfirmRerun={controller.confirmRerun}
                      onResolveDecision={controller.resolveDecision}
                    />
                  ))}
                  {hiddenStreamBlockCount > 0 ? (
                    <text style={{ color: colors.subtle, fontSize: px(11), lineHeight: px(16), marginBottom: px(8) }}>
                      +{hiddenStreamBlockCount} {t('atelier.stream.moreProjected')}
                    </text>
                  ) : null}
                  {selectedBlocks.length === 0 ? (
                    <text style={{ color: colors.subtle, fontSize: px(13) }}>{t('atelier.stream.empty')}</text>
                  ) : null}
                </view>
              </view>
              <ArtifactTray
                artifacts={controller.selectedArtifacts}
                selectedArtifactId={controller.selectedArtifactId}
                onSelectArtifact={controller.selectArtifact}
              />
              <MessageComposer
                disabled={!controller.selectedTaskId || controller.sendingMessage}
                revision={controller.composerRevision}
                sending={controller.sendingMessage}
                text={controller.composerText}
                onChange={controller.setComposerText}
                onSend={controller.sendMessage}
              />
            </view>

            <view style={{ minWidth: px(0), width: '100%' }}>
              {controller.selectedProject ? (
                <>
                  <ProjectHealthPanel project={controller.selectedProject} />
                  <TaskGraphPanel
                    artifactsByTask={workspaceArtifacts}
                    gatesByTask={workspaceGates}
                    project={controller.selectedProject}
                  />
                </>
              ) : (
                <TodoPanel todos={controller.selectedTodos} />
              )}
              <ContextPanel context={controller.selectedContext} />
              <ArtifactPanel
                artifacts={controller.selectedArtifacts}
                selectedArtifactId={controller.selectedArtifactId}
                onSelectArtifact={controller.selectArtifact}
              />
              <ArtifactPreviewPanel
                artifact={controller.selectedArtifact}
                body={controller.artifactBody}
                bodyError={controller.artifactBodyError}
                previewOpenResponse={controller.artifactPreviewOpenResponse}
                previewOpenError={controller.artifactPreviewOpenError}
                loading={controller.artifactBodyFetchId === `${controller.selectedTaskId}:${controller.selectedArtifactId}`}
                previewOpening={controller.artifactPreviewOpenId === `${controller.selectedTaskId}:${controller.selectedArtifactId}`}
                taskId={controller.selectedTaskId}
                onFetchBody={controller.fetchArtifactBody}
                onOpenPreview={controller.openArtifactPreview}
              />
              <GatePanel gates={controller.selectedGates} />
            </view>
          </view>
        ) : null}
      </view>
    </page>
  );
}

function TopbarToolBoundary() {
  return (
    <view style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: px(10) }}>
      <ToolBoundaryPill label={t('atelier.tool.terminal')} detail={t('atelier.tool.terminalUnsupported')} />
      <ToolBoundaryPill label={t('atelier.tool.outline')} detail={t('atelier.tool.outlineUnsupported')} />
    </view>
  );
}

function ToolBoundaryPill({ label, detail }: { label: string; detail: string }) {
  return (
    <view style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(999), borderWidth: px(1), marginBottom: px(6), marginRight: px(8), paddingBottom: px(6), paddingLeft: px(9), paddingRight: px(9), paddingTop: px(6) }}>
      <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700' }}>{label}</text>
      <text style={{ color: colors.muted, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>{detail}</text>
    </view>
  );
}

function BudgetBar({ budget, fallbackPercent, label }: { budget: AtelierBudgetProjection | undefined; fallbackPercent: number; label: string }) {
  const dimensions = budget?.dimensions ?? [{
    id: 'money',
    label: t('atelier.budget.money'),
    used: fallbackPercent,
    cap: 100,
    unit: '%',
    percent: fallbackPercent,
    status: fallbackPercent >= 90 ? 'danger' : fallbackPercent >= 75 ? 'warning' : 'ok',
  }];
  const primaryPercent = dimensions[0]?.percent ?? fallbackPercent;
  const tone = budget?.status ?? dimensions[0]?.status ?? 'ok';
  const barColor = tone === 'blocked' || tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.primary;
  return (
    <view style={{ marginTop: px(14) }}>
      <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(6) }}>
        <text style={{ color: colors.subtle, fontSize: px(11), fontWeight: '700' }}>{t('atelier.budget.title')}</text>
        <text style={{ color: colors.muted, fontSize: px(11) }}>{label}</text>
      </view>
      <view style={{ backgroundColor: colors.elevated, borderRadius: px(999), height: px(7), overflow: 'hidden' }}>
        <view style={{ backgroundColor: barColor, borderRadius: px(999), height: px(7), width: `${Math.min(100, Math.max(0, primaryPercent))}%` }} />
      </view>
      {budget ? (
        <view style={{ marginTop: px(8) }}>
          <text style={{ color: tone === 'blocked' || tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : colors.subtle, fontSize: px(10), lineHeight: px(15) }}>
            {budget.decisionHint ?? t('atelier.budget.readOnly')}
          </text>
          <view style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: px(6) }}>
            {dimensions.map((dimension) => (
              <view key={dimension.id} style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(8), borderWidth: px(1), marginBottom: px(6), marginRight: px(6), paddingBottom: px(5), paddingLeft: px(7), paddingRight: px(7), paddingTop: px(5) }}>
                <text style={{ color: colors.text, fontSize: px(10), fontWeight: '700' }}>{dimension.label}</text>
                <text style={{ color: dimension.status === 'blocked' || dimension.status === 'danger' ? colors.danger : dimension.status === 'warning' ? colors.warning : colors.subtle, fontSize: px(10), marginTop: px(2) }}>
                  {dimension.used}/{dimension.cap} {dimension.unit} · {dimension.percent}%
                </text>
              </view>
            ))}
          </view>
        </view>
      ) : null}
    </view>
  );
}

function StatusPill({ status }: { status: AtelierViewStatus }) {
  const statusPillView = deriveOfficialStatusPillView(status);
  const label = t(statusPillView.labelKey);
  const backgroundColor = statusPillView.tone === 'danger'
    ? colors.dangerSoft
    : statusPillView.tone === 'warning'
      ? colors.warningSoft
      : statusPillView.tone === 'success'
        ? colors.successSoft
        : colors.infoSoft;
  const textColor = statusPillView.tone === 'danger'
    ? colors.danger
    : statusPillView.tone === 'warning'
      ? colors.warning
      : statusPillView.tone === 'success'
        ? colors.success
        : colors.info;
  return (
    <view style={{ alignSelf: 'flex-start', backgroundColor, borderRadius: px(999), paddingBottom: px(7), paddingLeft: px(10), paddingRight: px(10), paddingTop: px(7) }}>
      <text style={{ color: textColor, fontSize: px(12), fontWeight: '700' }}>{label}</text>
    </view>
  );
}

function StatusNotice({ status, detail }: { status: AtelierStatusNoticeKind; detail: string }) {
  const statusView = deriveOfficialStatusNoticeView(status);
  const title = t(statusView.titleKey);
  const body = detail || t(statusView.detailKey);
  return (
    <view style={{ backgroundColor: colors.warningSoft, borderColor: '#fde68a', borderRadius: px(14), borderWidth: px(1), padding: px(14), marginBottom: px(12) }}>
      <text style={{ color: colors.warning, fontSize: px(14), fontWeight: '700', marginBottom: px(5) }}>{title}</text>
      <text style={{ color: colors.warning, fontSize: px(13), lineHeight: px(20) }}>{body}</text>
    </view>
  );
}

function ErrorPanel({
  kind,
  message,
  retryVisible,
  onRetry,
}: {
  kind: ErrorKind;
  message?: string;
  retryVisible: boolean;
  onRetry: () => Promise<void>;
}) {
  const recoveryView = deriveOfficialRecoveryView(kind);
  const warning = recoveryView.tone === 'warning';
  const title = t(recoveryView.titleKey);
  const detail = recoveryView.detailKey ? t(recoveryView.detailKey) : message || title;
  const rawMessageVisible = Boolean(message) && detail !== message;
  return (
    <view style={{ backgroundColor: warning ? colors.warningSoft : colors.dangerSoft, borderColor: warning ? '#fde68a' : '#fecaca', borderRadius: px(14), borderWidth: px(1), padding: px(14), marginBottom: px(12) }}>
      <text style={{ color: warning ? colors.warning : colors.danger, fontSize: px(14), fontWeight: '700', marginBottom: px(5) }}>{title}</text>
      <text style={{ color: warning ? colors.warning : colors.danger, fontSize: px(13), lineHeight: px(20) }}>{detail}</text>
      {rawMessageVisible ? <text style={{ color: colors.muted, fontSize: px(12), lineHeight: px(18), marginTop: px(7) }}>{message}</text> : null}
      {retryVisible ? (
        <>
          <view bindtap={() => void onRetry()} style={{ alignSelf: 'flex-start', backgroundColor: colors.panel, borderColor: warning ? '#fde68a' : '#fecaca', borderRadius: px(999), borderWidth: px(1), marginTop: px(12), paddingBottom: px(8), paddingLeft: px(12), paddingRight: px(12), paddingTop: px(8) }}>
            <text style={{ color: warning ? colors.warning : colors.danger, fontSize: px(12), fontWeight: '700' }}>{t('atelier.action.retry')}</text>
          </view>
          <text style={{ color: colors.muted, fontSize: px(11), lineHeight: px(16), marginTop: px(7) }}>{t('atelier.recovery.retryBoundary')}</text>
        </>
      ) : null}
    </view>
  );
}

function CenteredState({
  titleKey,
  detailKey,
}: {
  titleKey: string;
  detailKey: string;
}) {
  return (
    <view style={{ alignItems: 'center', backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(18), borderWidth: px(1), justifyContent: 'center', minHeight: px(280), padding: px(24) }}>
      <text style={{ color: colors.text, fontSize: px(18), fontWeight: '700', marginBottom: px(8) }}>{t(titleKey)}</text>
      <text style={{ color: colors.muted, fontSize: px(13), lineHeight: px(20), textAlign: 'center' }}>{t(detailKey)}</text>
    </view>
  );
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return (
    <view style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <text style={{ color: colors.text, fontSize: px(15), fontWeight: '700' }}>{title}</text>
      <text style={{ color: colors.subtle, fontSize: px(12) }}>{detail}</text>
    </view>
  );
}

const TASK_ORGANIZER_LABEL_KEYS: Record<TaskOrganizerMode, string> = {
  folders: 'atelier.taskOrganizer.folders',
  'flat-list': 'atelier.taskOrganizer.flatList',
  kanban: 'atelier.taskOrganizer.kanban',
  dag: 'atelier.taskOrganizer.dag',
};

function TaskOrganizerPanel({
  actionId,
  actionKind,
  mode,
  onModeChange,
  onSelectTask,
  onTaskAction,
  purgeConfirmTaskId,
  selectedTaskId,
  tasks,
}: {
  actionId: string;
  actionKind: AtelierTaskActionKind | '';
  mode: TaskOrganizerMode;
  onModeChange: (mode: TaskOrganizerMode) => void;
  onSelectTask: (taskId: string) => void;
  onTaskAction: (taskId: string, action: AtelierTaskActionKind) => Promise<void>;
  purgeConfirmTaskId: string;
  selectedTaskId: string;
  tasks: AtelierTask[];
}) {
  return (
    <view style={{ marginTop: px(8) }}>
      <view style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: px(8) }}>
        {ATELIER_TASK_ORGANIZER_MODES.map((item) => {
          const selected = item.id === mode;
          return (
            <text
              key={item.id}
              bindtap={() => onModeChange(item.id)}
              style={{
                backgroundColor: selected ? colors.primarySoft : colors.elevated,
                borderColor: selected ? '#bfdbfe' : colors.border,
                borderRadius: px(999),
                borderWidth: px(1),
                color: item.ready ? colors.text : colors.subtle,
                fontSize: px(10),
                fontWeight: selected ? '700' : '400',
                marginBottom: px(6),
                marginRight: px(6),
                paddingBottom: px(4),
                paddingLeft: px(8),
                paddingRight: px(8),
                paddingTop: px(4),
              }}
            >
              {t(TASK_ORGANIZER_LABEL_KEYS[item.id])}
            </text>
          );
        })}
      </view>
      <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginBottom: px(8) }}>
        {t('atelier.taskOrganizer.readOnly')}
      </text>
      {mode === 'kanban' || mode === 'dag' ? (
        <TaskOrganizerUnavailable mode={mode} />
      ) : mode === 'folders' ? (
        <TaskFoldersList
          actionId={actionId}
          actionKind={actionKind}
          purgeConfirmTaskId={purgeConfirmTaskId}
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          onTaskAction={onTaskAction}
        />
      ) : (
        <TaskFlatList
          actionId={actionId}
          actionKind={actionKind}
          purgeConfirmTaskId={purgeConfirmTaskId}
          tasks={tasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={onSelectTask}
          onTaskAction={onTaskAction}
        />
      )}
    </view>
  );
}

function TaskOrganizerUnavailable({ mode }: { mode: Extract<TaskOrganizerMode, 'kanban' | 'dag'> }) {
  return (
    <view style={{ backgroundColor: colors.warningSoft, borderColor: '#fde68a', borderRadius: px(10), borderWidth: px(1), marginBottom: px(8), padding: px(8) }}>
      <text style={{ color: colors.warning, fontSize: px(11), fontWeight: '700' }}>{t(`atelier.taskOrganizer.${mode}Unavailable`)}</text>
      <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(4) }}>{t('atelier.taskOrganizer.unavailableBoundary')}</text>
    </view>
  );
}

function TaskFoldersList({
  actionId,
  actionKind,
  onSelectTask,
  onTaskAction,
  purgeConfirmTaskId,
  selectedTaskId,
  tasks,
}: {
  actionId: string;
  actionKind: AtelierTaskActionKind | '';
  onSelectTask: (taskId: string) => void;
  onTaskAction: (taskId: string, action: AtelierTaskActionKind) => Promise<void>;
  purgeConfirmTaskId: string;
  selectedTaskId: string;
  tasks: AtelierTask[];
}) {
  const activeTasks = tasks.filter((task) => normalizeTaskStatus(task.status) === 'active');
  const archivedTasks = tasks.filter((task) => normalizeTaskStatus(task.status) === 'archived');
  const deletedTasks = tasks.filter((task) => normalizeTaskStatus(task.status) === 'deleted');
  const projects = Array.from(new Set(activeTasks.map((task) => task.project || t('atelier.taskOrganizer.uncategorized'))));
  return (
    <view>
      {projects.map((project) => {
        const projectTasks = activeTasks.filter((task) => (task.project || t('atelier.taskOrganizer.uncategorized')) === project);
        return (
          <view key={project} style={{ marginBottom: px(8) }}>
            <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(5) }}>
              <text style={{ color: colors.subtle, flex: 1, fontSize: px(11), fontWeight: '700', marginRight: px(8) }}>{project}</text>
              <text style={{ color: colors.subtle, fontSize: px(10) }}>{projectTasks.length}</text>
            </view>
            {projectTasks.map((task) => (
              <TaskRow
                key={task.id}
                actionId={actionId}
                actionKind={actionKind}
                purgeConfirmTaskId={purgeConfirmTaskId}
                task={task}
                selected={task.id === selectedTaskId}
                onAction={onTaskAction}
                onTap={() => onSelectTask(task.id)}
              />
            ))}
          </view>
        );
      })}
      {activeTasks.length === 0 ? <EmptySideText text={t('atelier.taskOrganizer.noActive')} /> : null}
      <TaskOrganizerLifecycleSection
        actionId={actionId}
        actionKind={actionKind}
        label={t('atelier.taskOrganizer.archived')}
        onAction={onTaskAction}
        onSelectTask={onSelectTask}
        purgeConfirmTaskId={purgeConfirmTaskId}
        selectedTaskId={selectedTaskId}
        tasks={archivedTasks}
      />
      <TaskOrganizerLifecycleSection
        actionId={actionId}
        actionKind={actionKind}
        description={t('atelier.taskOrganizer.deletedHint')}
        label={t('atelier.taskOrganizer.deleted')}
        onAction={onTaskAction}
        onSelectTask={onSelectTask}
        purgeConfirmTaskId={purgeConfirmTaskId}
        selectedTaskId={selectedTaskId}
        tasks={deletedTasks}
      />
    </view>
  );
}

function TaskFlatList({
  actionId,
  actionKind,
  onSelectTask,
  onTaskAction,
  purgeConfirmTaskId,
  selectedTaskId,
  tasks,
}: {
  actionId: string;
  actionKind: AtelierTaskActionKind | '';
  onSelectTask: (taskId: string) => void;
  onTaskAction: (taskId: string, action: AtelierTaskActionKind) => Promise<void>;
  purgeConfirmTaskId: string;
  selectedTaskId: string;
  tasks: AtelierTask[];
}) {
  const activeTasks = tasks.filter((task) => normalizeTaskStatus(task.status) === 'active');
  const archivedTasks = tasks.filter((task) => normalizeTaskStatus(task.status) === 'archived');
  const deletedTasks = tasks.filter((task) => normalizeTaskStatus(task.status) === 'deleted');
  return (
    <view>
      {activeTasks.map((task) => (
        <TaskRow
          key={task.id}
          actionId={actionId}
          actionKind={actionKind}
          purgeConfirmTaskId={purgeConfirmTaskId}
          task={task}
          selected={task.id === selectedTaskId}
          onAction={onTaskAction}
          onTap={() => onSelectTask(task.id)}
        />
      ))}
      {activeTasks.length === 0 ? <EmptySideText text={t('atelier.taskOrganizer.noActive')} /> : null}
      <TaskOrganizerLifecycleSection
        actionId={actionId}
        actionKind={actionKind}
        label={t('atelier.taskOrganizer.archived')}
        onAction={onTaskAction}
        onSelectTask={onSelectTask}
        purgeConfirmTaskId={purgeConfirmTaskId}
        selectedTaskId={selectedTaskId}
        tasks={archivedTasks}
      />
      <TaskOrganizerLifecycleSection
        actionId={actionId}
        actionKind={actionKind}
        description={t('atelier.taskOrganizer.deletedHint')}
        label={t('atelier.taskOrganizer.deleted')}
        onAction={onTaskAction}
        onSelectTask={onSelectTask}
        purgeConfirmTaskId={purgeConfirmTaskId}
        selectedTaskId={selectedTaskId}
        tasks={deletedTasks}
      />
    </view>
  );
}

function TaskOrganizerLifecycleSection({
  actionId,
  actionKind,
  description,
  label,
  onAction,
  onSelectTask,
  purgeConfirmTaskId,
  selectedTaskId,
  tasks,
}: {
  actionId: string;
  actionKind: AtelierTaskActionKind | '';
  description?: string;
  label: string;
  onAction: (taskId: string, action: AtelierTaskActionKind) => Promise<void>;
  onSelectTask: (taskId: string) => void;
  purgeConfirmTaskId: string;
  selectedTaskId: string;
  tasks: AtelierTask[];
}) {
  const [open, setOpen] = useState(false);
  if (tasks.length === 0) return null;
  return (
    <view style={{ marginTop: px(12) }}>
      <view bindtap={() => setOpen((current) => !current)} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(6) }}>
        <text style={{ color: colors.subtle, flex: 1, fontSize: px(11), fontWeight: '700', marginRight: px(8) }}>
          {open ? '⌄' : '›'} {label}
        </text>
        <text style={{ color: colors.subtle, fontSize: px(10) }}>{tasks.length}</text>
      </view>
      {open ? (
        <view>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              actionId={actionId}
              actionKind={actionKind}
              purgeConfirmTaskId={purgeConfirmTaskId}
              task={task}
              selected={task.id === selectedTaskId}
              onAction={onAction}
              onTap={() => onSelectTask(task.id)}
            />
          ))}
          {description ? <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>{description}</text> : null}
        </view>
      ) : null}
    </view>
  );
}

function TaskRow({
  actionId,
  actionKind,
  onAction,
  onTap,
  purgeConfirmTaskId,
  selected,
  task,
}: {
  actionId: string;
  actionKind: AtelierTaskActionKind | '';
  onAction: (taskId: string, action: AtelierTaskActionKind) => Promise<void>;
  onTap: () => void;
  purgeConfirmTaskId: string;
  selected: boolean;
  task: AtelierTask;
}) {
  const status = normalizeTaskStatus(task.status);
  const busy = actionId === task.id;
  const confirmingPurge = status === 'deleted' && purgeConfirmTaskId === task.id;
  return (
    <view
      data-pt-collaboration-migration={task.migrationState}
      data-pt-migration-goal-id={task.goalId}
      data-pt-migration-source-id={task.legacySourceId}
      style={{ backgroundColor: selected ? colors.primarySoft : colors.elevated, borderColor: selected ? '#bfdbfe' : colors.border, borderRadius: px(12), borderWidth: px(1), marginBottom: px(8), padding: px(10) }}
    >
      <view bindtap={onTap}>
        <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(4) }}>
          <text style={{ color: colors.text, flex: 1, fontSize: px(13), fontWeight: '700', marginRight: px(8) }}>{task.title || t('atelier.task.untitled')}</text>
          {task.running ? <text style={{ color: colors.success, fontSize: px(11) }}>●</text> : null}
        </view>
        <text style={{ color: colors.muted, fontSize: px(11) }}>{task.project} · {status}</text>
        {task.branch ? <text style={{ color: colors.subtle, fontSize: px(11), marginTop: px(3) }}>{task.branch}</text> : null}
        {task.migrationState ? (
          <view style={{ marginTop: px(5) }}>
            <text style={{ color: task.migrationState === 'blocked' ? colors.warning : colors.success, fontSize: px(10), fontWeight: '700' }}>
              {t(`atelier.migration.${task.migrationState}`)}
            </text>
            <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>
              {task.migrationState === 'migrated'
                ? `${t('atelier.migration.goalId')}: ${task.goalId}`
                : `${t('atelier.migration.blockReason')}: ${task.migrationBlockReason}`}
            </text>
          </view>
        ) : null}
      </view>
      <view style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: px(8) }}>
        <TaskActionChip
          label={status === 'archived' || status === 'deleted' ? t('atelier.task.restore') : t('atelier.task.archive')}
          busy={busy && (actionKind === 'archive' || actionKind === 'restore')}
          disabled={busy}
          onTap={() => onAction(task.id, status === 'archived' || status === 'deleted' ? 'restore' : 'archive')}
          variant="secondary"
        />
        {status === 'deleted' ? (
          <TaskActionChip
            label={confirmingPurge ? t('atelier.task.confirmPurge') : t('atelier.task.purge')}
            busy={busy && actionKind === 'purge'}
            disabled={busy}
            onTap={() => onAction(task.id, 'purge')}
            variant="danger"
          />
        ) : (
          <TaskActionChip
            label={t('atelier.task.delete')}
            busy={busy && actionKind === 'delete'}
            disabled={busy}
            onTap={() => onAction(task.id, 'delete')}
            variant="danger"
          />
        )}
        {confirmingPurge && !busy ? (
          <text style={{ color: colors.danger, fontSize: px(10), lineHeight: px(15), marginTop: px(2), width: '100%' }}>{t('atelier.task.purgeHint')}</text>
        ) : null}
      </view>
    </view>
  );
}

function WorkspaceOpenButton({
  disabled,
  status,
  task,
  onOpen,
}: {
  disabled: boolean;
  status: string;
  task: AtelierTask | undefined;
  onOpen: (task: AtelierTask) => Promise<void>;
}) {
  const target = task?.workspaceOpenTarget;
  const canOpen = Boolean(task && target && !disabled);
  return (
    <view style={{ backgroundColor: colors.primarySoft, borderColor: colors.border, borderRadius: px(12), borderWidth: px(1), marginTop: px(10), padding: px(10) }}>
      <view style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <view style={{ flex: 1, marginRight: px(10) }}>
          <text style={{ color: colors.text, fontSize: px(12), fontWeight: '700' }}>{t('atelier.workspace.open')}</text>
          <text style={{ color: colors.muted, fontSize: px(10), lineHeight: px(15), marginTop: px(3) }}>
            {target ? `${target.label} · ${target.ideHint ?? 'ide'}` : t('atelier.workspace.openUnavailable')}
          </text>
          <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(3) }}>{t('atelier.workspace.openBoundary')}</text>
          {status ? <text style={{ color: colors.subtle, fontSize: px(10), marginTop: px(3) }}>{status}</text> : null}
        </view>
        <view
          bindtap={() => {
            if (canOpen && task) void onOpen(task);
          }}
          style={{ alignSelf: 'center', backgroundColor: canOpen ? colors.primary : colors.elevated, borderRadius: px(999), paddingBottom: px(7), paddingLeft: px(10), paddingRight: px(10), paddingTop: px(7) }}
        >
          <text style={{ color: canOpen ? '#ffffff' : colors.subtle, fontSize: px(11), fontWeight: '700' }}>{disabled ? t('atelier.workspace.opening') : t('atelier.workspace.openAction')}</text>
        </view>
      </view>
    </view>
  );
}

function ProviderCapabilitiesPanel({
  capabilities,
  error,
  loading,
  source,
  onInsertCommand,
}: {
  capabilities: AtelierProviderCapability[];
  error: string;
  loading: boolean;
  source: string;
  onInsertCommand: (command: string) => void;
}) {
  const visibleCapabilities = capabilities.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.providerCapabilities);
  const hiddenCapabilityCount = Math.max(0, capabilities.length - visibleCapabilities.length);
  return (
    <view style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(14), borderWidth: px(1), marginTop: px(10), padding: px(10) }}>
      <SectionTitle title={t('atelier.section.skills')} detail={loading ? t('atelier.skills.loading') : `${capabilities.length}`} />
      <text style={{ color: colors.subtle, fontSize: px(11), lineHeight: px(16), marginTop: px(6) }}>{t('atelier.skills.hint')}</text>
      {source ? <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(4) }}>{source}</text> : null}
      {error ? <text style={{ color: colors.warning, fontSize: px(11), lineHeight: px(16), marginTop: px(6) }}>{error}</text> : null}
      <view style={{ marginTop: px(8) }}>
        {visibleCapabilities.map((capability) => (
          <view
            key={capability.id}
            bindtap={() => onInsertCommand(capability.slashCommand)}
            style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(10), borderWidth: px(1), marginTop: px(6), padding: px(8) }}
          >
            <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(3) }}>
              <text style={{ color: colors.text, flex: 1, fontSize: px(12), fontWeight: '700', marginRight: px(8) }}>{capability.label}</text>
              <text style={{ color: colors.primary, fontSize: px(11), fontWeight: '700' }}>{capability.slashCommand}</text>
            </view>
            <text style={{ color: colors.muted, fontSize: px(10), lineHeight: px(15) }}>{capability.description}</text>
          </view>
        ))}
        {hiddenCapabilityCount > 0 ? (
          <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(6) }}>
            +{hiddenCapabilityCount} {t('atelier.skills.moreCapabilities')}
          </text>
        ) : null}
        {!loading && capabilities.length === 0 ? <EmptySideText text={t('atelier.skills.empty')} /> : null}
      </view>
    </view>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <view style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(12), borderWidth: px(1), flex: 1, marginRight: px(8), padding: px(10) }}>
      <text style={{ color: colors.subtle, fontSize: px(11), marginBottom: px(4) }}>{label}</text>
      <text style={{ color: colors.text, fontSize: px(18), fontWeight: '700' }}>{value}</text>
    </view>
  );
}

function TaskLifecycleBar({
  task,
  actionId,
  actionKind,
  purgeConfirmTaskId,
  onAction,
}: {
  task: AtelierTask | undefined;
  actionId: string;
  actionKind: 'archive' | 'restore' | 'delete' | 'purge' | '';
  purgeConfirmTaskId: string;
  onAction: (taskId: string, action: 'archive' | 'restore' | 'delete' | 'purge') => Promise<void>;
}) {
  if (!task) return null;
  const status = normalizeTaskStatus(task.status);
  const busy = actionId === task.id;
  const confirmingPurge = status === 'deleted' && purgeConfirmTaskId === task.id;
  return (
    <view style={{ borderColor: colors.border, borderTopWidth: px(1), flexDirection: 'row', flexWrap: 'wrap', marginTop: px(12), paddingTop: px(12) }}>
      <TaskActionChip
        label={status === 'archived' || status === 'deleted' ? t('atelier.task.restore') : t('atelier.task.archive')}
        busy={busy && (actionKind === 'archive' || actionKind === 'restore')}
        disabled={busy}
        onTap={() => onAction(task.id, status === 'archived' || status === 'deleted' ? 'restore' : 'archive')}
        variant="secondary"
      />
      {status === 'deleted' ? (
        <TaskActionChip
          label={confirmingPurge ? t('atelier.task.confirmPurge') : t('atelier.task.purge')}
          busy={busy && actionKind === 'purge'}
          disabled={busy}
          onTap={() => onAction(task.id, 'purge')}
          variant="danger"
        />
      ) : (
        <TaskActionChip
          label={t('atelier.task.delete')}
          busy={busy && actionKind === 'delete'}
          disabled={busy}
          onTap={() => onAction(task.id, 'delete')}
          variant="danger"
        />
      )}
      {busy ? <text style={{ alignSelf: 'center', color: colors.subtle, fontSize: px(11), marginLeft: px(4) }}>{t('atelier.task.updating')}</text> : null}
      {confirmingPurge && !busy ? (
        <text style={{ color: colors.danger, fontSize: px(11), lineHeight: px(16), marginTop: px(2), width: '100%' }}>{t('atelier.task.purgeHint')}</text>
      ) : null}
    </view>
  );
}

function TaskActionChip({
  label,
  busy,
  disabled,
  onTap,
  variant,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onTap: () => Promise<void>;
  variant: 'secondary' | 'danger';
}) {
  const isDanger = variant === 'danger';
  return (
    <view
      bindtap={() => {
        if (disabled) return;
        void onTap();
      }}
      style={{ backgroundColor: isDanger ? colors.dangerSoft : colors.elevated, borderColor: isDanger ? '#fecaca' : colors.border, borderRadius: px(999), borderWidth: px(1), marginBottom: px(6), marginRight: px(8), opacity: disabled ? 0.58 : 1, paddingBottom: px(7), paddingLeft: px(10), paddingRight: px(10), paddingTop: px(7) }}
    >
      <text style={{ color: isDanger ? colors.danger : colors.muted, fontSize: px(11), fontWeight: '700' }}>{busy ? t('atelier.task.updating') : label}</text>
    </view>
  );
}

function GoalComposer({
  compact = false,
  creating,
  flowId,
  intentPreset,
  model,
  revision,
  runKind,
  text,
  onChange,
  onCreate,
  onFlowIdChange,
  onIntentPresetChange,
  onModelChange,
  onRunKindChange,
}: {
  compact?: boolean;
  creating: boolean;
  flowId: AtelierAgentFlowId;
  intentPreset: AtelierIntentPreset;
  model: string;
  revision: number;
  runKind: AtelierRunTargetKind;
  text: string;
  onChange: (value: string) => void;
  onCreate: () => Promise<void>;
  onFlowIdChange: (flowId: AtelierAgentFlowId) => void;
  onIntentPresetChange: (preset: AtelierIntentPreset) => void;
  onModelChange: (model: string) => void;
  onRunKindChange: (kind: AtelierRunTargetKind) => void;
}) {
  const trimmed = text.trim();
  const blocked = creating || trimmed.length === 0;
  return (
    <view style={{ backgroundColor: compact ? colors.elevated : colors.panel, borderColor: colors.border, borderRadius: px(16), borderWidth: px(1), marginTop: px(12), padding: px(12) }}>
      <text style={{ color: colors.text, fontSize: px(13), fontWeight: '700', marginBottom: px(8) }}>{t('atelier.goal.title')}</text>
      <view style={{ flexDirection: compact ? 'column' : 'row' }}>
        <view style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(12), borderWidth: px(1), flex: 1, marginBottom: compact ? px(8) : 0, marginRight: compact ? 0 : px(10), paddingBottom: px(8), paddingLeft: px(10), paddingRight: px(10), paddingTop: px(8) }}>
          <input
            key={`atelier-goal-${revision}`}
            bindinput={(event: unknown) => onChange(readInputValue(event))}
            placeholder={t('atelier.goal.placeholder')}
            style={{ color: colors.text, fontSize: px(13), width: '100%' }}
          />
        </view>
        <view
          bindtap={() => {
            if (!blocked) void onCreate();
          }}
          style={{ alignItems: 'center', backgroundColor: blocked ? colors.elevated : colors.primary, borderColor: blocked ? colors.border : colors.primary, borderRadius: px(12), borderWidth: px(1), justifyContent: 'center', minHeight: px(38), minWidth: px(96), paddingLeft: px(12), paddingRight: px(12) }}
        >
          <text style={{ color: blocked ? colors.subtle : '#ffffff', fontSize: px(12), fontWeight: '700' }}>
            {creating ? t('atelier.goal.creating') : t('atelier.goal.create')}
          </text>
        </view>
      </view>
      <IntentPresetSelector preset={intentPreset} onPresetChange={onIntentPresetChange} />
      <RunTargetSelector
        flowId={flowId}
        model={model}
        runKind={runKind}
        onFlowIdChange={onFlowIdChange}
        onModelChange={onModelChange}
        onRunKindChange={onRunKindChange}
      />
      <text style={{ color: colors.subtle, fontSize: px(11), lineHeight: px(16), marginTop: px(8) }}>{t('atelier.goal.hint')}</text>
      <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(4) }}>{t('atelier.composer.attachmentUnsupported')}</text>
    </view>
  );
}

function IntentPresetSelector({ preset, onPresetChange }: { preset: AtelierIntentPreset; onPresetChange: (preset: AtelierIntentPreset) => void }) {
  return (
    <view style={{ marginTop: px(10) }}>
      <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(6) }}>{t('atelier.intentPreset.selector')}</text>
      <view style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {ATELIER_TASK_INTENT_PRESETS.map((option) => {
          const selected = option === preset;
          const labels = INTENT_PRESET_LABEL_KEYS[option];
          return (
            <view
              key={option}
              bindtap={() => onPresetChange(option)}
              style={{ backgroundColor: selected ? colors.primarySoft : colors.panel, borderColor: selected ? '#bfdbfe' : colors.border, borderRadius: px(12), borderWidth: px(1), marginBottom: px(7), marginRight: px(8), maxWidth: px(132), paddingBottom: px(7), paddingLeft: px(10), paddingRight: px(10), paddingTop: px(7) }}
            >
              <text style={{ color: selected ? colors.primary : colors.muted, fontSize: px(11), fontWeight: '700' }}>{t(labels.labelKey)}</text>
              <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(14), marginTop: px(3) }}>{t(labels.hintKey)}</text>
            </view>
          );
        })}
      </view>
      <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15) }}>{t('atelier.intentPreset.boundary')}</text>
    </view>
  );
}

function RunTargetSelector({
  flowId,
  model,
  runKind,
  onFlowIdChange,
  onModelChange,
  onRunKindChange,
}: {
    flowId: AtelierAgentFlowId;
  model: string;
  runKind: AtelierRunTargetKind;
    onFlowIdChange: (flowId: AtelierAgentFlowId) => void;
  onModelChange: (model: string) => void;
  onRunKindChange: (kind: AtelierRunTargetKind) => void;
}) {
  return (
    <view style={{ marginTop: px(10) }}>
      <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(6) }}>{t('atelier.runTarget.selector')}</text>
      <view style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {ATELIER_RUN_TARGET_KINDS.map((kind) => {
          const selected = kind === runKind;
          return (
            <view
              key={kind}
              bindtap={() => onRunKindChange(kind)}
              style={{ backgroundColor: selected ? colors.primarySoft : colors.panel, borderColor: selected ? '#bfdbfe' : colors.border, borderRadius: px(999), borderWidth: px(1), marginBottom: px(7), marginRight: px(8), paddingBottom: px(7), paddingLeft: px(10), paddingRight: px(10), paddingTop: px(7) }}
            >
              <text style={{ color: selected ? colors.primary : colors.muted, fontSize: px(11), fontWeight: '700' }}>
                {t(kind === 'model' ? 'atelier.runTarget.model' : 'atelier.runTarget.agents')}
              </text>
            </view>
          );
        })}
      </view>
      {runKind === 'model' ? (
        <view style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {ATELIER_DIRECT_RUN_MODELS.map((modelId) => {
          const selected = modelId === model;
          return (
            <view
              key={modelId}
              bindtap={() => onModelChange(modelId)}
              style={{ backgroundColor: selected ? colors.primarySoft : colors.panel, borderColor: selected ? '#bfdbfe' : colors.border, borderRadius: px(999), borderWidth: px(1), marginBottom: px(7), marginRight: px(8), paddingBottom: px(7), paddingLeft: px(10), paddingRight: px(10), paddingTop: px(7) }}
            >
              <text style={{ color: selected ? colors.primary : colors.muted, fontSize: px(11), fontWeight: '700' }}>{modelId}</text>
            </view>
          );
        })}
      </view>
      ) : (
        <view>
          <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(6) }}>{t('atelier.runTarget.flowSelector')}</text>
          <view style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {ATELIER_AGENT_FLOW_DESCRIPTORS.map((flow) => {
                  const selected = flow.id === flowId;
              return (
                <view
                      key={flow.id}
                      bindtap={() => onFlowIdChange(flow.id)}
                  style={{ backgroundColor: selected ? colors.primarySoft : colors.panel, borderColor: selected ? '#bfdbfe' : colors.border, borderRadius: px(999), borderWidth: px(1), marginBottom: px(7), marginRight: px(8), paddingBottom: px(7), paddingLeft: px(10), paddingRight: px(10), paddingTop: px(7) }}
                >
                      <text style={{ color: selected ? colors.primary : colors.muted, fontSize: px(11), fontWeight: '700' }}>{flow.label}</text>
                </view>
              );
            })}
          </view>
        </view>
      )}
      <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15) }}>
        {t(runKind === 'model' ? 'atelier.runTarget.modelHint' : 'atelier.runTarget.agentsHint')}
      </text>
    </view>
  );
}

function ArtifactTray({
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
}: {
  artifacts: AtelierArtifactProjection[];
  selectedArtifactId: string;
  onSelectArtifact: (artifactId: string) => void;
}) {
  if (artifacts.length === 0) return null;
  const visibleArtifacts = artifacts.slice(0, 5);
  const hiddenArtifactCount = Math.max(0, artifacts.length - visibleArtifacts.length);
  return (
    <view style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(16), borderWidth: px(1), marginTop: px(12), padding: px(12) }}>
      <SectionTitle title={t('atelier.section.artifactTray')} detail={`${artifacts.length}`} />
      <view style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: px(10) }}>
        {visibleArtifacts.map((artifact) => (
          <view
            key={artifact.id}
            bindtap={() => onSelectArtifact(artifact.id)}
            style={{ backgroundColor: artifact.id === selectedArtifactId ? colors.primarySoft : colors.elevated, borderColor: artifact.id === selectedArtifactId ? '#bfdbfe' : colors.border, borderRadius: px(999), borderWidth: px(1), marginBottom: px(7), marginRight: px(8), paddingBottom: px(7), paddingLeft: px(10), paddingRight: px(10), paddingTop: px(7) }}
          >
            <text style={{ color: artifact.id === selectedArtifactId ? colors.primary : colors.muted, fontSize: px(11), fontWeight: '700' }}>
              {artifact.kind ?? t('atelier.artifact.unknown')} · {artifact.name ?? artifact.id}
            </text>
          </view>
        ))}
      </view>
      {hiddenArtifactCount > 0 ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>
          +{hiddenArtifactCount} {t('atelier.artifact.moreProjected')}
        </text>
      ) : null}
      <text style={{ color: colors.subtle, fontSize: px(11), lineHeight: px(16), marginTop: px(2) }}>{t('atelier.artifact.trayHint')}</text>
    </view>
  );
}

function MessageComposer({
  disabled,
  revision,
  sending,
  text,
  onChange,
  onSend,
}: {
  disabled: boolean;
  revision: number;
  sending: boolean;
  text: string;
  onChange: (value: string) => void;
  onSend: () => Promise<void>;
}) {
  const trimmed = text.trim();
  const blocked = disabled || trimmed.length === 0;
  return (
    <view style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(16), borderWidth: px(1), marginTop: px(12), padding: px(12) }}>
      <view style={{ flexDirection: 'row', marginBottom: px(8) }}>
        <view style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(12), borderWidth: px(1), flex: 1, marginRight: px(10), paddingBottom: px(8), paddingLeft: px(10), paddingRight: px(10), paddingTop: px(8) }}>
          <input
            key={`atelier-composer-${revision}`}
            bindinput={(event: unknown) => onChange(readInputValue(event))}
            placeholder={t('atelier.composer.placeholder')}
            style={{ color: colors.text, fontSize: px(13), width: '100%' }}
          />
        </view>
        <view
          bindtap={() => {
            if (!blocked) void onSend();
          }}
          style={{ alignItems: 'center', backgroundColor: blocked ? colors.elevated : colors.primary, borderColor: blocked ? colors.border : colors.primary, borderRadius: px(12), borderWidth: px(1), justifyContent: 'center', minWidth: px(86), paddingLeft: px(12), paddingRight: px(12) }}
        >
          <text style={{ color: blocked ? colors.subtle : '#ffffff', fontSize: px(12), fontWeight: '700' }}>
            {sending ? t('atelier.composer.sending') : t('atelier.composer.send')}
          </text>
        </view>
      </view>
      <text style={{ color: colors.subtle, fontSize: px(11), lineHeight: px(16) }}>{t('atelier.composer.hint')}</text>
      <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(4) }}>{t('atelier.composer.attachmentUnsupported')}</text>
    </view>
  );
}

function StreamRow({
  block,
  feedbackStatus,
  feedbackSubmittingId,
  memoryConfirmationFeedbackId,
  memoryConfirming,
  rerunConfirmationFeedbackId,
  rerunConfirming,
  resolving,
  taskId,
  onSubmitFeedback,
  onConfirmMemoryCandidate,
  onConfirmRerun,
  onResolveDecision,
}: {
  block: AtelierStreamBlock;
  feedbackStatus: string;
  feedbackSubmittingId: string;
  memoryConfirmationFeedbackId: string;
  memoryConfirming: boolean;
  rerunConfirmationFeedbackId: string;
  rerunConfirming: boolean;
  resolving: boolean;
  taskId: string;
  onSubmitFeedback: (taskId: string, blockId: string, signal: AtelierFeedbackSignal) => Promise<void>;
  onConfirmMemoryCandidate: () => Promise<void>;
  onConfirmRerun: () => Promise<void>;
  onResolveDecision: (taskId: string, blockId: string, choice: string) => Promise<void>;
}) {
  const accent = block.kind === 'decision' && !block.chosen ? colors.warning : block.kind === 'artifact' || block.kind === 'diff' ? colors.success : colors.primary;
  const detail = streamBlockDetail(block);
  const decisionLocked = Boolean(block.chosen || resolving);
  const decisionOptions = block.kind === 'decision' ? block.options ?? [] : [];
  const displayedDecisionOptions = visibleDecisionOptions(decisionOptions, block.chosen);
  const hiddenDecisionOptionCount = Math.max(0, decisionOptions.length - displayedDecisionOptions.length);
  return (
    <view style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(12), borderWidth: px(1), marginBottom: px(8), padding: px(10) }}>
      <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(4) }}>
        <text style={{ color: accent, fontSize: px(11), fontWeight: '700' }}>{block.kind}</text>
        {resolving ? <text style={{ color: colors.warning, fontSize: px(11) }}>{t('atelier.decision.resolving')}</text> : null}
        {!resolving && block.done ? <text style={{ color: colors.success, fontSize: px(11) }}>{t('atelier.stream.done')}</text> : null}
      </view>
      <text style={{ color: colors.text, fontSize: px(13), lineHeight: px(20) }}>{detail}</text>
      {block.kind === 'decision' && block.spentSoFar ? (
        <text style={{ color: colors.subtle, fontSize: px(11), marginTop: px(5) }}>{block.spentSoFar}</text>
      ) : null}
      {block.kind === 'decision' && block.options && block.options.length > 0 ? (
        <view style={{ marginTop: px(8) }}>
          {displayedDecisionOptions.map((option) => (
            <view
              key={option.text}
              bindtap={() => {
                if (!decisionLocked) void onResolveDecision(taskId, block.id, option.text);
              }}
              style={{ backgroundColor: option.recommended ? colors.warningSoft : colors.panel, borderColor: option.text === block.chosen ? colors.success : option.recommended ? '#fde68a' : colors.border, borderRadius: px(10), borderWidth: px(1), marginTop: px(6), opacity: decisionLocked && option.text !== block.chosen ? 0.62 : 1, padding: px(8) }}
            >
              <text style={{ color: colors.text, fontSize: px(12), lineHeight: px(18) }}>
                {option.recommended ? `${t('atelier.decision.recommended')} · ` : ''}{option.text}
              </text>
              {option.text === block.chosen ? (
                <text style={{ color: colors.success, fontSize: px(11), fontWeight: '700', marginTop: px(4) }}>{t('atelier.decision.chosen')}</text>
              ) : null}
            </view>
          ))}
          {hiddenDecisionOptionCount > 0 ? (
            <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(6) }}>
              +{hiddenDecisionOptionCount} {t('atelier.decision.moreOptions')}
            </text>
          ) : null}
        </view>
      ) : null}
      {block.kind === 'decision' && block.rollbackImpact ? (
        <text style={{ color: colors.muted, fontSize: px(11), lineHeight: px(17), marginTop: px(8) }}>{block.rollbackImpact}</text>
      ) : null}
      {block.kind === 'nego' ? (
        <NegoDisclosure block={block} />
      ) : null}
      {block.kind === 'diff' ? (
        <DiffSummary block={block} />
      ) : null}
      {block.kind === 'agent' && block.done ? (
        <FeedbackBar
          blockId={block.id}
          feedbackStatus={feedbackStatus}
          memoryConfirmationFeedbackId={memoryConfirmationFeedbackId}
          memoryConfirming={memoryConfirming}
          rerunConfirmationFeedbackId={rerunConfirmationFeedbackId}
          rerunConfirming={rerunConfirming}
          submittingId={feedbackSubmittingId}
          taskId={taskId}
          onSubmitFeedback={onSubmitFeedback}
          onConfirmMemoryCandidate={onConfirmMemoryCandidate}
          onConfirmRerun={onConfirmRerun}
        />
      ) : null}
    </view>
  );
}

function DiffSummary({ block }: { block: AtelierStreamBlock }) {
  const [expanded, setExpanded] = useState(false);
  const paths = block.paths ?? [];
  const visiblePaths = paths.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.diffPaths);
  const hiddenPathCount = Math.max(0, paths.length - visiblePaths.length);
  return (
    <view style={{ marginTop: px(8) }}>
      <view
        bindtap={() => setExpanded((value) => !value)}
        style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(10), borderWidth: px(1), flexDirection: 'row', padding: px(8) }}
      >
        <text style={{ color: colors.primary, fontSize: px(12), fontWeight: '700', marginRight: px(8) }}>{block.files ?? 0} {t('atelier.diff.filesChanged')}</text>
        <text style={{ color: colors.success, fontSize: px(11), fontWeight: '700', marginRight: px(8) }}>+{block.added ?? 0}</text>
        <text style={{ color: colors.danger, flex: 1, fontSize: px(11), fontWeight: '700' }}>-{block.removed ?? 0}</text>
        <text style={{ color: colors.subtle, fontSize: px(12) }}>{expanded ? '▾' : '▸'}</text>
      </view>
      {expanded ? (
        <view style={{ marginTop: px(8) }}>
          <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(5) }}>{t('atelier.diff.paths')}</text>
          {visiblePaths.map((item) => (
            <text key={item} style={{ color: colors.muted, fontSize: px(11), lineHeight: px(17) }}>{item}</text>
          ))}
          {hiddenPathCount > 0 ? (
            <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(6) }}>
              +{hiddenPathCount} {t('atelier.diff.morePaths')}
            </text>
          ) : null}
        </view>
      ) : null}
    </view>
  );
}

function FeedbackBar({
  blockId,
  feedbackStatus,
  memoryConfirmationFeedbackId,
  memoryConfirming,
  rerunConfirmationFeedbackId,
  rerunConfirming,
  submittingId,
  taskId,
  onSubmitFeedback,
  onConfirmMemoryCandidate,
  onConfirmRerun,
}: {
  blockId: string;
  feedbackStatus: string;
  memoryConfirmationFeedbackId: string;
  memoryConfirming: boolean;
  rerunConfirmationFeedbackId: string;
  rerunConfirming: boolean;
  submittingId: string;
  taskId: string;
  onSubmitFeedback: (taskId: string, blockId: string, signal: AtelierFeedbackSignal) => Promise<void>;
  onConfirmMemoryCandidate: () => Promise<void>;
  onConfirmRerun: () => Promise<void>;
}) {
  const signals: Array<{ signal: AtelierFeedbackSignal; label: string }> = ATELIER_FEEDBACK_SIGNALS.map((signal) => ({
    signal,
    label: t(FEEDBACK_SIGNAL_LABEL_KEYS[signal]),
  }));
  return (
    <view style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: px(8) }}>
      {signals.map((item) => {
        const key = `${blockId}:${item.signal}`;
        const busy = submittingId === key;
        return (
          <view
            key={item.signal}
            bindtap={() => {
              if (!busy) void onSubmitFeedback(taskId, blockId, item.signal);
            }}
            style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(999), borderWidth: px(1), marginBottom: px(6), marginRight: px(6), opacity: submittingId && !busy ? 0.56 : 1, paddingBottom: px(6), paddingLeft: px(9), paddingRight: px(9), paddingTop: px(6) }}
          >
            <text style={{ color: busy ? colors.warning : colors.muted, fontSize: px(11), fontWeight: '700' }}>
              {busy ? t('atelier.feedback.submitting') : item.label}
            </text>
          </view>
        );
      })}
      {feedbackStatus ? (
        <text style={{ alignSelf: 'center', color: colors.subtle, fontSize: px(10), marginLeft: px(2) }}>{feedbackStatus}</text>
      ) : null}
      {memoryConfirmationFeedbackId ? (
        <view
          bindtap={() => {
            if (!memoryConfirming) void onConfirmMemoryCandidate();
          }}
          style={{ backgroundColor: colors.warningSoft, borderColor: '#fde68a', borderRadius: px(999), borderWidth: px(1), marginBottom: px(6), marginRight: px(6), paddingBottom: px(6), paddingLeft: px(9), paddingRight: px(9), paddingTop: px(6) }}
        >
          <text style={{ color: colors.warning, fontSize: px(11), fontWeight: '700' }}>
            {memoryConfirming ? t('atelier.feedback.confirmingMemory') : t('atelier.feedback.confirmMemory')}
          </text>
        </view>
      ) : null}
      {rerunConfirmationFeedbackId ? (
        <view
          bindtap={() => {
            if (!rerunConfirming) void onConfirmRerun();
          }}
          style={{ backgroundColor: colors.warningSoft, borderColor: '#fde68a', borderRadius: px(999), borderWidth: px(1), marginBottom: px(6), marginRight: px(6), paddingBottom: px(6), paddingLeft: px(9), paddingRight: px(9), paddingTop: px(6) }}
        >
          <text style={{ color: colors.warning, fontSize: px(11), fontWeight: '700' }}>
            {rerunConfirming ? t('atelier.feedback.confirmingRerun') : t('atelier.feedback.confirmRerun')}
          </text>
        </view>
      ) : null}
    </view>
  );
}

function NegoDisclosure({ block }: { block: AtelierStreamBlock }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Boolean(block.consensus) || Boolean(block.voices?.length);
  const statusLabel = block.converged ? t('atelier.nego.converged') : t('atelier.nego.pending');
  return (
    <view style={{ marginTop: px(8) }}>
      <view
        bindtap={() => {
          if (hasDetails) setExpanded((value) => !value);
        }}
        style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(10), borderWidth: px(1), flexDirection: 'row', padding: px(8) }}
      >
        <text style={{ color: colors.primary, fontSize: px(12), fontWeight: '700', marginRight: px(8) }}>Agents</text>
        <text style={{ color: colors.muted, flex: 1, fontSize: px(11), lineHeight: px(17), marginRight: px(8) }}>
          {statusLabel}{block.agentCount ? ` · ${block.agentCount}` : ''}
        </text>
        {hasDetails ? <text style={{ color: colors.subtle, fontSize: px(12) }}>{expanded ? '▾' : '▸'}</text> : null}
      </view>
      {expanded ? (
        <view style={{ marginTop: px(8) }}>
          {block.consensus ? (
            <text style={{ color: colors.muted, fontSize: px(12), lineHeight: px(18), marginBottom: px(6) }}>{block.consensus}</text>
          ) : null}
          {block.voices && block.voices.length > 0 ? <NegoVoiceList voices={block.voices} /> : null}
        </view>
      ) : null}
    </view>
  );
}

function NegoVoiceList({ voices }: { voices: AtelierNegoVoice[] }) {
  const visibleVoices = voices.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.negotiationVoices);
  const hiddenVoiceCount = Math.max(0, voices.length - visibleVoices.length);
  return (
    <view style={{ marginTop: px(8) }}>
      <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(5) }}>{t('atelier.nego.voices')}</text>
      {visibleVoices.map((voice, index) => {
        const noEvidenceObjection = voice.stance === 'objection' && !voice.evidenceRef;
        const roleColor = negoRoleColor(voice.role);
        const stanceLabel = noEvidenceObjection ? t('atelier.nego.concern') : negoStanceLabel(voice.stance);
        return (
          <view
            key={`${voice.role}:${voice.stance}:${index}`}
            style={{ backgroundColor: colors.panel, borderColor: noEvidenceObjection ? '#fde68a' : colors.border, borderRadius: px(10), borderWidth: px(1), flexDirection: 'row', marginTop: px(6), padding: px(8) }}
          >
            <NegoRoleMarker role={voice.role} color={roleColor} />
            <view style={{ flex: 1 }}>
              <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(4) }}>
                <text style={{ color: roleColor, flex: 1, fontSize: px(11), fontWeight: '700', marginRight: px(8) }}>{voice.role}</text>
                <text style={{ backgroundColor: noEvidenceObjection ? colors.warningSoft : colors.primarySoft, borderColor: noEvidenceObjection ? '#fde68a' : stanceColor(voice.stance), borderRadius: px(999), borderWidth: px(1), color: noEvidenceObjection ? colors.warning : stanceColor(voice.stance), fontSize: px(10), fontWeight: '700', paddingBottom: px(2), paddingLeft: px(6), paddingRight: px(6), paddingTop: px(2) }}>
                  {stanceLabel}
                </text>
              </view>
              <view style={{ borderColor: roleColor, borderLeftWidth: px(2), paddingLeft: px(8) }}>
                <text style={{ color: colors.muted, fontSize: px(11), lineHeight: px(17) }}>{voice.text}</text>
                {voice.evidenceRef ? (
                  <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(4) }}>{t('atelier.nego.evidence')}: {voice.evidenceRef}</text>
                ) : null}
              </view>
            </view>
          </view>
        );
      })}
      {hiddenVoiceCount > 0 ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(6) }}>
          +{hiddenVoiceCount} {t('atelier.nego.moreVoices')}
        </text>
      ) : null}
    </view>
  );
}

function NegoRoleMarker({ color, role }: { color: string; role: string }) {
  return (
    <view style={{ alignItems: 'center', marginRight: px(8) }}>
      <view style={{ alignItems: 'center', backgroundColor: color, borderRadius: px(999), height: px(22), justifyContent: 'center', width: px(22) }}>
        <text style={{ color: '#ffffff', fontSize: px(10), fontWeight: '700' }}>{negoRoleInitial(role)}</text>
      </view>
      <view style={{ backgroundColor: color, flex: 1, marginTop: px(4), minHeight: px(22), width: px(2) }} />
    </view>
  );
}

function TodoPanel({ todos }: { todos: AtelierTodoItem[] }) {
  const visibleTodos = todos.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.legacyTodos);
  const hiddenTodoCount = Math.max(0, todos.length - visibleTodos.length);
  return (
    <SidePanel title={t('atelier.section.todos')} detail={`${todos.length}`}>
      {visibleTodos.map((todo) => (
        <view key={todo.id} style={{ flexDirection: 'row', marginBottom: px(8) }}>
          <text style={{ color: todo.status === 'done' ? colors.success : colors.primary, fontSize: px(12), marginRight: px(7) }}>{todoGlyph(todo.status)}</text>
          <view style={{ flex: 1 }}>
            <text style={{ color: colors.text, fontSize: px(12), lineHeight: px(18) }}>{todo.text}</text>
            <text style={{ color: colors.subtle, fontSize: px(10), marginTop: px(2) }}>{todo.status}</text>
          </view>
        </view>
      ))}
      {hiddenTodoCount > 0 ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>
          +{hiddenTodoCount} {t('atelier.todos.moreProjected')}
        </text>
      ) : null}
      {todos.length === 0 ? <EmptySideText text={t('atelier.todos.empty')} /> : null}
    </SidePanel>
  );
}

function ProjectHealthPanel({ project }: { project: AtelierProjectProjection }) {
  const completionEntries = [
    ['noOpenBlockers', project.completion.noOpenBlockers],
    ['l0L1AcceptancePassed', project.completion.l0L1AcceptancePassed],
    ['l2HumanSignoffComplete', project.completion.l2HumanSignoffComplete],
    ['residualRisksLogged', project.completion.residualRisksLogged],
    ['memoryCandidatesGenerated', project.completion.memoryCandidatesGenerated],
  ] as const;
  const visibleBlockers = project.openBlockers.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const hiddenBlockerCount = Math.max(0, project.openBlockers.length - visibleBlockers.length);
  const visibleRisks = project.residualRisks.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const hiddenRiskCount = Math.max(0, project.residualRisks.length - visibleRisks.length);
  const visibleMilestones = project.milestoneTree.milestones.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthMilestones);
  const hiddenMilestoneCount = Math.max(0, project.milestoneTree.milestones.length - visibleMilestones.length);
  const visibleMemoryCandidates = project.memoryCandidates.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const hiddenMemoryCandidateCount = Math.max(0, project.memoryCandidates.length - visibleMemoryCandidates.length);
  const policyRules = project.policy?.rules ?? [];
  const visiblePolicyRules = policyRules.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const hiddenPolicyRuleCount = Math.max(0, policyRules.length - visiblePolicyRules.length);
  const visibleDefects = project.defects.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems);
  const hiddenDefectCount = Math.max(0, project.defects.length - visibleDefects.length);
  const formatMilestoneDetail = (milestone: AtelierProjectProjection['milestoneTree']['milestones'][number]) => {
    const visiblePredicateIds = milestone.acceptancePredicateIds.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.milestoneRefs);
    const hiddenPredicateCount = Math.max(0, milestone.acceptancePredicateIds.length - visiblePredicateIds.length);
    const visibleMilestoneBlockerRefs = milestone.openBlockers.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.milestoneRefs).map((blocker) => blocker.id);
    const hiddenMilestoneBlockerCount = Math.max(0, milestone.openBlockers.length - visibleMilestoneBlockerRefs.length);
    const refs = [
      visiblePredicateIds.length > 0
        ? `${t('atelier.projectHealth.predicateRefs')}: ${visiblePredicateIds.join(', ')}${hiddenPredicateCount > 0 ? ` +${hiddenPredicateCount} ${t('atelier.projectHealth.morePredicateRefs')}` : ''}`
        : '',
      visibleMilestoneBlockerRefs.length > 0
        ? `${t('atelier.projectHealth.blockerRefs')}: ${visibleMilestoneBlockerRefs.join(', ')}${hiddenMilestoneBlockerCount > 0 ? ` +${hiddenMilestoneBlockerCount} ${t('atelier.projectHealth.moreBlockerRefs')}` : ''}`
        : '',
    ].filter(Boolean);
    return [
      `${milestone.state} · ${milestone.taskIds.length} tasks · ${milestone.acceptancePredicateIds.length} predicates · ${milestone.openBlockers.length} blockers`,
      ...refs,
    ].join(' · ');
  };
  return (
    <SidePanel title={t('atelier.section.projectHealth')} detail={project.state}>
      <text style={{ color: colors.subtle, fontSize: px(11), lineHeight: px(16), marginBottom: px(8) }}>
        {t('atelier.projectHealth.readOnly')}
      </text>
      <text style={{ color: colors.text, fontSize: px(12), fontWeight: '700', lineHeight: px(18), marginBottom: px(6) }}>{project.title}</text>
      <PreviewLine label={t('atelier.projectHealth.workspace')} value={project.workspaceRef} />
      {project.migrationState ? (
        <view
          data-pt-project-migration={project.migrationState}
          data-pt-migration-goal-id={project.goalId}
          data-pt-migration-source-id={project.legacySourceId}
        >
          <PreviewLine label={t('atelier.migration.state')} value={t(`atelier.migration.${project.migrationState}`)} />
          <PreviewLine
            label={project.migrationState === 'migrated' ? t('atelier.migration.goalId') : t('atelier.migration.blockReason')}
            value={project.migrationState === 'migrated' ? project.goalId ?? '' : project.migrationBlockReason ?? ''}
          />
        </view>
      ) : null}
      <PreviewLine label={t('atelier.projectHealth.signoff')} value={project.goalOwnerSignoff ? t('atelier.projectHealth.yes') : t('atelier.projectHealth.no')} />
      <view style={{ marginTop: px(8) }}>
        <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(5) }}>{t('atelier.projectHealth.completion')}</text>
        {completionEntries.map(([key, passed]) => (
          <text key={key} style={{ color: passed ? colors.success : colors.warning, fontSize: px(11), lineHeight: px(17) }}>
            {passed ? '✓' : '!'} {t(`atelier.projectHealth.${key}`)}
          </text>
        ))}
      </view>
      <ProjectionItemList
        emptyKey="atelier.projectHealth.noBlockers"
        hiddenCount={hiddenBlockerCount}
        moreKey="atelier.projectHealth.moreBlockers"
        titleKey="atelier.projectHealth.blockers"
        items={visibleBlockers.map((blocker) => ({
          id: blocker.id,
          title: blocker.reason,
          detail: `${blocker.severity} · ${blocker.state} · ${blocker.evidenceRef}`,
        }))}
      />
      <ProjectionItemList
        emptyKey="atelier.projectHealth.noRisks"
        hiddenCount={hiddenRiskCount}
        moreKey="atelier.projectHealth.moreRisks"
        titleKey="atelier.projectHealth.risks"
        items={visibleRisks.map((risk) => ({
          id: risk.id,
          title: risk.desc,
          detail: `${risk.state} · ${risk.owner} · ${risk.evidenceRef}`,
        }))}
      />
      <ProjectionItemList
        emptyKey="atelier.projectHealth.noMilestones"
        hiddenCount={hiddenMilestoneCount}
        moreKey="atelier.projectHealth.moreMilestones"
        titleKey="atelier.projectHealth.milestones"
        items={visibleMilestones.map((milestone) => ({
          id: milestone.id,
          title: milestone.title,
          detail: formatMilestoneDetail(milestone),
        }))}
      />
      <ProjectionItemList
        emptyKey="atelier.projectHealth.noMemoryCandidates"
        hiddenCount={hiddenMemoryCandidateCount}
        moreKey="atelier.projectHealth.moreMemoryCandidates"
        titleKey="atelier.projectHealth.memoryCandidates"
        items={visibleMemoryCandidates.map((candidate) => ({
          id: candidate.id,
          title: candidate.content,
          detail: `${candidate.type} · ${candidate.scope} · ${candidate.confirmed ? t('atelier.projectHealth.confirmed') : t('atelier.projectHealth.pending')} · ${candidate.feeds.join('/')}`,
        }))}
      />
      {project.policy ? <PreviewLine label={t('atelier.projectHealth.policy')} value={`${project.policy.id} · ${project.policy.hardDeny ? 'hard-deny' : 'advisory'} · ${project.policy.rules.length} rules`} /> : null}
      <ProjectionItemList
        emptyKey="atelier.projectHealth.noPolicyRules"
        hiddenCount={hiddenPolicyRuleCount}
        moreKey="atelier.projectHealth.morePolicyRules"
        titleKey="atelier.projectHealth.policyRules"
        items={visiblePolicyRules.map((rule) => ({
          id: rule.id,
          title: rule.expr,
          detail: `${rule.scope} · ${rule.severity}`,
        }))}
      />
      <ProjectionItemList
        emptyKey="atelier.projectHealth.noDefects"
        hiddenCount={hiddenDefectCount}
        moreKey="atelier.projectHealth.moreDefects"
        titleKey="atelier.projectHealth.defects"
        items={visibleDefects.map((defect) => ({
          id: defect.id,
          title: defect.proposal.summary,
          detail: `${defect.source} · ${defect.state} · ${defect.taskId} · ${defect.evidenceRef}`,
        }))}
      />
    </SidePanel>
  );
}

function ProjectionItemList({
  emptyKey,
  hiddenCount,
  items,
  moreKey,
  titleKey,
}: {
  emptyKey: string;
  hiddenCount: number;
  items: Array<{ id: string; title: string; detail: string }>;
  moreKey: string;
  titleKey: string;
}) {
  return (
    <view style={{ marginTop: px(9) }}>
      <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(5) }}>{t(titleKey)}</text>
      {items.map((item) => (
        <view key={item.id} style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(10), borderWidth: px(1), marginBottom: px(6), padding: px(7) }}>
          <text style={{ color: colors.text, fontSize: px(11), fontWeight: '700', lineHeight: px(16) }}>{item.title}</text>
          <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>{item.detail}</text>
        </view>
      ))}
      {hiddenCount > 0 ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>
          +{hiddenCount} {t(moreKey)}
        </text>
      ) : null}
      {items.length === 0 ? <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15) }}>{t(emptyKey)}</text> : null}
    </view>
  );
}

function TaskGraphPanel({
  artifactsByTask,
  gatesByTask,
  project,
}: {
  artifactsByTask: Record<string, AtelierArtifactProjection[]>;
  gatesByTask: Record<string, AtelierGateProjection[]>;
  project: AtelierProjectProjection;
}) {
  const nodes = project.taskGraph.tasks;
  const visibleNodes = nodes.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodes);
  const hiddenNodeCount = Math.max(0, nodes.length - visibleNodes.length);
  const visibleRootTaskIds = project.taskGraph.rootTaskIds.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphRootIds);
  const hiddenRootTaskIdCount = Math.max(0, project.taskGraph.rootTaskIds.length - visibleRootTaskIds.length);
  const visibleEdges = project.taskGraph.edges.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphEdges);
  const hiddenEdgeCount = Math.max(0, project.taskGraph.edges.length - visibleEdges.length);
  return (
    <SidePanel title={t('atelier.section.taskGraph')} detail={`${nodes.length}`}>
      <text style={{ color: colors.subtle, fontSize: px(11), lineHeight: px(16), marginBottom: px(8) }}>
        {t('atelier.taskGraph.readOnly')}
      </text>
      <PreviewLine label={t('atelier.taskGraph.parallelPolicy')} value={project.taskGraph.parallelPolicy} />
      {project.taskGraph.parallelPolicy === 'integrator_required' ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginBottom: px(8) }}>
          {t('atelier.taskGraph.integratorBoundary')}
        </text>
      ) : null}
      <ProjectionItemList
        emptyKey="atelier.taskGraph.rootsEmpty"
        hiddenCount={hiddenRootTaskIdCount}
        items={visibleRootTaskIds.map((rootTaskId) => ({
          id: `root:${rootTaskId}`,
          title: rootTaskId,
          detail: t('atelier.taskGraph.rootDetail'),
        }))}
        moreKey="atelier.taskGraph.moreRoots"
        titleKey="atelier.taskGraph.roots"
      />
      <ProjectionItemList
        emptyKey="atelier.taskGraph.edgesEmpty"
        hiddenCount={hiddenEdgeCount}
        items={visibleEdges.map((edge, index) => ({
          id: `edge:${edge.from}:${edge.to}:${edge.type}:${index}`,
          title: `${edge.from} -> ${edge.to}`,
          detail: edge.type,
        }))}
        moreKey="atelier.taskGraph.moreEdges"
        titleKey="atelier.taskGraph.edges"
      />
      {visibleNodes.map((node) => (
        <TaskGraphNodeRow
          artifactsByTask={artifactsByTask}
          gatesByTask={gatesByTask}
          key={node.id}
          node={node}
        />
      ))}
      {hiddenNodeCount > 0 ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>
          +{hiddenNodeCount} {t('atelier.taskGraph.moreProjected')}
        </text>
      ) : null}
      {nodes.length === 0 ? <EmptySideText text={t('atelier.taskGraph.empty')} /> : null}
    </SidePanel>
  );
}

function TaskGraphNodeRow({
  artifactsByTask,
  gatesByTask,
  node,
}: {
  artifactsByTask: Record<string, AtelierArtifactProjection[]>;
  gatesByTask: Record<string, AtelierGateProjection[]>;
  node: AtelierTaskNodeProjection;
}) {
  const normalizedState = node.state.toLowerCase();
  const done = normalizedState === 'done' || normalizedState === 'accepted';
  const running = normalizedState === 'running';
  const blocked = normalizedState === 'blocked';
  const glyph = done ? '✓' : running ? '◐' : blocked ? '!' : '○';
  const color = done ? colors.success : running ? colors.primary : blocked ? colors.warning : colors.subtle;
  const evidenceView = deriveAtelierTaskGraphNodeEvidenceView({
    node,
    artifactsByTask,
    gatesByTask,
  });
  const visibleNodeArtifactRefs = evidenceView.visibleArtifactRefs;
  const visibleNodeGateRefs = evidenceView.visibleGateRefs;
  return (
    <view style={{ flexDirection: 'row', marginBottom: px(8) }}>
      <text style={{ color, fontSize: px(12), marginRight: px(7) }}>{glyph}</text>
      <view style={{ flex: 1 }}>
        <text style={{ color: colors.text, fontSize: px(12), lineHeight: px(18) }}>{node.title}</text>
        <text style={{ color: colors.subtle, fontSize: px(10), marginTop: px(2) }}>
          {node.agentRole} · {node.state}{evidenceView.evidenceCount > 0 ? ` · ${evidenceView.evidenceCount} evidence refs` : ''}
        </text>
        {visibleNodeArtifactRefs.length > 0 ? (
          <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>
            {t('atelier.taskGraph.artifactRefs')}: {visibleNodeArtifactRefs.map((ref) => ref.label).join(', ')}
            {evidenceView.hiddenArtifactCount > 0 ? ` +${evidenceView.hiddenArtifactCount} ${t('atelier.taskGraph.moreArtifactRefs')}` : ''}
            {evidenceView.unresolvedArtifactCount > 0 ? ` · ${evidenceView.unresolvedArtifactCount} unresolved` : ''}
          </text>
        ) : null}
        {visibleNodeGateRefs.length > 0 ? (
          <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>
            {t('atelier.taskGraph.gateRefs')}: {visibleNodeGateRefs.map((ref) => ref.label).join(', ')}
            {evidenceView.hiddenGateCount > 0 ? ` +${evidenceView.hiddenGateCount} ${t('atelier.taskGraph.moreGateRefs')}` : ''}
            {evidenceView.unresolvedGateCount > 0 ? ` · ${evidenceView.unresolvedGateCount} unresolved` : ''}
          </text>
        ) : null}
      </view>
    </view>
  );
}

function ContextPanel({ context }: { context: AtelierTaskContext | undefined }) {
  const files = context?.files ?? [];
  const usedPct = context?.usedPct ?? 0;
  const contextGroups = OFFICIAL_CONTEXT_FILE_GROUPS.map((group) => {
    const refs = files.filter((file) => file.group === group);
    const visibleRefs = refs.slice(0, CONTEXT_FILE_GROUP_DISPLAY_LIMITS[group]);
    return {
      group,
      hiddenCount: Math.max(0, refs.length - visibleRefs.length),
      moreKey: CONTEXT_FILE_GROUP_MORE_KEYS[group],
      refs: visibleRefs,
      titleKey: CONTEXT_FILE_GROUP_LABEL_KEYS[group],
    };
  });
  return (
    <SidePanel title={t('atelier.section.context')} detail={`${usedPct}%`}>
      <text style={{ color: colors.subtle, fontSize: px(11), lineHeight: px(16), marginBottom: px(8) }}>
        {t('atelier.context.readOnly')}
      </text>
      <view style={{ backgroundColor: colors.elevated, borderRadius: px(999), height: px(6), marginBottom: px(10), overflow: 'hidden' }}>
        <view style={{ backgroundColor: usedPct >= 85 ? colors.warning : colors.primary, borderRadius: px(999), height: px(6), width: `${Math.min(100, Math.max(0, usedPct))}%` }} />
      </view>
      {contextGroups.map((group) => (
        <ContextRefGroup
          key={group.group}
          title={t(group.titleKey)}
          refs={group.refs}
          hiddenCount={group.hiddenCount}
          moreKey={group.moreKey}
        />
      ))}
      {files.length === 0 ? <EmptySideText text={t('atelier.context.empty')} /> : null}
    </SidePanel>
  );
}

function ContextRefGroup({ title, refs, hiddenCount, moreKey }: { title: string; refs: AtelierContextFile[]; hiddenCount: number; moreKey: string }) {
  if (refs.length === 0 && hiddenCount === 0) return null;
  return (
    <view style={{ marginTop: px(8) }}>
      <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(5) }}>{title}</text>
      {refs.map((file) => (
        <view key={`${file.group}:${file.name}`} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(6) }}>
          <text style={{ color: colors.text, flex: 1, fontSize: px(12), marginRight: px(8) }}>{file.name}</text>
          <text style={{ color: colors.subtle, fontSize: px(10) }}>{file.group}</text>
        </view>
      ))}
      {hiddenCount > 0 ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>
          +{hiddenCount} {t(moreKey)}
        </text>
      ) : null}
    </view>
  );
}

function ArtifactPanel({
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
}: {
  artifacts: AtelierArtifactProjection[];
  selectedArtifactId: string;
  onSelectArtifact: (artifactId: string) => void;
}) {
  const visibleArtifacts = artifacts.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.sidePanelArtifacts);
  const hiddenArtifactCount = Math.max(0, artifacts.length - visibleArtifacts.length);
  return (
    <SidePanel title={t('atelier.section.artifacts')} detail={`${artifacts.length}`}>
      {visibleArtifacts.map((artifact) => (
        <view
          key={artifact.id}
          bindtap={() => onSelectArtifact(artifact.id)}
          style={{ backgroundColor: artifact.id === selectedArtifactId ? colors.primarySoft : colors.elevated, borderColor: artifact.id === selectedArtifactId ? '#bfdbfe' : colors.border, borderRadius: px(10), borderWidth: px(1), marginBottom: px(8), padding: px(8) }}
        >
          <text style={{ color: colors.text, fontSize: px(12), fontWeight: '700', marginBottom: px(3) }}>{artifact.name ?? artifact.id}</text>
          <text style={{ color: colors.muted, fontSize: px(11) }}>{artifact.kind ?? t('atelier.artifact.unknown')} · {artifact.meta ?? artifact.size ?? ''}</text>
        </view>
      ))}
      {hiddenArtifactCount > 0 ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>
          +{hiddenArtifactCount} {t('atelier.artifact.moreProjected')}
        </text>
      ) : null}
      {artifacts.length === 0 ? <EmptySideText text={t('atelier.artifacts.empty')} /> : null}
    </SidePanel>
  );
}

function ArtifactPreviewPanel({
  artifact,
  body,
  bodyError,
  loading,
  previewOpenResponse,
  previewOpenError,
  previewOpening,
  taskId,
  onFetchBody,
  onOpenPreview,
}: {
  artifact: AtelierArtifactProjection | undefined;
  body: AtelierArtifactBodyResponse | null;
  bodyError: string;
  loading: boolean;
  previewOpenResponse: AtelierArtifactPreviewOpenResponse | null;
  previewOpenError: string;
  previewOpening: boolean;
  taskId: string;
  onFetchBody: (taskId: string, artifact: AtelierArtifactProjection) => Promise<void>;
  onOpenPreview: (taskId: string, artifact: AtelierArtifactProjection) => Promise<void>;
}) {
  const canFetchBody = Boolean(artifact?.bodyRef && taskId);
  const canOpenPreview = Boolean(artifact?.previewTarget?.sandboxRef && taskId);
  return (
    <SidePanel title={t('atelier.section.artifactPreview')} detail={artifact?.kind ?? ''}>
      {artifact ? (
        <view>
          <text style={{ color: colors.text, fontSize: px(13), fontWeight: '700', lineHeight: px(19), marginBottom: px(5) }}>{artifact.name ?? artifact.id}</text>
          {artifact.meta ? <PreviewLine label={t('atelier.artifact.meta')} value={artifact.meta} /> : null}
          {artifact.previewHint ? <PreviewLine label={t('atelier.artifact.previewHint')} value={artifact.previewHint} /> : null}
          <PreviewLine label={t('atelier.artifact.previewBoundaryLabel')} value={t('atelier.artifact.previewBoundary')} />
          <PreviewLine label={t('atelier.artifact.runtimeLogs')} value={t('atelier.artifact.runtimeLogsUnsupported')} />
          <PreviewLine label={t('atelier.artifact.richRenderer')} value={t('atelier.artifact.richRendererUnsupported')} />
          {artifact.bodyRef ? <PreviewLine label={t('atelier.artifact.bodyRef')} value={artifact.bodyRef} /> : null}
          {artifact.bodyHash ? <PreviewLine label={t('atelier.artifact.bodyHash')} value={artifact.bodyHash} /> : null}
          {artifact.bodySize ? <PreviewLine label={t('atelier.artifact.bodySize')} value={artifact.bodySize} /> : null}
          {artifact.bodyKind ? <PreviewLine label={t('atelier.artifact.bodyKind')} value={artifact.bodyKind} /> : null}
          {artifact.size ? <PreviewLine label={t('atelier.artifact.size')} value={artifact.size} /> : null}
          {artifact.previewTarget ? (
            <view style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(10), borderWidth: px(1), marginTop: px(8), padding: px(8) }}>
              <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(5) }}>{t('atelier.artifact.previewTarget')}</text>
              {artifact.previewTarget.label ? <PreviewLine label={t('atelier.artifact.previewTargetLabel')} value={artifact.previewTarget.label} /> : null}
              {artifact.previewTarget.kind ? <PreviewLine label={t('atelier.artifact.previewTargetKind')} value={artifact.previewTarget.kind} /> : null}
              {artifact.previewTarget.mode ? <PreviewLine label={t('atelier.artifact.previewTargetMode')} value={artifact.previewTarget.mode} /> : null}
              {artifact.previewTarget.sandboxRef ? <PreviewLine label={t('atelier.artifact.previewTargetSandbox')} value={artifact.previewTarget.sandboxRef} /> : null}
              {artifact.previewTarget.bodyRef ? <PreviewLine label={t('atelier.artifact.previewTargetBody')} value={artifact.previewTarget.bodyRef} /> : null}
              {canOpenPreview ? (
                <view
                  bindtap={() => {
                    if (!previewOpening) void onOpenPreview(taskId, artifact);
                  }}
                  style={{ backgroundColor: colors.primarySoft, borderColor: '#bfdbfe', borderRadius: px(999), borderWidth: px(1), marginTop: px(8), padding: `${px(6)} ${px(9)}` }}
                >
                  <text style={{ color: colors.primary, fontSize: px(11), fontWeight: '700' }}>
                    {previewOpening ? t('atelier.artifact.previewOpening') : t('atelier.artifact.previewOpen')}
                  </text>
                </view>
              ) : null}
              {previewOpenError ? <PreviewLine label={t('atelier.artifact.previewOpenError')} value={previewOpenError} /> : null}
              {previewOpenResponse && previewOpenResponse.artifactId === artifact.id ? (
                <PreviewLine
                  label={t('atelier.artifact.previewOpenStatus')}
                  value={`${previewOpenResponse.rendererMode}:${previewOpenResponse.rendererStatus} · ${previewOpenResponse.rendererSessionId} · ${previewOpenResponse.reason}`}
                />
              ) : null}
            </view>
          ) : null}
          {canFetchBody ? (
            <view
              bindtap={() => {
                if (!loading) void onFetchBody(taskId, artifact);
              }}
              style={{ backgroundColor: colors.primarySoft, borderColor: '#bfdbfe', borderRadius: px(999), borderWidth: px(1), marginTop: px(10), padding: `${px(6)} ${px(9)}` }}
            >
              <text style={{ color: colors.primary, fontSize: px(11), fontWeight: '700' }}>
                {loading ? t('atelier.artifact.bodyFetching') : t('atelier.artifact.bodyFetch')}
              </text>
            </view>
          ) : null}
          {bodyError ? <PreviewLine label={t('atelier.artifact.bodyFetchError')} value={bodyError} /> : null}
          {body && body.artifactId === artifact.id ? (
            <SafeTextPreview body={body} />
          ) : null}
          {artifact.paths && artifact.paths.length > 0 ? (
            <ArtifactPathList paths={artifact.paths} />
          ) : null}
        </view>
      ) : (
        <EmptySideText text={t('atelier.artifact.noPreview')} />
      )}
    </SidePanel>
  );
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <view style={{ marginTop: px(6) }}>
      <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(2) }}>{label}</text>
      <text style={{ color: colors.muted, fontSize: px(11), lineHeight: px(17) }}>{value}</text>
    </view>
  );
}

function SafeTextPreview({ body }: { body: AtelierArtifactBodyResponse }) {
  const allLines = body.text.split('\n');
  const lines = allLines.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.safeTextPreviewLines);
  const hiddenLineCount = Math.max(0, allLines.length - lines.length);
  const markdownLike = body.bodyKind === 'markdown';
  return (
    <view style={{ backgroundColor: colors.elevated, borderColor: colors.border, borderRadius: px(10), borderWidth: px(1), marginTop: px(10), padding: px(8) }}>
      <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(5) }}>
        {body.truncated ? t('atelier.artifact.bodyPreviewTruncated') : t('atelier.artifact.bodyPreview')}
      </text>
      <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginBottom: px(6) }}>
        {markdownLike ? t('atelier.artifact.safeMarkdownPreview') : t('atelier.artifact.safeTextBoundary')}
      </text>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        const heading = markdownLike && /^#{1,3}\s+/.test(trimmed);
        const list = markdownLike && /^[-*]\s+/.test(trimmed);
        const code = markdownLike && (/^```/.test(trimmed) || /^ {4}/.test(line));
        const displayText = heading ? trimmed.replace(/^#{1,3}\s+/, '') : list ? `- ${trimmed.replace(/^[-*]\s+/, '')}` : line;
        return (
          <text
            key={`safe-text:${index}`}
            style={{
              color: code ? colors.subtle : colors.text,
              fontSize: heading ? px(12) : px(11),
              fontWeight: heading ? '700' : '400',
              lineHeight: px(17),
              marginBottom: heading ? px(4) : px(2),
            }}
          >
            {displayText.length > 0 ? displayText : ' '}
          </text>
        );
      })}
      {hiddenLineCount > 0 ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(6) }}>
          +{hiddenLineCount} {t('atelier.artifact.moreBodyLines')}
        </text>
      ) : null}
    </view>
  );
}

function ArtifactPathList({ paths }: { paths: string[] }) {
  const visiblePaths = paths.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.artifactPaths);
  const hiddenArtifactPathCount = Math.max(0, paths.length - visiblePaths.length);
  return (
    <view style={{ marginTop: px(8) }}>
      <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(5) }}>{t('atelier.artifact.paths')}</text>
      {visiblePaths.map((item) => (
        <text key={item} style={{ color: colors.muted, fontSize: px(11), lineHeight: px(17) }}>{item}</text>
      ))}
      {hiddenArtifactPathCount > 0 ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(5) }}>
          +{hiddenArtifactPathCount} {t('atelier.artifact.morePaths')}
        </text>
      ) : null}
    </view>
  );
}

function GatePanel({ gates }: { gates: AtelierGateProjection[] }) {
  const visibleGates = gates.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.gateItems);
  const hiddenGateCount = Math.max(0, gates.length - visibleGates.length);
  return (
    <SidePanel title={t('atelier.section.gates')} detail={`${gates.length}`}>
      {visibleGates.map((gate) => {
        const visibleChecks = gate.checks?.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.gateChecks) ?? [];
        const hiddenCheckCount = Math.max(0, (gate.checks?.length ?? 0) - visibleChecks.length);
        const visibleGateArtifactIds = gate.artifactIds?.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.gateArtifactRefs) ?? [];
        const hiddenGateArtifactCount = Math.max(0, (gate.artifactIds?.length ?? 0) - visibleGateArtifactIds.length);
        const gatePassed = gate.status === GATE_STATUS_PASSED;
        return (
          <view key={gate.id} style={{ backgroundColor: gatePassed ? colors.successSoft : colors.elevated, borderColor: colors.border, borderRadius: px(10), borderWidth: px(1), marginBottom: px(8), padding: px(8) }}>
            <view style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(3) }}>
              <text style={{ color: colors.text, flex: 1, fontSize: px(12), fontWeight: '700', marginRight: px(8) }}>{gate.name ?? gate.id}</text>
              <text style={{ color: gatePassed ? colors.success : colors.warning, fontSize: px(11), fontWeight: '700' }}>{gate.status ?? t('atelier.gate.unknown')}</text>
            </view>
            <text style={{ color: colors.muted, fontSize: px(11), lineHeight: px(17) }}>{gate.summary ?? t('atelier.gate.noSummary')}</text>
            {gate.checks && gate.checks.length > 0 ? (
              <view style={{ marginTop: px(8) }}>
                <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(5) }}>{gate.checks.length} {t('atelier.gate.checks')}</text>
                {visibleChecks.map((check) => (
                  <view key={`${gate.id}:${check.name}`} style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(8), borderWidth: px(1), marginTop: px(5), padding: px(7) }}>
                    <text style={{ color: colors.text, fontSize: px(11), fontWeight: '700' }}>{check.name} · {check.status}</text>
                    {check.detail ? <text style={{ color: colors.muted, fontSize: px(10), lineHeight: px(15), marginTop: px(3) }}>{check.detail}</text> : null}
                  </view>
                ))}
                {hiddenCheckCount > 0 ? (
                  <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(5) }}>
                    +{hiddenCheckCount} {t('atelier.gate.moreChecks')}
                  </text>
                ) : null}
              </view>
            ) : null}
            {gate.artifactIds && gate.artifactIds.length > 0 ? (
              <view style={{ marginTop: px(8) }}>
                <text style={{ color: colors.subtle, fontSize: px(10), fontWeight: '700', marginBottom: px(5) }}>{t('atelier.gate.artifacts')}</text>
                {visibleGateArtifactIds.map((artifactId) => (
                  <text key={`${gate.id}:${artifactId}`} style={{ color: colors.muted, fontSize: px(10), lineHeight: px(15) }}>{artifactId}</text>
                ))}
                {hiddenGateArtifactCount > 0 ? (
                  <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(5) }}>
                    +{hiddenGateArtifactCount} {t('atelier.gate.moreArtifacts')}
                  </text>
                ) : null}
              </view>
            ) : null}
          </view>
        );
      })}
      {hiddenGateCount > 0 ? (
        <text style={{ color: colors.subtle, fontSize: px(10), lineHeight: px(15), marginTop: px(2) }}>
          +{hiddenGateCount} {t('atelier.gate.moreProjected')}
        </text>
      ) : null}
      {gates.length === 0 ? <EmptySideText text={t('atelier.gates.empty')} /> : null}
    </SidePanel>
  );
}

function SidePanel({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <view style={{ backgroundColor: colors.panel, borderColor: colors.border, borderRadius: px(16), borderWidth: px(1), marginBottom: px(12), padding: px(12) }}>
      <SectionTitle title={title} detail={detail} />
      <view style={{ marginTop: px(10) }}>{children}</view>
    </view>
  );
}

function EmptySideText({ text }: { text: string }) {
  return <text style={{ color: colors.subtle, fontSize: px(12), lineHeight: px(18) }}>{text}</text>;
}

function stanceColor(stance: string): string {
  if (stance === 'objection') return colors.danger;
  if (stance === 'counter') return colors.warning;
  if (stance === 'signoff') return colors.success;
  return colors.primary;
}

function negoRoleColor(role: string): string {
  return NEGO_ROLE_COLORS[role] ?? colors.primary;
}

function negoRoleInitial(role: string): string {
  const trimmed = role.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 1).toUpperCase() : '?';
}

function negoStanceLabel(stance: string): string {
  return NEGO_STANCE_LABELS[stance] ?? stance;
}

function streamBlockDetail(block: AtelierStreamBlock): string {
  if (block.kind === 'decision') {
    return block.chosen
      ? `${t('atelier.decision.chosen')}: ${block.chosen}`
      : block.question ?? block.text ?? block.id;
  }
  if (block.kind === 'nego') {
    const count = block.agentCount ? `${block.agentCount} · ` : '';
    return `${count}${block.summary ?? block.text ?? block.id}`;
  }
  if (block.kind === 'artifact') {
    return `${block.name ?? block.title ?? block.id}${block.producedBy ? ` · ${block.producedBy}` : ''}`;
  }
  if (block.kind === 'diff') {
    return `${block.files ?? 0} ${t('atelier.diff.filesChanged')} +${block.added ?? 0} -${block.removed ?? 0}`;
  }
  return block.text || block.title || block.chosen || block.name || block.id;
}

function visibleDecisionOptions(options: AtelierDecisionOption[], chosen: string | undefined): AtelierDecisionOption[] {
  const pinned = options.filter((option) => option.recommended || option.text === chosen);
  const rest = options.filter((option) => !pinned.some((pinnedOption) => pinnedOption.text === option.text));
  return [...pinned, ...rest].slice(0, 3);
}

function todoGlyph(status: string): string {
  if (status === 'done') return '✓';
  if (status === 'running') return '●';
  return '○';
}

function normalizeTaskStatus(status: string): AtelierTaskLifecycleStatus {
  if (ATELIER_TASK_LIFECYCLE_STATES.includes(status as AtelierTaskLifecycleStatus)) return status as AtelierTaskLifecycleStatus;
  return 'active';
}

function readInputValue(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const record = event as { detail?: unknown; target?: unknown; value?: unknown };
  if (typeof record.value === 'string') return record.value;
  if (record.detail && typeof record.detail === 'object') {
    const detail = record.detail as { value?: unknown };
    if (typeof detail.value === 'string') return detail.value;
  }
  if (record.target && typeof record.target === 'object') {
    const target = record.target as { value?: unknown };
    if (typeof target.value === 'string') return target.value;
  }
  return '';
}

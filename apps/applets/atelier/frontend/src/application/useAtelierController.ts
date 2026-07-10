import { useCallback, useEffect, useMemo, useRef, useState } from '@lynx-js/react';
import type {
  AtelierArtifactProjection,
  AtelierGateProjection,
  AtelierProjectProjection,
  AtelierProjectionEvent,
  AtelierProjectionSnapshot,
  AtelierTask,
  AtelierTaskContext,
  AtelierTodoItem,
} from '../domain/projection';
import type {
  AtelierAgentFlowId,
  AtelierErrorKind,
  AtelierFeedbackSignal,
  AtelierArtifactBodyResponse,
  AtelierArtifactPreviewOpenResponse,
  AtelierProviderCapability,
  AtelierIntentPreset,
  AtelierRunTargetKind,
} from '../infrastructure/capability/atelierClient';
import {
  ATELIER_ARTIFACT_BODY_REF_SHAPE,
    ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE,
  ATELIER_ARTIFACT_PREVIEW_OPEN_MODES,
  ATELIER_ARTIFACT_SANDBOX_REF_SHAPE,
  ATELIER_DEFAULT_AGENT_FLOW_ID,
  ATELIER_DEFAULT_DIRECT_RUN_MODEL,
  ATELIER_DEFAULT_RUN_TARGET_KIND,
  ATELIER_DEFAULT_TASK_INTENT_PRESET,
  ATELIER_MEMORY_CONFIRMATION_MODE,
  ATELIER_RERUN_CONFIRMATION_MODE,
} from '../domain/projection.contract.generated';
import {
  confirmAtelierFeedbackRerun,
  confirmAtelierMemoryCandidate,
  createAtelierProjectFromGoal,
  fetchAtelierArtifactBody,
  loadAtelierProviderCapabilities,
  loadAtelierWorkspace,
  openAtelierArtifactPreview,
  openAtelierWorkspace,
  purgeAtelierTask,
  readAtelierCertificationCreateConfig,
  readAtelierCertificationDecisionConfig,
  readAtelierCertificationPreviewOpenConfig,
  resolveAtelierDecision,
  sendAtelierMessage,
  setAtelierTaskStatus,
  submitAtelierFeedback,
  subscribeAtelierProjectionEvents,
  trackAtelierProjectionSubscriptionDiagnostic,
} from '../infrastructure/capability/atelierClient';
import { t } from '../infrastructure/i18n/messages';
import {
  stateFromAtelierError,
  stateFromAtelierEventStreamConnecting,
  stateFromAtelierEventStreamError,
} from './controllerTransitions';
import { nextAtelierEventStreamRetryDelayMs } from './eventStreamRecovery';
import { stateFromMalformedAtelierProjectionEvent } from './eventStreamEventGuard';
import {
  applyAtelierProjectionEventWithResult,
  createAtelierProjectionRuntimeState,
  stateFromAtelierSnapshot,
  type AtelierProjectionRuntimeState,
} from './projectionReducer';
import {
  deriveAtelierViewStatus,
  type AtelierEventStreamState,
  type AtelierViewStatus,
} from './viewStatus';

export type AtelierTaskActionKind = 'archive' | 'restore' | 'delete' | 'purge';
export type { AtelierEventStreamState, AtelierViewStatus } from './viewStatus';

export interface AtelierCreatedProjectRenderEvidence {
  taskId: string;
  goal: string;
  runKind: AtelierRunTargetKind;
}

export interface AtelierDecisionResolutionRenderEvidence {
  taskId: string;
  blockId: string;
  choice: string;
}

export interface AtelierControllerState extends AtelierProjectionRuntimeState {
  loading: boolean;
  error: string;
  errorKind: AtelierErrorKind | '';
  eventStreamState: AtelierEventStreamState;
  eventStreamError: string;
  eventStreamErrorKind: AtelierErrorKind | '';
  lastAppliedProjectionEvent: AtelierProjectionEvent | null;
  resolvingDecisionId: string;
  creatingProject: boolean;
  sendingMessage: boolean;
  taskActionId: string;
  taskActionKind: AtelierTaskActionKind | '';
  purgeConfirmTaskId: string;
  providerCapabilities: AtelierProviderCapability[];
  providerCapabilitiesSource: string;
  providerCapabilitiesLoading: boolean;
  providerCapabilitiesError: string;
  feedbackSubmittingId: string;
  feedbackStatus: string;
  feedbackStatusBlockId: string;
  memoryConfirmationFeedbackId: string;
  memoryConfirmationTaskId: string;
  memoryConfirmationBlockId: string;
  memoryConfirming: boolean;
  rerunConfirmationFeedbackId: string;
  rerunConfirmationTaskId: string;
  rerunConfirmationBlockId: string;
  rerunConfirming: boolean;
  workspaceOpenSubmittingId: string;
  workspaceOpenStatus: string;
  artifactBody: AtelierArtifactBodyResponse | null;
  artifactBodyFetchId: string;
  artifactBodyError: string;
  artifactPreviewOpenResponse: AtelierArtifactPreviewOpenResponse | null;
  artifactPreviewOpenId: string;
  artifactPreviewOpenError: string;
  createdProjectRenderEvidence: AtelierCreatedProjectRenderEvidence | null;
  decisionResolutionRenderEvidence: AtelierDecisionResolutionRenderEvidence | null;
}

export interface AtelierController extends AtelierControllerState {
  viewStatus: AtelierViewStatus;
  selectedTask: AtelierTask | undefined;
  selectedProject: AtelierProjectProjection | undefined;
  selectedTodos: AtelierTodoItem[];
  selectedContext: AtelierTaskContext | undefined;
  selectedArtifacts: AtelierArtifactProjection[];
  selectedArtifact: AtelierArtifactProjection | undefined;
  selectedArtifactId: string;
  selectedGates: AtelierGateProjection[];
  budgetPercent: number;
  streamCount: number;
  artifactCount: number;
  gateCount: number;
  replayLabel: string;
  goalDraft: string;
  goalRevision: number;
  selectedRunKind: AtelierRunTargetKind;
  selectedModel: string;
  selectedFlowId: AtelierAgentFlowId;
  selectedIntentPreset: AtelierIntentPreset;
  composerText: string;
  composerRevision: number;
  load: () => Promise<void>;
  selectTask: (taskId: string) => void;
  selectArtifact: (artifactId: string) => void;
  setGoalDraft: (text: string) => void;
  setSelectedRunKind: (kind: AtelierRunTargetKind) => void;
  setSelectedModel: (model: string) => void;
  setSelectedFlowId: (flowId: AtelierAgentFlowId) => void;
  setSelectedIntentPreset: (preset: AtelierIntentPreset) => void;
  createProject: () => Promise<void>;
  setComposerText: (text: string) => void;
  insertProviderCapabilityCommand: (command: string) => void;
  sendMessage: () => Promise<void>;
  setTaskLifecycle: (taskId: string, action: AtelierTaskActionKind) => Promise<void>;
  resolveDecision: (taskId: string, blockId: string, choice: string) => Promise<void>;
  submitFeedback: (taskId: string, blockId: string, signal: AtelierFeedbackSignal) => Promise<void>;
  confirmMemoryCandidate: () => Promise<void>;
  confirmRerun: () => Promise<void>;
  openWorkspace: (task: AtelierTask) => Promise<void>;
  fetchArtifactBody: (taskId: string, artifact: AtelierArtifactProjection) => Promise<void>;
  openArtifactPreview: (taskId: string, artifact: AtelierArtifactProjection) => Promise<void>;
}

function certificationDecisionTarget(
  snapshot: AtelierProjectionSnapshot,
  configuredTaskId?: string,
  configuredBlockId?: string,
): { taskId: string; blockId: string } | null {
  const candidateTaskIds = [
    configuredTaskId?.trim() ?? '',
    snapshot.selectedTaskId,
    ...snapshot.workspace.tasks.map((task) => task.id),
  ].filter((taskId, index, values) => taskId && values.indexOf(taskId) === index);
  for (const taskId of candidateTaskIds) {
    const blocks = snapshot.workspace.streams[taskId] ?? [];
    const decision = blocks.find((block) =>
      block.kind === 'decision' &&
      !block.chosen &&
      (!configuredBlockId || block.id === configuredBlockId.trim())
    );
    if (decision) {
      return { taskId, blockId: decision.id };
    }
  }
  return null;
}

export function useAtelierController(): AtelierController {
  const [state, setState] = useState<AtelierControllerState>({
    ...createAtelierProjectionRuntimeState(),
    loading: true,
    error: '',
    errorKind: '',
    eventStreamState: 'idle',
    eventStreamError: '',
    eventStreamErrorKind: '',
    lastAppliedProjectionEvent: null,
    resolvingDecisionId: '',
    creatingProject: false,
    sendingMessage: false,
    taskActionId: '',
    taskActionKind: '',
    purgeConfirmTaskId: '',
    providerCapabilities: [],
    providerCapabilitiesSource: '',
    providerCapabilitiesLoading: false,
    providerCapabilitiesError: '',
    feedbackSubmittingId: '',
    feedbackStatus: '',
    feedbackStatusBlockId: '',
    memoryConfirmationFeedbackId: '',
    memoryConfirmationTaskId: '',
    memoryConfirmationBlockId: '',
    memoryConfirming: false,
    rerunConfirmationFeedbackId: '',
    rerunConfirmationTaskId: '',
    rerunConfirmationBlockId: '',
    rerunConfirming: false,
    workspaceOpenSubmittingId: '',
    workspaceOpenStatus: '',
    artifactBody: null,
    artifactBodyFetchId: '',
    artifactBodyError: '',
    artifactPreviewOpenResponse: null,
    artifactPreviewOpenId: '',
    artifactPreviewOpenError: '',
    createdProjectRenderEvidence: null,
    decisionResolutionRenderEvidence: null,
  });
  const [selectedArtifactId, setSelectedArtifactId] = useState('');
  const [goalDraft, setGoalDraft] = useState('');
  const [goalRevision, setGoalRevision] = useState(0);
  const [selectedRunKind, setSelectedRunKind] = useState<AtelierRunTargetKind>(ATELIER_DEFAULT_RUN_TARGET_KIND);
  const [selectedModel, setSelectedModel] = useState<string>(ATELIER_DEFAULT_DIRECT_RUN_MODEL);
  const [selectedFlowId, setSelectedFlowId] = useState<AtelierAgentFlowId>(ATELIER_DEFAULT_AGENT_FLOW_ID);
  const [selectedIntentPreset, setSelectedIntentPreset] = useState<AtelierIntentPreset>(ATELIER_DEFAULT_TASK_INTENT_PRESET);
  const [composerText, setComposerText] = useState('');
  const [composerRevision, setComposerRevision] = useState(0);
  const certificationCreateSubmittedRef = useRef(false);
  const certificationDecisionSubmittedRef = useRef(false);
  const certificationPreviewOpenSubmittedRef = useRef(false);
  const artifactBodyRequestSeq = useRef(0);
  const artifactPreviewOpenRequestSeq = useRef(0);

  const load = useCallback(async () => {
    setState((current) => ({
      ...current,
      loading: true,
      error: '',
      errorKind: '',
      eventStreamError: '',
      eventStreamErrorKind: '',
    }));
    try {
      let snapshot = await loadAtelierWorkspace();
      let createdProjectRenderEvidence: AtelierCreatedProjectRenderEvidence | null = null;
      let decisionResolutionRenderEvidence: AtelierDecisionResolutionRenderEvidence | null = null;
      const certificationCreate = certificationCreateSubmittedRef.current
        ? null
        : await readAtelierCertificationCreateConfig();
      if (certificationCreate) {
        certificationCreateSubmittedRef.current = true;
        setState((current) => ({ ...current, creatingProject: true }));
          const runKind = certificationCreate.runKind ?? ATELIER_DEFAULT_RUN_TARGET_KIND;
        snapshot = await createAtelierProjectFromGoal({
          ...certificationCreate,
          runKind,
        });
        const createdTaskId = snapshot.selectedTaskId;
        createdProjectRenderEvidence = {
          taskId: createdTaskId,
          goal: certificationCreate.goal,
          runKind,
        };
      }
      const certificationDecision = certificationDecisionSubmittedRef.current
        ? null
        : await readAtelierCertificationDecisionConfig();
      if (certificationDecision) {
        const target = certificationDecisionTarget(snapshot, certificationDecision.taskId, certificationDecision.blockId);
        if (target) {
          certificationDecisionSubmittedRef.current = true;
          setState((current) => ({ ...current, resolvingDecisionId: target.blockId }));
          snapshot = await resolveAtelierDecision({
            taskId: target.taskId,
            blockId: target.blockId,
            choice: certificationDecision.choice,
          });
          decisionResolutionRenderEvidence = {
            taskId: target.taskId,
            blockId: target.blockId,
            choice: certificationDecision.choice,
          };
        }
      }
      setState((current) => ({
        ...current,
        ...stateFromAtelierSnapshot(snapshot),
        loading: false,
        error: '',
        errorKind: '',
        eventStreamState: 'subscribing',
        eventStreamError: '',
        eventStreamErrorKind: '',
        resolvingDecisionId: '',
        creatingProject: false,
        sendingMessage: false,
        taskActionId: '',
        taskActionKind: '',
        purgeConfirmTaskId: '',
        artifactBody: null,
        artifactBodyFetchId: '',
        artifactBodyError: '',
        artifactPreviewOpenResponse: null,
        artifactPreviewOpenId: '',
        artifactPreviewOpenError: '',
        createdProjectRenderEvidence,
        decisionResolutionRenderEvidence,
      }));
    } catch (error) {
      void trackAtelierProjectionSubscriptionDiagnostic({
        stage: 'controller.load-error',
        selectedTaskId: state.selectedTaskId,
        snapshotSelectedTaskId: state.snapshot?.selectedTaskId,
        taskCount: state.snapshot?.workspace.tasks.length ?? 0,
        afterEventSeq: state.snapshot?.workspace.replay?.[state.selectedTaskId]?.nextEventSeq ?? 0,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      setState((current) => ({
        ...current,
        loading: false,
        ...stateFromAtelierError(error),
        creatingProject: false,
        sendingMessage: false,
        taskActionId: '',
        taskActionKind: '',
        purgeConfirmTaskId: '',
        createdProjectRenderEvidence: null,
        decisionResolutionRenderEvidence: null,
      }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const subscriptionTaskId =
    state.selectedTaskId || state.snapshot?.selectedTaskId || state.snapshot?.workspace.tasks[0]?.id || '';
  const subscriptionAfterEventSeq = state.snapshot?.workspace.replay?.[subscriptionTaskId]?.nextEventSeq ?? 0;
  const hasSnapshot = Boolean(state.snapshot);

  useEffect(() => {
    let disposed = false;
    setState((current) => ({
      ...current,
      providerCapabilitiesLoading: true,
      providerCapabilitiesError: '',
    }));
    void loadAtelierProviderCapabilities(state.selectedTaskId)
      .then((response) => {
        if (disposed) return;
        setState((current) => ({
          ...current,
          providerCapabilities: response.capabilities,
          providerCapabilitiesSource: response.source,
          providerCapabilitiesLoading: false,
          providerCapabilitiesError: '',
        }));
      })
      .catch((error) => {
        if (disposed) return;
        setState((current) => ({
          ...current,
          providerCapabilitiesLoading: false,
          providerCapabilitiesError: stateFromAtelierError(error).error,
        }));
      });
    return () => {
      disposed = true;
    };
  }, [state.selectedTaskId]);

  useEffect(() => {
    void trackAtelierProjectionSubscriptionDiagnostic({
      stage: state.snapshot ? 'controller.effect-enter' : 'controller.effect-no-snapshot',
      selectedTaskId: subscriptionTaskId,
      snapshotSelectedTaskId: state.snapshot?.selectedTaskId,
      taskCount: state.snapshot?.workspace.tasks.length ?? 0,
      afterEventSeq: subscriptionAfterEventSeq,
    }).catch(() => undefined);

    if (!state.snapshot) return undefined;

    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;

    const connect = () => {
      if (disposed || !state.snapshot) return;
      void trackAtelierProjectionSubscriptionDiagnostic({
        stage: 'controller.connect',
        selectedTaskId: subscriptionTaskId,
        snapshotSelectedTaskId: state.snapshot.selectedTaskId,
        taskCount: state.snapshot.workspace.tasks.length,
        afterEventSeq: subscriptionAfterEventSeq,
      }).catch(() => undefined);
      setState((current) => ({
        ...current,
        ...stateFromAtelierEventStreamConnecting(),
      }));
      void subscribeAtelierProjectionEvents(
        state.snapshot,
        subscriptionTaskId,
        (event) => {
          retryAttempt = 0;
          setState((current) => {
            const result = applyAtelierProjectionEventWithResult(current, event);
            const rejectedProjectionEvent =
              result.outcome === 'stale' || result.outcome === 'unknown-task'
                ? stateFromMalformedAtelierProjectionEvent()
                : {
                    loading: false as const,
                    eventStreamState: 'live' as const,
                    eventStreamError: '',
                    eventStreamErrorKind: '' as const,
                  };
            const artifactPreviewInvalidation =
              result.outcome === 'applied' &&
              event.patch.kind === 'artifact.upsert' &&
              event.patch.taskId === current.selectedTaskId
                ? {
                    artifactBody: null,
                    artifactBodyFetchId: '',
                    artifactBodyError: '',
                    artifactPreviewOpenResponse: null,
                    artifactPreviewOpenId: '',
                    artifactPreviewOpenError: '',
                  }
                : {};

            return {
              ...current,
              ...result.state,
              error: '',
              errorKind: '',
              ...rejectedProjectionEvent,
              ...artifactPreviewInvalidation,
              lastAppliedProjectionEvent: result.outcome === 'applied' ? event : current.lastAppliedProjectionEvent,
              resolvingDecisionId:
                event.patch.kind === 'decision.resolved' &&
                event.patch.blockId === current.resolvingDecisionId &&
                result.outcome === 'applied'
                  ? ''
                  : current.resolvingDecisionId,
              sendingMessage:
                current.sendingMessage && event.patch.kind === 'stream.append' && result.outcome === 'applied'
                  ? false
                  : current.sendingMessage,
            };
          });
        },
        () => {
          setState((current) => ({
            ...current,
            ...stateFromMalformedAtelierProjectionEvent(),
          }));
        },
      )
        .then((release) => {
          if (disposed) {
            release();
            return;
          }
          retryAttempt = 0;
          unsubscribe = release;
          setState((current) => ({
            ...current,
            eventStreamState: 'live',
            eventStreamError: '',
            eventStreamErrorKind: '',
          }));
        })
        .catch((error) => {
          if (disposed) return;
          const normalized = stateFromAtelierError(error);
          const retryDelayMs = nextAtelierEventStreamRetryDelayMs({
            attempt: retryAttempt,
            errorKind: normalized.errorKind,
            hasSnapshot: true,
          });
          setState((current) => ({
            ...current,
            ...stateFromAtelierEventStreamError(error, Boolean(current.snapshot)),
          }));
          if (retryDelayMs !== null) {
            retryAttempt += 1;
            retryTimer = setTimeout(connect, retryDelayMs);
          }
        });
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe?.();
    };
  }, [hasSnapshot, subscriptionTaskId, subscriptionAfterEventSeq]);

  const selectTask = useCallback((taskId: string) => {
    setState((current) => ({
      ...current,
      selectedTaskId: taskId,
      purgeConfirmTaskId: '',
      artifactBody: null,
      artifactBodyFetchId: '',
      artifactBodyError: '',
      artifactPreviewOpenResponse: null,
      artifactPreviewOpenId: '',
      artifactPreviewOpenError: '',
    }));
    setSelectedArtifactId('');
    setComposerText('');
    setComposerRevision((current) => current + 1);
  }, []);

  const selectArtifact = useCallback((artifactId: string) => {
    setState((current) => ({
      ...current,
      artifactBody: null,
      artifactBodyFetchId: '',
      artifactBodyError: '',
      artifactPreviewOpenResponse: null,
      artifactPreviewOpenId: '',
      artifactPreviewOpenError: '',
    }));
    setSelectedArtifactId(artifactId);
  }, []);

  const createProject = useCallback(async () => {
    const goal = goalDraft.trim();
    if (!goal || state.creatingProject) return;

    const selectedProject = state.snapshot?.workspace.tasks.find((task) => task.id === state.selectedTaskId)?.project;
    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      creatingProject: true,
      purgeConfirmTaskId: '',
    }));
    try {
      const snapshot = await createAtelierProjectFromGoal({
        goal,
        intentPreset: selectedIntentPreset,
        model: selectedModel,
        runKind: selectedRunKind,
        flowId: selectedFlowId,
        project: selectedProject,
      });
      setSelectedArtifactId('');
      setGoalDraft('');
      setGoalRevision((current) => current + 1);
      setComposerText('');
      setComposerRevision((current) => current + 1);
      setState((current) => ({
        ...current,
        ...stateFromAtelierSnapshot(snapshot),
        loading: false,
        error: '',
        errorKind: '',
        eventStreamState: 'live',
        eventStreamError: '',
        eventStreamErrorKind: '',
        resolvingDecisionId: '',
        creatingProject: false,
        sendingMessage: false,
        taskActionId: '',
        taskActionKind: '',
        purgeConfirmTaskId: '',
        artifactBody: null,
        artifactBodyFetchId: '',
        artifactBodyError: '',
        artifactPreviewOpenResponse: null,
        artifactPreviewOpenId: '',
        artifactPreviewOpenError: '',
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        ...stateFromAtelierError(error),
        creatingProject: false,
        purgeConfirmTaskId: '',
      }));
    }
  }, [goalDraft, selectedFlowId, selectedIntentPreset, selectedModel, selectedRunKind, state.creatingProject, state.selectedTaskId, state.snapshot]);

  const resolveDecision = useCallback(async (taskId: string, blockId: string, choice: string) => {
    const trimmedTaskId = taskId.trim();
    const trimmedBlockId = blockId.trim();
    const trimmedChoice = choice.trim();
    if (!trimmedTaskId || !trimmedBlockId || !trimmedChoice) return;

    setState((current) => ({ ...current, error: '', errorKind: '', resolvingDecisionId: trimmedBlockId }));
    try {
      const snapshot = await resolveAtelierDecision({
        taskId: trimmedTaskId,
        blockId: trimmedBlockId,
        choice: trimmedChoice,
      });
      setState((current) => ({
        ...current,
        ...stateFromAtelierSnapshot(snapshot),
        loading: false,
        error: '',
        errorKind: '',
        eventStreamState: 'live',
        eventStreamError: '',
        eventStreamErrorKind: '',
        resolvingDecisionId: '',
        creatingProject: false,
        sendingMessage: false,
        taskActionId: '',
        taskActionKind: '',
        purgeConfirmTaskId: '',
        artifactBody: null,
        artifactBodyFetchId: '',
        artifactBodyError: '',
        artifactPreviewOpenResponse: null,
        artifactPreviewOpenId: '',
        artifactPreviewOpenError: '',
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        ...stateFromAtelierError(error),
        resolvingDecisionId: '',
        creatingProject: false,
        purgeConfirmTaskId: '',
      }));
    }
  }, []);

  const sendMessage = useCallback(async () => {
    const taskId = state.selectedTaskId.trim();
    const text = composerText.trim();
    if (!taskId || !text || state.sendingMessage) return;

    setState((current) => ({ ...current, error: '', errorKind: '', sendingMessage: true }));
    try {
      const snapshot = await sendAtelierMessage({ taskId, text });
      setComposerText('');
      setComposerRevision((current) => current + 1);
      setState((current) => ({
        ...current,
        ...stateFromAtelierSnapshot(snapshot),
        loading: false,
        error: '',
        errorKind: '',
        eventStreamState: 'live',
        eventStreamError: '',
        eventStreamErrorKind: '',
        resolvingDecisionId: '',
        creatingProject: false,
        sendingMessage: false,
        taskActionId: '',
        taskActionKind: '',
        purgeConfirmTaskId: '',
        artifactBody: null,
        artifactBodyFetchId: '',
        artifactBodyError: '',
        artifactPreviewOpenResponse: null,
        artifactPreviewOpenId: '',
        artifactPreviewOpenError: '',
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        ...stateFromAtelierError(error),
        creatingProject: false,
        sendingMessage: false,
        purgeConfirmTaskId: '',
      }));
    }
  }, [composerText, state.selectedTaskId, state.sendingMessage]);

  const insertProviderCapabilityCommand = useCallback((command: string) => {
    const trimmed = command.trim();
    if (!trimmed.startsWith('/')) return;
    setComposerText((current) => {
      const existing = current.trim();
      return existing ? `${existing} ${trimmed} ` : `${trimmed} `;
    });
    setComposerRevision((current) => current + 1);
  }, []);

  const submitFeedback = useCallback(async (taskId: string, blockId: string, signal: AtelierFeedbackSignal) => {
    const trimmedTaskId = taskId.trim();
    const trimmedBlockId = blockId.trim();
    const submitKey = `${trimmedBlockId}:${signal}`;
    if (!trimmedTaskId || !trimmedBlockId || state.feedbackSubmittingId) return;

    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      feedbackSubmittingId: submitKey,
      feedbackStatus: '',
      feedbackStatusBlockId: trimmedBlockId,
    }));
    try {
      const response = await submitAtelierFeedback({
        taskId: trimmedTaskId,
        blockId: trimmedBlockId,
        signal,
      });
      const policy =
        signal === 'regenerate'
          ? response.rerunIntent.status
          : signal === 'positive' || signal === 'negative'
            ? response.memoryCandidate.status
            : 'acknowledged';
        const requiresMemoryConfirmation =
          response.memoryCandidate.requiresConfirmation && response.memoryCandidate.confirmationMode === ATELIER_MEMORY_CONFIRMATION_MODE;
        const requiresRerunConfirmation =
          response.rerunIntent.requiresConfirmation && response.rerunIntent.confirmationMode === ATELIER_RERUN_CONFIRMATION_MODE;
        const confirmation = requiresMemoryConfirmation
          ? ` · ${t('atelier.feedback.memoryConfirmationRequired')}`
          : requiresRerunConfirmation
            ? ` · ${t('atelier.feedback.rerunConfirmationRequired')}`
            : '';
      setState((current) => ({
        ...current,
        feedbackSubmittingId: '',
        feedbackStatus: `${signal}:${policy}${confirmation}`,
        feedbackStatusBlockId: trimmedBlockId,
        memoryConfirmationFeedbackId:
            requiresMemoryConfirmation
            ? response.feedbackId
            : current.memoryConfirmationFeedbackId,
        memoryConfirmationTaskId:
            requiresMemoryConfirmation
            ? trimmedTaskId
            : current.memoryConfirmationTaskId,
        memoryConfirmationBlockId:
            requiresMemoryConfirmation
            ? trimmedBlockId
            : current.memoryConfirmationBlockId,
        rerunConfirmationFeedbackId:
            requiresRerunConfirmation
            ? response.feedbackId
            : current.rerunConfirmationFeedbackId,
        rerunConfirmationTaskId:
            requiresRerunConfirmation
            ? trimmedTaskId
            : current.rerunConfirmationTaskId,
        rerunConfirmationBlockId:
            requiresRerunConfirmation
            ? trimmedBlockId
            : current.rerunConfirmationBlockId,
      }));
    } catch (error) {
      const normalized = stateFromAtelierError(error);
      setState((current) => ({
        ...current,
        ...normalized,
        feedbackSubmittingId: '',
        feedbackStatus: normalized.error,
        feedbackStatusBlockId: trimmedBlockId,
      }));
    }
  }, [state.feedbackSubmittingId]);

  const confirmMemoryCandidate = useCallback(async () => {
    if (!state.memoryConfirmationTaskId || !state.memoryConfirmationFeedbackId || state.memoryConfirming) return;
    const taskId = state.memoryConfirmationTaskId;
    const feedbackId = state.memoryConfirmationFeedbackId;
    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      memoryConfirming: true,
    }));
    try {
      const response = await confirmAtelierMemoryCandidate({ taskId, feedbackId });
      setState((current) => ({
        ...current,
        memoryConfirming: false,
        memoryConfirmationFeedbackId: '',
        memoryConfirmationTaskId: '',
        memoryConfirmationBlockId: '',
        feedbackStatus: `${t('atelier.feedback.memoryConfirmed')}:${response.memoryId}`,
        feedbackStatusBlockId: current.memoryConfirmationBlockId,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        ...stateFromAtelierError(error),
        memoryConfirming: false,
        memoryConfirmationFeedbackId: current.memoryConfirmationFeedbackId,
        memoryConfirmationTaskId: current.memoryConfirmationTaskId,
        memoryConfirmationBlockId: current.memoryConfirmationBlockId,
      }));
    }
  }, [state.memoryConfirmationTaskId, state.memoryConfirmationFeedbackId, state.memoryConfirming]);

  const confirmRerun = useCallback(async () => {
    if (!state.rerunConfirmationTaskId || !state.rerunConfirmationFeedbackId || state.rerunConfirming) return;
    const taskId = state.rerunConfirmationTaskId;
    const feedbackId = state.rerunConfirmationFeedbackId;
    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      rerunConfirming: true,
    }));
    try {
      const response = await confirmAtelierFeedbackRerun({ taskId, feedbackId });
      setState((current) => ({
        ...current,
        rerunConfirming: false,
        rerunConfirmationFeedbackId: '',
        rerunConfirmationTaskId: '',
        rerunConfirmationBlockId: '',
        feedbackStatus: `${t('atelier.feedback.rerunConfirmed')}:${response.rerunTaskId}`,
        feedbackStatusBlockId: current.rerunConfirmationBlockId,
      }));
      await load();
    } catch (error) {
      setState((current) => ({
        ...current,
        ...stateFromAtelierError(error),
        rerunConfirming: false,
        rerunConfirmationFeedbackId: current.rerunConfirmationFeedbackId,
        rerunConfirmationTaskId: current.rerunConfirmationTaskId,
        rerunConfirmationBlockId: current.rerunConfirmationBlockId,
      }));
    }
  }, [state.rerunConfirmationTaskId, state.rerunConfirmationFeedbackId, state.rerunConfirming, load]);

  const openWorkspace = useCallback(async (task: AtelierTask) => {
    const target = task.workspaceOpenTarget;
    if (!target || state.workspaceOpenSubmittingId) return;

    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      workspaceOpenSubmittingId: task.id,
      workspaceOpenStatus: '',
    }));
    try {
      const response = await openAtelierWorkspace({
        taskId: task.id,
        workspaceUri: target.workspaceUri,
        ideHint: target.ideHint,
      });
      setState((current) => ({
        ...current,
        workspaceOpenSubmittingId: '',
        workspaceOpenStatus: `${response.mode}:${response.opened ? 'opened' : 'accepted'}`,
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        ...stateFromAtelierError(error),
        workspaceOpenSubmittingId: '',
      }));
    }
  }, [state.workspaceOpenSubmittingId]);

  const fetchArtifactBody = useCallback(async (taskId: string, artifact: AtelierArtifactProjection) => {
    const trimmedTaskId = taskId.trim();
    const artifactId = artifact.id.trim();
    const bodyRef = artifact.bodyRef?.trim() ?? '';
    const fetchKey = `${trimmedTaskId}:${artifactId}`;
    if (!trimmedTaskId || !artifactId || !bodyRef || state.artifactBodyFetchId) return;
    if (!isCanonicalAtelierArtifactBodyRef(bodyRef)) {
      setState((current) => ({
        ...current,
        artifactBody: null,
        artifactBodyError: t('atelier.error.invalidArtifactBodyResponse'),
      }));
      return;
    }

    const requestSeq = ++artifactBodyRequestSeq.current;
    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      artifactBody: null,
      artifactBodyFetchId: fetchKey,
      artifactBodyError: '',
    }));
    try {
      const response = await fetchAtelierArtifactBody({
        taskId: trimmedTaskId,
        artifactId,
        bodyRef,
        expectedHash: artifact.bodyHash,
      });
      setState((current) => {
        if (artifactBodyRequestSeq.current !== requestSeq || current.artifactBodyFetchId !== fetchKey) {
          return current;
        }
        return {
          ...current,
          artifactBody: response,
          artifactBodyFetchId: '',
          artifactBodyError: '',
        };
      });
    } catch (error) {
      const normalized = stateFromAtelierError(error);
      setState((current) => {
        if (artifactBodyRequestSeq.current !== requestSeq || current.artifactBodyFetchId !== fetchKey) {
          return current;
        }
        return {
          ...current,
          ...normalized,
          artifactBody: null,
          artifactBodyFetchId: '',
          artifactBodyError: normalized.error,
        };
      });
    }
  }, [state.artifactBodyFetchId]);

  const openArtifactPreview = useCallback(async (taskId: string, artifact: AtelierArtifactProjection) => {
    const trimmedTaskId = taskId.trim();
    const artifactId = artifact.id.trim();
    const previewTarget = artifact.previewTarget;
    const sandboxRef = previewTarget?.sandboxRef?.trim() ?? '';
    const bodyRef = previewTarget?.bodyRef?.trim() || artifact.bodyRef?.trim() || '';
    const mode = previewTarget?.mode?.trim() || ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE;
    const openKey = `${trimmedTaskId}:${artifactId}`;
    if (!trimmedTaskId || !artifactId || !sandboxRef || !bodyRef || state.artifactPreviewOpenId) return;
    if (!isCanonicalAtelierSandboxRef(sandboxRef) || !isCanonicalAtelierArtifactBodyRef(bodyRef) || !isAtelierArtifactPreviewOpenMode(mode)) {
      setState((current) => ({
        ...current,
        artifactPreviewOpenResponse: null,
        artifactPreviewOpenError: t('atelier.error.invalidArtifactPreviewOpenResponse'),
      }));
      return;
    }

    const requestSeq = ++artifactPreviewOpenRequestSeq.current;
    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      artifactPreviewOpenResponse: null,
      artifactPreviewOpenId: openKey,
      artifactPreviewOpenError: '',
    }));
    try {
      const response = await openAtelierArtifactPreview({
        taskId: trimmedTaskId,
        artifactId,
        sandboxRef,
        bodyRef,
        kind: previewTarget?.kind,
        mode,
      });
      setState((current) => {
        if (artifactPreviewOpenRequestSeq.current !== requestSeq || current.artifactPreviewOpenId !== openKey) {
          return current;
        }
        return {
          ...current,
          artifactPreviewOpenResponse: response,
          artifactPreviewOpenId: '',
          artifactPreviewOpenError: '',
        };
      });
    } catch (error) {
      const normalized = stateFromAtelierError(error);
      setState((current) => {
        if (artifactPreviewOpenRequestSeq.current !== requestSeq || current.artifactPreviewOpenId !== openKey) {
          return current;
        }
        return {
          ...current,
          ...normalized,
          artifactPreviewOpenResponse: null,
          artifactPreviewOpenId: '',
          artifactPreviewOpenError: normalized.error,
        };
      });
    }
  }, [state.artifactPreviewOpenId]);

  useEffect(() => {
    if (certificationPreviewOpenSubmittedRef.current || state.loading || !state.snapshot || state.artifactPreviewOpenId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const config = await readAtelierCertificationPreviewOpenConfig();
      if (!config || cancelled || certificationPreviewOpenSubmittedRef.current) {
        return;
      }
      const taskId = config.taskId ?? state.selectedTaskId;
      if (!taskId) {
        return;
      }
      const artifacts = state.snapshot?.workspace.artifacts[taskId] ?? [];
      const artifact =
        (config.artifactId ? artifacts.find((candidate) => candidate.id === config.artifactId) : undefined) ??
        artifacts.find((candidate) => candidate.previewTarget?.sandboxRef && (candidate.previewTarget?.bodyRef || candidate.bodyRef));
      if (!artifact) {
        return;
      }
      certificationPreviewOpenSubmittedRef.current = true;
      await openArtifactPreview(taskId, artifact);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    openArtifactPreview,
    state.artifactPreviewOpenId,
    state.loading,
    state.selectedTaskId,
    state.snapshot,
  ]);

  const setTaskLifecycle = useCallback(async (taskId: string, action: AtelierTaskActionKind) => {
    const trimmedTaskId = taskId.trim();
    if (!trimmedTaskId || state.taskActionId) return;

    if (action === 'purge' && state.purgeConfirmTaskId !== trimmedTaskId) {
      setState((current) => ({
        ...current,
        error: '',
        errorKind: '',
        purgeConfirmTaskId: trimmedTaskId,
      }));
      return;
    }

    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      taskActionId: trimmedTaskId,
      taskActionKind: action,
      purgeConfirmTaskId: '',
    }));
    try {
      const snapshot =
        action === 'purge'
          ? await purgeAtelierTask({ taskId: trimmedTaskId })
          : await setAtelierTaskStatus({
              taskId: trimmedTaskId,
              status: action === 'archive' ? 'archived' : action === 'restore' ? 'active' : 'deleted',
            });
      setSelectedArtifactId('');
      setComposerText('');
      setComposerRevision((current) => current + 1);
      setState((current) => ({
        ...current,
        ...stateFromAtelierSnapshot(snapshot),
        loading: false,
        error: '',
        errorKind: '',
        eventStreamState: 'live',
        eventStreamError: '',
        eventStreamErrorKind: '',
        resolvingDecisionId: '',
        creatingProject: false,
        sendingMessage: false,
        taskActionId: '',
        taskActionKind: '',
        purgeConfirmTaskId: '',
        artifactBody: null,
        artifactBodyFetchId: '',
        artifactBodyError: '',
        artifactPreviewOpenResponse: null,
        artifactPreviewOpenId: '',
        artifactPreviewOpenError: '',
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        ...stateFromAtelierError(error),
        creatingProject: false,
        taskActionId: '',
        taskActionKind: '',
        purgeConfirmTaskId: '',
      }));
    }
  }, [state.purgeConfirmTaskId, state.taskActionId]);

  const selectedTask = useMemo(
    () => state.snapshot?.workspace.tasks.find((task) => task.id === state.selectedTaskId),
    [state.selectedTaskId, state.snapshot],
  );
  const selectedProjectProjection = useMemo(
    () => state.snapshot?.workspace.projects?.find((project) =>
      project.id === selectedTask?.projectId ||
      project.taskGraph.tasks.some((node) => node.id === state.selectedTaskId),
    ),
    [selectedTask?.projectId, state.selectedTaskId, state.snapshot],
  );

  const selectedTodos = state.snapshot?.workspace.todos[state.selectedTaskId] ?? [];
  const selectedContext = state.snapshot?.workspace.contexts[state.selectedTaskId];
  const selectedArtifacts = state.snapshot?.workspace.artifacts[state.selectedTaskId] ?? [];
  const selectedArtifact = selectedArtifacts.find((artifact) => artifact.id === selectedArtifactId) ?? selectedArtifacts[0];
  const selectedGates = state.snapshot?.workspace.gates?.[state.selectedTaskId] ?? [];
  const streamCount = state.snapshot?.workspace.streams[state.selectedTaskId]?.length ?? 0;
  const artifactCount = selectedArtifacts.length;
  const gateCount = selectedGates.length;
  const budgetSpent = state.snapshot?.workspace.budgetSpent ?? 0;
  const budgetCap = state.snapshot?.workspace.budgetCap ?? 0;
  const budgetPercent = budgetCap > 0 ? Math.min(100, Math.max(0, Math.round((budgetSpent / budgetCap) * 100))) : 0;
  const replay = state.snapshot?.workspace.replay?.[state.selectedTaskId];
  const replayLabel = replay
    ? `${replay.replayedEventCount}/${replay.eventCount} · seq ${replay.nextEventSeq}${replay.hasMore ? ' · partial' : ''}`
    : t('atelier.replay.unknown');
  const viewStatus = deriveAtelierViewStatus({
    loading: state.loading,
    error: state.error,
    errorKind: state.errorKind,
    eventStreamErrorKind: state.eventStreamErrorKind,
    eventStreamState: state.eventStreamState,
    replayHasMore: Boolean(replay?.hasMore),
    taskCount: state.snapshot?.workspace.tasks.length ?? 0,
  });

  return {
    ...state,
    viewStatus,
    selectedTask,
    selectedProject: selectedProjectProjection,
    selectedTodos,
    selectedContext,
    selectedArtifacts,
    selectedArtifact,
    selectedArtifactId: selectedArtifact?.id ?? '',
    selectedGates,
    budgetPercent,
    streamCount,
    artifactCount,
    gateCount,
    replayLabel,
    goalDraft,
    goalRevision,
      selectedRunKind,
    selectedModel,
      selectedFlowId,
    selectedIntentPreset,
    composerText,
    composerRevision,
    load,
    selectTask,
    selectArtifact,
    setGoalDraft,
      setSelectedRunKind,
    setSelectedModel,
      setSelectedFlowId,
    setSelectedIntentPreset,
    createProject,
    setComposerText,
    insertProviderCapabilityCommand,
    sendMessage,
    setTaskLifecycle,
    resolveDecision,
    submitFeedback,
    confirmMemoryCandidate,
    confirmRerun,
    openWorkspace,
    fetchArtifactBody,
    openArtifactPreview,
  };
}

function isCanonicalAtelierArtifactBodyRef(value: string): boolean {
  return isCanonicalAtelierArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE);
}

function isCanonicalAtelierSandboxRef(value: string): boolean {
  return isCanonicalAtelierArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE);
}

function isCanonicalAtelierArtifactRef(
  value: string,
  shape: { scheme: string; pathSegments: number; terminalSegment: string },
): boolean {
  if (/\s/.test(value)) return false;
  try {
    const uri = new URL(value);
    const path = uri.pathname.split('/').filter(Boolean);
    return (
      uri.protocol.slice(0, -1) === shape.scheme &&
      uri.hostname.trim().length > 0 &&
      path.length === shape.pathSegments &&
      path[path.length - 1] === shape.terminalSegment &&
      path.slice(0, -1).every((segment) => segment.trim().length > 0)
    );
  } catch {
    return false;
  }
}

function isAtelierArtifactPreviewOpenMode(value: string): boolean {
  return (ATELIER_ARTIFACT_PREVIEW_OPEN_MODES as readonly string[]).includes(value);
}

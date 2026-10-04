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
  AtelierCertificationCreateConfig,
  AtelierErrorKind,
  AtelierFeedbackSignal,
  AtelierArtifactBodyResponse,
  AtelierArtifactPreviewOpenResponse,
  AtelierProviderCapability,
  AtelierIntentPreset,
  AtelierRunTargetKind,
} from '../infrastructure/capability/atelierClient';
import {
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
  readAtelierCertificationArtifactBodyFetchConfig,
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
import {
  stateFromAtelierProjectionEventApplyOutcome,
  stateFromMalformedAtelierProjectionEvent,
} from './eventStreamEventGuard';
import {
  applyAtelierProjectionEventWithResult,
  createAtelierProjectionRuntimeState,
  reconcileAtelierSnapshot,
  stateFromAtelierSnapshot,
  type AtelierProjectionRuntimeState,
} from './projectionReducer';
import {
  deriveAtelierViewStatus,
  type AtelierEventStreamState,
  type AtelierViewStatus,
} from './viewStatus';
import {
  buildAtelierArtifactBodyFetchIntent,
  buildAtelierArtifactPreviewOpenIntent,
  isCurrentAtelierArtifactRequest,
} from './artifactActionGuards';
import {
  buildAtelierTaskLifecycleIntent,
  type AtelierTaskActionKind,
} from './taskLifecycleActionGuards';
import { buildAtelierMessageSendIntent } from './messageActionGuards';
import { buildAtelierDecisionResolveIntent } from './decisionActionGuards';
import { buildAtelierFeedbackSubmitIntent } from './feedbackActionGuards';
import {
  buildAtelierMemoryConfirmIntent,
  buildAtelierRerunConfirmIntent,
} from './confirmationActionGuards';
import { buildAtelierWorkspaceOpenIntent } from './workspaceActionGuards';
import { buildAtelierProjectCreateIntent } from './projectCreateActionGuards';
import {
  appendAtelierProviderCapabilityCommand,
  buildAtelierProviderCapabilityDiscoveryIntent,
  buildAtelierProviderCapabilityCommandInsertIntent,
} from './providerCapabilityActionGuards';

export type { AtelierTaskActionKind } from './taskLifecycleActionGuards';
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

const certificationCreateSubmissionKeys = new Set<string>();

function certificationCreateSubmissionKey(config: AtelierCertificationCreateConfig): string {
  return JSON.stringify({
    flowId: config.flowId ?? '',
    goal: config.goal,
    intentPreset: config.intentPreset ?? '',
    model: config.model ?? '',
    project: config.project ?? '',
    runKind: config.runKind ?? ATELIER_DEFAULT_RUN_TARGET_KIND,
  });
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
  const certificationArtifactBodyFetchSubmittedRef = useRef(false);
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
      const certificationCreateKey = certificationCreate
        ? certificationCreateSubmissionKey(certificationCreate)
        : '';
      if (certificationCreate && !certificationCreateSubmissionKeys.has(certificationCreateKey)) {
        certificationCreateSubmittedRef.current = true;
        certificationCreateSubmissionKeys.add(certificationCreateKey);
        setState((current) => ({ ...current, creatingProject: true }));
        const runKind = certificationCreate.runKind ?? ATELIER_DEFAULT_RUN_TARGET_KIND;
        try {
          snapshot = await createAtelierProjectFromGoal({
            ...certificationCreate,
            runKind,
          });
        } catch (error) {
          certificationCreateSubmissionKeys.delete(certificationCreateKey);
          throw error;
        }
        const createdTaskId = snapshot.selectedTaskId;
        createdProjectRenderEvidence = {
          taskId: createdTaskId,
          goal: certificationCreate.goal,
          runKind,
        };
      } else if (certificationCreate) {
        certificationCreateSubmittedRef.current = true;
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

  const hasSnapshot = Boolean(state.snapshot);

  useEffect(() => {
    const intentResult = buildAtelierProviderCapabilityDiscoveryIntent({
      taskId: state.selectedTaskId,
    });
    if (intentResult.status === 'invalid') return undefined;
    const { intent } = intentResult;
    let disposed = false;
    setState((current) => ({
      ...current,
      providerCapabilitiesLoading: true,
      providerCapabilitiesError: '',
    }));
    void loadAtelierProviderCapabilities(intent.taskId)
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
      selectedTaskId: state.selectedTaskId,
      snapshotSelectedTaskId: state.snapshot?.selectedTaskId,
      taskCount: state.snapshot?.workspace.tasks.length ?? 0,
    }).catch(() => undefined);

    if (!state.snapshot) return undefined;

    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryAttempt = 0;
    let reconcileInFlight = false;
    let reconcileQueued = false;

    const reconcileFromCanonicalEvent = () => {
      if (disposed) return;
      if (reconcileInFlight) {
        reconcileQueued = true;
        return;
      }
      reconcileInFlight = true;
      setState((current) => ({
        ...current,
        eventStreamState: 'subscribing',
        eventStreamError: '',
        eventStreamErrorKind: '',
      }));
      void (async () => {
        do {
          reconcileQueued = false;
          try {
            const snapshot = await loadAtelierWorkspace();
            if (disposed) return;
            setState((current) => ({
              ...current,
              ...reconcileAtelierSnapshot(current, snapshot),
              loading: false,
              error: '',
              errorKind: '',
              eventStreamState: 'live',
              eventStreamError: '',
              eventStreamErrorKind: '',
            }));
          } catch (error) {
            if (disposed) return;
            setState((current) => ({
              ...current,
              ...stateFromAtelierEventStreamError(error, Boolean(current.snapshot)),
            }));
          }
        } while (reconcileQueued && !disposed);
        reconcileInFlight = false;
      })();
    };

    const connect = () => {
      if (disposed || !state.snapshot) return;
      void trackAtelierProjectionSubscriptionDiagnostic({
        stage: 'controller.connect',
        selectedTaskId: state.selectedTaskId,
        snapshotSelectedTaskId: state.snapshot.selectedTaskId,
        taskCount: state.snapshot.workspace.tasks.length,
      }).catch(() => undefined);
      setState((current) => ({
        ...current,
        ...stateFromAtelierEventStreamConnecting(),
      }));
      const handleSubscriptionRejected = (error: unknown) => {
        if (disposed) return;
        const normalized = stateFromAtelierError(error);
        const retryDelayMs = nextAtelierEventStreamRetryDelayMs({
          attempt: retryAttempt,
          errorKind: normalized.errorKind,
          hasSnapshot: true,
        });
        void trackAtelierProjectionSubscriptionDiagnostic({
          stage: 'controller.subscribe-rejected',
          selectedTaskId: state.selectedTaskId,
          snapshotSelectedTaskId: state.snapshot?.selectedTaskId,
          taskCount: state.snapshot?.workspace.tasks.length ?? 0,
          error: error instanceof Error ? error.message : String(error),
          errorKind: normalized.errorKind,
          retryAttempt,
          retryDelayMs,
          retryable: retryDelayMs !== null,
        }).catch(() => undefined);
        setState((current) => ({
          ...current,
          ...stateFromAtelierEventStreamError(error, Boolean(current.snapshot)),
        }));
        if (retryDelayMs !== null) {
          retryAttempt += 1;
          retryTimer = setTimeout(connect, retryDelayMs);
        }
      };
      void subscribeAtelierProjectionEvents(
        state.snapshot,
        state.selectedTaskId,
        (event) => {
          retryAttempt = 0;
          setState((current) => {
            const result = applyAtelierProjectionEventWithResult(current, event);
            const eventApplyUiState = stateFromAtelierProjectionEventApplyOutcome(result.outcome);
            if (result.outcome === 'reconcile' || result.outcome === 'gap') {
              queueMicrotask(reconcileFromCanonicalEvent);
            }
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
              ...eventApplyUiState,
              ...artifactPreviewInvalidation,
              lastAppliedProjectionEvent:
                result.outcome === 'applied'
                || result.outcome === 'reconcile'
                || result.outcome === 'gap'
                  ? event
                  : current.lastAppliedProjectionEvent,
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
        handleSubscriptionRejected,
        reconcileFromCanonicalEvent,
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
        .catch(handleSubscriptionRejected);
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe?.();
    };
  }, [hasSnapshot]);

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
    const selectedProject = state.snapshot?.workspace.tasks.find((task) => task.id === state.selectedTaskId)?.project;
    const intentResult = buildAtelierProjectCreateIntent({
      goal: goalDraft,
      intentPreset: selectedIntentPreset,
      model: selectedModel,
      runKind: selectedRunKind,
      flowId: selectedFlowId,
      project: selectedProject,
      pending: state.creatingProject,
    });
    if (intentResult.status === 'blocked' || intentResult.status === 'invalid') return;
    const { intent } = intentResult;

    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      creatingProject: true,
      purgeConfirmTaskId: '',
    }));
    try {
      const snapshot = await createAtelierProjectFromGoal(intent);
      setSelectedArtifactId('');
      setGoalDraft('');
      setGoalRevision((current) => current + 1);
      setComposerText('');
      setComposerRevision((current) => current + 1);
      setState((current) => ({
        ...current,
        ...stateFromAtelierSnapshot(snapshot),
        error: '',
        errorKind: '',
        ...stateFromAtelierEventStreamConnecting(),
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
    const intentResult = buildAtelierDecisionResolveIntent({
      taskId,
      blockId,
      choice,
      pendingBlockId: state.resolvingDecisionId,
    });
    if (intentResult.status === 'blocked' || intentResult.status === 'invalid') return;
    const { intent } = intentResult;

    setState((current) => ({ ...current, error: '', errorKind: '', resolvingDecisionId: intent.blockId }));
    try {
      const snapshot = await resolveAtelierDecision(intent);
      setState((current) => ({
        ...current,
        ...stateFromAtelierSnapshot(snapshot),
        error: '',
        errorKind: '',
        ...stateFromAtelierEventStreamConnecting(),
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
  }, [state.resolvingDecisionId]);

  const sendMessage = useCallback(async () => {
    const intentResult = buildAtelierMessageSendIntent({
      taskId: state.selectedTaskId,
      text: composerText,
      pending: state.sendingMessage,
    });
    if (intentResult.status === 'blocked' || intentResult.status === 'invalid') return;
    const { intent } = intentResult;

    setState((current) => ({ ...current, error: '', errorKind: '', sendingMessage: true }));
    try {
      const snapshot = await sendAtelierMessage(intent);
      setComposerText('');
      setComposerRevision((current) => current + 1);
      setState((current) => ({
        ...current,
        ...stateFromAtelierSnapshot(snapshot),
        error: '',
        errorKind: '',
        ...stateFromAtelierEventStreamConnecting(),
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
    const intentResult = buildAtelierProviderCapabilityCommandInsertIntent({ command });
    if (intentResult.status === 'blocked' || intentResult.status === 'invalid') return;
    const { intent } = intentResult;
    setComposerText((current) => {
      return appendAtelierProviderCapabilityCommand({
        currentComposerText: current,
        command: intent.command,
      });
    });
    setComposerRevision((current) => current + 1);
  }, []);

  const submitFeedback = useCallback(async (taskId: string, blockId: string, signal: AtelierFeedbackSignal) => {
    const intentResult = buildAtelierFeedbackSubmitIntent({
      taskId,
      blockId,
      signal,
      pendingFeedbackId: state.feedbackSubmittingId,
    });
    if (intentResult.status === 'blocked' || intentResult.status === 'invalid') return;
    const { intent, submitKey } = intentResult;

    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      feedbackSubmittingId: submitKey,
      feedbackStatus: '',
      feedbackStatusBlockId: intent.blockId,
    }));
    try {
      const response = await submitAtelierFeedback(intent);
      const policy =
        intent.signal === 'regenerate'
          ? response.rerunIntent.status
          : intent.signal === 'positive' || intent.signal === 'negative'
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
        feedbackStatus: `${intent.signal}:${policy}${confirmation}`,
        feedbackStatusBlockId: intent.blockId,
        memoryConfirmationFeedbackId:
            requiresMemoryConfirmation
            ? response.feedbackId
            : current.memoryConfirmationFeedbackId,
        memoryConfirmationTaskId:
            requiresMemoryConfirmation
            ? intent.taskId
            : current.memoryConfirmationTaskId,
        memoryConfirmationBlockId:
            requiresMemoryConfirmation
            ? intent.blockId
            : current.memoryConfirmationBlockId,
        rerunConfirmationFeedbackId:
            requiresRerunConfirmation
            ? response.feedbackId
            : current.rerunConfirmationFeedbackId,
        rerunConfirmationTaskId:
            requiresRerunConfirmation
            ? intent.taskId
            : current.rerunConfirmationTaskId,
        rerunConfirmationBlockId:
            requiresRerunConfirmation
            ? intent.blockId
            : current.rerunConfirmationBlockId,
      }));
    } catch (error) {
      const normalized = stateFromAtelierError(error);
      setState((current) => ({
        ...current,
        ...normalized,
        feedbackSubmittingId: '',
        feedbackStatus: normalized.error,
        feedbackStatusBlockId: intent.blockId,
      }));
    }
  }, [state.feedbackSubmittingId]);

  const confirmMemoryCandidate = useCallback(async () => {
    const intentResult = buildAtelierMemoryConfirmIntent({
      taskId: state.memoryConfirmationTaskId,
      feedbackId: state.memoryConfirmationFeedbackId,
      pending: state.memoryConfirming,
      confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE,
    });
    if (intentResult.status === 'blocked' || intentResult.status === 'invalid') return;
    const { intent } = intentResult;
    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      memoryConfirming: true,
    }));
    try {
      const response = await confirmAtelierMemoryCandidate(intent);
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
    const intentResult = buildAtelierRerunConfirmIntent({
      taskId: state.rerunConfirmationTaskId,
      feedbackId: state.rerunConfirmationFeedbackId,
      pending: state.rerunConfirming,
      confirmationMode: ATELIER_RERUN_CONFIRMATION_MODE,
    });
    if (intentResult.status === 'blocked' || intentResult.status === 'invalid') return;
    const { intent } = intentResult;
    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      rerunConfirming: true,
    }));
    try {
      const response = await confirmAtelierFeedbackRerun(intent);
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
    const intentResult = buildAtelierWorkspaceOpenIntent({
      taskId: task.id,
      target: task.workspaceOpenTarget,
      pendingWorkspaceOpenId: state.workspaceOpenSubmittingId,
    });
    if (intentResult.status === 'blocked' || intentResult.status === 'invalid') return;
    const { intent } = intentResult;

    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      workspaceOpenSubmittingId: intent.taskId,
      workspaceOpenStatus: '',
    }));
    try {
      const response = await openAtelierWorkspace(intent);
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
    const intentResult = buildAtelierArtifactBodyFetchIntent({
      taskId,
      artifact,
      pendingKey: state.artifactBodyFetchId,
    });
    if (intentResult.status === 'blocked') return;
    if (intentResult.status === 'invalid') {
      setState((current) => ({
        ...current,
        artifactBody: null,
        artifactBodyError: t('atelier.error.invalidArtifactBodyResponse'),
      }));
      return;
    }
    const { intent } = intentResult;

    const requestSeq = ++artifactBodyRequestSeq.current;
    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      artifactBody: null,
      artifactBodyFetchId: intent.key,
      artifactBodyError: '',
    }));
    try {
      const response = await fetchAtelierArtifactBody({
        taskId: intent.taskId,
        artifactId: intent.artifactId,
        bodyRef: intent.bodyRef,
        expectedHash: intent.expectedHash,
      });
      setState((current) => {
        if (!isCurrentAtelierArtifactRequest({
          currentSeq: artifactBodyRequestSeq.current,
          requestSeq,
          currentPendingKey: current.artifactBodyFetchId,
          expectedPendingKey: intent.key,
        })) {
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
        if (!isCurrentAtelierArtifactRequest({
          currentSeq: artifactBodyRequestSeq.current,
          requestSeq,
          currentPendingKey: current.artifactBodyFetchId,
          expectedPendingKey: intent.key,
        })) {
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
    const intentResult = buildAtelierArtifactPreviewOpenIntent({
      taskId,
      artifact,
      pendingKey: state.artifactPreviewOpenId,
    });
    if (intentResult.status === 'blocked') return;
    if (intentResult.status === 'invalid') {
      setState((current) => ({
        ...current,
        artifactPreviewOpenResponse: null,
        artifactPreviewOpenError: t('atelier.error.invalidArtifactPreviewOpenResponse'),
      }));
      return;
    }
    const { intent } = intentResult;

    const requestSeq = ++artifactPreviewOpenRequestSeq.current;
    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      artifactPreviewOpenResponse: null,
      artifactPreviewOpenId: intent.key,
      artifactPreviewOpenError: '',
    }));
    try {
      const response = await openAtelierArtifactPreview({
        taskId: intent.taskId,
        artifactId: intent.artifactId,
        sandboxRef: intent.sandboxRef,
        bodyRef: intent.bodyRef,
        kind: intent.kind,
        mode: intent.mode,
      });
      setState((current) => {
        if (!isCurrentAtelierArtifactRequest({
          currentSeq: artifactPreviewOpenRequestSeq.current,
          requestSeq,
          currentPendingKey: current.artifactPreviewOpenId,
          expectedPendingKey: intent.key,
        })) {
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
        if (!isCurrentAtelierArtifactRequest({
          currentSeq: artifactPreviewOpenRequestSeq.current,
          requestSeq,
          currentPendingKey: current.artifactPreviewOpenId,
          expectedPendingKey: intent.key,
        })) {
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
    if (certificationArtifactBodyFetchSubmittedRef.current || state.loading || !state.snapshot || state.artifactBodyFetchId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const config = await readAtelierCertificationArtifactBodyFetchConfig();
      if (!config || cancelled || certificationArtifactBodyFetchSubmittedRef.current) {
        return;
      }
      const taskId = config.taskId ?? state.selectedTaskId;
      if (!taskId) {
        return;
      }
      const artifacts = state.snapshot?.workspace.artifacts[taskId] ?? [];
      const artifact =
        (config.artifactId ? artifacts.find((candidate) => candidate.id === config.artifactId) : undefined) ??
        artifacts.find((candidate) => candidate.bodyRef);
      if (!artifact) {
        return;
      }
      certificationArtifactBodyFetchSubmittedRef.current = true;
      await fetchArtifactBody(taskId, artifact);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    fetchArtifactBody,
    state.artifactBodyFetchId,
    state.loading,
    state.selectedTaskId,
    state.snapshot,
  ]);

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
    const taskStatus = state.snapshot?.workspace.tasks.find((task) => task.id === taskId)?.status;
    const intentResult = buildAtelierTaskLifecycleIntent({
      taskId,
      action,
      pendingTaskActionId: state.taskActionId,
      purgeConfirmTaskId: state.purgeConfirmTaskId,
      taskStatus,
    });
    if (intentResult.status === 'blocked' || intentResult.status === 'invalid') return;

    if (intentResult.status === 'confirm-purge') {
      setState((current) => ({
        ...current,
        error: '',
        errorKind: '',
        purgeConfirmTaskId: intentResult.taskId,
      }));
      return;
    }
    const { intent } = intentResult;

    setState((current) => ({
      ...current,
      error: '',
      errorKind: '',
      taskActionId: intent.taskId,
      taskActionKind: intent.action,
      purgeConfirmTaskId: '',
    }));
    try {
      const snapshot =
        intent.kind === 'purge'
          ? await purgeAtelierTask({ taskId: intent.taskId })
          : await setAtelierTaskStatus({
              taskId: intent.taskId,
              status: intent.status,
            });
      setSelectedArtifactId('');
      setComposerText('');
      setComposerRevision((current) => current + 1);
      setState((current) => ({
        ...current,
        ...stateFromAtelierSnapshot(snapshot),
        error: '',
        errorKind: '',
        ...stateFromAtelierEventStreamConnecting(),
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
  }, [state.purgeConfirmTaskId, state.snapshot, state.taskActionId]);

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

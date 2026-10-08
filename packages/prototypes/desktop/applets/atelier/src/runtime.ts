import { MOCK } from './mock';
import type {
  ATELIER_AGENT_FLOW_IDS,
  ATELIER_ARTIFACT_BODY_KINDS,
  ATELIER_ARTIFACT_PREVIEW_OPEN_MODES,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES,
  ATELIER_PROVIDER_CAPABILITY_SCOPES,
  ATELIER_RUN_TARGET_KINDS,
  ATELIER_TASK_INTENT_PRESETS,
  AtelierFeedbackSignal,
  AtelierMemoryCandidateFeed,
  AtelierViewStatus,
} from './projection.contract.generated';
import {
  ATELIER_MEMORY_CONFIRMATION_MODE,
  ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
  ATELIER_PROVIDER_CAPABILITY_SCOPE,
  ATELIER_RERUN_CONFIRMATION_MODE,
} from './projection.contract.generated';
import { buildPrototypeCreateProjectProjection } from './prototypeCreateProjectProjection';
import type { AtelierState, Block, TaskStatus } from './types';
export type { AtelierFeedbackSignal } from './projection.contract.generated';

export interface AtelierRuntimeSnapshot {
  state: AtelierState;
  selectedTaskId: string;
  status?: AtelierRuntimeStatus;
}

export type AtelierRuntimeStatusKind = AtelierViewStatus;

export interface AtelierRuntimeStatus {
  kind: AtelierRuntimeStatusKind;
  title: string;
  detail: string;
  retryable?: boolean;
  lastEventSeq?: number;
}

export type RunTargetKind = (typeof ATELIER_RUN_TARGET_KINDS)[number];
export type AgentFlowId = (typeof ATELIER_AGENT_FLOW_IDS)[number];
export type ArtifactBodyResponseKind = (typeof ATELIER_ARTIFACT_BODY_KINDS)[number];
export type ArtifactPreviewOpenMode = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_MODES)[number];
export type ArtifactPreviewOpenRendererOwner = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS)[number];
export type ArtifactPreviewOpenRendererMode = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES)[number];
export type ArtifactPreviewOpenRendererStatus = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES)[number];
export type ProviderCapabilityScope = (typeof ATELIER_PROVIDER_CAPABILITY_SCOPES)[number];
export type ProviderCapabilityReadOnly = typeof ATELIER_PROVIDER_CAPABILITY_READ_ONLY;

export type AtelierRunTarget =
  | {
      kind: Extract<RunTargetKind, 'model'>;
      model: string;
    }
  | {
      kind: Extract<RunTargetKind, 'agents'>;
      model?: string;
      flowId?: AgentFlowId;
      agentIds?: string[];
    };

export type IntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];

export interface CreateProjectFromGoalInput {
  goal: string;
  project?: string;
  intentPreset?: IntentPreset;
  run: AtelierRunTarget;
  agentIds?: string[];
}

export interface SendMessageInput {
  taskId: string;
  text: string;
}

export interface ResolveDecisionInput {
  taskId: string;
  blockId: string;
  choice: string;
}

export interface SetTaskStatusInput {
  taskId: string;
  status: TaskStatus;
}

export interface ListProviderCapabilitiesInput {
  taskId?: string;
}

export interface SubmitFeedbackInput {
  taskId: string;
  blockId: string;
  signal: AtelierFeedbackSignal;
  comment?: string;
}

export interface AtelierFeedbackPolicyHint {
  status: string;
  reason: string;
  requiresConfirmation: boolean;
  confirmationMode: string;
  feeds: AtelierMemoryCandidateFeed[];
}

export interface SubmitFeedbackResponse {
  accepted: boolean;
  feedbackId: string;
  memoryCandidate: AtelierFeedbackPolicyHint;
  rerunIntent: AtelierFeedbackPolicyHint;
}

export interface ConfirmMemoryCandidateInput {
  taskId: string;
  feedbackId: string;
}

export interface ConfirmMemoryCandidateResponse {
  accepted: boolean;
  feedbackId: string;
  memoryId: string;
  status: string;
  source: string;
  alreadyDone: boolean;
}

export interface ConfirmRerunInput {
  taskId: string;
  feedbackId: string;
}

export interface ConfirmRerunResponse {
  accepted: boolean;
  feedbackId: string;
  taskId: string;
  rerunTaskId: string;
  status: string;
  source: string;
  alreadyDone: boolean;
  started: boolean;
}

export interface OpenWorkspaceInput {
  taskId: string;
  workspaceUri: string;
  ideHint?: string;
}

export interface OpenWorkspaceResponse {
  accepted: boolean;
  opened: boolean;
  workspaceUri: string;
  mode: string;
  reason: string;
}

export interface FetchArtifactBodyInput {
  taskId: string;
  artifactId: string;
  bodyRef: string;
  expectedHash?: string;
  maxBytes?: number;
}

export interface FetchArtifactBodyResponse {
  taskId: string;
  artifactId: string;
  bodyRef: string;
  bodyKind: ArtifactBodyResponseKind;
  bodyHash: string;
  bodySize: number;
  text: string;
  truncated: boolean;
  retentionStatus: string;
}

export interface OpenArtifactPreviewInput {
  taskId: string;
  artifactId: string;
  sandboxRef: string;
  bodyRef: string;
  kind?: string;
  mode?: string;
}

export interface OpenArtifactPreviewResponse {
  accepted: boolean;
  opened: boolean;
  prepared: boolean;
  taskId: string;
  artifactId: string;
  sandboxRef: string;
  bodyRef: string;
  kind: string;
  mode: ArtifactPreviewOpenMode;
  rendererSessionId: string;
  rendererOwner: ArtifactPreviewOpenRendererOwner;
  rendererMode: ArtifactPreviewOpenRendererMode;
  rendererStatus: ArtifactPreviewOpenRendererStatus;
  rendererCapabilities: string[];
  reason: string;
}

export interface AtelierProviderCapability {
  id: string;
  label: string;
  description: string;
  slashCommand: string;
  providerKind: string;
  scope: ProviderCapabilityScope;
  readOnly: ProviderCapabilityReadOnly;
}

export interface AtelierProviderCapabilitiesResponse {
  capabilities: AtelierProviderCapability[];
  source: string;
}

/**
 * Boundary Atelier will keep when it moves from prototype to real applet:
 * UI consumes a projection runtime, while Station/agent orchestration remains
 * the source of truth behind the implementation.
 */
export interface AtelierRuntime {
  getSnapshot(): AtelierRuntimeSnapshot;
  subscribe?(listener: (snapshot: AtelierRuntimeSnapshot) => void): () => void;
  loadWorkspace(): Promise<AtelierRuntimeSnapshot>;
  createProjectFromGoal(input: CreateProjectFromGoalInput): Promise<AtelierRuntimeSnapshot>;
  sendMessage(input: SendMessageInput): Promise<AtelierRuntimeSnapshot>;
  resolveDecision(input: ResolveDecisionInput): Promise<AtelierRuntimeSnapshot>;
  setTaskStatus(input: SetTaskStatusInput): Promise<AtelierRuntimeSnapshot>;
  purgeTask(taskId: string): Promise<AtelierRuntimeSnapshot>;
  listProviderCapabilities(input?: ListProviderCapabilitiesInput): Promise<AtelierProviderCapabilitiesResponse>;
  submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResponse>;
  confirmMemoryCandidate(input: ConfirmMemoryCandidateInput): Promise<ConfirmMemoryCandidateResponse>;
  confirmRerun(input: ConfirmRerunInput): Promise<ConfirmRerunResponse>;
  openWorkspace(input: OpenWorkspaceInput): Promise<OpenWorkspaceResponse>;
  fetchArtifactBody(input: FetchArtifactBodyInput): Promise<FetchArtifactBodyResponse>;
  openArtifactPreview(input: OpenArtifactPreviewInput): Promise<OpenArtifactPreviewResponse>;
  setModel(model: string): Promise<AtelierRuntimeSnapshot>;
}

export function createMockAtelierRuntime(seed: AtelierState = MOCK): AtelierRuntime {
  let state = cloneState(seed);
  let selectedTaskId = state.selectedTaskId;
  let status = readyStatus(state);

  const snapshot = (): AtelierRuntimeSnapshot => ({
    state: cloneState(state),
    selectedTaskId,
    status: cloneStatus(status),
  });

  const replaceState = (next: AtelierState, nextSelectedTaskId = selectedTaskId) => {
    state = cloneState(next);
    selectedTaskId = nextSelectedTaskId;
    status = readyStatus(state);
    return snapshot();
  };

  return {
    getSnapshot: snapshot,
    async loadWorkspace() {
      return snapshot();
    },
    async createProjectFromGoal(input) {
      const id = `t-${Date.now()}`;
      const next = buildPrototypeCreateProjectProjection({
        state,
        taskId: id,
        now: formatTime(new Date()),
        goal: input.goal,
        project: input.project,
        intentPreset: input.intentPreset,
        runKind: input.run.kind,
      });
      return replaceState(next.state, next.selectedTaskId);
    },
    async sendMessage(input) {
      const text = input.text.trim();
      if (!text) return snapshot();
      const now = formatTime(new Date());
      const existing = state.stream[input.taskId] ?? [];
      const suffix = Date.now();
      const followUp = '已追加到当前上下文，等待 Station 返回下一批 projection event。';

      return replaceState({
        ...state,
        stream: {
          ...state.stream,
          [input.taskId]: [
            ...existing,
            userBlock(`u-${suffix}`, text, now),
            agentBlock(`a-${suffix}`, followUp, now),
          ],
        },
      });
    },
    async resolveDecision(input) {
      return replaceState({
        ...state,
        stream: {
          ...state.stream,
          [input.taskId]: (state.stream[input.taskId] ?? []).map((block) =>
            block.kind === 'decision' && block.id === input.blockId
              ? { ...block, chosen: input.choice }
              : block,
          ),
        },
      });
    },
    async setTaskStatus(input) {
      return replaceState({
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === input.taskId
            ? { ...task, status: input.status, running: input.status === 'active' ? task.running : false }
            : task,
        ),
      });
    },
    async purgeTask(taskId) {
      const tasks = state.tasks.filter((task) => task.id !== taskId);
      const nextSelected = selectedTaskId === taskId ? tasks[0]?.id ?? '' : selectedTaskId;
      const { [taskId]: _stream, ...stream } = state.stream;
      const { [taskId]: _todos, ...todos } = state.todos;
      const { [taskId]: _context, ...context } = state.context;
      const { [taskId]: _artifacts, ...artifacts } = state.artifacts;
      const { [taskId]: _gates, ...gates } = state.gates;

      return replaceState(
        {
          ...state,
          selectedTaskId: nextSelected,
          tasks,
          stream,
          todos,
          context,
          artifacts,
          gates,
        },
        nextSelected,
      );
    },
    async setModel(model) {
      return replaceState({ ...state, model });
    },
    async listProviderCapabilities() {
      return mockProviderCapabilities();
    },
    async submitFeedback(input) {
      return mockFeedbackResponse(input.signal);
    },
    async confirmMemoryCandidate(input) {
      return {
        accepted: true,
        feedbackId: input.feedbackId,
        memoryId: `prototype-memory-${input.feedbackId}`,
        status: 'confirmed',
          source: ATELIER_MEMORY_CONFIRMATION_MODE,
        alreadyDone: false,
      };
    },
    async confirmRerun(input) {
      return {
        accepted: true,
        feedbackId: input.feedbackId,
        taskId: input.taskId,
        rerunTaskId: `prototype-rerun-${input.feedbackId}`,
        status: 'confirmed',
          source: ATELIER_RERUN_CONFIRMATION_MODE,
        alreadyDone: false,
        started: true,
      };
    },
    async openWorkspace(input) {
      return {
        accepted: true,
        opened: false,
        workspaceUri: input.workspaceUri,
        mode: 'prototype_host_intent',
        reason: 'Prototype records a Host-owned workspace open intent without launching an IDE.',
      };
    },
    async fetchArtifactBody(input) {
      const artifact = state.artifacts[input.taskId]?.find((item) => item.id === input.artifactId);
      const bodyKind = artifact?.bodyKind ?? (artifact?.kind === 'diff' ? 'diff' : 'markdown');
      const text =
        artifact?.markdown ??
        artifact?.diff ??
        artifact?.content ??
        artifact?.paths?.join('\n') ??
        'Prototype artifact body is exposed as safe text through Host capability.';
      const bodySize = new TextEncoder().encode(text).length;
      const maxBytes = input.maxBytes && input.maxBytes > 0 ? input.maxBytes : 64 * 1024;
      const truncated = bodySize > maxBytes;
      return {
        taskId: input.taskId,
        artifactId: input.artifactId,
        bodyRef: input.bodyRef,
        bodyKind,
        bodyHash: input.expectedHash ?? 'sha256:prototype',
        bodySize,
        text: truncated ? text.slice(0, maxBytes) : text,
        truncated,
        retentionStatus: 'active',
      };
    },
    async openArtifactPreview(input) {
      return {
        accepted: true,
        opened: true,
        prepared: true,
        taskId: input.taskId,
        artifactId: input.artifactId,
        sandboxRef: input.sandboxRef,
        bodyRef: input.bodyRef,
        kind: input.kind ?? 'metadata',
        mode: input.mode ?? 'sandbox_manifest',
        rendererSessionId: `atelier-preview:${input.taskId}:${input.artifactId}`,
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        rendererStatus: 'rendered',
        rendererCapabilities: [
          'sandbox_manifest_validation',
          'artifact_body_binding',
          'host_owned_renderer_session',
          'host_visual_renderer_surface',
        ],
        reason: 'Prototype records the Host-owned sandbox renderer surface descriptor; official applet still does not iframe/img/html-render artifact bodies.',
      };
    },
  };
}

export function readyStatus(state: AtelierState): AtelierRuntimeStatus {
  return state.tasks.length === 0
    ? {
        kind: 'empty',
        title: '还没有 Atelier 任务',
        detail: '从左侧 New task 或底部输入框创建目标后，Station projection 会在这里呈现任务、证据和人工决策点。',
      }
    : {
        kind: 'ready',
        title: 'Projection 已连接',
        detail: 'Atelier 正在消费 workspace snapshot。',
      };
}

function cloneState(state: AtelierState): AtelierState {
  return JSON.parse(JSON.stringify(state)) as AtelierState;
}

function cloneStatus(status: AtelierRuntimeStatus): AtelierRuntimeStatus {
  return { ...status };
}

function userBlock(id: string, text: string, at: string): Block {
  return { kind: 'user', id, text, at };
}

function agentBlock(id: string, text: string, at: string): Block {
  return { kind: 'agent', id, text, at, done: true };
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function mockFeedbackResponse(signal: AtelierFeedbackSignal): SubmitFeedbackResponse {
  return {
    accepted: true,
    feedbackId: `feedback-${Date.now()}`,
    memoryCandidate:
      signal === 'positive' || signal === 'negative'
        ? {
            status: 'candidate',
            reason: 'prototype records only a weak memory candidate signal',
            requiresConfirmation: true,
              confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE,
            feeds: signal === 'negative' ? ['planner', 'risk', 'verifier'] : ['planner', 'verifier'],
          }
        : {
            status: 'not_applicable',
            reason: 'signal does not create a memory candidate',
            requiresConfirmation: false,
            confirmationMode: 'not_required',
            feeds: [],
          },
    rerunIntent:
      signal === 'regenerate'
        ? {
            status: 'intent_recorded',
            reason: 'prototype records rerun intent and waits for Station rerun review confirmation',
            requiresConfirmation: true,
              confirmationMode: ATELIER_RERUN_CONFIRMATION_MODE,
            feeds: [],
          }
        : {
            status: 'not_requested',
            reason: 'signal does not request rerun',
            requiresConfirmation: false,
            confirmationMode: 'not_required',
            feeds: [],
          },
  };
}

function mockProviderCapabilities(): AtelierProviderCapabilitiesResponse {
  return {
    source: 'prototype.station.provider.capabilities',
    capabilities: [
      {
        id: 'provider.capability.implement',
        label: 'Implement',
        description: 'Ask Station orchestration to plan and implement through the configured coding provider.',
        slashCommand: '/implement',
        providerKind: 'coding',
        scope: ATELIER_PROVIDER_CAPABILITY_SCOPE,
        readOnly: ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
      },
      {
        id: 'provider.capability.review',
        label: 'Review',
        description: 'Ask Station orchestration to review the selected task context with evidence.',
        slashCommand: '/review',
        providerKind: 'verifier',
        scope: ATELIER_PROVIDER_CAPABILITY_SCOPE,
        readOnly: ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
      },
      {
        id: 'provider.capability.test',
        label: 'Test',
        description: 'Ask Station orchestration to derive and run the task-owned verification plan.',
        slashCommand: '/test',
        providerKind: 'verifier',
        scope: ATELIER_PROVIDER_CAPABILITY_SCOPE,
        readOnly: ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
      },
    ],
  };
}

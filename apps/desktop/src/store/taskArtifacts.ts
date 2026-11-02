import {
  type AcceptArtifactVersionResponse,
  type ArtifactAcceptance,
  type ArtifactCheck,
  type ArtifactFeedback,
  type ArtifactVersion,
  type ClaimArtifactVersionResponse,
  type GetArtifactVersionBodyResponse,
  type ListArtifactAcceptancesResponse,
  type ListArtifactChecksResponse,
  type ListArtifactFeedbackResponse,
  type ListArtifactVersionsResponse,
  type ListTaskArtifactsResponse,
  type LogicalArtifact,
  type RecordArtifactCheckResponse,
  type SubmitArtifactFeedbackResponse,
} from '../gen/proto/domain/agent/agent_pb';
import { api } from '../services/desktop_api';
import { log } from '../utils/logger';
import { createDesktopStore } from './createDesktopStore';

export interface PendingFeedbackRef {
  feedbackId: string;
  baseVersionId: string;
  anchorText: string;
  kind: 'selection' | 'comment';
}

interface TaskArtifactsState {
  artifactsByConversation: Record<string, LogicalArtifact[]>;
  claimedMessageIdsByConversation: Record<string, string[]>;
  versionsByArtifact: Record<string, ArtifactVersion[]>;
  bodyByVersion: Record<string, string>;
  feedbackByArtifact: Record<string, ArtifactFeedback[]>;
  checksByArtifact: Record<string, ArtifactCheck[]>;
  acceptancesByArtifact: Record<string, ArtifactAcceptance[]>;
  openArtifactId: string | null;
  openConversationId: string | null;
  selectedVersionId: string | null;
  pendingFeedbackByArtifact: Record<string, PendingFeedbackRef>;
  loading: boolean;
  error: string | null;

  openPanel: (conversationId: string, artifactId: string, versionId?: string) => Promise<void>;
  closePanel: () => void;
  selectVersion: (versionId: string) => Promise<void>;
  loadArtifacts: (conversationId: string) => Promise<LogicalArtifact[]>;
  claimedMessageIds: (conversationId: string) => Promise<Set<string>>;
  loadDetail: (artifactId: string) => Promise<void>;
  claimFromMessage: (input: {
    conversationId: string;
    turnId: string;
    messageId: string;
    name?: string;
    artifactId?: string;
    expectedBaseVersionId?: string;
    // Object refs of the material admitted into the producing turn. The
    // version records which materials it actually adopted; a name alone is
    // not adoption.
    adoptedAttachmentRefs?: string[];
  }) => Promise<ClaimArtifactVersionResponse>;
  saveHumanEdit: (input: {
    conversationId: string;
    artifactId: string;
    expectedBaseVersionId: string;
    body: string;
  }) => Promise<ClaimArtifactVersionResponse>;
  quoteSelectionToComposer: (input: {
    conversationId: string;
    artifactId: string;
    baseVersionId: string;
    anchorText: string;
    kind: 'selection' | 'comment';
    composerSeed: (text: string) => void;
  }) => Promise<void>;
  recordStructuralCheck: (artifactId: string, versionId: string, body: string) => Promise<ArtifactCheck>;
  recordHumanReview: (artifactId: string, versionId: string, passed: boolean) => Promise<ArtifactCheck>;
  acceptCurrent: (artifactId: string, versionId: string) => Promise<AcceptArtifactVersionResponse>;
  reset: () => void;
}

function tempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Structural validation for D3 document versions: non-empty markdown with at
// least one non-whitespace line. Command/E2E checks join in TW-D4.
function structuralCheckResult(body: string): { passed: boolean; detail: string } {
  const trimmed = body.trim();
  if (!trimmed) return { passed: false, detail: 'empty document' };
  const lines = trimmed.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { passed: false, detail: 'no content lines' };
  return { passed: true, detail: `structure ok: ${lines.length} content line(s)` };
}

export const useTaskArtifactStore = createDesktopStore<TaskArtifactsState>(
  'taskArtifacts',
  (set, get) => ({
    artifactsByConversation: {},
    claimedMessageIdsByConversation: {},
    versionsByArtifact: {},
    bodyByVersion: {},
    feedbackByArtifact: {},
    checksByArtifact: {},
    acceptancesByArtifact: {},
    openArtifactId: null,
    openConversationId: null,
    selectedVersionId: null,
    pendingFeedbackByArtifact: {},
    loading: false,
    error: null,

    openPanel: async (conversationId, artifactId, versionId) => {
      set({
        openConversationId: conversationId,
        openArtifactId: artifactId,
        selectedVersionId: versionId ?? null,
        error: null,
      });
      await get().loadDetail(artifactId);
      if (!versionId) {
        const versions = get().versionsByArtifact[artifactId] ?? [];
        const head = versions[versions.length - 1];
        if (head) await get().selectVersion(head.versionId);
      } else {
        await get().selectVersion(versionId);
      }
    },

    closePanel: () => set({
      openArtifactId: null,
      openConversationId: null,
      selectedVersionId: null,
    }),

    selectVersion: async (versionId) => {
      set({ selectedVersionId: versionId });
      if (get().bodyByVersion[versionId] !== undefined) return;
      const response: GetArtifactVersionBodyResponse = await api.getTaskArtifactVersionBody(versionId);
      set((state) => ({
        bodyByVersion: { ...state.bodyByVersion, [versionId]: response.body },
      }));
    },

    loadArtifacts: async (conversationId) => {
      const response: ListTaskArtifactsResponse = await api.listTaskArtifacts(conversationId);
      set((state) => ({
        artifactsByConversation: {
          ...state.artifactsByConversation,
          [conversationId]: response.artifacts,
        },
      }));
      return response.artifacts;
    },

    claimedMessageIds: async (conversationId) => {
      const artifacts = await get().loadArtifacts(conversationId);
      const perArtifact = await Promise.all(
        artifacts.map(async (artifact) => {
          const response: ListArtifactVersionsResponse =
            await api.listTaskArtifactVersions(artifact.artifactId);
          set((state) => ({
            versionsByArtifact: {
              ...state.versionsByArtifact,
              [artifact.artifactId]: response.versions,
            },
          }));
          return response.versions
            .map((version) => version.sourceMessageId)
            .filter((id) => Boolean(id));
        }),
      );
      const ids = new Set(perArtifact.flat());
      set((state) => ({
        claimedMessageIdsByConversation: {
          ...state.claimedMessageIdsByConversation,
          [conversationId]: Array.from(ids),
        },
      }));
      return ids;
    },

    loadDetail: async (artifactId) => {
      set({ loading: true, error: null });
      try {
        const [versions, feedback, checks, acceptances] = await Promise.all([
          api.listTaskArtifactVersions(artifactId) as Promise<ListArtifactVersionsResponse>,
          api.listTaskArtifactFeedback(artifactId) as Promise<ListArtifactFeedbackResponse>,
          api.listTaskArtifactChecks(artifactId) as Promise<ListArtifactChecksResponse>,
          api.listTaskArtifactAcceptances(artifactId) as Promise<ListArtifactAcceptancesResponse>,
        ]);
        set((state) => ({
          loading: false,
          versionsByArtifact: { ...state.versionsByArtifact, [artifactId]: versions.versions },
          feedbackByArtifact: { ...state.feedbackByArtifact, [artifactId]: feedback.feedback },
          checksByArtifact: { ...state.checksByArtifact, [artifactId]: checks.checks },
          acceptancesByArtifact: {
            ...state.acceptancesByArtifact,
            [artifactId]: acceptances.acceptances,
          },
        }));
        // Guarantee a body for the selected version or the head. Doing the
        // fetch here (instead of relying on openPanel sequencing) means the
        // panel can never render open without its bytes during bootstrap.
        const wantedId = get().selectedVersionId
          ?? versions.versions[versions.versions.length - 1]?.versionId;
        if (wantedId && get().bodyByVersion[wantedId] === undefined) {
          const bodyResponse = await api.getTaskArtifactVersionBody(wantedId);
          set((state) => ({
            bodyByVersion: { ...state.bodyByVersion, [wantedId]: bodyResponse.body },
          }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn('taskArtifacts', 'loadDetail failed', { artifactId, error: message });
        set({ loading: false, error: message });
        throw error;
      }
    },

    claimFromMessage: async ({
      conversationId,
      turnId,
      messageId,
      name,
      artifactId,
      expectedBaseVersionId,
      adoptedAttachmentRefs,
    }) => {
      const pending = artifactId
        ? get().pendingFeedbackByArtifact[artifactId]
        : undefined;
      const response: ClaimArtifactVersionResponse = await api.claimTaskArtifactVersion({
        conversationId,
        artifactId,
        name,
        expectedBaseVersionId,
        origin: pending
          ? 'ARTIFACT_VERSION_ORIGIN_FEEDBACK_REVISION'
          : 'ARTIFACT_VERSION_ORIGIN_AGENT_OUTPUT',
        sourceTurnId: turnId,
        sourceMessageId: messageId,
        feedbackId: pending?.feedbackId,
        adoptedAttachmentRefs,
        clientIdempotencyKey: tempId(),
      });
      if (pending && artifactId) {
        set((state) => {
          const next = { ...state.pendingFeedbackByArtifact };
          delete next[artifactId];
          return { pendingFeedbackByArtifact: next };
        });
      }
      await Promise.all([
        get().loadArtifacts(conversationId),
        get().loadDetail(response.artifact!.artifactId),
      ]);
      return response;
    },

    saveHumanEdit: async ({ conversationId, artifactId, expectedBaseVersionId, body }) => {
      const response: ClaimArtifactVersionResponse = await api.claimTaskArtifactVersion({
        conversationId,
        artifactId,
        expectedBaseVersionId,
        origin: 'ARTIFACT_VERSION_ORIGIN_HUMAN_EDIT',
        body,
        contentType: 'text/markdown',
        clientIdempotencyKey: tempId(),
      });
      await Promise.all([
        get().loadArtifacts(conversationId),
        get().loadDetail(artifactId),
      ]);
      return response;
    },

    quoteSelectionToComposer: async ({
      conversationId,
      artifactId,
      baseVersionId,
      anchorText,
      kind,
      composerSeed,
    }) => {
      const response: SubmitArtifactFeedbackResponse = await api.submitTaskArtifactFeedback({
        artifactId,
        baseVersionId,
        kind: kind === 'selection'
          ? 'ARTIFACT_FEEDBACK_KIND_SELECTION'
          : 'ARTIFACT_FEEDBACK_KIND_COMMENT',
        anchorText,
        instruction: kind === 'selection'
          ? `Revise the selected text: ${anchorText.slice(0, 200)}`
          : 'Revision requested',
        clientIdempotencyKey: tempId(),
      });
      set((state) => ({
        pendingFeedbackByArtifact: {
          ...state.pendingFeedbackByArtifact,
          [artifactId]: {
            feedbackId: response.feedback!.feedbackId,
            baseVersionId,
            anchorText,
            kind,
          } as PendingFeedbackRef,
        },
        feedbackByArtifact: {
          ...state.feedbackByArtifact,
          [artifactId]: [...(state.feedbackByArtifact[artifactId] ?? []), response.feedback!],
        },
      }));
      const quoted = anchorText.trim()
        ? `> ${anchorText.trim().replace(/\n/g, '\n> ')}\n\n`
        : '';
      composerSeed(
        `${quoted}${conversationId ? '' : ''}[Revising ${artifactId}@${baseVersionId.slice(0, 8)}] `,
      );
    },

    recordStructuralCheck: async (artifactId, versionId, body) => {
      const { passed, detail } = structuralCheckResult(body);
      const response: RecordArtifactCheckResponse = await api.recordTaskArtifactCheck({
        artifactId,
        versionId,
        checkType: 'ARTIFACT_CHECK_TYPE_STRUCTURAL',
        result: passed ? 'ARTIFACT_CHECK_RESULT_PASSED' : 'ARTIFACT_CHECK_RESULT_FAILED',
        detail,
        environment: 'desktop-native',
        clientIdempotencyKey: tempId(),
      });
      await get().loadDetail(artifactId);
      return response.check!;
    },

    recordHumanReview: async (artifactId, versionId, passed) => {
      const response: RecordArtifactCheckResponse = await api.recordTaskArtifactCheck({
        artifactId,
        versionId,
        checkType: 'ARTIFACT_CHECK_TYPE_HUMAN_REVIEW',
        result: passed ? 'ARTIFACT_CHECK_RESULT_PASSED' : 'ARTIFACT_CHECK_RESULT_FAILED',
        detail: passed ? 'human review passed' : 'human review rejected',
        environment: 'desktop-native',
        clientIdempotencyKey: tempId(),
      });
      await get().loadDetail(artifactId);
      return response.check!;
    },

    acceptCurrent: async (artifactId, versionId) => {
      const response = await api.acceptTaskArtifactVersion(artifactId, versionId, tempId());
      await get().loadDetail(artifactId);
      const conversationId = get().openConversationId;
      if (conversationId) {
        await get().loadArtifacts(conversationId);
      }
      return response;
    },

    reset: () => set({
      artifactsByConversation: {},
      claimedMessageIdsByConversation: {},
      versionsByArtifact: {},
      bodyByVersion: {},
      feedbackByArtifact: {},
      checksByArtifact: {},
      acceptancesByArtifact: {},
      openArtifactId: null,
      openConversationId: null,
      selectedVersionId: null,
      pendingFeedbackByArtifact: {},
      loading: false,
      error: null,
    }),
  }),
);

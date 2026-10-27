import { timestampDate } from '@bufbuild/protobuf/wkt';

import type { TurnArtifact } from '../gen/proto/domain/agent/agent_pb';
import { api } from '../services/desktop_api';
import { createDesktopStore } from './createDesktopStore';

export interface ChatFileArtifact {
  id: string;
  turnId: string;
  agentId: string;
  toolCallId: string;
  name: string;
  size: number;
  sha256: string;
  clientLocalRef: string;
  clientDeviceId: string;
  stationObjectRef: string;
  localAvailable: boolean;
  createdAt: number;
}

interface ChatArtifactState {
  byConversationId: Record<string, ChatFileArtifact[]>;
  loadingConversationId: string | null;
  error: string | null;
  load: (conversationId: string) => Promise<ChatFileArtifact[]>;
  upload: (conversationId: string, artifactId: string) => Promise<void>;
  openLocal: (artifact: ChatFileArtifact, reveal?: boolean) => Promise<void>;
  download: (artifactId: string) => Promise<void>;
  clear: () => void;
}

export function projectTurnArtifact(
  artifact: TurnArtifact,
  currentDeviceId: string,
): ChatFileArtifact {
  return {
    id: artifact.artifactId,
    turnId: artifact.turnId,
    agentId: artifact.agentId,
    toolCallId: artifact.toolCallId,
    name: artifact.name,
    size: Number(artifact.size),
    sha256: artifact.sha256,
    clientLocalRef: artifact.locator?.clientLocalRef ?? '',
    clientDeviceId: artifact.locator?.clientDeviceId ?? '',
    stationObjectRef: artifact.locator?.stationObjectRef ?? '',
    localAvailable: Boolean(
      artifact.locator?.clientLocalRef
      && artifact.locator?.clientDeviceId === currentDeviceId,
    ),
    createdAt: artifact.createdAt ? timestampDate(artifact.createdAt).getTime() : 0,
  };
}

export const useChatArtifactStore = createDesktopStore<ChatArtifactState>(
  'chatArtifacts',
  (set, get) => ({
    byConversationId: {},
    loadingConversationId: null,
    error: null,

    load: async (conversationId) => {
      if (!conversationId) return [];
      set({ loadingConversationId: conversationId, error: null });
      try {
        const [response, clientMeta] = await Promise.all([
          api.listAgentTurnArtifacts(conversationId),
          api.clientMeta(),
        ]);
        const artifacts = response.artifacts.map(
          (artifact) => projectTurnArtifact(artifact, clientMeta.device_id),
        );
        set((state) => ({
          byConversationId: {
            ...state.byConversationId,
            [conversationId]: artifacts,
          },
          loadingConversationId: state.loadingConversationId === conversationId
            ? null
            : state.loadingConversationId,
        }));
        return artifacts;
      } catch (error) {
        set({
          loadingConversationId: null,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    upload: async (conversationId, artifactId) => {
      await api.uploadAgentTurnArtifact(artifactId);
      await get().load(conversationId);
    },

    openLocal: async (artifact, reveal = false) => {
      if (!artifact.clientLocalRef) throw new Error('artifact local reference is unavailable');
      await api.openAgentTurnArtifact(artifact.clientLocalRef, reveal);
    },

    download: async (artifactId) => {
      await api.downloadAgentTurnArtifact(artifactId);
    },

    clear: () => set({
      byConversationId: {},
      loadingConversationId: null,
      error: null,
    }),
  }),
);

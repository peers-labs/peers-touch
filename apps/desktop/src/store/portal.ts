import { createDesktopStore } from './createDesktopStore';
import type { MessageArtifact } from './chat';

export type PortalView =
  | { type: 'artifacts'; messageId?: string }
  | { type: 'artifactDetail'; artifact: MessageArtifact }
  | { type: 'toolDetail'; messageId: string; toolCallId: string }
  | { type: 'thread'; sessionKey: string; sourceMessageId: string }
  | { type: 'topicComments'; topicKey: string }
  | { type: 'workingFiles'; sessionKey: string }
  | { type: 'workingProgress' }
  | { type: 'agentOverview'; agentId: string };

interface PortalState {
  expanded: boolean;
  activeView: PortalView | null;
}

interface PortalActions {
  openArtifact: (artifact: MessageArtifact) => void;
  openArtifacts: (messageId?: string) => void;
  openToolDetail: (messageId: string, toolCallId: string) => void;
  openThread: (sessionKey: string, sourceMessageId: string) => void;
  openTopicComments: (topicKey: string) => void;
  openWorkingFiles: (sessionKey: string) => void;
  openWorkingProgress: () => void;
  openAgentOverview: (agentId: string) => void;
  close: () => void;
  toggle: () => void;
}

export const usePortalStore = createDesktopStore<PortalState & PortalActions>(
  'portal',
  (set) => ({
    expanded: false,
    activeView: null,

    openArtifact: (artifact: MessageArtifact) => {
      set({ expanded: true, activeView: { type: 'artifactDetail', artifact } });
    },

    openArtifacts: (messageId?: string) => {
      set({ expanded: true, activeView: { type: 'artifacts', messageId } });
    },

    openToolDetail: (messageId: string, toolCallId: string) => {
      set({ expanded: true, activeView: { type: 'toolDetail', messageId, toolCallId } });
    },

    openThread: (sessionKey: string, sourceMessageId: string) => {
      set({ expanded: true, activeView: { type: 'thread', sessionKey, sourceMessageId } });
    },

    openTopicComments: (topicKey: string) => {
      set({ expanded: true, activeView: { type: 'topicComments', topicKey } });
    },

    openWorkingFiles: (sessionKey: string) => {
      set({ expanded: true, activeView: { type: 'workingFiles', sessionKey } });
    },

    openWorkingProgress: () => {
      set({ expanded: true, activeView: { type: 'workingProgress' } });
    },

    openAgentOverview: (agentId: string) => {
      set({ expanded: true, activeView: { type: 'agentOverview', agentId } });
    },

    close: () => {
      set({ expanded: false, activeView: null });
    },

    toggle: () => {
      set((state) => ({ expanded: !state.expanded }));
    },
  }),
);

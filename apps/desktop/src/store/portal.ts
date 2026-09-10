import { createDesktopStore } from './createDesktopStore';
import type { MessageArtifact } from './chat';

export type PortalView =
  | { type: 'artifacts'; messageId?: string }
  | { type: 'artifactDetail'; artifact: MessageArtifact }
  | { type: 'toolDetail'; messageId: string; toolCallId: string }
  | { type: 'turnDetails'; messageId: string; turnId: string }
  | { type: 'thread'; sessionKey: string; sourceMessageId: string }
  | { type: 'topicComments'; topicKey: string }
  | { type: 'workingFiles'; sessionKey: string }
  | { type: 'workingProgress' }
  | { type: 'agentOverview'; agentId: string };

interface PortalState {
  expanded: boolean;
  portalStack: PortalView[];
  activeView: PortalView | null;
}

interface PortalActions {
  openArtifact: (artifact: MessageArtifact) => void;
  openArtifacts: (messageId?: string) => void;
  openToolDetail: (messageId: string, toolCallId: string) => void;
  openTurnDetails: (messageId: string, turnId: string) => void;
  openThread: (sessionKey: string, sourceMessageId: string) => void;
  openTopicComments: (topicKey: string) => void;
  openWorkingFiles: (sessionKey: string) => void;
  openWorkingProgress: () => void;
  openAgentOverview: (agentId: string) => void;
  goBack: () => void;
  collapse: () => void;
  close: () => void;
  toggle: () => void;
}

export const usePortalStore = createDesktopStore<PortalState & PortalActions>(
  'portal',
  (set) => {
    const pushPortalView = (view: PortalView) => {
      set((state) => {
        const current = state.portalStack[state.portalStack.length - 1];
        const portalStack = current?.type === view.type
          ? [...state.portalStack.slice(0, -1), view]
          : [...state.portalStack, view];

        return { expanded: true, portalStack, activeView: view };
      });
    };

    return {
      expanded: false,
      portalStack: [],
      activeView: null,

      openArtifact: (artifact: MessageArtifact) => {
        pushPortalView({ type: 'artifactDetail', artifact });
      },

      openArtifacts: (messageId?: string) => {
        pushPortalView({ type: 'artifacts', messageId });
      },

      openToolDetail: (messageId: string, toolCallId: string) => {
        pushPortalView({ type: 'toolDetail', messageId, toolCallId });
      },

      openTurnDetails: (messageId: string, turnId: string) => {
        pushPortalView({ type: 'turnDetails', messageId, turnId });
      },

      openThread: (sessionKey: string, sourceMessageId: string) => {
        pushPortalView({ type: 'thread', sessionKey, sourceMessageId });
      },

      openTopicComments: (topicKey: string) => {
        pushPortalView({ type: 'topicComments', topicKey });
      },

      openWorkingFiles: (sessionKey: string) => {
        pushPortalView({ type: 'workingFiles', sessionKey });
      },

      openWorkingProgress: () => {
        pushPortalView({ type: 'workingProgress' });
      },

      openAgentOverview: (agentId: string) => {
        pushPortalView({ type: 'agentOverview', agentId });
      },

      goBack: () => {
        set((state) => {
          if (state.portalStack.length <= 1) {
            return { expanded: false, portalStack: [], activeView: null };
          }
          const portalStack = state.portalStack.slice(0, -1);
          return {
            portalStack,
            activeView: portalStack[portalStack.length - 1] ?? null,
          };
        });
      },

      collapse: () => {
        set({ expanded: false });
      },

      close: () => {
        set({ expanded: false, portalStack: [], activeView: null });
      },

      toggle: () => {
        set((state) => {
          if (state.expanded) return { expanded: false };
          if (state.portalStack.length > 0) return { expanded: true };
          const view: PortalView = { type: 'artifacts' };
          return { expanded: true, portalStack: [view], activeView: view };
        });
      },
    };
  },
);

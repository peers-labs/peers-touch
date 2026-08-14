import { createDesktopStore } from './createDesktopStore';
import type { MessageArtifact } from './chat';

export type PortalView =
  | { type: 'artifacts'; messageId?: string }
  | { type: 'artifactDetail'; artifact: MessageArtifact }
  | { type: 'toolDetail'; messageId: string; toolCallId: string };

interface PortalState {
  expanded: boolean;
  activeView: PortalView | null;
}

interface PortalActions {
  openArtifact: (artifact: MessageArtifact) => void;
  openArtifacts: (messageId?: string) => void;
  openToolDetail: (messageId: string, toolCallId: string) => void;
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

    close: () => {
      set({ expanded: false, activeView: null });
    },

    toggle: () => {
      set((state) => ({ expanded: !state.expanded }));
    },
  }),
);

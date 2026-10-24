import { createDesktopStore } from './createDesktopStore';

export type MomentsTab = 'feed' | 'explore' | 'search' | 'circles';
export type MomentsView =
  | { kind: 'tab'; tab: MomentsTab }
  | { kind: 'detail'; postId: string; commentId?: string; from: MomentsTab }
  | { kind: 'user'; actorPtid: string; from: MomentsTab };

interface MomentsNavigation {
  view: MomentsView;
  setView: (next: MomentsView | ((previous: MomentsView) => MomentsView)) => void;
  reset: () => void;
}

// Presentation only. The original Moments runtime still owns every read.
export const useMomentsNavigationStore = createDesktopStore<MomentsNavigation>('moments-navigation', set => ({
  view: { kind: 'tab', tab: 'feed' },
  setView: next => set(state => ({ view: typeof next === 'function' ? next(state.view) : next })),
  reset: () => set({ view: { kind: 'tab', tab: 'feed' } }),
}));

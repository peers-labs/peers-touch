import { create } from 'zustand';

const initialState = {
  sidebarExpand: true,
  agentDrawerOpen: false,
};

interface SidebarStore {
  sidebarExpand: boolean;
  agentDrawerOpen: boolean;
  setSidebarExpand: (v: boolean) => void;
  setAgentDrawerOpen: (v: boolean) => void;
  reset: () => void;
  hydrate: (actorPtid: string) => Promise<void>;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  ...initialState,
  setSidebarExpand: (sidebarExpand) => set({ sidebarExpand }),
  setAgentDrawerOpen: (agentDrawerOpen) => set({ agentDrawerOpen }),
  reset: () => set(initialState),
  hydrate: async (_actorPtid: string) => {
    // Sidebar chrome is not actor-keyed; reset() clears any leaked UI. No remote fetch.
  },
}));

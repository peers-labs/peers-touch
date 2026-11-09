import { create } from 'zustand';

// Trae-style right work area: device tools (terminal / browser / memory
// review) open as tabs in one full-height split panel instead of independent
// floating drawers. The composer toolbar toggles and the panel "+" menu both
// drive this single tab authority.
export type WorkbenchToolId = 'terminal' | 'browser' | 'memory';

interface WorkbenchTabsState {
  tabs: WorkbenchToolId[];
  active: WorkbenchToolId | null;
  openTool: (tool: WorkbenchToolId) => void;
  closeTool: (tool: WorkbenchToolId) => void;
  toggleTool: (tool: WorkbenchToolId) => void;
  setActive: (tool: WorkbenchToolId) => void;
  closeAll: () => void;
}

export const useWorkbenchTabsStore = create<WorkbenchTabsState>((set) => ({
  tabs: [],
  active: null,

  openTool: (tool) => {
    set((state) => ({
      tabs: state.tabs.includes(tool) ? state.tabs : [...state.tabs, tool],
      active: tool,
    }));
  },

  closeTool: (tool) => {
    set((state) => {
      const tabs = state.tabs.filter((item) => item !== tool);
      let active = state.active;
      if (active === tool) {
        active = tabs[tabs.length - 1] ?? null;
      }
      return { tabs, active };
    });
  },

  toggleTool: (tool) => {
    set((state) => {
      if (state.active === tool) {
        const tabs = state.tabs.filter((item) => item !== tool);
        return { tabs, active: tabs[tabs.length - 1] ?? null };
      }
      return {
        tabs: state.tabs.includes(tool) ? state.tabs : [...state.tabs, tool],
        active: tool,
      };
    });
  },

  setActive: (tool) => {
    set((state) => (state.tabs.includes(tool) ? { active: tool } : state));
  },

  closeAll: () => set({ tabs: [], active: null }),
}));

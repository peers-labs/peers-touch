import { create } from 'zustand';

// Trae-style right work area: device tools (files / browser / terminal /
// memory review) open as tabs in one full-height split panel. The panel has
// its own open flag separate from the tab list:
// - closed: a floating vertical icon rail offers one-click entries
// - open with no active tab: the launcher lists every available tool
// - open with tabs: the tab strip and the compact "+" menu manage tools
export type WorkbenchToolId =
  | 'summary'
  | 'file'
  | 'browser'
  | 'terminal'
  | 'memory'
  | 'branches';

export const DEFAULT_PANEL_WIDTH = 420;
// Hard floor for the panel itself (tab strip stays usable).
export const MIN_PANEL_WIDTH = 260;
// Floor for the chat column. Measured against the composer toolbar's natural
// content width (workspace chip + action buttons need ~374px inside the
// composer, i.e. ~388px column); 400 keeps a small margin so composer controls
// are never squeezed or clipped. The topics/agent rails live outside the
// conversation rail, so containerWidth already excludes them.
export const MIN_CHAT_COLUMN_WIDTH = 400;
const PANEL_WIDTH_STORAGE_KEY = 'peers.workbench.panelWidth';

function clampPanelWidth(width: number, containerWidth: number): number {
  const maxWidth = Math.max(
    MIN_PANEL_WIDTH,
    containerWidth - MIN_CHAT_COLUMN_WIDTH,
  );
  return Math.min(Math.max(width, MIN_PANEL_WIDTH), maxWidth);
}

function readStoredPanelWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_PANEL_WIDTH;
  const stored = Number(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return DEFAULT_PANEL_WIDTH;
  return stored;
}

interface WorkbenchTabsState {
  panelOpen: boolean;
  panelWidth: number;
  tabs: WorkbenchToolId[];
  active: WorkbenchToolId | null;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setPanelWidth: (width: number, containerWidth: number) => void;
  openTool: (tool: WorkbenchToolId) => void;
  closeTool: (tool: WorkbenchToolId) => void;
  toggleTool: (tool: WorkbenchToolId) => void;
  setActive: (tool: WorkbenchToolId) => void;
  closeAll: () => void;
}

export const useWorkbenchTabsStore = create<WorkbenchTabsState>((set) => ({
  panelOpen: false,
  panelWidth: readStoredPanelWidth(),
  tabs: [],
  active: null,

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),

  setPanelWidth: (width, containerWidth) => set({
    panelWidth: clampPanelWidth(width, containerWidth),
  }),

  openTool: (tool) => {
    set((state) => ({
      panelOpen: true,
      tabs: state.tabs.includes(tool) ? state.tabs : [...state.tabs, tool],
      active: tool,
    }));
  },

  closeTool: (tool) => {
    set((state) => {
      const tabs = state.tabs.filter((item) => item !== tool);
      let active = state.active;
      if (active === tool) {
        // Keep the panel open and fall back to the launcher when the last tab
        // closes; only the fold button hides the panel.
        active = tabs[tabs.length - 1] ?? null;
      }
      return { tabs, active };
    });
  },

  toggleTool: (tool) => {
    set((state) => {
      if (state.active === tool) {
        const tabs = state.tabs.filter((item) => item !== tool);
        return { panelOpen: true, tabs, active: tabs[tabs.length - 1] ?? null };
      }
      return {
        panelOpen: true,
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

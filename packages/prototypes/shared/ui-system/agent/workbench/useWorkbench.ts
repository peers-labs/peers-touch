/**
 * useWorkbench — local mirror of the production workbenchTabs store contract.
 *
 * Same three-state model as the Trae-style right work area:
 *  - closed: a floating icon rail is the only entry;
 *  - open with no active tool: the launcher lists every tool;
 *  - open with tabs: the strip and add menu manage the tool set.
 * Closing the last tab returns to the launcher while keeping the panel open;
 * only the fold control hides it. Width is clamped like the store clamp.
 */
import { useCallback, useState } from 'react';
import type { WorkbenchToolId } from '../types';

export const DEFAULT_PANEL_WIDTH = 420;
export const MIN_PANEL_WIDTH = 260;
export const MAX_PANEL_WIDTH = 560;

function clampWidth(width: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width));
}

export interface WorkbenchState {
  panelOpen: boolean;
  panelWidth: number;
  tabs: readonly WorkbenchToolId[];
  active: WorkbenchToolId | null;
  openPanel: () => void;
  closePanel: () => void;
  setPanelWidth: (width: number) => void;
  openTool: (tool: WorkbenchToolId) => void;
  closeTool: (tool: WorkbenchToolId) => void;
  setActive: (tool: WorkbenchToolId) => void;
}

export function useWorkbench(): WorkbenchState {
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelWidth, setPanelWidthState] = useState(DEFAULT_PANEL_WIDTH);
  const [tabs, setTabs] = useState<readonly WorkbenchToolId[]>([]);
  const [active, setActiveTool] = useState<WorkbenchToolId | null>(null);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);
  const setPanelWidth = useCallback((width: number) => {
    setPanelWidthState(previous => (width === previous ? previous : clampWidth(width)));
  }, []);

  const openTool = useCallback((tool: WorkbenchToolId) => {
    setPanelOpen(true);
    setTabs(previous => (previous.includes(tool) ? previous : [...previous, tool]));
    setActiveTool(tool);
  }, []);

  const closeTool = useCallback((tool: WorkbenchToolId) => {
    setTabs(previous => previous.filter(item => item !== tool));
    setActiveTool(current => {
      if (current !== tool) return current;
      // The panel stays open; closing the last tab falls back to the launcher.
      const remaining = tabs.filter(item => item !== tool);
      return remaining[remaining.length - 1] ?? null;
    });
  }, [tabs]);

  const setActive = useCallback((tool: WorkbenchToolId) => {
    setActiveTool(current => (tabs.includes(tool) ? tool : current));
  }, [tabs]);

  return {
    panelOpen, panelWidth, tabs, active,
    openPanel, closePanel, setPanelWidth, openTool, closeTool, setActive,
  };
}

import { useEffect, useMemo, useRef } from 'react';
import { Button, Icon, IconButton, Text } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';

import { MIN_PANEL_WIDTH, useWorkbenchTabsStore } from '../../../store/workbenchTabs';
import { TerminalDock } from './terminal/TerminalDock';
import { BrowserDock } from './browser/BrowserDock';
import { FileDock } from './file/FileDock';
import { MemoryReviewDock } from './memory/MemoryReviewDock';
import { TaskSummaryDock } from './summary/TaskSummaryDock';
import { BranchesDock } from './branches/BranchesDock';
import { WorkbenchAddMenu } from './WorkbenchAddMenu';
import { WorkbenchFoldButton } from './WorkbenchFoldButton';
import { WorkbenchRail } from './WorkbenchRail';
import { WorkbenchResizeHandle } from './WorkbenchResizeHandle';
import { WORKBENCH_TOOLS } from './workbenchTools';
import './workbench.css';

// Trae-style unified right work area.
// - closed: floating vertical icon rail with direct entries
// - open, no active tab: "Start here" launcher list (icon + name + purpose)
// - open with tabs: tab strip + compact "+" menu, fold hides the panel
export function WorkbenchPanel() {
  const { t } = useTranslation('chat');
  const panelOpen = useWorkbenchTabsStore((s) => s.panelOpen);
  const panelWidth = useWorkbenchTabsStore((s) => s.panelWidth);
  const tabs = useWorkbenchTabsStore((s) => s.tabs);
  const active = useWorkbenchTabsStore((s) => s.active);
  const closeTool = useWorkbenchTabsStore((s) => s.closeTool);
  const setActive = useWorkbenchTabsStore((s) => s.setActive);
  const openTool = useWorkbenchTabsStore((s) => s.openTool);
  const setPanelWidth = useWorkbenchTabsStore((s) => s.setPanelWidth);
  const asideRef = useRef<HTMLElement | null>(null);

  const metaById = useMemo(() => new Map(WORKBENCH_TOOLS.map((tool) => [tool.id, tool])), []);

  // Re-clamp the persisted width when the window or surrounding layout
  // changes, so the chat column (with its composer toolbar) never collapses
  // below its usable minimum. The container is the conversation rail: it
  // holds only the chat wrapper plus this panel, so its width is exactly the
  // space shared by both; the store clamp reserves the chat-column floor.
  useEffect(() => {
    // The aside only exists while the panel is open. Re-running on panelOpen
    // guarantees asideRef is populated when the observer is attached; running
    // once at mount (closed state) would early-return and never re-observe.
    if (!panelOpen) return undefined;
    const aside = asideRef.current;
    const container = aside?.parentElement;
    if (!container) return undefined;
    const reclamp = (containerWidth: number) => {
      setPanelWidth(useWorkbenchTabsStore.getState().panelWidth, containerWidth);
    };
    // Run once after layout settles (handles a too-wide persisted width).
    const raf = requestAnimationFrame(() => reclamp(container.getBoundingClientRect().width));
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) reclamp(entry.contentRect.width);
    });
    observer.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [setPanelWidth, panelOpen]);

  if (!panelOpen) return <WorkbenchRail />;

  return (
    <aside
      ref={asideRef}
      data-pt-workbench-panel
      className="wb-shell-panel"
      style={{
        flex: `0 0 ${panelWidth}px`,
        width: panelWidth,
        minWidth: MIN_PANEL_WIDTH,
        position: 'relative',
      }}
    >
      <WorkbenchResizeHandle />
      <header className="wb-shell-header">
        {active === null ? (
          <span style={{ flex: 1 }} />
        ) : (
          <>
            <div className="wb-shell-tabs">
              {tabs.map((toolId) => {
                const meta = metaById.get(toolId);
                if (!meta) return null;
                const isActive = active === toolId;
                return (
                  <span
                    key={toolId}
                    className="wb-shell-tab"
                    data-pt-workbench-tab={toolId}
                    data-selected={isActive}
                  >
                    <Button
                      actionId={`wb.tab.${toolId}`}
                      emphasis="quiet"
                      density="compact"
                      aria-current={isActive ? 'page' : undefined}
                      onActivate={() => setActive(toolId)}
                    >
                      <Icon iconId={meta.iconId} size={13} />
                      <span>{t(meta.labelKey)}</span>
                    </Button>
                    <IconButton
                      actionId={`wb.tab-close.${toolId}`}
                      iconId="close"
                      iconSize={12}
                      label={`${t(meta.labelKey)} ×`}
                      emphasis="quiet"
                      density="compact"
                      {...(meta.closeAttr ? { [meta.closeAttr]: '' } : {})}
                      data-pt-workbench-close={toolId}
                      onActivate={() => closeTool(toolId)}
                    />
                  </span>
                );
              })}
            </div>
            <WorkbenchAddMenu />
          </>
        )}
        <WorkbenchFoldButton blockSize={28} />
      </header>

      {active === null ? (
        <div className="wb-shell-launcher" data-pt-workbench-launcher>
          <Text tone="muted" className="wb-shell-launcher__hint">
            {t('chat.workbench.startHere')}
          </Text>
          <div role="list" className="wb-shell-launcher__list">
            {WORKBENCH_TOOLS.map((tool) => (
              <Button
                key={tool.id}
                role="listitem"
                actionId={`wb.launcher.${tool.id}`}
                emphasis="quiet"
                fullWidth
                data-pt-workbench-add={tool.id}
                onActivate={() => openTool(tool.id)}
                className="wb-shell-launcher__row"
              >
                <Icon iconId={tool.iconId} size={16} className="wb-shell-launcher__icon" />
                <span className="wb-shell-launcher__text">
                  <Text strong className="wb-shell-launcher__name">
                    {t(tool.labelKey)}
                  </Text>
                  <Text tone="muted" className="wb-shell-launcher__desc">
                    {t(tool.descKey)}
                  </Text>
                </span>
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="wb-shell-body">
          <TaskSummaryDock />
          <FileDock />
          <TerminalDock />
          <BrowserDock />
          <MemoryReviewDock />
          <BranchesDock />
        </div>
      )}
    </aside>
  );
}

import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { theme } from 'antd';
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

// Trae-style unified right work area.
// - closed: floating vertical icon rail with direct entries
// - open, no active tab: "Start here" launcher list (icon + name + purpose)
// - open with tabs: tab strip + compact "+" menu, fold hides the panel
export function WorkbenchPanel() {
  const { token } = theme.useToken();
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
      style={{
        flex: `0 0 ${panelWidth}px`,
        width: panelWidth,
        minWidth: MIN_PANEL_WIDTH,
        height: '100%',
        minHeight: 0,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgContainer,
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <WorkbenchResizeHandle />
      <header
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 42,
          padding: '0 8px 0 10px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {active === null ? (
          <div style={{ flex: 1 }} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto', flex: 1, minWidth: 0 }}>
              {tabs.map((toolId) => {
                const meta = metaById.get(toolId);
                if (!meta) return null;
                const isActive = active === toolId;
                return (
                  <div
                    key={toolId}
                    data-pt-workbench-tab={toolId}
                    onClick={() => setActive(toolId)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      height: 30,
                      padding: '0 6px 0 10px',
                      borderRadius: 8,
                      flexShrink: 0,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? token.colorPrimaryText : token.colorTextSecondary,
                      background: isActive ? token.colorPrimaryBg : 'transparent',
                    }}
                  >
                    {meta.icon}
                    <span>{t(meta.labelKey)}</span>
                    <button
                      type="button"
                      {...(meta.closeAttr ? { [meta.closeAttr]: '' } : {})}
                      data-pt-workbench-close={toolId}
                      aria-label={`${t(meta.labelKey)} ×`}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTool(toolId);
                      }}
                      style={{
                        width: 18,
                        height: 18,
                        border: 'none',
                        borderRadius: 5,
                        background: 'transparent',
                        color: 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
            <WorkbenchAddMenu />
          </>
        )}
        <WorkbenchFoldButton blockSize={28} />
      </header>

      {active === null ? (
        <div
          data-pt-workbench-launcher
          style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '24px 28px' }}
        >
          <div
            style={{
              fontSize: 13,
              color: token.colorTextTertiary,
              marginBottom: 18,
            }}
          >
            {t('chat.workbench.startHere')}
          </div>
          <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {WORKBENCH_TOOLS.map((tool) => (
              <button
                key={tool.id}
                type="button"
                role="listitem"
                data-pt-workbench-add={tool.id}
                onClick={() => openTool(tool.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  borderRadius: 8,
                  padding: '9px 8px',
                  cursor: 'pointer',
                  color: token.colorText,
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = token.colorFillQuaternary;
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = 'transparent';
                }}
              >
                <span
                  style={{
                    width: 24,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    color: token.colorTextTertiary,
                  }}
                >
                  {tool.icon}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>
                    {t(tool.labelKey)}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: token.colorTextTertiary, marginTop: 1 }}>
                    {t(tool.descKey)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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

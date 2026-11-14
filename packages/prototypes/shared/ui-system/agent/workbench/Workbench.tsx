/**
 * Workbench — the Trae-style right work area, peers-ui only.
 *
 * Three states mirroring production WorkbenchPanel + WorkbenchRail:
 *  - closed: a floating vertical icon rail pinned to the conversation's
 *    right edge; one click opens the panel with that tool active;
 *  - open, no active tab: a "Start here" launcher listing every tool with
 *    its purpose;
 *  - open with tabs: the tab strip plus a searchable add menu and a fold
 *    control; closing the last tab returns to the launcher, only fold hides
 *    the panel. Width is owned by the library ResizablePanel primitive
 *    (accessible separator + keyboard resize), never a hand-rolled handle.
 */
import { useMemo, useState } from 'react';
import {
  Button, Flex, Icon, IconButton, Popover, ResizablePanel, ScrollArea, Text, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs, type Translate } from '../../prefs';
import type { WorkbenchToolId } from '../types';
import type { ConversationMessage } from '../conversation/types';
import { WORKBENCH_TOOLS } from './workbench-data';
import { useWorkbench, type WorkbenchState } from './useWorkbench';
import { SummaryDock } from './docks/SummaryDock';
import { FileDock } from './docks/FileDock';
import { BrowserDock } from './docks/BrowserDock';
import { TerminalDock } from './docks/TerminalDock';
import { MemoryDock } from './docks/MemoryDock';
import { BranchesDock } from './docks/BranchesDock';

interface WorkbenchProps {
  messages: readonly ConversationMessage[];
  title: string;
  agentName: string;
}

export function Workbench({ messages, title, agentName }: WorkbenchProps) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const workbench = useWorkbench();

  if (!workbench.panelOpen) {
    return <FloatingRail t={t} onOpen={workbench.openTool} />;
  }

  return (
    <ResizablePanel
      size={workbench.panelWidth}
      onSizeChange={workbench.setPanelWidth}
      minimum={260}
      maximum={560}
      label={t('agent.wb.resize')}
      className="pa-workbench"
      bodyClassName="pa-workbench__panel-body"
      data-pt-wb-panel
    >
      <WorkbenchHeader workbench={workbench} t={t} />
      <div className="pa-workbench__body">
        {workbench.active === null
          ? <Launcher t={t} onOpen={workbench.openTool} />
          : (
            <ActiveDock
              active={workbench.active}
              messages={messages}
              title={title}
              agentName={agentName}
            />
          )}
      </div>
    </ResizablePanel>
  );
}

function FloatingRail({ t, onOpen }: { t: Translate; onOpen: (id: WorkbenchToolId) => void }) {
  return (
    <Flex direction="column" align="center" gap={2} className="pa-wb-rail"
      aria-label={t('agent.workbench.title')} data-pt-wb-rail>
      {WORKBENCH_TOOLS.map(tool => (
        <IconButton
          key={tool.id}
          actionId={`wb.rail.${tool.id}`}
          iconId={tool.iconId}
          iconSize={16}
          label={t(tool.labelKey)}
          emphasis="quiet"
          data-pt-wb-rail-item={tool.id}
          onActivate={() => onOpen(tool.id)}
        />
      ))}
    </Flex>
  );
}

function Launcher({ t, onOpen }: { t: Translate; onOpen: (id: WorkbenchToolId) => void }) {
  return (
    <ScrollArea className="pa-wb-launcher" data-pt-wb-launcher>
      <Text tone="muted" className="pa-wb-launcher__hint">{t('agent.wb.startHere')}</Text>
      <Flex direction="column" gap={2}>
        {WORKBENCH_TOOLS.map(tool => (
          <Button
            key={tool.id}
            actionId={`wb.launcher.${tool.id}`}
            emphasis="quiet"
            fullWidth
            className="pa-wb-launcher__row"
            data-pt-wb-add={tool.id}
            onActivate={() => onOpen(tool.id)}
          >
            <Icon iconId={tool.iconId} size={16} className="pa-wb-launcher__icon" />
            <span className="pa-wb-launcher__text">
              <Text strong className="pa-wb-launcher__name">{t(tool.labelKey)}</Text>
              <Text tone="muted" className="pa-wb-launcher__desc">{t(tool.descKey)}</Text>
            </span>
          </Button>
        ))}
      </Flex>
    </ScrollArea>
  );
}

function WorkbenchHeader({ workbench, t }: { workbench: WorkbenchState; t: Translate }) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return WORKBENCH_TOOLS;
    return WORKBENCH_TOOLS.filter(tool =>
      t(tool.labelKey).toLocaleLowerCase().includes(needle)
      || t(tool.descKey).toLocaleLowerCase().includes(needle));
  }, [query, t]);

  const addMenu = (
    <div className="pa-pop-panel pa-wb-addmenu" data-pt-wb-add-menu>
      <TextField
        autoFocus
        clearable
        value={query}
        aria-label={t('agent.wb.searchPlaceholder')}
        placeholder={t('agent.wb.searchPlaceholder')}
        onClear={() => setQuery('')}
        onValueChange={setQuery}
      />
      <Flex direction="column" gap={2} className="pa-wb-addmenu__list">
        {filtered.map(tool => (
          <Button
            key={tool.id}
            actionId={`wb.add.${tool.id}`}
            emphasis="quiet"
            fullWidth
            label={t(tool.labelKey)}
            leading={<Icon iconId={tool.iconId} size={14} />}
            data-pt-wb-add={tool.id}
            onActivate={() => { workbench.openTool(tool.id); setQuery(''); }}
          />
        ))}
        {filtered.length === 0 && (
          <Text tone="muted" className="pa-wb-addmenu__empty">{t('agent.wb.searchEmpty')}</Text>
        )}
      </Flex>
    </div>
  );

  return (
    <Flex direction="row" align="center" gap={4} className="pa-workbench__header">
      {workbench.active === null ? (
        <span className="pa-wb-spacer" />
      ) : (
        <>
          <ScrollArea className="pa-workbench__tabs">
            <Flex direction="row" align="center" gap={2}>
              {workbench.tabs.map(id => {
                const meta = WORKBENCH_TOOLS.find(tool => tool.id === id);
                if (!meta) return null;
                const selected = workbench.active === id;
                return (
                  <Flex key={id} direction="row" align="center"
                    className="pa-wb-tab" data-pt-wb-tab={id} data-selected={selected || undefined}>
                    <Button
                      actionId={`wb.tab.${id}`}
                      emphasis="quiet"
                      density="compact"
                      className="pa-wb-tab__select"
                      aria-current={selected ? 'page' : undefined}
                      onActivate={() => workbench.setActive(id)}
                    >
                      <Icon iconId={meta.iconId} size={13} />
                      <span>{t(meta.labelKey)}</span>
                    </Button>
                    <IconButton
                      actionId={`wb.tab-close.${id}`}
                      iconId="close"
                      iconSize={11}
                      label={t('agent.common.cancel')}
                      emphasis="quiet"
                      density="compact"
                      data-pt-wb-close={id}
                      onActivate={() => workbench.closeTool(id)}
                    />
                  </Flex>
                );
              })}
            </Flex>
          </ScrollArea>
          <Popover label={t('agent.wb.add')} placement="bottom" content={addMenu}>
            <IconButton actionId="wb.add-toggle" iconId="plus" iconSize={16}
              label={t('agent.wb.add')} emphasis="quiet" density="compact"
              data-pt-wb-add-toggle />
          </Popover>
        </>
      )}
      <IconButton actionId="wb.fold" iconId="panel-right-close" iconSize={16}
        label={t('agent.wb.hide')} emphasis="quiet" density="compact"
        data-pt-wb-fold onActivate={workbench.closePanel} />
    </Flex>
  );
}

function ActiveDock({
  active, messages, title, agentName,
}: {
  active: WorkbenchToolId;
  messages: readonly ConversationMessage[];
  title: string;
  agentName: string;
}) {
  switch (active) {
    case 'summary':
      return <SummaryDock messages={messages} title={title} agentName={agentName} />;
    case 'file':
      return <FileDock />;
    case 'browser':
      return <BrowserDock />;
    case 'terminal':
      return <TerminalDock />;
    case 'memory':
      return <MemoryDock />;
    case 'branches':
      return <BranchesDock />;
    default:
      return null;
  }
}

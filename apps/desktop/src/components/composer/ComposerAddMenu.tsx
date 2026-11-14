import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, IconButton, Popover, TextField } from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';

import { resolveI18nValue } from '../../i18n';
import { useChatStore } from '../../store/chat';
import type { AgentTopic } from '../../store/agentTopics';
import { useWorkbenchTabsStore } from '../../store/workbenchTabs';
import { useWorkspaceFsStore } from '../../store/workspaceFs';
import { useActiveAgentSlice, useActiveAgentTopicSlice } from '../agent/useActiveAgentStores';
import {
  buildWorkspaceFileIndex,
  matchesFileName,
  type FileSearchIndex,
} from './fileSearch';
import './composer-add-menu.css';

type View = 'root' | 'files' | 'history';
type FileState = 'idle' | 'loading' | 'ready' | 'unavailable';

const RECENT_TOPIC_LIMIT = 8;
const FILE_RESULT_LIMIT = 50;

// Composer-level "+" aggregation: workspace file search, attachment upload and
// recent conversations in one popover. Every action is backed by a real
// transport — no placeholder rows. File search requires an authorized working
// directory and renders an explicit guidance state when none is active.
export function ComposerAddMenu({ onPickAttachment }: { onPickAttachment: () => void }) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('root');

  const [fileState, setFileState] = useState<FileState>('idle');
  const [fileQuery, setFileQuery] = useState('');
  const [index, setIndex] = useState<FileSearchIndex | null>(null);
  const loadSeq = useRef(0);

  const { currentAgent } = useActiveAgentSlice((state) => ({
    currentAgent: state.agents.find((agent) => agent.name === state.selectedAgent),
  }));
  const topicsByAgentId = useActiveAgentTopicSlice((state) => state.topicsByAgentId);
  const selectSession = useChatStore((state) => state.selectSession);
  const openTool = useWorkbenchTabsStore((state) => state.openTool);
  const openFile = useWorkspaceFsStore((state) => state.openFile);

  const recentTopics = useMemo<AgentTopic[]>(() => {
    const topics = currentAgent ? topicsByAgentId[currentAgent.id] ?? [] : [];
    return [...topics]
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, RECENT_TOPIC_LIMIT);
  }, [currentAgent, topicsByAgentId]);

  const filteredFiles = useMemo(() => {
    if (!index) return [];
    return index.files
      .filter((entry) => matchesFileName(entry, fileQuery))
      .slice(0, FILE_RESULT_LIMIT);
  }, [index, fileQuery]);

  useEffect(() => {
    if (!open) {
      setView('root');
      setFileQuery('');
    }
  }, [open]);

  const enterFileSearch = useCallback(() => {
    setView('files');
    if (fileState === 'ready' || fileState === 'loading') return;
    const seq = ++loadSeq.current;
    setFileState('loading');
    buildWorkspaceFileIndex()
      .then((result) => {
        if (seq !== loadSeq.current) return;
        setIndex(result);
        setFileState('ready');
      })
      .catch(() => {
        if (seq !== loadSeq.current) return;
        // Both the private-sandbox rejection and any transport failure leave
        // the user without a searchable tree; the guidance state tells them to
        // authorize a working directory instead of rendering fake results.
        setFileState('unavailable');
      });
  }, [fileState]);

  const handlePickFile = useCallback(async (path: string) => {
    await openFile(path);
    openTool('file');
    setOpen(false);
  }, [openFile, openTool]);

  const handlePickTopic = useCallback((topic: AgentTopic) => {
    void selectSession(topic.key, topic);
    setOpen(false);
  }, [selectSession]);

  const handleAttachment = useCallback(() => {
    onPickAttachment();
    setOpen(false);
  }, [onPickAttachment]);

  const menu = (
    <div className="pa-addmenu" data-pt-composer-add-menu={view}>
      {view === 'root' && (
        <div className="pa-addmenu__list" role="menu">
          <Button
            actionId="composer.add.fileSearch"
            emphasis="quiet"
            fullWidth
            className="pa-addmenu__row"
            leading={<Icon iconId="search" size={15} />}
            label={t('chat.input.addMenu.fileSearch')}
            data-pt-composer-add="file-search"
            onActivate={enterFileSearch}
          />
          <Button
            actionId="composer.add.attachment"
            emphasis="quiet"
            fullWidth
            className="pa-addmenu__row"
            leading={<Icon iconId="paperclip" size={15} />}
            label={t('chat.input.addMenu.attachment')}
            data-pt-composer-add="attachment"
            onActivate={handleAttachment}
          />
          <Button
            actionId="composer.add.recent"
            emphasis="quiet"
            fullWidth
            className="pa-addmenu__row"
            leading={<Icon iconId="history" size={15} />}
            label={t('chat.input.addMenu.recent')}
            data-pt-composer-add="recent"
            onActivate={() => setView('history')}
          />
        </div>
      )}

      {view === 'files' && (
        <>
          <div className="pa-addmenu__head">
            <IconButton
              actionId="composer.add.files.back"
              iconId="arrow-left"
              iconSize={15}
              label={t('chat.input.addMenu.back')}
              emphasis="quiet"
              density="compact"
              data-pt-composer-add-back
              onActivate={() => setView('root')}
            />
            <span className="pa-addmenu__title">{t('chat.input.addMenu.fileSearch')}</span>
          </div>
          <TextField
            autoFocus
            clearable
            value={fileQuery}
            aria-label={t('chat.input.addMenu.fileSearchPlaceholder')}
            placeholder={t('chat.input.addMenu.fileSearchPlaceholder')}
            onClear={() => setFileQuery('')}
            onValueChange={setFileQuery}
          />
          <div className="pa-addmenu__list" role="listbox">
            {fileState === 'loading' && (
              <span className="pa-addmenu__empty">{t('chat.input.addMenu.fileSearchPlaceholder')}</span>
            )}
            {fileState === 'unavailable' && (
              <span className="pa-addmenu__empty" data-pt-composer-add-unavailable>
                {t('chat.input.addMenu.fileSearchUnavailable')}
              </span>
            )}
            {fileState === 'ready' && filteredFiles.map((entry) => (
              <Button
                key={entry.relativePath}
                actionId={`composer.add.file.${entry.relativePath}`}
                emphasis="quiet"
                fullWidth
                className="pa-addmenu__row"
                leading={<Icon iconId="file" size={14} />}
                aria-label={entry.relativePath}
                data-pt-composer-add-file={entry.relativePath}
                onActivate={() => void handlePickFile(entry.relativePath)}
              >
                <span className="pa-addmenu__row-label">
                  {entry.name}
                  <span className="pa-addmenu__row-meta">{entry.relativePath}</span>
                </span>
              </Button>
            ))}
            {fileState === 'ready' && filteredFiles.length === 0 && (
              <span className="pa-addmenu__empty">{t('chat.input.addMenu.fileSearchEmpty')}</span>
            )}
            {fileState === 'ready' && filteredFiles.length === FILE_RESULT_LIMIT && (
              <span className="pa-addmenu__limit">
                {t('chat.input.addMenu.fileSearchLimit', { count: FILE_RESULT_LIMIT })}
              </span>
            )}
          </div>
        </>
      )}

      {view === 'history' && (
        <>
          <div className="pa-addmenu__head">
            <IconButton
              actionId="composer.add.recent.back"
              iconId="arrow-left"
              iconSize={15}
              label={t('chat.input.addMenu.back')}
              emphasis="quiet"
              density="compact"
              onActivate={() => setView('root')}
            />
            <span className="pa-addmenu__title">{t('chat.input.addMenu.recent')}</span>
          </div>
          <div className="pa-addmenu__list" role="listbox">
            {recentTopics.length === 0 && (
              <span className="pa-addmenu__empty">{t('chat.input.addMenu.recentEmpty')}</span>
            )}
            {recentTopics.map((topic) => (
              <Button
                key={topic.key}
                actionId={`composer.add.topic.${topic.key}`}
                emphasis="quiet"
                fullWidth
                className="pa-addmenu__row"
                leading={<Icon iconId="clock" size={14} />}
                aria-label={resolveI18nValue(topic.title) || topic.key}
                data-pt-composer-add-topic={topic.key}
                onActivate={() => handlePickTopic(topic)}
              >
                <span className="pa-addmenu__row-label">
                  {resolveI18nValue(topic.title) || t('chat.input.addMenu.recentEmpty')}
                  <span className="pa-addmenu__row-meta">
                    {new Date(topic.updated_at).toLocaleDateString()}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="top"
      label={t('chat.input.addMenu.label')}
      content={menu}
    >
      <IconButton
        actionId="composer.add.toggle"
        iconId="plus"
        iconSize={17}
        label={t('chat.input.addMenu.label')}
        emphasis="quiet"
        data-pt-composer-add-toggle
      />
    </Popover>
  );
}

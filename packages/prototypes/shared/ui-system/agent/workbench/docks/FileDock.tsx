/**
 * FileDock — workspace file tree and git change review.
 *
 * Parity with production FileDock: a tree/changes sub-tab pair, directory
 * change aggregation, git short-status badges, refresh, and a file detail
 * view with diff-before/after plus read-only content. All data is the local
 * deterministic seed; the prototype owns no FS transport.
 */
import { useMemo, useState } from 'react';
import {
  Button, CodeBlock, CodeDiff, Empty, Flex, Icon, IconButton, ScrollArea,
  Spin, Tabs, Tag, Text,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../../prefs';
import {
  SEED_FILE_CHANGES, SEED_FILE_TREE, WORKBENCH_ROOT_NAME, openSeedFile,
} from '../workbench-data';
import type { FileChange, FileNode, GitStatusCode, OpenedFile } from '../types';

type FileView = 'tree' | 'changes';

const STATUS_TONE: Record<Exclude<GitStatusCode, ''>, 'success' | 'warning' | 'danger' | 'info'> = {
  '??': 'success',
  A: 'success',
  M: 'warning',
  D: 'danger',
  R: 'info',
  C: 'info',
};

function directorySummary(changes: readonly FileChange[], dirPath: string): { kind: 'modified' | 'untracked'; count: number } | null {
  const prefix = dirPath === '' ? '' : `${dirPath}/`;
  const inside = changes.filter(change => change.path.startsWith(prefix));
  if (inside.length === 0) return null;
  const hasTracked = inside.some(change => change.status !== '??');
  return { kind: hasTracked ? 'modified' : 'untracked', count: inside.length };
}

export function FileDock() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [view, setView] = useState<FileView>('tree');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['apps', 'apps/desktop', 'apps/desktop/src']));
  const [opened, setOpened] = useState<OpenedFile | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 350);
  };

  const toggleDir = (path: string) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openFile = (path: string) => setOpened(openSeedFile(path));

  const tabItems = useMemo(() => [
    {
      id: 'tree',
      label: (
        <Flex direction="row" align="center" gap={4}>
          <Icon iconId="folder-tree" size={13} />
          <span>{t('agent.wb.file.viewTree')}</span>
        </Flex>
      ),
      content: (
        <ScrollArea className="pa-wb-file__scroll" data-pt-wb-tree>
          {SEED_FILE_TREE.map(node => (
            <TreeRow key={node.path} node={node} depth={0} expanded={expanded}
              changes={SEED_FILE_CHANGES} onToggleDir={toggleDir} onOpenFile={openFile} />
          ))}
        </ScrollArea>
      ),
    },
    {
      id: 'changes',
      label: (
        <Flex direction="row" align="center" gap={4}>
          <Icon iconId="git-branch" size={13} />
          <span>{t('agent.wb.file.viewChanges')}</span>
          {SEED_FILE_CHANGES.length > 0 && (
            <Tag tone="neutral" className="pa-wb-file__count">{SEED_FILE_CHANGES.length}</Tag>
          )}
        </Flex>
      ),
      content: (
        <ScrollArea className="pa-wb-file__scroll" data-pt-wb-changes>
          {SEED_FILE_CHANGES.length === 0
            ? <Empty description={t('agent.wb.file.noChanges')} />
            : SEED_FILE_CHANGES.map(change => (
              <Button
                key={`${change.status}-${change.path}`}
                actionId={`wb.file.change.${change.path}`}
                emphasis="quiet"
                fullWidth
                className="pa-wb-change-row"
                data-pt-wb-change-item={change.path}
                onActivate={() => openFile(change.path)}
              >
                <Tag tone={STATUS_TONE[change.status]} className="pa-wb-file__status">{change.status}</Tag>
                <span className="pa-wb-file__path">{change.path}</span>
              </Button>
            ))}
        </ScrollArea>
      ),
    },
  ], [expanded, t]);

  if (opened) {
    return (
      <div className="pa-wb-dock pa-wb-file" data-pt-wb-file-view>
        <Flex direction="row" align="center" gap={6} className="pa-wb-file__detail-head">
          <IconButton
            actionId="wb.file.back"
            iconId="arrow-left"
            iconSize={15}
            label={t('agent.wb.file.back')}
            emphasis="quiet"
            density="compact"
            onActivate={() => setOpened(null)}
          />
          <Text tone="secondary" truncate className="pa-wb-file__detail-path">{opened.path}</Text>
        </Flex>
        <ScrollArea className="pa-wb-file__detail-body">
          {opened.diffBefore && opened.diffAfter && (
            <>
              <Text tone="muted" className="pa-wb-file__section-label">{t('agent.wb.file.changes')}</Text>
              <CodeDiff
                before={opened.diffBefore}
                after={opened.diffAfter}
                beforeLabel={t('agent.tool.before')}
                afterLabel={t('agent.tool.after')}
                data-pt-wb-file-diff
              />
            </>
          )}
          <Text tone="muted" className="pa-wb-file__section-label">{t('agent.wb.file.contents')}</Text>
          <CodeBlock code={opened.content} language="typescript" label={opened.name} data-pt-wb-file-content />
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="pa-wb-dock pa-wb-file" data-pt-wb-file>
      <Flex direction="row" align="center" gap={6} className="pa-wb-file__head">
        <Icon iconId="folder" size={14} className="pa-wb-file__root-icon" />
        <Text strong truncate className="pa-wb-file__root-name">{WORKBENCH_ROOT_NAME}</Text>
        <span className="pa-wb-spacer" />
        <Spin active={refreshing} size="small">
          <IconButton
            actionId="wb.file.refresh"
            iconId="refresh-cw"
            iconSize={13}
            label={t('agent.wb.file.refresh')}
            emphasis="quiet"
            density="compact"
            data-pt-wb-fs-refresh
            onActivate={refresh}
          />
        </Spin>
      </Flex>
      <Tabs
        className="pa-wb-file__tabs"
        panelClassName="pa-wb-file__tab-panel"
        items={tabItems}
        value={view}
        onValueChange={value => setView(value as FileView)}
        aria-label={t('agent.wb.file.viewsLabel')}
      />
    </div>
  );
}

function TreeRow({
  node, depth, expanded, changes, onToggleDir, onOpenFile,
}: {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  changes: readonly FileChange[];
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
}) {
  const isOpen = expanded.has(node.path);
  const summary = node.isDir ? directorySummary(changes, node.path) : null;
  const status: GitStatusCode | undefined = node.status;

  return (
    <div>
      <Button
        actionId={`wb.tree.${node.path}`}
        emphasis="quiet"
        fullWidth
        className="pa-wb-tree-row"
        data-pt-wb-tree-item={node.path}
        data-pt-wb-tree-dir={node.isDir ? 'true' : 'false'}
        style={{ paddingLeft: 4 + depth * 14 }}
        onActivate={() => (node.isDir ? onToggleDir(node.path) : onOpenFile(node.path))}
      >
        {node.isDir
          ? <Icon iconId="chevron-right" size={12} className="pa-wb-tree-row__chevron" data-collapsed={isOpen ? undefined : 'true'} />
          : <span className="pa-wb-tree-row__chevron-spacer" />}
        <Icon
          iconId={node.isDir ? (isOpen ? 'folder-open' : 'folder') : 'file-text'}
          size={14}
          className="pa-wb-tree-row__glyph"
        />
        <span className="pa-wb-tree-row__name">{node.name}</span>
        {summary && (
          <Tag tone={summary.kind === 'untracked' ? 'success' : 'warning'}
            className="pa-wb-file__count" data-pt-wb-dir-change-count={node.path}>
            {summary.count}
          </Tag>
        )}
        {!node.isDir && status && (
          <Tag tone={STATUS_TONE[status]} className="pa-wb-file__status">{status}</Tag>
        )}
      </Button>
      {node.isDir && isOpen && node.children?.map(child => (
        <TreeRow key={child.path} node={child} depth={depth + 1} expanded={expanded}
          changes={changes} onToggleDir={onToggleDir} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}

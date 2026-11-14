import { useEffect, useState } from 'react';
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  RefreshCw,
  ArrowLeft,
  FolderTree,
  GitBranch,
} from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

import { useWorkbenchTabsStore } from '../../../../store/workbenchTabs';
import {
  changeStatusOf,
  ROOT_DIR_KEY,
  useWorkspaceFsStore,
} from '../../../../store/workspaceFs';
import type { AgentWorkspaceEntry } from '../../../../services/desktop_api';

function statusColor(status: string, token: ReturnType<typeof theme.useToken>['token']): string {
  if (status === '??' || status === 'A') return token.colorSuccess;
  if (status === 'M') return token.colorWarning;
  if (status === 'D') return token.colorError;
  if (status.startsWith('R') || status.startsWith('C')) return token.colorInfo;
  return token.colorTextTertiary;
}

function ChangeBadge({ status, token }: { status: string; token: ReturnType<typeof theme.useToken>['token'] }) {
  return (
    <span
      style={{
        width: 26,
        flexShrink: 0,
        fontFamily: 'monospace',
        fontSize: 11,
        fontWeight: 600,
        color: statusColor(status, token),
      }}
    >
      {status || '·'}
    </span>
  );
}

// Aggregate git status of all changed files *inside* a directory (any depth).
// Returns a dominant kind used for color and the number of changed files.
function directoryChangeSummary(
  changes: { status: string; path: string }[],
  dirPath: string,
): { kind: 'modified' | 'untracked'; count: number } | null {
  const prefix = dirPath === '' ? '' : `${dirPath}/`;
  const inside = changes.filter((change) => change.path.startsWith(prefix));
  if (inside.length === 0) return null;
  const hasTracked = inside.some((change) => change.status.trim() !== '??');
  return {
    kind: hasTracked ? 'modified' : 'untracked',
    count: inside.length,
  };
}

function TreeRow({
  entry,
  depth,
  token,
  onOpenFile,
}: {
  entry: AgentWorkspaceEntry;
  depth: number;
  token: ReturnType<typeof theme.useToken>['token'];
  onOpenFile: (path: string) => void;
}) {
  const expanded = useWorkspaceFsStore((s) => s.expanded.includes(entry.relativePath));
  const children = useWorkspaceFsStore((s) => s.dirsByPath[entry.relativePath]);
  const loadingChildren = useWorkspaceFsStore((s) => s.loadingDirs[entry.relativePath]);
  const changes = useWorkspaceFsStore((s) => s.changes);
  const toggleDir = useWorkspaceFsStore((s) => s.toggleDir);
  const status = changeStatusOf(changes, entry.relativePath);
  const dirSummary = entry.isDir ? directoryChangeSummary(changes, entry.relativePath) : null;
  const dirColor = dirSummary
    ? (dirSummary.kind === 'untracked' ? token.colorSuccess : token.colorWarning)
    : token.colorText;
  const folderIconColor = dirSummary
    ? (dirSummary.kind === 'untracked' ? token.colorSuccess : token.colorWarning)
    : token.colorTextSecondary;

  return (
    <div>
      <button
        type="button"
        data-pt-workspace-tree-item={entry.relativePath}
        data-pt-workspace-tree-dir={entry.isDir ? 'true' : 'false'}
        onClick={() => (entry.isDir ? void toggleDir(entry.relativePath) : onOpenFile(entry.relativePath))}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          border: 'none',
          background: 'transparent',
          borderRadius: 6,
          padding: '3px 6px 3px 4px',
          paddingLeft: 4 + depth * 14,
          cursor: 'pointer',
          color: token.colorText,
          textAlign: 'left',
          fontSize: 12,
          lineHeight: 1.4,
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
            width: 14,
            flexShrink: 0,
            display: 'inline-flex',
            justifyContent: 'center',
            color: token.colorTextTertiary,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 100ms',
          }}
        >
          {entry.isDir ? <ChevronRight size={12} /> : null}
        </span>
        <span style={{ width: 16, flexShrink: 0, display: 'inline-flex', color: entry.isDir ? folderIconColor : token.colorTextSecondary }}>
          {entry.isDir
            ? (expanded ? <FolderOpen size={14} /> : <Folder size={14} />)
            : <FileIcon size={14} />}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: dirColor,
            fontWeight: dirSummary ? 500 : 400,
          }}
        >
          {entry.name}
        </span>
        {entry.isDir && dirSummary && (
          <span
            data-pt-workspace-dir-change-count={entry.relativePath}
            style={{
              flexShrink: 0,
              minWidth: 18,
              padding: '0 5px',
              borderRadius: 9,
              fontSize: 10,
              lineHeight: '15px',
              fontWeight: 600,
              color: dirSummary.kind === 'untracked' ? token.colorSuccess : token.colorWarning,
              background: dirSummary.kind === 'untracked' ? token.colorSuccessBg : token.colorWarningBg,
            }}
          >
            {dirSummary.count}
          </span>
        )}
        {!entry.isDir && status && <ChangeBadge status={status} token={token} />}
      </button>
      {entry.isDir && expanded && (
        <div data-pt-workspace-tree-children={entry.relativePath}>
          {loadingChildren && !children && (
            <div style={{ paddingLeft: 4 + (depth + 1) * 14, fontSize: 11, color: token.colorTextQuaternary }}>
              …
            </div>
          )}
          {(children ?? []).map((child) => (
            <TreeRow key={child.relativePath} entry={child} depth={depth + 1} token={token} onOpenFile={onOpenFile} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiffView({ diff, token }: { diff: string; token: ReturnType<typeof theme.useToken>['token'] }) {
  const lines = diff.split('\n');
  return (
    <pre
      data-pt-workspace-file-diff
      style={{
        margin: 0,
        padding: '8px 10px',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.55,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {lines.map((line, index) => {
        let color = token.colorTextSecondary;
        let background = 'transparent';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          color = token.colorSuccess;
          background = token.colorSuccessBg;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          color = token.colorError;
          background = token.colorErrorBg;
        } else if (line.startsWith('@@')) {
          color = token.colorInfo;
        } else if (line.startsWith('diff ') || line.startsWith('index ')) {
          color = token.colorTextQuaternary;
        }
        return (
          <div key={index} style={{ color, background, borderRadius: 2 }}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

export function FileDock() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const active = useWorkbenchTabsStore((s) => s.active === 'file');

  const loaded = useWorkspaceFsStore((s) => s.loaded);
  const loading = useWorkspaceFsStore((s) => s.loading);
  const errorKind = useWorkspaceFsStore((s) => s.errorKind);
  const rootName = useWorkspaceFsStore((s) => s.rootName);
  const rootEntries = useWorkspaceFsStore((s) => s.dirsByPath[ROOT_DIR_KEY]);
  const changes = useWorkspaceFsStore((s) => s.changes);
  const opened = useWorkspaceFsStore((s) => s.opened);
  const bootstrap = useWorkspaceFsStore((s) => s.bootstrap);
  const refresh = useWorkspaceFsStore((s) => s.refresh);
  const openFile = useWorkspaceFsStore((s) => s.openFile);
  const closeFile = useWorkspaceFsStore((s) => s.closeFile);
  const [view, setView] = useState<'tree' | 'changes'>('tree');

  useEffect(() => {
    if (active && !loaded) void bootstrap();
  }, [active, loaded, bootstrap]);

  if (!active) return null;

  if (errorKind === 'remoteSandbox') {
    return (
      <div
        data-pt-workspace-file-remote
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontSize: 12,
          color: token.colorTextTertiary,
          textAlign: 'center',
          lineHeight: 1.7,
        }}
      >
        {t('chat.workbench.file.remoteSandbox')}
      </div>
    );
  }

  // File detail view with diff and contents.
  if (opened) {
    return (
      <div data-pt-workspace-file-view style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 8px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <button
            type="button"
            data-pt-workspace-file-back
            aria-label={t('chat.workbench.file.back')}
            onClick={closeFile}
            style={{
              border: 'none',
              background: 'transparent',
              width: 26,
              height: 26,
              borderRadius: 6,
              color: token.colorTextSecondary,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ArrowLeft size={15} />
          </button>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {opened.path}
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {opened.binary ? (
            <div style={{ padding: 24, fontSize: 12, color: token.colorTextTertiary }}>
              {t('chat.workbench.file.binary')}
            </div>
          ) : (
            <>
              {opened.diff && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: token.colorTextTertiary,
                      padding: '8px 10px 4px',
                    }}
                  >
                    {t('chat.workbench.file.changes')}
                  </div>
                  <DiffView diff={opened.diff} token={token} />
                </div>
              )}
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: token.colorTextTertiary,
                  padding: '10px 10px 4px',
                  borderTop: opened.diff ? `1px solid ${token.colorBorderSecondary}` : 'none',
                }}
              >
                {t('chat.workbench.file.contents')}
              </div>
              <pre
                data-pt-workspace-file-content
                style={{
                  margin: 0,
                  padding: '8px 10px 20px',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: token.colorText,
                }}
              >
                {opened.content}
              </pre>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-pt-workbench-file
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Folder size={14} color={token.colorTextSecondary} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {rootName || 'workspace'}
        </span>
        <button
          type="button"
          data-pt-workspace-fs-refresh
          aria-label={t('chat.workbench.file.refresh')}
          title={t('chat.workbench.file.refresh')}
          onClick={() => void refresh()}
          style={{
            border: 'none',
            background: 'transparent',
            width: 26,
            height: 26,
            borderRadius: 6,
            color: token.colorTextSecondary,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RefreshCw
            size={13}
            style={loading ? { animation: 'spin 900ms linear infinite' } : undefined}
          />
        </button>
      </div>

      <div
        role="tablist"
        aria-label={t('chat.workbench.file.viewsLabel')}
        style={{
          flexShrink: 0,
          display: 'flex',
          padding: '4px 6px 0',
          gap: 2,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        {([
          { key: 'tree', label: t('chat.workbench.file.viewTree'), icon: <FolderTree size={13} />, attr: 'tree' },
          { key: 'changes', label: t('chat.workbench.file.viewChanges'), icon: <GitBranch size={13} />, attr: 'changes' },
        ] as const).map((sub) => {
          const selected = view === sub.key;
          return (
            <button
              key={sub.key}
              type="button"
              role="tab"
              aria-selected={selected}
              data-pt-workspace-file-view-tab={sub.attr}
              onClick={() => setView(sub.key)}
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                border: 'none',
                borderBottom: selected ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                marginBottom: -1,
                background: 'transparent',
                padding: '6px 8px',
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: selected ? 600 : 400,
                color: selected ? token.colorText : token.colorTextSecondary,
              }}
            >
              {sub.icon}
              <span>{sub.label}</span>
              {sub.key === 'changes' && changes.length > 0 && (
                <span
                  style={{
                    minWidth: 16,
                    padding: '0 4px',
                    borderRadius: 8,
                    fontSize: 10,
                    lineHeight: '16px',
                    fontWeight: 600,
                    color: selected ? token.colorPrimary : token.colorTextTertiary,
                    background: token.colorFillSecondary,
                  }}
                >
                  {changes.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '6px 4px' }}>
        {loading && !rootEntries && (
          <div style={{ padding: 16, fontSize: 12, color: token.colorTextTertiary }}>
            {t('chat.workbench.file.loading')}
          </div>
        )}

        {view === 'changes' && (
          <div data-pt-workspace-file-changes>
            {changes.length === 0 ? (
              <div style={{ padding: 16, fontSize: 12, color: token.colorTextTertiary }}>
                {t('chat.workbench.file.noChanges')}
              </div>
            ) : (
              changes.map((change) => (
                <button
                  key={`${change.status}-${change.path}`}
                  type="button"
                  data-pt-workspace-change-item={change.path}
                  onClick={() => void openFile(change.path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    width: '100%',
                    border: 'none',
                    background: 'transparent',
                    borderRadius: 6,
                    padding: '3px 8px',
                    cursor: 'pointer',
                    fontSize: 12,
                    textAlign: 'left',
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = token.colorFillQuaternary;
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent';
                  }}
                >
                  <ChangeBadge status={change.status.trim()} token={token} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: 'monospace',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: token.colorText,
                    }}
                  >
                    {change.path}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {view === 'tree' && (
          <>
            <div data-pt-workspace-tree>
              {(rootEntries ?? []).map((entry) => (
                <TreeRow key={entry.relativePath} entry={entry} depth={0} token={token} onOpenFile={(path) => void openFile(path)} />
              ))}
            </div>
            {loaded && !loading && rootEntries && rootEntries.length === 0 && (
              <div style={{ padding: 16, fontSize: 12, color: token.colorTextTertiary }}>
                {t('chat.workbench.file.empty')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

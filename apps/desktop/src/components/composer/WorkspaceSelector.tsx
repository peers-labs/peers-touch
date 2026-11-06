import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionIcon, Tag, toast } from '@lobehub/ui';
import { Dropdown, Input, Modal, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  FolderGit2,
  FolderOpen,
  FolderSymlink,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  api,
  type AgentWorkspaceChoice,
  type AgentWorkspaceState,
} from '../../services/desktop_api';
import { log } from '../../utils/logger';

// One capability session has one active working directory. The selector is
// the per-session authorization surface: picking a local project re-declares
// workspace grants for the live capability session only; stopping the
// session (app restart / logout) returns the worker to the private sandbox.
export function WorkspaceSelector() {
  const { t } = useTranslation(['chat', 'common']);
  const { token } = theme.useToken();
  const [state, setState] = useState<AgentWorkspaceState | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [worktreeBase, setWorktreeBase] = useState<AgentWorkspaceChoice | null>(null);
  const [worktreeName, setWorktreeName] = useState('');

  const refresh = useCallback(async () => {
    try {
      setState(await api.agentWorkspaceList());
    } catch (error) {
      // The capability surface is unavailable before identity/engine
      // activation; the selector simply renders the default state.
      log.warn('workspace', 'load workspace state failed', { error: String(error) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(async (
    operation: Promise<AgentWorkspaceState>,
  ): Promise<AgentWorkspaceState | undefined> => {
    setLoading(true);
    try {
      const next = await operation;
      setState(next);
      return next;
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : t('chat.input.workspace.failed');
      toast.error(message);
      log.warn('workspace', 'workspace operation failed', { error: String(error) });
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [t]);

  const activate = useCallback((locator: string | null) => {
    void run(api.agentWorkspaceActivate(locator)).then(() => setOpen(false));
  }, [run]);

  const pickFolder = useCallback(async () => {
    let folder: string;
    try {
      folder = await api.ossPickLocalFolder();
    } catch {
      return; // user cancelled the native dialog
    }
    const added = await run(api.agentWorkspaceAddDirectory(folder));
    if (added) activate(added.currentRoot ?? folder);
  }, [activate, run]);

  const removeChoice = useCallback((event: React.MouseEvent, choice: AgentWorkspaceChoice) => {
    event.stopPropagation();
    void run(api.agentWorkspaceRemove(choice.locator));
  }, [run]);

  const submitWorktree = useCallback(() => {
    const base = worktreeBase;
    const name = worktreeName.trim();
    setWorktreeBase(null);
    setWorktreeName('');
    if (!base || !name) return;
    void run(api.agentWorkspaceCreateWorktree(base.locator, name)).then((next) => {
      if (next?.currentRoot) setOpen(false);
    });
  }, [run, worktreeBase, worktreeName]);

  const currentLabel = useMemo(() => {
    if (!state?.currentRoot) return t('chat.input.workspace.sandbox');
    const segments = state.currentRoot.split('/');
    return segments[segments.length - 1] || state.currentRoot;
  }, [state, t]);

  const menuItems: MenuProps['items'] = useMemo(() => {
    const items: NonNullable<MenuProps['items']> = [
      {
        key: 'sandbox',
        icon: <FolderOpen size={14} />,
        label: (
          <Flexbox horizontal align="center" justify="space-between" gap={8}>
            <span>{t('chat.input.workspace.sandbox')}</span>
            {!state?.currentRoot && <Tag color="success">{t('chat.input.workspace.active')}</Tag>}
          </Flexbox>
        ),
        onClick: () => activate(null),
      },
      { type: 'divider' },
      {
        key: 'choose',
        icon: <FolderSymlink size={14} />,
        label: t('chat.input.workspace.chooseFolder'),
        onClick: () => void pickFolder(),
      },
    ];
    const choices = state?.choices ?? [];
    if (choices.length > 0) {
      items.push({
        key: 'recent-header',
        type: 'group' as const,
        label: t('chat.input.workspace.recentProjects'),
        children: choices.map((choice) => ({
          key: `choice-${choice.locator}`,
          icon: choice.worktreeBase
            ? <FolderGit2 size={14} />
            : <FolderOpen size={14} />,
          label: (
            <Flexbox horizontal align="center" justify="space-between" gap={8}>
              <Flexbox style={{ minWidth: 0 }} gap={0}>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={choice.locator}
                >
                  {choice.label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: token.colorTextTertiary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {choice.worktreeBase
                    ? t('chat.input.workspace.worktreeOf', { base: choice.worktreeBase })
                    : choice.locator}
                </span>
              </Flexbox>
              <Flexbox horizontal gap={2}>
                {choice.isGit && !choice.worktreeBase && (
                  <ActionIcon
                    data-pt-agent-workspace-worktree
                    size={{ blockSize: 22, size: 12 }}
                    icon={FolderGit2}
                    title={t('chat.input.workspace.createWorktree')}
                    onClick={(event) => {
                      event.stopPropagation();
                      setWorktreeBase(choice);
                      setWorktreeName('');
                    }}
                  />
                )}
                <ActionIcon
                  data-pt-agent-workspace-remove
                  size={{ blockSize: 22, size: 12 }}
                  icon={X}
                  title={t('chat.input.workspace.removeChoice')}
                  onClick={(event) => removeChoice(event, choice)}
                />
              </Flexbox>
            </Flexbox>
          ),
          onClick: () => activate(choice.locator),
        })),
      });
    }
    if (state?.currentRoot) {
      items.push(
        { type: 'divider' },
        {
          key: 'restore',
          icon: <RotateCcw size={14} />,
          label: t('chat.input.workspace.restore'),
          onClick: () => activate(null),
        },
      );
    }
    return items;
  }, [activate, pickFolder, removeChoice, state, t, token]);

  return (
    <>
      <Dropdown
        menu={{ items: menuItems }}
        trigger={['click']}
        placement="topLeft"
        arrow={false}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void refresh();
        }}
        overlayStyle={{ borderRadius: 12, maxWidth: 360 }}
      >
        <button
          data-pt-agent-workspace-selector
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('chat.input.workspace.title')}
          title={state?.currentRoot ?? t('chat.input.workspace.title')}
          style={{
            height: 28,
            border: `1px solid ${state?.currentRoot ? token.colorPrimary : '#ececec'}`,
            background: state?.currentRoot ? token.colorPrimaryBg : '#ffffff',
            color: state?.currentRoot ? token.colorPrimary : token.colorTextSecondary,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 12,
            borderRadius: 8,
            padding: '0 8px',
            cursor: 'pointer',
            maxWidth: 200,
          }}
        >
          {loading
            ? <Loader2 size={13} style={{ flexShrink: 0 }} />
            : <FolderGit2 size={13} style={{ flexShrink: 0 }} />}
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentLabel}
          </span>
        </button>
      </Dropdown>
      <Modal
        open={worktreeBase !== null}
        title={t('chat.input.workspace.createWorktree')}
        okText={t('chat.input.workspace.createWorktreeConfirm')}
        cancelText={t('common.action.cancel')}
        onOk={submitWorktree}
        onCancel={() => {
          setWorktreeBase(null);
          setWorktreeName('');
        }}
      >
        <Flexbox gap={8}>
          <span
            style={{ fontSize: 12, color: token.colorTextSecondary }}
            title={worktreeBase?.locator}
          >
            {worktreeBase?.label}
          </span>
          <Input
            data-pt-agent-workspace-worktree-name
            autoFocus
            value={worktreeName}
            placeholder={t('chat.input.workspace.worktreeNamePlaceholder')}
            maxLength={64}
            onChange={(event) => setWorktreeName(event.target.value)}
            onPressEnter={submitWorktree}
          />
          <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
            {t('chat.input.workspace.sessionScope')}
          </span>
        </Flexbox>
      </Modal>
    </>
  );
}

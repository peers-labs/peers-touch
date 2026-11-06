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
  ShieldAlert,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  api,
  type AgentWorkspaceChoice,
  type AgentWorkspaceState,
} from '../../services/desktop_api';
import {
  CapabilityApprovalPolicy,
  type AgentCapabilityBinding,
} from '../../gen/proto/domain/agent/capability_pb';
import { useAgentCapabilityStore } from '../../store/agentCapabilities';
import { log } from '../../utils/logger';

// Local capabilities that run inside the granted workspace and whose
// approval policy Full Access relaxes (Station AUTO = no per-call prompt).
const LOCAL_TOOL_CAPABILITIES = [
  'filesystem.read',
  'filesystem.list',
  'filesystem.write',
  'filesystem.edit',
  'shell.execute',
  'shell.allowlist',
] as const;

export interface WorkspaceSelectorProps {
  agentId?: string;
  agentVersion?: number;
}

// One capability session has one active working directory and one
// machine-local shell authorization. Both are per-session grants the user
// sets explicitly; neither Station nor the model can raise them.
export function WorkspaceSelector({ agentId, agentVersion }: WorkspaceSelectorProps) {
  const { t } = useTranslation(['chat', 'common']);
  const { token } = theme.useToken();
  const [state, setState] = useState<AgentWorkspaceState | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [worktreeBase, setWorktreeBase] = useState<AgentWorkspaceChoice | null>(null);
  const [worktreeName, setWorktreeName] = useState('');

  const manifests = useAgentCapabilityStore((s) => s.manifests);
  const upsertBinding = useAgentCapabilityStore((s) => s.upsertBinding);
  const bindings = useAgentCapabilityStore((s) =>
    agentId ? s.bindingsByAgentId[agentId] ?? [] : [],
  );

  const refresh = useCallback(async () => {
    try {
      setState(await api.agentWorkspaceList());
    } catch (error) {
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

  // Converge the local tool capabilities' approval policy so Full Access is
  // hands-free (AUTO) and Standard returns to per-call confirmation (MANUAL).
  const convergeToolApprovals = useCallback(async (fullAccess: boolean) => {
    if (!agentId || !agentVersion) return;
    const policy = fullAccess
      ? CapabilityApprovalPolicy.AUTO
      : CapabilityApprovalPolicy.MANUAL;
    await Promise.all(
      LOCAL_TOOL_CAPABILITIES.map(async (capabilityId) => {
        const manifest = manifests.find((m) => m.capabilityId === capabilityId);
        const binding: AgentCapabilityBinding | undefined = bindings.find(
          (b) => b.capabilityId === capabilityId,
        );
        if (!manifest || !binding || !binding.enabled) return;
        if (binding.approvalPolicy === policy) return;
        await upsertBinding({
          bindingId: binding.bindingId,
          agentId,
          capabilityId,
          capabilityVersion: manifest.version,
          enabled: true,
          approvalPolicy: policy,
          expectedAgentVersion: agentVersion,
          expectedBindingRevision: binding.revision,
          idempotencyKey: crypto.randomUUID(),
        });
      }),
    );
  }, [agentId, agentVersion, bindings, manifests, upsertBinding]);

  const setFullAccess = useCallback(async (fullAccess: boolean) => {
    const next = await run(api.agentWorkspaceSetShellAccess(fullAccess));
    if (!next) return;
    try {
      await convergeToolApprovals(fullAccess);
    } catch (error) {
      // Device grant already applied; a binding-convergence failure only
      // means approvals stay manual. Surface it but do not roll the shell.
      toast.error(t('chat.input.workspace.approvalConvergeFailed'));
      log.warn('workspace', 'tool approval converge failed', { error: String(error) });
    }
    void refresh();
  }, [convergeToolApprovals, refresh, run, t]);

  const requestFullAccess = useCallback(() => {
    Modal.confirm({
      title: t('chat.input.workspace.fullAccessConfirmTitle'),
      content: t('chat.input.workspace.fullAccessConfirmBody'),
      okText: t('chat.input.workspace.fullAccessConfirmOk'),
      okButtonProps: { danger: true },
      cancelText: t('common.action.cancel'),
      onOk: () => setFullAccess(true),
    });
  }, [setFullAccess, t]);

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

  const fullAccess = state?.shellAccess === 'full';

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
        key: 'access-header',
        type: 'group' as const,
        label: t('chat.input.workspace.accessGroup'),
        children: [
          {
            key: 'access-standard',
            icon: <FolderOpen size={14} />,
            label: (
              <Flexbox horizontal align="center" justify="space-between" gap={8}>
                <span>{t('chat.input.workspace.accessStandard')}</span>
                {!fullAccess && <Tag color="success">{t('chat.input.workspace.active')}</Tag>}
              </Flexbox>
            ),
            onClick: () => { if (fullAccess) void setFullAccess(false); },
          },
          {
            key: 'access-full',
            icon: <ShieldAlert size={14} />,
            danger: true,
            label: (
              <Flexbox horizontal align="center" justify="space-between" gap={8}>
                <span>{t('chat.input.workspace.accessFull')}</span>
                {fullAccess && <Tag color="error">{t('chat.input.workspace.active')}</Tag>}
              </Flexbox>
            ),
            onClick: () => { if (!fullAccess) requestFullAccess(); },
          },
        ],
      },
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
  }, [activate, fullAccess, pickFolder, removeChoice, requestFullAccess, setFullAccess, state, t, token]);

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
            border: `1px solid ${state?.currentRoot || fullAccess ? token.colorPrimary : '#ececec'}`,
            background: state?.currentRoot || fullAccess ? token.colorPrimaryBg : '#ffffff',
            color: state?.currentRoot || fullAccess ? token.colorPrimary : token.colorTextSecondary,
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
          {fullAccess && (
            <ShieldAlert
              size={12}
              color={token.colorError}
              style={{ flexShrink: 0 }}
              aria-label={t('chat.input.workspace.accessFull')}
            />
          )}
        </button>
      </Dropdown>
      <Modal
        open={worktreeBase !== null}
        title={t('chat.input.workspace.createWorktree')}
        okText={t('chat.input.workspace.createWorktreeConfirm')}
        cancelText={t('common.action.cancel')}
        onOk={() => {
          const base = worktreeBase;
          const name = worktreeName.trim();
          setWorktreeBase(null);
          setWorktreeName('');
          if (!base || !name) return;
          void run(api.agentWorkspaceCreateWorktree(base.locator, name)).then((next) => {
            if (next?.currentRoot) setOpen(false);
          });
        }}
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
            onPressEnter={() => {
              const base = worktreeBase;
              const name = worktreeName.trim();
              setWorktreeBase(null);
              setWorktreeName('');
              if (base && name) {
                void run(api.agentWorkspaceCreateWorktree(base.locator, name));
              }
            }}
          />
          <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
            {t('chat.input.workspace.sessionScope')}
          </span>
        </Flexbox>
      </Modal>
    </>
  );
}

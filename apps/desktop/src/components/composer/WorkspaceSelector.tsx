import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActionIcon, Tag, toast } from '@lobehub/ui';
import { Dropdown, Input, Modal, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  ChevronDown,
  FolderGit2,
  FolderOpen,
  FolderSymlink,
  Loader2,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
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

// Stable empty reference: zustand selectors must never return a fresh
// literal array or useSyncExternalStore sees a changed snapshot every render
// and React 19 loops with "Maximum update depth exceeded" (#185).
const EMPTY_BINDINGS: AgentCapabilityBinding[] = [];

// Trae-aligned full-access accent: a calm warning orange that reads as a
// deliberate risk mode without the harsh error red.
const FULL_ACCESS_COLOR = '#d46b08';
const FULL_ACCESS_BG = '#fff4e6';
const FULL_ACCESS_BORDER = '#ffd591';

function basenameOf(locator: string): string {
  const segments = locator.split('/');
  return segments[segments.length - 1] || locator;
}

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
    agentId ? (s.bindingsByAgentId[agentId] ?? EMPTY_BINDINGS) : EMPTY_BINDINGS,
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
      cancelText: t('common:common.action.cancel'),
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
  const currentRoot = state?.currentRoot ?? null;

  // Mode-first pill label, Trae style: permission mode dominates; a project
  // folder (when granted) replaces the generic "Sandbox" text.
  const pill = useMemo(() => {
    if (fullAccess) {
      return {
        icon: <ShieldAlert size={14} />,
        label: t('chat.input.workspace.fullShort'),
        tone: 'full' as const,
        title: currentRoot
          ? `${t('chat.input.workspace.fullShort')} · ${currentRoot}`
          : t('chat.input.workspace.fullShort'),
      };
    }
    if (currentRoot) {
      return {
        icon: <FolderGit2 size={14} />,
        label: basenameOf(currentRoot),
        tone: 'project' as const,
        title: currentRoot,
      };
    }
    return {
      icon: <FolderOpen size={14} />,
      label: t('chat.input.workspace.sandboxShort'),
      tone: 'sandbox' as const,
      title: t('chat.input.workspace.title'),
    };
  }, [currentRoot, fullAccess, t]);

  // Two-line menu row: bold title + quiet description, active tag on the right.
  const menuRow = (
    icon: ReactNode,
    title: string,
    description: string,
    active: boolean,
    accent?: boolean,
  ) => (
    <Flexbox horizontal align="center" justify="space-between" gap={8} style={{ padding: '2px 0' }}>
      <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: accent ? FULL_ACCESS_COLOR : token.colorTextSecondary,
            background: accent ? FULL_ACCESS_BG : token.colorFillQuaternary,
          }}
        >
          {icon}
        </span>
        <Flexbox style={{ minWidth: 0 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 500,
              lineHeight: 1.35,
              color: accent ? FULL_ACCESS_COLOR : token.colorText,
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: 11,
              lineHeight: 1.35,
              color: token.colorTextTertiary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 230,
            }}
          >
            {description}
          </span>
        </Flexbox>
      </Flexbox>
      {active && <Tag color={accent ? 'orange' : 'success'} style={{ margin: 0, flexShrink: 0 }}>{t('chat.input.workspace.active')}</Tag>}
    </Flexbox>
  );

  const menuItems: MenuProps['items'] = useMemo(() => {
    const items: NonNullable<MenuProps['items']> = [
      {
        key: 'directory-header',
        type: 'group' as const,
        label: t('chat.input.workspace.directoryGroup'),
        children: [
          {
            key: 'sandbox',
            label: menuRow(
              <FolderOpen size={14} />,
              t('chat.input.workspace.sandboxShort'),
              t('chat.input.workspace.sandboxDesc'),
              !currentRoot,
            ),
            onClick: () => activate(null),
          },
          ...(currentRoot
            ? [{
                key: 'current-project',
                label: menuRow(
                  <FolderGit2 size={14} />,
                  basenameOf(currentRoot),
                  currentRoot,
                  true,
                ),
                onClick: () => undefined,
              }]
            : []),
          {
            key: 'choose',
            icon: <FolderSymlink size={14} />,
            label: t('chat.input.workspace.chooseFolder'),
            onClick: () => void pickFolder(),
          },
        ],
      },
    ];

    const choices = (state?.choices ?? []).filter((c) => c.locator !== currentRoot);
    if (choices.length > 0) {
      items.push({
        key: 'recent-header',
        type: 'group' as const,
        label: t('chat.input.workspace.recentProjects'),
        children: choices.map((choice) => ({
          key: `choice-${choice.locator}`,
          label: (
            <Flexbox horizontal align="center" justify="space-between" gap={8}>
              <Flexbox style={{ minWidth: 0 }} gap={0}>
                <span
                  style={{
                    fontSize: 13,
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

    if (currentRoot) {
      items.push({ type: 'divider' });
      items.push({
        key: 'restore',
        icon: <RotateCcw size={14} />,
        label: t('chat.input.workspace.restore'),
        onClick: () => activate(null),
      });
    }

    items.push({
      key: 'permissions-header',
      type: 'group' as const,
      label: t('chat.input.workspace.permissionsGroup'),
      children: [
        {
          key: 'access-standard',
          label: menuRow(
            <ShieldCheck size={14} />,
            t('chat.input.workspace.standardShort'),
            t('chat.input.workspace.standardDesc'),
            !fullAccess,
          ),
          onClick: () => { if (fullAccess) void setFullAccess(false); },
        },
        {
          key: 'access-full',
          label: menuRow(
            <ShieldAlert size={14} />,
            t('chat.input.workspace.fullShort'),
            t('chat.input.workspace.fullDesc'),
            fullAccess,
            true,
          ),
          onClick: () => { if (!fullAccess) requestFullAccess(); },
        },
      ],
    });
    return items;
  }, [activate, currentRoot, fullAccess, menuRow, pickFolder, removeChoice, requestFullAccess, setFullAccess, state, t, token]);

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
        overlayStyle={{ borderRadius: 12, width: 320, maxWidth: 'calc(100vw - 32px)' }}
      >
        <button
          data-pt-agent-workspace-selector
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('chat.input.workspace.title')}
          title={pill.title}
          style={{
            height: 30,
            border: '1px solid transparent',
            borderRadius: 8,
            background: 'transparent',
            color: token.colorTextSecondary,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 13,
            fontWeight: 500,
            padding: '0 6px 0 8px',
            cursor: 'pointer',
            maxWidth: 220,
            ...(pill.tone === 'full'
              ? {
                  color: FULL_ACCESS_COLOR,
                  background: FULL_ACCESS_BG,
                  borderColor: FULL_ACCESS_BORDER,
                }
              : pill.tone === 'project'
                ? {
                    color: token.colorPrimary,
                    background: token.colorPrimaryBg,
                    borderColor: token.colorPrimaryBorder,
                  }
                : {}),
          }}
          onMouseEnter={(event) => {
            if (pill.tone === 'sandbox') {
              event.currentTarget.style.background = token.colorFillTertiary;
            }
          }}
          onMouseLeave={(event) => {
            if (pill.tone === 'sandbox') {
              event.currentTarget.style.background = 'transparent';
            }
          }}
        >
          {loading
            ? <Loader2 size={14} style={{ flexShrink: 0, animation: 'spin 1s linear infinite' }} />
            : <span style={{ display: 'inline-flex', flexShrink: 0 }}>{pill.icon}</span>}
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {pill.label}
          </span>
          <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.65 }} />
        </button>
      </Dropdown>
      {worktreeBase !== null && (
      <Modal
        open
        title={t('chat.input.workspace.createWorktree')}
        okText={t('chat.input.workspace.createWorktreeConfirm')}
        cancelText={t('common:common.action.cancel')}
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
      )}
    </>
  );
}

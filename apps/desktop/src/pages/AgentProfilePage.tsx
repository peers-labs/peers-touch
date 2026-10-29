import {
  lazy,
  Suspense,
  type ComponentPropsWithoutRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button, Empty as LobeEmpty, SearchBar, toast } from '@lobehub/ui';
import {
  CapabilityAvailability,
  CapabilitySourceKind,
  type AgentCapabilityBinding,
  type CapabilityManifest,
} from '../gen/proto/domain/agent/capability_pb';
import { Empty, Modal, Switch, theme } from 'antd';
import {
  ArrowLeft,
  BookOpen,
  BotOff,
  Image as ImageIcon,
  Plug,
  Plus,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { AgentIconTile } from '../components/agent/AgentIconTile';
import { AgentRail } from '../components/agent/workbench/AgentRail';
import type { Agent, AgentCreate } from '../services/desktop_api';
import { useAgentStore } from '../store/agent';
import {
  useAgentCapabilityStore,
  type AgentCapabilityState,
} from '../store/agentCapabilities';
import { openAgentChatSession } from '../utils/openAgentChatSession';
import { log } from '../utils/logger';

interface AgentProfilePageProps {
  agentName: string;
  onBack?: () => void;
  embedded?: boolean;
}

type ProfileSection = 'identity' | 'extensions';
type ExtensionKind = 'skill' | 'mcp';

interface BoundExtension {
  binding: AgentCapabilityBinding;
  manifest: CapabilityManifest;
}

const EMPTY_BINDINGS: AgentCapabilityBinding[] = [];
const AgentCapabilityRecoveryDialog = lazy(
  () => import('../components/agent/AgentCapabilityRecoveryDialog'),
);

function ProfileIconButton({
  icon: Icon,
  iconSize = 15,
  blockSize = 30,
  style,
  ...props
}: {
  icon: LucideIcon;
  iconSize?: number;
  blockSize?: number;
} & Omit<ComponentPropsWithoutRef<'button'>, 'children'>) {
  return (
    <button
      type="button"
      {...props}
      style={{
        width: blockSize,
        height: blockSize,
        padding: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 'none',
        border: 0,
        borderRadius: 6,
        background: 'transparent',
        color: 'inherit',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      <Icon aria-hidden size={iconSize} />
    </button>
  );
}
const AVATAR_EMOJIS = [
  ['😀', 'happy'],
  ['🙂', 'friendly'],
  ['😎', 'confident'],
  ['🤓', 'expert'],
  ['🧐', 'research'],
  ['🤖', 'agent'],
  ['👋', 'welcome'],
  ['✨', 'creative'],
  ['💡', 'ideas'],
  ['🎯', 'goals'],
  ['🚀', 'launch'],
  ['🧭', 'guide'],
  ['🛠️', 'builder'],
  ['🧠', 'thinking'],
  ['📚', 'knowledge'],
  ['✍️', 'writing'],
  ['🔍', 'search'],
  ['📊', 'analytics'],
  ['💬', 'chat'],
  ['✅', 'delivery'],
  ['🌱', 'growth'],
  ['🌐', 'web'],
  ['🔒', 'security'],
  ['⚡', 'speed'],
  ['🎨', 'design'],
  ['🧪', 'experiment'],
  ['📎', 'files'],
  ['🗂️', 'organize'],
  ['📅', 'calendar'],
  ['📝', 'notes'],
  ['🧩', 'integration'],
  ['🔧', 'settings'],
  ['🏗️', 'architecture'],
  ['📣', 'communication'],
  ['💻', 'coding'],
  ['🛡️', 'safety'],
  ['🪄', 'automation'],
  ['📌', 'focus'],
  ['🔭', 'exploration'],
  ['🏁', 'completion'],
] as const;

function capabilityLabel(manifest: CapabilityManifest): string {
  return (
    manifest.displayMetadata?.name.trim()
    || manifest.sourceInstanceId.trim()
    || manifest.capabilityId
  );
}

function sourceKindForExtension(kind: ExtensionKind): CapabilitySourceKind {
  return kind === 'skill' ? CapabilitySourceKind.SKILL : CapabilitySourceKind.MCP;
}

function newestBindings(bindings: AgentCapabilityBinding[]): AgentCapabilityBinding[] {
  const byCapability = new Map<string, AgentCapabilityBinding>();
  for (const binding of bindings) {
    if (binding.tombstonedAt) continue;
    const key = `${binding.capabilityId}\u0000${binding.capabilityVersion}`;
    const previous = byCapability.get(key);
    if (!previous || binding.revision > previous.revision) {
      byCapability.set(key, binding);
    }
  }
  return [...byCapability.values()];
}

function boundExtensions(
  manifests: CapabilityManifest[],
  bindings: AgentCapabilityBinding[],
  kind: ExtensionKind,
): BoundExtension[] {
  const manifestByKey = new Map(
    manifests
      .filter((manifest) => manifest.sourceKind === sourceKindForExtension(kind))
      .map((manifest) => [
        `${manifest.capabilityId}\u0000${manifest.version}`,
        manifest,
      ]),
  );
  return newestBindings(bindings)
    .flatMap((binding) => {
      const manifest = manifestByKey.get(
        `${binding.capabilityId}\u0000${binding.capabilityVersion}`,
      );
      return manifest ? [{ binding, manifest }] : [];
    })
    .sort((left, right) => (
      capabilityLabel(left.manifest).localeCompare(capabilityLabel(right.manifest))
    ));
}

function availableExtensions(
  manifests: CapabilityManifest[],
  bindings: AgentCapabilityBinding[],
  kind: ExtensionKind,
): CapabilityManifest[] {
  const boundKeys = new Set(
    newestBindings(bindings).map(
      (binding) => `${binding.capabilityId}\u0000${binding.capabilityVersion}`,
    ),
  );
  const byCapability = new Map<string, CapabilityManifest>();
  for (const manifest of manifests) {
    if (manifest.sourceKind !== sourceKindForExtension(kind)) continue;
    if (manifest.retiredAt) continue;
    if (
      manifest.availability !== CapabilityAvailability.AVAILABLE
      && manifest.availability !== CapabilityAvailability.DEGRADED
    ) continue;
    const key = `${manifest.capabilityId}\u0000${manifest.version}`;
    if (boundKeys.has(key)) continue;
    byCapability.set(manifest.capabilityId, manifest);
  }
  return [...byCapability.values()].sort((left, right) => (
    capabilityLabel(left).localeCompare(capabilityLabel(right))
  ));
}

export function AgentProfilePage({
  agentName,
  onBack,
  embedded = false,
}: AgentProfilePageProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const agents = useAgentStore((state) => state.agents);
  const setSelectedAgent = useAgentStore((state) => state.setSelectedAgent);
  const agentRosterOpen = useAgentStore((state) => state.agentRosterOpen);
  const setAgentRosterOpen = useAgentStore((state) => state.setAgentRosterOpen);
  const [profileAgentName, setProfileAgentName] = useState(agentName);
  const [inputAgentName, setInputAgentName] = useState(agentName);
  const agent = agents.find((item) => item.name === profileAgentName);
  if (inputAgentName !== agentName) {
    setInputAgentName(agentName);
    setProfileAgentName(agentName);
  }

  const selectAgentFromProfile = useCallback((nextAgent: Agent) => {
    void openAgentChatSession(nextAgent, {
      reason: 'profile-roster-switch',
      draftTitle: t('agent.sidebar.newTopic'),
    });
    onBack?.();
  }, [onBack, t]);

  const openProfile = useCallback((nextAgentName: string) => {
    setSelectedAgent(nextAgentName);
    setProfileAgentName(nextAgentName);
  }, [setSelectedAgent]);

  if (!agent) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%' }}>
        <LobeEmpty
          icon={BotOff}
          title={t('agent.profile.notFound')}
          action={
            onBack ? (
              <Button type="text" onClick={onBack}>
                {t('agent.profile.goBack')}
              </Button>
            ) : undefined
          }
        />
      </Flexbox>
    );
  }

  return (
    <Flexbox
      data-pt-agent-profile={agent.id}
      horizontal
      style={{
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        background: token.colorBgContainer,
      }}
    >
      {!embedded ? (
        <AgentRail
          collapsed={!agentRosterOpen}
          onToggle={() => setAgentRosterOpen(!agentRosterOpen)}
          onOpenProfile={openProfile}
          onSelectAgent={selectAgentFromProfile}
        />
      ) : null}
      <ProfileEditor key={agent.id} agent={agent} onBack={onBack} />
    </Flexbox>
  );
}

function ProfileEditor({ agent, onBack }: { agent: Agent; onBack?: () => void }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const updateAgentProfile = useAgentStore((state) => state.updateAgentProfile);
  const loadAgents = useAgentStore((state) => state.loadAgents);
  const saveState = useAgentStore((state) => state.saveStateByAgentId[agent.id] || 'idle');
  const setProfileDraft = useAgentStore((state) => state.setProfileDraft);
  const restoredDraft = useAgentStore.getState().profileDraftsByAgentId[agent.id];
  const [section, setSection] = useState<ProfileSection>('identity');
  const capabilityFocus = useAgentStore((state) => state.capabilityFocusByAgent[agent.name]);
  const [handledFocusRequestId, setHandledFocusRequestId] = useState<string>();
  const recoveryOpen = Boolean(
    capabilityFocus && capabilityFocus.requestId !== handledFocusRequestId,
  );
  const activeSection = recoveryOpen ? 'extensions' : section;
  const [title, setTitle] = useState(restoredDraft?.title ?? (agent.title || agent.name));
  const [description, setDescription] = useState(restoredDraft?.description ?? agent.description ?? '');
  const [soulMd, setSoulMd] = useState(restoredDraft?.soulMd ?? agent.soulMd ?? '');
  const [agentsMd, setAgentsMd] = useState(restoredDraft?.agentsMd ?? agent.agentsMd ?? '');
  const [soulDirty, setSoulDirty] = useState(restoredDraft?.soulMd !== undefined);
  const [agentsDirty, setAgentsDirty] = useState(restoredDraft?.agentsMd !== undefined);
  const [identityProjection, setIdentityProjection] = useState({
    title: agent.title || agent.name,
    description: agent.description || '',
  });
  const [documentProjection, setDocumentProjection] = useState({
    soulMd: agent.soulMd || '',
    agentsMd: agent.agentsMd || '',
  });
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const soulRef = useRef(soulMd);
  const agentsRef = useRef(agentsMd);
  const soulDirtyRef = useRef(soulDirty);
  const agentsDirtyRef = useRef(agentsDirty);
  const soulTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const agentsTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const manifests = useAgentCapabilityStore((state) => state.manifests);
  const bindings = useAgentCapabilityStore(
    (state) => state.bindingsByAgentId[agent.id] ?? EMPTY_BINDINGS,
  );
  const pendingMutations = useAgentCapabilityStore((state) => state.pendingMutations);
  const upsertBinding = useAgentCapabilityStore((state) => state.upsertBinding);
  const deleteBinding = useAgentCapabilityStore((state) => state.deleteBinding);

  const nextIdentityProjection = {
    title: agent.title || agent.name,
    description: agent.description || '',
  };
  if (
    identityProjection.title !== nextIdentityProjection.title
    || identityProjection.description !== nextIdentityProjection.description
  ) {
    setIdentityProjection(nextIdentityProjection);
    if (title === identityProjection.title) setTitle(nextIdentityProjection.title);
    if (description === identityProjection.description) {
      setDescription(nextIdentityProjection.description);
    }
  }
  const nextDocumentProjection = {
    soulMd: agent.soulMd || '',
    agentsMd: agent.agentsMd || '',
  };
  if (
    documentProjection.soulMd !== nextDocumentProjection.soulMd
    || documentProjection.agentsMd !== nextDocumentProjection.agentsMd
  ) {
    setDocumentProjection(nextDocumentProjection);
    if (!soulDirty) {
      setSoulMd(nextDocumentProjection.soulMd);
    }
    if (!agentsDirty) {
      setAgentsMd(nextDocumentProjection.agentsMd);
    }
  }

  const enqueueProfileUpdate = useCallback((
    updates: Partial<AgentCreate>,
    successMessage = true,
  ): Promise<void> => {
    setProfileDraft(agent.id, updates);
    const operation = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await updateAgentProfile(agent.id, updates);
        if (successMessage) toast.success(t('agent.profile.changesSaved'));
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : t('agent.profile.failedToSave'),
        );
        throw error;
      });
    saveQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, [agent.id, setProfileDraft, t, updateAgentProfile]);

  const saveDocument = useCallback((
    field: 'soulMd' | 'agentsMd',
    value: string,
  ) => {
    const dirtyRef = field === 'soulMd' ? soulDirtyRef : agentsDirtyRef;
    if (!dirtyRef.current) return;
    void enqueueProfileUpdate({ [field]: value }).then(() => {
      const currentValue = field === 'soulMd' ? soulRef.current : agentsRef.current;
      if (currentValue === value) {
        dirtyRef.current = false;
        if (field === 'soulMd') setSoulDirty(false);
        else setAgentsDirty(false);
      }
    }).catch(() => undefined);
  }, [enqueueProfileUpdate]);

  useEffect(() => () => {
    if (soulTimerRef.current) clearTimeout(soulTimerRef.current);
    if (agentsTimerRef.current) clearTimeout(agentsTimerRef.current);
    void saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const state = useAgentStore.getState();
        const updates = { ...state.profileDraftsByAgentId[agent.id] };
        if (Object.keys(updates).length && state.agents.some((item) => item.id === agent.id)) {
          await state.updateAgentProfile(agent.id, updates);
        }
      })
      .catch((error: unknown) => {
        log.error('agent', 'Failed to save Profile before leaving', {
          agentId: agent.id, error: String(error),
        });
        toast.error(error instanceof Error ? error.message : String(error));
      });
  }, [agent.id]);

  const saveTitle = () => {
    const value = title.trim();
    if (!value) {
      setTitle(agent.title || agent.name);
      return;
    }
    if (value !== (agent.title || agent.name)) {
      void enqueueProfileUpdate({ title: value }).catch(() => undefined);
    }
  };

  const saveDescription = () => {
    const value = description.trim();
    if (value !== (agent.description || '').trim()) {
      void enqueueProfileUpdate({ description: value }).catch(() => undefined);
    }
  };

  const changeAvatar = (avatar: string) => {
    setAvatarPickerOpen(false);
    void enqueueProfileUpdate({ avatar }).catch(() => undefined);
  };

  const mutateExtension = useCallback(async (
    extension: BoundExtension,
    enabled: boolean,
  ) => {
    const currentAgent = useAgentStore.getState().agents.find(
      (item) => item.id === agent.id,
    );
    try {
      await upsertBinding({
        bindingId: extension.binding.bindingId,
        agentId: agent.id,
        capabilityId: extension.manifest.capabilityId,
        capabilityVersion: extension.manifest.version,
        enabled,
        approvalPolicy: extension.binding.approvalPolicy,
        expectedAgentVersion: currentAgent?.version ?? agent.version,
        expectedBindingRevision: extension.binding.revision,
        idempotencyKey: crypto.randomUUID(),
      });
      await loadAgents();
      toast.success(t('agent.profile.changesSaved'));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('agent.profile.failedToSave'),
      );
    }
  }, [agent.id, agent.version, loadAgents, t, upsertBinding]);

  const removeExtension = useCallback(async (extension: BoundExtension) => {
    try {
      await deleteBinding({
        agentId: agent.id,
        bindingId: extension.binding.bindingId,
        expectedBindingRevision: extension.binding.revision,
        idempotencyKey: crypto.randomUUID(),
        reason: 'agent_profile_extension_removed',
      });
      await loadAgents();
      toast.success(t('agent.profile.extensionRemoved'));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('agent.profile.failedToSave'),
      );
    }
  }, [agent.id, deleteBinding, loadAgents, t]);

  const bindExtension = useCallback(async (manifest: CapabilityManifest) => {
    const currentAgent = useAgentStore.getState().agents.find(
      (item) => item.id === agent.id,
    );
    try {
      await upsertBinding({
        agentId: agent.id,
        capabilityId: manifest.capabilityId,
        capabilityVersion: manifest.version,
        enabled: true,
        approvalPolicy: manifest.defaultApprovalPolicy,
        expectedAgentVersion: currentAgent?.version ?? agent.version,
        expectedBindingRevision: 0n,
        idempotencyKey: crypto.randomUUID(),
      });
      await loadAgents();
      toast.success(t('agent.profile.extensionAdded'));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t('agent.profile.failedToSave'),
      );
      throw error;
    }
  }, [agent.id, agent.version, loadAgents, t, upsertBinding]);

  return (
    <main
      data-pt-agent-profile-editor
      data-pt-agent-id={agent.id}
      data-pt-agent-profile-save-state={saveState}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        overflow: 'auto',
        containerType: 'inline-size',
      }}
    >
      <style>{`
        @container (max-width: 680px) {
          [data-pt-agent-profile-content] {
            padding-inline: 16px !important;
          }
          [data-pt-agent-profile-documents] {
            grid-template-columns: minmax(0, 1fr) !important;
          }
        }
      `}</style>
      <div
        data-pt-agent-profile-content
        style={{
          width: '100%',
          maxWidth: 980,
          minHeight: '100%',
          margin: '0 auto',
          padding: '14px 32px 24px',
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 64, display: 'flex', justifyContent: 'flex-start' }}>
            <ProfileIconButton
              data-pt-agent-profile-back
              icon={ArrowLeft}
              blockSize={36}
              iconSize={16}
              title={t('agent.profile.backToAgent')}
              aria-label={t('agent.profile.backToAgent')}
              onClick={onBack}
            />
          </div>
          <input
            data-pt-agent-profile-title={agent.id}
            value={title}
            aria-label={t('agent.profile.identityTitlePlaceholder')}
            placeholder={t('agent.profile.identityTitlePlaceholder')}
            onChange={(event) => {
              setTitle(event.target.value);
              setProfileDraft(agent.id, { title: event.target.value });
            }}
            onBlur={saveTitle}
            style={{
              width: '100%',
              height: 38,
              padding: '0 8px',
              border: 0,
              outline: 'none',
              background: 'transparent',
              color: token.colorText,
              font: 'inherit',
              fontSize: 23,
              fontWeight: 750,
              letterSpacing: 0,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: 12, alignItems: 'start', marginTop: 10 }}>
          <button
            type="button"
            aria-label={t('agent.profile.changeAvatar')}
            title={t('agent.profile.changeAvatar')}
            onClick={() => setAvatarPickerOpen(true)}
            style={{
              width: 64,
              height: 64,
              padding: 0,
              border: 0,
              borderRadius: 8,
              background: 'transparent',
              cursor: 'pointer',
            }}
          >
            <AgentIconTile agent={agent} size={64} />
          </button>
          <textarea
            value={description}
            aria-label={t('agent.profile.identityDescriptionPlaceholder')}
            placeholder={t('agent.profile.identityDescriptionPlaceholder')}
            onChange={(event) => {
              setDescription(event.target.value);
              setProfileDraft(agent.id, { description: event.target.value });
            }}
            onBlur={saveDescription}
            style={{
              width: '100%',
              height: 64,
              minHeight: 64,
              maxHeight: 96,
              padding: '9px 10px',
              resize: 'vertical',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 8,
              outline: 'none',
              background: token.colorBgContainer,
              color: token.colorTextSecondary,
              font: 'inherit',
              fontSize: 13,
              lineHeight: 1.45,
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div
          role="tablist"
          aria-label={t('agent.profile.sections')}
          style={{
            marginTop: 18,
            display: 'flex',
            gap: 4,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {([
            ['identity', t('agent.profile.section.identity')],
            ['extensions', t('agent.profile.tab.extensions')],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeSection === key}
              tabIndex={activeSection === key ? 0 : -1}
              onClick={() => setSection(key)}
              style={{
                height: 38,
                padding: '0 12px',
                marginBottom: -1,
                border: 0,
                borderBottom: `2px solid ${
                  activeSection === key ? token.colorPrimary : 'transparent'
                }`,
                background: 'transparent',
                color: activeSection === key ? token.colorText : token.colorTextSecondary,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeSection === 'identity' ? (
          <div
            data-pt-agent-profile-documents
            style={{
              flex: 1,
              minHeight: 0,
              marginTop: 12,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
              gap: 12,
            }}
          >
            <DocumentEditor
              label="SOUL.md"
              value={soulMd}
              onChange={(value) => {
                setProfileDraft(agent.id, { soulMd: value });
                soulRef.current = value;
                soulDirtyRef.current = true;
                setSoulDirty(true);
                setSoulMd(value);
                if (soulTimerRef.current) clearTimeout(soulTimerRef.current);
                soulTimerRef.current = setTimeout(
                  () => saveDocument('soulMd', soulRef.current),
                  600,
                );
              }}
              onBlur={() => {
                if (soulTimerRef.current) clearTimeout(soulTimerRef.current);
                saveDocument('soulMd', soulRef.current);
              }}
            />
            <DocumentEditor
              label="AGENTS.md"
              value={agentsMd}
              onChange={(value) => {
                setProfileDraft(agent.id, { agentsMd: value });
                agentsRef.current = value;
                agentsDirtyRef.current = true;
                setAgentsDirty(true);
                setAgentsMd(value);
                if (agentsTimerRef.current) clearTimeout(agentsTimerRef.current);
                agentsTimerRef.current = setTimeout(
                  () => saveDocument('agentsMd', agentsRef.current),
                  600,
                );
              }}
              onBlur={() => {
                if (agentsTimerRef.current) clearTimeout(agentsTimerRef.current);
                saveDocument('agentsMd', agentsRef.current);
              }}
            />
          </div>
        ) : (
          <ExtensionsPanel
            agentId={agent.id}
            bindings={bindings}
            manifests={manifests}
            pendingMutations={pendingMutations}
            onBind={bindExtension}
            onRemove={removeExtension}
            onToggle={mutateExtension}
          />
        )}
      </div>
      {avatarPickerOpen ? (
        <AvatarPicker
          avatar={agent.avatar}
          name={title || agent.name}
          onClose={() => setAvatarPickerOpen(false)}
          onChange={changeAvatar}
        />
      ) : null}
      {recoveryOpen && capabilityFocus ? (
        <Suspense fallback={null}>
          <AgentCapabilityRecoveryDialog
            agent={agent}
            {...capabilityFocus}
            onClose={() => {
              setHandledFocusRequestId(capabilityFocus.requestId);
              setSection('extensions');
            }}
          />
        </Suspense>
      ) : null}
    </main>
  );
}

function DocumentEditor({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <section
      style={{
        minHeight: 320,
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 38,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          color: token.colorText,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <textarea
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        style={{
          flex: 1,
          width: '100%',
          minHeight: 280,
          padding: '12px 14px',
          resize: 'none',
          border: 0,
          outline: 'none',
          background: token.colorBgContainer,
          color: token.colorText,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 13,
          lineHeight: 1.65,
          boxSizing: 'border-box',
        }}
      />
    </section>
  );
}

function ExtensionsPanel({
  agentId,
  bindings,
  manifests,
  pendingMutations,
  onBind,
  onRemove,
  onToggle,
}: {
  agentId: string;
  bindings: AgentCapabilityBinding[];
  manifests: CapabilityManifest[];
  pendingMutations: AgentCapabilityState['pendingMutations'];
  onBind: (manifest: CapabilityManifest) => Promise<void>;
  onRemove: (extension: BoundExtension) => Promise<void>;
  onToggle: (extension: BoundExtension, enabled: boolean) => Promise<void>;
}) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [pickerKind, setPickerKind] = useState<ExtensionKind | null>(null);
  const groups: Array<{
    kind: ExtensionKind;
    icon: LucideIcon;
    label: string;
    addLabel: string;
    emptyLabel: string;
  }> = [
    {
      kind: 'skill',
      icon: BookOpen,
      label: t('agent.profile.extensions.skills'),
      addLabel: t('agent.profile.extensions.addSkill'),
      emptyLabel: t('agent.profile.extensions.noSkills'),
    },
    {
      kind: 'mcp',
      icon: Plug,
      label: t('agent.profile.extensions.mcp'),
      addLabel: t('agent.profile.extensions.addMcp'),
      emptyLabel: t('agent.profile.extensions.noMcp'),
    },
  ];

  return (
    <div style={{ marginTop: 12 }}>
      {groups.map((group) => {
        const extensions = boundExtensions(manifests, bindings, group.kind);
        const Icon = group.icon;
        return (
          <section
            key={group.kind}
            aria-label={group.label}
            style={{
              padding: '12px 0 16px',
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Flexbox horizontal align="center" gap={8} style={{ minHeight: 34 }}>
              <Icon size={15} color={token.colorTextSecondary} />
              <strong style={{ color: token.colorText, fontSize: 13 }}>
                {group.label}
              </strong>
              <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
                {extensions.length}
              </span>
              <ProfileIconButton
                data-pt-agent-extension-add={group.kind}
                icon={Plus}
                title={group.addLabel}
                aria-label={group.addLabel}
                onClick={() => setPickerKind(group.kind)}
                style={{ marginLeft: 'auto' }}
              />
            </Flexbox>
            {extensions.length === 0 ? (
              <div
                style={{
                  padding: '8px 0 2px 23px',
                  color: token.colorTextTertiary,
                  fontSize: 12,
                }}
              >
                {group.emptyLabel}
              </div>
            ) : (
              <Flexbox gap={4} style={{ marginTop: 6 }}>
                {extensions.map((extension) => {
                  const mutationPending = Boolean(
                    pendingMutations[
                      `upsert:${agentId}:${extension.manifest.capabilityId}`
                    ]
                    || pendingMutations[
                      `delete:${agentId}:${extension.binding.bindingId}`
                    ],
                  );
                  return (
                    <Flexbox
                      data-pt-agent-extension={extension.manifest.capabilityId}
                      key={extension.binding.bindingId}
                      horizontal
                      align="center"
                      gap={10}
                      style={{
                        minHeight: 52,
                        padding: '6px 8px',
                        borderRadius: 7,
                        background: token.colorFillQuaternary,
                      }}
                    >
                      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: token.colorText,
                            fontSize: 13,
                            fontWeight: 600,
                          }}
                        >
                          {capabilityLabel(extension.manifest)}
                        </span>
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: token.colorTextTertiary,
                            fontSize: 11,
                          }}
                        >
                          {extension.manifest.displayMetadata?.description}
                        </span>
                      </Flexbox>
                      <Switch
                        size="small"
                        checked={extension.binding.enabled}
                        loading={mutationPending}
                        disabled={mutationPending}
                        aria-label={t('agent.profile.extensions.toggle', {
                          name: capabilityLabel(extension.manifest),
                        })}
                        onChange={(enabled) => void onToggle(extension, enabled)}
                      />
                      <ProfileIconButton
                        data-pt-agent-extension-remove={extension.manifest.capabilityId}
                        icon={Trash2}
                        iconSize={14}
                        disabled={mutationPending}
                        title={t('agent.profile.extensions.remove', {
                          name: capabilityLabel(extension.manifest),
                        })}
                        aria-label={t('agent.profile.extensions.remove', {
                          name: capabilityLabel(extension.manifest),
                        })}
                        onClick={() => void onRemove(extension)}
                      />
                    </Flexbox>
                  );
                })}
              </Flexbox>
            )}
          </section>
        );
      })}
      {pickerKind ? (
        <ExtensionPicker
          key={pickerKind}
          kind={pickerKind}
          manifests={availableExtensions(manifests, bindings, pickerKind)}
          onBind={onBind}
          onClose={() => setPickerKind(null)}
        />
      ) : null}
    </div>
  );
}

function ExtensionPicker({
  kind,
  manifests,
  onBind,
  onClose,
}: {
  kind: ExtensionKind;
  manifests: CapabilityManifest[];
  onBind: (manifest: CapabilityManifest) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(12);
  const [bindingId, setBindingId] = useState('');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return manifests;
    return manifests.filter((manifest) => (
      capabilityLabel(manifest).toLowerCase().includes(normalized)
      || manifest.displayMetadata?.description.toLowerCase().includes(normalized)
    ));
  }, [manifests, query]);

  return (
    <Modal
      centered
      destroyOnHidden
      footer={null}
      open
      title={kind === 'skill'
        ? t('agent.profile.extensions.addSkill')
        : t('agent.profile.extensions.addMcp')}
      width={520}
      onCancel={bindingId ? undefined : onClose}
    >
      <Flexbox gap={12}>
        <SearchBar
          autoFocus
          allowClear
          value={query}
          placeholder={t('agent.profile.extensions.search')}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(12);
          }}
        />
        <Flexbox gap={4} style={{ maxHeight: 420, overflowY: 'auto' }}>
          {filtered.slice(0, limit).map((manifest) => (
            <button
              key={`${manifest.capabilityId}:${manifest.version}`}
              type="button"
              disabled={Boolean(bindingId)}
              onClick={() => {
                setBindingId(manifest.capabilityId);
                void onBind(manifest)
                  .then(onClose)
                  .catch(() => setBindingId(''));
              }}
              style={{
                width: '100%',
                minHeight: 54,
                padding: '7px 9px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                border: 0,
                borderRadius: 7,
                background: bindingId === manifest.capabilityId
                  ? token.colorPrimaryBg
                  : 'transparent',
                color: token.colorText,
                cursor: bindingId ? 'wait' : 'pointer',
                textAlign: 'left',
              }}
            >
              {kind === 'skill' ? <BookOpen size={15} /> : <Plug size={15} />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <strong
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 13,
                  }}
                >
                  {capabilityLabel(manifest)}
                </strong>
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: token.colorTextTertiary,
                    fontSize: 11,
                  }}
                >
                  {manifest.displayMetadata?.description}
                </span>
              </span>
              <Plus size={14} color={token.colorPrimary} />
            </button>
          ))}
          {filtered.length === 0 ? (
            <Empty
              description={t('agent.profile.extensions.noMatches')}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : null}
        </Flexbox>
        {limit < filtered.length ? (
          <Button
            type="text"
            onClick={() => setLimit((current) => current + 12)}
          >
            {t('agent.profile.extensions.showMore')}
          </Button>
        ) : null}
      </Flexbox>
    </Modal>
  );
}

function AvatarPicker({
  avatar,
  name,
  onClose,
  onChange,
}: {
  avatar: string;
  name: string;
  onClose: () => void;
  onChange: (avatar: string) => void;
}) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [tab, setTab] = useState<'emoji' | 'upload'>('emoji');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const normalized = query.trim().toLowerCase();
  const emojis = AVATAR_EMOJIS.filter(([emoji, label]) => (
    !normalized || emoji.includes(normalized) || label.includes(normalized)
  ));

  const chooseFile = (file?: File) => {
    setError('');
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      setError(t('agent.profile.avatar.invalidType'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError(t('agent.profile.avatar.tooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPreview(reader.result);
    };
    reader.onerror = () => setError(t('agent.profile.avatar.readFailed'));
    reader.readAsDataURL(file);
  };

  return (
    <Modal
      centered
      destroyOnHidden
      footer={null}
      open
      title={t('agent.profile.changeAvatar')}
      width={420}
      onCancel={onClose}
    >
      <Flexbox gap={12}>
        <div
          role="tablist"
          aria-label={t('agent.profile.avatar.source')}
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {([
            ['emoji', t('agent.profile.avatar.emoji')],
            ['upload', t('agent.profile.avatar.upload')],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              style={{
                height: 34,
                padding: '0 10px',
                marginBottom: -1,
                border: 0,
                borderBottom: `2px solid ${
                  tab === key ? token.colorPrimary : 'transparent'
                }`,
                background: 'transparent',
                color: tab === key ? token.colorText : token.colorTextSecondary,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'emoji' ? (
          <>
            <SearchBar
              autoFocus
              allowClear
              value={query}
              placeholder={t('agent.profile.avatar.search')}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
                gap: 4,
              }}
            >
              {emojis.map(([emoji]) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={t('agent.profile.avatar.useEmoji', { emoji })}
                  onClick={() => onChange(emoji)}
                  style={{
                    width: 40,
                    height: 40,
                    border: 0,
                    borderRadius: 7,
                    background: avatar === emoji
                      ? token.colorPrimaryBg
                      : token.colorFillQuaternary,
                    cursor: 'pointer',
                    fontSize: 20,
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        ) : (
          <Flexbox align="center" gap={10}>
            <input
              ref={fileRef}
              hidden
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(event) => chooseFile(event.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{
                width: 112,
                height: 112,
                padding: 0,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 8,
                background: token.colorFillQuaternary,
                color: token.colorTextSecondary,
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              {preview ? (
                <img
                  src={preview}
                  alt={t('agent.profile.avatar.preview', { name })}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <Flexbox align="center" gap={6}>
                  <ImageIcon size={26} />
                  <span style={{ fontSize: 12 }}>
                    {t('agent.profile.avatar.choose')}
                  </span>
                </Flexbox>
              )}
            </button>
            <Button
              icon={<Upload size={14} />}
              onClick={() => fileRef.current?.click()}
            >
              {t('agent.profile.avatar.choose')}
            </Button>
            <span style={{ color: token.colorTextTertiary, fontSize: 11 }}>
              {t('agent.profile.avatar.requirements')}
            </span>
            {error ? (
              <span role="alert" style={{ color: token.colorError, fontSize: 12 }}>
                {error}
              </span>
            ) : null}
            <Flexbox horizontal gap={8}>
              <Button type="text" onClick={onClose}>
                {t('agent.profile.avatar.cancel')}
              </Button>
              <Button
                type="primary"
                disabled={!preview}
                onClick={() => preview && onChange(preview)}
              >
                {t('agent.profile.avatar.save')}
              </Button>
            </Flexbox>
          </Flexbox>
        )}
      </Flexbox>
    </Modal>
  );
}

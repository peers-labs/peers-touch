import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from '@bufbuild/protobuf';
import { Flexbox } from 'react-layout-kit';
import { SearchBar } from '@lobehub/ui';
import {
  theme,
  Empty,
  Input,
  message as antMessage,
  Select,
  InputNumber,
} from 'antd';
import { Tag, Button, ActionIcon } from '@lobehub/ui';
import {
  Settings2,
  ArrowLeft,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Bot,
  Brain,
  FolderOpen,
  Cpu,
  Wrench,
  Sparkles,
  Activity,
  Clock3,
  Search,
  Plus,
  Workflow,
  FileText,
  Globe,
  X,
  BookOpen,
} from 'lucide-react';
import { useAgentStore } from '../store/agent';
import {
  extractMessageArtifacts,
  useChatStore,
  type ChatMessage,
  type DelegationTaskInfo,
  type ToolCallInfo,
} from '../store/chat';
import {
  api,
  executeAgentTurn,
  type Agent,
  type Memory,
  parseAgentChatConfig,
} from '../services/desktop_api';
import {
  CapabilityReadinessState,
  CapabilitySourceKind,
  CreateKnowledgeResourceDescriptorRequestSchema,
  KnowledgeResourceAvailability,
  KnowledgeResourceKind,
  TombstoneKnowledgeResourceDescriptorRequestSchema,
  type AgentCapabilityBinding,
  type CapabilityManifest,
  type CapabilityReadiness,
  type KnowledgeResourceDescriptor,
} from '../gen/proto/domain/agent/capability_pb';
import { ModelSelect } from '../components/ModelSelect';
import { AgentSettingsModal } from '../components/AgentSettingsModal';
import { BuilderPanel } from '../components/BuilderPanel';
import { AgentIconTile } from '../components/agent/AgentIconTile';
import {
  selectAgentCapabilityBindingsBySource,
  selectAgentCapabilityReadinessBySource,
  selectCapabilityManifestsBySource,
  selectKnowledgeResourceDescriptors,
  useAgentCapabilityStore,
  type AgentCapabilityState,
} from '../store/agentCapabilities';
import { AgentConnectorsPanel } from '../components/agent/AgentConnectorsPanel';
import { EVENT, eventBus } from '../kernel/events';
import { openAgentChatSession } from '../utils/openAgentChatSession';
import type { AgentTurnStreamEventPayload } from '../kernel/events/types';
import {
  DelegationStatus,
  TurnStatus,
  type TurnTraceEntry,
} from '../gen/proto/domain/agent/agent_pb';

interface AgentProfilePageProps {
  agentName: string;
  onBack?: () => void;
  onOpenOrchestration?: () => void;
  embedded?: boolean;
}


// ── Tab: Memories ────────────────────────────────────────────────────

const LAYERS = ['identity', 'context', 'experience', 'preference', 'activity'];
const LAYER_COLORS: Record<string, string> = {
  identity: 'blue',
  context: 'cyan',
  experience: 'green',
  preference: 'orange',
  activity: 'purple',
};

function MemoryTab({ agentName, agentId }: { agentName: string; agentId: string }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLayer, setSelectedLayer] = useState<string>('');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setLoading(true);
    setLoadError('');
    Promise.all([
      api.listMemories({ agent_id: agentId, page_size: 50 }).catch(() => ({ memories: [] })),
      api.listMemories({ agent_id: agentName, page_size: 50 }).catch(() => ({ memories: [] })),
    ])
      .then(([byID, byName]) => {
        const byIDResult = byID as { memories?: Memory[] };
        const byNameResult = byName as { memories?: Memory[] };
        const byIDMemories = byIDResult?.memories || (byID as unknown as Memory[]) || [];
        const byNameMemories = byNameResult?.memories || (byName as unknown as Memory[]) || [];
        const merged = [...byIDMemories, ...byNameMemories];
        const dedup = new Map<string, Memory>();
        for (const m of merged) dedup.set(m.id, m);
        setMemories(Array.from(dedup.values()));
      })
      .catch((err: unknown) => {
        setMemories([]);
        const message = err instanceof Error ? err.message : t('agent.memory.loadFailed');
        setLoadError(message);
      })
      .finally(() => setLoading(false));
  }, [agentName, agentId]);

  const filteredMemories = useMemo(() => {
    if (!selectedLayer) return memories;
    return memories.filter((m) => m.layer === selectedLayer);
  }, [memories, selectedLayer]);

  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of memories) {
      counts[m.layer] = (counts[m.layer] || 0) + 1;
    }
    return counts;
  }, [memories]);

  if (loading) {
    return (
      <Flexbox style={{ flex: 1, padding: 2 }}>
        <span style={{ fontSize: 13, color: token.colorTextDescription, padding: '16px 0' }}>
          {t('agent.memory.loading')}
        </span>
      </Flexbox>
    );
  }

  return (
    <Flexbox style={{ flex: 1, padding: 2 }}>
      <Flexbox horizontal gap={4} style={{ flexShrink: 0, flexWrap: 'wrap', paddingBottom: 8 }}>
        <Tag
          style={{ cursor: 'pointer' }}
          color={!selectedLayer ? 'blue' : undefined}
          onClick={() => setSelectedLayer('')}
        >
          {t('agent.memory.all')} ({memories.length})
        </Tag>
        {LAYERS.map((l) => (
          <Tag
            key={l}
            style={{ cursor: 'pointer' }}
            color={selectedLayer === l ? LAYER_COLORS[l] : undefined}
            onClick={() => setSelectedLayer(selectedLayer === l ? '' : l)}
          >
            {l} ({layerCounts[l] || 0})
          </Tag>
        ))}
      </Flexbox>
      <Flexbox style={{ flex: 1, overflow: 'auto' }}>
        {filteredMemories.length === 0 ? (
          <Flexbox gap={6} style={{ padding: '12px 0' }}>
            <span style={{ fontSize: 13, color: token.colorTextDescription }}>
              {loadError
                ? loadError
                : memories.length === 0
                ? t('agent.memory.noMemories')
                : t('agent.memory.noMemoriesInLayer')}
            </span>
          </Flexbox>
        ) : (
          <Flexbox gap={6}>
            {filteredMemories.map((m) => (
              <Flexbox
                key={m.id}
                gap={4}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                }}
              >
                <Flexbox horizontal align="center" gap={6}>
                  <Tag color={LAYER_COLORS[m.layer]} style={{ margin: 0, fontSize: 11 }}>
                    {m.layer}
                  </Tag>
                  {m.access_count > 0 && (
                    <span style={{ fontSize: 11, color: token.colorTextDescription }}>
                      {t('agent.memory.accessCount', { count: m.access_count })}
                    </span>
                  )}
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 11,
                      color: token.colorTextQuaternary,
                    }}
                  >
                    {new Date(m.created_at).toLocaleDateString()}
                  </span>
                </Flexbox>
                <span style={{ fontSize: 13, color: token.colorText, lineHeight: 1.5 }}>
                  {m.summary || JSON.stringify(m.content)}
                </span>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
}

// ── Main Agent Profile Page ─────────────────────────────────────────

type ProfileTab = 'soul' | 'capabilities' | 'workspace' | 'tasks' | 'memories' | 'events';

const TAB_KEYS: { key: ProfileTab; labelKey: string; icon: ReactNode }[] = [
  { key: 'soul', labelKey: 'agent.profile.tab.prompt', icon: null },
  { key: 'capabilities', labelKey: 'agent.profile.tab.capabilities', icon: <Wrench size={13} /> },
  { key: 'workspace', labelKey: 'agent.profile.tab.runtime', icon: <FolderOpen size={13} /> },
];

const ACTIVITY_TAB_KEYS: { key: ProfileTab; labelKey: string; icon: ReactNode }[] = [
  { key: 'tasks', labelKey: 'agent.profile.tab.activity', icon: <Clock3 size={13} /> },
  { key: 'memories', labelKey: 'agent.profile.tab.memory', icon: <Brain size={13} /> },
  { key: 'events', labelKey: 'agent.profile.tab.diagnostics', icon: <Activity size={13} /> },
];


function AgentWorkbenchHero({
  agent,
  onBack,
  onOpenSettings,
  onTitleBlur,
  onDescriptionBlur,
  onRewriteDescription,
  onAvatarChange,
  descriptionGenerating,
}: {
  agent: Agent;
  onBack?: () => void;
  onOpenSettings: () => void;
  onTitleBlur: (value: string) => void;
  onDescriptionBlur: (value: string) => void;
  onRewriteDescription: () => void;
  onAvatarChange?: (emoji: string) => void;
  descriptionGenerating: boolean;
}) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [title, setTitle] = useState(agent.title || agent.name);
  const [description, setDescription] = useState(agent.description || '');
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const titleRef = useRef(title);
  const descriptionRef = useRef(description);

  useEffect(() => {
    const nextTitle = agent.title || agent.name;
    const nextDescription = agent.description || '';
    titleRef.current = nextTitle;
    descriptionRef.current = nextDescription;
    setTitle(nextTitle);
    setDescription(nextDescription);
  }, [agent.id, agent.name, agent.title, agent.description]);

  return (
    <Flexbox
      gap={12}
      style={{
        paddingTop: 10,
        flexShrink: 0,
        color: token.colorText,
      }}
    >
      <Flexbox horizontal align="center" justify="space-between" gap={16} style={{ minWidth: 0 }}>
        <input
          value={title}
          onChange={(event) => {
            titleRef.current = event.target.value;
            setTitle(event.target.value);
          }}
          onInput={(event) => {
            titleRef.current = event.currentTarget.value;
          }}
          onBlur={(event) => onTitleBlur(titleRef.current || event.currentTarget.value)}
          placeholder={t('agent.profile.identityTitlePlaceholder')}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: 'none',
            background: 'transparent',
            color: token.colorText,
            fontSize: 24,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: -0.3,
            padding: 0,
          }}
        />
        <Flexbox horizontal align="center" gap={8} style={{ flexShrink: 0 }}>
          <ActionIcon
            icon={Settings2}
            title={t('agent.profile.editSettings')}
            size={{ blockSize: 32, size: 16 }}
            onClick={onOpenSettings}
            style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, background: token.colorBgContainer }}
          />
          <ActionIcon
            data-pt-agent-profile-back
            icon={ArrowLeft}
            title={t('agent.profile.backToAgent')}
            aria-label={t('agent.profile.backToAgent')}
            size={{ blockSize: 32, size: 16 }}
            onClick={onBack}
            style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 8, background: token.colorBgContainer }}
          />
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal align="flex-start" gap={14} style={{ minWidth: 0 }}>
        <div style={{ position: 'relative' }}>
          <AgentIconTile agent={agent} size={64} onClick={() => setEmojiPickerOpen((o) => !o)} />
          {emojiPickerOpen && (
            <div
              style={{
                position: 'absolute',
                top: 68,
                left: 0,
                zIndex: 100,
                background: token.colorBgElevated,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 12,
                padding: 8,
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: 4,
                boxShadow: token.boxShadowSecondary,
              }}
            >
              {['🤖', '💻', '🧑‍💻', '🧠', '🎯', '🚀', '⚡', '🔬', '📊', '🎨', '🛠️', '📝', '🌐', '🔐', '💡', '🤝', '🎓', '🏗️'].map(
                (e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      onAvatarChange?.(e);
                      setEmojiPickerOpen(false);
                    }}
                    style={{
                      width: 32,
                      height: 32,
                      border: 0,
                      borderRadius: 6,
                      background: agent.avatar === e ? token.colorPrimaryBg : 'transparent',
                      fontSize: 18,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {e}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <textarea
            value={description}
            onChange={(event) => {
              descriptionRef.current = event.target.value;
              setDescription(event.target.value);
            }}
            onInput={(event) => {
              descriptionRef.current = event.currentTarget.value;
            }}
            onBlur={(event) => onDescriptionBlur(descriptionRef.current || event.currentTarget.value)}
            rows={3}
            placeholder={t('agent.profile.identityDescriptionPlaceholder')}
            style={{
              width: '100%',
              minHeight: 64,
              maxHeight: 108,
              resize: 'vertical',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 12,
              outline: 'none',
              background: token.colorBgContainer,
              color: token.colorTextSecondary,
              fontFamily: 'inherit',
              fontSize: 13,
              lineHeight: 1.45,
              padding: '9px 38px 9px 10px',
              boxSizing: 'border-box',
            }}
          />
          <button
            type="button"
            title={t('agent.descriptionRewrite.generate')}
            onClick={onRewriteDescription}
            disabled={descriptionGenerating}
            style={{
              position: 'absolute',
              right: 8,
              bottom: 10,
              width: 26,
              height: 26,
              border: 0,
              borderRadius: 8,
              background: token.colorPrimaryBg,
              color: descriptionGenerating ? token.colorTextQuaternary : token.colorPrimary,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: descriptionGenerating ? 'not-allowed' : 'pointer',
            }}
          >
            <Sparkles size={14} />
          </button>
        </div>
      </Flexbox>
    </Flexbox>
  );
}

function ProfileCard({
  title,
  description,
  children,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      gap={10}
      style={{
        padding: 14,
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <Flexbox horizontal align="flex-start" justify="space-between" gap={12}>
        <Flexbox gap={2}>
          <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{title}</span>
          {description && (
            <span style={{ fontSize: 12, color: token.colorTextDescription }}>{description}</span>
          )}
        </Flexbox>
        {action}
      </Flexbox>
      {children}
    </Flexbox>
  );
}

function InfoRow({ label, value }: { label: string; value?: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flexbox horizontal align="center" justify="space-between" gap={12}>
      <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{label}</span>
      <span style={{ minWidth: 0, fontSize: 12, color: token.colorText, textAlign: 'right' }}>
        {value}
      </span>
    </Flexbox>
  );
}

interface CapabilitySourceProjection {
  manifests: CapabilityManifest[];
  bindings: AgentCapabilityBinding[];
  readiness: CapabilityReadiness[];
}

interface BoundCapabilityProjection {
  manifest: CapabilityManifest;
  binding: AgentCapabilityBinding;
  readiness?: CapabilityReadiness;
}

interface BoundKnowledgeProjection extends BoundCapabilityProjection {
  descriptor: KnowledgeResourceDescriptor;
}

interface ProfileCapabilityProjection {
  tools: CapabilitySourceProjection;
  mcp: CapabilitySourceProjection;
  skills: CapabilitySourceProjection;
  knowledge: CapabilitySourceProjection;
  knowledgeDescriptors: KnowledgeResourceDescriptor[];
  pendingMutations: AgentCapabilityState['pendingMutations'];
  upsertBinding: AgentCapabilityState['upsertBinding'];
  deleteBinding: AgentCapabilityState['deleteBinding'];
  createKnowledgeDescriptor: AgentCapabilityState['createKnowledgeDescriptor'];
  tombstoneKnowledgeDescriptor: AgentCapabilityState['tombstoneKnowledgeDescriptor'];
}

const EMPTY_CAPABILITY_BINDINGS: AgentCapabilityBinding[] = [];

function createProfileCapabilitySelector(agentId: string) {
  let manifestsReference: CapabilityManifest[] | undefined;
  let knowledgeDescriptorsReference: KnowledgeResourceDescriptor[] | undefined;
  let bindingsReference: AgentCapabilityBinding[] | undefined;
  let readinessReference: AgentCapabilityState['readinessByAgentId'][string];
  let pendingMutationsReference: AgentCapabilityState['pendingMutations'] | undefined;
  let projection: ProfileCapabilityProjection | undefined;

  return (state: AgentCapabilityState): ProfileCapabilityProjection => {
    const bindings = state.bindingsByAgentId[agentId] ?? EMPTY_CAPABILITY_BINDINGS;
    const readiness = state.readinessByAgentId[agentId];
    if (
      projection
      && manifestsReference === state.manifests
      && knowledgeDescriptorsReference === state.knowledgeDescriptors
      && bindingsReference === bindings
      && readinessReference === readiness
      && pendingMutationsReference === state.pendingMutations
    ) {
      return projection;
    }

    const source = (sourceKind: CapabilitySourceKind): CapabilitySourceProjection => ({
      manifests: selectCapabilityManifestsBySource(state, sourceKind),
      bindings: selectAgentCapabilityBindingsBySource(state, agentId, sourceKind),
      readiness: selectAgentCapabilityReadinessBySource(state, agentId, sourceKind),
    });
    const builtinTools = source(CapabilitySourceKind.BUILTIN_TOOL);
    const clientTools = source(CapabilitySourceKind.CLIENT_NATIVE);
    manifestsReference = state.manifests;
    knowledgeDescriptorsReference = state.knowledgeDescriptors;
    bindingsReference = bindings;
    readinessReference = readiness;
    pendingMutationsReference = state.pendingMutations;
    projection = {
      tools: {
        manifests: [...builtinTools.manifests, ...clientTools.manifests],
        bindings: [...builtinTools.bindings, ...clientTools.bindings],
        readiness: [...builtinTools.readiness, ...clientTools.readiness],
      },
      mcp: source(CapabilitySourceKind.MCP),
      skills: source(CapabilitySourceKind.SKILL),
      knowledge: source(CapabilitySourceKind.KNOWLEDGE),
      knowledgeDescriptors: selectKnowledgeResourceDescriptors(state),
      pendingMutations: state.pendingMutations,
      upsertBinding: state.upsertBinding,
      deleteBinding: state.deleteBinding,
      createKnowledgeDescriptor: state.createKnowledgeDescriptor,
      tombstoneKnowledgeDescriptor: state.tombstoneKnowledgeDescriptor,
    };
    return projection;
  };
}

function capabilityManifestKey(capabilityId: string, version: string): string {
  return `${capabilityId}\u0000${version}`;
}

function enabledCapabilityBindings(
  bindings: AgentCapabilityBinding[],
): AgentCapabilityBinding[] {
  return bindings.filter((binding) => binding.enabled && !binding.tombstonedAt);
}

function manifestForBinding(
  manifests: CapabilityManifest[],
  binding: AgentCapabilityBinding,
): CapabilityManifest | undefined {
  return manifests.find(
    (manifest) =>
      manifest.capabilityId === binding.capabilityId
      && manifest.version === binding.capabilityVersion,
  );
}

function readinessForBinding(
  readiness: CapabilityReadiness[],
  binding: AgentCapabilityBinding,
): CapabilityReadiness | undefined {
  return readiness.find(
    (item) =>
      item.bindingId === binding.bindingId
      && item.bindingRevision === binding.revision,
  );
}

function boundCapabilityProjections(
  source: CapabilitySourceProjection,
): BoundCapabilityProjection[] {
  return enabledCapabilityBindings(source.bindings).flatMap((binding) => {
    const manifest = manifestForBinding(source.manifests, binding);
    if (!manifest) return [];
    return [{
      manifest,
      binding,
      readiness: readinessForBinding(source.readiness, binding),
    }];
  });
}

export function boundKnowledgeProjections(
  source: CapabilitySourceProjection,
  descriptors: KnowledgeResourceDescriptor[],
): BoundKnowledgeProjection[] {
  const descriptorsById = new Map(
    descriptors.map((descriptor) => [descriptor.resourceId, descriptor]),
  );
  return source.bindings
    .filter((binding) => !binding.tombstonedAt)
    .flatMap((binding) => {
      const manifest = manifestForBinding(source.manifests, binding);
      const descriptor = manifest
        ? descriptorsById.get(manifest.sourceInstanceId)
        : undefined;
      if (!manifest || !descriptor || descriptor.tombstonedAt) return [];
      return [{
        descriptor,
        manifest,
        binding,
        readiness: readinessForBinding(source.readiness, binding),
      }];
    });
}

type KnowledgeCapabilityActions = Pick<
  AgentCapabilityState,
  | 'createKnowledgeDescriptor'
  | 'upsertBinding'
  | 'deleteBinding'
  | 'tombstoneKnowledgeDescriptor'
>;

export async function bindStationKnowledgeDocument(
  actions: KnowledgeCapabilityActions,
  input: {
    agentId: string;
    expectedAgentVersion: number | bigint;
    title: string;
    content: string;
    idempotencyKey: () => string;
    resolveManifest: (
      descriptor: KnowledgeResourceDescriptor,
    ) => CapabilityManifest | undefined;
  },
): Promise<void> {
  const descriptor = await actions.createKnowledgeDescriptor(create(
    CreateKnowledgeResourceDescriptorRequestSchema,
    {
      resourceKind: KnowledgeResourceKind.DOCUMENT,
      source: {
        case: 'stationContent',
        value: new TextEncoder().encode(input.content),
      },
      idempotencyKey: input.idempotencyKey(),
      title: input.title,
    },
  ));
  const manifest = input.resolveManifest(descriptor);
  if (!manifest) {
    throw new Error('agent.profile.knowledge.manifestMissing');
  }
  await actions.upsertBinding({
    agentId: input.agentId,
    capabilityId: manifest.capabilityId,
    capabilityVersion: manifest.version,
    enabled: true,
    approvalPolicy: manifest.defaultApprovalPolicy,
    expectedAgentVersion: input.expectedAgentVersion,
    expectedBindingRevision: 0n,
    idempotencyKey: input.idempotencyKey(),
  });
}

export async function setKnowledgeBindingEnabled(
  actions: KnowledgeCapabilityActions,
  agentVersion: number | bigint,
  binding: AgentCapabilityBinding,
  enabled: boolean,
  idempotencyKey: string,
): Promise<void> {
  await actions.upsertBinding({
    bindingId: binding.bindingId,
    agentId: binding.agentId,
    capabilityId: binding.capabilityId,
    capabilityVersion: binding.capabilityVersion,
    enabled,
    approvalPolicy: binding.approvalPolicy,
    expectedAgentVersion: agentVersion,
    expectedBindingRevision: binding.revision,
    idempotencyKey,
  });
}

export async function removeOwnedKnowledgeResource(
  actions: KnowledgeCapabilityActions,
  descriptor: KnowledgeResourceDescriptor,
  binding: AgentCapabilityBinding,
  idempotencyKey: () => string,
): Promise<void> {
  await actions.deleteBinding({
    agentId: binding.agentId,
    bindingId: binding.bindingId,
    expectedBindingRevision: binding.revision,
    idempotencyKey: idempotencyKey(),
    reason: 'agent_profile_knowledge_unbound',
  });
  await actions.tombstoneKnowledgeDescriptor(create(
    TombstoneKnowledgeResourceDescriptorRequestSchema,
    {
      resourceId: descriptor.resourceId,
      expectedRevision: descriptor.revision,
      idempotencyKey: idempotencyKey(),
      reason: 'agent_profile_knowledge_removed',
    },
  ));
}

function capabilityLabel(manifest: CapabilityManifest): string {
  return (
    manifest.displayMetadata?.name.trim()
    || manifest.sourceInstanceId.trim()
    || manifest.capabilityId
  );
}

function CapabilityReadinessTag({
  readiness,
}: {
  readiness?: CapabilityReadiness;
}) {
  const { t } = useTranslation('agent');
  const state = readiness?.state ?? CapabilityReadinessState.UNKNOWN;
  if (state === CapabilityReadinessState.READY) {
    return <Tag color="success" style={{ margin: 0 }}>{t('agent.profile.enabled')}</Tag>;
  }
  if (state === CapabilityReadinessState.DEGRADED) {
    return <Tag color="warning" style={{ margin: 0 }}>{t('agent.profile.degradation.partial')}</Tag>;
  }
  if (
    state === CapabilityReadinessState.UNAVAILABLE
    || state === CapabilityReadinessState.BLOCKED
  ) {
    return <Tag color="error" style={{ margin: 0 }}>{t('agent.profile.degradation.unavailable')}</Tag>;
  }
  return <Tag style={{ margin: 0 }}>{t('agent.profile.unknown')}</Tag>;
}

function knowledgeResourceKindKey(
  kind: KnowledgeResourceKind,
): 'document' | 'folder' | 'project' | 'url' | 'notebook' | 'workspace' | 'unknown' {
  switch (kind) {
    case KnowledgeResourceKind.DOCUMENT:
      return 'document';
    case KnowledgeResourceKind.FOLDER:
      return 'folder';
    case KnowledgeResourceKind.PROJECT:
      return 'project';
    case KnowledgeResourceKind.URL_SNAPSHOT:
      return 'url';
    case KnowledgeResourceKind.NOTEBOOK:
      return 'notebook';
    case KnowledgeResourceKind.WORKSPACE:
      return 'workspace';
    default:
      return 'unknown';
  }
}

function KnowledgeAvailabilityTag({
  availability,
}: {
  availability: KnowledgeResourceAvailability;
}) {
  const { t } = useTranslation('agent');
  if (availability === KnowledgeResourceAvailability.READY) {
    return <Tag color="success" style={{ margin: 0 }}>{t('agent.profile.knowledge.status.indexed')}</Tag>;
  }
  if (availability === KnowledgeResourceAvailability.INDEXING) {
    return <Tag color="processing" style={{ margin: 0 }}>{t('agent.profile.knowledge.status.pending_index')}</Tag>;
  }
  if (availability === KnowledgeResourceAvailability.TOMBSTONED) {
    return <Tag style={{ margin: 0 }}>{t('agent.profile.knowledge.status.tombstoned')}</Tag>;
  }
  return <Tag color="error" style={{ margin: 0 }}>{t('agent.profile.degradation.unavailable')}</Tag>;
}




type AgentActivityStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'unknown';
type AgentActivityEventKind = 'turn' | 'tool' | 'approval' | 'delegation' | 'knowledge' | 'artifact' | 'error';

interface AgentActivityTaskProjection {
  id: string;
  title: string;
  status: AgentActivityStatus;
  source: 'turn' | 'delegation' | 'trace';
  startedAt: number;
  endedAt?: number;
  toolCount: number;
  eventCount: number;
}

interface AgentActivityEventProjection {
  id: string;
  kind: AgentActivityEventKind;
  status: AgentActivityStatus;
  detail: string;
  timestamp: number;
}

function truncateActivityText(value: string, fallback: string, maxLength = 96): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function statusFromToolCall(toolCall: ToolCallInfo): AgentActivityStatus {
  if (toolCall.status === 'approval_required') return 'waiting';
  if (toolCall.status === 'error') return 'failed';
  if (toolCall.status === 'cancelled') return 'cancelled';
  if (toolCall.pending || toolCall.status === 'approved' || toolCall.status === 'pending') return 'running';
  if (toolCall.status === 'success') return 'completed';
  if (toolCall.status === 'denied') return 'failed';
  return 'unknown';
}

function statusFromDelegation(delegation: DelegationTaskInfo): AgentActivityStatus {
  if (delegation.status === 'completed') return 'completed';
  if (delegation.status === 'failed' || delegation.status === 'timeout') return 'failed';
  return 'unknown';
}

function statusFromTurnStatus(status?: TurnStatus): AgentActivityStatus {
  if (status === TurnStatus.RUNNING) return 'running';
  if (status === TurnStatus.COMPLETED) return 'completed';
  if (status === TurnStatus.FAILED) return 'failed';
  if (status === TurnStatus.INTERRUPTED) return 'cancelled';
  return 'unknown';
}

function statusFromPersistedDelegation(status?: DelegationStatus): AgentActivityStatus {
  if (status === DelegationStatus.COMPLETED) return 'completed';
  if (status === DelegationStatus.FAILED || status === DelegationStatus.TIMEOUT) return 'failed';
  return 'unknown';
}

function protoTimestampToMs(timestamp?: { seconds: bigint; nanos: number }): number | undefined {
  if (!timestamp) return undefined;
  return Number(timestamp.seconds) * 1000 + Math.floor(timestamp.nanos / 1000000);
}

function statusFromAssistantMessage(message: ChatMessage): AgentActivityStatus {
  const toolCalls = message.toolCalls || [];
  if (message.error) return 'failed';
  if (toolCalls.some((toolCall) => statusFromToolCall(toolCall) === 'waiting')) return 'waiting';
  if (message.loading || toolCalls.some((toolCall) => statusFromToolCall(toolCall) === 'running')) return 'running';
  if (toolCalls.some((toolCall) => statusFromToolCall(toolCall) === 'failed')) return 'failed';
  return 'completed';
}

function buildAgentActivityProjections(messages: ChatMessage[], fallbackTitle: string): {
  tasks: AgentActivityTaskProjection[];
  events: AgentActivityEventProjection[];
} {
  const tasks: AgentActivityTaskProjection[] = [];
  const events: AgentActivityEventProjection[] = [];
  let latestUser: ChatMessage | undefined;

  for (const message of messages) {
    if (message.role === 'user') {
      latestUser = message;
      events.push({
        id: `${message.id}:turn-started`,
        kind: 'turn',
        status: 'running',
        detail: truncateActivityText(message.content, fallbackTitle),
        timestamp: message.timestamp,
      });
      continue;
    }

    if (message.role !== 'assistant') continue;

    const toolCalls = message.toolCalls || [];
    const delegations = [
      ...(message.delegationResults || []),
      ...toolCalls.flatMap((toolCall) => toolCall.delegationResults || []),
    ];
    const knowledgeChunks = message.knowledgeChunks || [];
    const artifacts = extractMessageArtifacts(message);
    const status = statusFromAssistantMessage(message);
    const eventCount = toolCalls.length + delegations.length + knowledgeChunks.length + artifacts.length + (message.error ? 1 : 0);

    tasks.push({
      id: message.id,
      title: truncateActivityText(latestUser?.content || message.content, fallbackTitle),
      status,
      source: 'turn',
      startedAt: latestUser?.timestamp || message.timestamp,
      endedAt: message.loading ? undefined : message.lastEventAt || message.timestamp,
      toolCount: toolCalls.length,
      eventCount: Math.max(eventCount, 1),
    });

    if (message.error) {
      events.push({
        id: `${message.id}:error`,
        kind: 'error',
        status: 'failed',
        detail: message.error,
        timestamp: message.lastEventAt || message.timestamp,
      });
    }

    for (const toolCall of toolCalls) {
      const toolStatus = statusFromToolCall(toolCall);
      events.push({
        id: `${message.id}:tool:${toolCall.id}`,
        kind: toolCall.status === 'approval_required' || toolCall.approvalId ? 'approval' : 'tool',
        status: toolStatus,
        detail: toolCall.serverName ? `${toolCall.serverName} / ${toolCall.name}` : toolCall.name,
        timestamp: message.lastEventAt || message.timestamp,
      });
    }

    for (const delegation of delegations) {
      tasks.push({
        id: delegation.taskId,
        title: truncateActivityText(delegation.taskDescription, fallbackTitle),
        status: statusFromDelegation(delegation),
        source: 'delegation',
        startedAt: delegation.startedAt ? Date.parse(delegation.startedAt) : message.timestamp,
        endedAt: delegation.endedAt ? Date.parse(delegation.endedAt) : undefined,
        toolCount: delegation.childToolset.length,
        eventCount: delegation.toolIterations,
      });
      events.push({
        id: `${message.id}:delegation:${delegation.taskId}`,
        kind: 'delegation',
        status: statusFromDelegation(delegation),
        detail: delegation.resultSummary || delegation.taskDescription,
        timestamp: delegation.endedAt ? Date.parse(delegation.endedAt) : message.lastEventAt || message.timestamp,
      });
    }

    if (knowledgeChunks.length > 0) {
      events.push({
        id: `${message.id}:knowledge`,
        kind: 'knowledge',
        status: 'completed',
        detail: knowledgeChunks.map((chunk) => chunk.resourceTitle || chunk.resourceId).join(', '),
        timestamp: message.lastEventAt || message.timestamp,
      });
    }

    if (artifacts.length > 0) {
      events.push({
        id: `${message.id}:artifact`,
        kind: 'artifact',
        status: 'completed',
        detail: artifacts.map((artifact) => artifact.title).join(', '),
        timestamp: message.lastEventAt || message.timestamp,
      });
    }
  }

  return {
    tasks: tasks.sort((left, right) => right.startedAt - left.startedAt),
    events: events.sort((left, right) => right.timestamp - left.timestamp),
  };
}

function buildPersistedAgentActivityProjections(entries: TurnTraceEntry[], fallbackTitle: string): {
  tasks: AgentActivityTaskProjection[];
  events: AgentActivityEventProjection[];
} {
  const tasks: AgentActivityTaskProjection[] = [];
  const events: AgentActivityEventProjection[] = [];

  for (const entry of entries) {
    const turn = entry.turn;
    const trace = entry.trace;
    if (!turn || !trace) continue;
    const startedAt = protoTimestampToMs(turn.startedAt) || Date.now();
    const endedAt = protoTimestampToMs(turn.endedAt);
    const status = statusFromTurnStatus(turn.status);
    const taskTitle = truncateActivityText(turn.userInput || turn.finalResponse, fallbackTitle);
    const eventCount =
      trace.toolCalls.length +
      trace.providerCalls.length +
      trace.errorsClassified.length +
      trace.delegationResults.length +
      trace.knowledgeChunks.length +
      (trace.reviewTriggered ? 1 : 0) +
      (trace.compressionEvent?.triggered ? 1 : 0);

    tasks.push({
      id: trace.traceId || turn.turnId,
      title: taskTitle,
      status,
      source: 'trace',
      startedAt,
      endedAt,
      toolCount: trace.toolCalls.length,
      eventCount: Math.max(eventCount, 1),
    });
    events.push({
      id: `${trace.traceId || turn.turnId}:turn`,
      kind: 'turn',
      status,
      detail: taskTitle,
      timestamp: startedAt,
    });

    trace.toolCalls.forEach((toolCall, index) => {
      events.push({
        id: `${trace.traceId || turn.turnId}:tool:${index}`,
        kind: 'tool',
        status: 'completed',
        detail: toolCall.toolName || fallbackTitle,
        timestamp: endedAt || startedAt,
      });
    });
    trace.providerCalls.forEach((providerCall, index) => {
      const detail = [providerCall.provider, providerCall.model].filter(Boolean).join(' / ');
      events.push({
        id: `${trace.traceId || turn.turnId}:provider:${index}`,
        kind: 'tool',
        status: 'completed',
        detail: detail || fallbackTitle,
        timestamp: endedAt || startedAt,
      });
    });
    trace.errorsClassified.forEach((errorEvent, index) => {
      events.push({
        id: `${trace.traceId || turn.turnId}:error:${index}`,
        kind: 'error',
        status: 'failed',
        detail: errorEvent.errorMessage || errorEvent.errorCode || fallbackTitle,
        timestamp: protoTimestampToMs(errorEvent.classifiedAt) || endedAt || startedAt,
      });
    });
    trace.delegationResults.forEach((delegation) => {
      const delegationStatus = statusFromPersistedDelegation(delegation.status);
      const delegationStartedAt = protoTimestampToMs(delegation.startedAt) || startedAt;
      const delegationEndedAt = protoTimestampToMs(delegation.endedAt);
      tasks.push({
        id: delegation.taskId,
        title: truncateActivityText(delegation.taskDescription, fallbackTitle),
        status: delegationStatus,
        source: 'delegation',
        startedAt: delegationStartedAt,
        endedAt: delegationEndedAt,
        toolCount: delegation.childToolset.length,
        eventCount: delegation.toolIterations,
      });
      events.push({
        id: `${trace.traceId || turn.turnId}:delegation:${delegation.taskId}`,
        kind: 'delegation',
        status: delegationStatus,
        detail: delegation.resultSummary || delegation.taskDescription || fallbackTitle,
        timestamp: delegationEndedAt || delegationStartedAt,
      });
    });
    if (trace.knowledgeChunks.length > 0) {
      events.push({
        id: `${trace.traceId || turn.turnId}:knowledge`,
        kind: 'knowledge',
        status: 'completed',
        detail: trace.knowledgeChunks.map((chunk) => chunk.resourceTitle || chunk.resourceId).filter(Boolean).join(', ') || fallbackTitle,
        timestamp: endedAt || startedAt,
      });
    }
  }

  return {
    tasks: tasks.sort((left, right) => right.startedAt - left.startedAt),
    events: events.sort((left, right) => right.timestamp - left.timestamp),
  };
}

function ActivityStatusTag({ status }: { status: AgentActivityStatus }) {
  const { t } = useTranslation('agent');
  const colorByStatus: Record<AgentActivityStatus, string> = {
    running: 'processing',
    waiting: 'warning',
    completed: 'success',
    failed: 'error',
    cancelled: 'default',
    unknown: 'default',
  };
  return <Tag color={colorByStatus[status]}>{t(`agent.profile.activity.status.${status}`)}</Tag>;
}

function formatActivityTime(timestamp?: number): string {
  if (!timestamp || Number.isNaN(timestamp)) return '';
  return new Date(timestamp).toLocaleString();
}

const ACTIVITY_TRACE_REFRESH_EVENTS = new Set([
  'progress',
  'tool_call',
  'tool_result',
  'tool_approval_required',
  'tool_approval_decision',
  'error',
  'done',
]);

function AgentActivityPanel({
  tasks,
  events,
  isCurrentAgentSession,
  currentSessionTitle,
  traceLoading,
  traceLoadError,
  persistedTraceCount,
}: {
  tasks: AgentActivityTaskProjection[];
  events: AgentActivityEventProjection[];
  isCurrentAgentSession: boolean;
  currentSessionTitle: string;
  traceLoading: boolean;
  traceLoadError: string;
  persistedTraceCount: number;
}) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  return (
    <Flexbox gap={12} style={{ overflow: 'auto' }}>
      <ProfileCard
        title={t('agent.profile.activity.persistentTrace')}
        description={t('agent.profile.activity.persistentTraceDesc')}
      >
        <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
          <Tag color={persistedTraceCount > 0 ? 'success' : 'default'}>
            {t('agent.profile.activity.traceCount', { count: persistedTraceCount })}
          </Tag>
          {traceLoading && <Tag color="processing">{t('agent.profile.activity.traceLoading')}</Tag>}
          {traceLoadError && <Tag color="error">{traceLoadError}</Tag>}
          {!isCurrentAgentSession && (
            <Tag color="warning">
              {t('agent.profile.activity.sessionMismatch', {
                session: currentSessionTitle || t('agent.profile.empty'),
              })}
            </Tag>
          )}
        </Flexbox>
      </ProfileCard>
      <ProfileCard title={t('agent.profile.activity.tasks')} description={t('agent.profile.activity.tasksDesc')}>
        {tasks.length === 0 ? (
          <Empty description={t('agent.profile.activity.noTasks')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Flexbox gap={8}>
            {tasks.map((task) => (
              <Flexbox
                key={`${task.source}:${task.id}`}
                gap={6}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorBgContainer,
                }}
              >
                <Flexbox horizontal align="center" justify="space-between" gap={8}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{task.title}</span>
                  <ActivityStatusTag status={task.status} />
                </Flexbox>
                <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
                  <Tag>{t(`agent.profile.activity.source.${task.source}`)}</Tag>
                  <Tag>{t('agent.profile.activity.toolCount', { count: task.toolCount })}</Tag>
                  <Tag>{t('agent.profile.activity.eventCount', { count: task.eventCount })}</Tag>
                </Flexbox>
                <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                  {formatActivityTime(task.startedAt)}
                  {task.endedAt ? ` · ${formatActivityTime(task.endedAt)}` : ''}
                </span>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </ProfileCard>
      <ProfileCard title={t('agent.profile.activity.events')} description={t('agent.profile.activity.eventsDesc')}>
        {events.length === 0 ? (
          <Empty description={t('agent.profile.activity.noEvents')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Flexbox gap={8}>
            {events.map((event) => (
              <Flexbox
                key={event.id}
                gap={4}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  background: token.colorFillQuaternary,
                }}
              >
                <Flexbox horizontal align="center" justify="space-between" gap={8}>
                  <Flexbox horizontal align="center" gap={6}>
                    <Tag>{t(`agent.profile.activity.event.${event.kind}`)}</Tag>
                    <ActivityStatusTag status={event.status} />
                  </Flexbox>
                  <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                    {formatActivityTime(event.timestamp)}
                  </span>
                </Flexbox>
                <span style={{ fontSize: 12, color: token.colorTextSecondary, wordBreak: 'break-word' }}>
                  {truncateActivityText(event.detail, t('agent.profile.empty'), 180)}
                </span>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </ProfileCard>
    </Flexbox>
  );
}


function parseAllowedRootsForDisplay(value?: string): string {
  if (!value?.trim()) return '';
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean).join('\n');
    }
  } catch {
    return value;
  }
  return '';
}



export function AgentProfilePage({
  agentName,
  onBack,
  onOpenOrchestration,
  embedded = false,
}: AgentProfilePageProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const agents = useAgentStore(s => s.agents);
  const availableModels = useAgentStore(s => s.availableModels);
  const loadAgents = useAgentStore(s => s.loadAgents);
  const updateAgentProfile = useAgentStore(s => s.updateAgentProfile);
  const reloadAgentProfile = useAgentStore(s => s.reloadAgentProfile);
  const createAgent = useAgentStore(s => s.createAgent);
  const setSelectedAgent = useAgentStore(s => s.setSelectedAgent);
  const agentRosterOpen = useAgentStore(s => s.agentRosterOpen);
  const setAgentRosterOpen = useAgentStore(s => s.setAgentRosterOpen);
  const saveStateByAgentId = useAgentStore(s => s.saveStateByAgentId);
  const agentPendingMutations = useAgentStore(s => s.pendingMutations);

  const [profileAgentName, setProfileAgentName] = useState(agentName);
  const agentListOpen = agentRosterOpen;
  const setAgentListOpen = setAgentRosterOpen;
  const [agentSearch, setAgentSearch] = useState('');
  const [agent, setAgent] = useState<Agent | null>(null);
  const [soulMd, setSoulMd] = useState('');
  const [soulMdDirty, setSoulMdDirty] = useState(false);
  const [agentsMd, setAgentsMd] = useState('');
  const [agentsMdDirty, setAgentsMdDirty] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [systemPromptDirty, setSystemPromptDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [activeTab, setActiveTab] = useState<ProfileTab>('soul');
  const [descriptionGenerating, setDescriptionGenerating] = useState(false);
  const [allowedRootsText, setAllowedRootsText] = useState('');
  const [persistedActivityProjection, setPersistedActivityProjection] = useState<{
    tasks: AgentActivityTaskProjection[];
    events: AgentActivityEventProjection[];
  }>({ tasks: [], events: [] });
  const [activityTraceLoading, setActivityTraceLoading] = useState(false);
  const [activityTraceLoadError, setActivityTraceLoadError] = useState('');
  const [persistedTraceCount, setPersistedTraceCount] = useState(0);
  const soulSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const agentsSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const systemPromptSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activityMessages = useChatStore((state) => state.messages);
  const activityCurrentSessionKey = useChatStore((state) => state.currentSessionKey);
  const activitySessions = useChatStore((state) => state.sessions);
  const capabilitySelector = useMemo(
    () => createProfileCapabilitySelector(agent?.id ?? ''),
    [agent?.id],
  );
  const capabilityProjection = useAgentCapabilityStore(capabilitySelector);
  const enabledSkillBindings = useMemo(
    () => enabledCapabilityBindings(capabilityProjection.skills.bindings),
    [capabilityProjection.skills.bindings],
  );
  const skillOptions = useMemo(
    () => capabilityProjection.skills.manifests
      .filter((manifest) => !manifest.retiredAt)
      .map((manifest) => ({
        value: capabilityManifestKey(manifest.capabilityId, manifest.version),
        label: capabilityLabel(manifest),
      })),
    [capabilityProjection.skills.manifests],
  );
  const selectedSkillManifestKeys = useMemo(
    () => enabledSkillBindings.map((binding) =>
      capabilityManifestKey(binding.capabilityId, binding.capabilityVersion)),
    [enabledSkillBindings],
  );
  const filteredProfileAgents = useMemo(() => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return agents;
    return agents.filter((item) =>
      [item.title, item.name, item.description].some((value) => value.toLowerCase().includes(query)),
    );
  }, [agentSearch, agents]);
  const pinnedProfileAgents = filteredProfileAgents.filter((item) => item.pinned);
  const otherProfileAgents = filteredProfileAgents.filter((item) => !item.pinned);
  const collapsedPinnedAgents = agents.filter((item) => item.pinned);
  const collapsedOtherAgents = agents.filter((item) => !item.pinned);

  const handleSelectProfileAgent = useCallback((nextAgent: Agent) => {
    setSelectedAgent(nextAgent.name);
    void openAgentChatSession(nextAgent, {
      reason: 'profile-roster-switch',
      draftTitle: t('agent.sidebar.newTopic'),
    });
    onBack?.();
  }, [onBack, setSelectedAgent, t]);

  // Refresh agent data when Agent Builder modifies the agent
  useEffect(() => {
    const handler = () => loadAgents();
    return eventBus.subscribe(EVENT.AGENT_BUILDER_STREAM_ENDED, handler);
  }, [loadAgents]);

  useEffect(() => {
    setProfileAgentName(agentName);
  }, [agentName]);

  useEffect(() => {
    const found = agents.find((a) => a.name === profileAgentName);
    if (found) {
      setAgent(found);
      setSoulMd(found.soulMd || '');
      setSoulMdDirty(false);
      setAgentsMd(found.agentsMd || '');
      setAgentsMdDirty(false);
      setSystemPrompt(found.systemPrompt || '');
      setSystemPromptDirty(false);
      setAllowedRootsText(parseAllowedRootsForDisplay(found.allowedRoots));
    }
  }, [agents, profileAgentName]);

  useEffect(() => {
    return () => {
      if (soulSaveTimerRef.current) clearTimeout(soulSaveTimerRef.current);
      if (agentsSaveTimerRef.current) clearTimeout(agentsSaveTimerRef.current);
      if (systemPromptSaveTimerRef.current) clearTimeout(systemPromptSaveTimerRef.current);
    };
  }, []);



  const saveSoulMd = useCallback(
    async (value: string) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { soulMd: value });
        setSoulMdDirty(false);
        loadAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );

  const handleSoulMdChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setSoulMd(value);
      setSoulMdDirty(true);
      if (soulSaveTimerRef.current) clearTimeout(soulSaveTimerRef.current);
      soulSaveTimerRef.current = setTimeout(() => saveSoulMd(value), 1500);
    },
    [saveSoulMd],
  );

  const handleSoulMdBlur = useCallback(() => {
    if (soulMdDirty) {
      if (soulSaveTimerRef.current) clearTimeout(soulSaveTimerRef.current);
      saveSoulMd(soulMd);
    }
  }, [soulMdDirty, soulMd, saveSoulMd]);

  const saveAgentsMd = useCallback(
    async (value: string) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { agentsMd: value });
        setAgentsMdDirty(false);
        loadAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );

  const handleAgentsMdChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setAgentsMd(value);
      setAgentsMdDirty(true);
      if (agentsSaveTimerRef.current) clearTimeout(agentsSaveTimerRef.current);
      agentsSaveTimerRef.current = setTimeout(() => saveAgentsMd(value), 1500);
    },
    [saveAgentsMd],
  );

  const handleAgentsMdBlur = useCallback(() => {
    if (agentsMdDirty) {
      if (agentsSaveTimerRef.current) clearTimeout(agentsSaveTimerRef.current);
      saveAgentsMd(agentsMd);
    }
  }, [agentsMdDirty, agentsMd, saveAgentsMd]);

  const saveSystemPrompt = useCallback(
    async (value: string) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { systemPrompt: value });
        setSystemPromptDirty(false);
        loadAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );

  const handleSystemPromptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setSystemPrompt(value);
      setSystemPromptDirty(true);
      if (systemPromptSaveTimerRef.current) clearTimeout(systemPromptSaveTimerRef.current);
      systemPromptSaveTimerRef.current = setTimeout(() => saveSystemPrompt(value), 1500);
    },
    [saveSystemPrompt],
  );

  const handleSystemPromptBlur = useCallback(() => {
    if (systemPromptDirty) {
      if (systemPromptSaveTimerRef.current) clearTimeout(systemPromptSaveTimerRef.current);
      saveSystemPrompt(systemPrompt);
    }
  }, [systemPromptDirty, systemPrompt, saveSystemPrompt]);

  const handleEffortChange = useCallback(
    async (value: string) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { effort: value });
        loadAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );



  const handleIsolationRetentionDaysChange = useCallback(
    async (value: number | null) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { isolationRetentionDays: value ?? 7 });
        loadAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );

  const handleWorkspaceModeChange = useCallback(
    async (value: string) => {
      if (!agent) return;
      try {
        await api.updateAgent(agent.id, { workspaceMode: value });
        loadAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );





  const handleAllowedRootsBlur = useCallback(
    async () => {
      if (!agent) return;
      const roots = allowedRootsText
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean);
      const value = JSON.stringify(roots);
      if (value === (agent.allowedRoots || '[]')) return;
      try {
        await api.updateAgent(agent.id, { allowedRoots: value });
        loadAgents();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, loadAgents, t],
  );



  const handleModelChange = useCallback(
    async (modelId: string) => {
      if (!agent) return;
      const m = availableModels.find((x) => x.id === modelId);
      const providerId = m?.provider_id || '';
      try {
        const updated = await updateAgentProfile(agent.id, { model: modelId || '', provider: providerId });
        setAgent(updated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToUpdateModel');
        antMessage.error(message);
      }
    },
    [agent, availableModels, updateAgentProfile, t],
  );

  const handleProviderChange = useCallback(
    async (providerId: string) => {
      if (!agent) return;
      const currentModel = availableModels.find((item) => item.id === agent.model);
      const shouldClearModel = !!currentModel && currentModel.provider_id !== providerId;
      try {
        const updated = await updateAgentProfile(agent.id, {
          provider: providerId || '',
          model: shouldClearModel ? '' : agent.model,
        });
        setAgent(updated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToUpdateModel');
        antMessage.error(message);
      }
    },
    [agent, availableModels, updateAgentProfile, t],
  );

  const handleTitleBlur = useCallback(
    async (rawValue: string) => {
      if (!agent) return;
      const value = rawValue.trim();
      if (!value || value === (agent.title || agent.name)) return;
      try {
        const updated = await updateAgentProfile(agent.id, { title: value });
        setAgent(updated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, updateAgentProfile, t],
  );

  const handleDescriptionBlur = useCallback(
    async (rawValue: string) => {
      if (!agent) return;
      const value = rawValue.trim();
      if (value === (agent.description || '').trim()) return;
      try {
        const updated = await updateAgentProfile(agent.id, { description: value });
        setAgent(updated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, updateAgentProfile, t],
  );

  const handleAvatarChange = useCallback(
    async (emoji: string) => {
      if (!agent) return;
      try {
        const updated = await updateAgentProfile(agent.id, { avatar: emoji });
        setAgent(updated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, updateAgentProfile, t],
  );

  const handleReloadLatest = useCallback(async () => {
    if (!agent) return;
    try {
      const reloaded = await reloadAgentProfile(agent.id);
      setAgent(reloaded);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
      antMessage.error(message);
    }
  }, [agent, reloadAgentProfile, t]);

  const handleSettingsSaved = useCallback(
    (updated: Agent) => {
      setAgent(updated);
      setSettingsOpen(false);
      loadAgents();
    },
    [loadAgents],
  );

  const handleCreateAgent = useCallback(async () => {
    const suffix = Date.now().toString(36);
    try {
      // First-class store createAgent (C5): persists + merges roster + selects +
      // sets profile surface. Profile-local editing state is seeded from result.
      const created = await createAgent({
        name: `agent-${suffix}`,
        title: t('agent.profile.identityTitlePlaceholder'),
        description: '',
        avatar: '',
        soulMd: '# SOUL.md\n\n## Identity\n',
        agentsMd: '# AGENTS.md\n\n## Workflow\n',
        effort: 'medium',
        visibility: 'private',
        workspaceMode: 'agent',
      });
      setProfileAgentName(created.name);
      setAgent(created);
      setSoulMd(created.soulMd || '');
      setSoulMdDirty(false);
      setAgentsMd(created.agentsMd || '');
      setAgentsMdDirty(false);
      window.history.pushState(null, '', `#/agent-profile/${encodeURIComponent(created.name)}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
      antMessage.error(message);
    }
  }, [createAgent, t]);

  const handleBoundSkillsChange = useCallback(
    async (values: string[]) => {
      if (!agent) return;
      const selectedKeys = new Set(values);
      const currentKeys = new Set(selectedSkillManifestKeys);
      const additions = capabilityProjection.skills.manifests.filter((manifest) =>
        selectedKeys.has(capabilityManifestKey(manifest.capabilityId, manifest.version))
        && !currentKeys.has(capabilityManifestKey(manifest.capabilityId, manifest.version)));
      const removals = enabledSkillBindings.filter((binding) =>
        !selectedKeys.has(capabilityManifestKey(
          binding.capabilityId,
          binding.capabilityVersion,
        )));
      try {
        await Promise.all([
          ...additions.map((manifest) => {
            const existingBinding = capabilityProjection.skills.bindings.find(
              (binding) =>
                binding.capabilityId === manifest.capabilityId
                && binding.capabilityVersion === manifest.version
                && !binding.tombstonedAt,
            );
            return capabilityProjection.upsertBinding({
              bindingId: existingBinding?.bindingId,
              agentId: agent.id,
              capabilityId: manifest.capabilityId,
              capabilityVersion: manifest.version,
              enabled: true,
              approvalPolicy: manifest.defaultApprovalPolicy,
              expectedAgentVersion: agent.version,
              expectedBindingRevision: existingBinding?.revision ?? 0n,
              idempotencyKey: crypto.randomUUID(),
            });
          }),
          ...removals.map((binding) => capabilityProjection.deleteBinding({
            agentId: agent.id,
            bindingId: binding.bindingId,
            expectedBindingRevision: binding.revision,
            idempotencyKey: crypto.randomUUID(),
            reason: 'agent_profile_skill_unbound',
          })),
        ]);
        antMessage.success(t('agent.profile.skills.boundUpdated'));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [
      agent,
      capabilityProjection,
      enabledSkillBindings,
      selectedSkillManifestKeys,
      t,
    ],
  );

  const knowledgeCapabilityProjections = useMemo(
    () => boundKnowledgeProjections(
      capabilityProjection.knowledge,
      capabilityProjection.knowledgeDescriptors,
    ),
    [
      capabilityProjection.knowledge,
      capabilityProjection.knowledgeDescriptors,
    ],
  );

  const handleAddKnowledgeResource = useCallback(
    async (
      type: KnowledgeResourceKind,
      content: string,
      title?: string,
    ): Promise<boolean> => {
      if (!agent || !content.trim()) return false;
      if (type !== KnowledgeResourceKind.DOCUMENT) {
        antMessage.warning(t('agent.profile.knowledge.clientLocalUnavailable'));
        return false;
      }
      try {
        await bindStationKnowledgeDocument(capabilityProjection, {
          agentId: agent.id,
          expectedAgentVersion: agent.version,
          title: title?.trim() || t('agent.profile.knowledge.untitledDocument'),
          content: content.trim(),
          idempotencyKey: () => crypto.randomUUID(),
          resolveManifest: (descriptor) => {
            const state = useAgentCapabilityStore.getState();
            return selectCapabilityManifestsBySource(
              state,
              CapabilitySourceKind.KNOWLEDGE,
              descriptor.resourceId,
            ).find(
              (manifest) =>
                manifest.version === descriptor.revision.toString()
                && !manifest.retiredAt,
            );
          },
        });
        antMessage.success(t('agent.profile.knowledge.added'));
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error
          && err.message === 'agent.profile.knowledge.manifestMissing'
          ? t(err.message)
          : err instanceof Error
            ? err.message
            : t('agent.profile.failedToSave');
        antMessage.error(message);
        return false;
      }
    },
    [agent, capabilityProjection, t],
  );

  const handleRemoveKnowledgeResource = useCallback(
    async (resource: BoundKnowledgeProjection) => {
      if (!agent) return;
      try {
        await removeOwnedKnowledgeResource(
          capabilityProjection,
          resource.descriptor,
          resource.binding,
          () => crypto.randomUUID(),
        );
        antMessage.success(t('agent.profile.knowledge.removed'));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, capabilityProjection, t],
  );

  const handleToggleKnowledgeResource = useCallback(
    async (resource: BoundKnowledgeProjection) => {
      if (!agent) return;
      try {
        await setKnowledgeBindingEnabled(
          capabilityProjection,
          agent.version,
          resource.binding,
          !resource.binding.enabled,
          crypto.randomUUID(),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('agent.profile.failedToSave');
        antMessage.error(message);
      }
    },
    [agent, capabilityProjection, t],
  );

  const [knowledgeAddOpen, setKnowledgeAddOpen] = useState(false);
  const [knowledgeAddType, setKnowledgeAddType] = useState<KnowledgeResourceKind>(
    KnowledgeResourceKind.DOCUMENT,
  );
  const [knowledgeAddContent, setKnowledgeAddContent] = useState('');
  const [knowledgeAddTitle, setKnowledgeAddTitle] = useState('');

  const handleKnowledgeAddSubmit = useCallback(async () => {
    if (!knowledgeAddContent.trim()) {
      antMessage.error(t('agent.profile.knowledge.contentRequired'));
      return;
    }
    const added = await handleAddKnowledgeResource(
      knowledgeAddType,
      knowledgeAddContent,
      knowledgeAddTitle,
    );
    if (!added) return;
    setKnowledgeAddContent('');
    setKnowledgeAddTitle('');
    setKnowledgeAddOpen(false);
  }, [
    knowledgeAddType,
    knowledgeAddContent,
    knowledgeAddTitle,
    handleAddKnowledgeResource,
    t,
  ]);

  const handleInlineRewriteDescription = useCallback(async () => {
    if (!agent) return;
    const intent = agent.description?.trim() || agent.title || agent.name;
    setDescriptionGenerating(true);
    const prompt = [
      'Rewrite this Agent description for A2A routing.',
      'Return one concise sentence only. Do not include markdown or quotes.',
      `Agent name: ${agent.title || agent.name}`,
      `Current description: ${intent}`,
    ].join('\n');
    let content = '';

    try {
      const builderAgent = agents.find((candidate) => candidate.name === 'agent-builder');
      if (!builderAgent) {
        throw new Error(t('agent.profile.notFound'));
      }
      await new Promise<void>((resolve, reject) => {
        executeAgentTurn(
          {
            client_idempotency_key: crypto.randomUUID(),
            conversation_id: '',
            agent_id: builderAgent.id,
            user_input: prompt,
          },
          (event) => {
            if (event.event === 'text') content += event.data?.content || '';
          },
          () => resolve(),
          (error) => reject(error),
        );
      });
      const updatedDescription = content.replace(/^```[a-z]*|```$/g, '').replace(/^description\s*[:：]/i, '').trim();
      if (!updatedDescription) throw new Error(t('agent.descriptionRewrite.parseFailed'));
      const updated = await api.updateAgent(agent.id, { description: updatedDescription });
      setAgent(updated);
      await loadAgents();
      antMessage.success(t('agent.descriptionRewrite.applied'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      antMessage.error(message || t('agent.descriptionRewrite.parseFailed'));
    } finally {
      setDescriptionGenerating(false);
    }
  }, [agent, agents, loadAgents, t]);











  const loadActivityTraces = useCallback(async (ignore?: () => boolean) => {
    if (!agent) return;
    setActivityTraceLoading(true);
    setActivityTraceLoadError('');
    try {
      const response = await api.listAgentTurnTraces(agent.id, { pageSize: 20 });
      if (ignore?.()) return;
      setPersistedTraceCount(response.total);
      setPersistedActivityProjection(buildPersistedAgentActivityProjections(
        response.entries || [],
        t('agent.profile.activity.defaultTaskTitle'),
      ));
    } catch {
      if (ignore?.()) return;
      const message = t('agent.profile.activity.traceLoadFailed');
      setPersistedTraceCount(0);
      setPersistedActivityProjection({ tasks: [], events: [] });
      setActivityTraceLoadError(message);
    } finally {
      if (!ignore?.()) setActivityTraceLoading(false);
    }
  }, [agent, t]);

  useEffect(() => {
    if (!agent || !['tasks', 'events'].includes(activeTab)) return;
    let ignore = false;
    loadActivityTraces(() => ignore);
    return () => {
      ignore = true;
    };
  }, [activeTab, agent, loadActivityTraces]);

  useEffect(() => {
    if (!agent || !['tasks', 'events'].includes(activeTab)) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = eventBus.subscribe(
      EVENT.AGENT_TURN_STREAM_EVENT,
      (payload: AgentTurnStreamEventPayload) => {
        if (payload.agentId !== agent.id && payload.agentId !== agent.name) return;
        if (!ACTIVITY_TRACE_REFRESH_EVENTS.has(payload.event)) return;
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          loadActivityTraces();
        }, payload.event === 'done' || payload.event === 'error' ? 0 : 500);
      },
    );
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [activeTab, agent, loadActivityTraces]);

  if (!agent) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%' }}>
        <Empty description={t('agent.profile.notFound')} />
        {onBack && (
          <Button type="link" onClick={onBack}>
            {t('agent.profile.goBack')}
          </Button>
        )}
      </Flexbox>
    );
  }

  const chatConfig = parseAgentChatConfig(agent);
  const workspaceRoot = chatConfig.workspace?.root?.trim();
  const boundTools = boundCapabilityProjections(capabilityProjection.tools);
  const boundMcpServers = boundCapabilityProjections(capabilityProjection.mcp);
  const boundSkills = boundCapabilityProjections(capabilityProjection.skills);
  const boundCapabilities = [...boundTools, ...boundMcpServers, ...boundSkills];
  const capabilityBindingsReady =
    boundCapabilities.length > 0
    && boundCapabilities.every(
      ({ readiness }) => readiness?.state === CapabilityReadinessState.READY,
    );
  const capabilityMutationPending =
    Object.keys(capabilityProjection.pendingMutations).length > 0;
  const activityCurrentSession = activitySessions.find((session) => session.key === activityCurrentSessionKey);
  const isCurrentAgentActivitySession =
    activityCurrentSession?.agent_name === agent.name || activityCurrentSession?.agent_name === agent.id;
  const localActivityProjection = buildAgentActivityProjections(
    isCurrentAgentActivitySession ? activityMessages : [],
    t('agent.profile.activity.defaultTaskTitle'),
  );
  const activityProjection = {
    tasks: [...persistedActivityProjection.tasks, ...localActivityProjection.tasks]
      .sort((left, right) => right.startedAt - left.startedAt),
    events: [...persistedActivityProjection.events, ...localActivityProjection.events]
      .sort((left, right) => right.timestamp - left.timestamp),
  };
  const selectedModel = availableModels.find((model) => model.id === agent.model);
  const selectedProviderId = agent.provider || selectedModel?.provider_id || '';
  const providerOptions = Array.from(
    new Map(
      availableModels
        .filter((model) => model.enabled)
        .map((model) => [
          model.provider_id || model.provider_name,
          {
            value: model.provider_id || model.provider_name,
            label: model.provider_name || model.provider_id,
          },
        ]),
    ).values(),
  ).filter((option) => option.value);
  const routingModels = selectedProviderId
    ? availableModels.filter((model) => model.provider_id === selectedProviderId)
    : availableModels;
  const modelLabel = selectedModel?.display_name || agent.model || t('agent.profile.defaultModel');
  const activeTabLabel = t(TAB_KEYS.find((tab) => tab.key === activeTab)?.labelKey || ACTIVITY_TAB_KEYS.find((tab) => tab.key === activeTab)?.labelKey || 'agent.profile.tab.prompt');
  const builderContextSummary = [
    {
      label: t('agent.builder.context.model'),
      value: modelLabel,
      ready: Boolean(agent.model || selectedModel),
      targetTab: 'workspace' as ProfileTab,
    },
    {
      label: t('agent.builder.context.capabilities'),
      value: t('agent.profile.bindingSummary', {
        tools: boundTools.length,
        skills: boundSkills.length,
        mcp: boundMcpServers.length,
        knowledge: knowledgeCapabilityProjections.length,
      }),
      ready: capabilityBindingsReady,
      targetTab: 'capabilities' as ProfileTab,
    },
    {
      label: t('agent.builder.context.focus'),
      value: activeTabLabel,
      ready: true,
      targetTab: activeTab,
    },
  ];
  const builderContextPayload = {
    target_agent: {
      id: agent.id,
      name: agent.name,
      title: agent.title || agent.name,
      description: agent.description || '',
      system_prompt_configured: Boolean((agent.systemPrompt || '').trim()),
    },
    workbench: {
      active_tab: activeTab,
      active_tab_label: activeTabLabel,
    },
    runtime: {
      model_id: agent.model || '',
      model_label: modelLabel,
      model_type: selectedModel?.type || '',
    },
    context: {
      workspace_root_configured: Boolean(workspaceRoot),
      workspace_root: workspaceRoot || '',
      memory_enabled: Boolean(chatConfig.memory?.enabled),
      search_mode: chatConfig.searchMode || '',
    },
    bindings: {
      tools: boundTools.map(({ manifest }) => manifest.sourceInstanceId),
      mcp_servers: boundMcpServers.map(({ manifest }) => manifest.sourceInstanceId),
      skills: boundSkills.map(({ manifest }) => manifest.sourceInstanceId),
    },
  };
  const activeMode = ACTIVITY_TAB_KEYS.some((tab) => tab.key === activeTab) ? 'activity' : 'configure';
  const visibleTabs = activeMode === 'activity' ? ACTIVITY_TAB_KEYS : TAB_KEYS;
  const saveState = saveStateByAgentId[agent.id] || 'idle';
  const conflictReloading = Boolean(
    agentPendingMutations[`agent-profile-reload:${agent.id}`],
  );

  return (
    <Flexbox
      data-pt-agent-profile={agent.id}
      horizontal
      style={{ height: '100%', width: '100%', minWidth: 0, overflow: 'auto' }}
    >
      {!embedded && <aside
        style={{
          width: agentListOpen ? 230 : 48,
          height: '100%',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          padding: agentListOpen ? '14px 10px 58px' : '14px 0 58px',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        {agentListOpen ? (
          <>
            <Flexbox horizontal align="center" style={{ height: 36, marginBottom: 8 }}>
              <Bot size={18} color={token.colorPrimary} />
              <span style={{ flex: 1, marginLeft: 8, fontSize: 15, fontWeight: 800, color: token.colorText }}>
                {t('agent.chat.myAgents')}
              </span>
              {onOpenOrchestration && (
                <button
                  type="button"
                  onClick={onOpenOrchestration}
                  title={t('agent.chat.openCanvas')}
                  style={{
                    width: 28,
                    height: 28,
                    marginRight: 4,
                    border: 0,
                    borderRadius: 8,
                    background: 'transparent',
                    color: token.colorTextSecondary,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <Workflow size={17} />
                </button>
              )}
              <button
                type="button"
                onClick={handleCreateAgent}
                title={t('agent.sidebar.createAgent')}
                style={{
                  width: 28,
                  height: 28,
                  border: 0,
                  borderRadius: 8,
                  background: 'transparent',
                  color: token.colorTextSecondary,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Plus size={17} />
              </button>
            </Flexbox>
            <div style={{ marginBottom: 12 }}>
              <SearchBar
                value={agentSearch}
                onChange={(event) => setAgentSearch(event.target.value)}
                placeholder={t('agent.sidebar.searchAgents')}
                spotlight={false}
                size="small"
                style={{ height: 36 }}
              />
            </div>
            <Flexbox flex={1} gap={2} style={{ minHeight: 0, overflow: 'auto', padding: '0 0 10px' }}>
              {pinnedProfileAgents.length > 0 && (
                <div style={{ padding: '8px 8px 4px', color: token.colorTextTertiary, fontSize: 11, fontWeight: 800 }}>
                  {t('agent.chat.pinned')}
                </div>
              )}
              {pinnedProfileAgents.map((item) => {
                const active = agent?.name === item.name;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectProfileAgent(item)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 48,
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 10,
                      border: 0,
                      background: active ? token.colorFillSecondary : 'transparent',
                      color: token.colorText,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <AgentIconTile agent={item} size={32} selected={active} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title || item.name}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: token.colorTextTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.description || t('agent.canvas.agentFallback')}
                      </span>
                    </span>
                    <MoreHorizontal size={14} color={token.colorTextTertiary} />
                  </button>
                );
              })}
              <div style={{ padding: '8px 8px 4px', color: token.colorTextTertiary, fontSize: 11, fontWeight: 800 }}>
                {t('agent.chat.allAgents')}
              </div>
              {otherProfileAgents.map((item) => {
                const active = agent?.name === item.name;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectProfileAgent(item)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minHeight: 48,
                      width: '100%',
                      padding: '6px 8px',
                      borderRadius: 10,
                      border: 0,
                      background: active ? token.colorFillSecondary : 'transparent',
                      color: token.colorText,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <AgentIconTile agent={item} size={32} selected={active} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.title || item.name}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: token.colorTextTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.description || t('agent.canvas.agentFallback')}
                      </span>
                    </span>
                    <MoreHorizontal size={14} color={token.colorTextTertiary} />
                  </button>
                );
              })}
              {filteredProfileAgents.length === 0 && (
                <Empty description={t('agent.sidebar.noMatchingAgents')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </Flexbox>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={handleCreateAgent}
              title={t('agent.sidebar.createAgent')}
              style={{
                width: 40,
                height: 40,
                margin: '0 auto 10px',
                border: 0,
                borderRadius: 12,
                background: 'transparent',
                color: token.colorTextSecondary,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Plus size={18} />
            </button>
            <button
              type="button"
              onClick={() => setAgentListOpen(true)}
              title={t('agent.sidebar.searchAgents')}
              style={{
                width: 40,
                height: 40,
                margin: '0 auto 2px',
                border: 0,
                borderRadius: 12,
                background: 'transparent',
                color: token.colorTextSecondary,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Search size={18} />
            </button>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
              {collapsedPinnedAgents.length > 0 && <div style={{ width: 28, height: 1, margin: '18px 0 12px', background: token.colorBorderSecondary }} />}
              {collapsedPinnedAgents.map((item) => {
                const active = agent?.name === item.name;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      handleSelectProfileAgent(item);
                    }}
                    title={item.title || item.name}
                    style={{
                      width: 40,
                      height: 48,
                      borderRadius: 12,
                      border: 0,
                      background: active ? token.colorFillSecondary : 'transparent',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <AgentIconTile agent={item} size={30} selected={active} />
                  </button>
                );
              })}
              {collapsedOtherAgents.length > 0 && <div style={{ width: 28, height: 1, margin: '18px 0 12px', background: token.colorBorderSecondary }} />}
              {collapsedOtherAgents.map((item) => {
                const active = agent?.name === item.name;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      handleSelectProfileAgent(item);
                    }}
                    title={item.title || item.name}
                    style={{
                      width: 40,
                      height: 48,
                      borderRadius: 12,
                      border: 0,
                      background: active ? token.colorFillSecondary : 'transparent',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <AgentIconTile agent={item} size={30} selected={active} />
                  </button>
                );
              })}
            </div>
          </>
        )}
        <button
          type="button"
          onClick={() => setAgentListOpen(!agentListOpen)}
          title={t(agentListOpen ? 'agent.sidebar.collapseAgents' : 'agent.sidebar.expandAgents')}
          style={{
            position: 'absolute',
            left: 7,
            bottom: 14,
            width: 34,
            height: 34,
            borderRadius: 999,
            border: 0,
            background: 'transparent',
            boxShadow: 'none',
            color: token.colorTextSecondary,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          {agentListOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </aside>}

      {/* ── Center: Profile Editor ── */}
      <Flexbox flex={1} style={{ minWidth: embedded ? 0 : 680, minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            minHeight: 0,
            padding: '0 20px 20px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              maxWidth: 760,
              margin: '0 auto',
              width: '100%',
            }}
          >
            {/* ── Workbench Hero ── */}
            <div style={{ flexShrink: 0 }}>
              <AgentWorkbenchHero
                key={agent.id}
                agent={agent}
                onBack={onBack}
                onOpenSettings={() => setSettingsOpen(true)}
                onTitleBlur={handleTitleBlur}
                onDescriptionBlur={handleDescriptionBlur}
                onRewriteDescription={handleInlineRewriteDescription}
                onAvatarChange={handleAvatarChange}
                descriptionGenerating={descriptionGenerating}
              />
            </div>

            <div
              style={{
                flexShrink: 0,
                marginTop: 10,
                marginBottom: 10,
                display: 'grid',
                gridTemplateColumns: 'minmax(130px, 190px) auto minmax(160px, 1fr) auto minmax(96px, 120px)',
                alignItems: 'center',
                gap: 10,
                padding: 14,
                borderRadius: 12,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                minWidth: 0,
              }}
            >
              <Select
                value={selectedProviderId || undefined}
                onChange={handleProviderChange}
                placeholder={t('agent.profile.routing.providerPlaceholder')}
                allowClear
                showSearch
                size="middle"
                options={providerOptions}
                style={{ width: '100%' }}
                filterOption={(input, option) =>
                  String(option?.label || '').toLowerCase().includes(input.toLowerCase())
                }
              />
              <span style={{ color: token.colorTextQuaternary, fontSize: 13 }}>→</span>
              <div style={{ minWidth: 0 }}>
                <ModelSelect
                  models={routingModels}
                  value={agent.model || undefined}
                  onChange={handleModelChange}
                  placeholder={t('agent.profile.routing.modelPlaceholder')}
                  size="middle"
                  style={{ width: '100%', minWidth: 0 }}
                />
              </div>
              <span style={{ color: token.colorTextQuaternary, fontSize: 13 }}>·</span>
              <Select
                value={agent.effort || 'medium'}
                onChange={handleEffortChange}
                placeholder={t('agent.profile.routing.effortPlaceholder')}
                size="middle"
                style={{ width: '100%' }}
                options={[
                  { value: 'low', label: t('agent.profile.effort.low') },
                  { value: 'medium', label: t('agent.profile.effort.medium') },
                  { value: 'high', label: t('agent.profile.effort.high') },
                ]}
              />
            </div>
            <Flexbox
              data-pt-agent-profile-conflict={
                saveState === 'conflict' ? agent.id : undefined
              }
              data-pt-agent-profile-save-state={saveState}
              horizontal
              align="center"
              justify="flex-end"
              gap={8}
              style={{ marginTop: -6, marginBottom: 10 }}
            >
              <Tag
                color={
                  saveState === 'failed' || saveState === 'conflict'
                    ? 'red'
                    : saveState === 'saving'
                      ? 'blue'
                      : 'default'
                }
              >
                {saveState === 'conflict'
                  ? t('agent.errors.activeMutationConflict')
                  : t(`agent.profile.saveState.${saveState}`)}
              </Tag>
              {saveState === 'conflict' && (
                <Button
                  data-pt-agent-profile-reload={agent.id}
                  data-pt-agent-profile-reload-latest={agent.id}
                  type="link"
                  size="small"
                  loading={conflictReloading}
                  onClick={handleReloadLatest}
                  style={{ height: 24, paddingInline: 4 }}
                >
                  {t('agent.recovery.reloadLatest')}
                </Button>
              )}
            </Flexbox>

            {/* ── Prototype-aligned mode switch: Configure vs Activity ── */}
            <Flexbox
              horizontal
              align="center"
              gap={2}
              style={{
                alignSelf: 'flex-start',
                flexShrink: 0,
                padding: 3,
                marginBottom: 12,
                borderRadius: 10,
                background: token.colorFillQuaternary,
              }}
            >
              {([
                { key: 'configure', label: t('agent.profile.mode.configure'), target: 'soul' as ProfileTab },
                { key: 'activity', label: t('agent.profile.mode.activity'), target: 'tasks' as ProfileTab },
              ] as const).map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setActiveTab(mode.target)}
                  style={{
                    height: 30,
                    padding: '0 18px',
                    borderRadius: 8,
                    border: 0,
                    background: activeMode === mode.key ? token.colorBgContainer : 'transparent',
                    color: activeMode === mode.key ? token.colorText : token.colorTextTertiary,
                    boxShadow: activeMode === mode.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </Flexbox>

            {/* ── Tab bar (no font-weight change to prevent wobble) ── */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, borderBottom: `1px solid ${token.colorBorderSecondary}`, marginBottom: 12, flexWrap: 'wrap' }}>
              {visibleTabs.map((tab) => (
                <div
                  data-pt-agent-profile-tab={tab.key}
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    color:
                      activeTab === tab.key ? token.colorPrimary : token.colorTextSecondary,
                    borderBottom: `2px solid ${
                      activeTab === tab.key ? token.colorPrimary : 'transparent'
                    }`,
                    transition: 'color 0.2s, border-color 0.2s',
                  }}
                >
                  <span style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {tab.icon}
                  </span>
                  <span style={{ lineHeight: '18px' }}>
                    {t(tab.labelKey)}
                  </span>
                </div>
              ))}
            </div>

            {/* ── Tab content (fills remaining space) ── */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                paddingTop: 0,
                paddingBottom: 16,
                overflow: 'auto',
              }}
            >

              {activeTab === 'soul' && (
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, minHeight: 0 }}>
                    <ProfileCard title={t('agent.profile.section.soulMd')}>
                      <textarea
                        value={soulMd}
                        onChange={handleSoulMdChange}
                        onBlur={handleSoulMdBlur}
                        placeholder={t('agent.profile.soulMdPlaceholder')}
                        style={{
                          width: '100%',
                          minHeight: 280,
                          padding: '12px 16px',
                          borderRadius: 8,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          background: token.colorBgContainer,
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          fontSize: 13,
                          lineHeight: 1.7,
                          resize: 'vertical',
                          outline: 'none',
                          color: token.colorText,
                        }}
                        onFocus={(e) => {
                          (e.target as HTMLElement).style.borderColor = token.colorPrimary;
                        }}
                        onBlurCapture={(e) => {
                          (e.target as HTMLElement).style.borderColor = token.colorBorderSecondary;
                        }}
                      />
                    </ProfileCard>
                    <ProfileCard title={t('agent.profile.section.agentsMd')}>
                      <textarea
                        value={agentsMd}
                        onChange={handleAgentsMdChange}
                        onBlur={handleAgentsMdBlur}
                        placeholder={t('agent.profile.agentsMdPlaceholder')}
                        style={{
                          width: '100%',
                          minHeight: 280,
                          padding: '12px 16px',
                          borderRadius: 8,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          background: token.colorBgContainer,
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          fontSize: 13,
                          lineHeight: 1.7,
                          resize: 'vertical',
                          outline: 'none',
                          color: token.colorText,
                        }}
                        onFocus={(e) => {
                          (e.target as HTMLElement).style.borderColor = token.colorPrimary;
                        }}
                        onBlurCapture={(e) => {
                          (e.target as HTMLElement).style.borderColor = token.colorBorderSecondary;
                        }}
                      />
                    </ProfileCard>
                  </div>
                  <ProfileCard
                    title={t('agent.profile.section.systemPrompt')}
                    description={t('agent.profile.section.systemPromptDesc')}
                  >
                    <textarea
                      value={systemPrompt}
                      onChange={handleSystemPromptChange}
                      onBlur={handleSystemPromptBlur}
                      placeholder={t('agent.profile.systemPromptPlaceholder')}
                      style={{
                        width: '100%',
                        minHeight: 160,
                        padding: '12px 16px',
                        borderRadius: 8,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        background: token.colorBgContainer,
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        fontSize: 13,
                        lineHeight: 1.7,
                        resize: 'vertical',
                        outline: 'none',
                        color: token.colorText,
                      }}
                      onFocus={(e) => {
                        (e.target as HTMLElement).style.borderColor = token.colorPrimary;
                      }}
                      onBlurCapture={(e) => {
                        (e.target as HTMLElement).style.borderColor = token.colorBorderSecondary;
                      }}
                    />
                  </ProfileCard>
                </div>
              )}


              {activeTab === 'workspace' && (
                <div
                  style={{
                    overflow: 'auto',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                    gap: 12,
                    alignContent: 'start',
                  }}
                >
                  <ProfileCard title={t('agent.profile.section.agentWorkspace')} description={t('agent.profile.section.agentWorkspaceDesc')}>
                    <InfoRow label={t('agent.profile.field.workspaceRoot')} value={workspaceRoot || t('agent.profile.workspaceNotSet')} />
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 6 }}>
                        {t('agent.profile.field.workspaceMode')}
                      </div>
                      <Select
                        value={agent.workspaceMode || 'agent'}
                        onChange={handleWorkspaceModeChange}
                        style={{ minWidth: 180 }}
                        options={[
                          { value: 'agent', label: t('agent.profile.workspaceMode.agent') },
                          { value: 'task', label: t('agent.profile.workspaceMode.task') },
                        ]}
                      />
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 6 }}>
                        {t('agent.profile.field.workspaceRetentionDays')}
                      </div>
                      <InputNumber
                        min={1}
                        max={90}
                        value={agent.isolationRetentionDays ?? 7}
                        onChange={handleIsolationRetentionDaysChange}
                        style={{ minWidth: 140 }}
                      />
                    </div>
                  </ProfileCard>
                  <ProfileCard title={t('agent.profile.section.accessBoundary')} description={t('agent.profile.section.accessBoundaryDesc')}>
                    <InfoRow label={t('agent.profile.field.agentWorkspace')} value={t('agent.profile.accessBoundary.agentWorkspaceAllowed')} />
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 6 }}>
                        {t('agent.profile.field.allowedRoots')}
                      </div>
                      <Input.TextArea
                        value={allowedRootsText}
                        onChange={(event) => setAllowedRootsText(event.target.value)}
                        onBlur={handleAllowedRootsBlur}
                        placeholder={t('agent.profile.allowedRootsPlaceholder')}
                        autoSize={{ minRows: 2, maxRows: 4 }}
                      />
                    </div>
                  </ProfileCard>
                </div>
              )}

              {activeTab === 'capabilities' && (
                <div
                  style={{
                    overflow: 'auto',
                    display: 'grid',
                    gap: 12,
                    minHeight: 0,
                    alignContent: 'start',
                  }}
                >
                  <ProfileCard
                    title={t('agent.profile.section.skillPackages')}
                    description={t('agent.profile.section.skillPackagesDesc')}
                  >
                    <Flexbox gap={8} style={{ minHeight: 0 }}>
                      <Select
                        mode="multiple"
                        value={selectedSkillManifestKeys}
                        onChange={handleBoundSkillsChange}
                        options={skillOptions}
                        disabled={capabilityMutationPending}
                        loading={capabilityMutationPending}
                        placeholder={t('agent.profile.skills.bindPlaceholder')}
                        optionFilterProp="label"
                        style={{ width: '100%' }}
                      />
                      {boundSkills.length === 0 ? (
                        <Empty description={t('agent.profile.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : (
                        <Flexbox gap={6} style={{ overflow: 'auto', paddingRight: 2 }}>
                          {boundSkills.map(({ binding, manifest, readiness }) => (
                            <Flexbox
                              key={binding.bindingId}
                              horizontal
                              align="center"
                              gap={10}
                              style={{
                                minHeight: 40,
                                padding: '7px 10px',
                                borderRadius: 12,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background: token.colorBgContainer,
                              }}
                            >
                              <span style={{ width: 26, height: 26, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: token.colorPrimaryBg, color: token.colorPrimary, fontWeight: 800 }}>#</span>
                              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{capabilityLabel(manifest)}</span>
                              <CapabilityReadinessTag readiness={readiness} />
                            </Flexbox>
                          ))}
                        </Flexbox>
                      )}
                    </Flexbox>
                  </ProfileCard>

                  <ProfileCard
                    title={t('agent.profile.section.toolsAndMcp')}
                    description={t('agent.profile.section.toolsAndMcpDesc')}
                    action={(
                      <Button
                        size="small"
                        icon={<Settings2 size={14} />}
                        onClick={() => setSettingsOpen(true)}
                        title={t('agent.profile.editSettings')}
                        aria-label={t('agent.profile.editSettings')}
                        style={{ width: 32, height: 32, padding: 0 }}
                      />
                    )}
                  >
                    <Flexbox gap={6} style={{ minHeight: 0, overflow: 'auto' }}>
                      {boundTools.length === 0 && boundMcpServers.length === 0 ? (
                        <Empty description={t('agent.profile.mcpEmpty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : null}
                      {boundTools.map(({ binding, manifest, readiness }) => (
                        <Flexbox
                          key={binding.bindingId}
                          horizontal
                          align="center"
                          gap={10}
                          style={{
                            minHeight: 38,
                            padding: '7px 10px',
                            borderRadius: 12,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            background: token.colorBgContainer,
                          }}
                        >
                          <Wrench size={15} color={token.colorTextTertiary} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{capabilityLabel(manifest)}</span>
                          <Tag style={{ margin: 0 }}>{t('agent.profile.tag.tool')}</Tag>
                          <CapabilityReadinessTag readiness={readiness} />
                        </Flexbox>
                      ))}
                      {boundMcpServers.map(({ binding, manifest, readiness }) => (
                        <Flexbox
                          key={binding.bindingId}
                          horizontal
                          align="center"
                          gap={10}
                          style={{
                            minHeight: 38,
                            padding: '7px 10px',
                            borderRadius: 12,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            background: token.colorBgContainer,
                          }}
                        >
                          <Cpu size={15} color={token.colorTextTertiary} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{capabilityLabel(manifest)}</span>
                          <Tag style={{ margin: 0 }}>{t('agent.profile.tag.mcp')}</Tag>
                          <CapabilityReadinessTag readiness={readiness} />
                        </Flexbox>
                      ))}
                    </Flexbox>
                  </ProfileCard>

                  <ProfileCard
                    title={t('agent.profile.section.knowledge')}
                    description={t('agent.profile.section.knowledgeDesc')}
                    action={(
                      <Flexbox horizontal gap={6} align="center">
                        <Button
                          data-pt-agent-knowledge-add-toggle
                          size="small"
                          icon={<Plus size={14} />}
                          onClick={() => setKnowledgeAddOpen(!knowledgeAddOpen)}
                          title={t('agent.profile.knowledge.add')}
                          aria-label={t('agent.profile.knowledge.add')}
                          style={{ height: 32, padding: '0 12px' }}
                        >
                          {t('agent.profile.knowledge.add')}
                        </Button>
                      </Flexbox>
                    )}
                  >
                    {knowledgeAddOpen && (
                      <Flexbox
                        gap={8}
                        style={{
                          padding: 12,
                          borderRadius: 10,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          background: token.colorFillQuaternary,
                          marginBottom: 8,
                        }}
                      >
                        <Flexbox horizontal gap={8} align="center">
                          <Select
                            value={knowledgeAddType}
                            onChange={(value) => setKnowledgeAddType(value)}
                            style={{ width: 130 }}
                            size="small"
                            options={[
                              { value: KnowledgeResourceKind.DOCUMENT, label: t('agent.profile.knowledge.type.document') },
                              { value: KnowledgeResourceKind.FOLDER, label: t('agent.profile.knowledge.type.folder') },
                              { value: KnowledgeResourceKind.PROJECT, label: t('agent.profile.knowledge.type.project') },
                              { value: KnowledgeResourceKind.URL_SNAPSHOT, label: t('agent.profile.knowledge.type.url') },
                              { value: KnowledgeResourceKind.NOTEBOOK, label: t('agent.profile.knowledge.type.notebook') },
                              { value: KnowledgeResourceKind.WORKSPACE, label: t('agent.profile.knowledge.type.workspace') },
                            ]}
                          />
                          <Input
                            data-pt-agent-knowledge-source
                            value={knowledgeAddContent}
                            onChange={(e) => setKnowledgeAddContent(e.target.value)}
                            placeholder={t('agent.profile.knowledge.contentPlaceholder')}
                            size="small"
                            style={{ flex: 1 }}
                            onPressEnter={handleKnowledgeAddSubmit}
                          />
                        </Flexbox>
                        <Flexbox horizontal gap={8} align="center">
                          <Input
                            data-pt-agent-knowledge-title
                            value={knowledgeAddTitle}
                            onChange={(e) => setKnowledgeAddTitle(e.target.value)}
                            placeholder={t('agent.profile.knowledge.titlePlaceholder')}
                            size="small"
                            style={{ flex: 1 }}
                            onPressEnter={handleKnowledgeAddSubmit}
                          />
                          <Button
                            data-pt-agent-knowledge-submit
                            size="small"
                            type="primary"
                            onClick={handleKnowledgeAddSubmit}
                          >
                            {t('agent.profile.knowledge.add')}
                          </Button>
                        </Flexbox>
                      </Flexbox>
                    )}
                    <Flexbox gap={6} style={{ minHeight: 0, overflow: 'auto' }}>
                      {knowledgeCapabilityProjections.length === 0 ? (
                        <Empty description={t('agent.profile.knowledge.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : (
                        knowledgeCapabilityProjections.map((resource) => {
                          const isDisabled = !resource.binding.enabled;
                          const kind = knowledgeResourceKindKey(resource.descriptor.resourceKind);
                          const ResourceIcon = kind === 'url' ? Globe
                            : kind === 'folder' || kind === 'project' || kind === 'workspace' ? FolderOpen
                            : kind === 'notebook' ? BookOpen
                            : FileText;
                          return (
                            <Flexbox
                              data-pt-agent-knowledge-resource={resource.descriptor.resourceId}
                              key={resource.binding.bindingId}
                              horizontal
                              align="center"
                              gap={10}
                              style={{
                                minHeight: 40,
                                padding: '7px 10px',
                                borderRadius: 12,
                                border: `1px solid ${token.colorBorderSecondary}`,
                                background: token.colorBgContainer,
                                opacity: isDisabled ? 0.5 : 1,
                              }}
                            >
                              <ResourceIcon size={15} color={token.colorTextTertiary} />
                              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {resource.descriptor.title}
                              </span>
                              <Tag style={{ margin: 0 }}>
                                {t(`agent.profile.knowledge.type.${kind}`)}
                              </Tag>
                              <KnowledgeAvailabilityTag availability={resource.descriptor.availability} />
                              <button
                                data-pt-agent-knowledge-policy={resource.descriptor.resourceId}
                                type="button"
                                onClick={() => handleToggleKnowledgeResource(resource)}
                                title={isDisabled ? t('agent.profile.knowledge.policy.manual') : t('agent.profile.knowledge.policy.disabled')}
                                style={{
                                  width: 28,
                                  height: 28,
                                  border: 0,
                                  borderRadius: 6,
                                  background: 'transparent',
                                  color: isDisabled ? token.colorTextQuaternary : token.colorSuccess,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 12,
                                  fontWeight: 700,
                                }}
                              >
                                {isDisabled ? t('agent.profile.knowledge.policy.disabled') : t('agent.profile.knowledge.status.bound')}
                              </button>
                              <button
                                data-pt-agent-knowledge-remove={resource.descriptor.resourceId}
                                type="button"
                                onClick={() => handleRemoveKnowledgeResource(resource)}
                                title={t('agent.profile.knowledge.remove')}
                                style={{
                                  width: 24,
                                  height: 24,
                                  border: 0,
                                  borderRadius: 6,
                                  background: 'transparent',
                                  color: token.colorTextTertiary,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <X size={14} />
                              </button>
                            </Flexbox>
                          );
                        })
                      )}
                    </Flexbox>
                  </ProfileCard>

                  <ProfileCard
                    title={t('agent.connectors.title')}
                    description={t('agent.connectors.description')}
                  >
                    <AgentConnectorsPanel
                      agentId={agent.id}
                      onNavigateToSettings={() => setSettingsOpen(true)}
                    />
                  </ProfileCard>
                </div>
              )}

              {activeTab === 'memories' && <MemoryTab agentName={agent.name} agentId={agent.id} />}


              {activeTab === 'tasks' && (
                <AgentActivityPanel
                  tasks={activityProjection.tasks}
                  events={activityProjection.events}
                  isCurrentAgentSession={isCurrentAgentActivitySession}
                  currentSessionTitle={activityCurrentSession?.title || activityCurrentSession?.key || ''}
                  traceLoading={activityTraceLoading}
                  traceLoadError={activityTraceLoadError}
                  persistedTraceCount={persistedTraceCount}
                />
              )}


              {activeTab === 'events' && (
                <Flexbox gap={8} style={{ overflow: 'auto' }}>
                  {activityProjection.events.length === 0 ? (
                    <Empty description={t('agent.profile.activity.noEvents')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    activityProjection.events.map((event) => (
                      <div
                        key={event.id}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          background: token.colorBgContainer,
                        }}
                      >
                        <Flexbox horizontal align="center" justify="space-between" gap={10}>
                          <span style={{ fontSize: 13, color: token.colorText }}>{event.detail}</span>
                          <Tag style={{ margin: 0 }}>{event.kind}</Tag>
                        </Flexbox>
                      </div>
                    ))
                  )}
                </Flexbox>
              )}

            </div>
          </div>
        </div>
      </Flexbox>

      {/* ── Right: Agent Builder Panel ── */}
      <BuilderPanel
        agentName="agent-builder"
        scope="agent_builder"
        welcomeTitle={t('agent.builder.title')}
        welcomeDescription={t('agent.builder.description')}
        suggestQuestions={[
          t('agent.builder.suggest.optimizeDescription'),
          t('agent.builder.suggest.customerSupport'),
          t('agent.builder.suggest.codeReview'),
          t('agent.builder.suggest.researchAnalyst'),
        ]}
        contextSummary={builderContextSummary}
        onContextItemClick={(targetTab) => {
          const nextTab = targetTab as ProfileTab;
          if ([...TAB_KEYS, ...ACTIVITY_TAB_KEYS].some((tab) => tab.key === nextTab)) setActiveTab(nextTab);
        }}
        contextPayload={builderContextPayload}
        expand={showBuilder}
        onExpandChange={setShowBuilder}
        defaultWidth={320}
        minWidth={320}
        maxWidth={480}
      />

      {/* Advanced Settings Modal */}
      {settingsOpen && (
        <AgentSettingsModal
          open={settingsOpen}
          agent={agent}
          onClose={() => setSettingsOpen(false)}
          onSaved={handleSettingsSaved}
        />
      )}
    </Flexbox>
  );
}

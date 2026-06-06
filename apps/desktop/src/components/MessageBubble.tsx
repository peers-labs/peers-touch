import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Avatar, Markdown, Tag, Dropdown, TextArea, toast } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import type { MenuProps } from '@lobehub/ui';
import { Drawer, theme } from 'antd';
import {
  Wrench,
  Loader2,
  Copy,
  Check,
  RotateCcw,
  Edit,
  Trash2,
  Share2,
  ListRestart,
  ChevronsDownUp,
  ChevronsUpDown,
  MoreHorizontal,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Volume2,
  VolumeX,
  AlertTriangle,
  BookOpen,
  Terminal,
  Brain,
  PackageCheck,
  Link2,
} from 'lucide-react';
import type { ChatMessage, ToolCallInfo } from '../store/chat';
import { useChatStore } from '../store/chat';
import { listAgentTurnTraces, type AgentRuntimeAsset, type AgentTurnTrace } from '../services/desktop_api';
import { UserSquareAvatar } from './common/UserSquareAvatar';
import MessageCard, { type CardData } from './MessageCard';
import { parseDeepLink } from '../utils/deeplink';
import { EVENT, eventBus } from '../kernel/events';
import { useTranslation } from 'react-i18next';

interface Props {
  message: ChatMessage;
  userAvatar?: { url?: string; name: string };
  agentAvatar?: string;
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''} ago`;
  return new Date(ts).toLocaleDateString();
}

function fullTime(ts: number): string {
  return new Date(ts).toLocaleString('sv-SE').replace('T', ' ');
}

function MiniButton({
  icon,
  title,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
}) {
  const { token } = theme.useToken();
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        borderRadius: 6,
        cursor: 'pointer',
        background: hovered ? token.colorFillSecondary : 'transparent',
        color: token.colorTextTertiary,
        transition: 'all 0.15s',
      }}
    >
      {icon}
    </div>
  );
}

function ToolCallItem({ tool }: { tool: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  return (
    <div style={{ borderRadius: 6, overflow: 'hidden' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          cursor: 'pointer',
          borderRadius: 6,
          fontSize: 12,
          color: token.colorTextSecondary,
          background: 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = token.colorFillQuaternary; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        {expanded
          ? <ChevronDown size={12} style={{ flexShrink: 0 }} />
          : <ChevronRight size={12} style={{ flexShrink: 0 }} />
        }
        {tool.pending
          ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: token.colorPrimary, flexShrink: 0 }} />
          : <CheckCircle2 size={12} style={{ color: token.colorSuccess, flexShrink: 0 }} />
        }
        <span style={{ fontWeight: 500 }}>{tool.name}</span>
        {tool.args && !expanded && (
          <span style={{ color: token.colorTextQuaternary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
            {tool.args.length > 60 ? tool.args.slice(0, 60) + '…' : tool.args}
          </span>
        )}
      </div>
      {expanded && (
        <div style={{
          padding: '4px 8px 8px 26px',
          fontSize: 12,
          color: token.colorTextTertiary,
        }}>
          {tool.args && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 500, marginBottom: 2, color: token.colorTextSecondary }}>{t('chat.message.toolCall.arguments')}</div>
              <pre style={{
                margin: 0,
                padding: '4px 8px',
                borderRadius: 4,
                background: token.colorFillQuaternary,
                fontSize: 11,
                overflow: 'auto',
                maxHeight: 120,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>{tool.args}</pre>
            </div>
          )}
          {tool.result && (
            <div>
              <div style={{ fontWeight: 500, marginBottom: 2, color: token.colorTextSecondary }}>{t('chat.message.toolCall.result')}</div>
              <pre style={{
                margin: 0,
                padding: '4px 8px',
                borderRadius: 4,
                background: token.colorFillQuaternary,
                fontSize: 11,
                overflow: 'auto',
                maxHeight: 160,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}>{tool.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolCallsBlock({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const pendingCount = toolCalls.filter((tc) => tc.pending).length;
  const doneCount = toolCalls.length - pendingCount;

  const summary = pendingCount > 0
    ? t('chat.message.toolCall.using', { count: toolCalls.length })
    : t('chat.message.toolCall.used', { count: doneCount });

  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${token.colorBorderSecondary}`,
      background: token.colorFillQuaternary,
      marginBottom: 8,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
          color: token.colorTextSecondary,
        }}
      >
        {expanded
          ? <ChevronDown size={13} style={{ flexShrink: 0 }} />
          : <ChevronRight size={13} style={{ flexShrink: 0 }} />
        }
        <Wrench size={13} style={{ flexShrink: 0, color: token.colorTextTertiary }} />
        <span>{summary}</span>
        {pendingCount > 0 && (
          <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: token.colorPrimary, marginLeft: 'auto' }} />
        )}
      </div>
      {expanded && (
        <div style={{ padding: '0 4px 4px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
          {toolCalls.map((tc) => (
            <ToolCallItem key={tc.id} tool={tc} />
          ))}
        </div>
      )}
    </div>
  );
}

function runtimeAssetLabel(item: AgentRuntimeAsset): string {
  const label = item.title || item.name || item.identifier || item.id || item.type || item.kind;
  return typeof label === 'string' && label.trim() ? label : 'item';
}

function RuntimeAssetSection({
  icon,
  title,
  items,
}: {
  icon: ReactNode;
  title: string;
  items: AgentRuntimeAsset[];
}) {
  const { token } = theme.useToken();
  if (items.length === 0) return null;
  return (
    <Flexbox gap={6}>
      <Flexbox horizontal align="center" gap={6} style={{ fontSize: 12, color: token.colorTextSecondary, fontWeight: 600 }}>
        {icon}
        <span>{title}</span>
      </Flexbox>
      <Flexbox horizontal gap={6} wrap="wrap">
        {items.slice(0, 8).map((item, index) => (
          <Tag key={`${runtimeAssetLabel(item)}-${index}`} style={{ margin: 0, fontSize: 11 }}>
            {runtimeAssetLabel(item)}
          </Tag>
        ))}
        {items.length > 8 && (
          <Tag style={{ margin: 0, fontSize: 11 }}>+{items.length - 8}</Tag>
        )}
      </Flexbox>
    </Flexbox>
  );
}

function RuntimeContextBlock({ message }: { message: ChatMessage }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const assets = message.runtimeAssets;
  const memories = Array.isArray(assets?.memories) ? assets.memories : [];
  const skills = Array.isArray(assets?.skills) ? assets.skills : [];
  const tools = Array.isArray(assets?.tools) ? assets.tools : [];
  const mcp = Array.isArray(assets?.mcp) ? assets.mcp : [];
  const memoryWrite = assets?.memory_write;
  const total =
    memories.length +
    skills.length +
    tools.length +
    mcp.length +
    (memoryWrite ? 1 : 0);

  if (total === 0 && !message.memoryCount && !message.skillCount && !message.toolCount) {
    return null;
  }

  return (
    <div
      style={{
        borderRadius: 8,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        marginBottom: 8,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: 12,
          fontWeight: 500,
          color: token.colorTextSecondary,
        }}
      >
        {expanded
          ? <ChevronDown size={13} style={{ flexShrink: 0 }} />
          : <ChevronRight size={13} style={{ flexShrink: 0 }} />
        }
        <Brain size={13} style={{ flexShrink: 0, color: token.colorTextTertiary }} />
        <span>{t('chat.message.runtime.summary', {
          memory: message.memoryCount ?? memories.length,
          skills: message.skillCount ?? skills.length,
          tools: message.toolCount ?? (tools.length + mcp.length),
        })}</span>
      </div>
      {expanded && (
        <Flexbox gap={10} style={{ padding: '8px 10px 10px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
          <RuntimeAssetSection
            icon={<Brain size={13} />}
            title={t('chat.message.runtime.memoryUsed', { count: memories.length })}
            items={memories}
          />
          {memoryWrite && (
            <Flexbox horizontal align="center" gap={6} style={{ fontSize: 12, color: token.colorTextSecondary }}>
              <CheckCircle2 size={13} style={{ color: token.colorSuccess }} />
              <span>{t('chat.message.runtime.memoryWrite')}</span>
              <Tag color="green" style={{ margin: 0, fontSize: 11 }}>{String(memoryWrite.status || 'recorded')}</Tag>
            </Flexbox>
          )}
          <RuntimeAssetSection
            icon={<PackageCheck size={13} />}
            title={t('chat.message.runtime.skillsLoaded', { count: skills.length })}
            items={skills}
          />
          <RuntimeAssetSection
            icon={<Wrench size={13} />}
            title={t('chat.message.runtime.toolsProjected', { count: tools.length })}
            items={tools}
          />
          <RuntimeAssetSection
            icon={<Link2 size={13} />}
            title={t('chat.message.runtime.mcpProjected', { count: mcp.length })}
            items={mcp}
          />
        </Flexbox>
      )}
    </div>
  );
}

function TraceInfoRow({ label, value }: { label: string; value?: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flexbox horizontal justify="space-between" align="flex-start" gap={12} style={{ padding: '7px 0' }}>
      <span style={{ fontSize: 12, color: token.colorTextSecondary, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 12, color: token.colorText, textAlign: 'right', wordBreak: 'break-word' }}>
        {value ?? '-'}
      </span>
    </Flexbox>
  );
}

function TraceDetailDrawer({
  open,
  loading,
  trace,
  fallback,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  trace: AgentTurnTrace | null;
  fallback: ChatMessage;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const firstCall = trace?.provider_calls?.[0];
  return (
    <Drawer
      title={t('chat.message.trace.title')}
      open={open}
      onClose={onClose}
      width={380}
      styles={{ body: { padding: 16 } }}
    >
      <Flexbox gap={12}>
        {loading ? (
          <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>{t('chat.message.trace.loading')}</span>
        ) : (
          <>
            {!trace && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: token.colorFillQuaternary,
                  color: token.colorTextSecondary,
                  fontSize: 12,
                }}
              >
                {t('chat.message.trace.notFound')}
              </div>
            )}
            <div style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
              <TraceInfoRow label={t('chat.message.trace.traceId')} value={trace?.id || fallback.traceId} />
              <TraceInfoRow label={t('chat.message.trace.status')} value={trace?.status || t('chat.message.trace.currentTurn')} />
              <TraceInfoRow label={t('chat.message.trace.conversation')} value={trace?.conversation_id} />
              <TraceInfoRow label={t('chat.message.trace.agent')} value={trace?.agent_id} />
              <TraceInfoRow label={t('chat.message.trace.promptHash')} value={trace?.prompt_hash} />
              <TraceInfoRow label={t('chat.message.trace.createdAt')} value={trace?.created_at} />
            </div>
            <div style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
              <TraceInfoRow label={t('chat.message.trace.memory')} value={trace?.memory_count ?? fallback.memoryCount ?? 0} />
              <TraceInfoRow label={t('chat.message.trace.skills')} value={trace?.skill_count ?? fallback.skillCount ?? 0} />
              <TraceInfoRow label={t('chat.message.trace.tools')} value={trace?.tool_count ?? fallback.toolCount ?? 0} />
            </div>
            <div>
              <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t('chat.message.trace.providerCall')}</span>
                <Tag
                  bordered={false}
                  color={(firstCall?.capability?.black_box ?? fallback.providerBlackBox) ? 'warning' : 'success'}
                  style={{ margin: 0, fontSize: 11 }}
                >
                  {(firstCall?.capability?.black_box ?? fallback.providerBlackBox)
                    ? t('chat.message.provider.cliBlackBox')
                    : t('chat.message.provider.structured')}
                </Tag>
              </Flexbox>
              <TraceInfoRow label={t('chat.message.trace.provider')} value={firstCall?.provider_id || fallback.providerId} />
              <TraceInfoRow label={t('chat.message.trace.model')} value={firstCall?.model || fallback.model} />
              <TraceInfoRow label={t('chat.message.trace.kind')} value={firstCall?.provider_kind || fallback.providerKind} />
              <TraceInfoRow label={t('chat.message.trace.protocol')} value={firstCall?.protocol || fallback.providerProtocol} />
              <TraceInfoRow label={t('chat.message.trace.latency')} value={firstCall ? `${firstCall.latency_ms} ms` : undefined} />
              <TraceInfoRow label={t('chat.message.trace.streaming')} value={(firstCall?.capability?.stream ?? fallback.providerCapabilities?.stream) ? t('chat.message.trace.yes') : t('chat.message.trace.no')} />
              <TraceInfoRow label={t('chat.message.trace.toolCall')} value={(firstCall?.capability?.tool_call ?? fallback.providerCapabilities?.toolCall) ? t('chat.message.trace.yes') : t('chat.message.trace.no')} />
              <TraceInfoRow label={t('chat.message.trace.cancel')} value={(firstCall?.capability?.cancel ?? fallback.providerCapabilities?.cancel) ? t('chat.message.trace.yes') : t('chat.message.trace.no')} />
              {firstCall?.error_message && (
                <TraceInfoRow label={t('chat.message.trace.error')} value={`${firstCall.error_code || ''} ${firstCall.error_message}`} />
              )}
            </div>
          </>
        )}
      </Flexbox>
    </Drawer>
  );
}

export function MessageBubble({ message, userAvatar, agentAvatar }: Props) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceDetail, setTraceDetail] = useState<AgentTurnTrace | null>(null);
  const editRef = useRef<any>(null);

  const { deleteMessage, editMessage, regenerateMessage, saveMessageToNotebook, availableModels } = useChatStore();

  const handleReadAloud = useCallback(() => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [speaking, message.content]);

  useEffect(() => {
    return () => { window.speechSynthesis.cancel(); };
  }, []);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus({ cursor: 'end' });
    }
  }, [editing]);

  const handleCopy = useCallback(() => {
    let text = message.content;
    if (message.toolCalls && message.toolCalls.length > 0) {
      const toolText = message.toolCalls
        .map((tc) => {
          let s = `\n---\n**Tool: ${tc.name}**`;
          if (tc.args) s += `\nArguments: \`${tc.args}\``;
          if (tc.result) s += `\nResult:\n${tc.result}`;
          return s;
        })
        .join('\n');
      text = toolText + '\n\n' + text;
    }
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success(t('chat.message.toast.copied'));
      setTimeout(() => setCopied(false), 2000);
    });
  }, [message.content, message.toolCalls]);

  const handleRegenerate = useCallback(() => {
    regenerateMessage(message.id);
  }, [regenerateMessage, message.id]);

  const handleDelAndRegenerate = useCallback(() => {
    regenerateMessage(message.id);
  }, [regenerateMessage, message.id]);

  const handleDelete = useCallback(() => {
    deleteMessage(message.id);
  }, [deleteMessage, message.id]);

  const handleStartEdit = useCallback(() => {
    setEditContent(message.content);
    setEditing(true);
  }, [message.content]);

  const handleSaveEdit = useCallback(() => {
    if (editContent.trim() !== message.content) {
      editMessage(message.id, editContent.trim());
    }
    setEditing(false);
  }, [editContent, message.content, message.id, editMessage]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const handleSaveToNotebook = useCallback(() => {
    saveMessageToNotebook(message);
    toast.success(t('chat.message.toast.savedToNotebook'));
  }, [saveMessageToNotebook, message]);

  const handleOpenTrace = useCallback(async () => {
    if (!message.traceId && !message.providerKind) return;
    setTraceOpen(true);
    setTraceLoading(true);
    try {
      const traces = await listAgentTurnTraces();
      setTraceDetail(traces.find((item) => item.id === message.traceId) || null);
    } catch {
      setTraceDetail(null);
    } finally {
      setTraceLoading(false);
    }
  }, [message.traceId, message.providerKind]);

  const assistantMoreMenu: MenuProps['items'] = [
    { key: 'edit', icon: <Edit size={14} />, label: t('chat.message.action.edit'), onClick: handleStartEdit },
    { key: 'copy', icon: <Copy size={14} />, label: t('chat.message.action.copy'), onClick: handleCopy },
    {
      key: 'collapse',
      icon: collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />,
      label: collapsed ? t('chat.message.action.expandMessage') : t('chat.message.action.collapseMessage'),
      onClick: () => setCollapsed(!collapsed),
    },
    { type: 'divider' },
    { key: 'save-notebook', icon: <BookOpen size={14} />, label: t('chat.message.action.saveToNotebook'), onClick: handleSaveToNotebook },
    { key: 'share', icon: <Share2 size={14} />, label: t('chat.message.action.share') },
    { type: 'divider' },
    { key: 'regenerate', icon: <RotateCcw size={14} />, label: t('chat.message.action.regenerate'), onClick: handleRegenerate },
    { key: 'del-regen', icon: <ListRestart size={14} />, label: t('chat.message.action.delAndRegenerate'), onClick: handleDelAndRegenerate },
    { key: 'delete', icon: <Trash2 size={14} />, label: t('chat.message.action.delete'), danger: true, onClick: handleDelete },
  ];

  const userMoreMenu: MenuProps['items'] = [
    { key: 'edit', icon: <Edit size={14} />, label: t('chat.message.action.edit'), onClick: handleStartEdit },
    { key: 'copy', icon: <Copy size={14} />, label: t('chat.message.action.copy'), onClick: handleCopy },
    { key: 'save-notebook', icon: <BookOpen size={14} />, label: t('chat.message.action.saveToNotebook'), onClick: handleSaveToNotebook },
    { type: 'divider' },
    { key: 'regenerate', icon: <RotateCcw size={14} />, label: t('chat.message.action.regenerate'), onClick: handleRegenerate },
    { key: 'delete', icon: <Trash2 size={14} />, label: t('chat.message.action.delete'), danger: true, onClick: handleDelete },
  ];

  // Card-type messages: schema-driven rendering
  const cardData = useMemo<CardData | null>(() => {
    if (message.contentType !== 'card') return null;
    try {
      return JSON.parse(message.content) as CardData;
    } catch {
      return null;
    }
  }, [message.content, message.contentType]);

  const handleDeepLinkNav = useCallback((uri: string) => {
    const parsed = parseDeepLink(uri);
    if (!parsed) return;
    eventBus.publish(EVENT.NAVIGATION_REQUESTED, parsed);
  }, []);

  if (cardData) {
    return (
      <Flexbox
        align="flex-start"
        gap={8}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ position: 'relative', paddingBlock: 8, paddingInlineEnd: 36 }}
      >
        <Flexbox direction="horizontal" align="center" gap={8}>
          <Avatar
            avatar={agentAvatar || '🤖'}
            size={32}
            shape="square"
            background="linear-gradient(135deg, #667eea, #764ba2)"
            style={{ flexShrink: 0 }}
          />
          <span
            style={{
              fontSize: 12,
              color: token.colorTextQuaternary,
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.2s',
            }}
            title={fullTime(message.timestamp)}
          >
            {timeAgo(message.timestamp)}
          </span>
        </Flexbox>

        <Flexbox gap={8} style={{ maxWidth: '100%', overflow: 'hidden', width: '100%' }}>
          <MessageCard card={cardData} onNavigate={handleDeepLinkNav} />

          {/* Card action bar: Copy + Delete only */}
          <div
            style={{
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              alignSelf: 'flex-start',
              background: hovered ? token.colorBgElevated : 'transparent',
              borderRadius: 8,
              boxShadow: hovered ? token.boxShadowTertiary : 'none',
              padding: '2px 4px',
              height: 28,
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? 'auto' : 'none',
              transition: 'opacity 0.2s',
            }}
          >
            <MiniButton icon={copied ? <Check size={14} /> : <Copy size={14} />} title={t('chat.message.action.copy')} onClick={handleCopy} />
            <MiniButton icon={<Trash2 size={14} />} title={t('chat.message.action.delete')} onClick={handleDelete} />
          </div>
        </Flexbox>
      </Flexbox>
    );
  }

  if (isTool) {
    return (
      <Flexbox style={{ padding: '4px 0' }}>
        <Flexbox
          style={{
            borderRadius: 8,
            padding: '8px 12px',
            background: token.colorFillQuaternary,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {message.toolName && (
            <Flexbox horizontal align="center" gap={6} style={{ marginBottom: 6 }}>
              <Wrench size={13} style={{ color: token.colorTextSecondary }} />
              <Tag bordered={false} color="processing" style={{ margin: 0, fontSize: 12 }}>
                {message.toolName}
              </Tag>
            </Flexbox>
          )}
          <Markdown variant="chat">{message.content}</Markdown>
        </Flexbox>
      </Flexbox>
    );
  }

  // LobeChat layout reference:
  // - Outer: vertical Flexbox, align flex-end (user) / flex-start (assistant)
  // - paddingBlock: 12 (LobeChat uses generous vertical spacing between messages)
  // - User: paddingInlineStart: 48 (leave space so bubble doesn't fill full width)
  // - Assistant: paddingInlineEnd: 48
  // - User bubble: content-based width, max-width 100%, colorFillTertiary bg, no border
  // - Assistant bubble: width 100%, borderRadiusLG, padding 8px 12px
  return (
    <>
    <Flexbox
      align={isUser ? 'flex-end' : 'flex-start'}
      gap={8}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        paddingBlock: 8,
        paddingInlineStart: isUser ? 36 : 0,
        paddingInlineEnd: isUser ? 0 : 36,
      }}
    >
      {/* Header: avatar + timestamp */}
      <Flexbox
        direction={isUser ? 'horizontal-reverse' : 'horizontal'}
        align="center"
        gap={8}
      >
        {isUser ? (
          <UserSquareAvatar remoteUrl={userAvatar?.url} name={userAvatar?.name} size={32} radius={8} />
        ) : (
          <Avatar
            avatar={agentAvatar || '🤖'}
            size={32}
            shape="square"
            background="linear-gradient(135deg, #667eea, #764ba2)"
            style={{ flexShrink: 0 }}
          />
        )}
        <span
          style={{
            fontSize: 12,
            color: token.colorTextQuaternary,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.2s',
          }}
          title={fullTime(message.timestamp)}
        >
          {timeAgo(message.timestamp)}
        </span>
      </Flexbox>

      {/* Message body — LobeChat: user width=auto, assistant width=100% */}
      <Flexbox
        gap={8}
        style={{
          maxWidth: '100%',
          overflow: 'hidden',
          position: 'relative',
          width: isUser ? undefined : '100%',
        }}
      >
        {/* Message bubble — LobeChat style:
            User: colorFillTertiary bg, no border, content-based width, borderRadiusLG
            Assistant: colorBgContainer bg, no border, full width, borderRadiusLG */}
        <div
          style={{
            borderRadius: token.borderRadiusLG,
            padding: editing ? 4 : '8px 12px',
            background: isUser ? token.colorFillTertiary : 'transparent',
            alignSelf: isUser ? 'flex-end' : 'flex-start',
          }}
        >
          {message.images && message.images.length > 0 && (
            <Flexbox horizontal gap={8} wrap="wrap" style={{ marginBottom: message.content ? 8 : 0 }}>
              {message.images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  style={{
                    maxWidth: 240, maxHeight: 240, borderRadius: 8,
                    objectFit: 'contain', cursor: 'pointer',
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}
                  onClick={() => window.open(src, '_blank')}
                />
              ))}
            </Flexbox>
          )}

          {/* Tool calls block — LobeChat style: collapsed accordion within assistant message */}
          {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallsBlock toolCalls={message.toolCalls} />
          )}

          {!isUser && !message.loading && (
            <RuntimeContextBlock message={message} />
          )}

          {editing ? (
            <Flexbox gap={8}>
              <TextArea
                ref={editRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 12 }}
                style={{ fontSize: 14 }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') handleCancelEdit();
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveEdit();
                }}
              />
              <Flexbox horizontal gap={8} justify="flex-end">
                <button
                  onClick={handleCancelEdit}
                  style={{
                    padding: '4px 12px', borderRadius: 6,
                    border: `1px solid ${token.colorBorder}`,
                    background: token.colorBgContainer,
                    color: token.colorText, cursor: 'pointer', fontSize: 12,
                  }}
                >
                  {t('chat.message.edit.cancel')}
                </button>
                <button
                  onClick={handleSaveEdit}
                  style={{
                    padding: '4px 12px', borderRadius: 6, border: 'none',
                    background: token.colorPrimary, color: '#fff',
                    cursor: 'pointer', fontSize: 12,
                  }}
                >
                  {t('chat.message.edit.save')}
                </button>
              </Flexbox>
            </Flexbox>
          ) : message.loading && !message.content && !(message.toolCalls && message.toolCalls.length > 0) ? (
            <Loader2
              size={16}
              style={{ animation: 'spin 1s linear infinite', color: token.colorPrimary }}
            />
          ) : collapsed ? (
            <div
              style={{ fontSize: 13, color: token.colorTextDescription, fontStyle: 'italic', cursor: 'pointer' }}
              onClick={() => setCollapsed(false)}
            >
              [Message collapsed — click to expand]
            </div>
          ) : message.content ? (
            <>
              {!isUser && (() => {
                const audioMatch = message.content.match(/\/api\/uploads\/[^\s]+\.(mp3|ogg|wav|webm)/);
                if (!audioMatch) return null;
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', marginBottom: 8,
                    borderRadius: 8, background: token.colorFillQuaternary,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}>
                    <Volume2 size={16} style={{ color: token.colorPrimary, flexShrink: 0 }} />
                    <audio controls style={{ flex: 1, height: 32 }} src={audioMatch[0]} />
                  </div>
                );
              })()}
              <div className="selectable">
                <Markdown
                  variant="chat"
                  animated={message.loading}
                  fontSize={14}
                  componentProps={{
                    highlight: { fullFeatured: true },
                  }}
                >
                  {message.content}
                </Markdown>
              </div>
            </>
          ) : null}

          {message.error && (
            <div
              className="selectable"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '8px 12px',
                marginTop: message.content ? 8 : 0,
                borderRadius: 8,
                background: token.colorErrorBg,
                border: `1px solid ${token.colorErrorBorder}`,
                fontSize: 13,
                color: token.colorErrorText,
              }}
            >
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{message.error}</span>
            </div>
          )}

          {/* Streaming cursor handled by Markdown animated prop */}
        </div>

        {/* Action bar — always in flow, visibility via opacity (LobeChat pattern: no layout shift) */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            alignItems: 'center',
            alignSelf: isUser ? 'flex-end' : 'flex-start',
            background: hovered && !message.loading && !editing ? token.colorBgElevated : 'transparent',
            borderRadius: 8,
            boxShadow: hovered && !message.loading && !editing ? token.boxShadowTertiary : 'none',
            padding: '2px 4px',
            height: 28,
            opacity: hovered && !message.loading && !editing ? 1 : 0,
            pointerEvents: hovered && !message.loading && !editing ? 'auto' : 'none',
            transition: 'opacity 0.2s',
          }}
        >
          {!isUser && (
            <MiniButton
              icon={speaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
              title={speaking ? t('chat.message.action.stopReading') : t('chat.message.action.readAloud')}
              onClick={handleReadAloud}
            />
          )}
          <MiniButton icon={<RotateCcw size={14} />} title={t('chat.message.action.regenerate')} onClick={handleRegenerate} />
          <MiniButton icon={<Edit size={14} />} title={t('chat.message.action.edit')} onClick={handleStartEdit} />
          <MiniButton icon={copied ? <Check size={14} /> : <Copy size={14} />} title={t('chat.message.action.copy')} onClick={handleCopy} />
          <Dropdown menu={{ items: isUser ? userMoreMenu : assistantMoreMenu }} trigger={['click']} placement={isUser ? 'bottomRight' : 'bottomLeft'}>
            <div>
              <MiniButton icon={<MoreHorizontal size={14} />} title={t('chat.message.action.more')} onClick={() => {}} />
            </div>
          </Dropdown>
        </div>

        {/* Runtime tags — assistant messages only */}
        {!isUser && !message.loading && (message.model || message.traceId || message.providerKind) && (
          <Flexbox horizontal align="center" gap={6} wrap="wrap">
            {message.model && (
              <Flexbox horizontal align="center" gap={4}>
                <ModelIcon model={message.model} size={12} type="mono" />
                <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>
                  {availableModels?.find((m) => m.id === message.model)?.display_name || message.model}
                </span>
              </Flexbox>
            )}
            {(message.traceId || message.providerKind) && (
              <Tag
                bordered={false}
                color={message.providerBlackBox ? 'warning' : 'success'}
                onClick={handleOpenTrace}
                style={{
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  lineHeight: '18px',
                  paddingInline: 6,
                  cursor: 'pointer',
                }}
                title={t('chat.message.provider.traceTitle', {
                  trace: message.traceId || '-',
                  provider: message.providerId || '-',
                  protocol: message.providerProtocol || '-',
                  memory: message.memoryCount ?? 0,
                  skills: message.skillCount ?? 0,
                  tools: message.toolCount ?? 0,
                })}
              >
                {message.providerBlackBox ? <Terminal size={11} /> : <CheckCircle2 size={11} />}
                {message.providerBlackBox
                  ? t('chat.message.provider.cliBlackBox')
                  : t('chat.message.provider.structured')}
              </Tag>
            )}
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
    <TraceDetailDrawer
      open={traceOpen}
      loading={traceLoading}
      trace={traceDetail}
      fallback={message}
      onClose={() => setTraceOpen(false)}
    />
    </>
  );
}

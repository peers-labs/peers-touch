import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Avatar, Markdown } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import { Tag, message as antMessage, Input, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { theme } from 'antd';
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
} from 'lucide-react';
import type { ChatMessage, ToolCallInfo } from '../store/chat';
import { useChatStore } from '../store/chat';
import MessageCard, { type CardData } from './MessageCard';
import { parseDeepLink } from '../utils/deeplink';

const { TextArea } = Input;

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
              <div style={{ fontWeight: 500, marginBottom: 2, color: token.colorTextSecondary }}>Arguments</div>
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
              <div style={{ fontWeight: 500, marginBottom: 2, color: token.colorTextSecondary }}>Result</div>
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
  const pendingCount = toolCalls.filter((t) => t.pending).length;
  const doneCount = toolCalls.length - pendingCount;

  const summary = pendingCount > 0
    ? `Using ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}…`
    : `Used ${doneCount} tool${doneCount > 1 ? 's' : ''}`;

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
          userSelect: 'none',
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

export function MessageBubble({ message, userAvatar, agentAvatar }: Props) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const { token } = theme.useToken();
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
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
      antMessage.success('Copied');
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
    antMessage.success('Saved to notebook');
  }, [saveMessageToNotebook, message]);

  const assistantMoreMenu: MenuProps['items'] = [
    { key: 'edit', icon: <Edit size={14} />, label: 'Edit', onClick: handleStartEdit },
    { key: 'copy', icon: <Copy size={14} />, label: 'Copy', onClick: handleCopy },
    {
      key: 'collapse',
      icon: collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />,
      label: collapsed ? 'Expand Message' : 'Collapse Message',
      onClick: () => setCollapsed(!collapsed),
    },
    { type: 'divider' },
    { key: 'save-notebook', icon: <BookOpen size={14} />, label: 'Save to Notebook', onClick: handleSaveToNotebook },
    { key: 'share', icon: <Share2 size={14} />, label: 'Share' },
    { type: 'divider' },
    { key: 'regenerate', icon: <RotateCcw size={14} />, label: 'Regenerate', onClick: handleRegenerate },
    { key: 'del-regen', icon: <ListRestart size={14} />, label: 'Del & Regenerate', onClick: handleDelAndRegenerate },
    { key: 'delete', icon: <Trash2 size={14} />, label: 'Delete', danger: true, onClick: handleDelete },
  ];

  const userMoreMenu: MenuProps['items'] = [
    { key: 'edit', icon: <Edit size={14} />, label: 'Edit', onClick: handleStartEdit },
    { key: 'copy', icon: <Copy size={14} />, label: 'Copy', onClick: handleCopy },
    { key: 'save-notebook', icon: <BookOpen size={14} />, label: 'Save to Notebook', onClick: handleSaveToNotebook },
    { type: 'divider' },
    { key: 'regenerate', icon: <RotateCcw size={14} />, label: 'Regenerate', onClick: handleRegenerate },
    { key: 'delete', icon: <Trash2 size={14} />, label: 'Delete', danger: true, onClick: handleDelete },
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
    window.dispatchEvent(new CustomEvent('agentbox:navigate', { detail: parsed }));
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
            <MiniButton icon={copied ? <Check size={14} /> : <Copy size={14} />} title="Copy" onClick={handleCopy} />
            <MiniButton icon={<Trash2 size={14} />} title="Delete" onClick={handleDelete} />
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
        {isUser && userAvatar?.url ? (
          <img
            src={userAvatar.url}
            alt={userAvatar.name}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        ) : (
          <Avatar
            avatar={isUser ? '👤' : (agentAvatar || '🤖')}
            size={32}
            shape="square"
            background={isUser ? token.colorPrimary : 'linear-gradient(135deg, #667eea, #764ba2)'}
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
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  style={{
                    padding: '4px 12px', borderRadius: 6, border: 'none',
                    background: token.colorPrimary, color: '#fff',
                    cursor: 'pointer', fontSize: 12,
                  }}
                >
                  Save
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
            </>
          ) : null}

          {message.error && (
            <div
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
              title={speaking ? 'Stop reading' : 'Read aloud'}
              onClick={handleReadAloud}
            />
          )}
          <MiniButton icon={<RotateCcw size={14} />} title="Regenerate" onClick={handleRegenerate} />
          <MiniButton icon={<Edit size={14} />} title="Edit" onClick={handleStartEdit} />
          <MiniButton icon={copied ? <Check size={14} /> : <Copy size={14} />} title="Copy" onClick={handleCopy} />
          <Dropdown menu={{ items: isUser ? userMoreMenu : assistantMoreMenu }} trigger={['click']} placement={isUser ? 'bottomRight' : 'bottomLeft'}>
            <div>
              <MiniButton icon={<MoreHorizontal size={14} />} title="More" onClick={() => {}} />
            </div>
          </Dropdown>
        </div>

        {/* Model tag — assistant messages only, show user-configured display_name */}
        {!isUser && message.model && !message.loading && (
          <Flexbox horizontal align="center" gap={4}>
            <ModelIcon model={message.model} size={12} type="mono" />
            <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>
              {availableModels?.find((m) => m.id === message.model)?.display_name || message.model}
            </span>
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
}

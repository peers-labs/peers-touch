import { useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, Tag, toast } from '@lobehub/ui';
import { theme, Button } from 'antd';
import {
  Copy,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  FileText,
  Brain,
  Cpu,
  Database,
  Activity,
  Download,
  Play,
  Code2,
  Braces,
  Workflow,
  ExternalLink,
} from 'lucide-react';
import type { ChatMessage, DelegationTaskInfo, MessageArtifact } from '../../store/chat';
import { extractMessageArtifacts, useChatStore } from '../../store/chat';
import { useAgentStore } from '../../store/agent';
import { usePortalStore } from '../../store/portal';
import { parseAgentChatConfig, api } from '../../services/desktop_api';
import { LazyMarkdown as Markdown } from '../LazyMarkdown';
import { AgentIconTile } from '../agent/AgentIconTile';
import { ProviderIcon } from '../settings/ProviderIcon';
import { useTranslation } from 'react-i18next';
import { MessageActionBar } from '../messages';
import { ToolCallsBlock } from './ToolCallCard';
import { ThinkingIndicator } from './ThinkingBlock';
import { chatMarkdownProps } from './markdownConfig';
import { timeAgo, fullTime, downloadCodeBlock, downloadArtifact } from './shared';

// --- Collect delegation results from message + tool calls ---

function collectDelegationResults(message: ChatMessage): DelegationTaskInfo[] {
  const fromMessage = message.delegationResults || [];
  const fromTools = (message.toolCalls || []).flatMap((tool) => tool.delegationResults || []);
  const byId = new Map<string, DelegationTaskInfo>();
  [...fromMessage, ...fromTools].forEach((result) => {
    byId.set(result.taskId, result);
  });
  return Array.from(byId.values());
}

// --- Artifact helpers ---

function ArtifactIcon({ kind }: { kind: MessageArtifact['kind'] }) {
  if (kind === 'diagram') return <Workflow size={14} />;
  if (kind === 'structured') return <Braces size={14} />;
  if (kind === 'code') return <Code2 size={14} />;
  return <FileText size={14} />;
}

function artifactTypeKey(kind: MessageArtifact['kind']): string {
  return `chat.message.artifact.kind.${kind}`;
}

function ArtifactBlock({
  artifacts,
  onOpenArtifact,
}: {
  artifacts: MessageArtifact[];
  onOpenArtifact?: (artifact: MessageArtifact) => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const handleCopy = useCallback((artifact: MessageArtifact) => {
    navigator.clipboard.writeText(artifact.content).then(() => {
      toast.success(t('chat.message.toast.artifactCopied'));
    });
  }, [t]);

  const handleExport = useCallback((artifact: MessageArtifact) => {
    downloadArtifact(artifact);
    toast.success(t('chat.message.toast.artifactExported'));
  }, [t]);

  return (
    <Flexbox gap={8} style={{ marginBottom: 8 }}>
      <Flexbox horizontal align="center" gap={6}>
        <FileText size={14} style={{ color: token.colorTextSecondary }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>
          {t('chat.message.artifact.title')}
        </span>
        <Tag bordered={false} style={{ margin: 0, fontSize: 11 }}>
          {t('chat.message.artifact.count', { count: artifacts.length })}
        </Tag>
      </Flexbox>
      <Flexbox gap={6}>
        {artifacts.map((artifact, index) => (
          <Flexbox
            key={artifact.id}
            horizontal
            align="center"
            gap={8}
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 10,
              padding: '8px 10px',
              background: token.colorFillQuaternary,
            }}
          >
            <span style={{ color: token.colorTextSecondary, display: 'flex', flexShrink: 0 }}>
              <ArtifactIcon kind={artifact.kind} />
            </span>
            <Flexbox style={{ minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 13, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t('chat.message.artifact.itemTitle', {
                  type: t(artifactTypeKey(artifact.kind)),
                  index: index + 1,
                  language: artifact.language || t('chat.message.code.plainText'),
                })}
              </span>
              <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                {t('chat.message.artifact.sourceMessage', { id: artifact.messageId.slice(0, 8) })}
              </span>
            </Flexbox>
            <Flexbox horizontal align="center" gap={2}>
              {onOpenArtifact && (
                <ActionIcon
                  icon={<ExternalLink size={14} />}
                  size="small"
                  title={t('chat.message.artifact.open')}
                  onClick={() => onOpenArtifact(artifact)}
                />
              )}
              <ActionIcon
                icon={<Copy size={14} />}
                size="small"
                title={t('chat.message.artifact.copy')}
                onClick={() => handleCopy(artifact)}
              />
              <ActionIcon
                icon={<Download size={14} />}
                size="small"
                title={t('chat.message.artifact.export')}
                onClick={() => handleExport(artifact)}
              />
            </Flexbox>
          </Flexbox>
        ))}
      </Flexbox>
    </Flexbox>
  );
}

// --- Diagnostics row ---

function DiagnosticsRow({ label, value }: { label: string; value: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flexbox horizontal align="center" justify="space-between" gap={12}>
      <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{label}</span>
      <span style={{ fontSize: 12, color: token.colorText, textAlign: 'right', minWidth: 0 }}>{value}</span>
    </Flexbox>
  );
}

// --- Diagnostics block ---

function DiagnosticsBlock({
  message,
  providerName,
  memoryEnabled,
  compressionEnabled,
}: {
  message: ChatMessage;
  providerName: string;
  memoryEnabled: boolean;
  compressionEnabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const toolCalls = message.toolCalls || [];
  const knowledgeChunks = message.knowledgeChunks || [];
  const delegationResults = collectDelegationResults(message);
  const failedTools = toolCalls.filter((tool) => tool.status === 'error' || tool.status === 'denied').length;
  const pendingTools = toolCalls.filter((tool) => tool.pending || tool.status === 'approval_required').length;
  const failedDelegations = delegationResults.filter((item) => item.status === 'failed' || item.status === 'timeout').length;
  const hasRuntimeDiagnostics = !!message.thinking || !!message.error || !!message.processDuration || toolCalls.length > 0 || knowledgeChunks.length > 0 || delegationResults.length > 0;
  const hasDiagnostics = hasRuntimeDiagnostics;

  if (!hasDiagnostics) return null;

  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${message.error ? token.colorErrorBorder : token.colorBorderSecondary}`,
      background: message.error ? token.colorErrorBg : token.colorFillQuaternary,
      marginBottom: message.content ? 6 : 0,
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
          color: message.error ? token.colorErrorText : token.colorTextSecondary,
        }}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {message.error ? <AlertTriangle size={13} /> : <Activity size={13} />}
        <span>{message.error ? t('chat.message.errorTitle', { defaultValue: 'Could not complete' }) : t('chat.message.diagnostics.title')}</span>
        {message.processDuration != null && (
          <Tag bordered={false} style={{ marginLeft: 'auto', fontSize: 11 }}>
            {t('chat.message.diagnostics.duration', { seconds: message.processDuration })}
          </Tag>
        )}
      </div>
      {expanded && (
        <Flexbox gap={8} style={{ padding: '8px 10px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
          {message.error && (
            <Flexbox gap={3}>
              <span style={{ fontSize: 12, fontWeight: 600, color: token.colorErrorText }}>{t('chat.message.diagnostics.error')}</span>
              <span style={{ fontSize: 12, color: token.colorErrorText }}>{message.error}</span>
            </Flexbox>
          )}
          {message.thinking && (
            <Flexbox gap={3}>
              <Flexbox horizontal align="center" gap={6}>
                <Brain size={13} style={{ color: token.colorTextSecondary }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextSecondary }}>{t('chat.message.diagnostics.thinking')}</span>
                <Tag bordered={false} color={message.thinkingDone ? 'success' : 'processing'} style={{ margin: 0, fontSize: 11 }}>
                  {message.thinkingDone ? t('chat.message.thinking.done') : t('chat.message.thinking.thinking')}
                </Tag>
              </Flexbox>
              <pre style={{
                margin: 0,
                padding: '6px 8px',
                borderRadius: 6,
                background: token.colorBgContainer,
                color: token.colorTextSecondary,
                fontSize: 11,
                whiteSpace: 'pre-wrap',
                maxHeight: 140,
                overflow: 'auto',
              }}>{message.thinking}</pre>
            </Flexbox>
          )}
          <DiagnosticsRow
            label={t('chat.message.diagnostics.provider')}
            value={<Flexbox horizontal align="center" gap={6}><Cpu size={12} />{providerName || t('chat.message.diagnostics.unknown')}</Flexbox>}
          />
          <DiagnosticsRow label={t('chat.message.diagnostics.model')} value={message.model || t('chat.message.diagnostics.unknown')} />
          <DiagnosticsRow label={t('chat.message.diagnostics.tools')} value={t('chat.message.diagnostics.toolSummary', { total: toolCalls.length, pending: pendingTools, failed: failedTools })} />
          <DiagnosticsRow
            label={t('chat.message.diagnostics.knowledge')}
            value={knowledgeChunks.length > 0
              ? (
                <Flexbox gap={4}>
                  <span>{t('chat.message.diagnostics.knowledgeSummary', { count: knowledgeChunks.length })}</span>
                  {knowledgeChunks.slice(0, 3).map((chunk) => (
                    <span key={chunk.chunkId} style={{ fontSize: 11, color: token.colorTextSecondary }}>
                      {chunk.resourceTitle || chunk.source} #{chunk.chunkIndex + 1} ({chunk.score.toFixed(2)})
                    </span>
                  ))}
                </Flexbox>
              )
              : t('chat.message.diagnostics.none')}
          />
          <DiagnosticsRow
            label={t('chat.message.diagnostics.delegation')}
            value={delegationResults.length > 0
              ? (
                <Flexbox gap={4}>
                  <span>{t('chat.message.diagnostics.delegationSummary', { total: delegationResults.length, failed: failedDelegations })}</span>
                  {delegationResults.slice(0, 3).map((result) => (
                    <span key={result.taskId} style={{ fontSize: 11, color: token.colorTextSecondary }}>
                      {result.taskDescription} · {t(`chat.message.delegation.status.${result.status}`)}
                    </span>
                  ))}
                </Flexbox>
              )
              : t('chat.message.diagnostics.none')}
          />
          <DiagnosticsRow
            label={t('chat.message.diagnostics.memory')}
            value={<Flexbox horizontal align="center" gap={6}><Database size={12} />{memoryEnabled ? t('chat.message.diagnostics.enabled') : t('chat.message.diagnostics.disabled')}</Flexbox>}
          />
          <DiagnosticsRow label={t('chat.message.diagnostics.compression')} value={compressionEnabled ? t('chat.message.diagnostics.enabled') : t('chat.message.diagnostics.disabled')} />
        </Flexbox>
      )}
    </div>
  );
}

// --- AssistantMessage props ---

interface AssistantMessageProps {
  message: ChatMessage;
  onOpenArtifact?: (artifact: MessageArtifact) => void;
}

/**
 * Renders a complete assistant message including diagnostics, tool calls,
 * artifacts, markdown content, error display, and the action bar.
 */
export function AssistantMessage({ message, onOpenArtifact }: AssistantMessageProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [hovered, setHovered] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const branchFromMessage = useChatStore(s => s.branchFromMessage);
  const continueGeneration = useChatStore(s => s.continueGeneration);
  const deleteAndRegenerateMessage = useChatStore(s => s.deleteAndRegenerateMessage);
  const deleteMessage = useChatStore(s => s.deleteMessage);
  const regenerateMessage = useChatStore(s => s.regenerateMessage);
  const retryMessage = useChatStore(s => s.retryMessage);
  const sendMessage = useChatStore(s => s.sendMessage);
  const translateMessage = useChatStore(s => s.translateMessage);
  const openThread = usePortalStore(s => s.openThread);
  const currentSessionKey = useChatStore(s => s.currentSessionKey);
  const agents = useAgentStore(s => s.agents);
  const availableModels = useAgentStore(s => s.availableModels);
  const selectedAgent = useAgentStore(s => s.selectedAgent);
  const activeAgent = agents.find((agent) => agent.name === selectedAgent);
  const activeChatConfig = activeAgent ? parseAgentChatConfig(activeAgent) : {};
  const messageModel = message.model ? availableModels.find((model) => model.id === message.model) : undefined;
  const providerName = messageModel?.provider_name || messageModel?.provider_id || activeAgent?.provider || '';
  const agentDisplayName = activeAgent?.title || activeAgent?.name;
  const artifacts = useMemo(() => extractMessageArtifacts(message), [message]);

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
      toast.success(t('chat.message.toast.copied'));
    });
  }, [message.content, message.toolCalls, t]);

  const handleRegenerate = useCallback(() => {
    regenerateMessage(message.id);
  }, [regenerateMessage, message.id]);

  const handleRetry = useCallback(() => {
    retryMessage(message.id);
  }, [retryMessage, message.id]);

  const handleDelAndRegenerate = useCallback(() => {
    deleteAndRegenerateMessage(message.id);
  }, [deleteAndRegenerateMessage, message.id]);

  const handleBranch = useCallback(() => {
    void branchFromMessage(message.id);
  }, [branchFromMessage, message.id]);

  const handleDelete = useCallback(() => {
    deleteMessage(message.id);
  }, [deleteMessage, message.id]);

  const handleExportCodeBlock = useCallback((content: string, language: string) => {
    downloadCodeBlock(content, language);
    toast.success(t('chat.message.toast.codeExported'));
  }, [t]);

  const handleRunCodeBlock = useCallback((content: string, language: string) => {
    sendMessage(t('chat.message.code.runPrompt', {
      code: content,
      language: language || t('chat.message.code.plainText'),
    }));
  }, [sendMessage, t]);

  return (
    <Flexbox
      id={`agent-message-${message.id}`}
      align="flex-start"
      gap={8}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        paddingBlock: 8,
        paddingInlineStart: 0,
        paddingInlineEnd: 36,
      }}
    >
      {/* Header: avatar + name + model + timestamp */}
      <Flexbox direction="horizontal" align="center" gap={8}>
        <AgentIconTile size={32} />
        <strong style={{ fontSize: 13, color: token.colorText, fontWeight: 600 }}>
          {agentDisplayName || t('chat.message.assistant')}
        </strong>
        {message.model && !message.loading && (
          <Flexbox horizontal align="center" gap={3} style={{ opacity: 0.85 }}>
            {messageModel && (
              <ProviderIcon
                providerId={messageModel.provider_id || ''}
                providerName={messageModel.provider_name}
                size={11}
              />
            )}
            <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>
              {messageModel?.display_name || message.model}
            </span>
          </Flexbox>
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
          {timeAgo(message.timestamp, t)}
        </span>
      </Flexbox>

      {/* Message body */}
      <Flexbox
        gap={8}
        style={{
          maxWidth: '100%',
          overflow: 'hidden',
          position: 'relative',
          width: '100%',
        }}
      >
        <div
          style={{
            borderRadius: token.borderRadiusLG,
            padding: 0,
            background: 'transparent',
            alignSelf: 'flex-start',
          }}
        >
          <DiagnosticsBlock
            message={message}
            providerName={providerName}
            memoryEnabled={!!activeChatConfig.memory?.enabled}
            compressionEnabled={!!activeChatConfig.enableContextCompression}
          />

          {/* Tool calls block */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallsBlock toolCalls={message.toolCalls} messageId={message.id} />
          )}

          {/* Artifacts */}
          {artifacts.length > 0 && (
            <ArtifactBlock artifacts={artifacts} onOpenArtifact={onOpenArtifact} />
          )}

          {/* Content area */}
          {message.loading && !message.content && !(message.toolCalls && message.toolCalls.length > 0) ? (
            <ThinkingIndicator token={token} />
          ) : collapsed ? (
            <div
              style={{ fontSize: 13, color: token.colorTextDescription, fontStyle: 'italic', cursor: 'pointer' }}
              onClick={() => setCollapsed(false)}
            >
              {t('chat.message.collapsed')}
            </div>
          ) : message.content ? (
            <div className="selectable">
              <Markdown
                {...chatMarkdownProps}
                variant="chat"
                animated={message.loading}
                fontSize={14}
                componentProps={{
                  highlight: {
                    actionsRender: ({ content, language, originalNode }) => (
                      <Flexbox horizontal align="center" gap={4}>
                        {originalNode}
                        <ActionIcon
                          icon={<Download size={14} />}
                          size="small"
                          title={t('chat.message.code.export')}
                          onClick={() => handleExportCodeBlock(content, language)}
                        />
                        <ActionIcon
                          icon={<Play size={14} />}
                          size="small"
                          title={t('chat.message.code.run')}
                          onClick={() => handleRunCodeBlock(content, language)}
                        />
                      </Flexbox>
                    ),
                    fullFeatured: true,
                  },
                }}
              >
                {message.content}
              </Markdown>
            </div>
          ) : null}

          {/* Inline translation */}
          {message.translation && (
            <div
              style={{
                borderTop: `1px solid ${token.colorBorderSecondary}`,
                paddingTop: 8,
                marginTop: 8,
              }}
            >
              <div style={{ fontSize: 11, color: token.colorTextSecondary, marginBottom: 4 }}>
                {t('chat.message.translation.label')}
              </div>
              <Markdown
                {...chatMarkdownProps}
                variant="chat"
                fontSize={14}
              >
                {message.translation}
              </Markdown>
            </div>
          )}

          {/* Error block */}
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
              <div style={{ flex: 1 }}>
                <div>{message.error}</div>
                {message.resolution && (
                  <Button
                    type="primary"
                    size="small"
                    danger
                    style={{ marginTop: 8 }}
                    onClick={async () => {
                      try {
                        const result = await api.resolveErrorAction(message.resolution!);
                        if (result.message) {
                          toast.success(result.message);
                        } else if (result.reauth) {
                          toast.success(t('chat.message.resolution.authOpened'));
                        } else if (result.opened) {
                          toast.success(t('chat.message.resolution.settingsOpened'));
                        }
                      } catch (err: unknown) {
                        const errMessage = err instanceof Error ? err.message : String(err);
                        toast.error(errMessage || t('chat.message.resolution.actionFailed'));
                      }
                    }}
                  >
                    {message.resolution.label}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Audit row */}
        {(message.operation || message.replacementOf || message.replacedBy) && !message.loading && (
          <Flexbox horizontal align="center" gap={4}>
            {message.operation && (
              <Tag bordered={false} color="processing" style={{ margin: 0, fontSize: 11 }}>
                {t(`chat.message.audit.${message.operation}`)}
              </Tag>
            )}
            {message.replacementOf && (
              <Tag bordered={false} style={{ margin: 0, fontSize: 11 }}>
                {t('chat.message.audit.replacement')}
              </Tag>
            )}
            {message.replacedBy && (
              <Tag bordered={false} style={{ margin: 0, fontSize: 11 }}>
                {t('chat.message.audit.replaced')}
              </Tag>
            )}
          </Flexbox>
        )}
      </Flexbox>

      {/* Action bar */}
      {!message.loading && (
        <MessageActionBar
          context={{
            message,
            isStreaming: !!message.loading,
            isCurrentSession: true,
            operation: undefined,
            onCopy: handleCopy,
            onEdit: () => { /* Assistant messages do not support inline edit */ },
            onDelete: handleDelete,
            onRegenerate: handleRegenerate,
            onRetry: handleRetry,
            onBranch: handleBranch,
            onContinue: () => continueGeneration(message.id),
            onDeleteAndRegenerate: handleDelAndRegenerate,
            onTranslate: () => translateMessage(message.id),
            onThread: () => openThread(currentSessionKey, message.id),
            onReadAloud: () => {
              if (message.content) {
                void api.tts(message.content);
              }
            },
            onExport: () => {
              if (message.content) {
                const exported = `# Assistant Response\n\n${message.content}`;
                void navigator.clipboard.writeText(exported);
              }
            },
          }}
          style={{
            alignSelf: 'flex-start',
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? 'auto' : 'none',
            transition: 'opacity 0.2s',
          }}
        />
      )}
    </Flexbox>
  );
}

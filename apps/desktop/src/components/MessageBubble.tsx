import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, Avatar, Tag, Dropdown, TextArea, toast } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import type { MenuProps } from '@lobehub/ui';
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
  GitBranch,
  ChevronsDownUp,
  ChevronsUpDown,
  MoreHorizontal,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Volume2,
  VolumeX,
  AlertTriangle,
  BookOpen,
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
import type { ChatMessage, DelegationTaskInfo, MessageArtifact, ToolCallInfo } from '../store/chat';
import { extractMessageArtifacts, useChatStore } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { api, parseAgentChatConfig } from '../services/desktop_api';
import { LazyMarkdown as Markdown } from './LazyMarkdown';
import { UserSquareAvatar } from './common/UserSquareAvatar';
import MessageCard, { type CardData } from './MessageCard';
import { parseDeepLink } from '../utils/deeplink';
import { EVENT, eventBus } from '../kernel/events';
import { useTranslation } from 'react-i18next';

interface Props {
  message: ChatMessage;
  userAvatar?: { url?: string; name: string };
  agentAvatar?: string;
  onOpenArtifact?: (artifact: MessageArtifact) => void;
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

function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function codeFilename(language: string): string {
  const normalized = language.trim().toLowerCase() || 'txt';
  const extensionByLanguage: Record<string, string> = {
    bash: 'sh',
    csharp: 'cs',
    javascript: 'js',
    json: 'json',
    markdown: 'md',
    plaintext: 'txt',
    python: 'py',
    rust: 'rs',
    shell: 'sh',
    sh: 'sh',
    sql: 'sql',
    text: 'txt',
    typescript: 'ts',
    tsx: 'tsx',
    yaml: 'yml',
  };
  return `agent-code-block.${extensionByLanguage[normalized] || normalized.replace(/[^a-z0-9]+/g, '-') || 'txt'}`;
}

function downloadCodeBlock(content: string, language: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = codeFilename(language);
  anchor.click();
  URL.revokeObjectURL(url);
}

function artifactFilename(artifact: MessageArtifact): string {
  const extensionByLanguage: Record<string, string> = {
    javascript: 'js',
    json: 'json',
    markdown: 'md',
    mermaid: 'mmd',
    plaintext: 'txt',
    python: 'py',
    rust: 'rs',
    shell: 'sh',
    sh: 'sh',
    typescript: 'ts',
    yaml: 'yml',
    yml: 'yml',
  };
  const language = artifact.language?.trim().toLowerCase() || 'text';
  const extension = extensionByLanguage[language] || language.replace(/[^a-z0-9]+/g, '-') || 'txt';
  return `agent-artifact-${artifact.messageId.slice(0, 8)}.${extension}`;
}

function downloadArtifact(artifact: MessageArtifact) {
  const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifactFilename(artifact);
  anchor.click();
  URL.revokeObjectURL(url);
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
  const decideToolApproval = useChatStore((state) => state.decideToolApproval);
  const approvalRequired = tool.status === 'approval_required' && !!tool.approvalId;
  const denied = tool.status === 'denied' || tool.status === 'error';
  const status = tool.status || (tool.pending ? 'pending' : 'success');
  const statusColor = status === 'success' || status === 'approved'
    ? 'success'
    : status === 'error' || status === 'denied'
      ? 'error'
      : status === 'cancelled'
        ? 'default'
        : status === 'approval_required'
          ? 'warning'
          : 'processing';

  const delegationResults = tool.delegationResults || [];

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
        {approvalRequired
          ? <AlertTriangle size={12} style={{ color: token.colorWarning, flexShrink: 0 }} />
          : denied
            ? <XCircle size={12} style={{ color: token.colorError, flexShrink: 0 }} />
            : tool.pending
          ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: token.colorPrimary, flexShrink: 0 }} />
          : <CheckCircle2 size={12} style={{ color: token.colorSuccess, flexShrink: 0 }} />
        }
        <span style={{ fontWeight: 500 }}>{tool.name}</span>
        <Tag bordered={false} color={statusColor} style={{ margin: 0, fontSize: 11 }}>
          {t(`chat.message.toolCall.status.${status}`)}
        </Tag>
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
          {tool.serverName && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 500, marginBottom: 2, color: token.colorTextSecondary }}>{t('chat.message.toolCall.server')}</div>
              <span>{tool.serverName}</span>
            </div>
          )}
          {tool.approvalActor && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontWeight: 500, marginBottom: 2, color: token.colorTextSecondary }}>{t('chat.message.toolCall.approval')}</div>
              <span>
                {tool.status === 'denied'
                  ? t('chat.message.toolCall.deniedBy', { actor: tool.approvalActor })
                  : t('chat.message.toolCall.approvedBy', { actor: tool.approvalActor })}
              </span>
            </div>
          )}
          {approvalRequired && tool.approvalId && (
            <Flexbox horizontal gap={8} style={{ marginBottom: 8 }}>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void decideToolApproval(tool.approvalId!, true);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: token.colorPrimary,
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {t('chat.message.toolCall.approve')}
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void decideToolApproval(tool.approvalId!, false);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: `1px solid ${token.colorErrorBorder}`,
                  background: token.colorErrorBg,
                  color: token.colorErrorText,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                {t('chat.message.toolCall.deny')}
              </button>
            </Flexbox>
          )}
          {delegationResults.length > 0 && (
            <DelegationResultsBlock results={delegationResults} />
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

function delegationStatusColor(status: DelegationTaskInfo['status']) {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'timeout') return 'warning';
  return 'default';
}

function DelegationResultsBlock({ results }: { results: DelegationTaskInfo[] }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  return (
    <Flexbox gap={6} style={{ marginBottom: 8 }}>
      <Flexbox horizontal align="center" gap={6}>
        <Workflow size={13} style={{ color: token.colorTextSecondary }} />
        <span style={{ fontWeight: 500, color: token.colorTextSecondary }}>
          {t('chat.message.delegation.title')}
        </span>
        <Tag bordered={false} style={{ margin: 0, fontSize: 11 }}>
          {t('chat.message.delegation.summary', { count: results.length })}
        </Tag>
      </Flexbox>
      <Flexbox gap={6}>
        {results.map((result) => (
          <div
            key={result.taskId}
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 6,
              background: token.colorBgContainer,
              padding: '6px 8px',
            }}
          >
            <Flexbox horizontal align="center" gap={6} style={{ marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: token.colorText }}>
                {result.taskDescription}
              </span>
              <Tag bordered={false} color={delegationStatusColor(result.status)} style={{ margin: 0, fontSize: 11 }}>
                {t(`chat.message.delegation.status.${result.status}`)}
              </Tag>
            </Flexbox>
            {result.childToolset.length > 0 && (
              <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 4 }}>
                {t('chat.message.delegation.tools', { tools: result.childToolset.join(', ') })}
              </div>
            )}
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 4 }}>
              {t('chat.message.delegation.iterations', { count: result.toolIterations })}
            </div>
            {result.resultSummary && (
              <pre style={{
                margin: 0,
                padding: '4px 6px',
                borderRadius: 4,
                background: token.colorFillQuaternary,
                color: result.status === 'failed' ? token.colorErrorText : token.colorTextSecondary,
                fontSize: 11,
                overflow: 'auto',
                maxHeight: 140,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>{result.resultSummary}</pre>
            )}
          </div>
        ))}
      </Flexbox>
    </Flexbox>
  );
}

function collectDelegationResults(message: ChatMessage): DelegationTaskInfo[] {
  const fromMessage = message.delegationResults || [];
  const fromTools = (message.toolCalls || []).flatMap((tool) => tool.delegationResults || []);
  const byId = new Map<string, DelegationTaskInfo>();
  [...fromMessage, ...fromTools].forEach((result) => {
    byId.set(result.taskId, result);
  });
  return Array.from(byId.values());
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

function DiagnosticsRow({ label, value }: { label: string; value: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <Flexbox horizontal align="center" justify="space-between" gap={12}>
      <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{label}</span>
      <span style={{ fontSize: 12, color: token.colorText, textAlign: 'right', minWidth: 0 }}>{value}</span>
    </Flexbox>
  );
}

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
  const hasDiagnostics = !!message.thinking || !!message.error || !!message.model || !!message.processDuration || toolCalls.length > 0 || knowledgeChunks.length > 0 || delegationResults.length > 0 || memoryEnabled || compressionEnabled;

  if (!hasDiagnostics) return null;

  return (
    <div style={{
      borderRadius: 8,
      border: `1px solid ${message.error ? token.colorErrorBorder : token.colorBorderSecondary}`,
      background: message.error ? token.colorErrorBg : token.colorFillQuaternary,
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
          color: message.error ? token.colorErrorText : token.colorTextSecondary,
        }}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {message.error ? <AlertTriangle size={13} /> : <Activity size={13} />}
        <span>{message.error ? t('chat.message.diagnostics.failedTitle') : t('chat.message.diagnostics.title')}</span>
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

export function MessageBubble({ message, userAvatar, agentAvatar, onOpenArtifact }: Props) {
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
  const editRef = useRef<any>(null);
  const autoReadMessageRef = useRef('');

  const {
    branchFromMessage,
    deleteAndRegenerateMessage,
    deleteMessage,
    editMessage,
    regenerateMessage,
    retryMessage,
    saveMessageToNotebook,
    sendMessage,
  } = useChatStore();
  const { agents, availableModels, selectedAgent } = useAgentStore();
  const activeAgent = agents.find((agent) => agent.name === selectedAgent);
  const activeChatConfig = activeAgent ? parseAgentChatConfig(activeAgent) : {};
  const messageModel = message.model ? availableModels.find((model) => model.id === message.model) : undefined;
  const providerName = messageModel?.provider_name || messageModel?.provider_id || activeAgent?.provider || '';
  const artifacts = useMemo(() => extractMessageArtifacts(message), [message]);
  const voiceConfig = activeChatConfig.voice || {};

  const speakWithBrowser = useCallback((content: string) => {
    if (!window.speechSynthesis) {
      toast.warning(t('chat.message.voice.unsupported'));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(content);
    const voiceName = voiceConfig.ttsVoice?.trim();
    if (voiceName) {
      const voice = window.speechSynthesis.getVoices().find((item) => item.voiceURI === voiceName || item.name === voiceName);
      if (voice) utterance.voice = voice;
    }
    utterance.rate = voiceConfig.ttsSpeed ?? 1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [t, voiceConfig.ttsSpeed, voiceConfig.ttsVoice]);

  const speakWithProvider = useCallback(async (content: string) => {
    try {
      setSpeaking(true);
      const result = await api.tts(content, voiceConfig.ttsVoice, voiceConfig.ttsSpeed);
      const audio = new Audio(result.url);
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);
      await audio.play();
    } catch {
      setSpeaking(false);
      toast.error(t('chat.message.voice.failed'));
    }
  }, [t, voiceConfig.ttsSpeed, voiceConfig.ttsVoice]);

  const readAloud = useCallback((content: string) => {
    if (!content.trim()) return;
    if ((voiceConfig.ttsProvider ?? 'browser') === 'browser') {
      speakWithBrowser(content);
      return;
    }
    void speakWithProvider(content);
  }, [speakWithBrowser, speakWithProvider, voiceConfig.ttsProvider]);

  const handleReadAloud = useCallback(() => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    readAloud(message.content);
  }, [readAloud, speaking, message.content]);

  useEffect(() => {
    return () => { window.speechSynthesis.cancel(); };
  }, []);

  useEffect(() => {
    if (!voiceConfig.ttsAutoRead || message.role !== 'assistant' || message.loading || !message.content.trim()) return;
    if (autoReadMessageRef.current === message.id) return;
    autoReadMessageRef.current = message.id;
    readAloud(message.content);
  }, [message.content, message.id, message.loading, message.role, readAloud, voiceConfig.ttsAutoRead]);

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
  }, [saveMessageToNotebook, message, t]);

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
    { key: 'branch', icon: <GitBranch size={14} />, label: t('chat.message.action.branch'), onClick: handleBranch },
    { type: 'divider' },
    ...(message.error ? [{ key: 'retry', icon: <RotateCcw size={14} />, label: t('chat.message.action.retry'), onClick: handleRetry }] : []),
    { key: 'regenerate', icon: <RotateCcw size={14} />, label: t('chat.message.action.regenerate'), onClick: handleRegenerate },
    { key: 'del-regen', icon: <ListRestart size={14} />, label: t('chat.message.action.delAndRegenerate'), onClick: handleDelAndRegenerate },
    { key: 'delete', icon: <Trash2 size={14} />, label: t('chat.message.action.delete'), danger: true, onClick: handleDelete },
  ];

  const userMoreMenu: MenuProps['items'] = [
    { key: 'edit', icon: <Edit size={14} />, label: t('chat.message.action.edit'), onClick: handleStartEdit },
    { key: 'copy', icon: <Copy size={14} />, label: t('chat.message.action.copy'), onClick: handleCopy },
    { key: 'save-notebook', icon: <BookOpen size={14} />, label: t('chat.message.action.saveToNotebook'), onClick: handleSaveToNotebook },
    { key: 'branch', icon: <GitBranch size={14} />, label: t('chat.message.action.branch'), onClick: handleBranch },
    { type: 'divider' },
    ...(message.error ? [{ key: 'retry', icon: <RotateCcw size={14} />, label: t('chat.message.action.retry'), onClick: handleRetry }] : []),
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
    <Flexbox
      id={`agent-message-${message.id}`}
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

          {message.attachments && message.attachments.filter((item) => !item.mime_type.startsWith('image/')).length > 0 && (
            <Flexbox gap={6} style={{ marginBottom: message.content ? 8 : 0 }}>
              {message.attachments
                .filter((item) => !item.mime_type.startsWith('image/'))
                .map((item) => (
                  <Flexbox
                    key={item.cid}
                    horizontal
                    align="center"
                    gap={8}
                    style={{
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: 8,
                      padding: '8px 10px',
                      background: token.colorFillQuaternary,
                      minWidth: 180,
                      maxWidth: 280,
                    }}
                  >
                    <FileText size={18} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
                    <Flexbox style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 13, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.filename || t('chat.input.attachmentFallbackName')}
                      </span>
                      <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                        {formatAttachmentSize(item.size)}
                      </span>
                    </Flexbox>
                  </Flexbox>
                ))}
            </Flexbox>
          )}

          {!isUser && (
            <DiagnosticsBlock
              message={message}
              providerName={providerName}
              memoryEnabled={!!activeChatConfig.memory?.enabled}
              compressionEnabled={!!activeChatConfig.enableContextCompression}
            />
          )}

          {/* Tool calls block — LobeChat style: collapsed accordion within assistant message */}
          {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallsBlock toolCalls={message.toolCalls} />
          )}

          {!isUser && artifacts.length > 0 && (
            <ArtifactBlock artifacts={artifacts} onOpenArtifact={onOpenArtifact} />
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
              {t('chat.message.collapsed')}
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
          {message.error && (
            <MiniButton icon={<RotateCcw size={14} />} title={t('chat.message.action.retry')} onClick={handleRetry} />
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

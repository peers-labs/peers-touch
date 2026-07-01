import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, DraggablePanel, Tag } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import { theme } from 'antd';
import type { MessageArtifact } from '../store/chat';
import { useChatStore } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { MessageBubble } from '../components/MessageBubble';
import { ChatInput } from '../components/ChatInput';
import { LazyMarkdown as Markdown } from '../components/LazyMarkdown';
import { useUserAvatar } from '../components/UserProfilePopover';
import { AgentIconTile } from '../components/agent/AgentIconTile';
import {
  FileText,
  Terminal,
  Globe,
  Sparkles,
  Wrench,
  Brain,
  ChevronRight,
  PanelRightClose,
  Copy,
  Download,
  Code2,
  Braces,
  Workflow,
  UserRoundCog,
} from 'lucide-react';
import { parseAgentChatConfig } from '../services/desktop_api';
import type { Agent } from '../services/desktop_api';

export function ChatPage({ onNavigateAgentProfile }: {
  onNavigateAgentProfile?: (agentName: string) => void;
}) {
  const {
    selectedModel,
    availableModels,
    defaultModel,
    selectedAgent,
    agents,
  } = useAgentStore();
  const {
    messages,
    currentSessionKey,
    selectSession,
    sendMessage,
    isStreaming,
  } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const userAvatar = useUserAvatar();
  const [activeArtifact, setActiveArtifact] = useState<MessageArtifact | null>(null);

  const currentModelId = selectedModel || defaultModel;
  const currentModel = availableModels.find((m) => m.id === currentModelId);
  const currentAgent = useMemo(
    () =>
      agents.find((a) => a.name === selectedAgent) || {
        name: selectedAgent || 'assistant',
        title: 'Peers Touch',
        description: t('chat.welcome.defaultDescription'),
        avatar: '',
        openingMessage: '',
        openingQuestions: '[]',
        chatConfig: '',
        systemPrompt: '',
      },
    [agents, selectedAgent],
  );

  const agentChatConfig = useMemo(
    () => ('chatConfig' in currentAgent ? parseAgentChatConfig(currentAgent as Agent) : {}),
    [currentAgent],
  );

  useEffect(() => {
    selectSession(currentSessionKey);
  }, [currentSessionKey, selectSession]);

  useEffect(() => {
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? 'smooth' : 'instant' });
  }, [messages, isStreaming]);

  const isEmpty = messages.length === 0;

  return (
    <Flexbox horizontal flex={1} height="100%" style={{ position: 'relative' }}>
      {/* Main Agent Chat area */}
      <Flexbox
        flex={1}
        height="100%"
        style={{
          minWidth: 0,
          overflow: 'hidden',
          background: token.colorBgContainer,
        }}
      >
        <AgentChatHeader
          agent={currentAgent as AgentChatAgentView}
          modelName={currentModel?.display_name || currentModelId}
          modelId={currentModelId}
          onOpenProfile={() => onNavigateAgentProfile?.(currentAgent.name)}
        />

        {/* Conversation pane: one vertical scroll container above the composer. */}
        <Flexbox
          flex={1}
          align="center"
          justify={isEmpty ? 'center' : 'flex-start'}
          style={{ overflow: 'auto', width: '100%', minHeight: 0 }}
        >
          <Flexbox
            style={{
              width: '100%',
              padding: isEmpty ? '0 24px' : '0 16px 24px',
            }}
          >
            {isEmpty ? (
              <WelcomeScreen
                agent={currentAgent as AgentChatAgentView}
                chatConfig={agentChatConfig}
                modelName={currentModel?.display_name || currentModelId}
                modelId={currentModelId}
                onSend={sendMessage}
              />
            ) : (
              <>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} userAvatar={userAvatar} onOpenArtifact={setActiveArtifact} />
                ))}
                <div ref={bottomRef} />
              </>
            )}
          </Flexbox>
        </Flexbox>

        <Flexbox align="center" style={{ flexShrink: 0, padding: '0 0 48px' }}>
          <div style={{ width: 'min(1068px, calc(100% - 160px))' }}>
            <ChatInput />
          </div>
        </Flexbox>
      </Flexbox>


      <DraggablePanel
        placement="right"
        defaultSize={{ width: 460 }}
        minWidth={360}
        maxWidth={720}
        expand={!!activeArtifact}
        onExpandChange={(expand) => { if (!expand) setActiveArtifact(null); }}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {activeArtifact && (
          <ArtifactPanel
            artifact={activeArtifact}
            onClose={() => setActiveArtifact(null)}
          />
        )}
      </DraggablePanel>
    </Flexbox>
  );
}

function artifactFileName(artifact: MessageArtifact): string {
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

function exportArtifact(artifact: MessageArtifact) {
  const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifactFileName(artifact);
  anchor.click();
  URL.revokeObjectURL(url);
}

function artifactPanelIcon(kind: MessageArtifact['kind']) {
  if (kind === 'diagram') return Workflow;
  if (kind === 'structured') return Braces;
  if (kind === 'code') return Code2;
  return FileText;
}

function ArtifactPanel({
  artifact,
  onClose,
}: {
  artifact: MessageArtifact;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const ArtifactIcon = artifactPanelIcon(artifact.kind);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(artifact.content);
  }, [artifact.content]);

  const handleExport = useCallback(() => {
    exportArtifact(artifact);
  }, [artifact]);

  const handleSource = useCallback(() => {
    document.getElementById(`agent-message-${artifact.messageId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [artifact.messageId]);

  return (
    <Flexbox flex={1} style={{ height: '100%' }}>
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          padding: '10px 12px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0 }}>
          <ArtifactIcon size={16} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
          <Flexbox style={{ minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('chat.artifact.panel.title')}
            </span>
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
              {t('chat.artifact.panel.source', { id: artifact.messageId.slice(0, 8) })}
            </span>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={2}>
          <ActionIcon
            icon={Copy}
            size="small"
            title={t('chat.artifact.panel.copy')}
            onClick={handleCopy}
          />
          <ActionIcon
            icon={Download}
            size="small"
            title={t('chat.artifact.panel.export')}
            onClick={handleExport}
          />
          <ActionIcon
            icon={ChevronRight}
            size="small"
            title={t('chat.artifact.panel.sourceAction')}
            onClick={handleSource}
          />
          <ActionIcon
            icon={PanelRightClose}
            size="small"
            title={t('chat.artifact.panel.close')}
            onClick={onClose}
          />
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal gap={6} style={{ padding: '8px 12px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Tag bordered={false} style={{ margin: 0 }}>
          {t(`chat.message.artifact.kind.${artifact.kind}`)}
        </Tag>
        {artifact.language && (
          <Tag bordered={false} style={{ margin: 0 }}>
            {artifact.language}
          </Tag>
        )}
      </Flexbox>

      <Flexbox flex={1} style={{ overflow: 'auto', padding: 16, minHeight: 0 }}>
        {artifact.kind === 'document' ? (
          <Markdown variant="chat" fontSize={14}>
            {artifact.content}
          </Markdown>
        ) : (
          <pre
            className="selectable"
            style={{
              margin: 0,
              width: '100%',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 12,
              lineHeight: 1.6,
              color: token.colorText,
              background: token.colorFillQuaternary,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 10,
              padding: 12,
            }}
          >
            {artifact.content}
          </pre>
        )}
      </Flexbox>
    </Flexbox>
  );
}

function normalizeOpeningQuestions(values: unknown[]): string[] {
  const questions = values
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set(questions)).slice(0, 6);
}

function parseOpeningQuestions(raw?: string): string[] {
  const source = raw?.trim();
  if (!source) return [];

  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) return normalizeOpeningQuestions(parsed);
    if (typeof parsed === 'string') return normalizeOpeningQuestions(parsed.split(/\r?\n/));
  } catch {
    return normalizeOpeningQuestions(source.split(/\r?\n/));
  }

  return [];
}

type AgentChatAgentView = {
  name: string;
  title?: string;
  avatar?: string;
  description?: string;
  openingMessage?: string;
  openingQuestions?: string;
  systemPrompt?: string;
  knowledgeResources?: string;
  provider?: string;
  model?: string;
  effort?: string;
  cliCommand?: string;
};

type AgentChatConfigView = {
  memory?: { enabled?: boolean };
  workspace?: { root?: string };
  workspaceRoot?: string;
  tools?: string[];
  skills?: string[];
  mcpServers?: string[];
  searchMode?: string;
};

function AgentChatHeader({
  agent,
  modelName,
  modelId,
  onOpenProfile,
}: {
  agent: AgentChatAgentView;
  modelName: string;
  modelId: string;
  onOpenProfile?: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const title = agent.title || agent.name;
  const description = agent.description?.trim() || t('chat.agentHeader.fallbackDescription');
  const providerLabel = agent.provider?.trim() || t('chat.agentHeader.providerFallback');
  const runtimeLabel = agent.cliCommand?.trim() ? t('chat.agentHeader.runtimeCli') : providerLabel;
  return (
    <Flexbox style={{ flexShrink: 0 }}>
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        gap={12}
        style={{
          width: 'calc(100% - 36px)',
          minHeight: 78,
          margin: '16px 18px 0',
          padding: '0 18px',
          borderRadius: 18,
          background: token.colorBgContainer,
          boxShadow: '0 12px 35px rgba(15, 23, 42, 0.06)',
        }}
      >
        <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
          <AgentIconTile agent={agent} size={38} />

          <Flexbox gap={4} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 16, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </strong>
              <Tag style={{ margin: 0, borderRadius: 999, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <ModelIcon model={modelId} size={12} />
                {modelName}
              </Tag>
              <Tag style={{ margin: 0, borderRadius: 999, fontSize: 11 }}>
                {runtimeLabel}
              </Tag>
            </Flexbox>
            <span style={{ color: token.colorTextSecondary, fontSize: 12, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {description}
            </span>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal align="center" gap={4} style={{ flexShrink: 0 }}>
          <ActionIcon icon={UserRoundCog} size="small" title={t('chat.agentHeader.openProfile')} onClick={onOpenProfile} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}

function WelcomeScreen({
  agent,
  chatConfig,
  modelName,
  modelId,
  onSend,
}: {
  agent: AgentChatAgentView;
  chatConfig: AgentChatConfigView;
  modelName: string;
  modelId: string;
  onSend: (msg: string) => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const title = agent.title || agent.name;
  const questions = parseOpeningQuestions(agent.openingQuestions);
  const welcomeText = agent.openingMessage?.trim() || agent.description?.trim() || t('chat.welcome.fallbackText');
  const hasMemory = Boolean(chatConfig.memory?.enabled);
  const hasTools = (chatConfig.tools?.length ?? 0) > 0 || (chatConfig.skills?.length ?? 0) > 0 || (chatConfig.mcpServers?.length ?? 0) > 0;
  const statusItems = [
    {
      key: 'tools',
      icon: <Wrench size={12} />,
      label: hasTools ? t('chat.welcome.status.toolsEnabled') : t('chat.welcome.status.toolsReady'),
    },
    {
      key: 'runtime',
      icon: <Terminal size={12} />,
      label: agent.cliCommand?.trim() ? t('chat.agentHeader.runtimeCli') : modelName,
    },
    {
      key: 'memory',
      icon: <Brain size={12} />,
      label: hasMemory ? t('chat.welcome.capability.memory') : t('chat.welcome.capability.memoryDisabledShort'),
    },
  ];

  const quickActions = questions.length > 0
    ? questions.map((question) => ({ icon: <Sparkles size={13} />, label: question, prompt: question }))
    : [
      { icon: <Wrench size={13} />, label: t('chat.welcome.quickAction.readFile'), prompt: t('chat.welcome.quickAction.readFilePrompt') },
      { icon: <Terminal size={13} />, label: t('chat.welcome.quickAction.runCommand'), prompt: t('chat.welcome.quickAction.runCommandPrompt') },
      { icon: <Globe size={13} />, label: t('chat.welcome.quickAction.webSearch'), prompt: t('chat.welcome.quickAction.webSearchPrompt') },
      { icon: <Sparkles size={13} />, label: t('chat.welcome.quickAction.summarize'), prompt: t('chat.welcome.quickAction.summarizePrompt') },
    ];

  return (
    <Flexbox flex={1} align="center" justify="center" gap={18} style={{ padding: '28px 24px 18px', width: '100%' }}>
      <Flexbox
        align="center"
        gap={14}
        style={{
          width: 'min(430px, 100%)',
          padding: 28,
          borderRadius: 18,
          background: token.colorBgContainer,
          border: 'none',
          boxShadow: '0 24px 70px rgba(15, 23, 42, 0.08)',
          textAlign: 'center',
        }}
      >
        <AgentIconTile agent={agent} size={48} />

        <Flexbox align="center" gap={7} style={{ width: '100%' }}>
          <h2 style={{ margin: 0, fontSize: 18, lineHeight: 1.25, fontWeight: 900, color: token.colorText }}>
            {title}
          </h2>
          <Flexbox
            horizontal
            align="center"
            justify="center"
            gap={10}
            style={{
              width: '100%',
              minHeight: 28,
              padding: '5px 10px',
              borderRadius: 9,
              background: token.colorFillQuaternary,
              color: token.colorTextTertiary,
              fontSize: 11,
              overflow: 'hidden',
            }}
          >
            {statusItems.map((item, index) => (
              <span
                key={item.key}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  minWidth: 0,
                  color: index === 0 && hasTools ? token.colorSuccess : token.colorTextTertiary,
                  whiteSpace: 'nowrap',
                }}
              >
                {item.icon}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
              </span>
            ))}
          </Flexbox>
          <div style={{ color: token.colorTextSecondary, fontSize: 13, lineHeight: 1.65, maxWidth: 340 }}>
            <Markdown variant="chat" fontSize={13}>
              {welcomeText}
            </Markdown>
          </div>
          <Tag style={{ margin: 0, borderRadius: 999, fontSize: 11 }}>
            <ModelIcon model={modelId} size={12} />
            {modelName}
          </Tag>
        </Flexbox>
      </Flexbox>

      <Flexbox horizontal gap={10} wrap="wrap" justify="center" style={{ width: 'min(620px, 100%)' }}>
        {quickActions.slice(0, 5).map((action) => (
          <QuickAction
            key={action.label}
            icon={action.icon}
            label={action.label}
            onClick={() => onSend(action.prompt)}
          />
        ))}
      </Flexbox>
    </Flexbox>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  const { token } = theme.useToken();
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: 0,
        border: 0,
        background: 'transparent',
        color: token.colorText,
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: 650,
        transition: 'all 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = token.colorPrimary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = token.colorText;
      }}
    >
      {icon}
      {label}
    </button>
  );
}

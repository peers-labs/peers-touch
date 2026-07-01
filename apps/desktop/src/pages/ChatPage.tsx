import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, DraggablePanel, Tag, Input } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import { theme, Empty } from 'antd';
import type { MessageArtifact } from '../store/chat';
import { useChatStore } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { MessageBubble } from '../components/MessageBubble';
import { ChatInput } from '../components/ChatInput';
import { LazyMarkdown as Markdown } from '../components/LazyMarkdown';
import { useUserAvatar } from '../components/UserProfilePopover';
import {
  FileText,
  Terminal,
  Globe,
  Sparkles,
  FilePen,
  Maximize2,
  Trash2,
  BookOpen,
  Plus,
  Wrench,
  Brain,
  ChevronRight,
  PanelRightClose,
  ArrowLeft,
  Save,
  Copy,
  Download,
  Code2,
  Braces,
  Workflow,
  UserRoundCog,
  Share2,
  RefreshCw,
} from 'lucide-react';
import { parseAgentChatConfig, api } from '../services/desktop_api';
import type { Agent } from '../services/desktop_api';

export function ChatPage({ onNavigateSettings, onNavigateApplets, onNavigateSkills, onNavigateAgentProfile, onNavigatePages }: {
  onNavigateSettings?: () => void;
  onNavigateApplets?: () => void;
  onNavigateSkills?: () => void;
  onNavigateAgentProfile?: (agentName: string) => void;
  onNavigatePages?: (docId?: string) => void;
}) {
  const {
    selectedModel,
    availableModels,
    defaultModel,
    enabledAppletIds,
    selectedAgent,
    agents,
  } = useAgentStore();
  const {
    messages,
    currentSessionKey,
    selectSession,
    sendMessage,
    showPortal,
    togglePortal,
    portalDocuments,
    portalLoading,
    deleteDocument,
    createDocument,
    isStreaming,
  } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const userAvatar = useUserAvatar();
  const [portalView, setPortalView] = useState<'list' | 'editor'>('list');
  const [editingDoc, setEditingDoc] = useState<import('../services/desktop_api').NotebookDocument | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [activeArtifact, setActiveArtifact] = useState<MessageArtifact | null>(null);

  const currentModelId = selectedModel || defaultModel;
  const currentModel = availableModels.find((m) => m.id === currentModelId);
  const isWebSearchEnabled = enabledAppletIds.includes('web-search');

  const handleOpenDocument = useCallback(async (doc: import('../services/desktop_api').NotebookDocument) => {
    try {
      const fullDoc = await api.getDocument(doc.id);
      setEditingDoc(fullDoc);
      setEditTitle(fullDoc.title || '');
      setEditContent(fullDoc.content || '');
      setPortalView('editor');
    } catch {
      setEditingDoc(doc);
      setEditTitle(doc.title || '');
      setEditContent(doc.content || '');
      setPortalView('editor');
    }
  }, []);

  const handleSaveDocument = useCallback(async () => {
    if (!editingDoc) return;
    try {
      await api.updateDocument(editingDoc.id, editTitle, editContent);
      loadDocuments();
    } catch { /* best effort */ }
  }, [editingDoc, editTitle, editContent]);

  const handleBackToList = useCallback(() => {
    if (editingDoc) handleSaveDocument();
    setPortalView('list');
    setEditingDoc(null);
  }, [editingDoc, handleSaveDocument]);

  const handleUseDocumentInChat = useCallback((doc: import('../services/desktop_api').NotebookDocument, title: string, content: string) => {
    const prompt = t('chat.editor.useDocumentPrompt', {
      title: title || doc.title || t('chat.notebook.untitled'),
      content: content || t('chat.editor.noContent'),
    });
    sendMessage(prompt);
  }, [sendMessage, t]);

  const loadDocuments = useChatStore((s) => s.loadDocuments);

  const currentAgent = useMemo(
    () =>
      agents.find((a) => a.name === selectedAgent) || {
        name: selectedAgent || 'assistant',
        title: 'Peers Touch',
        description: t('chat.welcome.defaultDescription'),
        avatar: '🤖',
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
          chatConfig={agentChatConfig}
          modelName={currentModel?.display_name || currentModelId}
          modelId={currentModelId}
          webSearchEnabled={isWebSearchEnabled}
          notebookOpen={showPortal}
          onOpenNotebook={togglePortal}
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
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    userAvatar={userAvatar}
                    agentAvatar={currentAgent?.avatar}
                    onOpenArtifact={setActiveArtifact}
                  />
                ))}
                <div ref={bottomRef} />
              </>
            )}
          </Flexbox>
        </Flexbox>

        <Flexbox align="center" style={{ flexShrink: 0, padding: '0 28px 22px' }}>
          <div style={{ width: 'min(780px, 100%)' }}>
            <ChatInput
              onNavigateSettings={onNavigateSettings}
              onNavigateApplets={onNavigateApplets}
              onNavigateSkills={onNavigateSkills}
            />
          </div>
        </Flexbox>
      </Flexbox>

      {/* Portal / Notebook panel */}
      <DraggablePanel
        placement="right"
        defaultSize={{ width: 360 }}
        minWidth={300}
        maxWidth={520}
        expand={showPortal}
        onExpandChange={(expand) => { if (!expand) togglePortal(); }}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {portalView === 'editor' && editingDoc ? (
          <DocumentEditor
            doc={editingDoc}
            title={editTitle}
            content={editContent}
            onTitleChange={setEditTitle}
            onContentChange={setEditContent}
            onSave={handleSaveDocument}
            onBack={handleBackToList}
            onClose={togglePortal}
            onOpenFullPage={(docId) => onNavigatePages?.(docId)}
            onUseInChat={handleUseDocumentInChat}
          />
        ) : (
          <NotebookPanel
            documents={portalDocuments}
            loading={portalLoading}
            onDelete={deleteDocument}
            onCreate={createDocument}
            onClose={togglePortal}
            onOpenDocument={handleOpenDocument}
          />
        )}
      </DraggablePanel>

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
  toolsProfile?: string;
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
  chatConfig,
  modelName,
  modelId,
  webSearchEnabled,
  notebookOpen,
  onOpenNotebook,
  onOpenProfile,
}: {
  agent: AgentChatAgentView;
  chatConfig: AgentChatConfigView;
  modelName: string;
  modelId: string;
  webSearchEnabled: boolean;
  notebookOpen: boolean;
  onOpenNotebook: () => void;
  onOpenProfile?: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const title = agent.title || agent.name;
  const description = agent.description?.trim() || t('chat.agentHeader.fallbackDescription');
  const providerLabel = agent.provider?.trim() || t('chat.agentHeader.providerFallback');
  const runtimeLabel = agent.cliCommand?.trim() ? t('chat.agentHeader.runtimeCli') : providerLabel;
  const effort = agent.effort?.trim();
  const hasTools = Boolean(agent.toolsProfile && agent.toolsProfile !== 'none') || (chatConfig.tools?.length ?? 0) > 0 || (chatConfig.skills?.length ?? 0) > 0 || (chatConfig.mcpServers?.length ?? 0) > 0;

  return (
    <Flexbox style={{ flexShrink: 0 }}>
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        gap={12}
        style={{
          width: '100%',
          minHeight: 60,
          padding: '10px 18px',
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6 52%, #ec4899)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 21,
              boxShadow: '0 10px 24px rgba(99, 102, 241, 0.18)',
              flexShrink: 0,
            }}
          >
            {agent.avatar || '🤖'}
          </div>

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
              {effort && (
                <Tag style={{ margin: 0, borderRadius: 999, fontSize: 11 }}>
                  {t('chat.agentHeader.effort', { effort })}
                </Tag>
              )}
              {hasTools && (
                <Tag color="success" style={{ margin: 0, borderRadius: 999, fontSize: 11 }}>
                  {t('chat.agentHeader.toolsEnabled')}
                </Tag>
              )}
              {webSearchEnabled && (
                <Tag color="blue" style={{ margin: 0, borderRadius: 999, fontSize: 11 }}>
                  {t('chat.header.webSearch')}
                </Tag>
              )}
            </Flexbox>
            <span style={{ color: token.colorTextSecondary, fontSize: 12, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {description}
            </span>
          </Flexbox>
        </Flexbox>

        <Flexbox horizontal align="center" gap={4} style={{ flexShrink: 0 }}>
          <ActionIcon icon={UserRoundCog} size="small" title={t('chat.agentHeader.openProfile')} onClick={onOpenProfile} />
          <ActionIcon icon={FilePen} size="small" active={notebookOpen} title={t('chat.header.notebook')} onClick={onOpenNotebook} />
          <ActionIcon icon={Share2} size="small" title={t('chat.header.share')} onClick={() => {}} />
          <ActionIcon icon={RefreshCw} size="small" title={t('chat.agentHeader.refresh')} onClick={() => {}} />
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
  const avatar = agent.avatar || '🤖';
  const questions = parseOpeningQuestions(agent.openingQuestions);
  const welcomeText = agent.openingMessage?.trim() || agent.description?.trim() || t('chat.welcome.fallbackText');
  const workspaceRoot = chatConfig.workspace?.root || chatConfig.workspaceRoot || '';
  const hasMemory = Boolean(chatConfig.memory?.enabled);
  const hasTools = Boolean(agent.toolsProfile && agent.toolsProfile !== 'none') || (chatConfig.tools?.length ?? 0) > 0 || (chatConfig.skills?.length ?? 0) > 0 || (chatConfig.mcpServers?.length ?? 0) > 0;
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
    {
      key: 'workspace',
      icon: <BookOpen size={12} />,
      label: workspaceRoot ? t('chat.welcome.capability.workspace') : t('chat.welcome.capability.workspaceOptional'),
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
          width: 'min(420px, 100%)',
          padding: '24px 32px 22px',
          borderRadius: 22,
          background: token.colorBgContainer,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: '0 22px 70px rgba(15, 23, 42, 0.07)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6 52%, #ec4899)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            boxShadow: '0 14px 34px rgba(99, 102, 241, 0.24)',
          }}
        >
          {avatar}
        </div>

        <Flexbox align="center" gap={7} style={{ width: '100%' }}>
          <h2 style={{ margin: 0, fontSize: 21, lineHeight: 1.25, fontWeight: 800, color: token.colorText }}>
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
        gap: 6,
        padding: '8px 14px',
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        color: token.colorText,
        cursor: 'pointer',
        fontSize: 13,
        transition: 'all 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = token.colorPrimary;
        e.currentTarget.style.color = token.colorPrimary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = token.colorBorderSecondary;
        e.currentTarget.style.color = token.colorText;
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function NotebookPanel({
  documents,
  loading,
  onDelete,
  onCreate,
  onClose,
  onOpenDocument,
}: {
  documents: import('../services/desktop_api').NotebookDocument[];
  loading: boolean;
  onDelete: (id: string) => void;
  onCreate: (title: string, content: string) => void;
  onClose: () => void;
  onOpenDocument: (doc: import('../services/desktop_api').NotebookDocument) => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  const handleCreate = useCallback(() => {
    const title = newTitle.trim();
    if (!title) return;
    onCreate(title, '');
    setNewTitle('');
    setCreating(false);
  }, [newTitle, onCreate]);

  useEffect(() => {
    if (creating) titleRef.current?.focus();
  }, [creating]);

  return (
    <Flexbox flex={1} style={{ height: '100%' }}>
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Flexbox horizontal align="center" gap={8}>
          <BookOpen size={16} style={{ color: token.colorTextSecondary }} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('chat.notebook.title')}</span>
        </Flexbox>
        <Flexbox horizontal align="center" gap={2}>
          <ActionIcon
            icon={Plus}
            size="small"
            title={t('chat.notebook.newPage')}
            onClick={() => setCreating(true)}
          />
          <ActionIcon
            icon={PanelRightClose}
            size="small"
            title={t('chat.notebook.close')}
            onClick={onClose}
          />
        </Flexbox>
      </Flexbox>

      {creating && (
        <Flexbox
          horizontal
          gap={8}
          style={{ padding: '8px 12px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}
        >
          <input
            ref={titleRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
            placeholder={t('chat.notebook.pageTitle.placeholder')}
            style={{
              flex: 1,
              border: `1px solid ${token.colorBorder}`,
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 13,
              outline: 'none',
              background: token.colorBgContainer,
              color: token.colorText,
            }}
          />
        </Flexbox>
      )}

      <Flexbox flex={1} style={{ overflow: 'auto', padding: 8 }}>
        {loading ? (
          <Flexbox align="center" justify="center" flex={1} style={{ padding: 24 }}>
            <span style={{ color: token.colorTextDescription, fontSize: 13 }}>{t('chat.notebook.loading')}</span>
          </Flexbox>
        ) : documents.length === 0 ? (
          <Flexbox align="center" justify="center" flex={1} gap={8} style={{ padding: 24 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ color: token.colorTextDescription, fontSize: 13 }}>
                  {t('chat.notebook.empty')}
                </span>
              }
            />
          </Flexbox>
        ) : (
          documents.map((doc) => (
            <DocumentItem key={doc.id} doc={doc} onDelete={onDelete} onClick={() => onOpenDocument(doc)} />
          ))
        )}
      </Flexbox>
    </Flexbox>
  );
}

function DocumentItem({
  doc,
  onDelete,
  onClick,
}: {
  doc: import('../services/desktop_api').NotebookDocument;
  onDelete: (id: string) => void;
  onClick: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [hovered, setHovered] = useState(false);

  return (
    <Flexbox
      horizontal
      align="center"
      gap={8}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '8px 12px',
        borderRadius: 8,
        cursor: 'pointer',
        background: hovered ? token.colorFillTertiary : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      <FileText size={16} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
      <Flexbox flex={1} style={{ minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {doc.title || t('chat.notebook.untitled')}
        </span>
        <span style={{ fontSize: 11, color: token.colorTextDescription }}>
          {new Date(doc.updated_at).toLocaleDateString()}
        </span>
      </Flexbox>
      {hovered && (
        <ActionIcon
          icon={Trash2}
          size={{ blockSize: 24, size: 14 }}
          title={t('chat.notebook.delete')}
          onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }}
          style={{ color: token.colorTextTertiary }}
        />
      )}
    </Flexbox>
  );
}

function DocumentEditor({
  doc,
  title,
  content,
  onTitleChange,
  onContentChange,
  onSave,
  onBack,
  onClose,
  onOpenFullPage,
  onUseInChat,
}: {
  doc: import('../services/desktop_api').NotebookDocument;
  title: string;
  content: string;
  onTitleChange: (t: string) => void;
  onContentChange: (c: string) => void;
  onSave: () => void;
  onBack: () => void;
  onClose: () => void;
  onOpenFullPage?: (docId: string) => void;
  onUseInChat?: (doc: import('../services/desktop_api').NotebookDocument, title: string, content: string) => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [preview, setPreview] = useState(false);

  return (
    <Flexbox flex={1} style={{ height: '100%' }}>
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          padding: '8px 12px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Flexbox horizontal align="center" gap={4}>
          <ActionIcon
            icon={ArrowLeft}
            size="small"
            title={t('chat.editor.back')}
            onClick={onBack}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{t('chat.editor.document')}</span>
        </Flexbox>
        <Flexbox horizontal align="center" gap={2}>
          <ActionIcon
            icon={Save}
            size="small"
            title={t('chat.editor.save')}
            onClick={onSave}
          />
          {onUseInChat && (
            <ActionIcon
              icon={FileText}
              size="small"
              title={t('chat.editor.useInChat')}
              onClick={() => onUseInChat(doc, title, content)}
            />
          )}
          {onOpenFullPage && (
            <ActionIcon
              icon={Maximize2}
              size="small"
              title={t('chat.editor.openFullPage')}
              onClick={() => onOpenFullPage(doc.id)}
            />
          )}
          <ActionIcon
            icon={PanelRightClose}
            size="small"
            title={t('chat.editor.close')}
            onClick={onClose}
          />
        </Flexbox>
      </Flexbox>

      {/* Title */}
      <div style={{ padding: '12px 16px 0' }}>
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder={t('chat.editor.titlePlaceholder')}
          variant="borderless"
          style={{ fontSize: 18, fontWeight: 600, padding: 0 }}
          onBlur={onSave}
        />
      </div>

      {/* Tabs: Edit / Preview */}
      <Flexbox horizontal gap={0} style={{ padding: '8px 16px 0', borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <button
          onClick={() => setPreview(false)}
          style={{
            padding: '4px 12px',
            border: 'none',
            background: 'transparent',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            color: !preview ? token.colorPrimary : token.colorTextSecondary,
            borderBottom: !preview ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
          }}
        >
          {t('chat.editor.tab.edit')}
        </button>
        <button
          onClick={() => setPreview(true)}
          style={{
            padding: '4px 12px',
            border: 'none',
            background: 'transparent',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            color: preview ? token.colorPrimary : token.colorTextSecondary,
            borderBottom: preview ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
          }}
        >
          {t('chat.editor.tab.preview')}
        </button>
      </Flexbox>

      {/* Content */}
      <Flexbox flex={1} style={{ overflow: 'auto', padding: 16, minHeight: 0 }}>
        {preview ? (
          <Markdown variant="chat" fontSize={14}>
            {content || t('chat.editor.noContent')}
          </Markdown>
        ) : (
          <textarea
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            onBlur={onSave}
            placeholder={t('chat.editor.contentPlaceholder')}
            style={{
              width: '100%',
              height: '100%',
              minHeight: 200,
              resize: 'none',
              border: 'none',
              outline: 'none',
              fontFamily: 'monospace',
              fontSize: 13,
              lineHeight: 1.6,
              background: 'transparent',
              color: token.colorText,
            }}
          />
        )}
      </Flexbox>
    </Flexbox>
  );
}

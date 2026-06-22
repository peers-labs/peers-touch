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
  CheckCircle,
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
} from 'lucide-react';
import { parseAgentChatConfig, api } from '../services/desktop_api';

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
    () => ('chatConfig' in currentAgent ? parseAgentChatConfig(currentAgent as any) : {}),
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
      {/* Main chat area */}
      <Flexbox flex={1} height="100%" style={{ minWidth: 0, overflow: 'hidden' }}>
        {/* Header bar - LobeChat style with model + feature tags */}
        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          style={{
            height: 48,
            padding: '0 16px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            flexShrink: 0,
          }}
        >
          {/* Left: Model + Feature tags */}
          <Flexbox horizontal align="center" gap={6}>
            <Tag
              style={{
                margin: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 10px 2px 6px',
                borderRadius: 6,
                cursor: 'pointer',
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
              }}
            >
              <ModelIcon model={currentModelId} size={16} />
              <span style={{ fontSize: 12, fontWeight: 500, color: token.colorText }}>
                {currentModel?.display_name || currentModelId}
              </span>
            </Tag>

            {isWebSearchEnabled && (
              <Tag
                icon={<Globe size={11} />}
                color="blue"
                style={{
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                }}
              >
                Web search
            </Tag>
            )}
          </Flexbox>

          {/* Right: Actions */}
          <Flexbox horizontal align="center" gap={4}>
            <ActionIcon
              icon={FilePen}
              size="small"
              active={showPortal}
              title={t('chat.header.notebook')}
              onClick={togglePortal}
            />
          </Flexbox>
        </Flexbox>

        {/* Chat content — messages start from top; welcome screen is centered */}
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
              agent={currentAgent as any}
              chatConfig={agentChatConfig}
              modelName={currentModel?.display_name || currentModelId}
              onSend={sendMessage}
              onConfigure={() => onNavigateAgentProfile?.(currentAgent.name)}
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

        <ChatInput
          onNavigateSettings={onNavigateSettings}
          onNavigateApplets={onNavigateApplets}
          onNavigateSkills={onNavigateSkills}
        />
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

function parseKnowledgeResourceCount(raw?: string): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function WelcomeScreen({
  agent,
  chatConfig,
  modelName,
  onSend,
  onConfigure,
}: {
  agent: { name: string; title?: string; avatar?: string; description?: string; openingMessage?: string; openingQuestions?: string; systemPrompt?: string; knowledgeResources?: string };
  chatConfig: any;
  modelName: string;
  onSend: (msg: string) => void;
  onConfigure?: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const title = agent.title || agent.name;
  const avatar = agent.avatar || '🤖';
  const questions = parseOpeningQuestions(agent.openingQuestions);
  const welcomeText = agent.openingMessage?.trim() || agent.description?.trim() || t('chat.welcome.fallbackText');

  const hasTools = true;
  const hasMemory = chatConfig?.memory?.enabled;
  const workspaceRoot = chatConfig?.workspace?.root || chatConfig?.workspaceRoot || '';
  const knowledgeCount = parseKnowledgeResourceCount(agent.knowledgeResources);
  const capabilityCards = [
    {
      key: 'model',
      icon: <Code2 size={16} />,
      title: t('chat.welcome.capability.model'),
      value: modelName,
      tone: '#2563eb',
    },
    {
      key: 'tools',
      icon: <Wrench size={16} />,
      title: t('chat.welcome.capability.tools'),
      value: hasTools ? t('chat.welcome.capability.ready') : t('chat.welcome.capability.notConfigured'),
      tone: '#7c3aed',
    },
    {
      key: 'memory',
      icon: <Brain size={16} />,
      title: t('chat.welcome.capability.memory'),
      value: hasMemory ? t('chat.welcome.capability.enabled') : t('chat.welcome.capability.disabled'),
      tone: '#059669',
    },
    {
      key: 'workspace',
      icon: <BookOpen size={16} />,
      title: t('chat.welcome.capability.workspace'),
      value: workspaceRoot ? t('chat.welcome.capability.bound') : t('chat.welcome.capability.notConfigured'),
      tone: '#d97706',
    },
  ];

  return (
    <Flexbox
      flex={1}
      align="center"
      justify="center"
      gap={18}
      style={{ padding: '24px', width: '100%' }}
    >
      <Flexbox
        horizontal
        gap={18}
        style={{
          maxWidth: 920,
          width: '100%',
          padding: 18,
          borderRadius: 24,
          background:
            'radial-gradient(circle at top left, rgba(99,102,241,0.16), transparent 34%), radial-gradient(circle at bottom right, rgba(14,165,233,0.12), transparent 30%), ' + token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: '0 24px 80px rgba(15, 23, 42, 0.08)',
        }}
      >
        <Flexbox flex={1} gap={16} style={{ minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={14}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 24,
                background: 'linear-gradient(135deg, #2563eb, #7c3aed 48%, #db2777)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 36,
                boxShadow: '0 16px 42px rgba(79, 70, 229, 0.26)',
              }}
            >
              {avatar}
            </div>
            <Flexbox gap={6} style={{ minWidth: 0 }}>
              <Flexbox horizontal align="center" gap={6}>
                <Tag style={{ margin: 0 }}>{t('chat.welcome.heroKicker')}</Tag>
                {knowledgeCount > 0 && (
                  <Tag style={{ margin: 0 }}>
                    {t('chat.welcome.knowledgeCount', { count: knowledgeCount })}
                  </Tag>
                )}
              </Flexbox>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: token.colorText, margin: 0, letterSpacing: -0.4 }}>
                {title}
              </h2>
              <div style={{ fontSize: 14, color: token.colorTextSecondary, lineHeight: 1.7, maxWidth: 560 }}>
                <Markdown variant="chat" fontSize={14}>
                  {welcomeText}
                </Markdown>
              </div>
            </Flexbox>
          </Flexbox>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            {capabilityCards.map((item) => (
              <CapabilityCard
                key={item.key}
                icon={item.icon}
                title={item.title}
                value={item.value}
                tone={item.tone}
              />
            ))}
          </div>
        </Flexbox>

        <Flexbox
          gap={10}
          style={{
            width: 220,
            padding: 14,
            borderRadius: 18,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Flexbox horizontal align="center" gap={8}>
            <CheckCircle size={16} style={{ color: token.colorSuccess }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: token.colorText }}>
              {t('chat.welcome.runtimeTitle')}
            </span>
          </Flexbox>
          <span style={{ fontSize: 12, lineHeight: 1.6, color: token.colorTextSecondary }}>
            {t('chat.welcome.runtimeDesc')}
          </span>
          <Tag style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 4, width: 'fit-content' }}>
            <ModelIcon model={modelName} size={12} />
            {modelName}
          </Tag>
          <button
            type="button"
            onClick={onConfigure}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              width: '100%',
              marginTop: 2,
              padding: '8px 10px',
              borderRadius: 12,
              border: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorFillQuaternary,
              color: token.colorText,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <UserRoundCog size={14} />
              {t('chat.welcome.configureAgent')}
            </span>
            <ChevronRight size={13} style={{ color: token.colorTextTertiary }} />
          </button>
        </Flexbox>
      </Flexbox>

      {questions.length > 0 ? (
        <Flexbox align="center" gap={10} style={{ maxWidth: 920, width: '100%' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextDescription }}>
            {t('chat.welcome.starterQuestions')}
          </span>
          <Flexbox horizontal gap={10} wrap="wrap" justify="center">
            {questions.map((q, i) => (
              <QuickAction
                key={`${q}-${i}`}
                icon={<Sparkles size={14} />}
                label={q}
                onClick={() => onSend(q)}
              />
            ))}
          </Flexbox>
        </Flexbox>
      ) : (
        <Flexbox align="center" gap={10} style={{ maxWidth: 920, width: '100%' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextDescription }}>
            {t('chat.welcome.defaultActions')}
          </span>
          <Flexbox horizontal gap={10} wrap="wrap" justify="center">
            <QuickAction icon={<FileText size={14} />} label={t('chat.welcome.quickAction.readFile')} onClick={() => onSend(t('chat.welcome.quickAction.readFilePrompt'))} />
            <QuickAction icon={<Terminal size={14} />} label={t('chat.welcome.quickAction.runCommand')} onClick={() => onSend(t('chat.welcome.quickAction.runCommandPrompt'))} />
            <QuickAction icon={<Globe size={14} />} label={t('chat.welcome.quickAction.webSearch')} onClick={() => onSend(t('chat.welcome.quickAction.webSearchPrompt'))} />
            <QuickAction icon={<Sparkles size={14} />} label={t('chat.welcome.quickAction.summarize')} onClick={() => onSend(t('chat.welcome.quickAction.summarizePrompt'))} />
          </Flexbox>
        </Flexbox>
      )}
    </Flexbox>
  );
}

function CapabilityCard({
  icon,
  title,
  value,
  tone,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  tone: string;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      gap={6}
      style={{
        padding: '10px 12px',
        borderRadius: 14,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Flexbox horizontal align="center" gap={7}>
        <span style={{ display: 'flex', color: tone }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: token.colorText }}>{title}</span>
      </Flexbox>
      <span style={{ fontSize: 12, color: token.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
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
        padding: '8px 16px',
        borderRadius: 20,
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

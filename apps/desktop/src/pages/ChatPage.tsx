import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, DraggablePanel, Markdown } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import { theme, Dropdown, Switch, Tag, Empty, Input } from 'antd';
import type { MenuProps } from 'antd';
import { useChatStore } from '../store/chat';
import { MessageBubble } from '../components/MessageBubble';
import { ChatInput } from '../components/ChatInput';
import { useUserAvatar } from '../components/UserProfilePopover';
import { ShareDialog } from '../components/ShareDialog';
import {
  FileText,
  Terminal,
  Globe,
  Sparkles,
  FilePen,
  Maximize2,
  MoreHorizontal,
  Trash2,
  BookOpen,
  Plus,
  Share2,
  Wrench,
  Brain,
  CheckCircle,
  ChevronRight,
  PanelRightClose,
  ArrowLeft,
  Save,
} from 'lucide-react';
import { parseAgentChatConfig, api } from '../services/api';

export function ChatPage({ onNavigateSettings, onNavigateApplets, onNavigateSkills, onNavigatePages }: {
  onNavigateSettings?: () => void;
  onNavigateApplets?: () => void;
  onNavigateSkills?: () => void;
  onNavigatePages?: (docId?: string) => void;
}) {
  const {
    messages,
    currentSessionKey,
    selectSession,
    sendMessage,
    selectedModel,
    availableModels,
    defaultModel,
    enabledAppletIds,
    showPortal,
    togglePortal,
    portalDocuments,
    portalLoading,
    deleteDocument,
    createDocument,
    wideScreen,
    setWideScreen,
    loadPreferences,
    selectedAgent,
    agents,
    isStreaming,
  } = useChatStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();
  const userAvatar = useUserAvatar();
  const [shareOpen, setShareOpen] = useState(false);
  const [portalView, setPortalView] = useState<'list' | 'editor'>('list');
  const [editingDoc, setEditingDoc] = useState<import('../services/api').NotebookDocument | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');

  const currentModelId = selectedModel || defaultModel;
  const currentModel = availableModels.find((m) => m.id === currentModelId);
  const isWebSearchEnabled = enabledAppletIds.includes('web-search');

  const handleOpenDocument = useCallback(async (doc: import('../services/api').NotebookDocument) => {
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

  const loadDocuments = useChatStore((s) => s.loadDocuments);

  const currentAgent = useMemo(
    () =>
      agents.find((a) => a.name === selectedAgent) || {
        name: selectedAgent || 'assistant',
        title: 'Agent Box',
        description: 'Your default personal AI assistant.',
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
    loadPreferences();
  }, [currentSessionKey, selectSession, loadPreferences]);

  useEffect(() => {
    if (messages.length === 0) return;
    bottomRef.current?.scrollIntoView({ behavior: isStreaming ? 'smooth' : 'instant' });
  }, [messages, isStreaming]);

  const isEmpty = messages.length === 0;

  const headerMenuItems: MenuProps['items'] = [
    {
      key: 'wide',
      label: (
        <Flexbox horizontal align="center" justify="space-between" gap={12} style={{ minWidth: 160 }}>
          <Flexbox horizontal align="center" gap={8}>
            <Maximize2 size={14} />
            <span>Full Width</span>
          </Flexbox>
          <Switch
            size="small"
            checked={wideScreen}
            onChange={(v) => setWideScreen(v)}
          />
        </Flexbox>
      ),
    },
  ];

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
              title="Notebook"
              onClick={togglePortal}
            />
            <ActionIcon
              icon={Share2}
              size="small"
              title="Share"
              onClick={() => setShareOpen(true)}
            />
            <Dropdown menu={{ items: headerMenuItems }} trigger={['click']} placement="bottomRight">
              <div>
                <ActionIcon icon={MoreHorizontal} size="small" title="More" />
              </div>
            </Dropdown>
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
            />
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  userAvatar={userAvatar}
                  agentAvatar={currentAgent?.avatar}
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

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        sessionKey={currentSessionKey}
        messages={messages}
        title={currentAgent?.title || 'Conversation'}
      />
    </Flexbox>
  );
}

function WelcomeScreen({
  agent,
  chatConfig,
  modelName,
  onSend,
}: {
  agent: { name: string; title?: string; avatar?: string; description?: string; openingMessage?: string; openingQuestions?: string; systemPrompt?: string };
  chatConfig: any;
  modelName: string;
  onSend: (msg: string) => void;
}) {
  const { token } = theme.useToken();

  let questions: string[] = [];
  try {
    questions = JSON.parse(agent.openingQuestions || '[]');
  } catch {
    questions = [];
  }

  const title = agent.title || agent.name;
  const avatar = agent.avatar || '🤖';
  const welcomeText = agent.openingMessage || agent.description || 'Ask, create, or start a task.';

  const hasTools = true;
  const hasMemory = chatConfig?.memory?.enabled;

  return (
    <Flexbox
      flex={1}
      align="center"
      justify="center"
      gap={24}
      style={{ padding: '0 24px' }}
    >
      {/* Agent info card - LobeChat style */}
      <Flexbox
        align="center"
        gap={12}
        style={{
          padding: '32px 40px 24px',
          borderRadius: 16,
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
          maxWidth: 520,
          width: '100%',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
          }}
        >
          {avatar}
        </div>
        <h2
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: token.colorText,
            margin: 0,
          }}
        >
          {title}
        </h2>

        {/* Active features - similar to LobeChat */}
        <Flexbox gap={6} style={{ width: '100%' }}>
          {hasTools && (
            <Flexbox
              horizontal
              align="center"
              gap={8}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                background: token.colorFillTertiary,
                fontSize: 13,
                color: token.colorTextSecondary,
              }}
            >
              <CheckCircle size={14} style={{ color: token.colorSuccess }} />
              <span>Activate Tools</span>
              <Wrench size={12} style={{ color: token.colorTextTertiary }} />
              <span style={{ color: token.colorTextDescription }}>Built-in</span>
              {hasMemory && (
                <>
                  <Brain size={12} style={{ color: token.colorTextTertiary, marginLeft: 4 }} />
                  <span style={{ color: token.colorTextDescription }}>Memory</span>
                </>
              )}
              <ChevronRight size={12} style={{ color: token.colorTextQuaternary, marginLeft: 'auto' }} />
            </Flexbox>
          )}
        </Flexbox>

        <p
          style={{
            fontSize: 14,
            color: token.colorTextSecondary,
            margin: 0,
            textAlign: 'center',
            lineHeight: 1.6,
          }}
        >
          {welcomeText}
        </p>

        {/* Model tag */}
        <Tag
          style={{
            margin: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 10px',
            borderRadius: 4,
            fontSize: 11,
            color: token.colorTextDescription,
          }}
        >
          <ModelIcon model={modelName} size={12} />
          {modelName}
        </Tag>
      </Flexbox>

      {/* Quick actions */}
      {questions.length > 0 ? (
        <Flexbox horizontal gap={10} wrap="wrap" justify="center" style={{ maxWidth: 520 }}>
          {questions.map((q, i) => (
            <QuickAction
              key={i}
              icon={<Sparkles size={14} />}
              label={q}
              onClick={() => onSend(q)}
            />
          ))}
        </Flexbox>
      ) : (
        <Flexbox horizontal gap={10} wrap="wrap" justify="center" style={{ maxWidth: 520 }}>
          <QuickAction icon={<FileText size={14} />} label="Read File" onClick={() => onSend('Help me read and analyze a file.')} />
          <QuickAction icon={<Terminal size={14} />} label="Run Command" onClick={() => onSend('Help me run a shell command.')} />
          <QuickAction icon={<Globe size={14} />} label="Web Search" onClick={() => onSend('Search the web for the latest news.')} />
          <QuickAction icon={<Sparkles size={14} />} label="Summarize" onClick={() => onSend('Help me summarize some content.')} />
        </Flexbox>
      )}
    </Flexbox>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
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
  documents: import('../services/api').NotebookDocument[];
  loading: boolean;
  onDelete: (id: string) => void;
  onCreate: (title: string, content: string) => void;
  onClose: () => void;
  onOpenDocument: (doc: import('../services/api').NotebookDocument) => void;
}) {
  const { token } = theme.useToken();
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
          <span style={{ fontSize: 14, fontWeight: 600 }}>Notebook</span>
        </Flexbox>
        <Flexbox horizontal align="center" gap={2}>
          <ActionIcon
            icon={Plus}
            size="small"
            title="New page"
            onClick={() => setCreating(true)}
          />
          <ActionIcon
            icon={PanelRightClose}
            size="small"
            title="Close"
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
            placeholder="Page title..."
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
            <span style={{ color: token.colorTextDescription, fontSize: 13 }}>Loading...</span>
          </Flexbox>
        ) : documents.length === 0 ? (
          <Flexbox align="center" justify="center" flex={1} gap={8} style={{ padding: 24 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ color: token.colorTextDescription, fontSize: 13 }}>
                  No pages yet. The agent can save documents here during conversation, or you can create pages manually.
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
  doc: import('../services/api').NotebookDocument;
  onDelete: (id: string) => void;
  onClick: () => void;
}) {
  const { token } = theme.useToken();
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
          {doc.title || 'Untitled'}
        </span>
        <span style={{ fontSize: 11, color: token.colorTextDescription }}>
          {new Date(doc.updated_at).toLocaleDateString()}
        </span>
      </Flexbox>
      {hovered && (
        <ActionIcon
          icon={Trash2}
          size={{ blockSize: 24, size: 14 }}
          title="Delete"
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
}: {
  doc: import('../services/api').NotebookDocument;
  title: string;
  content: string;
  onTitleChange: (t: string) => void;
  onContentChange: (c: string) => void;
  onSave: () => void;
  onBack: () => void;
  onClose: () => void;
  onOpenFullPage?: (docId: string) => void;
}) {
  const { token } = theme.useToken();
  const [preview, setPreview] = useState(false);

  return (
    <Flexbox flex={1} style={{ height: '100%' }}>
      {/* Header with back + close */}
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
            title="Back"
            onClick={onBack}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>Document</span>
        </Flexbox>
        <Flexbox horizontal align="center" gap={2}>
          <ActionIcon
            icon={Save}
            size="small"
            title="Save"
            onClick={onSave}
          />
          {onOpenFullPage && (
            <ActionIcon
              icon={Maximize2}
              size="small"
              title="Open Full Page"
              onClick={() => onOpenFullPage(doc.id)}
            />
          )}
          <ActionIcon
            icon={PanelRightClose}
            size="small"
            title="Close"
            onClick={onClose}
          />
        </Flexbox>
      </Flexbox>

      {/* Title */}
      <div style={{ padding: '12px 16px 0' }}>
        <Input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Document title..."
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
          Edit
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
          Preview
        </button>
      </Flexbox>

      {/* Content */}
      <Flexbox flex={1} style={{ overflow: 'auto', padding: 16, minHeight: 0 }}>
        {preview ? (
          <Markdown variant="chat" fontSize={14}>
            {content || '*No content yet*'}
          </Markdown>
        ) : (
          <textarea
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            onBlur={onSave}
            placeholder="Write your notes here... (Markdown supported)"
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

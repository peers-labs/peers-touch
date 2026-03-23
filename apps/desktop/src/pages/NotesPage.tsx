import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Flexbox, Center } from 'react-layout-kit';
import { ActionIcon, Markdown } from '@lobehub/ui';
import { theme, Input, Empty, Spin, Popconfirm, message as antMessage, Divider } from 'antd';
import {
  Plus,
  FileText,
  Trash2,
  Search,
  X,
  Save,
  MessageSquare,
  PanelRightOpen,
  PanelRightClose,
  Eye,
  Edit,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  SquareCode,
  ArrowLeft,
} from 'lucide-react';
import { api, type NotebookDocumentWithTopic } from '../services/api';
import { useChatStore } from '../store/chat';
import { BuilderPanel } from '../components/BuilderPanel';

interface NotesPageProps {
  onNavigateChat?: (sessionKey: string) => void;
  initialDocId?: string;
}

// ── Markdown Formatting Toolbar ─────────────────────────────────────

function EditorToolbar({ onInsert }: { onInsert: (prefix: string, suffix: string, block?: boolean) => void }) {
  const { token } = theme.useToken();
  const [hovered, setHovered] = useState<string | null>(null);

  const btn = (key: string, icon: React.ReactNode, title: string, p: string, s: string, b?: boolean) => (
    <div
      key={key}
      onClick={() => onInsert(p, s, b)}
      onMouseEnter={() => setHovered(key)}
      onMouseLeave={() => setHovered(null)}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 30, height: 30, borderRadius: 6, cursor: 'pointer',
        background: hovered === key ? token.colorFillSecondary : 'transparent',
        color: token.colorTextSecondary, transition: 'all 0.15s',
      }}
    >
      {icon}
    </div>
  );

  return (
    <Flexbox
      horizontal
      align="center"
      gap={1}
      style={{
        padding: '4px 8px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        flexShrink: 0,
      }}
    >
      {btn('bold', <Bold size={15} />, 'Bold', '**', '**')}
      {btn('italic', <Italic size={15} />, 'Italic', '*', '*')}
      {btn('underline', <Underline size={15} />, 'Underline', '<u>', '</u>')}
      {btn('strike', <Strikethrough size={15} />, 'Strikethrough', '~~', '~~')}
      <Divider type="vertical" style={{ margin: '0 2px', height: 16 }} />
      {btn('ul', <List size={15} />, 'Bullet list', '- ', '', true)}
      {btn('ol', <ListOrdered size={15} />, 'Numbered list', '1. ', '', true)}
      {btn('task', <ListChecks size={15} />, 'Task list', '- [ ] ', '', true)}
      <Divider type="vertical" style={{ margin: '0 2px', height: 16 }} />
      {btn('quote', <Quote size={15} />, 'Blockquote', '> ', '', true)}
      {btn('code', <Code size={15} />, 'Inline code', '`', '`')}
      {btn('codeblock', <SquareCode size={15} />, 'Code block', '```\n', '\n```', true)}
    </Flexbox>
  );
}

// ── Note Summary Card ───────────────────────────────────────────────

function NoteCard({
  doc,
  onClick,
}: {
  doc: NotebookDocumentWithTopic;
  onClick: () => void;
}) {
  const { token } = theme.useToken();
  const [hovered, setHovered] = useState(false);

  const snippet = useMemo(() => {
    const text = doc.content.replace(/[#*`~>\-\[\]()]/g, '').trim();
    const lines = text.split('\n').filter(Boolean).slice(0, 6);
    return lines.join('\n').slice(0, 200);
  }, [doc.content]);

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        breakInside: 'avoid',
        marginBottom: 12,
        padding: '16px 18px',
        borderRadius: 12,
        border: `1px solid ${hovered ? token.colorBorderSecondary : token.colorBorderSecondary}`,
        background: hovered ? token.colorFillQuaternary : token.colorBgContainer,
        cursor: 'pointer',
        transition: 'all 0.2s',
        boxShadow: hovered ? `0 2px 8px ${token.colorFillSecondary}` : 'none',
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: token.colorText,
          marginBottom: 6,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {doc.title || 'Untitled'}
      </div>
      {snippet && (
        <div
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: token.colorTextSecondary,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 5,
            WebkitBoxOrient: 'vertical',
            marginBottom: 8,
            whiteSpace: 'pre-wrap',
          }}
        >
          {snippet}
        </div>
      )}
      <Flexbox horizontal align="center" gap={6}>
        <span style={{ fontSize: 11, color: token.colorTextDescription }}>{formatDate(doc.updated_at)}</span>
        {doc.topic_title && (
          <>
            <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>·</span>
            <span
              style={{
                fontSize: 10,
                color: token.colorTextQuaternary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 120,
              }}
            >
              {doc.topic_title}
            </span>
          </>
        )}
      </Flexbox>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function NotesPage({ onNavigateChat, initialDocId }: NotesPageProps) {
  const { token } = theme.useToken();

  // Document list state
  const [documents, setDocuments] = useState<NotebookDocumentWithTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [newDocTitle, setNewDocTitle] = useState('');

  // Editor state
  const [selectedDocId, setSelectedDocId] = useState<string | null>(initialDocId || null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [previewMode, setPreviewMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Copilot state (simplified — BuilderPanel handles chat internals)
  const [showCopilot, setShowCopilot] = useState(false);
  const [copilotAgentName, setCopilotAgentName] = useState('assistant');

  const {
    agents, loadAgents,
  } = useChatStore();

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const loadDocuments = useCallback(async () => {
    try {
      const docs = await api.listAllDocuments();
      setDocuments(docs);
    } catch {
      antMessage.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Hybrid search: client-side + backend
  const filteredDocs = useMemo(() => {
    if (!searchQuery) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.content.toLowerCase().includes(q) ||
        d.topic_title?.toLowerCase().includes(q),
    );
  }, [documents, searchQuery]);

  const [backendResults, setBackendResults] = useState<NotebookDocumentWithTopic[] | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (searchQuery.length < 2) {
      setBackendResults(null);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const resp = await api.search(searchQuery, 'documents', 20);
        if (resp.results) {
          const mapped: NotebookDocumentWithTopic[] = resp.results.map((r) => ({
            id: r.id,
            title: r.title,
            content: r.snippet || '',
            description: '',
            type: 'note',
            source: '',
            source_type: '',
            created_at: r.metadata?.updated_at || '',
            updated_at: r.metadata?.updated_at || '',
            topic_id: r.metadata?.topic_id || '',
            topic_title: r.metadata?.topic_title || '',
            agent_id: '',
          }));
          setBackendResults(mapped);
        }
      } catch {
        setBackendResults(null);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  const displayDocs = useMemo(() => {
    if (!backendResults) return filteredDocs;
    const ids = new Set(filteredDocs.map((d) => d.id));
    const merged = [...filteredDocs];
    for (const d of backendResults) {
      if (!ids.has(d.id)) {
        merged.push(d);
        ids.add(d.id);
      }
    }
    return merged;
  }, [filteredDocs, backendResults]);

  const recentDocs = useMemo(() => {
    return [...documents].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 12);
  }, [documents]);

  const selectedDoc = useMemo(() => documents.find((d) => d.id === selectedDocId) || null, [documents, selectedDocId]);

  const handleSelectDoc = useCallback(
    async (docId: string) => {
      if (dirty && selectedDocId) {
        await handleSave();
      }
      setSelectedDocId(docId);
      const doc = documents.find((d) => d.id === docId);
      if (doc) {
        setEditTitle(doc.title);
        setEditContent(doc.content);
        if (doc.agent_id && agents.find((a) => a.name === doc.agent_id)) {
          setCopilotAgentName(doc.agent_id);
        }
      } else {
        try {
          const full = await api.getDocument(docId);
          setEditTitle(full.title);
          setEditContent(full.content);
        } catch {
          antMessage.error('Failed to load document');
        }
      }
      setDirty(false);
      setPreviewMode(false);
    },
    [dirty, selectedDocId, documents, agents],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialDocId && documents.length > 0) {
      handleSelectDoc(initialDocId);
    }
  }, [initialDocId, documents.length]);

  const handleSave = useCallback(async () => {
    if (!selectedDocId) return;
    setSaving(true);
    try {
      await api.updateDocument(selectedDocId, editTitle, editContent);
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === selectedDocId ? { ...d, title: editTitle, content: editContent, updated_at: new Date().toISOString() } : d,
        ),
      );
      setDirty(false);
    } catch {
      antMessage.error('Failed to save');
    } finally {
      setSaving(false);
    }
  }, [selectedDocId, editTitle, editContent]);

  const handleBackToHome = useCallback(async () => {
    if (dirty && selectedDocId) {
      await handleSave();
    }
    setSelectedDocId(null);
    setEditTitle('');
    setEditContent('');
    setDirty(false);
    setShowCopilot(false);
    window.history.pushState(null, '', '#/notes');
  }, [dirty, selectedDocId, handleSave]);

  const handleAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setDirty(true);
    saveTimerRef.current = setTimeout(() => {
      handleSave();
    }, 2000);
  }, [handleSave]);

  const handleCreateDoc = useCallback(async () => {
    const title = newDocTitle.trim() || 'Untitled';
    try {
      const doc = await api.createDocument('_notes', title, '', 'note');
      const newDoc = { ...doc, topic_id: '_notes', topic_title: '', agent_id: '' } as NotebookDocumentWithTopic;
      setDocuments((prev) => [newDoc, ...prev]);
      setNewDocTitle('');
      setSelectedDocId(doc.id);
      setEditTitle(doc.title);
      setEditContent('');
      setDirty(false);
    } catch {
      antMessage.error('Failed to create document');
    }
  }, [newDocTitle]);

  const handleDeleteDoc = useCallback(
    async (docId: string) => {
      try {
        await api.deleteDocument(docId);
        setDocuments((prev) => prev.filter((d) => d.id !== docId));
        if (selectedDocId === docId) {
          setSelectedDocId(null);
          setEditTitle('');
          setEditContent('');
        }
      } catch {
        antMessage.error('Failed to delete');
      }
    },
    [selectedDocId],
  );

  const handleFormatInsert = useCallback(
    (prefix: string, suffix: string, block?: boolean) => {
      const el = editorRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const selected = editContent.substring(start, end);
      const replacement = block && !selected ? prefix : prefix + selected + suffix;
      const newValue = editContent.substring(0, start) + replacement + editContent.substring(end);
      setEditContent(newValue);
      setDirty(true);
      handleAutoSave();
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + prefix.length + selected.length, start + prefix.length + selected.length);
      });
    },
    [editContent, handleAutoSave],
  );

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const copilotContextPayload = useMemo(() => {
    if (!selectedDocId) return {};
    const docContext = `<document id="${selectedDocId}" title="${editTitle}">\n${editContent}\n</document>\n\nYou are a Note Copilot. You have two tools:\n- notebook_read: Read the latest content of the note (use document_id="${selectedDocId}")\n- notebook_update: Write content to the note (use document_id="${selectedDocId}"). Supports modes: "replace" (overwrite), "append" (add to end), "prepend" (add to start).\n\nWhen the user asks you to write, fill, edit, translate, or add content, use notebook_update. When summarizing or analyzing, read from the document context above. Always respond with your analysis/summary in the chat AND use the tool to write to the note when requested.`;
    return { document_context: docContext };
  }, [selectedDocId, editTitle, editContent]);

  const handleDocumentUpdated = useCallback(async (_docId: string) => {
    if (!selectedDocId) return;
    try {
      const updatedDoc = await api.getDocument(selectedDocId);
      setEditContent(updatedDoc.content);
      setEditTitle(updatedDoc.title);
      setDirty(false);
      requestAnimationFrame(() => {
        const el = editorRef.current;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    } catch {
      /* ignore */
    }
  }, [selectedDocId]);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Flexbox horizontal style={{ height: '100%', overflow: 'hidden' }}>
      {/* Left: Note List Sidebar */}
      <Flexbox
        style={{
          width: 260,
          minWidth: 220,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgLayout,
          height: '100%',
        }}
      >
        {/* Header + toolbar */}
        <Flexbox horizontal align="center" justify="space-between" style={{ padding: '16px 16px 8px', flexShrink: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: token.colorText }}>Notes</span>
          <ActionIcon icon={Plus} size="small" title="New Note" onClick={handleCreateDoc} />
        </Flexbox>

        {/* Search */}
        <div style={{ padding: '0 12px 8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 8px',
              borderRadius: 6,
              background: token.colorFillQuaternary,
            }}
          >
            <Search size={13} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              style={{
                border: 'none',
                outline: 'none',
                flex: 1,
                fontSize: 12,
                background: 'transparent',
                color: token.colorText,
              }}
            />
            {searchQuery && (
              <X size={12} style={{ cursor: 'pointer', color: token.colorTextQuaternary }} onClick={() => setSearchQuery('')} />
            )}
          </div>
        </div>

        {/* New note input */}
        <div style={{ padding: '0 12px 8px' }}>
          <Input
            size="small"
            value={newDocTitle}
            onChange={(e) => setNewDocTitle(e.target.value)}
            onPressEnter={handleCreateDoc}
            placeholder="New note title..."
            suffix={
              <Plus size={14} style={{ cursor: 'pointer', color: token.colorTextSecondary }} onClick={handleCreateDoc} />
            }
          />
        </div>

        {/* Note list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 8px' }}>
          {loading ? (
            <Center style={{ padding: 32 }}>
              <Spin />
            </Center>
          ) : displayDocs.length === 0 ? (
            <Empty
              description={searchQuery ? 'No matching notes' : 'No notes yet'}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ padding: 24 }}
            />
          ) : (
            displayDocs.map((doc) => (
              <div
                key={doc.id}
                onClick={() => handleSelectDoc(doc.id)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: selectedDocId === doc.id ? token.colorPrimaryBg : 'transparent',
                  transition: 'background 0.15s',
                  marginBottom: 2,
                }}
                onMouseEnter={(e) => {
                  if (selectedDocId !== doc.id) (e.currentTarget as HTMLElement).style.background = token.colorFillTertiary;
                }}
                onMouseLeave={(e) => {
                  if (selectedDocId !== doc.id) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <Flexbox horizontal align="center" gap={8}>
                  <FileText size={16} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: token.colorText,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {doc.title || 'Untitled'}
                    </div>
                    <Flexbox horizontal align="center" gap={4}>
                      <span style={{ fontSize: 11, color: token.colorTextDescription }}>{formatDate(doc.updated_at)}</span>
                      {doc.topic_title && (
                        <span style={{ fontSize: 10, color: token.colorTextQuaternary }}>· {doc.topic_title}</span>
                      )}
                    </Flexbox>
                  </Flexbox>
                  <Popconfirm
                    title="Delete this note?"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      handleDeleteDoc(doc.id);
                    }}
                    okText="Delete"
                    cancelText="Cancel"
                  >
                    <Trash2
                      size={14}
                      style={{ color: token.colorTextQuaternary, cursor: 'pointer', flexShrink: 0, opacity: 0.5 }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Popconfirm>
                </Flexbox>
              </div>
            ))
          )}
        </div>
      </Flexbox>

      {/* Center area */}
      <Flexbox flex={1} style={{ height: '100%', overflow: 'hidden' }}>
        {!selectedDocId ? (
          /* ── Home view: Recent cards + reserved area ── */
          <Flexbox style={{ height: '100%' }}>
            {/* Top 80%: Recent Note cards (masonry) */}
            <div style={{ flex: 4, overflow: 'auto', padding: '24px 32px 0' }}>
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: token.colorText }}>Recent Notes</span>
              </div>
              {loading ? (
                <Center style={{ padding: 40 }}>
                  <Spin />
                </Center>
              ) : recentDocs.length === 0 ? (
                <Center style={{ padding: 60 }}>
                  <Flexbox align="center" gap={12}>
                    <FileText size={40} style={{ color: token.colorTextQuaternary, opacity: 0.4 }} />
                    <span style={{ fontSize: 13, color: token.colorTextDescription }}>
                      No notes yet. Create one from the sidebar or save from a chat.
                    </span>
                  </Flexbox>
                </Center>
              ) : (
                <div
                  style={{
                    columnCount: 3,
                    columnGap: 16,
                    maxWidth: 960,
                  }}
                >
                  {recentDocs.map((doc) => (
                    <NoteCard key={doc.id} doc={doc} onClick={() => handleSelectDoc(doc.id)} />
                  ))}
                </div>
              )}
            </div>

            {/* Bottom 20%: Reserved extension area */}
            <Flexbox
              align="center"
              justify="center"
              style={{
                flex: 1,
                borderTop: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgLayout,
              }}
            >
              <span style={{ fontSize: 13, color: token.colorTextQuaternary, opacity: 0.5 }}>
                Extension area — coming soon
              </span>
            </Flexbox>
          </Flexbox>
        ) : (
          /* ── Editor view ── */
          <Flexbox style={{ height: '100%' }}>
            {/* Editor toolbar */}
            <Flexbox
              horizontal
              align="center"
              justify="space-between"
              style={{
                padding: '8px 16px',
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                flexShrink: 0,
                height: 48,
                minHeight: 48,
              }}
            >
              <Flexbox horizontal align="center" gap={6} style={{ height: '100%' }}>
                <ActionIcon
                  icon={ArrowLeft}
                  size={{ blockSize: 32, size: 16 }}
                  title="Back to Notes"
                  onClick={handleBackToHome}
                />
                <Divider type="vertical" style={{ margin: '0 2px', height: 18 }} />
                <ActionIcon
                  icon={previewMode ? Edit : Eye}
                  size={{ blockSize: 32, size: 16 }}
                  title={previewMode ? 'Edit' : 'Preview'}
                  onClick={() => setPreviewMode(!previewMode)}
                />
                <ActionIcon
                  icon={Save}
                  size={{ blockSize: 32, size: 16 }}
                  title="Save"
                  loading={saving}
                  onClick={handleSave}
                />
                {dirty && <span style={{ fontSize: 11, color: token.colorWarning, marginLeft: 2 }}>Unsaved</span>}
              </Flexbox>
              <Flexbox horizontal align="center" gap={4} style={{ height: '100%' }}>
                {selectedDoc?.topic_id && selectedDoc.topic_id !== '_notes' && selectedDoc.topic_id !== '_pages' && (
                  <ActionIcon
                    icon={MessageSquare}
                    size={{ blockSize: 32, size: 16 }}
                    title="Open linked chat"
                    onClick={() => onNavigateChat?.(selectedDoc.topic_id)}
                  />
                )}
                <ActionIcon
                  icon={showCopilot ? PanelRightClose : PanelRightOpen}
                  size={{ blockSize: 32, size: 16 }}
                  title={showCopilot ? 'Close Copilot' : 'Open Copilot'}
                  onClick={() => setShowCopilot(!showCopilot)}
                />
              </Flexbox>
            </Flexbox>

            {/* Title */}
            <div style={{ padding: '16px 24px 0' }}>
              <input
                value={editTitle}
                onChange={(e) => {
                  setEditTitle(e.target.value);
                  handleAutoSave();
                }}
                placeholder="Untitled"
                style={{
                  width: '100%',
                  border: 'none',
                  outline: 'none',
                  fontSize: 24,
                  fontWeight: 700,
                  background: 'transparent',
                  color: token.colorText,
                  padding: 0,
                }}
              />
            </div>

            {/* Content area */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {previewMode ? (
                <div style={{ flex: 1, overflow: 'auto', padding: '12px 24px 24px' }}>
                  <Markdown fontSize={14}>{editContent || '*No content yet*'}</Markdown>
                </div>
              ) : (
                <>
                  <EditorToolbar onInsert={handleFormatInsert} />
                  <textarea
                    ref={editorRef}
                    value={editContent}
                    onChange={(e) => {
                      setEditContent(e.target.value);
                      handleAutoSave();
                    }}
                    placeholder="Start writing in Markdown..."
                    style={{
                      flex: 1,
                      width: '100%',
                      resize: 'none',
                      border: 'none',
                      outline: 'none',
                      fontSize: 14,
                      lineHeight: 1.8,
                      background: 'transparent',
                      color: token.colorText,
                      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
                      padding: '12px 24px 24px',
                      overflow: 'auto',
                    }}
                  />
                </>
              )}
            </div>
          </Flexbox>
        )}
      </Flexbox>

      {/* Right: AI Copilot — using reusable BuilderPanel */}
      {selectedDocId && (
        <BuilderPanel
          agentName={copilotAgentName}
          scope="note_copilot"
          welcomeTitle="Note Copilot"
          welcomeDescription="Ask the AI about your note. It can help you write, edit, or understand the content."
          welcomeAvatar="🤖"
          suggestQuestions={[
            'Summarize this note',
            'Improve the writing style',
            'Translate to English',
          ]}
          contextPayload={copilotContextPayload}
          expand={showCopilot}
          onExpandChange={setShowCopilot}
          defaultWidth={420}
          minWidth={340}
          maxWidth={560}
          showAgentSelector
          onDocumentUpdated={handleDocumentUpdated}
        />
      )}
    </Flexbox>
  );
}

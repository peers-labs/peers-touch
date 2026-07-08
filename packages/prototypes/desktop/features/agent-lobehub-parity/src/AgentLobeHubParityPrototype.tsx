import {
  AlertTriangle,
  Bot,
  Boxes,
  BrainCircuit,
  Bubbles,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  Copy,
  Database,
  FileText,
  FileQuestion,
  FolderOpen,
  HeartPulse,
  Home,
  Image,
  Library,
  Lightbulb,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelRightClose,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  Signature,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
  Wand2,
} from 'lucide-react';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';

type Surface =
  | 'home'
  | 'chat'
  | 'profile'
  | 'tasks'
  | 'pages'
  | 'resources'
  | 'memory'
  | 'skills'
  | 'settings'
  | 'image'
  | 'community';
type WorkingTab = 'resources' | 'review' | 'files' | 'params';

function reviewParam(name: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name) ?? '';
}

function initialSurface(): Surface {
  const value = reviewParam('surface');
  const surfaces: Surface[] = ['home', 'chat', 'profile', 'tasks', 'pages', 'resources', 'memory', 'skills', 'settings', 'image', 'community'];
  return surfaces.includes(value as Surface) ? (value as Surface) : 'home';
}

function initialWorkingTab(): WorkingTab {
  const value = reviewParam('working');
  const tabs: WorkingTab[] = ['resources', 'review', 'files', 'params'];
  return tabs.includes(value as WorkingTab) ? (value as WorkingTab) : 'resources';
}

function initialTheme(): 'dark' | 'light' {
  return reviewParam('theme') === 'dark' ? 'dark' : 'light';
}

function isReviewMode(): boolean {
  return reviewParam('review') === '1';
}

const sourceRefs = {
  home:
    'home/_layout/index.tsx + home/features/{AgentSelect,WelcomeText,InputArea,Recents,FeaturedPlugins} -> HomeFreeCreditBadge + ChatInput + StarterList + sidebar blocks',
  chat:
    'agent/features/Conversation/ConversationArea.tsx + Conversation/ChatList/{VirtualizedList,AutoScroll,BackBottom} + Conversation/Messages/* + ChatMiniMap/* -> message virtualization, role-specific messages, context menu, minimap, runtime recovery and WorkingSidebar',
  profile:
    'agent/profile/index.tsx -> Header + ProfileEditor + AgentSettings modal/content',
  tasks:
    'AgentTasksPage + TaskWorkspaceLayout + TaskList + TaskDetailPage + AgentTaskManager -> nav/header/list/board/detail/right task agent',
  pages: 'page/_layout/index.tsx + page/[id]/index.tsx -> list/editor/version/export/delete reconciliation',
  resources:
    'ResourceManager/index.tsx + Explorer/Header/SearchResultsOverlay/ListView/ItemDropdown + LibraryHierarchy + ChunkDrawer + UploadDock -> drag upload, search overlay, library tree, action menu, list/detail drawer, chunk drawer',
  memory:
    'memory/_layout + memory/(home) + memory/preferences + memory/features/{MemoryAnalysis,FilterBar,TimeLineView,GridView,DetailPanel,EditableModal,Loading,DetailNotFound} -> nav/header/filter/timeline/grid/right-panel/edit/loading/error',
  skills:
    'settings/skill/index.tsx + settings/skill/features/{LeftPanel,SkillList,SkillDetail,*SkillItem,Actions,EditCustomPlugin} + SkillStore/{SkillStoreContent,SkillList,SkillDetail} + PluginDevModal/MCPManifestForm -> connector list/detail, add menu, import URL/GitHub/ZIP, store tabs/detail/schema, OAuth wait, custom MCP quick import/test error',
  settings: 'settings/_layout + provider/features/* -> profile/provider/storage/advanced/service-model',
  image: '(create)/image/index.tsx + settings/image -> generation config/result/download/copy failure',
  community:
    'community/_layout + community/(list) + community/(detail) -> marketplace categories/search/sort/detail/install method',
};

const modelOptions = [
  { provider: 'OpenAI', model: 'gpt-4.1', label: 'OpenAI / gpt-4.1' },
  { provider: 'DeepSeek', model: 'deepseek-chat', label: 'DeepSeek / deepseek-chat' },
  { provider: 'TRAE CLI', model: 'trae-agent-v1', label: 'TRAE CLI / trae-agent-v1' },
];

const topics = [
  { id: 'inbox', title: 'Greetings', group: 'Today', active: true },
  { id: 'audit', title: 'Home 新会话测试', group: 'Today' },
  { id: 'papers', title: 'ArXiv daily picks', group: 'Scheduled' },
  { id: 'untitled', title: 'Untitled', group: 'Backlog' },
];

const navItems = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'tasks', label: 'Tasks', icon: CheckCircle2 },
  { key: 'pages', label: 'Pages', icon: FileText },
  { key: 'recents', label: 'Recents', icon: Clock3 },
  { key: 'agents', label: 'Agents', icon: Bot },
  { key: 'community', label: 'Community', icon: Sparkles },
  { key: 'resources', label: 'Resources', icon: Library },
  { key: 'memory', label: 'Memory', icon: Boxes },
  { key: 'image', label: 'Image', icon: Image },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'skills', label: 'Skills', icon: Sparkles },
];

function EvidenceChip({ children }: { children: string }) {
  if (!isReviewMode()) return null;
  return <span className="pt-agent-chip">{children}</span>;
}

function OwnerPill({ owner }: { owner: string }) {
  if (!isReviewMode()) return null;
  return <span className={`pt-owner-pill owner-${owner}`}>{owner}</span>;
}

function IconButton({
  buttonRef,
  children,
  label,
  onClick,
}: {
  buttonRef?: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button ref={buttonRef} aria-label={label} className="pt-icon-button" type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function Sidebar({ surface, setSurface }: { surface: Surface; setSurface: (surface: Surface) => void }) {
  const surfaceByNav: Record<string, Surface> = {
    agents: 'chat',
    community: 'community',
    home: 'home',
    image: 'image',
    memory: 'memory',
    pages: 'pages',
    recents: 'chat',
    resources: 'resources',
    settings: 'settings',
    skills: 'skills',
    tasks: 'tasks',
  };

  return (
    <aside className="pt-left-rail">
      <div className="pt-account-block">
        <div className="pt-avatar">S</div>
        <div>
          <div className="pt-account-name">Shu xian</div>
          <div className="pt-account-meta">Workspace</div>
        </div>
      </div>

      <button className="pt-search-row" type="button">
        <Search size={15} />
        <span>Search</span>
        <kbd>⌘ K</kbd>
      </button>

      <nav className="pt-nav-stack" aria-label="LobeHub surface map">
        {navItems.map((item) => {
          const Icon = item.icon;
          const target = surfaceByNav[item.key] ?? 'home';
          const active = target === surface || (item.key === 'agents' && surface === 'profile');
          return (
            <button
              key={item.key}
              className={`pt-nav-item ${active ? 'is-active' : ''}`}
              title={item.label}
              type="button"
              onClick={() => setSurface(target)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="pt-upgrade-card">
        <div className="pt-upgrade-title">Pro</div>
        <p>More models and storage.</p>
      </div>
    </aside>
  );
}

function HomeSurface({
  onSend,
  setSurface,
}: {
  onSend: (prompt: string) => void;
  setSurface: (surface: Surface) => void;
}) {
  const initialState = reviewParam('state');
  const isDeepHomeReview = initialState === 'deep-home';
  const isCompactHomeReview = initialState === '' || initialState === 'compact-home';
  const [modelKey, setModelKey] = useState(modelOptions[0].label);
  const [agentMenuOpen, setAgentMenuOpen] = useState(isDeepHomeReview || initialState === 'agent-open');
  const [contextMenuOpen, setContextMenuOpen] = useState(isDeepHomeReview || initialState === 'context-open');
  const [dragActive, setDragActive] = useState(initialState === 'drag-upload');
  const [toolMenuOpen, setToolMenuOpen] = useState(isDeepHomeReview || initialState === 'tools-open');
  const [modelMenuOpen, setModelMenuOpen] = useState(isDeepHomeReview || initialState === 'model-open');
  const [historyOpen, setHistoryOpen] = useState(isDeepHomeReview || initialState === 'history-open');
  const [expandedInput, setExpandedInput] = useState(isDeepHomeReview || initialState === 'expanded-input');
  const [prompt, setPrompt] = useState(isDeepHomeReview ? '@Resource plan the release notes with /web search and #Sprint review.' : '');
  const [homeTab, setHomeTab] = useState<'recents' | 'plugins'>(isDeepHomeReview ? 'plugins' : 'recents');
  const connectorApps = [
    { label: 'Gmail', state: 'Connected' },
    { label: 'Google Drive', state: 'Connect' },
    { label: 'Calendar', state: 'Connected' },
    { label: 'Slack', state: 'Connect' },
    { label: 'Notion', state: 'Connected' },
  ];
  const recommendationCards = [
    ['Morning ritual', 'Every day at 7: weather, today’s schedule, and a movement nudge.', 'Daily · 07:00', 'Calendar required'],
    ['Industry research weekly', 'Every Monday, market dynamics, funding, new players and regulatory shifts.', 'Mon · 09:30', 'Web + Drive'],
    ['Sunday reflection', 'Walk through 5 questions: best moment, frustrations, top 3 for next week.', 'Sun · 20:00', 'No connector'],
  ];
  const recommendedModels = ['Claude Fable 5', 'Claude Sonnet 5', 'Nano Banana 2 Lite', 'Seedance 2.0'];
  const addContextButtonRef = useRef<HTMLButtonElement>(null);
  const firstContextItemRef = useRef<HTMLButtonElement>(null);
  const selectedModel = modelOptions.find((option) => option.label === modelKey) ?? modelOptions[0];
  const reviewMode = isReviewMode();
  const sendPrompt = () => {
    const value = prompt.trim();
    if (!value) return;
    onSend(value);
  };
  const closeContextMenu = () => {
    setContextMenuOpen(false);
    addContextButtonRef.current?.focus();
  };

  useEffect(() => {
    if (!contextMenuOpen) return;
    firstContextItemRef.current?.focus();
  }, [contextMenuOpen]);

  return (
    <section
      className={`pt-home-shell ${isDeepHomeReview ? 'is-deep-home' : ''} ${isCompactHomeReview ? 'is-compact-home' : ''}`}
      aria-label="LobeHub Home parity baseline"
    >
      {reviewMode && (
        <div className="pt-source-bar">
          <EvidenceChip>LIVE-001..LIVE-100</EvidenceChip>
          <EvidenceChip>{sourceRefs.home}</EvidenceChip>
          <OwnerPill owner="agent-consumer" />
        </div>
      )}

      <div className="pt-home-center">
        {!isDeepHomeReview && !isCompactHomeReview && <div className="pt-credit-badge">Free credits available · 2,000 tokens today</div>}
        {isCompactHomeReview && (
          <div className="pt-home-connector-strip" aria-label="Home app connector strip">
            <span>Connect your favorite apps to Lobe AI</span>
            <div>
              {connectorApps.map((app) => (
                <button
                  key={app.label}
                  className={app.state === 'Connected' ? 'is-connected' : 'needs-auth'}
                  type="button"
                  aria-label={`${app.label} connector ${app.state}`}
                >
                  {app.label.slice(0, 1)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="pt-agent-select-row">
          <button className="pt-agent-select" type="button" onClick={() => setAgentMenuOpen((open) => !open)}>
            <span className="pt-agent-avatar">🤖</span>
            <span><strong>Lobe AI</strong><small>Personal assistant</small></span>
            <ChevronDown size={16} />
          </button>
          {agentMenuOpen && (
            <div className="pt-floating-menu pt-agent-menu">
              <div className="pt-menu-section-title">Switch agent</div>
              {isDeepHomeReview && (
                <div className="pt-agent-loading-row" aria-label="Agent select async state">
                  <Loader2 size={14} />
                  <span>Refreshing agent list</span>
                  <button type="button">Retry</button>
                </div>
              )}
              {['Lobe AI', 'Research Agent', 'Workspace Agent', 'Inbox Assistant'].map((agent, index) => (
                <button key={agent} className={isDeepHomeReview && index === 0 ? 'is-selected' : ''} type="button" onClick={() => setSurface(agent === 'Lobe AI' ? 'profile' : 'chat')}>
                  <Bot size={15} /> {agent}
                </button>
              ))}
              <button type="button"><Plus size={15} /> Create agent</button>
            </div>
          )}
          <div>
            <h1>{isCompactHomeReview ? 'Back to high-efficiency mode!' : 'What shall we work on today?'}</h1>
            <p>{isCompactHomeReview ? 'Ask, create, or start a task. @ to assign tasks to other agents.' : 'Ask Lobe AI, reference workspace context, or start from a recent thread.'}</p>
            {isDeepHomeReview && (
              <div className="pt-home-daily-hint" aria-label="Home daily typewriter hint">
                <span>Daily brief</span>
                <strong>Review release risks, then draft the next task list.</strong>
                <button type="button">Use hint</button>
                <button type="button">Open link</button>
              </div>
            )}
          </div>
        </div>

        <div
          className={`pt-composer-card ${dragActive ? 'is-dragging' : ''} ${expandedInput ? 'is-expanded-input' : ''}`}
          onDragEnter={() => setDragActive(true)}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDragOver={(event) => event.preventDefault()}
        >
          {isDeepHomeReview && (
            <div className="pt-home-input-notice" aria-label="Home input notice">
              <AlertTriangle size={15} />
              <span>Cloud workspace is paused. Send stays available on local runtime.</span>
              <button type="button">Switch to local</button>
            </div>
          )}
          {!isCompactHomeReview && (
            <div className="pt-home-banner">
            <Sparkles size={15} />
            <span>Install skills or drop files here to enrich this conversation.</span>
            <button type="button" onClick={() => setSurface('skills')}>Browse skills</button>
            {isDeepHomeReview && <button type="button" aria-label="Dismiss Home banner">Dismiss</button>}
            </div>
          )}
          {isDeepHomeReview && (
            <div className="pt-home-context-strip" aria-label="Home context selections">
              {[
                ['Resource', 'agent-parity-spec.md'],
                ['Topic', 'Sprint review'],
                ['Skill', 'web search'],
              ].map(([kind, title]) => (
                <button key={title} type="button">
                  <FileText size={14} />
                  <span><strong>{title}</strong><small>{kind} attached</small></span>
                  <MoreHorizontal size={13} />
                </button>
              ))}
            </div>
          )}
          {isDeepHomeReview && (
            <div className="pt-home-file-preview" aria-label="Home file preview">
              {['diagram.png · queued', 'notes.md · indexed'].map((file, index) => (
                <button key={file} className={index === 0 ? 'is-uploading' : ''} type="button">
                  <UploadCloud size={14} />
                  <span>{file}</span>
                  {index === 0 ? <Loader2 size={13} /> : <CheckCircle2 size={13} />}
                </button>
              ))}
            </div>
          )}
          {isDeepHomeReview && (
            <div className="pt-home-typo-bar" aria-label="Home typo bar">
              {['Bold', 'Italic', 'List', 'Quote', 'Code', 'Math'].map((item, index) => (
                <button key={item} className={index === 0 ? 'is-active' : ''} type="button">{item}</button>
              ))}
            </div>
          )}
          <textarea
            aria-label="Home prompt"
            placeholder={isCompactHomeReview ? 'Ask, create, or start a task. @ to assign tasks to other agents...' : 'Message Lobe AI, use @ to mention files or / to call skills...'}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey) return;
              event.preventDefault();
              sendPrompt();
            }}
          />
          {contextMenuOpen && (
            <div
              className="pt-floating-menu pt-context-menu"
              role="menu"
              aria-label="Home add context menu"
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                closeContextMenu();
              }}
            >
              <div className="pt-menu-section-title">Add context</div>
              <button ref={firstContextItemRef} type="button"><FileText size={15} /> Upload file or image</button>
              <button type="button"><Library size={15} /> Files and libraries</button>
              <button type="button"><Sparkles size={15} /> Skills</button>
              <button type="button"><MessageSquare size={15} /> Refer topic</button>
            </div>
          )}
          {toolMenuOpen && (
            <div className="pt-floating-menu pt-home-tool-menu" role="dialog" aria-label="Home tools popover">
              <div className="pt-menu-section-title">Tools</div>
              {[
                ['Pinned', 'Web search', 'Ready'],
                ['Auto', 'Knowledge lookup', 'Enabled'],
                ['Needs auth', 'Figma MCP', 'Reconnect'],
              ].map(([group, title, state]) => (
                <button key={title} type="button">
                  <Wand2 size={15} />
                  <span><strong>{title}</strong><small>{group} · {state}</small></span>
                </button>
              ))}
              <button type="button" onClick={() => setSurface('skills')}><Plus size={15} /> Open Skill Store</button>
            </div>
          )}
          {modelMenuOpen && (
            <div className="pt-floating-menu pt-home-model-menu" role="dialog" aria-label="Home model switch panel">
              <div className="pt-menu-section-title">Model switch</div>
              {modelOptions.map((option) => (
                <button key={`${option.provider}:${option.model}`} className={option.label === modelKey ? 'is-selected' : ''} type="button" onClick={() => setModelKey(option.label)}>
                  <Bot size={15} />
                  <span><strong>{option.label}</strong><small>{option.provider} · Settings Provider projection</small></span>
                </button>
              ))}
            </div>
          )}
          {historyOpen && (
            <div className="pt-floating-menu pt-home-history-menu" role="listbox" aria-label="Home input history popup">
              <div className="pt-menu-section-title">Prompt history</div>
              {[
                '@Design summarize the visual delta',
                '/search compare LobeHub Home input controls',
                '#Sprint review produce next actions',
              ].map((entry, index) => (
                <button key={entry} className={index === 0 ? 'is-selected' : ''} type="button">{entry}</button>
              ))}
            </div>
          )}
          {dragActive && (
            <div className="pt-drag-overlay">
              <FileText size={18} />
              <strong>Drop files to add context</strong>
              <span>Home keeps uploads visible while Station keeps durable resource binding.</span>
            </div>
          )}
          <div className="pt-composer-footer">
            <div className="pt-action-row">
              <IconButton label="Agent mode"><Bot size={17} /></IconButton>
              <IconButton buttonRef={addContextButtonRef} label="Add context" onClick={() => setContextMenuOpen((open) => !open)}><Plus size={17} /></IconButton>
              <IconButton label="Prompt history" onClick={() => setHistoryOpen((open) => !open)}><Clock3 size={17} /></IconButton>
              {isDeepHomeReview && (
                <>
                  <IconButton label="Tools" onClick={() => setToolMenuOpen((open) => !open)}><Wand2 size={17} /></IconButton>
                  <IconButton label="Search"><Search size={17} /></IconButton>
                  <IconButton label="Memory"><BrainCircuit size={17} /></IconButton>
                </>
              )}
            </div>
            <div className="pt-action-row">
              <label className="pt-model-label">
                <span>{selectedModel.provider}</span>
                <select value={modelKey} onChange={(event) => setModelKey(event.target.value)} onClick={() => setModelMenuOpen((open) => !open)}>
                  {modelOptions.map((option) => (
                    <option key={`${option.provider}:${option.model}`} value={option.label}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {isDeepHomeReview && <button className="pt-expand-input" type="button" onClick={() => setExpandedInput((open) => !open)}>Expand</button>}
              <button className="pt-send-button" type="button" onClick={sendPrompt}>
                Send
              </button>
            </div>
          </div>
        </div>

        {isCompactHomeReview && (
          <div className="pt-home-model-chips" aria-label="Home recommended model chips">
            {recommendedModels.map((model, index) => (
              <button key={model} type="button" onClick={() => setModelKey(modelOptions[index % modelOptions.length].label)}>
                <Bot size={14} />
                <span>{model}</span>
              </button>
            ))}
          </div>
        )}

        {!isCompactHomeReview && (
          <div className="pt-starter-grid">
          {['Create a task', 'Summarize memory', 'Analyze a resource', 'Call a skill'].map((item, index) => (
            <button key={item} className={isDeepHomeReview && index === 0 ? 'has-new-tag' : ''} type="button" onClick={() => setSurface(index === 2 ? 'resources' : 'chat')}>
              <Sparkles size={15} />
              <span>{item}</span>
              {isDeepHomeReview && index === 0 && <small>New</small>}
              {isDeepHomeReview && index === 3 && <small>Permission pending</small>}
            </button>
          ))}
          </div>
        )}
        {isDeepHomeReview && (
          <div className="pt-home-starter-skeletons" aria-label="Home starter loading skeletons">
            {[0, 1, 2, 3].map((item) => <span key={item} />)}
          </div>
        )}

        {isCompactHomeReview && (
          <section className="pt-home-dashboard-cards" aria-label="Home compact dashboard cards">
            <article className="pt-home-brief-card">
              <div className="pt-home-card-header">
                <span><FileText size={15} /> Brief</span>
                <button type="button" onClick={() => setSurface('tasks')}>View all tasks</button>
              </div>
              <div className="pt-home-task-card">
                <span className="pt-task-state-dot"><CheckCircle2 size={14} /></span>
                <div>
                  <strong>Awaiting Your ArXiv Research Area</strong>
                  <small>a day ago</small>
                  <div className="pt-home-brief-divider" />
                  <p>No paper selection was performed because the research area is still undefined. Add a field to generate the daily digest accurately.</p>
                  <div className="pt-home-brief-artifacts" aria-label="Brief artifacts">
                    <span><FileText size={13} /> Daily paper queue</span>
                    <span><MessageSquare size={13} /> Run thread</span>
                  </div>
                </div>
                <div className="pt-home-brief-actions">
                  <button type="button">View run</button>
                  <button className="primary" type="button">Confirm</button>
                </div>
              </div>
            </article>
            <article className="pt-home-recommend-card">
              <div className="pt-home-card-header">
                <span><Sparkles size={15} /> Some recommendations for your setup</span>
                <button type="button">Refresh</button>
              </div>
              {recommendationCards.map(([title, body, schedule, auth]) => (
                <button key={title} type="button" onClick={() => setSurface('tasks')}>
                  <span>
                    <strong>{title}</strong>
                    <small>{body}</small>
                    <span className="pt-home-recommend-meta"><Clock3 size={13} /> {schedule}<em>{auth}</em></span>
                  </span>
                  <b>Add task</b>
                </button>
              ))}
            </article>
          </section>
        )}

        <section className={`pt-home-blocks ${isCompactHomeReview ? 'is-compact-sidebar' : ''}`} aria-label="Home sidebar blocks">
          <div className="pt-home-block-header">
            <div className="pt-segmented" role="tablist" aria-label="Home blocks">
              <button className={homeTab === 'recents' ? 'is-active' : ''} type="button" onClick={() => setHomeTab('recents')}>Recents</button>
              <button className={homeTab === 'plugins' ? 'is-active' : ''} type="button" onClick={() => setHomeTab('plugins')}>Featured plugins</button>
            </div>
            <button className="pt-quiet-action" type="button">Customize sidebar</button>
          </div>
          {isDeepHomeReview && (
            <div className="pt-home-recents-toolbar" aria-label="Home recents accordion">
              <button type="button">Recent pages · Display 10</button>
              <button type="button">Move section</button>
              <button type="button">Hide</button>
              <button type="button">All recents</button>
              <button type="button">Retry</button>
            </div>
          )}
          {homeTab === 'recents' ? (
            <div className="pt-home-recents">
              {topics.map((topic) => (
                <button key={topic.id} type="button" onClick={() => setSurface('chat')}>
                  <MessageSquare size={15} />
                  <span><strong>{topic.title}</strong><small>{topic.group} · conversation</small></span>
                  <MoreHorizontal size={14} />
                </button>
              ))}
            </div>
          ) : (
            <div className="pt-home-plugins">
              {['Web search', 'Figma MCP', 'Notion sync', 'Code runner'].map((plugin) => (
                <button key={plugin} type="button" onClick={() => setSurface('skills')}>
                  <Sparkles size={15} />
                  <span><strong>{plugin}</strong><small>Featured workspace capability</small></span>
                </button>
              ))}
            </div>
          )}
          {isDeepHomeReview && (
            <>
              <div className="pt-home-recents-menu" role="menu" aria-label="Home recent item menu">
                {['Rename', 'Transfer to topic', 'Delete'].map((item) => (
                  <button key={item} className={item === 'Delete' ? 'danger' : ''} type="button">{item}</button>
                ))}
              </div>
              <div className="pt-home-inline-rename" aria-label="Home recent inline rename">
                <input defaultValue="Agent parity review" />
                <button type="button">Save</button>
              </div>
              <aside className="pt-home-all-recents-drawer" aria-label="Home all recents drawer">
                <div className="pt-home-block-header">
                  <strong>All recents</strong>
                  <button type="button">Close</button>
                </div>
                {['Agent parity review', 'Provider model recovery', 'Resource upload plan'].map((item) => (
                  <button key={item} type="button">
                    <MessageSquare size={14} />
                    <span>{item}</span>
                    <small>Prefetched</small>
                  </button>
                ))}
              </aside>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function AgentTopicRail({ compact = false }: { compact?: boolean }) {
  const [collapsedGroup, setCollapsedGroup] = useState('');

  if (compact) {
    return (
      <aside className="pt-topic-rail is-compact-chat is-lobehub-like" aria-label="LobeHub-like Agent chat rail">
        <div className="pt-chat-icon-rail" aria-label="Agent app navigation">
          {[
            ['New topic', Plus],
            ['Search', Search],
            ['Tasks', CalendarClock],
            ['Topics', MessageSquare],
            ['Channels', Bubbles],
          ].map(([label, Icon]) => (
            <button key={label as string} type="button" aria-label={label as string}>
              <Icon size={16} />
            </button>
          ))}
        </div>

        <div className="pt-chat-topic-column">
          <div className="pt-agent-popover" aria-label="Agent switcher popover">
            <button className="pt-agent-switcher is-open" type="button">
              <span className="pt-agent-avatar">🤖</span>
              <span><strong>Lobe AI</strong><small>Active agent</small></span>
              <ChevronDown size={14} />
            </button>
            <div className="pt-agent-option-list">
              {[
                ['🤖', 'Lobe AI', 'selected'],
                ['🤖', 'Untitled Agent', 'workspace'],
                ['😄', 'Untitled Agent', 'draft'],
                ['+', 'Create Agent', 'base-settings'],
              ].map(([avatar, name, meta]) => (
                <button key={`${avatar}-${name}-${meta}`} className={meta === 'selected' ? 'is-active' : ''} type="button">
                  <span className="pt-agent-avatar">{avatar}</span>
                  <span><strong>{name}</strong><small>{meta}</small></span>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-compact-topic-groups" aria-label="Agent topic groups">
            <div className="pt-topic-group-title">Tasks <span>1</span></div>
            <div className="pt-topic-group-title">Topics <span>2</span></div>
            <div className="pt-topic-group-title">Yesterday</div>
            {[
              ['#', 'Home 新会话测试', 'topic'],
              ['#', '[Draft] Greetings', 'draft'],
            ].map(([mark, title, state]) => (
              <button key={title} className={`pt-compact-topic-row ${state === 'draft' ? 'is-draft' : ''}`} type="button">
                <span>{mark}</span>
                <strong>{title}</strong>
              </button>
            ))}
          </div>

          <button className="pt-chat-upgrade-card" type="button">
            <Sparkles size={16} />
            <span><strong>Upgrade your plan</strong><small>Unlock more capacity and advanced models.</small></span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`pt-topic-rail ${compact ? 'is-compact-chat' : ''}`}>
      <div className="pt-topic-header">
        <button className="pt-agent-switcher" type="button">
          <span className="pt-agent-avatar">🤖</span>
          <span><strong>Lobe AI</strong><small>Personal assistant</small></span>
          <ChevronDown size={14} />
        </button>
        <IconButton label="Create topic"><Plus size={15} /></IconButton>
      </div>
      {compact && (
        <div className="pt-topic-action-stack" aria-label="Agent chat navigation">
          {[
            ['Start New Topic', Plus],
            ['Search', Search],
            ['Agent Profile', Bot],
            ['Topics', MessageSquare],
            ['Channels', Bubbles],
          ].map(([label, Icon]) => (
            <button key={label as string} type="button">
              <Icon size={15} />
              <span>{label as string}</span>
            </button>
          ))}
        </div>
      )}
      <button className="pt-topic-search" type="button">
        <Search size={14} />
        Search conversations
      </button>
      <div className="pt-task-strip">
        <Clock3 size={15} />
        <strong>ArXiv daily picks</strong>
        <small>Scheduled · daily 09:00</small>
      </div>
      <div className="pt-topic-group">
        {['Pinned', 'Recent'].map((group) => (
          <button
            key={group}
            className="pt-topic-group-title"
            type="button"
            onClick={() => setCollapsedGroup((current) => (current === group ? '' : group))}
          >
            <ChevronDown size={13} /> {group}
          </button>
        ))}
      </div>
      <div className="pt-topic-list">
        {topics
          .filter((topic) => collapsedGroup !== topic.group)
          .map((topic) => (
            <button key={topic.id} className={`pt-topic-item ${topic.active ? 'is-active' : ''}`} type="button">
              <MessageSquare size={15} />
              <span><strong>{topic.title}</strong><small>{topic.group} · updated now</small></span>
              <MoreHorizontal size={14} />
            </button>
          ))}
      </div>
    </aside>
  );
}

function ConversationHeader({ compact = false, setSurface }: { compact?: boolean; setSurface: (surface: Surface) => void }) {
  return (
    <header className={`pt-conversation-header ${compact ? 'is-compact-chat' : ''}`}>
      <div className="pt-header-tags">
        <span className="pt-conversation-title">{compact ? 'New Topic' : 'Agent workflow planning'}</span>
        {!compact && <span className="pt-state-tag">Lobe AI</span>}
        {!compact && <span className="pt-state-tag">OpenAI / gpt-4.1</span>}
      </div>
      <div className="pt-header-actions">
        {!compact && <button className="pt-quiet-action" type="button">History</button>}
        {!compact && <IconButton label="Share"><Share2 size={15} /></IconButton>}
        {!compact && <IconButton label="Copy link"><Copy size={15} /></IconButton>}
        {!compact && <IconButton label="Agent profile" onClick={() => setSurface('profile')}><Settings size={15} /></IconButton>}
        <IconButton label="More"><MoreHorizontal size={15} /></IconButton>
        {compact && <IconButton label="Toggle Space and Params"><PanelRightClose size={15} /></IconButton>}
      </div>
    </header>
  );
}

function MessageStream({ handoffPrompt }: { handoffPrompt: string }) {
  const chatState = reviewParam('state');
  const isDeepChatReview = chatState === 'deep-chat';
  const [contextMenuOpen, setContextMenuOpen] = useState(isDeepChatReview || chatState === 'message-menu');
  const [minimapOpen, setMinimapOpen] = useState(isDeepChatReview || chatState === 'minimap-open');
  const [forwardOpen, setForwardOpen] = useState(isDeepChatReview || chatState === 'forward-select');

  return (
    <div className={`pt-message-stream ${isDeepChatReview ? 'is-deep-chat' : ''}`}>
      {isDeepChatReview && (
        <div className="pt-chat-thread-status" role="status">
          <Loader2 className="pt-inline-spin" size={15} />
          <span><strong>Refreshing cached topic</strong><small>Cached messages stay visible while the topic refreshes in place.</small></span>
          <button type="button">Retry</button>
        </div>
      )}
      <div className="pt-chat-virtual-meta" aria-label="Virtualized chat list state">
        <span>18 messages</span>
        <span>active row 12</span>
        <span>streaming row kept mounted</span>
        <span>composer overlay offset 96px</span>
      </div>
      <div className="pt-agent-home-card">
        <div className="pt-agent-avatar large">🤖</div>
        <div>
          <h2>Lobe AI</h2>
          <p>Start a conversation, attach files, or ask this agent to use tools and memory.</p>
        </div>
      </div>
      <div className="pt-chat-date-line"><span>Today</span></div>

      <article className="pt-message user">
        <div className="pt-message-role">You · 09:31</div>
        <p>Help me plan an agent workflow for reading documents and creating follow-up tasks.</p>
        <div className="pt-message-actions compact">
          <button type="button">Edit</button>
          <button type="button">Copy</button>
          <button type="button">Branch</button>
        </div>
      </article>

      {isDeepChatReview && (
        <article className="pt-message assistant pt-chat-history-recovery">
          <div className="pt-assistant-meta">
            <div className="pt-agent-avatar">🤖</div>
            <div><strong>Lobe AI</strong><small>Thread hydration · recovered from local cache</small></div>
          </div>
          <p>Some older turns are restored before remote receipts arrive. The scroll position is preserved and the latest turn stays readable above the composer.</p>
          <div className="pt-tool-chip-row"><span>Skeleton avoided</span><span>Scroll snapshot restored</span><span>Receipts pending</span></div>
        </article>
      )}

      {handoffPrompt && (
        <article className="pt-message user handoff" data-testid="home-chat-handoff-message">
          <div className="pt-message-role">You · Home composer handoff · just now</div>
          <p>{handoffPrompt}</p>
        </article>
      )}

      <article className="pt-message assistant pt-assistant-group">
        <div className="pt-assistant-meta">
          <div className="pt-agent-avatar">🤖</div>
          <div><strong>Lobe AI</strong><small>OpenAI / gpt-4.1 · streaming</small></div>
        </div>
        <p>
          {handoffPrompt
            ? 'I received your prompt from Home. I can keep the conversation context, suggest resources, and prepare a task plan.'
            : 'I can help turn that into a repeatable workflow: gather resources, summarize the key points, and create tasks that stay linked to the conversation.'}
        </p>
        <div className="pt-tool-call-card">
          <div><Sparkles size={15} /><strong>Reading workspace context</strong></div>
          <p>Using selected pages and resources after your approval.</p>
          <div className="pt-progress-line"><span style={{ width: '58%' }} /></div>
        </div>
        <ol className="pt-answer-outline">
          <li>Collect resource notes and identify missing files.</li>
          <li>Summarize findings with citations back to the selected page.</li>
          <li>Create follow-up tasks only after approval.</li>
        </ol>
        {isDeepChatReview && (
          <div className="pt-assistant-workflow">
            <div className="pt-workflow-step is-done"><CheckCircle2 size={15} /><span><strong>Plan</strong><small>Task blocks resolved</small></span></div>
            <div className="pt-workflow-step is-active"><Loader2 className="pt-inline-spin" size={15} /><span><strong>Read files</strong><small>Tool output streaming</small></span></div>
            <div className="pt-workflow-step"><CircleDashed size={15} /><span><strong>Create tasks</strong><small>Waiting for approval</small></span></div>
          </div>
        )}
        <div className="pt-message-actions">
          <button type="button"><Square size={14} /> Stop</button>
          <button type="button"><RefreshCw size={14} /> Regenerate</button>
          <button type="button"><Wand2 size={14} /> Branch</button>
          <button type="button"><Copy size={14} /> Copy</button>
          {isDeepChatReview && <button type="button" onClick={() => setContextMenuOpen((open) => !open)}><MoreHorizontal size={14} /> More</button>}
        </div>
        {contextMenuOpen && (
          <div className="pt-message-context-menu" role="menu" aria-label="Message context menu">
            {['Edit', 'Copy', 'Collapse', 'Share', 'Regenerate', 'Delete'].map((item) => (
              <button key={item} className={item === 'Delete' ? 'danger' : ''} type="button" role="menuitem">
                {item}
              </button>
            ))}
          </div>
        )}
      </article>

      {isDeepChatReview && (
        <article className="pt-message tool" aria-label="Tool detail message">
          <div className="pt-tool-message-head">
            <Sparkles size={16} />
            <span><strong>Workspace file reader</strong><small>Tool detail · 1.4s · settings available</small></span>
            <button type="button">Settings</button>
          </div>
          <div className="pt-tool-detail-grid">
            <div><strong>Input</strong><code>{'{"path":"/Workspace/Agent Notes"}'}</code></div>
            <div><strong>Result</strong><p>3 files found. One file requires explicit binding before summary.</p></div>
          </div>
          <div className="pt-tool-chip-row"><span>Running</span><span>Abort available</span><span>Inspector visible</span></div>
        </article>
      )}

      <article className="pt-runtime-card">
        <div>
          <strong>Tool approval required</strong>
          <p>Read workspace files before summarizing the selected resources.</p>
        </div>
        <div className="pt-runtime-actions">
          <button type="button">Reject</button>
          <button className="primary" type="button">Approve</button>
        </div>
      </article>

      <article className="pt-runtime-card warning">
        <div>
          <strong>Resource needs confirmation</strong>
          <p>This resource is visible in the library. Confirm it before adding it to the current thread.</p>
        </div>
        <span className="pt-state-tag unresolved">review</span>
      </article>

      {isDeepChatReview && (
        <article className="pt-chat-intervention-bar">
          <div className="pt-working-tabs" role="tablist" aria-label="Intervention tabs">
            {['Tool', 'Task', 'Memory'].map((item, index) => (
              <button key={item} className={index === 0 ? 'is-active' : ''} type="button">{item}</button>
            ))}
          </div>
          <span>Tool output is waiting for user approval before the assistant continues.</span>
          <button type="button">Continue</button>
        </article>
      )}

      {isDeepChatReview && (
        <button className="pt-back-bottom" type="button" aria-label="Back to bottom">
          <ChevronDown size={16} />
        </button>
      )}

      {isDeepChatReview && (
        <aside
          className={`pt-chat-minimap ${minimapOpen ? 'is-open' : ''}`}
          aria-label="Chat minimap"
          onMouseEnter={() => setMinimapOpen(true)}
          onMouseLeave={() => setMinimapOpen(false)}
        >
          <div className="pt-minimap-rail">
            {[30, 46, 62, 36, 74].map((width, index) => (
              <button key={width + index} className={index === 2 ? 'is-active' : ''} style={{ width }} type="button" aria-label={`Jump to message ${index + 1}`} />
            ))}
          </div>
          {minimapOpen && (
            <div className="pt-minimap-preview">
              {['Plan document reading flow', 'Attach Product brief', 'Tool output from files', 'Approval before task creation'].map((item, index) => (
                <button key={item} className={index === 2 ? 'is-active' : ''} type="button">{item}<span /></button>
              ))}
            </div>
          )}
        </aside>
      )}

      {forwardOpen && (
        <div className="pt-forward-selection-footer" role="status">
          <span><strong>3 messages selected</strong><small>Forward keeps selected rows mounted while the list recycles older turns.</small></span>
          <button type="button" onClick={() => setForwardOpen(false)}>Cancel</button>
          <button className="primary" type="button">Forward</button>
        </div>
      )}
    </div>
  );
}

function ChatNewTopicSurface() {
  return (
    <div className="pt-chat-new-topic" aria-label="Chat new topic start state">
      <div className="pt-agent-avatar hero">🤖</div>
      <h1>Lobe AI</h1>
      <p>Hi, I’m <strong>Lobe AI</strong>. One sentence is enough-you&apos;re in control.</p>
      <ChatInputSurface compact focusKey={0} />
    </div>
  );
}

function ChatInputSurface({ compact = false, focusKey }: { compact?: boolean; focusKey: number }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [contextOpen, setContextOpen] = useState(reviewParam('state') === 'context-open');
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (focusKey <= 0) return;
    inputRef.current?.focus();
  }, [focusKey]);

  return (
    <div className={`pt-chat-input ${compact ? 'is-compact-chat' : ''}`}>
      <textarea
        ref={inputRef}
        aria-label="Agent chat prompt"
        placeholder={compact ? 'Ask, create, or start a task. @ to assign tasks to other agents.' : 'Message Lobe AI...'}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      {contextOpen && (
        <div className="pt-chat-context-popover">
          <strong>Add context</strong>
          <button type="button"><FileText size={15} /> Current page</button>
          <button type="button"><Library size={15} /> Resource library</button>
          <button type="button"><Sparkles size={15} /> Enabled skills</button>
        </div>
      )}
      <div className="pt-composer-footer compact">
        <div className="pt-action-row pt-model-row">
          <button type="button"><BrainCircuit size={15} /> DeepSeek</button>
          <button type="button" onClick={() => setContextOpen((open) => !open)}><Plus size={15} /> Context</button>
        </div>
        <div className="pt-action-row pt-live-footer-row">
          <button type="button"><Bot size={15} /> Agent</button>
          <button type="button"><PanelRightClose size={15} /> No device</button>
          <button type="button">Allow List <ChevronDown size={14} /></button>
          <button className="pt-send-button" type="button" aria-label="Send message"><Wand2 size={15} /></button>
        </div>
      </div>
    </div>
  );
}

function CompactChatSideAffordance() {
  return (
    <aside className="pt-compact-chat-side-affordance" aria-label="Compact Chat Space and Params preview">
      <div className="pt-compact-side-tabs" role="tablist" aria-label="Compact working tabs">
        <button className="is-active" type="button">Space</button>
        <button type="button">Params</button>
      </div>
      <div className="pt-compact-side-card">
        <strong>Model Config</strong>
        <p>Provider/model stays projected from Peers Settings. Full controls remain in deep-chat review.</p>
      </div>
    </aside>
  );
}

function WorkingSidebar() {
  const [tab, setTab] = useState<WorkingTab>(initialWorkingTab);
  const tabs: WorkingTab[] = ['resources', 'review', 'files', 'params'];
  const isDeepChatReview = reviewParam('state') === 'deep-chat';

  return (
    <aside className={`pt-working-panel ${isDeepChatReview ? 'is-resizable' : ''}`}>
      {isDeepChatReview && <button className="pt-working-resize-handle" type="button" aria-label="Resize working sidebar" />}
      <div className="pt-working-header">
        <div className="pt-working-tabs">
          {tabs.map((item) => (
            <button key={item} className={tab === item ? 'is-active' : ''} type="button" onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </div>
        <IconButton label="Close panel"><PanelRightClose size={15} /></IconButton>
      </div>

      {tab === 'resources' && (
        <div className="pt-panel-section">
          <div className="pt-panel-title-row"><h3>Space</h3><button type="button">Manage</button></div>
          <p>Select files, pages, and generated assets for this thread.</p>
          <div className="pt-panel-search"><Search size={14} /> Search resources</div>
          <div className="pt-resource-row selected"><FileText size={16} /> Product brief <span>page</span></div>
          <div className="pt-resource-row"><Image size={16} /> generated-image.png <span>image</span></div>
          <div className="pt-resource-row muted"><Library size={16} /> meeting-audio.mp3 <span>audio</span></div>
          <div className="pt-state-box warning">Visible resources stay unbound until you confirm them for this thread.</div>
        </div>
      )}
      {tab === 'review' && (
        <div className="pt-panel-section">
          <div className="pt-panel-title-row"><h3>Review</h3><button type="button">Apply all</button></div>
          <p>Review suggested changes before applying them to the workspace.</p>
          {isDeepChatReview && <div className="pt-state-box">Width 360px · split view keeps diff review independent from the message scroll root.</div>}
          <div className="pt-diff-row">+ Add task reminder from summary</div>
          <div className="pt-diff-row">+ Link Product brief as context</div>
          <div className="pt-diff-row danger">- Remove duplicate note</div>
          <div className="pt-runtime-actions"><button type="button">Reject</button><button className="primary" type="button">Apply selected</button></div>
        </div>
      )}
      {tab === 'files' && (
        <div className="pt-panel-section">
          <div className="pt-panel-title-row"><h3>Files</h3><button type="button">Upload</button></div>
          <p>Browse local workspace files available to this conversation.</p>
          <div className="pt-tree-row"><FolderOpen size={15} /> /Workspace/Agent Notes</div>
          <div className="pt-tree-row"><FileText size={15} /> meeting-summary.md</div>
          <div className="pt-tree-row"><FileText size={15} /> follow-up-plan.md</div>
        </div>
      )}
      {tab === 'params' && (
        <div className="pt-panel-section">
          <div className="pt-panel-title-row"><h3>Params</h3><button type="button">Reset</button></div>
          <label>Temperature <input type="range" defaultValue={40} /></label>
          <label>Context window <input type="range" defaultValue={72} /></label>
          <label>Reasoning effort <select defaultValue="medium"><option>low</option><option>medium</option><option>high</option></select></label>
          <div className="pt-state-box">Provider and model choices follow your Settings Provider configuration.</div>
        </div>
      )}
    </aside>
  );
}

function ChatSurface({
  focusKey,
  handoffPrompt,
  setSurface,
}: {
  focusKey: number;
  handoffPrompt: string;
  setSurface: (surface: Surface) => void;
}) {
  const chatState = reviewParam('state');
  const isDeepChatReview = chatState === 'deep-chat';
  const isCompactChat = !isDeepChatReview && chatState !== 'legacy-chat';

  return (
    <section className={`pt-chat-shell ${isCompactChat ? 'is-compact-chat' : ''}`} aria-label="LobeHub Agent Chat parity baseline">
      <AgentTopicRail compact={isCompactChat} />
      <main className={`pt-conversation-pane ${isCompactChat ? 'is-compact-chat' : ''}`}>
        <ConversationHeader compact={isCompactChat} setSurface={setSurface} />
        {isCompactChat ? <ChatNewTopicSurface /> : <MessageStream handoffPrompt={handoffPrompt} />}
        {!isCompactChat && <ChatInputSurface focusKey={focusKey} />}
      </main>
      {isCompactChat && <CompactChatSideAffordance />}
      {!isCompactChat && <WorkingSidebar />}
    </section>
  );
}

function ProfileSurface() {
  const profileState = reviewParam('state');
  const isDeepProfileReview = profileState === 'deep-profile';
  const isCompactProfile = !isDeepProfileReview && profileState !== 'legacy-profile';
  const [settingsOpen, setSettingsOpen] = useState(profileState === 'profile-settings');
  const [settingsTab, setSettingsTab] = useState<'opening' | 'iteration' | 'connectors'>('opening');
  const [builderOpen, setBuilderOpen] = useState(isCompactProfile || isDeepProfileReview || profileState === 'builder-open');
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(isDeepProfileReview || profileState === 'avatar-picker');
  const [modelMenuOpen, setModelMenuOpen] = useState(isDeepProfileReview || profileState === 'model-menu');
  const [toolMenuOpen, setToolMenuOpen] = useState(isDeepProfileReview || profileState === 'tool-menu');
  const [slashMenuOpen, setSlashMenuOpen] = useState(isDeepProfileReview || profileState === 'slash-menu');
  const openSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const closeSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const closeSettings = () => {
    setSettingsOpen(false);
    openSettingsButtonRef.current?.focus();
  };

  useEffect(() => {
    if (!settingsOpen) return;
    closeSettingsButtonRef.current?.focus();
  }, [settingsOpen]);

  if (isCompactProfile) {
    return (
      <section className="pt-profile-shell is-compact-profile" aria-label="LobeHub Agent Profile parity baseline">
        <div className={`pt-profile-compact-layout ${builderOpen ? 'has-builder' : ''}`} aria-label="Agent Profile compact editor">
          <aside className="pt-profile-agent-rail" aria-label="Agent profile navigation">
            <button className="pt-agent-switcher" type="button">
              <span className="pt-agent-avatar">🤖</span>
              <span><strong>Custom Agent</strong><small>Personal assistant</small></span>
              <ChevronDown size={14} />
            </button>
            <div className="pt-topic-action-stack">
              {[
                ['Start New Topic', Plus],
                ['Search', Search],
                ['Agent Profile', Bot],
                ['Topics', MessageSquare],
                ['Channels', Bubbles],
              ].map(([label, Icon]) => (
                <button key={label as string} className={label === 'Agent Profile' ? 'is-active' : ''} type="button">
                  <Icon size={15} />
                  <span>{label as string}</span>
                </button>
              ))}
            </div>
            <div className="pt-profile-rail-section">
              <span>Tasks</span>
              <button type="button">Agent workspace plan</button>
            </div>
            <div className="pt-profile-rail-section">
              <span>Topics</span>
              <button type="button"><Plus size={14} /> Start New Topic</button>
            </div>
            <div className="pt-profile-upgrade-card" aria-label="Upgrade your plan">
              <strong>Upgrade your plan</strong>
              <span>Unlock more capacity and advanced features.</span>
            </div>
          </aside>

          <main className="pt-profile-compact-main">
            <header className="pt-profile-compact-header">
              <div className="pt-profile-crumb-row">
                <span>Custom Agent</span>
                <ChevronDown size={13} />
                <strong>Agent Profile</strong>
                <span className="pt-profile-autosave"><CircleDashed size={13} /> Latest version loaded</span>
              </div>
              <div className="pt-header-actions">
                <IconButton label="More"><MoreHorizontal size={15} /></IconButton>
                <IconButton label="Agent builder" onClick={() => setBuilderOpen((open) => !open)}><Bot size={15} /></IconButton>
              </div>
            </header>

            <section className="pt-profile-compact-editor" aria-label="Agent Profile compact editor canvas">
              <button className="pt-profile-compact-avatar" type="button" aria-expanded={avatarPickerOpen} onClick={() => setAvatarPickerOpen((open) => !open)}>
                <span className="pt-agent-avatar profile large">🤖</span>
                <small>Edit avatar</small>
              </button>
              {avatarPickerOpen && (
                <div className="pt-avatar-picker-popover compact" role="dialog" aria-label="Avatar picker">
                  <div className="pt-popover-tabs" role="tablist" aria-label="Avatar picker tabs">
                    {['Emoji', 'Model', 'Upload', 'Background'].map((tab, index) => (
                      <button key={tab} className={index === 0 ? 'is-active' : ''} type="button">{tab}</button>
                    ))}
                  </div>
                  <div className="pt-avatar-grid" aria-label="Emoji avatar options">
                    {['🤖', '🧠', '✨', '📚', '🧩', '🔎'].map((emoji, index) => (
                      <button key={emoji} className={index === 0 ? 'selected' : ''} type="button">{emoji}</button>
                    ))}
                  </div>
                </div>
              )}
              <input className="pt-profile-title-input" aria-label="Enter agent name" placeholder="Enter agent name" />
              <div className="pt-profile-model-tools" aria-label="Model and tools">
                <span>Model &amp; Tools</span>
                <button type="button" aria-expanded={modelMenuOpen} onClick={() => setModelMenuOpen((open) => !open)}>lobehub/claude-opus-4-7 <ChevronDown size={14} /></button>
                <button type="button" aria-expanded={toolMenuOpen} onClick={() => setToolMenuOpen((open) => !open)}><Plus size={14} /> Add Skill</button>
                {modelMenuOpen && (
                  <div className="pt-model-popover compact" role="menu" aria-label="Agent model selector">
                    {[
                      ['LobeHub', 'claude-opus-4-7', 'Latest'],
                      ['OpenAI', 'gpt-4.1', 'Peers projection'],
                      ['Peers Local', 'station-agent-large', 'Requires Station'],
                    ].map(([provider, model, meta]) => (
                      <button key={model} type="button" role="menuitem">
                        <span><strong>{provider}</strong><small>{model}</small></span>
                        <em>{meta}</em>
                      </button>
                    ))}
                  </div>
                )}
                {toolMenuOpen && (
                  <div className="pt-agent-tool-popover compact" role="menu" aria-label="Agent tool selector">
                    {[
                      ['DeepSeek', 'Built-in', 'Enabled'],
                      ['Workspace Files', 'Connector', 'Needs approval'],
                      ['Tasks', 'Skill', 'Enabled'],
                    ].map(([tool, source, state]) => (
                      <button key={tool} type="button" role="menuitem">
                        <span><strong>{tool}</strong><small>{source}</small></span>
                        <em>{state}</em>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-core-instructions-block">
                <h2>Core Instructions</h2>
                <p>Defines who this agent is, what it is responsible for, and how it works and responds. It serves as a core instruction in every conversation.</p>
                <div className="pt-core-instructions-editor" aria-label="Core instructions editor">
                  <span>Enter core instructions, press / to open the Slash Menu</span>
                  <button type="button" aria-expanded={slashMenuOpen} onClick={() => setSlashMenuOpen((open) => !open)}><Plus size={14} /> Slash</button>
                  {slashMenuOpen && (
                    <div className="pt-slash-menu compact" role="menu" aria-label="Slash command menu">
                      {[
                        ['h1', 'Heading 1'],
                        ['tl', 'Task list'],
                        ['table', 'Table'],
                        ['codeblock', 'Code block'],
                      ].map(([key, label]) => (
                        <button key={key} type="button" role="menuitem"><strong>{label}</strong><code>{key}</code></button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </main>

          {builderOpen && (
            <aside className="pt-profile-compact-builder" aria-label="Agent Builder">
              <div className="pt-profile-section-head">
                <div>
                  <strong>Agent Builder</strong>
                  <span>Turn a use case into an agent profile.</span>
                </div>
                <button type="button" onClick={() => setBuilderOpen(false)}>Close</button>
              </div>
              <div className="pt-builder-prompt-card">
                <strong>Tell me your use case.</strong>
                <p>Writing, coding, or data analysis-anything works. You own the goal and standards; I'll break it down into collaborative, runnable Agents.</p>
              </div>
              <div className="pt-builder-suggestion-list" aria-label="Agent Builder suggestions">
                {[
                  ['Define the agent\'s system role', 'Help me write a clear system role for this agent so it knows what it is supposed to do and how to behave'],
                  ['Enable tools for this agent', 'Show me what tools I can enable for this agent and help me pick the right ones based on what I want it to do'],
                  ['Write an opening message', 'Help me craft an opening message so users know how to start interacting with this agent right away'],
                ].map(([title, body]) => (
                  <button key={title} className="pt-builder-suggestion-card" type="button">
                    <strong>{title}</strong>
                    <span>{body}</span>
                  </button>
                ))}
              </div>
              <div className="pt-builder-switch-row">
                <button type="button">Switch</button>
              </div>
              <div className="pt-builder-composer is-compact-builder" aria-label="Agent Builder composer">
                <textarea placeholder="Ask, create, or start a task. @ to assign tasks to other agents." />
                <button type="button" aria-label="Send builder message"><Sparkles size={14} /></button>
              </div>
            </aside>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="pt-profile-shell" aria-label="LobeHub Agent Profile parity baseline">
      <div className="pt-profile-header">
        <div className="pt-profile-title-row">
          <div className="pt-agent-avatar profile">🤖</div>
          <div>
            <span className="pt-profile-breadcrumb">Agents / Lobe AI · autosaved</span>
            <h1>Lobe AI</h1>
            <p>Configure persona, model behavior, tools, memory and opening guidance for this assistant.</p>
            {isDeepProfileReview && (
              <div className="pt-profile-status-row" aria-label="Profile hydration and lock state">
                <span><CheckCircle2 size={13} /> Config hydrated</span>
                <span><Clock3 size={13} /> Edit lock peeked</span>
                <span><Loader2 className="pt-inline-spin" size={13} /> Builder draft streaming</span>
              </div>
            )}
          </div>
        </div>
        <div className="pt-header-actions">
          <button type="button" onClick={() => setBuilderOpen((open) => !open)}>Agent Builder</button>
          <button ref={openSettingsButtonRef} type="button" onClick={() => setSettingsOpen(true)}>Open Agent Settings</button>
          <IconButton label="Share agent"><Share2 size={15} /></IconButton>
          <IconButton label="More"><MoreHorizontal size={15} /></IconButton>
        </div>
      </div>

      <div className="pt-profile-grid">
        <aside className="pt-profile-identity-card">
          <button className="pt-avatar-editor" type="button" aria-expanded={avatarPickerOpen} onClick={() => setAvatarPickerOpen((open) => !open)}>
            <span className="pt-agent-avatar profile large">🤖</span>
            <small>Edit avatar</small>
          </button>
          {avatarPickerOpen && (
            <div className="pt-avatar-picker-popover" role="dialog" aria-label="Avatar picker">
              <div className="pt-popover-tabs" role="tablist" aria-label="Avatar picker tabs">
                {['Emoji', 'Model', 'Upload', 'Background'].map((tab, index) => (
                  <button key={tab} className={index === 0 ? 'is-active' : ''} type="button">{tab}</button>
                ))}
              </div>
              <div className="pt-avatar-grid" aria-label="Emoji avatar options">
                {['🤖', '🧠', '✨', '📚', '🧩', '🔎'].map((emoji, index) => (
                  <button key={emoji} className={index === 0 ? 'selected' : ''} type="button">{emoji}</button>
                ))}
              </div>
              <div className="pt-state-box">Upload is preserved here as an explicit prototype boundary; product upload still requires the store-backed flow.</div>
            </div>
          )}
          <div className="pt-avatar-swatches" aria-label="Avatar background options">
            {['#eef6ff', '#f6f2ff', '#fff4de', '#eafaf0'].map((color) => <span key={color} style={{ background: color }} />)}
          </div>
          <div className="pt-form-group">
            <label>Display name</label>
            <input defaultValue="Lobe AI" aria-label="Agent display name" />
          </div>
          <div className="pt-form-group">
            <label>Description</label>
            <textarea defaultValue="A calm assistant for planning, research, writing, resources and task follow-up." aria-label="Agent description" />
          </div>
          <div className="pt-profile-switch-list">
            <button className="selected" type="button"><CheckCircle2 size={15} /> Private assistant</button>
            <button type="button"><CircleDashed size={15} /> Publish to workspace</button>
            <button type="button"><Sparkles size={15} /> Use as default agent</button>
          </div>
          <div className="pt-state-box">Private agents can use personal memory and selected workspace resources after you approve access.</div>
        </aside>

        <main className="pt-profile-editor">
          <div className="pt-profile-section-head">
            <div>
              <strong>Profile editor</strong>
              <span>System prompt, greeting and suggested questions · editing unlocked</span>
            </div>
            <button type="button">Reset</button>
          </div>
          {isDeepProfileReview && (
            <div className="pt-profile-async-boundary" role="status">
              <Loader2 className="pt-inline-spin" size={15} />
              <span><strong>Profile config recovering</strong><small>AsyncBoundary keeps the editor rail stable while retry data resolves.</small></span>
              <button type="button">Retry config</button>
            </div>
          )}
          <div className="pt-profile-runtime-config" aria-label="Runtime model and tool config">
            <div className="pt-runtime-config-card">
              <span>ModelSelect</span>
              <button type="button" aria-expanded={modelMenuOpen} onClick={() => setModelMenuOpen((open) => !open)}>OpenAI / gpt-4.1 <ChevronDown size={14} /></button>
              {modelMenuOpen && (
                <div className="pt-model-popover" role="menu" aria-label="Agent model selector">
                  {[
                    ['OpenAI', 'gpt-4.1', 'Current'],
                    ['Anthropic', 'claude-3.7-sonnet', 'Reasoning'],
                    ['Peers Local', 'station-agent-large', 'Requires Station'],
                  ].map(([provider, model, meta]) => (
                    <button key={model} type="button" role="menuitem">
                      <span><strong>{provider}</strong><small>{model}</small></span>
                      <em>{meta}</em>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="pt-runtime-config-card">
              <span>AgentTool</span>
              <button type="button" aria-expanded={toolMenuOpen} onClick={() => setToolMenuOpen((open) => !open)}>3 tools enabled <ChevronDown size={14} /></button>
              {toolMenuOpen && (
                <div className="pt-agent-tool-popover" role="menu" aria-label="Agent tool selector">
                  {[
                    ['Web Search', 'Built-in', 'Enabled'],
                    ['Workspace Files', 'Connector', 'Needs approval'],
                    ['Tasks', 'Skill', 'Enabled'],
                    ['Local DevTools', 'MCP', 'Unavailable on web'],
                  ].map(([tool, source, state]) => (
                    <button key={tool} type="button" role="menuitem">
                      <span><strong>{tool}</strong><small>{source}</small></span>
                      <em>{state}</em>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="pt-editor-toolbar" aria-label="System role editor toolbar">
            {['Bold', 'Italic', 'Task list', 'Quote', 'Math', 'Code'].map((item, index) => <button key={item} className={index < 2 ? 'is-active' : ''} type="button">{item}</button>)}
            <button type="button" aria-expanded={slashMenuOpen} onClick={() => setSlashMenuOpen((open) => !open)}><Plus size={14} /> Slash</button>
            {slashMenuOpen && (
              <div className="pt-slash-menu" role="menu" aria-label="Slash command menu">
                {[
                  ['h1', 'Heading 1'],
                  ['tl', 'Task list'],
                  ['table', 'Table'],
                  ['tex', 'Math'],
                  ['codeblock', 'Code block'],
                ].map(([key, label]) => (
                  <button key={key} type="button" role="menuitem"><strong>{label}</strong><code>{key}</code></button>
                ))}
              </div>
            )}
          </div>
          <div className="pt-form-group">
            <label>System role</label>
            <div className="pt-editor-canvas" aria-label="Rich system prompt editor">
              <textarea defaultValue="You are Lobe AI, a helpful assistant. Keep answers concise, use available tools when needed, cite workspace sources when they are attached, and ask before taking risky actions." />
              {isDeepProfileReview && <span className="pt-edit-lock-indicator"><Clock3 size={13} /> Editing lock held by you · saved 2s ago</span>}
            </div>
          </div>
          <div className="pt-form-row">
            <div className="pt-form-group">
              <label>Opening message</label>
              <textarea defaultValue="Hi, I can help with planning, research, writing, and workspace resources. What should we work on first?" />
            </div>
            <div className="pt-form-group">
              <label>Conversation guide</label>
              <textarea defaultValue="Prefer actionable plans, call out assumptions, and keep follow-up tasks visible." />
            </div>
          </div>
          <div className="pt-profile-section-head">
            <div>
              <strong>Opening questions</strong>
              <span>Shown before the first message</span>
            </div>
            <button type="button"><Plus size={14} /> Add</button>
          </div>
          <div className="pt-question-list">
            {['Summarize today', 'Create a scheduled task', 'Use workspace resources', 'Draft a research plan'].map((question) => (
              <button key={question} type="button">{question}</button>
            ))}
          </div>
          <div className="pt-profile-config-grid">
            <section className="pt-profile-config-card">
              <strong>Knowledge</strong>
              <p>Allow selected pages and resources to be attached as conversation context.</p>
              <div className="pt-tool-chip-row"><span>Pages</span><span>Resources</span><span>Uploads</span></div>
            </section>
            <section className="pt-profile-config-card">
              <strong>Tools</strong>
              <p>Web Search, Workspace Files and Task tools require visible approval before use.</p>
              <div className="pt-tool-chip-row"><span>Web Search</span><span>Files</span><span>Tasks</span></div>
            </section>
          </div>
        </main>

        <aside className="pt-settings-modal-preview">
          <div className="pt-modal-head">
            <strong>Agent Settings</strong>
            <span>Opening, iteration, connectors</span>
          </div>
          <div className="pt-settings-section">
            <h3>Model</h3>
            <p>OpenAI / gpt-4.1 with temperature, reasoning and context controls.</p>
            <dl className="pt-profile-mini-meta">
              <div><dt>Temperature</dt><dd>0.4</dd></div>
              <div><dt>Reasoning</dt><dd>medium</dd></div>
            </dl>
          </div>
          <div className="pt-settings-section">
            <h3>Tools / Skills</h3>
            <p>Enable workspace tools, web search, and approved skills for this agent.</p>
            <div className="pt-tool-chip-row"><span>3 enabled</span><span>1 needs approval</span></div>
          </div>
          <div className="pt-settings-section">
            <h3>Memory</h3>
            <p>Memory behavior is summarized here; detailed memory management stays in the Memory surface.</p>
          </div>
        </aside>
      </div>

      {builderOpen && (
        <div className="pt-profile-builder-panel" role="region" aria-label="Agent Builder">
          <div className="pt-profile-section-head">
            <div>
              <strong>Agent Builder</strong>
              <span>Use chat-like guidance to refine this profile before saving.</span>
            </div>
            <button type="button" onClick={() => setBuilderOpen(false)}>Close</button>
          </div>
          {isDeepProfileReview && (
            <div className="pt-builder-topic-selector" aria-label="Agent Builder topic selector">
              <button type="button"><Plus size={14} /> New builder topic</button>
              {['Improve resource behavior · 2m ago', 'Opening prompt polish · Yesterday', 'Tool permission plan · Jun 28'].map((topic, index) => (
                <button key={topic} className={index === 0 ? 'is-active' : ''} type="button">{topic}</button>
              ))}
            </div>
          )}
          <div className="pt-builder-message user">Make this agent more proactive when a resource is attached.</div>
          <div className="pt-builder-message assistant">Suggested update: add a rule to summarize attached resources first, then ask before creating tasks.</div>
          {isDeepProfileReview && (
            <>
              <div className="pt-builder-suggestion-row" aria-label="Builder suggestion feedback">
                {['Apply to prompt', 'Use in follow-up', 'Manual edit', 'Reject'].map((action, index) => (
                  <button key={action} className={index === 0 ? 'primary' : ''} type="button">{action}</button>
                ))}
              </div>
              <div className="pt-builder-composer" aria-label="Agent Builder composer">
                <textarea defaultValue="Also keep generated tasks visible until I approve them." />
                <button type="button"><Sparkles size={14} /> Send to builder</button>
              </div>
            </>
          )}
        </div>
      )}

      {settingsOpen && (
        <div
          className="pt-modal-overlay"
          role="dialog"
          aria-label="Agent Settings modal"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeSettings();
          }}
        >
          <div className="pt-modal-card">
            <div className="pt-modal-head">
              <strong>Agent Settings</strong>
              <button ref={closeSettingsButtonRef} type="button" onClick={closeSettings}>Close</button>
            </div>
            <div className="pt-toolbar modal-tabs">
              {(['opening', 'iteration', 'connectors'] as const).map((tab) => (
                <button key={tab} className={settingsTab === tab ? 'is-active' : ''} type="button" onClick={() => setSettingsTab(tab)}>
                  {tab}
                </button>
              ))}
            </div>
            <div className="pt-settings-section">
              {settingsTab === 'opening' && (
                <div className="pt-profile-settings-form">
                  <label>Opening message <textarea defaultValue="Hi, I can help with planning, research, writing, and workspace resources." /></label>
                  <div className="pt-profile-question-editor">
                    {['Summarize today', 'Create a scheduled task', 'Use workspace resources'].map((question) => (
                      <button key={question} type="button"><MoreHorizontal size={14} /> {question}</button>
                    ))}
                    <button type="button"><Plus size={14} /> Add question</button>
                  </div>
                </div>
              )}
              {settingsTab === 'iteration' && (
                <div className="pt-profile-settings-form">
                  <button className="selected" type="button"><CheckCircle2 size={15} /> Self iteration suggestions enabled</button>
                  <label>Iteration tone <select defaultValue="careful"><option value="careful">Careful</option><option value="fast">Fast draft</option></select></label>
                  <div className="pt-state-box">Builder suggestions remain drafts until you apply them.</div>
                </div>
              )}
              {settingsTab === 'connectors' && (
                <div className="pt-profile-settings-form">
                  {['Web Search', 'Workspace Files', 'Task'].map((tool) => (
                    <button key={tool} type="button"><CheckCircle2 size={15} /> {tool}</button>
                  ))}
                  <div className="pt-state-box warning">External tools ask for approval before the agent runs them.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SurfaceHeader({
  children,
  owner,
  title,
}: {
  children: React.ReactNode;
  owner: string;
  title: string;
}) {
  return (
    <header className="pt-deep-header">
      <div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      <OwnerPill owner={owner} />
    </header>
  );
}

function TasksSurface() {
  const taskState = reviewParam('state');
  const isDeepTasksReview = taskState === 'deep-tasks';
  const isCompactTasks = !isDeepTasksReview && taskState !== 'legacy-tasks';
  const [showCompleted, setShowCompleted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(taskState === 'delete-confirm');
  const [selectedTaskId, setSelectedTaskId] = useState('arxiv');
  const [viewConfigOpen, setViewConfigOpen] = useState(isDeepTasksReview || taskState === 'settings-open');
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [inlineEntryOpen, setInlineEntryOpen] = useState(isDeepTasksReview || taskState === 'create-inline');
  const [contextMenuOpen, setContextMenuOpen] = useState(isDeepTasksReview || taskState === 'context-menu');
  const [scheduleOpen, setScheduleOpen] = useState(isDeepTasksReview || taskState === 'schedule-open');
  const [topicDrawerOpen, setTopicDrawerOpen] = useState(isDeepTasksReview || taskState === 'topic-drawer');
  const tasks = [
    { id: 'arxiv', title: 'ArXiv daily picks', status: 'Scheduled', group: 'Scheduled', priority: 'High', assignee: 'Research Agent', schedule: 'Daily at 09:00', meta: 'Search papers, summarize novelty and ask for missing research area.', updated: '09:12' },
    { id: 'weekly', title: 'Must-read papers weekly', status: 'Paused', group: 'Paused', priority: 'Medium', assignee: 'Research Agent', schedule: 'Every Friday', meta: 'Waiting for next research area confirmation.', updated: 'Yesterday' },
    { id: 'followup', title: 'Workspace follow-up', status: 'Awaiting input', group: 'Awaiting input', priority: 'None', assignee: 'Workspace Agent', schedule: 'Manual run', meta: 'Needs a resource selection before creating tasks.', updated: '2d ago' },
  ];
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  const groupedTasks = ['Scheduled', 'Awaiting input', 'Paused'].map((group) => ({
    group,
    items: tasks.filter((task) => task.group === group),
  }));

  if (isCompactTasks) {
    return (
      <section className="pt-task-compact-shell" aria-label="LobeHub Tasks compact baseline">
        <div className="pt-task-workspace is-compact-tasks">
          <main className="pt-task-outlet">
            <header className="pt-task-nav-header is-compact-tasks">
              <div className="pt-task-breadcrumb">
                <strong>All tasks</strong>
              </div>
              <div className="pt-task-nav-actions">
                <button type="button"><Search size={15} /> Search</button>
                <button className="icon" type="button" aria-label="Create task"><Plus size={15} /></button>
                <button className="icon" type="button" aria-expanded={viewConfigOpen} aria-label="Task view settings" onClick={() => setViewConfigOpen((open) => !open)}><Settings size={15} /></button>
                <button className="icon" type="button" aria-label="Toggle task agent panel"><PanelRightClose size={15} /></button>
              </div>
              {viewConfigOpen && (
                <div className="pt-task-view-popover">
                  <div className="pt-segmented" role="tablist" aria-label="Task view mode">
                    <button className={viewMode === 'list' ? 'is-active' : ''} type="button" onClick={() => setViewMode('list')}>List</button>
                    <button className={viewMode === 'board' ? 'is-active' : ''} type="button" onClick={() => setViewMode('board')}>Board</button>
                  </div>
                  <label><span>Group by</span><select defaultValue="status"><option>Status</option><option>Assignee</option><option>Priority</option></select></label>
                  <label><span>Order by</span><select defaultValue="updated"><option value="updated">Updated time</option><option>Priority</option><option>Title</option></select></label>
                  <label className="pt-switch-row"><input checked={showCompleted} type="checkbox" onChange={(event) => setShowCompleted(event.target.checked)} /> Show completed and canceled</label>
                </div>
              )}
            </header>

            <div className="pt-task-compact-container">
              {viewMode === 'list' ? (
                <section className="pt-task-compact-list" aria-label="All tasks">
                  {groupedTasks.map((group) => (
                    <section className="pt-task-group" key={group.group}>
                      <button className="pt-task-group-title is-compact-tasks" type="button"><ChevronDown size={14} /> {group.group}<span>{group.items.length}</span></button>
                      <div className="pt-task-list-block is-compact-tasks">
                        {group.items.map((task) => (
                          <div key={task.id} className="pt-task-row-wrap">
                            <button
                              className={`pt-task-row is-compact-tasks ${selectedTaskId === task.id ? 'selected' : ''}`}
                              type="button"
                              onClick={() => setSelectedTaskId(task.id)}
                            >
                              <span className={`pt-task-status status-${task.status.toLowerCase().replace(/\s+/g, '-')}`}>{task.status}</span>
                              <span className="pt-task-title"><strong>{task.id.toUpperCase()}</strong><b>{task.title}</b></span>
                              <span className="pt-task-meta">{task.schedule}</span>
                              <span className="pt-task-meta">{task.updated}</span>
                              <MoreHorizontal size={15} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </section>
              ) : (
                <section className="pt-task-board is-compact-tasks" aria-label="Task board">
                  {groupedTasks.map((group) => (
                    <div className="pt-task-board-column" key={group.group}>
                      <div><strong>{group.group}</strong><span>{group.items.length}</span></div>
                      {group.items.map((task) => (
                        <button key={task.id} className="pt-task-board-card" type="button" onClick={() => setSelectedTaskId(task.id)}>
                          <span className={`pt-task-status status-${task.status.toLowerCase().replace(/\s+/g, '-')}`}>{task.status}</span>
                          <strong>{task.title}</strong>
                          <small>{task.schedule}</small>
                        </button>
                      ))}
                    </div>
                  ))}
                </section>
              )}
            </div>
          </main>

          <aside className="pt-task-agent-panel is-compact-tasks" aria-label="Task agent manager">
            <div className="pt-task-agent-toolbar is-compact-tasks">
              <strong>Topic</strong>
              <span>Task Agent</span>
            </div>
            <div className="pt-task-agent-chat is-compact-tasks">
              <p className="assistant">Ask me about your tasks</p>
              <p className="assistant">Create, start, or review a task. Use @ to assign tasks to other agents.</p>
            </div>
            <div className="pt-task-agent-input is-compact-tasks">
              <textarea aria-label="Task agent message" placeholder="Ask, create, or start a task. @ to assign tasks to other agents." />
              <div>
                <button type="button">Topic</button>
                <button type="button">DeepSeek V4 Pro</button>
                <button className="primary" type="button">Send</button>
              </div>
            </div>
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className="pt-deep-shell">
      <SurfaceHeader owner="agent-domain" title="Tasks">
        Plan recurring work, review tool approvals, and keep task history connected to the conversation.
      </SurfaceHeader>
      <div className={`pt-task-workspace ${isDeepTasksReview ? 'is-deep-tasks' : ''}`}>
        <main className="pt-task-outlet">
          <header className="pt-task-nav-header">
            <div className="pt-task-breadcrumb"><span>Tasks</span><ChevronDown size={14} /><strong>{selectedTask.title}</strong></div>
            <div className="pt-task-nav-actions">
              <button type="button"><Search size={15} /> Search</button>
              <button className="icon" type="button" aria-label="Create task"><Plus size={15} /></button>
              <button className="icon" type="button" aria-expanded={viewConfigOpen} aria-label="Task view settings" onClick={() => setViewConfigOpen((open) => !open)}><Settings size={15} /></button>
              <button className="icon" type="button" aria-label="Toggle task agent panel"><PanelRightClose size={15} /></button>
            </div>
            {viewConfigOpen && (
              <div className="pt-task-view-popover">
                <div className="pt-segmented" role="tablist" aria-label="Task view mode">
                  <button className={viewMode === 'list' ? 'is-active' : ''} type="button" onClick={() => setViewMode('list')}>List</button>
                  <button className={viewMode === 'board' ? 'is-active' : ''} type="button" onClick={() => setViewMode('board')}>Board</button>
                </div>
                {isDeepTasksReview && <div className="pt-state-box">AsyncBoundary loaded · list draft restored · disabled permission reason visible.</div>}
                <label><span>Group by</span><select defaultValue="status"><option>Status</option><option>Assignee</option><option>Priority</option></select></label>
                <label><span>Order by</span><select defaultValue="updated"><option value="updated">Updated time</option><option>Priority</option><option>Title</option></select></label>
                <label className="pt-switch-row"><input checked={showCompleted} type="checkbox" onChange={(event) => setShowCompleted(event.target.checked)} /> Show completed and canceled</label>
              </div>
            )}
          </header>

          <div className="pt-task-wide-container">
            {viewMode === 'list' ? (
              <section className="pt-task-list-page" aria-label="Task list">
                {inlineEntryOpen ? (
                  <article className="pt-task-inline-composer" aria-label="Create task inline entry">
                    <div className="pt-task-inline-editor">
                      <textarea defaultValue="Draft restored: watch arXiv daily, attach the workspace reading list, and ask before publishing follow-up tasks." aria-label="Task instruction draft" />
                      <div className="pt-task-inline-attachments">
                        <span><UploadCloud size={14} /> reading-list.md</span>
                        <span><FileText size={14} /> prior-summary.page</span>
                      </div>
                    </div>
                    <div className="pt-task-inline-controls">
                      <button type="button">High priority</button>
                      <button type="button">Research Agent</button>
                      <button type="button">Private</button>
                      <button className="is-disabled" type="button" aria-disabled="true">Public disabled</button>
                      <button className="primary" type="button">Create task</button>
                    </div>
                    <div className="pt-task-create-error" role="status">
                      <AlertTriangle size={15} />
                      <span>Create failed once; draft and attachments stay visible for retry.</span>
                    </div>
                  </article>
                ) : (
                  <button className="pt-task-inline-entry" type="button" onClick={() => setInlineEntryOpen(true)}><Plus size={15} /> Create a task from this workspace</button>
                )}
                {groupedTasks.map((group) => (
                  <section className="pt-task-group" key={group.group}>
                    <button className="pt-task-group-title" type="button"><ChevronDown size={14} /> {group.group}<span>{group.items.length}</span></button>
                    <div className="pt-task-list-block">
                      {group.items.map((task) => (
                        <div key={task.id} className="pt-task-row-wrap">
                          <button
                            className={`pt-task-row ${selectedTaskId === task.id ? 'selected' : ''}`}
                            type="button"
                            onClick={() => setSelectedTaskId(task.id)}
                          >
                            <span className={`pt-task-status status-${task.status.toLowerCase().replace(/\s+/g, '-')}`}>{task.status}</span>
                            <span className="pt-task-title"><strong>{task.id.toUpperCase()}</strong><b>{task.title}</b></span>
                            <span className="pt-task-meta">{task.priority}</span>
                            <span className="pt-task-meta">{task.schedule}</span>
                            <span className="pt-task-assignee">{task.assignee}</span>
                            <span className="pt-task-meta">{task.updated}</span>
                            <MoreHorizontal size={15} />
                          </button>
                          {contextMenuOpen && task.id === selectedTaskId && (
                            <div className="pt-task-context-menu" role="menu" aria-label="Task context menu">
                              {['Run now', 'Status: awaiting input', 'Priority: urgent', 'Copy ID', 'Copy link', 'Transfer to inbox', 'Delete'].map((item) => (
                                <button key={item} className={item === 'Delete' ? 'danger' : ''} type="button" role="menuitem">{item}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </section>
            ) : (
              <section className="pt-task-board" aria-label="Task board">
                {groupedTasks.map((group) => (
                  <div className="pt-task-board-column" key={group.group}>
                    <div><strong>{group.group}</strong><span>{group.items.length}</span></div>
                    {group.items.map((task) => (
                      <button key={task.id} className="pt-task-board-card" type="button" onClick={() => setSelectedTaskId(task.id)}>
                        <span className={`pt-task-status status-${task.status.toLowerCase().replace(/\s+/g, '-')}`}>{task.status}</span>
                        <strong>{task.title}</strong>
                        <small>{task.schedule} · {task.assignee}</small>
                      </button>
                    ))}
                  </div>
                ))}
              </section>
            )}

            <section className="pt-task-route-detail" aria-label="Task detail">
              <div className="pt-detail-top">
                <div>
                  <EvidenceChip>LIVE-067 / LIVE-136 / LIVE-148 / LIVE-156</EvidenceChip>
                  <p>Task detail</p>
                </div>
                <div className="pt-toolbar">
                  <button type="button">Copy link</button>
                  <button type="button" aria-expanded={scheduleOpen} onClick={() => setScheduleOpen((open) => !open)}><CalendarClock size={15} /> Schedule</button>
                  <button type="button" aria-expanded={topicDrawerOpen} onClick={() => setTopicDrawerOpen((open) => !open)}><MessageSquare size={15} /> Topic</button>
                  <button type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>
                </div>
              </div>
              {scheduleOpen && (
                <div className="pt-task-schedule-popover" role="dialog" aria-label="Task schedule config">
                  <div><strong>Automation</strong><span>Schedule mode · next run tomorrow 09:00</span></div>
                  <label>Pattern<select defaultValue="daily"><option value="daily">Every day</option><option value="weekday">Weekdays</option><option value="cron">Cron expression</option></select></label>
                  <label>Timezone<select defaultValue="Asia/Shanghai"><option>Asia/Shanghai</option><option>UTC</option></select></label>
                  <label>Max executions<input defaultValue="12" /></label>
                  <button type="button">Start schedule</button>
                </div>
              )}
              <h2>{selectedTask.title}</h2>
              <div className="pt-task-detail-summary">
                <span className={`pt-task-status status-${selectedTask.status.toLowerCase().replace(/\s+/g, '-')}`}>{selectedTask.status}</span>
                <span>{selectedTask.assignee}</span>
                <span>{selectedTask.priority} priority</span>
                <span>{selectedTask.schedule}</span>
              </div>
              <p>{selectedTask.meta}</p>
              {isDeepTasksReview && (
                <div className="pt-task-detail-editor-strip" aria-label="Task detail editable sections">
                  {['Title input', 'Parent task', 'Assignee/model', 'Run / pause', 'Properties'].map((item) => <span key={item}>{item}</span>)}
                </div>
              )}
              <div className="pt-task-detail-grid">
                <section><strong>Instruction</strong><p>Run the research loop, cite useful sources, and ask for missing scope before external tools continue.</p></section>
                <section><strong>Verification</strong><p>Require approval before web search and paper reading; keep every run attached to the source conversation.</p></section>
                <section><strong>Subtasks</strong><p>Search candidates · Read abstracts · Summarize novelty · Draft follow-up questions.</p></section>
                <section><strong>Artifacts</strong><p>Last result: paper digest page, saved as a workspace resource.</p></section>
                {isDeepTasksReview && <section><strong>Activities</strong><p>Operation #42 produced a topic drawer, two tool calls and one waiting approval event.</p></section>}
              </div>
              <div className="pt-task-history">
                <div><Clock3 size={15} /> Next scheduled run waits for the selected research field.</div>
                <div><MessageSquare size={15} /> Conversation drawer keeps comments and run replies near the task.</div>
                <div><CircleDashed size={15} /> Tool approval is unresolved until the user confirms external search.</div>
              </div>
              {confirmDelete && (
                <div className="pt-inline-dialog">
                  <strong>Delete task?</strong>
                  <p>This removes the task from the active list. Run history remains visible in the conversation.</p>
                  <div><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button><button className="danger" type="button" onClick={() => setConfirmDelete(false)}>Delete</button></div>
                </div>
              )}
            </section>
          </div>
        </main>

        <aside className={`pt-task-agent-panel ${isDeepTasksReview ? 'is-resizable' : ''}`} aria-label="Task agent manager">
          {isDeepTasksReview && <button className="pt-task-resize-handle" type="button" aria-label="Resize task agent panel" />}
          <div className="pt-task-agent-toolbar">
            <strong>Task agent</strong>
            <span>Research Agent</span>
          </div>
          {isDeepTasksReview && (
            <div className="pt-task-agent-actionbar" aria-label="Task agent compact controls">
              <button type="button">Research Agent</button>
              <button type="button">gpt-4.1</button>
              <button type="button"><Search size={14} /> Search</button>
              <button type="button"><UploadCloud size={14} /> Upload</button>
            </div>
          )}
          <div className="pt-task-agent-chat">
            <p className="assistant">I can run the next step after you approve web search.</p>
            <p className="user">Use the provider/model selected in Settings.</p>
            <p className="assistant">Acknowledged. The task remains paused until approval is granted.</p>
            {isDeepTasksReview && <p className="assistant">Uploaded file accepted. Search remains disabled until the task permission is granted.</p>}
          </div>
          <div className="pt-task-agent-input">
            <button type="button">Agent</button>
            <button type="button">Search</button>
            <textarea aria-label="Task agent message" placeholder="Reply to the task agent..." />
            <div><button type="button">Attach</button><button className="primary" type="button">Send</button></div>
          </div>
        </aside>
        {topicDrawerOpen && (
          <aside className="pt-task-topic-drawer" aria-label="Task topic drawer">
            <div className="pt-task-topic-head">
              <span className="pt-task-status status-awaiting-input">waiting</span>
              <strong>Operation #42 · arXiv daily picks</strong>
              <button type="button" onClick={() => setTopicDrawerOpen(false)}>Close</button>
            </div>
            <div className="pt-task-topic-actions">
              <button type="button"><Copy size={14} /> Copy topic ID</button>
              <button type="button"><Copy size={14} /> Copy operation ID</button>
              <button type="button"><Share2 size={14} /> Share</button>
            </div>
            <div className="pt-task-topic-chat">
              <p className="assistant">I searched candidate papers and need confirmation before reading abstracts.</p>
              <p className="user">Keep the run attached to this task and do not publish results yet.</p>
            </div>
            <div className="pt-task-topic-feedback">
              <textarea defaultValue="Continue after I approve the web search result list." aria-label="Topic drawer feedback" />
              <button type="button">Send feedback</button>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

function PagesSurface() {
  const initialState = reviewParam('state');
  const isDeepPagesReview = initialState === 'deep-pages';
  const isCompactPages = !isDeepPagesReview && initialState !== 'legacy-pages';
  const [actionsOpen, setActionsOpen] = useState(isDeepPagesReview || initialState === 'actions-open');
  const [drawerOpen, setDrawerOpen] = useState(isDeepPagesReview || initialState === 'all-pages');
  const [visibility, setVisibility] = useState<'private' | 'workspace'>('workspace');
  const pages = [
    { id: 'launch', title: 'Agent launch brief', visibility: 'workspace', updated: '2 min ago', words: '1.2k' },
    { id: 'notes', title: 'Meeting notes', visibility: 'private', updated: 'Today', words: '640' },
    { id: 'test', title: '这是一篇Test', visibility: 'workspace', updated: 'Yesterday', words: '420' },
    { id: 'runbook', title: 'Support runbook', visibility: 'private', updated: 'Jul 07', words: '2.4k' },
  ];
  const [selectedPageId, setSelectedPageId] = useState('test');
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const [pageState, setPageState] = useState('Choose an action to manage this page.');
  const [pageListMenuOpen, setPageListMenuOpen] = useState(isDeepPagesReview || initialState === 'page-menu');
  const [historyOpen, setHistoryOpen] = useState(isDeepPagesReview || initialState === 'history-open');
  const [compareOpen, setCompareOpen] = useState(isDeepPagesReview || initialState === 'compare-open');
  const [copilotOpen, setCopilotOpen] = useState(isDeepPagesReview || initialState === 'copilot-open');
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const stateRef = useRef<HTMLDivElement>(null);
  const closeActions = () => {
    setActionsOpen(false);
    actionsButtonRef.current?.focus();
  };
  const runPageAction = (message: string) => {
    setPageState(message);
    window.setTimeout(() => stateRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!actionsOpen) return;
    firstActionRef.current?.focus();
  }, [actionsOpen]);

  if (isCompactPages) {
    return (
      <section className="pt-pages-compact-shell" aria-label="LobeHub Pages compact baseline">
        <div className="pt-pages-layout is-compact-pages">
          <aside className="pt-pages-sidebar is-compact-pages" aria-label="Pages navigation">
            <div className="pt-pages-nav-header is-compact-pages">
              <strong>Pages</strong>
              <button type="button" aria-label="New page"><Plus size={15} /></button>
            </div>
            <button className="pt-pages-search is-compact-pages" type="button"><Search size={15} /> Search</button>
            {(['private', 'workspace'] as const).map((bucket) => {
              const bucketPages = pages.filter((page) => page.visibility === bucket);
              return (
                <div className="pt-pages-bucket is-compact-pages" key={bucket}>
                  <button className="pt-pages-bucket-title is-compact-pages" type="button" onClick={() => setVisibility(bucket)}>
                    <ChevronDown size={14} /> {bucket === 'private' ? 'Private' : 'Workspace'} {bucketPages.length}
                  </button>
                  {bucketPages.map((page) => (
                    <button
                      key={page.id}
                      className={`pt-page-row is-compact-pages ${selectedPageId === page.id ? 'selected' : ''}`}
                      type="button"
                      onClick={() => setSelectedPageId(page.id)}
                    >
                      <FileText size={15} />
                      <span><strong>{page.title}</strong><small>{page.updated} · {page.words} words</small></span>
                      {page.visibility === 'workspace' && <MoreHorizontal size={14} />}
                    </button>
                  ))}
                </div>
              );
            })}
          </aside>

          <main className="pt-page-explorer is-compact-pages" aria-label="Pages placeholder">
            <div className="pt-page-editor-header is-compact-pages">
              <div className="pt-page-header-left">
                <span>Pages</span>
                <strong>Create or import a page</strong>
                <small>Pick an action to start a document workspace.</small>
              </div>
              <div className="pt-toolbar is-compact-pages">
                <button type="button">Display 20</button>
                <button type="button" aria-label="Open all pages drawer"><FolderOpen size={15} /> All pages</button>
                <button ref={actionsButtonRef} type="button" onClick={() => setActionsOpen((open) => !open)}><MoreHorizontal size={15} /></button>
              </div>
            </div>

            {actionsOpen && (
              <div
                className="pt-inline-dialog pt-page-action-popover is-compact-pages"
                role="menu"
                aria-label="Page actions"
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  closeActions();
                }}
              >
                {['Version History', 'Copy', 'Export', 'Duplicate', 'Delete'].map((item, index) => (
                  <button
                    key={item}
                    ref={index === 0 ? firstActionRef : undefined}
                    className={item === 'Delete' ? 'danger' : ''}
                    type="button"
                    role="menuitem"
                    onClick={() => runPageAction(`${item} requested from compact Pages default.`)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}

            <section className="pt-pages-placeholder" aria-label="Pages placeholder actions">
              <div className="pt-pages-placeholder-copy">
                <strong>Pages</strong>
                <span>or</span>
              </div>
              <div className="pt-pages-action-cards">
                <button className="pt-pages-action-card create-new-document" type="button" onClick={() => runPageAction('New document requested from Pages placeholder.')}>
                  <span>New document</span>
                  <b><Plus size={24} /></b>
                </button>
                <button className="pt-pages-action-card upload-files" type="button" onClick={() => runPageAction('Upload accepts Markdown, PDF, and DOCX in the prototype boundary.')}>
                  <span>Upload files</span>
                  <b><UploadCloud size={24} /></b>
                </button>
                <button className="pt-pages-action-card import-notion" type="button" onClick={() => runPageAction('Notion import guide opened; ZIP import remains prototype-only.')}>
                  <span>Import Notion</span>
                  <b><Database size={24} /></b>
                </button>
              </div>
              <div ref={stateRef} className="pt-state-box is-compact-pages" tabIndex={-1}>{pageState}</div>
            </section>
          </main>
        </div>
      </section>
    );
  }

  return (
    <section className="pt-deep-shell">
      <SurfaceHeader owner="base-resource" title="Pages">
        Create, edit, organize, export, and reuse workspace pages from one document space.
      </SurfaceHeader>
      <div className={`pt-pages-layout ${isDeepPagesReview ? 'is-deep-pages' : ''}`}>
        <aside className="pt-pages-sidebar">
          <div className="pt-pages-nav-header">
            <strong>Pages</strong>
            <button type="button" aria-label="New page"><Plus size={15} /></button>
          </div>
          <button className="pt-pages-search" type="button"><Search size={15} /> Search pages</button>
          {isDeepPagesReview && (
            <div className="pt-pages-display-menu" role="menu" aria-label="Pages display menu">
              {['Display 20', 'Display 40', 'Display 60', 'Show pages not in library'].map((item, index) => (
                <button key={item} className={index === 1 ? 'is-active' : ''} type="button" role="menuitem">{item}</button>
              ))}
            </div>
          )}
          <div className="pt-pages-bucket">
            <button className="pt-pages-bucket-title" type="button" onClick={() => setVisibility('private')}><ChevronDown size={14} /> Private {pages.filter((page) => page.visibility === 'private').length}</button>
            {pages.filter((page) => page.visibility === 'private').map((page) => (
              <div key={page.id} className="pt-page-row-wrap">
                <button className={`pt-page-row ${selectedPageId === page.id ? 'selected' : ''}`} type="button" onClick={() => setSelectedPageId(page.id)}>
                  <FileText size={15} />
                  <span><strong>{page.title}</strong><small>{page.updated} · {page.words} words</small></span>
                </button>
              </div>
            ))}
          </div>
          <div className="pt-pages-bucket">
            <button className="pt-pages-bucket-title" type="button" onClick={() => setVisibility('workspace')}><ChevronDown size={14} /> Workspace {pages.filter((page) => page.visibility === 'workspace').length}</button>
            {pages.filter((page) => page.visibility === 'workspace').map((page) => (
              <div key={page.id} className="pt-page-row-wrap">
                <button className={`pt-page-row ${selectedPageId === page.id ? 'selected' : ''}`} type="button" onClick={() => setSelectedPageId(page.id)}>
                  <FileText size={15} />
                  <span><strong>{page.title}</strong><small>{page.updated} · {page.words} words</small></span>
                  <MoreHorizontal size={14} />
                </button>
                {pageListMenuOpen && page.id === selectedPageId && (
                  <div className="pt-page-list-menu" role="menu" aria-label="Page list item menu">
                    {['Open in new tab', 'Rename', 'Duplicate', 'Publish to workspace', 'Transfer to folder', 'Delete'].map((item) => (
                      <button key={item} className={item === 'Delete' ? 'danger' : ''} type="button" role="menuitem">{item}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <button className="pt-wide-button" type="button" onClick={() => setDrawerOpen((open) => !open)}>All pages drawer</button>
          {drawerOpen && (
            <div className="pt-all-pages-drawer" role="dialog" aria-label="All pages drawer">
              <div className="pt-pages-nav-header">
                <strong>All pages</strong>
                <button type="button" onClick={() => setDrawerOpen(false)}>Close</button>
              </div>
              <button className="pt-pages-search" type="button"><Search size={15} /> Search private and workspace pages</button>
              <div className="pt-page-drawer-list">
                {pages.map((page) => (
                  <button key={page.id} className={page.id === selectedPageId ? 'selected' : ''} type="button" onClick={() => setSelectedPageId(page.id)}>
                    <span><strong>{page.title}</strong><small>{page.visibility} · {page.updated}</small></span>
                    <FileText size={14} />
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="pt-state-box warning">Recently changed pages may take a moment to refresh before the list settles.</div>
        </aside>
        <main className="pt-page-explorer">
          <div className="pt-page-editor-header">
            <EvidenceChip>LIVE-032 / LIVE-064 / LIVE-138 / LIVE-151</EvidenceChip>
            <div>
              <span>{selectedPage.visibility === 'workspace' ? 'Workspace page' : 'Private page'}</span>
              <h2>{selectedPage.title}</h2>
            </div>
            <div className="pt-toolbar">
              <button type="button">Share</button>
              <button type="button" aria-expanded={copilotOpen} onClick={() => setCopilotOpen((open) => !open)}><PanelRightClose size={15} /> Page Agent</button>
              <button ref={actionsButtonRef} type="button" onClick={() => setActionsOpen((open) => !open)}><MoreHorizontal size={15} /> Actions</button>
            </div>
          </div>
          {isDeepPagesReview && (
            <div className="pt-page-lock-stack" aria-label="Page lock and autosave state">
              <div className="pt-page-lock-banner info"><Clock3 size={15} /><span><strong>Autosaved 18s ago</strong><small>Editor scroll position and current block selection were preserved.</small></span></div>
              <div className="pt-page-lock-banner warning"><AlertTriangle size={15} /><span><strong>Editing lock reconnecting</strong><small>Copilot send stays available, but page write actions wait for the lock heartbeat.</small></span></div>
            </div>
          )}
          {actionsOpen && (
            <div
              className="pt-inline-dialog pt-page-action-popover"
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                closeActions();
              }}
            >
              <strong>Page actions</strong>
              <div className="pt-toolbar">
                <button ref={firstActionRef} type="button" onClick={() => { setHistoryOpen(true); runPageAction('Version history opened. Select a saved version to review or restore it.'); }}>Version History</button>
                <button type="button" onClick={() => runPageAction('Page link copied for reuse in an agent thread.')}>Copy</button>
                <button type="button" onClick={() => runPageAction('Export started. Keep this page open until the file is ready.')}>Export</button>
                <button type="button" onClick={() => runPageAction('Duplicate requested. The new page will appear after the list refreshes.')}>Duplicate</button>
                <button type="button" onClick={() => runPageAction('Publish requested. Visibility remains pending until workspace confirmation returns.')}>Publish</button>
                <button className="danger" type="button" onClick={() => runPageAction('Delete confirmation opened. Deleting removes the page from the workspace library.')}>Delete</button>
              </div>
            </div>
          )}
          <div className="pt-page-title-row">
            <button type="button" aria-label="Page icon"><FileText size={20} /></button>
            <input aria-label="Page title" value={selectedPage.title} readOnly />
          </div>
          <div className="pt-editor-canvas">
            <p>Draft notes, keep generated content, and attach this page back to any agent conversation when it becomes useful context.</p>
            {isDeepPagesReview && (
              <div className="pt-page-meta-bar" aria-label="Page editor meta bar">
                {['Workspace page', '6 blocks', '4 resources', 'Saved by Lobe AI', 'Wide screen'].map((item) => <span key={item}>{item}</span>)}
              </div>
            )}
            <div className="pt-page-block"><strong>Agent summary</strong><span>The page can be referenced by chat, resources, and knowledge workflows once it is saved.</span></div>
            <div className="pt-page-block"><strong>Open questions</strong><span>Confirm whether this page should stay private or move into the workspace library.</span></div>
            {isDeepPagesReview && (
              <div className="pt-page-editor-rich-blocks" aria-label="Page editor rich blocks">
                <div><strong>Ask Copilot</strong><span>Continue this paragraph with a concise research summary.</span></div>
                <div><strong>Table block</strong><span>Owner · Status · Next action · Source</span></div>
                <div><strong>Callout</strong><span>Keep publish disabled until workspace visibility is confirmed.</span></div>
              </div>
            )}
            <div className="pt-toolbar"><button type="button">Version History</button><button type="button">Copy</button><button type="button">Export</button><button className="danger" type="button">Delete</button></div>
            <div ref={stateRef} className="pt-state-box" tabIndex={-1}>{pageState}</div>
          </div>
          {historyOpen && (
            <aside className="pt-page-history-panel" aria-label="Page history panel">
              <div className="pt-pages-nav-header">
                <strong>Version history</strong>
                <button type="button" onClick={() => setHistoryOpen(false)}>Close</button>
              </div>
              <div className="pt-page-history-list">
                {['Current autosave · 18s ago', 'Manual save · 10:14', 'Copilot edit · Yesterday'].map((item, index) => (
                  <button key={item} className={index === 1 ? 'selected' : ''} type="button" onClick={() => setCompareOpen(true)}>
                    <Clock3 size={14} />
                    <span>{item}</span>
                    <small>{index === 0 ? 'current' : 'compare'}</small>
                  </button>
                ))}
              </div>
              <div className="pt-page-history-actions">
                <button type="button" onClick={() => setCompareOpen(true)}>Compare</button>
                <button type="button">Restore</button>
              </div>
            </aside>
          )}
          {compareOpen && (
            <div className="pt-page-compare-modal" role="dialog" aria-label="Page history compare modal">
              <div className="pt-pages-nav-header">
                <strong>Compare history</strong>
                <button type="button" onClick={() => setCompareOpen(false)}>Close</button>
              </div>
              <div className="pt-page-compare-grid">
                <section><strong>Before</strong><p>Draft notes without resource citations.</p></section>
                <section><strong>After</strong><p>Added resource citations and next action table.</p></section>
              </div>
              <div className="pt-page-history-actions"><button type="button">Restore this version</button><button type="button">Keep current</button></div>
            </div>
          )}
          {copilotOpen && <button className="pt-page-agent-resize" type="button" aria-label="Resize page agent panel" />}
          <aside className={`pt-page-agent-panel ${copilotOpen ? 'is-open' : ''}`} aria-label="Page copilot panel">
            <strong>Page Agent</strong>
            <p>Ask an agent to summarize, continue writing, transform into a resource, or attach this page to the current thread.</p>
            {isDeepPagesReview && (
              <div className="pt-page-copilot-topics" aria-label="Page copilot topics">
                {['Continue writing', 'Compare history', 'Attach resources'].map((topic, index) => (
                  <button key={topic} className={index === 0 ? 'is-active' : ''} type="button">{topic}</button>
                ))}
              </div>
            )}
            {isDeepPagesReview && <div className="pt-page-copilot-chat"><p className="assistant">I can continue from the selected block after the lock heartbeat recovers.</p><p className="user">Summarize the resource citations first.</p></div>}
            <button type="button"><Sparkles size={15} /> Summarize</button>
            <button type="button"><Copy size={15} /> Attach to chat</button>
            {isDeepPagesReview && <div className="pt-page-copilot-composer" aria-label="Page copilot composer"><textarea defaultValue="Continue writing from the Agent summary block." /><button type="button">Send</button></div>}
          </aside>
        </main>
      </div>
    </section>
  );
}

function ResourcesSurface() {
  const initialState = reviewParam('state');
  const isDeepResourceReview = initialState === 'deep-resource';
  const isCompactResources = initialState === '' || initialState === 'compact-resources';
  const initialDrawerOpen = initialState === 'file-drawer' || reviewParam('drawer') === '1';
  const [addOpen, setAddOpen] = useState(initialState === 'add-upload' || initialState === 'add-import');
  const [batchOpen, setBatchOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(initialState === 'search-open' || isDeepResourceReview);
  const [drawerOpen, setDrawerOpen] = useState(initialDrawerOpen || isDeepResourceReview);
  const [actionMenuOpen, setActionMenuOpen] = useState(isDeepResourceReview || reviewParam('actions') === '1');
  const [chunkDrawerOpen, setChunkDrawerOpen] = useState(isDeepResourceReview || reviewParam('chunk') === '1');
  const [uploadDockOpen, setUploadDockOpen] = useState(isDeepResourceReview || reviewParam('uploadDock') === '1');
  const [dragActive, setDragActive] = useState(isDeepResourceReview || reviewParam('drag') === '1');
  const [viewMode, setViewMode] = useState<'list' | 'masonry'>('list');
  const [visibility, setVisibility] = useState<'private' | 'workspace'>('workspace');
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const resources = [
    { name: 'generated-image.png', type: 'Image', size: '1.8 MB', chunks: 'No chunks', embedding: 'ready', source: 'Image generation output', updated: 'Today 10:42', uploader: 'S', path: '/Workspace/Creative' },
    { name: 'meeting-audio.mp3', type: 'Audio', size: '12.4 MB', chunks: '18 chunks', embedding: 'processing', source: 'Audio note from chat', updated: 'Yesterday 19:08', uploader: 'J', path: '/Workspace/Meetings' },
    { name: '这是一篇Test', type: 'Page', size: '4 KB', chunks: '6 chunks', embedding: 'ready', source: 'Page resource', updated: 'Jul 06', uploader: 'S', path: '/Private/Pages' },
    { name: 'workspace-brief.pdf', type: 'Document', size: '890 KB', chunks: '24 chunks', embedding: 'failed', source: 'Uploaded document', updated: 'Jul 05', uploader: 'M', path: '/Workspace/Docs' },
  ];
  const [selectedName, setSelectedName] = useState(resources[1].name);
  const [preview, setPreview] = useState(
    initialState === 'add-upload'
      ? 'Choose files or folders to upload into the resource library.'
      : initialState === 'add-import'
        ? 'Paste a URL or Notion source to import and index it as a resource.'
        : 'meeting-audio.mp3 is selected. Preview metadata, chunks, and embedding status before attaching it to an agent thread.',
  );
  const selectedResource = resources.find((resource) => resource.name === selectedName) ?? resources[0];
  const selectResource = (name: string, meta: string) => {
    setSelectedName(name);
    setPreview(`${name} is selected. ${meta}`);
    setDrawerOpen(true);
  };
  const openResourceActions = (name: string, meta: string) => {
    selectResource(name, meta);
    setActionMenuOpen(true);
  };
  const closeAddMenu = () => {
    setAddOpen(false);
    addButtonRef.current?.focus();
  };

  useEffect(() => {
    if (!addOpen) return;
    uploadButtonRef.current?.focus();
  }, [addOpen]);

  if (isCompactResources) {
    return (
      <section className="pt-resource-compact-shell" aria-label="LobeHub Resources compact baseline">
        <div className="pt-resource-layout is-compact-resources">
          <aside className="pt-resource-sidebar is-compact-resources" aria-label="Resource navigation">
            <div className="pt-resource-sidebar-header is-compact-resources">
              <strong>Resource</strong>
              <button type="button" aria-label="Add resource" onClick={() => setAddOpen((open) => !open)}><Plus size={15} /></button>
            </div>
            <div className="pt-segmented is-compact-resources" role="tablist" aria-label="Resource visibility">
              <button className={visibility === 'private' ? 'is-active' : ''} type="button" onClick={() => setVisibility('private')}>Private</button>
              <button className={visibility === 'workspace' ? 'is-active' : ''} type="button" onClick={() => setVisibility('workspace')}>Workspace</button>
            </div>
            <button className="pt-resource-search is-compact-resources" type="button" onClick={() => setSearchOpen((open) => !open)}>
              <Search size={15} /> Search resources
            </button>
            <div className="pt-resource-categories is-compact-resources" aria-label="Resource categories">
              {['All', 'Documents', 'Images', 'Audios', 'Videos'].map((category, index) => (
                <button key={category} className={index === 0 ? 'is-active' : ''} type="button">{category}</button>
              ))}
            </div>
            <div className="pt-resource-hierarchy is-compact-resources" aria-label="Knowledge base list">
              <div className="pt-hierarchy-head">
                <strong>Knowledge bases</strong>
                <button type="button" aria-label="Create folder"><Plus size={13} /></button>
              </div>
              {[
                { active: true, meta: '4 files', name: 'Workspace library' },
                { active: false, meta: 'meeting-audio.mp3', name: 'Meetings' },
                { active: false, meta: 'generated-image.png', name: 'Creative' },
                { active: false, meta: 'workspace-brief.pdf', name: 'Docs' },
              ].map((item) => (
                <button key={item.name} className={item.active ? 'is-active' : ''} type="button">
                  <FolderOpen size={14} />
                  <span><strong>{item.name}</strong><small>{item.meta}</small></span>
                </button>
              ))}
            </div>
          </aside>

          <main className="pt-resource-explorer is-compact-resources" aria-label="Resource explorer">
            <header className="pt-resource-header is-compact-resources">
              <div>
                <strong>{visibility === 'workspace' ? 'Workspace resources' : 'Private resources'}</strong>
                <span>All resources · list view · newest first</span>
              </div>
              <div className="pt-toolbar is-compact-resources">
                <button type="button" onClick={() => setSearchOpen((open) => !open)}><Search size={14} /> Search</button>
                <button type="button">Sort</button>
                <button type="button">Batch</button>
                <button className={viewMode === 'list' ? 'is-active' : ''} type="button" onClick={() => setViewMode('list')}>List</button>
                <button className={viewMode === 'masonry' ? 'is-active' : ''} type="button" onClick={() => setViewMode('masonry')}>Masonry</button>
                <button ref={addButtonRef} type="button" aria-expanded={addOpen} onClick={() => setAddOpen((open) => !open)}><Plus size={14} /> Add</button>
              </div>
            </header>

            {addOpen && (
              <div
                className="pt-inline-dialog pt-resource-add-menu is-compact-resources"
                role="menu"
                aria-label="Add resource"
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  closeAddMenu();
                }}
              >
                <button ref={uploadButtonRef} type="button" role="menuitem"><UploadCloud size={14} /> Upload file</button>
                <button type="button" role="menuitem"><FolderOpen size={14} /> Upload folder</button>
                <button type="button" role="menuitem"><FileText size={14} /> New page</button>
                <button type="button" role="menuitem"><Database size={14} /> Import source</button>
              </div>
            )}

            {searchOpen && (
              <section className="pt-resource-search-overlay is-compact-resources" aria-label="Resource search results">
                <div className="pt-resource-search-head">
                  <div>
                    <strong>Search resources</strong>
                    <span>Overlay stays attached to Resource explorer without opening file detail.</span>
                  </div>
                  <button type="button" onClick={() => setSearchOpen(false)}>Close</button>
                </div>
                <div className="pt-resource-table-head is-compact-resources">
                  <span>Name</span><span>Type</span><span>Updated</span><span>Size</span>
                </div>
                {resources.filter((resource) => resource.name.includes('mp3') || resource.type === 'Audio').map((resource) => (
                  <button key={resource.name} className="pt-resource-row table-row is-compact-resources selected" type="button">
                    <Library size={16} />
                    <span><strong>{resource.name}</strong><small>{resource.path}</small></span>
                    <small>{resource.type}</small>
                    <small>{resource.updated}</small>
                    <small>{resource.size}</small>
                  </button>
                ))}
              </section>
            )}

            <section className={`pt-resource-list is-compact-resources view-${viewMode}`} aria-label="Resource list">
              {viewMode === 'list' && (
                <div className="pt-resource-table-head is-compact-resources">
                  <span>Name</span><span>Type</span><span>Updated</span><span>Size</span>
                </div>
              )}
              {resources.map((resource) => (
                <button
                  key={resource.name}
                  className={`pt-resource-row is-compact-resources ${viewMode === 'list' ? 'table-row' : ''} ${selectedName === resource.name ? 'selected' : ''}`}
                  type="button"
                  onClick={() => {
                    setSelectedName(resource.name);
                    setPreview(`${resource.name} selected in compact explorer.`);
                  }}
                >
                  <Library size={18} />
                  <span><strong>{resource.name}</strong><small>{resource.source}</small></span>
                  <small>{resource.type}</small>
                  {viewMode === 'list' && <small>{resource.updated}</small>}
                  <small>{resource.size}</small>
                  <span className="pt-resource-row-actions" aria-hidden="true"><MoreHorizontal size={15} /></span>
                </button>
              ))}
            </section>
            <div className="pt-state-box is-compact-resources" aria-label="Resource compact selection state">{preview}</div>
          </main>
        </div>
      </section>
    );
  }

  return (
    <section className="pt-deep-shell">
      <SurfaceHeader owner="base-resource" title="Resources">
        Browse files, pages, generated images, and workspace assets that can be attached to an agent thread.
      </SurfaceHeader>
      <div className="pt-resource-layout">
        <aside className="pt-deep-sidebar">
          <div className="pt-segmented" role="tablist" aria-label="Resource visibility">
            <button className={visibility === 'private' ? 'is-active' : ''} type="button" onClick={() => setVisibility('private')}>Private</button>
            <button className={visibility === 'workspace' ? 'is-active' : ''} type="button" onClick={() => setVisibility('workspace')}>Workspace</button>
          </div>
          <button ref={addButtonRef} className="pt-wide-button primary" type="button" onClick={() => setAddOpen((open) => !open)}><Plus size={15} /> Add</button>
          {addOpen && (
            <div
              className="pt-inline-dialog"
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                closeAddMenu();
              }}
            >
              <strong>Add resource</strong>
              <button ref={uploadButtonRef} type="button" onClick={() => setPreview('Choose files to upload into the current resource scope.')}>Upload file</button>
              <button type="button" onClick={() => setPreview('Choose a folder and preserve its hierarchy in the library.')}>Upload folder</button>
              <button type="button" onClick={() => setPreview('Create a page resource and open the page editor overlay.')}>New page</button>
              <button type="button" onClick={() => setPreview('Paste a Notion or URL source to import and index it as a resource.')}>Import source</button>
            </div>
          )}
          <button className="pt-wide-button" type="button" onClick={() => setBatchOpen((open) => !open)}>Batch actions</button>
          {batchOpen && <div className="pt-state-box warning">Select resources before running a batch action.</div>}
          <button className="pt-search-input as-button" type="button" aria-expanded={searchOpen} onClick={() => setSearchOpen((open) => !open)}>
            <Search size={14} /> mp3
          </button>
          <div className="pt-resource-categories">
            {['All', 'Documents', 'Images', 'Audio', 'Videos', 'Pages'].map((category, index) => (
              <button key={category} className={index === 0 ? 'is-active' : ''} type="button">{category}</button>
            ))}
          </div>
          <div className="pt-resource-hierarchy" aria-label="Library hierarchy">
            <div className="pt-hierarchy-head">
              <strong>Knowledge library</strong>
              <button type="button" aria-label="Create folder"><Plus size={13} /></button>
            </div>
            {[
              { active: true, meta: '3 folders', name: 'Workspace library' },
              { active: false, meta: 'meeting-audio.mp3', name: 'Meetings' },
              { active: false, meta: 'generated-image.png', name: 'Creative' },
              { active: false, meta: 'workspace-brief.pdf', name: 'Docs' },
            ].map((item) => (
              <button key={item.name} className={item.active ? 'is-active' : ''} type="button">
                <FolderOpen size={14} />
                <span><strong>{item.name}</strong><small>{item.meta}</small></span>
              </button>
            ))}
          </div>
          <div className="pt-state-box">Search by name, file type, visibility, folder path, or conversation relation.</div>
        </aside>
        <main className="pt-resource-board">
          {dragActive && (
            <div className="pt-resource-drag-overlay" aria-label="Resource drag upload overlay">
              <UploadCloud size={28} />
              <strong>Drop files into Workspace library</strong>
              <span>Root drop target keeps the explorer active while uploads enter the dock.</span>
              <button type="button" onClick={() => setDragActive(false)}>Dismiss</button>
            </div>
          )}
          <div className="pt-resource-header">
            <div>
              <strong>{visibility === 'workspace' ? 'Workspace resources' : 'Private resources'}</strong>
              <span>All files · newest first · drag files here to upload</span>
            </div>
            <div className="pt-toolbar">
              <button type="button" onClick={() => setSearchOpen((open) => !open)}><Search size={14} /> Search</button>
              <button className={viewMode === 'list' ? 'is-active' : ''} type="button" onClick={() => setViewMode('list')}>List</button>
              <button className={viewMode === 'masonry' ? 'is-active' : ''} type="button" onClick={() => setViewMode('masonry')}>Masonry</button>
              <button type="button">Sort</button>
            </div>
          </div>
          {searchOpen && (
            <section className="pt-resource-search-overlay" aria-label="Resource search results">
              <div className="pt-resource-search-head">
                <div>
                  <strong>Search results for “mp3”</strong>
                  <span>Scoped to {visibility === 'workspace' ? 'workspace resources' : 'private resources'} · list overlay keeps explorer state alive</span>
                </div>
                <button type="button" onClick={() => setSearchOpen(false)}>Close</button>
              </div>
              <div className="pt-resource-table-head">
                <span>Name</span><span>Type</span><span>Updated</span><span>Size</span>
              </div>
              {resources.filter((resource) => resource.name.includes('mp3') || resource.type === 'Audio').map((resource) => (
                <button
                  key={resource.name}
                  className="pt-resource-row table-row selected"
                  type="button"
                  onClick={() => selectResource(resource.name, `${resource.source}. ${resource.embedding} embedding status.`)}
                >
                  <Library size={16} />
                  <span><strong>{resource.name}</strong><small>{resource.path}</small></span>
                  <small>{resource.type}</small>
                  <small>{resource.updated}</small>
                  <small>{resource.size}</small>
                </button>
              ))}
            </section>
          )}
          <div className={`pt-resource-list view-${viewMode}`}>
            {viewMode === 'list' && (
              <div className="pt-resource-table-head">
                <span>Name</span><span>Type</span><span>Updated</span><span>Size</span>
              </div>
            )}
            {resources.map((resource) => (
              <button
                key={resource.name}
                className={`pt-resource-row ${viewMode === 'list' ? 'table-row' : ''} ${selectedName === resource.name ? 'selected' : ''}`}
                type="button"
                onClick={() => selectResource(resource.name, `${resource.source}. ${resource.embedding} embedding status.`)}
              >
                <Library size={18} />
                <span><strong>{resource.name}</strong><small>{resource.source}</small></span>
                <small>{resource.type}</small>
                {viewMode === 'list' && <small>{resource.updated}</small>}
                <small>{resource.size}</small>
                <span className="pt-resource-row-actions" aria-hidden="true"><MoreHorizontal size={15} /></span>
              </button>
            ))}
          </div>
          <div className="pt-preview-panel resource-detail">
            <div className="pt-detail-top">
              <h3>{selectedResource.name}</h3>
              <div className="pt-toolbar">
                <button type="button">Open</button>
                <button type="button" onClick={() => setChunkDrawerOpen(true)}>Chunks</button>
                <button type="button">Download</button>
                <button type="button" aria-expanded={actionMenuOpen} onClick={() => openResourceActions(selectedResource.name, `${selectedResource.source}. ${selectedResource.embedding} embedding status.`)}><MoreHorizontal size={14} /> More</button>
              </div>
            </div>
            <p>{preview}</p>
            <dl className="pt-resource-metadata">
              <div><dt>Type</dt><dd>{selectedResource.type}</dd></div>
              <div><dt>Size</dt><dd>{selectedResource.size}</dd></div>
              <div><dt>Chunks</dt><dd>{selectedResource.chunks}</dd></div>
              <div><dt>Embedding</dt><dd>{selectedResource.embedding}</dd></div>
            </dl>
            <div className="pt-state-box warning">Upload dock: 2 files waiting, 1 embedding task processing, failed items stay visible with retry.</div>
            {actionMenuOpen && (
              <div className="pt-resource-action-menu" aria-label="Resource item actions">
                <strong>{selectedResource.name}</strong>
                <button type="button"><FolderOpen size={14} /> Add to knowledge library</button>
                <button type="button"><FolderOpen size={14} /> Move to folder</button>
                <button type="button"><Copy size={14} /> Copy URL</button>
                <button type="button"><RefreshCw size={14} /> Re-parse chunks</button>
                <button type="button"><Trash2 size={14} /> Delete resource</button>
                <button type="button" onClick={() => setActionMenuOpen(false)}>Close menu</button>
              </div>
            )}
          </div>
          {drawerOpen && (
            <aside className="pt-resource-drawer" aria-label="Resource file drawer">
              <div className="pt-detail-top">
                <div>
                  <strong>{selectedResource.name}</strong>
                  <span>{selectedResource.path}</span>
                </div>
                <button type="button" onClick={() => setDrawerOpen(false)}>Close</button>
              </div>
              <div className="pt-resource-file-preview">
                <Library size={26} />
                <span>{selectedResource.type} preview</span>
              </div>
              <dl className="pt-resource-metadata">
                <div><dt>Updated</dt><dd>{selectedResource.updated}</dd></div>
                <div><dt>Uploader</dt><dd>{selectedResource.uploader}</dd></div>
                <div><dt>Chunks</dt><dd>{selectedResource.chunks}</dd></div>
                <div><dt>Embedding</dt><dd>{selectedResource.embedding}</dd></div>
              </dl>
              <div className="pt-state-box">Chunk drawer preview: parsed segments, retry state and attach-to-agent actions stay visible without leaving the explorer.</div>
            </aside>
          )}
          {chunkDrawerOpen && (
            <aside className="pt-resource-chunk-drawer" aria-label="Resource chunk drawer">
              <div className="pt-detail-top">
                <div>
                  <strong>{selectedResource.name} chunks</strong>
                  <span>File viewer + chunk content split, mirroring ResourceManager ChunkDrawer.</span>
                </div>
                <button type="button" onClick={() => setChunkDrawerOpen(false)}>Close</button>
              </div>
              <div className="pt-chunk-drawer-body">
                <section>
                  <Library size={22} />
                  <strong>{selectedResource.type} viewer</strong>
                  <span>Preview stays scrollable while chunk metadata remains visible.</span>
                </section>
                <section>
                  {['00:00 Introduction', '02:14 Action items', '07:36 Follow-up risks'].map((chunk) => (
                    <button key={chunk} type="button">
                      <span>{chunk}</span>
                      <small>ready · attach to agent context</small>
                    </button>
                  ))}
                  <div className="pt-state-box warning">One segment is retryable because embedding is still processing.</div>
                </section>
              </div>
            </aside>
          )}
        </main>
      </div>
      {uploadDockOpen && (
        <aside className="pt-upload-dock" aria-label="Resource upload dock">
          <div className="pt-upload-dock-head">
            <strong>Uploading · 3 files</strong>
            <button type="button" onClick={() => setUploadDockOpen(false)}>Close</button>
          </div>
          <div className="pt-upload-progress"><span /></div>
          {[
            ['meeting-notes.md', 'uploading · 68%'],
            ['brief-assets.zip', 'pending · folder hierarchy preserved'],
            ['broken-scan.pdf', 'failed · retry available'],
          ].map(([name, status]) => (
            <div key={name} className="pt-upload-dock-item">
              <FileText size={15} />
              <span><strong>{name}</strong><small>{status}</small></span>
              <button type="button">Cancel</button>
            </div>
          ))}
        </aside>
      )}
    </section>
  );
}

function MemorySurface() {
  const tabs = [
    { icon: BrainCircuit, key: 'Home', label: 'Home' },
    { icon: Signature, key: 'Identities', label: 'Identities' },
    { icon: Bubbles, key: 'Contexts', label: 'Contexts' },
    { icon: HeartPulse, key: 'Preferences', label: 'Preferences' },
    { icon: Lightbulb, key: 'Experiences', label: 'Experiences' },
    { icon: CalendarClock, key: 'Activities', label: 'Activities' },
  ];
  const initialTab = reviewParam('tab');
  const memoryState = reviewParam('state');
  const isDeepMemoryReview = memoryState === 'deep-memory';
  const isCompactMemory = (memoryState === '' || memoryState === 'compact-memory') && initialTab === '';
  const [tab, setTab] = useState(tabs.some((item) => item.key === initialTab) ? initialTab : 'Preferences');
  const [viewMode, setViewMode] = useState<'timeline' | 'grid'>(reviewParam('view') === 'grid' ? 'grid' : 'timeline');
  const [analysisOpen, setAnalysisOpen] = useState(memoryState === 'analysis-open' || isDeepMemoryReview);
  const [detailMenuOpen, setDetailMenuOpen] = useState(isDeepMemoryReview || reviewParam('detailMenu') === '1');
  const [editOpen, setEditOpen] = useState(isDeepMemoryReview || memoryState === 'edit-memory');
  const [detailState, setDetailState] = useState<'ready' | 'loading' | 'missing'>(
    memoryState === 'detail-loading' ? 'loading' : memoryState === 'detail-missing' ? 'missing' : 'ready',
  );
  const memories = [
    {
      id: 'tone',
      title: 'Prefers direct engineering status reports',
      body: 'Use Plan Source, Scope Completed, Evidence, Not Completed and Claim when reporting progress.',
      cate: 'Preference',
      score: '92%',
      time: 'Today',
      tags: ['reporting', 'evidence'],
    },
    {
      id: 'architecture',
      title: 'Keeps product work paused before Owner confirmation',
      body: 'Prototype must return to pending-review and receive Owner confirmation before implementation work starts.',
      cate: 'Context',
      score: '88%',
      time: 'Yesterday',
      tags: ['PLAN-P5', 'prototype'],
    },
    {
      id: 'identity',
      title: 'Agent work should follow Peers Station/Desktop ownership',
      body: 'Station owns business truth, Desktop owns projection, Model/proto owns shared API semantics.',
      cate: 'Identity',
      score: '84%',
      time: 'Jul 07',
      tags: ['station', 'desktop'],
    },
  ];
  const [selectedMemoryId, setSelectedMemoryId] = useState(memories[0].id);
  const selectedMemory = memories.find((memory) => memory.id === selectedMemoryId) ?? memories[0];
  const showMainLoading = memoryState === 'memory-loading';
  const showMainError = memoryState === 'memory-error';

  if (isCompactMemory) {
    return (
      <section className="pt-memory-compact-shell" aria-label="LobeHub Memory compact baseline">
        <div className="pt-memory-layout is-compact-memory">
          <aside className="pt-memory-nav is-compact-memory" aria-label="Memory navigation">
            <div className="pt-memory-sidebar-title">
              <strong>Memory</strong>
            </div>
            <button className="pt-memory-search is-compact-memory" type="button">
              <Search size={15} /> Search
            </button>
            {tabs.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.key}
                  className={item.key === 'Home' ? 'is-active' : ''}
                  type="button"
                  onClick={() => setTab(item.key)}
                >
                  <Icon size={15} /> {item.label}
                </button>
              );
            })}
          </aside>

          <main className="pt-memory-home is-compact-memory" aria-label="Memory home shell">
            <header className="pt-memory-home-header is-compact-memory">
              <div>
                <strong>Persona</strong>
                <span>Home memory · persona and role tags</span>
              </div>
              <div className="pt-toolbar is-compact-memory">
                <button type="button">Purge</button>
                <button type="button" onClick={() => setAnalysisOpen(true)}>Analyze</button>
                <button type="button">Wide</button>
              </div>
            </header>
            <section className="pt-memory-home-scroll" aria-label="Memory home scroll container">
              <div className="pt-memory-async-boundary" aria-label="Memory home data boundary">
              <section className="pt-role-cloud is-compact-memory" aria-label="Role tag cloud">
                {[
                  'Agent parity',
                  'LobeHub fidelity',
                  'Evidence chain',
                  'Prototype gate',
                  'Station ownership',
                  'Quiet protocol',
                  'Owner review',
                  'Source-backed',
                ].map((item) => <span key={item}>{item}</span>)}
              </section>
              <section className="pt-persona-panel is-compact-memory" aria-label="Persona">
                <h1>Persona</h1>
                <blockquote>
                  Prefers direct engineering status reports with Plan Source, Scope Completed, Evidence, Not Completed and Claim.
                </blockquote>
                <div className="pt-persona-detail" aria-label="Persona detail">
                  <p>The user expects source-backed prototype parity work, high-fidelity side-by-side review, and explicit fail-closed product migration gates.</p>
                  <p>When the prototype diverges from LobeHub, revise the surface with L1 source anchors, L2 screenshots and L3 DOM proof before asking for Owner judgment.</p>
                </div>
              </section>
              <section className="pt-memory-home-empty" aria-label="Memory empty and recovery states">
                <BrainCircuit size={18} />
                <span><strong>Analysis can refresh persona and role tags</strong><small>Default Home keeps analysis as an action, not an always-open modal.</small></span>
              </section>
              </div>
            </section>
          </main>
        </div>
      </section>
    );
  }

  return (
    <section className="pt-deep-shell">
      <SurfaceHeader owner="agent-domain" title="Memory">
        Review what the agent remembers, how memories were created, and which memories are currently unavailable.
      </SurfaceHeader>
      <div className="pt-memory-layout">
        <aside className="pt-memory-nav">
          <button className="pt-memory-search" type="button"><Search size={15} /> Search memories</button>
          {tabs.map((item) => {
            const Icon = item.icon;
            return (
            <button key={item.key} className={tab === item.key ? 'is-active' : ''} type="button" onClick={() => setTab(item.key)}>
              <Icon size={15} /> {item.label}
            </button>
            );
          })}
        </aside>
        <main className="pt-memory-main">
          <EvidenceChip>LIVE-040..LIVE-050 / LIVE-146</EvidenceChip>
          <div className="pt-memory-header">
            <div>
              <strong>{tab}</strong>
              <span>{memories.length} memories · NavHeader count tag · sorted by captured time</span>
            </div>
            <div className="pt-toolbar">
              <button type="button" onClick={() => setAnalysisOpen(true)}>Analyze</button>
              <button type="button">Purge</button>
              <button className={viewMode === 'timeline' ? 'is-active' : ''} type="button" onClick={() => setViewMode('timeline')}>Timeline</button>
              <button className={viewMode === 'grid' ? 'is-active' : ''} type="button" onClick={() => setViewMode('grid')}>Grid</button>
              <button type="button">Wide</button>
            </div>
          </div>
          <div className="pt-memory-filter">
            <input className="pt-search-input" defaultValue="owner confirmation" aria-label="Memory search" />
            <button className="is-active" type="button">Captured time</button>
            <button type="button">Score priority</button>
          </div>
          {tab === 'Home' && (
            <div className="pt-role-cloud" aria-label="Memory role tags">
              {['Agent parity', 'LobeHub fidelity', 'Evidence chain', 'Prototype gate'].map((item) => <span key={item}>{item}</span>)}
            </div>
          )}
          {showMainError && (
            <div className="pt-memory-error-state" role="alert">
              <AlertTriangle size={20} />
              <span><strong>Memory list failed to load</strong><small>AsyncBoundary keeps the query and retry action visible instead of showing an empty list.</small></span>
              <button type="button">Retry</button>
            </div>
          )}
          {showMainLoading ? (
            <div className={`pt-memory-loading ${viewMode}`} aria-label="Memory loading skeleton">
              {Array.from({ length: viewMode === 'grid' ? 6 : 3 }).map((_, index) => (
                <div key={index} className="pt-memory-skeleton-card">
                  <span />
                  <i />
                  <i />
                  <small />
                </div>
              ))}
            </div>
          ) : (
            <div className={`pt-memory-list ${viewMode}`}>
              {viewMode === 'timeline' && (
                <div className="pt-memory-timeline-period" aria-hidden="true">
                  <span />
                  <strong>July 8, 2026</strong>
                </div>
              )}
              {memories.map((memory) => (
                <button
                  key={memory.id}
                  className={`pt-memory-card ${selectedMemoryId === memory.id ? 'selected' : ''}`}
                  type="button"
                  onClick={() => {
                    setSelectedMemoryId(memory.id);
                    setDetailState('ready');
                  }}
                >
                  <div className="pt-memory-card-head">
                    <strong>{memory.title}</strong>
                    <span>{memory.score}</span>
                  </div>
                  <p>{memory.body}</p>
                  <div className="pt-memory-card-foot">
                    <span>{memory.cate}</span>
                    <span>{memory.time}</span>
                  </div>
                  <div className="pt-memory-tags">{memory.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>
                  <div className="pt-memory-row-actions" aria-hidden="true">
                    <MoreHorizontal size={14} />
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="pt-memory-analysis-status">
            <Loader2 size={16} />
            <span><strong>Analysis in progress</strong><small>7 / 12 topics checked · candidate memories require review before future context use.</small></span>
            <div className="pt-progress-line"><span style={{ width: '58%' }} /></div>
          </div>
          {analysisOpen && (
            <div className="pt-memory-analysis-modal" role="dialog" aria-label="Memory analysis">
              <div className="pt-detail-top">
                <strong>Memory Analysis</strong>
                <button type="button" onClick={() => setAnalysisOpen(false)}>Close</button>
              </div>
              <p>Review candidate memories before they are added to the agent profile. This mirrors LobeHub analysis action plus async task status.</p>
              <div className="pt-progress-line"><span style={{ width: '64%' }} /></div>
              <div className="pt-activity-list">
                <div><CheckCircle2 size={15} /> Extracted reporting preference from planning thread.</div>
                <div><CircleDashed size={15} /> Checking whether ownership boundary is stable enough to remember.</div>
                <div><AlertTriangle size={15} /> One thread returned partial extraction; retry keeps the candidate list visible.</div>
                <div><Clock3 size={15} /> Waiting for analysis of resource-binding behavior.</div>
              </div>
            </div>
          )}
        </main>
        <aside className="pt-memory-detail-panel">
          <div className="pt-detail-top">
            <button type="button"><PanelRightClose size={15} /> Detail</button>
            <div className="pt-memory-detail-actions">
              <button type="button" onClick={() => setDetailState('loading')}>Load</button>
              <button type="button" onClick={() => setDetailState('missing')}>Missing</button>
              <button type="button" aria-expanded={detailMenuOpen} onClick={() => setDetailMenuOpen((open) => !open)}><MoreHorizontal size={14} /></button>
            </div>
          </div>
          {detailMenuOpen && (
            <div className="pt-memory-detail-menu" aria-label="Memory detail actions">
              <button type="button" onClick={() => setEditOpen(true)}><Pencil size={14} /> Edit memory</button>
              <button type="button"><Copy size={14} /> Copy source link</button>
              <button type="button" className="danger"><Trash2 size={14} /> Delete memory</button>
            </div>
          )}
          {detailState === 'loading' && (
            <div className="pt-memory-detail-loading" aria-label="Memory detail loading">
              <span />
              <i />
              <i />
              <i />
              <small />
            </div>
          )}
          {detailState === 'missing' && (
            <div className="pt-memory-detail-missing" role="status">
              <FileQuestion size={28} />
              <strong>Memory no longer exists</strong>
              <span>The detail request succeeded, but this memory was deleted elsewhere.</span>
              <button type="button" onClick={() => setDetailState('ready')}>Back to selected memory</button>
            </div>
          )}
          {detailState === 'ready' && (
            <>
              <span className="pt-memory-cate">{selectedMemory.cate}</span>
              <h2>{selectedMemory.title}</h2>
              <p>{selectedMemory.body}</p>
              <dl className="pt-resource-metadata memory-meta">
                <div><dt>Score</dt><dd>{selectedMemory.score}</dd></div>
                <div><dt>Source</dt><dd>Agent thread</dd></div>
                <div><dt>Captured</dt><dd>{selectedMemory.time}</dd></div>
                <div><dt>Status</dt><dd>active</dd></div>
              </dl>
              <div className="pt-memory-highlight">Suggestion: tighten this memory so it stores durable reporting preference, not transient BP task progress.</div>
              <div className="pt-state-box">Suggestions can refine this memory before it becomes part of future agent context.</div>
            </>
          )}
        </aside>
      </div>
      {editOpen && (
        <div className="pt-memory-edit-modal" role="dialog" aria-label="Edit memory">
          <div className="pt-detail-top">
            <strong>Edit memory</strong>
            <button type="button" onClick={() => setEditOpen(false)}>Cancel</button>
          </div>
          <textarea defaultValue={selectedMemory.body} aria-label="Memory editor" />
          <div className="pt-memory-edit-actions">
            <button type="button" onClick={() => setEditOpen(false)}>Cancel</button>
            <button className="primary" type="button" onClick={() => setEditOpen(false)}><Save size={14} /> Save</button>
          </div>
        </div>
      )}
    </section>
  );
}

function SkillsSurface() {
  const skillState = reviewParam('state');
  const isDeepSkillsReview = skillState === 'deep-skills';
  const isCompactSkills = skillState === '' || skillState === 'compact-skills';
  const [viewMode, setViewMode] = useState<'connector' | 'skill'>(
    reviewParam('tab') === 'skill' && !isDeepSkillsReview ? 'skill' : 'connector',
  );
  const [selected, setSelected] = useState(isDeepSkillsReview ? 'notion' : 'web-search');
  const [storeOpen, setStoreOpen] = useState(skillState === 'store-open' || isDeepSkillsReview);
  const [storeTab, setStoreTab] = useState<'LobeHub' | 'Skills' | 'MCP'>(
    isDeepSkillsReview || reviewParam('storeTab') === 'MCP' ? 'MCP' : 'LobeHub',
  );
  const [importOpen, setImportOpen] = useState(skillState === 'import-failure' || isDeepSkillsReview);
  const [addMenuOpen, setAddMenuOpen] = useState(isDeepSkillsReview || reviewParam('addMenu') === '1');
  const [customMcpOpen, setCustomMcpOpen] = useState(isDeepSkillsReview || reviewParam('mcpDrawer') === '1');
  const [oauthWaiting, setOauthWaiting] = useState(isDeepSkillsReview || reviewParam('oauth') === '1');
  const [syncError, setSyncError] = useState(isDeepSkillsReview || reviewParam('syncError') === '1');
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const connectorSections = [
    { title: 'Built-in Tools', items: [['web-search', 'Web Search', 'Enabled'], ['filesystem', 'Filesystem', 'Enabled'], ['memory', 'Memory', 'Enabled']] },
    { title: 'OAuth Connectors', items: [['notion', 'Notion', oauthWaiting ? 'Waiting for OAuth' : 'Not connected'], ['github', 'GitHub', 'Connected']] },
    { title: 'Community MCPs', items: [['playwright', 'Playwright MCP', 'Available']] },
    { title: 'Custom MCPs', items: [['local-devtools', 'Local DevTools', syncError ? 'Test failed' : 'Needs review']] },
  ];
  const skillSections = [
    { title: 'Built-in Skills', items: [['artifacts', 'Artifacts', 'Enabled'], ['tasks', 'Task', 'Enabled']] },
    { title: 'Community Skills', items: [['browser-use', 'Browser Use', 'Available'], ['research', 'Research Assistant', 'Available']] },
    { title: 'Custom Skills', items: [['team-runbook', 'Team Runbook', 'Draft']] },
  ];
  const activeSections = viewMode === 'connector' ? connectorSections : skillSections;
  const selectedLabel =
    activeSections.flatMap((section) => section.items).find(([id]) => id === selected)?.[1] ??
    (viewMode === 'connector' ? 'Web Search' : 'Artifacts');
  const selectViewMode = (mode: 'connector' | 'skill') => {
    setViewMode(mode);
    setSelected(mode === 'connector' ? 'web-search' : 'artifacts');
  };
  const closeImport = () => {
    setImportOpen(false);
    importButtonRef.current?.focus();
  };
  const addMenuItems = [
    ['Import from URL', 'Fetch a remote skill manifest and install it as an Agent Skill.'],
    ['Import from GitHub', 'Import a repository-backed skill with validation and error recovery.'],
    ['Upload ZIP', 'Install a local archive after manifest inspection.'],
    ['Add Custom MCP', 'Open the connector-backed MCP drawer with auth and test controls.'],
  ];
  const storeItems = [
    ['Browser automation', 'LobeHub catalog', 'Install'],
    ['Workspace files', 'Built-in skill', 'Installed'],
    ['Figma Context MCP', 'MCP server', 'Details'],
  ];

  useEffect(() => {
    if (!importOpen) return;
    importInputRef.current?.focus();
  }, [importOpen]);

  if (isCompactSkills) {
    return (
      <section className="pt-skill-compact-shell" aria-label="LobeHub Skills compact baseline">
        <div className="pt-skill-settings-layout is-compact-skills">
          <aside className="pt-skill-left-panel is-compact-skills" aria-label="Skill settings navigation">
            <div className="pt-skill-panel-header is-compact-skills">
              <div className="pt-segmented" role="tablist" aria-label="Skill view mode">
                <button className={viewMode === 'connector' ? 'is-active' : ''} type="button" onClick={() => selectViewMode('connector')}>Connectors</button>
                <button className={viewMode === 'skill' ? 'is-active' : ''} type="button" onClick={() => selectViewMode('skill')}>Skills</button>
              </div>
              <div className="pt-icon-actions">
                <button ref={importButtonRef} type="button" aria-expanded={addMenuOpen} aria-label="Add skill or connector" onClick={() => setAddMenuOpen((open) => !open)}><Plus size={15} /></button>
                <button type="button" aria-label="Open Skill Store" onClick={() => setStoreOpen((open) => !open)}><Sparkles size={15} /></button>
              </div>
            </div>
            {addMenuOpen && (
              <div className="pt-skill-add-menu" aria-label="Add skill menu">
                {addMenuItems.map(([title, desc]) => (
                  <button
                    key={title}
                    type="button"
                    onClick={() => {
                      if (title === 'Add Custom MCP') setCustomMcpOpen(true);
                      else setImportOpen(true);
                    }}
                  >
                    <Plus size={14} />
                    <span><strong>{title}</strong><small>{desc}</small></span>
                  </button>
                ))}
              </div>
            )}
            <div className="pt-skill-section-list" aria-label="Skill sections">
              {activeSections.map((section) => (
                <div key={section.title} className="pt-skill-section">
                  <button className="pt-skill-section-title" type="button"><ChevronDown size={14} /> {section.title}</button>
                  {section.items.map(([id, label, status]) => (
                    <button key={id} className={`pt-skill-nav-item ${selected === id ? 'selected' : ''}`} type="button" onClick={() => setSelected(id)}>
                      <Sparkles size={15} />
                      <span><strong>{label}</strong><small>{status}</small></span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>

          <main className="pt-skill-detail-panel is-compact-skills" aria-label="Skill detail">
            <div className="pt-skill-detail-header is-compact-skills">
              <div className="pt-skill-avatar"><Sparkles size={20} /></div>
              <div>
                <h2>{selectedLabel}</h2>
                <p>{viewMode === 'connector' ? 'Connector permission and tool manifest for agent runtime requests.' : 'Skill package details, instructions and agent availability.'}</p>
              </div>
              <div className="pt-toolbar">
                <button type="button" onClick={() => setOauthWaiting(true)}>{viewMode === 'connector' ? 'Connect' : 'Enable'}</button>
                <button className="danger" type="button">Remove</button>
              </div>
            </div>
            <div className="pt-skill-detail-tabs">
              {['Overview', 'Schema', 'Agents'].map((item, index) => <button key={item} className={index === 0 ? 'is-active' : ''} type="button">{item}</button>)}
            </div>
            <div className="pt-skill-detail-body is-compact-skills">
              <section className="pt-skill-detail-card">
                <strong>Permissions</strong>
                <div className="pt-permission-row"><span>Can read conversation context</span><CheckCircle2 size={15} /></div>
                <div className="pt-permission-row"><span>Can request workspace resources</span><CircleDashed size={15} /></div>
                <div className="pt-permission-row"><span>Requires user approval before external access</span><CheckCircle2 size={15} /></div>
              </section>
              <section className="pt-skill-detail-card">
                <strong>Available tools</strong>
                <div className="pt-tool-chip-row"><span>search</span><span>open result</span><span>summarize</span><span>retry</span></div>
                <p>Agents can request this capability during a thread. The runtime keeps approval and failure states visible.</p>
              </section>
              <section className="pt-skill-detail-card schema-card">
                <strong>Schema preview</strong>
                <pre>{`tool: search\ninput:\n  query: string\napproval: required-before-external-access`}</pre>
              </section>
            </div>
          </main>
        </div>
      </section>
    );
  }

  return (
    <section className="pt-deep-shell">
      <SurfaceHeader owner="base-settings" title="Skills / Tools">
        Manage tools, connectors, and installable skills that agents can request during conversations.
      </SurfaceHeader>
      <div className="pt-skill-settings-layout">
        <aside className="pt-skill-left-panel">
          <div className="pt-skill-panel-header">
            <div className="pt-segmented" role="tablist" aria-label="Skill view mode">
              <button className={viewMode === 'connector' ? 'is-active' : ''} type="button" onClick={() => selectViewMode('connector')}>Connectors</button>
              <button className={viewMode === 'skill' ? 'is-active' : ''} type="button" onClick={() => selectViewMode('skill')}>Skills</button>
            </div>
            <div className="pt-icon-actions">
              <button ref={importButtonRef} type="button" aria-expanded={addMenuOpen} aria-label="Add skill or connector" onClick={() => setAddMenuOpen((open) => !open)}><Plus size={15} /></button>
              <button type="button" aria-label="Open Skill Store" onClick={() => setStoreOpen((open) => !open)}><Sparkles size={15} /></button>
            </div>
          </div>
          {addMenuOpen && (
            <div className="pt-skill-add-menu" aria-label="Add skill menu">
              {addMenuItems.map(([title, desc]) => (
                <button
                  key={title}
                  type="button"
                  onClick={() => {
                    if (title === 'Add Custom MCP') setCustomMcpOpen(true);
                    else setImportOpen(true);
                  }}
                >
                  <Plus size={14} />
                  <span><strong>{title}</strong><small>{desc}</small></span>
                </button>
              ))}
            </div>
          )}
          <div className="pt-skill-section-list">
            {activeSections.map((section) => (
              <div key={section.title} className="pt-skill-section">
                <button className="pt-skill-section-title" type="button"><ChevronDown size={14} /> {section.title}</button>
                {section.items.map(([id, label, status]) => (
                  <button key={id} className={`pt-skill-nav-item ${selected === id ? 'selected' : ''}`} type="button" onClick={() => setSelected(id)}>
                    <Sparkles size={15} />
                    <span><strong>{label}</strong><small>{status}</small></span>
                    {id === 'notion' && oauthWaiting && <Loader2 size={14} className="pt-inline-spin" />}
                    {id === 'local-devtools' && syncError && <AlertTriangle size={14} className="pt-inline-danger" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {importOpen && <div
            className="pt-inline-dialog static"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              closeImport();
            }}
          >
            <strong>Import from URL</strong>
            <button type="button">Import from GitHub</button>
            <button type="button">Upload ZIP</button>
            <button type="button" onClick={() => setCustomMcpOpen(true)}>Add custom connector</button>
            <input ref={importInputRef} className="pt-search-input" defaultValue="http://127.0.0.1:8765/SKILL.md" aria-label="Skill import URL" />
            <p>The URL could not be imported. The modal preserves the input and keeps outside dismissal disabled while loading.</p>
            <code>Unexpected token '&lt;', "&lt;!DOCTYPE "... is not valid JSON</code>
          </div>}
        </aside>
        <main className="pt-skill-detail-panel">
          <EvidenceChip>LIVE-157 / LIVE-158 / LIVE-159 / LIVE-160</EvidenceChip>
          <div className="pt-skill-detail-header">
            <div className="pt-skill-avatar"><Sparkles size={20} /></div>
            <div>
              <h2>{selectedLabel}</h2>
              <p>{viewMode === 'connector' ? 'Connector permission and tool manifest for agent runtime requests.' : 'Skill package details, instructions and agent availability.'}</p>
            </div>
            <div className="pt-toolbar">
              <button type="button" onClick={() => setOauthWaiting(true)}>{viewMode === 'connector' ? 'Connect' : 'Enable'}</button>
              <button className="danger" type="button">Remove</button>
            </div>
          </div>
          {oauthWaiting && (
            <div className="pt-skill-oauth-status" role="status">
              <Loader2 size={16} />
              <span><strong>Waiting for connector authorization</strong><small>OAuth window opened. Fallback polling checks LobeHub Skill status for 15 seconds.</small></span>
              <button type="button" onClick={() => setOauthWaiting(false)}>Cancel</button>
            </div>
          )}
          {syncError && (
            <div className="pt-skill-sync-error" role="alert">
              <AlertTriangle size={16} />
              <span><strong>Connector manifest sync failed</strong><small>Existing connector remains visible; retry does not remove working legacy plugin state.</small></span>
              <button type="button" onClick={() => setSyncError(false)}>Retry</button>
            </div>
          )}
          <div className="pt-skill-detail-tabs">
            {['Overview', 'Schema', 'Agents'].map((item, index) => <button key={item} className={index === 0 ? 'is-active' : ''} type="button">{item}</button>)}
          </div>
          <div className="pt-skill-detail-body">
            <section className="pt-skill-detail-card">
              <strong>Permissions</strong>
              <div className="pt-permission-row"><span>Can read conversation context</span><CheckCircle2 size={15} /></div>
              <div className="pt-permission-row"><span>Can request workspace resources</span><CircleDashed size={15} /></div>
              <div className="pt-permission-row"><span>Requires user approval before external access</span><CheckCircle2 size={15} /></div>
            </section>
            <section className="pt-skill-detail-card">
              <strong>Available tools</strong>
              <div className="pt-tool-chip-row"><span>search</span><span>open result</span><span>summarize</span><span>retry</span></div>
              <p>Agents can request this capability during a thread. The runtime keeps approval and failure states visible.</p>
            </section>
            <section className="pt-skill-detail-card">
              <strong>Store preview</strong>
              <p>{storeOpen ? 'Skill Store modal preview is open with LobeHub, Skills and MCP tabs.' : 'Open the store action to browse LobeHub tools, community skills and MCP servers.'}</p>
            </section>
            <section className="pt-skill-detail-card schema-card">
              <strong>Schema preview</strong>
              <pre>{`tool: search\ninput:\n  query: string\napproval: required-before-external-access`}</pre>
            </section>
          </div>
          {storeOpen && <div className="pt-skill-store-modal" role="dialog" aria-label="Skill Store">
            <div className="pt-detail-top">
              <strong>Skill Store</strong>
              <button type="button" onClick={() => setStoreOpen(false)}>Close</button>
            </div>
            <div className="pt-skill-detail-tabs">
              {(['LobeHub', 'Skills', 'MCP'] as const).map((item) => (
                <button key={item} className={storeTab === item ? 'is-active' : ''} type="button" onClick={() => setStoreTab(item)}>{item}</button>
              ))}
            </div>
            <input className="pt-search-input" defaultValue="browser" aria-label="Skill Store search" />
            <div className="pt-skill-store-actions">
              <button type="button" onClick={() => setImportOpen(true)}><Plus size={14} /> Add Skill</button>
              <button type="button" onClick={() => setCustomMcpOpen(true)}><Settings size={14} /> Custom MCP</button>
            </div>
            <div className="pt-store-list">
              {storeItems.map(([item, meta, action]) => (
                <div key={item} className="pt-store-item"><Sparkles size={15} /><span><strong>{item}</strong><small>{storeTab} · {meta}</small></span><button type="button">{action}</button></div>
              ))}
            </div>
            <div className="pt-skill-store-detail">
              <strong>{storeTab === 'MCP' ? 'Figma Context MCP' : 'Browser automation'}</strong>
              <p>Detail panel keeps overview/schema/agents available before install, matching SkillDetailInner.</p>
              <div className="pt-tool-chip-row"><span>Overview</span><span>Schema</span><span>Agents</span></div>
            </div>
          </div>}
        </main>
      </div>
      {customMcpOpen && (
        <aside className="pt-skill-mcp-drawer" aria-label="Custom MCP connector drawer">
          <div className="pt-detail-top">
            <strong>Create Custom MCP</strong>
            <button type="button" onClick={() => setCustomMcpOpen(false)}>Close</button>
          </div>
          <div className="pt-skill-quick-import">
            <strong>Quick import JSON</strong>
            <textarea defaultValue={'{\"mcpServers\":{\"figma\":{\"command\":\"npx\",\"args\":[\"-y\",\"figma-context-mcp\"],\"env\":{\"FIGMA_TOKEN\":\"<token>\"}}}}'} aria-label="MCP quick import JSON" />
            <div className="pt-skill-sync-error compact"><AlertTriangle size={15} /> Duplicate identifier: figma. Form fields are kept for correction.</div>
          </div>
          <div className="pt-skill-mcp-form">
            <label>Identifier<input defaultValue="figma" /></label>
            <label>Transport<select defaultValue="stdio"><option>stdio</option><option>http</option></select></label>
            <label>Command<input defaultValue="npx -y figma-context-mcp" /></label>
            <label>Auth<select defaultValue="oauth2"><option>bearer</option><option>oauth2</option></select></label>
          </div>
          <div className="pt-skill-mcp-footer">
            <button type="button" onClick={() => setSyncError(true)}><RefreshCw size={14} /> Test connection</button>
            <button className="primary" type="button">Save connector</button>
          </div>
        </aside>
      )}
    </section>
  );
}

function ImageSurface() {
  const [imageState, setImageState] = useState(
    reviewParam('state') === 'copy-failure'
      ? 'Image Topic 1: Failed to copy prompt. Try again from the image menu.'
      : 'Describe an image, choose a model, then generate a batch.',
  );
  const resultStateRef = useRef<HTMLDivElement>(null);
  const runImageAction = (message: string) => {
    setImageState(message);
    window.setTimeout(() => resultStateRef.current?.focus(), 0);
  };

  return (
    <section className="pt-deep-shell">
      <SurfaceHeader owner="agent-domain" title="Image Generation">
        Generate images from prompts, manage result batches, and save useful outputs to the workspace library.
      </SurfaceHeader>
      <div className="pt-image-layout">
        <aside className="pt-deep-sidebar">
          <label>Model<select defaultValue="gpt-image-1"><option>gpt-image-1</option><option>flux</option></select></label>
          <label>Count<input type="range" defaultValue={2} /></label>
          <label>Prompt<textarea defaultValue="A calm desktop workspace with an AI assistant panel and soft morning light." /></label>
          <button className="pt-send-button" type="button" onClick={() => runImageAction('Generation started. Results will appear in the workspace feed.')}>Generate</button>
        </aside>
        <main className="pt-resource-board">
          {[1, 2].map((item) => <div key={item} className="pt-image-card"><div className="pt-image-placeholder" /><strong>Image Topic {item}</strong><span>Ready to preview, download, copy prompt, or remove from history.</span><div className="pt-toolbar"><button type="button" onClick={() => runImageAction(`Image Topic ${item}: download started.`)}>Download</button><button type="button" onClick={() => runImageAction(`Image Topic ${item}: Failed to copy prompt. Try again from the image menu.`)}>Copy prompt</button><button type="button" onClick={() => runImageAction(`Image Topic ${item}: delete confirmation opened.`)}>Delete</button></div></div>)}
          <div ref={resultStateRef} className="pt-state-box" aria-live="polite" tabIndex={-1}>{imageState}</div>
          <div className="pt-state-box warning">If generation fails, keep the prompt and settings available so the user can retry without rebuilding the request.</div>
        </main>
      </div>
    </section>
  );
}

function SettingsSurface() {
  const tabs = ['Profile', 'Provider', 'Storage', 'Advanced', 'Service Model', 'Skills', 'Statistics', 'Appearance', 'Devices', 'Hotkeys', 'Notifications', 'Plans', 'Usage', 'Credits', 'Billing', 'About'];
  const initialTab = reviewParam('tab');
  const [tab, setTab] = useState(tabs.includes(initialTab) ? initialTab : 'Provider');
  const settingsState = reviewParam('state');
  const isDeepSettingsReview = settingsState === 'deep-settings';
  const isCompactSettings = settingsState === '' || settingsState === 'compact-settings';
  const providers = [
    { id: 'openai', name: 'OpenAI', status: 'Connected', models: ['gpt-4.1', 'gpt-4o', 'o3'], keyState: 'API key saved', type: 'Builtin', enabled: true },
    { id: 'anthropic', name: 'Anthropic', status: 'Available', models: ['claude-4-sonnet', 'claude-3.7-sonnet'], keyState: 'Add API key', type: 'Builtin', enabled: false },
    { id: 'trae', name: 'TRAE CLI', status: 'Workspace', models: ['trae-agent-default'], keyState: 'Local provider', type: 'Custom', enabled: true },
    { id: 'workspace-router', name: 'Workspace Router', status: 'Draft', models: ['pt-router-default'], keyState: 'Needs key', type: 'Custom', enabled: false },
  ];
  const [providerId, setProviderId] = useState(reviewParam('provider') || providers[0].id);
  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? providers[0];
  const [providerMenuOpen, setProviderMenuOpen] = useState(isDeepSettingsReview || reviewParam('providerMenu') === '1');
  const [createProviderOpen, setCreateProviderOpen] = useState(settingsState === 'create-provider' || isDeepSettingsReview);
  const [sortOpen, setSortOpen] = useState(settingsState === 'sort-provider' || isDeepSettingsReview);
  const [modelError, setModelError] = useState(settingsState === 'model-error' || isDeepSettingsReview);
  const [modelConfigOpen, setModelConfigOpen] = useState(settingsState === 'model-config' || isDeepSettingsReview);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(settingsState === 'delete-model' || isDeepSettingsReview);
  const [servicePickerOpen, setServicePickerOpen] = useState(settingsState === 'service-picker' || isDeepSettingsReview);
  const [activeModelTab, setActiveModelTab] = useState<'all' | 'chat' | 'embedding' | 'image'>('all');
  const modelItems = [
    { id: 'gpt-4.1', name: 'GPT-4.1', type: 'chat', context: '128k', price: '$2 input / $8 output', enabled: true, source: 'Builtin' },
    { id: 'gpt-4o', name: 'GPT-4o', type: 'chat', context: '128k', price: '$2.5 input / $10 output', enabled: true, source: 'Builtin' },
    { id: 'text-embedding-3-large', name: 'Text Embedding 3 Large', type: 'embedding', context: '8k', price: '$0.13 / 1M tokens', enabled: true, source: 'Builtin' },
    { id: 'pt-local-vision', name: 'PT Local Vision', type: 'image', context: 'workspace', price: 'local runtime', enabled: false, source: 'Custom' },
  ];
  const visibleModels = activeModelTab === 'all' ? modelItems : modelItems.filter((model) => model.type === activeModelTab);
  const serviceAssignments = [
    ['Default Agent', 'OpenAI / gpt-4.1', 'Used by normal agent replies and chat sessions.'],
    ['Topic Naming', 'OpenAI / gpt-4o', 'Used when sessions auto-generate topic titles.'],
    ['Memory Analysis', 'OpenAI / gpt-4.1', 'Includes context limit for persona and memory extraction.'],
    ['Memory Embedding', 'OpenAI / text-embedding-3-large', 'Used by memory and resource indexing.'],
    ['Follow-up Action', 'OpenAI / gpt-4o', 'Optional feature with enable switch.'],
    ['Prompt Rewrite', 'Anthropic / claude-4-sonnet', 'Optional feature currently disabled by permission.'],
  ];
  const settingsCards: Record<string, Array<[string, string, string]>> = {
    Storage: [
      ['Data sync mode', 'Cloud workspace', 'Storage page keeps loading/error separate from the actual advanced form.'],
      ['Local cache', '18.4 GB available', 'Clear cache is destructive and requires confirmation.'],
      ['Attachment retention', 'Keep originals', 'Resource cleanup remains base-resource owned.'],
    ],
    Statistics: [
      ['Overview', '12 assistants / 184 topics', 'Stats uses cards, heatmap, rankings and usage table.'],
      ['Usage group-by', 'Model', 'Tabs switch between model, provider and user dimensions.'],
      ['Month filter', '2026-07', 'Date picker refreshes usage SWR data.'],
    ],
    About: [
      ['Version', 'Peers Touch Agent parity prototype', 'About page combines version, links and analytics consent.'],
      ['Telemetry', 'Ask before sharing', 'Analytics state is explicit and recoverable.'],
      ['Open source', 'LobeHub source anchored', 'Attribution is tracked in docs, not exposed as product debug text.'],
    ],
    Appearance: [
      ['Theme mode', 'System', 'Preview card mirrors LobeHub appearance settings without changing global theme.'],
      ['Compact density', 'Comfortable', 'Controls stay low-noise under Peers UI Identity.'],
      ['Chat preview', 'Markdown + code highlighter', 'Chat appearance remains a separate settings route.'],
    ],
    Hotkeys: [
      ['Quick search', 'Command + K', 'Desktop shortcuts are editable rows, not static text.'],
      ['New chat', 'Command + N', 'Conflicts must be shown inline before save.'],
      ['Stop generation', 'Esc', 'Runtime action is agent-domain owned.'],
    ],
  };
  const detailRef = useRef<HTMLElement>(null);
  const selectTab = (item: string) => {
    setTab(item);
    window.setTimeout(() => detailRef.current?.focus(), 0);
  };
  const settingGroups = [
    { title: 'General', items: ['Profile', 'Statistics', 'Appearance', 'Devices', 'Hotkeys', 'Notifications'] },
    { title: 'Subscription', items: ['Plans', 'Usage', 'Credits', 'Billing'] },
    { title: 'Agent', items: ['Provider', 'Service Model', 'Skills', 'Memory', 'Credentials', 'API Key', 'Messenger'] },
    { title: 'System', items: ['Proxy', 'System Tools', 'Storage', 'Advanced', 'About'] },
  ];
  const providerSections = [
    { title: 'Enabled Providers', items: providers.filter((provider) => provider.enabled) },
    { title: 'Custom Providers', items: providers.filter((provider) => provider.type === 'Custom' && !provider.enabled) },
    { title: 'Disabled Providers', items: providers.filter((provider) => provider.type !== 'Custom' && !provider.enabled) },
  ];

  if (isCompactSettings) {
    return (
      <section className="pt-settings-compact-shell" aria-label="LobeHub Settings compact baseline">
        <div className="pt-settings-compact-layout">
          <aside className="pt-settings-nav-panel" aria-label="Settings navigation">
            <div className="pt-settings-nav-header">
              <strong>Settings</strong>
            </div>
            <div className="pt-settings-nav-groups">
              {settingGroups.map((group) => (
                <section key={group.title} className="pt-settings-nav-group">
                  <h3>{group.title}</h3>
                  {group.items.map((item) => (
                    <button key={item} className={item === 'Provider' ? 'is-active' : ''} type="button">
                      <Settings size={15} />
                      <span>{item}</span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          </aside>
          <main className="pt-settings-provider-layout" aria-label="Provider settings default page">
            <aside className="pt-provider-compact-menu" aria-label="Provider menu">
              <div className="pt-provider-compact-toolbar">
                <label>
                  <Search size={15} />
                  <input aria-label="Search providers" placeholder="Search providers" />
                </label>
                <button type="button" aria-label="Add custom provider"><Plus size={15} /></button>
              </div>
              <div className="pt-provider-compact-list">
                <button className="is-active" type="button">
                  <span><strong>All Providers</strong><small>Overview and enablement</small></span>
                  <CheckCircle2 size={15} />
                </button>
                {providerSections.map((section) => (
                  <section key={section.title} className="pt-provider-compact-section">
                    <h3>{section.title}</h3>
                    {section.items.map((provider) => (
                      <button key={provider.id} type="button">
                        <span><strong>{provider.name}</strong><small>{provider.type} · {provider.status}</small></span>
                        {provider.enabled ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}
                      </button>
                    ))}
                  </section>
                ))}
              </div>
            </aside>
            <section className="pt-provider-grid-page" aria-label="All provider grid">
              <div className="pt-settings-compact-header">
                <div>
                  <h2>Provider</h2>
                  <p>Configure model providers and choose which models are available to agents.</p>
                </div>
              </div>
              {providerSections.map((section) => (
                <section key={section.title} className="pt-provider-grid-section">
                  <div className="pt-provider-grid-section-title">
                    <h3>{section.title}</h3>
                    <span>{section.items.length}</span>
                  </div>
                  <div className="pt-provider-card-grid">
                    {section.items.map((provider) => (
                      <article key={provider.id} className="pt-provider-card">
                        <div className="pt-provider-card-head">
                          <div className="pt-provider-logo compact"><BrainCircuit size={16} /></div>
                          <strong>{provider.name}</strong>
                          <button className={provider.enabled ? 'is-on' : ''} type="button" aria-pressed={provider.enabled}>
                            {provider.enabled ? 'On' : 'Off'}
                          </button>
                        </div>
                        <p>{provider.name} provides {provider.models.length} workspace-visible models. Provider identity stays explicit for model selection.</p>
                        <div className="pt-provider-card-footer">
                          <span>{provider.type}</span>
                          <span>{provider.keyState}</span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
              <footer className="pt-provider-request-footer">
                Missing a model provider? Request it for the workspace provider registry.
              </footer>
            </section>
          </main>
        </div>
      </section>
    );
  }

  return (
    <section className="pt-deep-shell">
      <SurfaceHeader owner="base-settings" title="Settings">
        Configure account, providers, models, storage, appearance, usage, and billing in one shared settings space.
      </SurfaceHeader>
      <div className="pt-settings-layout">
        <aside className="pt-settings-sidebar">
          <button className="pt-settings-search" type="button"><Search size={15} /> Search settings</button>
          <div className="pt-settings-section-nav">
            {tabs.map((item) => (
              <button key={item} className={tab === item ? 'is-active' : ''} type="button" onClick={() => selectTab(item)}>
                <Settings size={15} /> {item}
              </button>
            ))}
          </div>
        </aside>
        <main ref={detailRef} aria-live="polite" className="pt-settings-main" tabIndex={-1}>
          <EvidenceChip>Settings Provider + model registry</EvidenceChip>
          <div className="pt-settings-page-header">
            <div>
              <h2>{tab}</h2>
              <p>{tab === 'Provider' ? 'Manage provider credentials, proxy settings, model availability, and the models agents can select.' : tab === 'Service Model' ? 'Assign default models to chat, reasoning, embedding, image, speech, and tool-routing capabilities.' : `Manage ${tab.toLowerCase()} preferences for the workspace.`}</p>
            </div>
            <button className="pt-wide-button primary" type="button">{tab === 'Provider' ? 'Add provider' : 'Save changes'}</button>
          </div>
          {tab === 'Provider' ? (
            <div className="pt-provider-settings-shell">
              <aside className="pt-provider-menu">
                <div className="pt-provider-menu-toolbar">
                  <input className="pt-search-input compact" defaultValue={isDeepSettingsReview ? 'open' : ''} aria-label="Provider search" placeholder="Search providers" />
                  <button type="button" aria-label="Add custom provider" onClick={() => setCreateProviderOpen(true)}><Plus size={15} /></button>
                  <button type="button" aria-expanded={providerMenuOpen} aria-label="Provider menu" onClick={() => setProviderMenuOpen((open) => !open)}><MoreHorizontal size={15} /></button>
                </div>
                {providerMenuOpen && (
                  <div className="pt-provider-sort-menu" aria-label="Provider sorting menu">
                    {['Default order', 'A to Z', 'Z to A'].map((item, index) => (
                      <button key={item} type="button" onClick={() => index === 0 && setSortOpen(true)}>
                        {index === 0 ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
                        <span>{item}</span>
                      </button>
                    ))}
                  </div>
                )}
                {providers.map((provider) => (
                  <button key={provider.id} className={provider.id === providerId ? 'is-active' : ''} type="button" onClick={() => setProviderId(provider.id)}>
                    <span><strong>{provider.name}</strong><small>{provider.type} · {provider.status}</small></span>
                    {provider.enabled ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}
                  </button>
                ))}
              </aside>
              <section className="pt-provider-detail">
                <div className="pt-provider-detail-head">
                  <div className="pt-provider-logo"><Bot size={22} /></div>
                  <div>
                    <h3>{selectedProvider.name}</h3>
                    <p>{selectedProvider.keyState} · provider + model identity is shown explicitly to every agent surface.</p>
                  </div>
                  <button type="button" onClick={() => setModelError(true)}>Check</button>
                </div>
                {modelError && (
                  <div className="pt-provider-async-error" role="alert">
                    <AlertTriangle size={16} />
                    <span><strong>Model list refresh failed</strong><small>The provider form is preserved. Retry only refreshes the model list.</small></span>
                    <button type="button" onClick={() => setModelError(false)}>Retry</button>
                  </div>
                )}
                <div className="pt-settings-form-grid">
                  <label>API key<input type="password" defaultValue={selectedProvider.id === 'openai' ? 'sk-••••••••••••••••' : ''} placeholder="Paste provider key" /></label>
                  <label>Proxy URL<input defaultValue={selectedProvider.id === 'openai' ? 'https://api.openai.com/v1' : ''} placeholder="Optional proxy endpoint" /></label>
                  <label>Provider scope<select defaultValue="workspace"><option>workspace</option><option>personal</option><option>disabled</option></select></label>
                  <label>Health<select defaultValue={selectedProvider.status === 'Connected' ? 'available' : 'needs-key'}><option value="available">available</option><option value="needs-key">needs key</option><option>disabled</option></select></label>
                </div>
                <div className="pt-model-list-panel" aria-label="Provider model registry">
                  <div className="pt-model-list-title">
                    <span><strong>Models</strong><small>{visibleModels.length} visible for {selectedProvider.name}</small></span>
                    <button type="button" onClick={() => setModelError(true)}><RefreshCw size={14} /> Fetch remote</button>
                  </div>
                  <div className="pt-model-tabs" role="tablist" aria-label="Model type tabs">
                    {(['all', 'chat', 'embedding', 'image'] as const).map((item) => (
                      <button key={item} className={activeModelTab === item ? 'is-active' : ''} type="button" onClick={() => setActiveModelTab(item)}>
                        {item} <span>{item === 'all' ? modelItems.length : modelItems.filter((model) => model.type === item).length}</span>
                      </button>
                    ))}
                  </div>
                  <div className="pt-model-items">
                    {visibleModels.map((model) => (
                      <div key={model.id} className="pt-model-item">
                        <div className="pt-provider-logo compact"><BrainCircuit size={16} /></div>
                        <span><strong>{model.name}</strong><small>{model.id} · {model.price}</small></span>
                        <span>{model.context}</span>
                        <span className="pt-tool-chip-row"><span>{model.type}</span><span>{model.source}</span></span>
                        <div className="pt-model-item-actions">
                          <button type="button" onClick={() => setModelConfigOpen(true)}><Pencil size={14} /></button>
                          {model.source === 'Custom' && <button type="button" onClick={() => setDeleteConfirmOpen(true)}><Trash2 size={14} /></button>}
                          <button className={model.enabled ? 'is-on' : ''} type="button" aria-pressed={model.enabled}>{model.enabled ? 'On' : 'Off'}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="pt-state-box">Agents consume this Settings Provider projection; model selection remains unique as provider + model.</div>
              </section>
              {createProviderOpen && (
                <aside className="pt-settings-side-modal" aria-label="Create custom provider modal">
                  <div className="pt-detail-top">
                    <strong>Create Custom Provider</strong>
                    <button type="button" onClick={() => setCreateProviderOpen(false)}>Close</button>
                  </div>
                  <div className="pt-settings-form-grid single">
                    <label>Provider ID<input defaultValue="workspace-router" /></label>
                    <label>Name<input defaultValue="Workspace Router" /></label>
                    <label>SDK type<select defaultValue="openai"><option>openai</option><option>anthropic</option><option>router</option></select></label>
                    <label>Proxy URL<input defaultValue="https://station.local/ai/v1" /></label>
                    <label>API key<input type="password" placeholder="Optional workspace key" /></label>
                  </div>
                  <div className="pt-provider-async-error compact"><AlertTriangle size={15} /> Duplicate provider ID keeps the form open for correction.</div>
                  <button className="pt-wide-button primary" type="button">Create provider</button>
                </aside>
              )}
              {sortOpen && (
                <div className="pt-settings-dialog" role="dialog" aria-label="Sort provider modal">
                  <div className="pt-detail-top">
                    <strong>Sort Providers</strong>
                    <button type="button" onClick={() => setSortOpen(false)}>Close</button>
                  </div>
                  {providers.map((provider, index) => (
                    <div key={provider.id} className="pt-sortable-provider-row">
                      <span>{index + 1}</span>
                      <strong>{provider.name}</strong>
                      <MoreHorizontal size={15} />
                    </div>
                  ))}
                  <button className="pt-wide-button primary" type="button">Update order</button>
                </div>
              )}
              {modelConfigOpen && (
                <div className="pt-settings-dialog compact" role="dialog" aria-label="Model configuration modal">
                  <div className="pt-detail-top">
                    <strong>Model configuration</strong>
                    <button type="button" onClick={() => setModelConfigOpen(false)}>Close</button>
                  </div>
                  <div className="pt-settings-form-grid single">
                    <label>Display name<input defaultValue="GPT-4.1 workspace default" /></label>
                    <label>Context window<input defaultValue="128000" /></label>
                    <label>Abilities<select defaultValue="chat"><option>chat</option><option>vision</option><option>tool use</option></select></label>
                  </div>
                </div>
              )}
              {deleteConfirmOpen && (
                <div className="pt-settings-dialog danger" role="alertdialog" aria-label="Delete model confirmation">
                  <strong>Delete custom model?</strong>
                  <p>PT Local Vision will stay visible until the provider confirms deletion.</p>
                  <div className="pt-inline-actions">
                    <button type="button" onClick={() => setDeleteConfirmOpen(false)}>Cancel</button>
                    <button type="button">Delete</button>
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'Service Model' ? (
            <div className="pt-service-model-form">
              {servicePickerOpen && (
                <div className="pt-provider-async-error" role="alert">
                  <AlertTriangle size={16} />
                  <span><strong>Service model permission pending</strong><small>The picker stays disabled until base-settings confirms manage_settings permission.</small></span>
                  <button type="button" onClick={() => setServicePickerOpen(false)}>Acknowledge</button>
                </div>
              )}
              <section className="pt-service-model-group">
                <div className="pt-model-list-title"><span><strong>Model assignments</strong><small>Default and system agents</small></span><Loader2 className="pt-inline-spin" size={15} /></div>
                {serviceAssignments.slice(0, 4).map(([name, value, help]) => (
                  <div key={name} className="pt-service-assignment-row">
                    <span><strong>{name}</strong><small>{help}</small></span>
                    <button type="button" onClick={() => setServicePickerOpen(true)}>{value}<ChevronDown size={14} /></button>
                  </div>
                ))}
              </section>
              <section className="pt-service-model-group">
                <div className="pt-model-list-title"><span><strong>Optional features</strong><small>Feature toggles keep loading local to each row.</small></span></div>
                {serviceAssignments.slice(4).map(([name, value, help], index) => (
                  <div key={name} className="pt-service-assignment-row">
                    <span><strong>{name}</strong><small>{help}</small></span>
                    <button type="button" aria-pressed={index === 0}>{index === 0 ? 'Enabled' : 'Disabled'}</button>
                    <button type="button" onClick={() => setServicePickerOpen(true)}>{value}<ChevronDown size={14} /></button>
                  </div>
                ))}
              </section>
            </div>
          ) : settingsCards[tab] ? (
            <div className="pt-settings-card-grid">
              {settingsCards[tab].map(([title, value, help]) => (
                <section key={title} className="pt-settings-rich-card">
                  <div className="pt-detail-top">
                    <strong>{title}</strong>
                    <button type="button">{tab === 'Storage' ? 'Manage' : 'Edit'}</button>
                  </div>
                  <span>{value}</span>
                  <p>{help}</p>
                </section>
              ))}
              {tab === 'Statistics' && (
                <section className="pt-settings-usage-panel">
                  <div className="pt-stat-bar" style={{ '--bar': '82%' } as CSSProperties}><span>GPT-4.1</span></div>
                  <div className="pt-stat-bar" style={{ '--bar': '54%' } as CSSProperties}><span>Claude Sonnet</span></div>
                  <div className="pt-stat-bar" style={{ '--bar': '32%' } as CSSProperties}><span>TRAE local</span></div>
                </section>
              )}
              {tab === 'Storage' && (
                <div className="pt-provider-async-error" role="status">
                  <Loader2 className="pt-inline-spin" size={15} />
                  <span><strong>Loading storage actions</strong><small>Skeleton/retry state remains visible until user and server config initialize.</small></span>
                  <button type="button">Retry</button>
                </div>
              )}
            </div>
          ) : (
            <div className="pt-settings-placeholder-panel">
              <strong>{tab} settings</strong>
              <p>Manage {tab.toLowerCase()} preferences for the workspace. Agent surfaces use these settings where relevant.</p>
              <div className="pt-provider-row"><span>Workspace default</span><CheckCircle2 size={16} /></div>
              <div className="pt-provider-row"><span>Personal override</span><CircleDashed size={16} /></div>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}

function CommunitySurface() {
  const initialCategory = reviewParam('category');
  const categories = [
    { key: 'agent', label: 'Agent', title: 'Lobe Designer', meta: 'profile header, prompt preview, fork/use boundary' },
    { key: 'group_agent', label: 'Group Agent', title: 'Design Review Group', meta: 'multi-agent card, role roster, use boundary' },
    { key: 'model', label: 'Model', title: 'Claude 4 Sonnet', meta: 'provider capability, context window, pricing metadata' },
    { key: 'provider', label: 'Provider', title: 'OpenAI Provider', meta: 'provider schema, credential boundary, model list' },
    { key: 'mcp', label: 'MCP', title: 'Figma Context MCP', meta: 'schema + installation method + external link' },
    { key: 'skill', label: 'Skill', title: 'Web Browser', meta: 'version, manifest, and install method' },
    { key: 'organization', label: 'Organization', title: 'LobeHub Org', meta: 'publisher profile, public assets, external navigation' },
    { key: 'user', label: 'User', title: 'Community Author', meta: 'author profile, published assets, follow boundary' },
    { key: 'workspace', label: 'Workspace', title: 'Shared Workspace', meta: 'workspace profile, team assets, permission boundary' },
  ];
  const [category, setCategory] = useState(
    categories.some((item) => item.key === initialCategory) ? initialCategory : 'mcp',
  );
  const detailRef = useRef<HTMLElement>(null);
  const selectedCategory = categories.find((item) => item.key === category) ?? categories[4];
  const selectCategory = (nextCategory: string) => {
    setCategory(nextCategory);
    window.setTimeout(() => detailRef.current?.focus(), 0);
  };

  return (
    <section className="pt-deep-shell">
      <SurfaceHeader owner="base-settings" title="Community Marketplace">
        Discover agents, models, providers, MCP servers, skills, and creators from the community marketplace.
      </SurfaceHeader>
      <div className="pt-community-layout">
        <aside className="pt-deep-sidebar">
          {categories.map((item) => (
            <button key={item.key} className={category === item.key ? 'is-active' : ''} type="button" onClick={() => selectCategory(item.key)}>
              <Sparkles size={15} />
              {item.label}
            </button>
          ))}
          <input className="pt-search-input" defaultValue="figma" aria-label="Community search" />
          <div className="pt-state-box">Search community entries and sort by trending, update time, or usage.</div>
        </aside>
        <main className="pt-community-main">
          <div className="pt-detail-top">
            <EvidenceChip>LIVE-070..LIVE-083 / category={category}</EvidenceChip>
            <div className="pt-toolbar">
              <button className="is-active" type="button">Trending</button>
              <button type="button">Recently Updated</button>
              <button type="button">Most Used</button>
            </div>
          </div>
          <div className="pt-community-grid">
            {[
              [selectedCategory.title, selectedCategory.label, selectedCategory.meta],
              ['Figma Context MCP', 'MCP server', 'schema + installation method + external link'],
              ['Web Browser', 'Tool skill', 'version and install method'],
              ['Claude 4 Sonnet', 'Model', 'provider capability and context metadata'],
            ].map(([name, type, meta]) => (
              <article key={name} className="pt-market-card">
                <div className="pt-market-icon"><Sparkles size={18} /></div>
                <div>
                  <h3>{name}</h3>
                  <span>{type}</span>
                </div>
                <p>{meta}</p>
                <div className="pt-toolbar">
                  <button type="button">Detail</button>
                  <button type="button">Install Method</button>
                  <button type="button">External</button>
                </div>
              </article>
            ))}
          </div>
          <aside ref={detailRef} className="pt-market-detail" tabIndex={-1}>
            <h3>{selectedCategory.label} detail</h3>
            <p>
              {selectedCategory.title} includes a profile header, version or schema details, installation guidance, and links back to the original listing.
              Installing from the marketplace keeps browsing separate from local agent execution until the user enables it.
            </p>
            <OwnerPill owner="external/deferred" />
          </aside>
        </main>
      </div>
    </section>
  );
}

export function AgentLobeHubParityPrototype() {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [handoffPrompt, setHandoffPrompt] = useState('');
  const [chatFocusKey, setChatFocusKey] = useState(0);
  const theme = initialTheme();
  const reviewMode = isReviewMode();
  const activeSource = useMemo(() => sourceRefs[surface], [surface]);
  const sendFromHome = (prompt: string) => {
    setHandoffPrompt(prompt);
    setSurface('chat');
    setChatFocusKey((key) => key + 1);
  };

  return (
    <main className="pt-agent-parity" data-source={activeSource} data-theme={theme}>
      <Sidebar surface={surface} setSurface={setSurface} />
      <div className="pt-main-stage">
        {reviewMode && (
          <div className="pt-top-strip">
            <div>
              <strong>Agent LobeHub Parity</strong>
              <span>revision-required · product view hides review annotations by default</span>
            </div>
            <div className="pt-surface-tabs">
              <button className={surface === 'home' ? 'is-active' : ''} type="button" onClick={() => setSurface('home')}>Home</button>
              <button className={surface === 'chat' ? 'is-active' : ''} type="button" onClick={() => setSurface('chat')}>Agent Chat</button>
              <button className={surface === 'profile' ? 'is-active' : ''} type="button" onClick={() => setSurface('profile')}>Profile</button>
              <button className={surface === 'tasks' ? 'is-active' : ''} type="button" onClick={() => setSurface('tasks')}>Tasks</button>
              <button className={surface === 'resources' ? 'is-active' : ''} type="button" onClick={() => setSurface('resources')}>Resources</button>
              <button className={surface === 'community' ? 'is-active' : ''} type="button" onClick={() => setSurface('community')}>Community</button>
              <button className={surface === 'settings' ? 'is-active' : ''} type="button" onClick={() => setSurface('settings')}>Settings</button>
            </div>
          </div>
        )}
        {surface === 'home' && <HomeSurface setSurface={setSurface} onSend={sendFromHome} />}
        {surface === 'chat' && <ChatSurface focusKey={chatFocusKey} handoffPrompt={handoffPrompt} setSurface={setSurface} />}
        {surface === 'profile' && <ProfileSurface />}
        {surface === 'tasks' && <TasksSurface />}
        {surface === 'pages' && <PagesSurface />}
        {surface === 'resources' && <ResourcesSurface />}
        {surface === 'memory' && <MemorySurface />}
        {surface === 'skills' && <SkillsSurface />}
        {surface === 'settings' && <SettingsSurface />}
        {surface === 'image' && <ImageSurface />}
        {surface === 'community' && <CommunitySurface />}
      </div>
    </main>
  );
}

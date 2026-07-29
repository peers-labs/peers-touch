/**
 * peers-touch Desktop — shell prototype.
 *
 * Faithful web-stack mock of the real desktop chrome (apps/desktop):
 *   - global SideNav (LobeUI `<SideNav>` form): avatar + topActions
 *     (Search / chat / agent / notes + applet pins) + bottomActions
 *     (notifications / command palette / settings)
 *   - a content area that swaps pages by `page` (kernel-style pages render
 *     a lightweight placeholder; applets render their own surface)
 *   - command palette (Cmd/Ctrl + Shift + P)
 *
 * Atelier is NOT a standalone full-screen app — it is an *applet*. The rail
 * `▦` icon opens the **applets center** (`page === 'applets'`), which lists all
 * installed applets as cards; clicking an applet's "Open" enters its surface as
 * `applet:<id>` inside the content area. This mirrors the real desktop flow
 * (AppletsPage → handleOpen → navigate `applet:<id>`).
 *
 * This prototype exists to show that container relationship; the page bodies
 * other than atelier are intentionally thin placeholders.
 *
 * Standalone web prototype: no real store / kernel / tauri, mock-data only.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  MessageCircle,
  Bot,
  FileText,
  Blocks,
  Bell,
  Keyboard,
  Settings,
  Plus,
  PanelRightOpen,
  UserRoundCog,
  Sparkles,
  Globe,
  Wrench,
  ChevronRight,
  Zap,
  Workflow as WorkflowIcon,
  type LucideIcon,
} from 'lucide-react';
import { AtelierPage } from '@peers-touch/prototype-desktop-atelier';
import { AgentCanvasPage } from '@peers-touch/prototype-agent-canvas';
import { AppletWorkspacePage } from '../../features/applet-workspace/src/AppletWorkspacePrototype';
import { SocialChatPage } from '../../features/social-chat/src/pages/SocialChatPage';
import { Page as AgentFeaturePage } from '../../features/agent/src/Page';
import { AgentChatPage } from './AgentChatPage';
import { SettingsPage } from './Settings';
import { T } from './theme';
import { ToastHost } from '../../shared/Toast';

/** An installed applet (mirrors RuntimeAppletInfo.manifest + status). */
interface AppletInfo {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** lucide icon + gradient for the card chip */
  icon: LucideIcon;
  gradient: string;
  capabilities: string[];
  /** active = entered at least once this session (mock) */
  status: 'active' | 'inactive';
  /** the applet surface; atelier renders the real prototype */
  render: () => React.ReactNode;
}

const APPLETS: AppletInfo[] = [
  {
    id: 'atelier',
    name: 'Atelier',
    version: '0.1.0',
    author: 'Peers-Touch',
    description: '个人 Agent 工作台：多 Agent 协作、协商引擎、共识与裁决，把大项目当工程系统推进到完成。',
    icon: Sparkles,
    gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    capabilities: ['agents', 'ai', 'skills', 'tasks'],
    status: 'active',
    render: () => <AtelierPage />,
  },
  {
    id: 'web-explorer',
    name: 'Web Explorer',
    version: '0.0.3',
    author: 'Peers-Touch',
    description: '联网检索与网页摘要 applet（容器演示用占位，未细化）。',
    icon: Globe,
    gradient: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
    capabilities: ['search', 'network'],
    status: 'inactive',
    render: () => <AppletPlaceholder name="Web Explorer" />,
  },
  {
    id: 'toolbox',
    name: 'Toolbox',
    version: '0.0.1',
    author: 'Peers-Touch',
    description: '本地工具集 applet（容器演示用占位，未细化）。',
    icon: Wrench,
    gradient: 'linear-gradient(135deg, #10b981, #059669)',
    capabilities: ['tools', 'file'],
    status: 'inactive',
    render: () => <AppletPlaceholder name="Toolbox" />,
  },
];

/** Kernel-style top nav entries (Search/chat/agent/notes) — placeholders. */
const NAV_ITEMS: { id: string; icon: LucideIcon; title: string }[] = [
  { id: 'search', icon: Search, title: '搜索' },
  { id: 'chat', icon: MessageCircle, title: '聊天' },
  { id: 'agent', icon: Bot, title: 'Agent' },
  { id: 'notes', icon: FileText, title: 'Notes' },
];

const COMMANDS: { id: string; label: string; desc: string; shortcut: string; target: string }[] = [
  { id: 'search', label: '搜索', desc: '全局搜索', shortcut: '⌘K', target: 'search' },
  { id: 'chat', label: '聊天', desc: '打开 Social Chat', shortcut: '⌘⇧C', target: 'chat' },
  { id: 'agent', label: 'Agent', desc: '打开 Agent', shortcut: '⌘J', target: 'agent' },
  { id: 'agent-atelier', label: 'Atelier', desc: '打开 Agent 工作台', shortcut: '⌘⇧A', target: 'agent-atelier' },
  { id: 'agent-orchestration', label: 'Agent 编排', desc: '从 Agent 页进入编排画板', shortcut: '⌘⇧J', target: 'agent-orchestration' },
  { id: 'applets', label: 'Applets', desc: '打开 Applets 中心', shortcut: '⌘⇧E', target: 'applets' },
  { id: 'atelier', label: '打开 Atelier', desc: '进入 Atelier applet', shortcut: '⌘⇧A', target: 'applet:atelier' },
  { id: 'notes', label: 'Notes', desc: '打开笔记', shortcut: '⌘⇧N', target: 'notes' },
  { id: 'settings', label: '设置', desc: '打开设置', shortcut: '⌘,', target: 'settings' },
];

/** A single ActionIcon button in the rail (mirrors LobeUI `<ActionIcon>`). */
function RailIcon({
  icon: Icon,
  active,
  title,
  onClick,
}: {
  icon: LucideIcon;
  active?: boolean;
  title: string;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 40,
        height: 40,
        border: 0,
        padding: 0,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: active ? T.primary : T.textSecondary,
        backgroundColor: active ? T.primaryWash : hover ? T.fillQuaternary : 'transparent',
      }}
    >
      <Icon size={20} />
    </button>
  );
}

/** Global side navigation — LobeUI `<SideNav>` form (avatar / top / bottom). */
function SideNav({
  page,
  onNavigate,
  onOpenPalette,
  paletteOpen,
}: {
  page: string;
  onNavigate: (p: string) => void;
  onOpenPalette: () => void;
  paletteOpen: boolean;
}) {
  return (
    <div
      style={{
        width: 60,
        flexShrink: 0,
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '12px 0',
        backgroundColor: T.navBg,
        borderRight: `1px solid ${T.border}`,
      }}
    >
      {/* avatar */}
      <div
        title="我的资料"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          marginBottom: 16,
          background: `linear-gradient(135deg, ${T.primary}, #9a8df0)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: T.white,
          fontWeight: 'bold',
          fontSize: 15,
          cursor: 'pointer',
        }}
      >
        P
      </div>

      {/* topActions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {NAV_ITEMS.map((n) => (
          <RailIcon
            key={n.id}
            icon={n.icon}
            title={n.title}
            active={page === n.id || (n.id === 'agent' && page === 'agent-orchestration')}
            onClick={() => onNavigate(n.id)}
          />
        ))}
        {/* applets center entry (▦); active on the list page or any applet surface */}
        <RailIcon
          icon={Blocks}
          title="Applets"
          active={page === 'applets' || page.startsWith('applet:')}
          onClick={() => onNavigate('applets')}
        />
      </div>

      {/* spacer */}
      <div style={{ flex: 1 }} />

      {/* bottomActions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <RailIcon icon={Bell} title="通知" onClick={() => {}} />
        <RailIcon icon={Keyboard} title="命令面板 (⌘⇧P)" active={paletteOpen} onClick={onOpenPalette} />
        <RailIcon icon={Settings} title="设置" active={page === 'settings'} onClick={() => onNavigate('settings')} />
      </div>
    </div>
  );
}

/** Thin placeholder for kernel-owned pages we don't prototype in detail. */
function PagePlaceholder({ page }: { page: string }) {
  const meta: Record<string, { title: string; desc: string; icon: LucideIcon }> = {
    search: { title: '搜索', desc: '全局搜索页（peers-touch 容器壳页，原型未细化）', icon: Search },
    chat: { title: '聊天', desc: '社交聊天页（含 Chat / Contacts 与会话内 stream call）', icon: MessageCircle },
    notes: { title: 'Notes', desc: '笔记页（peers-touch 容器壳页，原型未细化）', icon: FileText },
    settings: { title: '设置', desc: '设置页（peers-touch 容器壳页，原型未细化）', icon: Settings },
  };
  const m = meta[page] ?? { title: page, desc: '占位页', icon: Blocks };
  const Icon = m.icon;
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: T.textTertiary,
        backgroundColor: T.bg,
        gap: 12,
      }}
    >
      <Icon size={40} color={T.textQuaternary} />
      <div style={{ fontSize: 17, fontWeight: 'bold', color: T.textSecondary }}>{m.title}</div>
      <div style={{ fontSize: 13, maxWidth: 360, textAlign: 'center' }}>{m.desc}</div>
      <div style={{ fontSize: 12, color: T.textQuaternary, marginTop: 8 }}>
        本原型聚焦容器外壳 + Atelier applet；点左栏 ▦ 进入 Applets 中心。
      </div>
    </div>
  );
}

/** Placeholder surface for applets we don't prototype (web-explorer / toolbox). */
function AppletPlaceholder({ name }: { name: string }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: T.textTertiary,
        backgroundColor: T.bg,
        gap: 12,
      }}
    >
      <Blocks size={40} color={T.textQuaternary} />
      <div style={{ fontSize: 17, fontWeight: 'bold', color: T.textSecondary }}>{name}</div>
      <div style={{ fontSize: 13, maxWidth: 360, textAlign: 'center' }}>
        该 applet 仅用于演示「Applets 列表 → 进入 applet」的容器关系，内容未细化。
      </div>
    </div>
  );
}

/**
 * Applets center (`page === 'applets'`) — card grid of installed applets.
 * Mirrors the real desktop AppletsPage: click "Open" → enter `applet:<id>`.
 */
function AppletsCenter({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div style={{ height: '100%', overflow: 'auto', backgroundColor: T.bg }}>
      {/* PageHeader */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '22px 40px 18px',
          borderBottom: `1px solid ${T.borderSoft}`,
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: T.primaryWash,
            color: T.primary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Blocks size={20} />
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Applets</div>
          <div style={{ fontSize: 13, color: T.textTertiary }}>
            已安装的 applet。点「打开」进入对应工作面。
          </div>
        </div>
      </div>

      {/* card grid */}
      <div
        style={{
          padding: '28px 40px 48px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 20,
          alignContent: 'start',
        }}
      >
        {APPLETS.map((a) => (
          <AppletCard key={a.id} applet={a} onOpen={() => onOpen(a.id)} />
        ))}
      </div>
    </div>
  );
}

/** A single applet card in the applets center. */
function AppletCard({ applet, onOpen }: { applet: AppletInfo; onOpen: () => void }) {
  const [hover, setHover] = useState(false);
  const isActive = applet.status === 'active';
  const Icon = applet.icon;
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        borderRadius: 16,
        border: `1px solid ${hover ? T.primary : isActive ? T.primaryWash : T.border}`,
        background: T.white,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? '0 4px 24px rgba(107,91,214,0.12)' : 'none',
      }}
    >
      {/* top accent */}
      <div style={{ height: 3, background: isActive ? applet.gradient : T.border }} />
      <div style={{ padding: '20px 20px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* row 1: icon + name + status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              background: applet.gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              opacity: isActive ? 1 : 0.6,
            }}
          >
            <Icon size={26} color={T.white} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{applet.name}</span>
              <span style={{ fontSize: 11, color: T.textTertiary }}>v{applet.version}</span>
              <span
                style={{
                  fontSize: 11,
                  color: isActive ? '#10b981' : T.textQuaternary,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: isActive ? '#10b981' : T.textQuaternary,
                  }}
                />
                {isActive ? '已启用' : '未启用'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>by {applet.author}</div>
          </div>
        </div>

        {/* row 2: description */}
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.6,
            color: T.textSecondary,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {applet.description}
        </div>

        {/* row 3: capabilities */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {applet.capabilities.map((c) => (
            <span
              key={c}
              style={{
                fontSize: 11,
                lineHeight: '20px',
                padding: '0 8px',
                borderRadius: 6,
                background: T.fillQuaternary,
                color: T.textSecondary,
                border: `1px solid ${T.borderSoft}`,
              }}
            >
              {c}
            </span>
          ))}
        </div>

        {/* footer: open */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 4,
            paddingTop: 4,
            color: hover ? T.primary : T.textTertiary,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          打开
          <ChevronRight size={16} />
        </div>
      </div>
    </div>
  );
}

/** Command palette (Cmd/Ctrl + Shift + P) — antd Modal form mocked in CSS. */
function CommandPalette({
  open,
  onClose,
  onRun,
}: {
  open: boolean;
  onClose: () => void;
  onRun: (target: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => `${c.label} ${c.desc} ${c.shortcut}`.toLowerCase().includes(q));
  }, [query]);

  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        backgroundColor: 'rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: '90vw',
          backgroundColor: T.bg,
          borderRadius: 14,
          boxShadow: '0 12px 48px rgba(0,0,0,0.18)',
          padding: 16,
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入命令…"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: '10px 12px',
            fontSize: 14,
            outline: 'none',
            marginBottom: 12,
          }}
        />
        <div style={{ display: 'grid', gap: 6 }}>
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onRun(c.target)}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr auto',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${T.borderSoft}`,
                background: 'transparent',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span style={{ color: T.textTertiary }}>
                {c.id === 'atelier' ? <Blocks size={16} /> : c.id === 'agent' ? <UserRoundCog size={16} /> : c.id === 'chat' ? <PanelRightOpen size={16} /> : c.id === 'search' ? <Search size={16} /> : c.id === 'notes' ? <Plus size={16} /> : <Settings size={16} />}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: T.text }}>{c.label}</span>
                <span style={{ display: 'block', fontSize: 12, color: T.textTertiary }}>{c.desc}</span>
              </span>
              <kbd
                style={{
                  padding: '2px 6px',
                  borderRadius: 6,
                  border: `1px solid ${T.border}`,
                  background: T.fillQuaternary,
                  color: T.textSecondary,
                  fontSize: 11,
                }}
              >
                {c.shortcut}
              </kbd>
            </button>
          ))}
          {filtered.length === 0 ? (
            <div style={{ padding: 12, fontSize: 13, color: T.textTertiary, textAlign: 'center' }}>无匹配命令</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Optional overrides so sibling prototypes can reuse this container shell as a
 * host and mount their own block into a kernel page, instead of building a
 * parallel chrome. This mirrors how atelier is reused via `workspace:*`:
 *   - `pages` maps a kernel page id (e.g. `chat`) to a full-bleed renderer;
 *     unmapped ids fall back to the thin `PagePlaceholder`.
 *   - `initialPage` selects the landing surface.
 */
export interface DesktopShellProps {
  pages?: Record<string, () => React.ReactNode>;
  initialPage?: string;
}

type AgentSurfaceId = 'agent' | 'agent-atelier' | 'agent-orchestration';

function getAgentSurfaceId(page: string): AgentSurfaceId | null {
  if (page === 'agent' || page === 'agent-profile') return 'agent';
  if (page === 'agent-atelier') return 'agent-atelier';
  if (page === 'agent-orchestration') return 'agent-orchestration';
  return null;
}

export function DesktopShell({ pages, initialPage }: DesktopShellProps = {}) {
  // page mirrors the real router: kernel ids (search/chat/agent/notes/settings),
  // `applets` for the applets center, or `applet:<id>` for an applet surface.
  // Default lands on the applets center to show: rail ▦ → list → enter applet.
  const [page, setPage] = useState(initialPage ?? 'applets');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [visitedAgentSurfaces, setVisitedAgentSurfaces] = useState<Set<AgentSurfaceId>>(() => {
    const initialSurface = getAgentSurfaceId(initialPage ?? 'applets');
    return initialSurface ? new Set([initialSurface]) : new Set();
  });

  const navigate = (p: string) => {
    const surface = getAgentSurfaceId(p);
    if (surface) {
      setVisitedAgentSurfaces((current) => {
        if (current.has(surface)) return current;
        const next = new Set(current);
        next.add(surface);
        return next;
      });
    }
    setPage(p);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const applet = page.startsWith('applet:')
    ? APPLETS.find((a) => `applet:${a.id}` === page)
    : undefined;

  // Resolve the content body: applet surface > injected kernel page > built-in
  // prototype page > thin placeholder. Injected pages let a sibling prototype
  // mount its own block into a real kernel page without re-building the chrome.
  let body: React.ReactNode;
  if (applet) {
    body = applet.render();
  } else if (pages && pages[page]) {
    body = pages[page]!();
  } else if (page === 'applets') {
    body = <AppletWorkspacePage />;
  } else if (page === 'chat') {
    body = <SocialChatPage />;
  } else if (page === 'agent') {
    body = (
      <AgentChatPage
        onOpenOrchestration={() => navigate('agent-orchestration')}
        onOpenProfile={() => navigate('agent-profile')}
      />
    );
  } else if (page === 'agent-profile') {
    body = <AgentProfilePage onOpenOrchestration={() => navigate('agent-orchestration')} />;
  } else if (page === 'agent-orchestration') {
    body = <AgentCanvasPage embedded onBack={() => navigate('agent')} />;
  } else if (page === 'settings') {
    body = <SettingsPage />;
  } else {
    body = <PagePlaceholder page={page} />;
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', display: 'flex', backgroundColor: T.bg }}>
      <SideNav
        page={page}
        onNavigate={navigate}
        onOpenPalette={() => setPaletteOpen(true)}
        paletteOpen={paletteOpen}
      />
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {visitedAgentSurfaces.size > 0 && (
          <div
            data-testid="desktop-agent-module-host"
            style={{
              position: 'absolute',
              inset: 0,
              minHeight: 0,
              display: page.startsWith('agent') ? 'flex' : 'none',
              flexDirection: 'column',
            }}
          >
            <div style={{ height: 42, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 10px', borderBottom: `1px solid ${T.border}`, background: T.bg }}>
              {[
                { id: 'agent', label: 'Agent', icon: Bot },
                { id: 'agent-atelier', label: 'Atelier', icon: Zap },
                { id: 'agent-orchestration', label: 'Orchestration', icon: WorkflowIcon },
              ].map((item) => {
                const Icon = item.icon;
                const active = item.id === 'agent'
                  ? page === 'agent' || page === 'agent-profile'
                  : page === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.id)}
                    style={{
                      height: 30,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '0 10px',
                      border: 0,
                      borderRadius: 8,
                      color: active ? T.primary : T.textSecondary,
                      background: active ? T.primaryWash : 'transparent',
                      fontSize: 12,
                      fontWeight: active ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    <Icon size={14} />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
              {visitedAgentSurfaces.has('agent') && (
                <>
                  <div
                    data-agent-surface="agent"
                    style={{ position: 'absolute', inset: 0, display: page === 'agent' || page === 'agent-profile' ? 'block' : 'none' }}
                  >
                    <AgentChatPage
                      onOpenOrchestration={() => navigate('agent-orchestration')}
                      profileOpen={page === 'agent-profile'}
                      onOpenProfile={() => navigate('agent-profile')}
                      onCloseProfile={() => navigate('agent')}
                    />
                  </div>
                </>
              )}
              {visitedAgentSurfaces.has('agent-atelier') && (
                <div
                  data-agent-surface="agent-atelier"
                  style={{ position: 'absolute', inset: 0, display: page === 'agent-atelier' ? 'block' : 'none' }}
                >
                  <AgentFeaturePage initialSurface="atelier" showGlobalNav={false} />
                </div>
              )}
              {visitedAgentSurfaces.has('agent-orchestration') && (
                <div
                  data-agent-surface="agent-orchestration"
                  style={{ position: 'absolute', inset: 0, display: page === 'agent-orchestration' ? 'block' : 'none' }}
                >
                  <AgentCanvasPage embedded onBack={() => navigate('agent')} />
                </div>
              )}
            </div>
          </div>
        )}
        {!page.startsWith('agent') && body}
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onRun={(target) => {
          navigate(target);
          setPaletteOpen(false);
        }}
      />
      <ToastHost />
    </div>
  );
}

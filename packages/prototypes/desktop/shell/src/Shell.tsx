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
 * Atelier is NOT a standalone full-screen app — it is an *applet* pinned in
 * the rail, entered as `applet:atelier`, and rendered inside the content area.
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
  type LucideIcon,
} from 'lucide-react';
import { AtelierPage } from '@peers-touch/prototype-desktop-atelier';
import { T } from './theme';

/** A pinned applet in the rail (mirrors AppletPins.pinnedApplets). */
interface AppletInfo {
  id: string;
  name: string;
  /** the applet surface; atelier renders the real prototype */
  render: () => React.ReactNode;
}

const APPLETS: AppletInfo[] = [
  { id: 'atelier', name: 'Atelier', render: () => <AtelierPage /> },
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
  { id: 'chat', label: '聊天', desc: '打开聊天', shortcut: '⌘⇧C', target: 'chat' },
  { id: 'agent', label: 'Agent', desc: '打开 Agent', shortcut: '⌘J', target: 'agent' },
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
    <div
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 40,
        height: 40,
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
    </div>
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
            active={page === n.id}
            onClick={() => onNavigate(n.id)}
          />
        ))}
        {/* applet pins (Blocks icon, active when page === applet:<id>) */}
        {APPLETS.map((a) => (
          <RailIcon
            key={a.id}
            icon={Blocks}
            title={a.name}
            active={page === `applet:${a.id}`}
            onClick={() => onNavigate(`applet:${a.id}`)}
          />
        ))}
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
    chat: { title: '聊天', desc: '社交聊天页（peers-touch 容器壳页，原型未细化）', icon: MessageCircle },
    agent: { title: 'Agent', desc: 'AI Agent 对话页（peers-touch 容器壳页，原型未细化）', icon: Bot },
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
        本原型聚焦容器外壳 + Atelier applet；点左栏 ▦ 进入 Atelier。
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
            <div
              key={c.id}
              onClick={() => onRun(c.target)}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr auto',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${T.borderSoft}`,
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
            </div>
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

export function DesktopShell({ pages, initialPage }: DesktopShellProps = {}) {
  // page mirrors the real router: kernel ids (search/chat/agent/notes/settings)
  // or `applet:<id>` for an applet surface. Default lands on the atelier applet
  // to show the container → applet relationship.
  const [page, setPage] = useState(initialPage ?? 'applet:atelier');
  const [paletteOpen, setPaletteOpen] = useState(false);

  const navigate = (p: string) => setPage(p);

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

  // Resolve the content body: applet surface > injected kernel page > thin
  // placeholder. Injected pages let a sibling prototype (e.g. call) mount its
  // own block into a real kernel page without re-building the chrome.
  let body: React.ReactNode;
  if (applet) {
    body = applet.render();
  } else if (pages && pages[page]) {
    body = pages[page]!();
  } else {
    body = <PagePlaceholder page={page} />;
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', backgroundColor: T.bg }}>
      <SideNav
        page={page}
        onNavigate={navigate}
        onOpenPalette={() => setPaletteOpen(true)}
        paletteOpen={paletteOpen}
      />
      <div style={{ flex: 1, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
        {body}
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onRun={(target) => {
          navigate(target);
          setPaletteOpen(false);
        }}
      />
    </div>
  );
}

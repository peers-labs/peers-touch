/**
 * peers-touch Desktop — shell prototype.
 *
 * Faithful web-stack mock of the real desktop chrome (apps/desktop):
 *   - global SideNav (LobeUI `<SideNav>` form): avatar + topActions
 *     (Search / chat / agent + applet pins) + bottomActions
 *     (notifications / settings)
 *   - a content area that swaps pages by `page` (kernel-style pages render
 *     a lightweight placeholder; applets render their own surface)
 *   - command palette (Cmd/Ctrl + K), also opened from Settings
 *
 * Launcher, command search and Settings consume one injected applet catalog.
 * Routes use canonical package IDs. The default browser inventory is empty;
 * explicit applets-* scenarios use package manifest metadata. This browser
 * prototype does not claim Native directory selection or Store execution.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import {
  Search,
  MessageCircle,
  Bot,
  Blocks,
  Bell,
  Settings,
  Plus,
  PanelRightOpen,
  UserRoundCog,
  Sparkles,
  Zap,
  Workflow as WorkflowIcon,
  type LucideIcon,
} from 'lucide-react';
import { AtelierPage } from '@peers-touch/prototype-desktop-atelier';
import { Button } from '@lobehub/ui';
import { AgentCanvasPage } from '@peers-touch/prototype-agent-canvas';
import { AppletWorkspacePage } from '../../features/applet-workspace/src/AppletWorkspacePrototype';
import { appletCatalogScenario } from '../../features/applet-workspace/src/appletCatalogScenarios';
import { canOpenApplet, catalogInventory, type AppletCatalogAdapter, type CatalogApplet } from '../../features/applet-workspace/src/appletCatalogAdapter';
import { SocialChatPage } from '../../features/social-chat/src/pages/SocialChatPage';
import { Page as AgentFeaturePage } from '../../features/agent/src/Page';
import { AgentChatPage } from './AgentChatPage';
import { SettingsPage } from './Settings';
import { NotificationPanel, type NotifItem } from './Notifications';
import { T } from './theme';
import { ToastHost } from '../../shared/Toast';
import { ModernChatReview } from '../../features/modern-chat-agent/src/ModernChatReview';
import { V2ProductReview } from '../../features/modern-chat-agent/src/V2ProductReview';
import {
  OAuthLoginPrototype,
  type OAuthProviderProjection,
} from './OAuthLoginPrototype';
import { WelcomeLoginPrototype } from './WelcomeLoginPrototype';
import { createAdvancedSettingsAdapter, type AdvancedSettingsAdapter } from './advancedSettingsAdapter';
import { advancedSettingsScenario } from './advancedSettingsScenarios';
import { bindAppletSettings } from './appletSettingsProjection';
import {
  createGroupAdmissionAdapter,
  type GroupAdmissionAdapter,
} from './groupAdmissionAdapter';

export type {
  GroupAdmissionAdapter,
  GroupAdmissionMode,
  GroupAdmissionProjection,
  GroupInvitationProjection,
  GroupLeaveRejectState,
  RejectedGroupProjection,
} from './groupAdmissionAdapter';
export { createGroupAdmissionAdapter } from './groupAdmissionAdapter';

/** Kernel-style top nav entries — placeholders. */
const NAV_ITEMS: { id: string; icon: LucideIcon; title: string }[] = [
  { id: 'search', icon: Search, title: '搜索' },
  { id: 'chat', icon: MessageCircle, title: '聊天' },
  { id: 'agent', icon: Bot, title: 'Agent' },
];

const COMMANDS: { id: string; label: string; desc: string; shortcut: string; target: string }[] = [
  { id: 'search', label: '搜索', desc: '全局搜索', shortcut: '⌘K', target: 'search' },
  { id: 'chat', label: '聊天', desc: '打开 Social Chat', shortcut: '⌘⇧C', target: 'chat' },
  { id: 'agent', label: 'Agent', desc: '打开 Agent', shortcut: '⌘J', target: 'agent' },
  { id: 'agent-atelier', label: 'Atelier', desc: '打开 Agent 工作台', shortcut: '⌘⇧A', target: 'agent-atelier' },
  { id: 'agent-orchestration', label: 'Agent 编排', desc: '从 Agent 页进入编排画板', shortcut: '⌘⇧J', target: 'agent-orchestration' },
  { id: 'applets', label: 'Applets', desc: '打开 Applets 中心', shortcut: '⌘⇧E', target: 'applets' },
  { id: 'settings', label: '设置', desc: '打开设置', shortcut: '⌘,', target: 'settings' },
];

/** A single ActionIcon button in the rail (mirrors LobeUI `<ActionIcon>`). */
function RailIcon({
  icon: Icon,
  active,
  title,
  badge,
  onClick,
  buttonRef,
}: {
  icon: LucideIcon;
  active?: boolean;
  title: string;
  badge?: number;
  onClick: (pointer: boolean) => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      ref={buttonRef}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={(event) => onClick(event.detail > 0)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
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
      {badge && badge > 0 ? (
        <span
          aria-label={`${badge} unread`}
          style={{
            position: 'absolute', top: 4, right: 4, minWidth: 15, height: 15,
            padding: '0 4px', borderRadius: 8, boxSizing: 'border-box',
            background: T.danger, color: T.white, fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1, border: `2px solid ${T.navBg}`,
          }}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
}

/** Global side navigation — LobeUI `<SideNav>` form (avatar / top / bottom). */
function SideNav({
  page,
  onNavigate,
  notifOpen,
  unreadCount,
  onToggleNotifications,
  notificationButtonRef,
}: {
  page: string;
  onNavigate: (p: string) => void;
  notifOpen: boolean;
  unreadCount: number;
  onToggleNotifications: (pointer: boolean) => void;
  notificationButtonRef: RefObject<HTMLButtonElement | null>;
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
        <RailIcon
          buttonRef={notificationButtonRef}
          icon={Bell}
          title="通知"
          active={notifOpen}
          badge={unreadCount}
          onClick={onToggleNotifications}
        />
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

/** Command palette (Cmd/Ctrl + Shift + P) — antd Modal form mocked in CSS. */
function CommandPalette({
  open,
  onClose,
  onRun,
  applets,
}: {
  open: boolean;
  onClose: () => void;
  onRun: (target: string) => void;
  applets: readonly CatalogApplet[];
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const commands = [...COMMANDS, ...applets.filter(canOpenApplet).map(applet => ({
      id: `applet:${applet.id}`, label: applet.name, desc: applet.id, shortcut: '', target: `applet:${applet.id}`,
    }))];
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.desc} ${c.shortcut}`.toLowerCase().includes(q));
  }, [query, applets]);

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
                {c.id === 'atelier' ? <Blocks size={16} /> : c.id === 'agent' ? <UserRoundCog size={16} /> : c.id === 'chat' ? <PanelRightOpen size={16} /> : c.id === 'search' ? <Search size={16} /> : <Settings size={16} />}
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
  initialNotifications?: readonly NotifItem[];
  groupAdmissionAdapter?: GroupAdmissionAdapter;
  advancedSettingsAdapter?: AdvancedSettingsAdapter;
  appletCatalogAdapter?: AppletCatalogAdapter;
}

type AgentSurfaceId = 'agent' | 'agent-atelier' | 'agent-orchestration';

const AUTH_PROVIDER_FIXTURES: Record<string, OAuthProviderProjection> = {
  github: {
    id: 'github',
    name: 'GitHub',
    color: '#24292f',
    icon: 'github',
    enabled: true,
  },
  google: {
    id: 'google',
    name: 'Google',
    color: '#4285f4',
    icon: 'google',
    enabled: true,
  },
};

function authProviderProjection(state: string): OAuthProviderProjection[] {
  if (state === 'auth-oauth-empty') return [];
  if (typeof window === 'undefined') return [];
  const params = new URLSearchParams(window.location.search);
  const requested = params.has('providers')
    ? (params.get('providers') ?? '').split(',').map(value => value.trim()).filter(Boolean)
    : ['github', 'google'];
  return requested.flatMap(id => AUTH_PROVIDER_FIXTURES[id] ? [AUTH_PROVIDER_FIXTURES[id]] : []);
}

function getAgentSurfaceId(page: string): AgentSurfaceId | null {
  if (page === 'agent' || page === 'agent-profile') return 'agent';
  if (page === 'agent-atelier') return 'agent-atelier';
  if (page === 'agent-orchestration') return 'agent-orchestration';
  return null;
}

export function DesktopShell({
  pages,
  initialPage,
  initialNotifications,
  groupAdmissionAdapter,
  advancedSettingsAdapter,
  appletCatalogAdapter,
}: DesktopShellProps = {}) {
  // page mirrors the real router: kernel ids (search/chat/agent/settings),
  // `applets` for the applets center, or `applet:<id>` for an applet surface.
  // Default lands on the applets center to show: rail ▦ → list → enter applet.
  const modernChatState = typeof window === 'undefined'
    ? ''
    : new URLSearchParams(window.location.search).get('state') ?? '';
  const showModernChatReview = modernChatState.startsWith('modern-');
  const showV2ProductReview = modernChatState.startsWith('v2-');
  const showAuthPrototype = modernChatState.startsWith('auth-oauth-')
    || modernChatState.startsWith('auth-gate-')
    || modernChatState.startsWith('auth-login');
  const showIdentityRecoveryPrototype = modernChatState === 'auth-recovery';
  const authProviders = useMemo(
    () => authProviderProjection(modernChatState),
    [modernChatState],
  );
  const requestedSurface = typeof window === 'undefined'
    ? ''
    : new URLSearchParams(window.location.search).get('surface') ?? '';
  const defaultPage = showModernChatReview || showV2ProductReview
    ? 'agent'
    : initialPage ?? (requestedSurface === 'chat' ? 'chat' : 'applets');
  const [page, setPage] = useState(defaultPage);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notificationView, setNotificationView] = useState<'closed' | 'preview' | 'all'>('closed');
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  // Whether the current preview was opened by pointer (mouse/touch); pointer
  // openers keep focus on the bell, keyboard openers move focus into the panel.
  const notificationPointerOpen = useRef(false);
  const notifOpen = notificationView !== 'closed';
  const notificationViewRef = useRef(notificationView);
  notificationViewRef.current = notificationView;
  const admissionAdapter = useMemo(
    () => groupAdmissionAdapter ?? createGroupAdmissionAdapter({
      invitations: initialNotifications
        ?.filter(item => item.kind === 'group_invite' && item.pending)
        .map(item => ({
          invitationId: item.id,
          conversationId: item.targetPage ?? 'chat',
          groupName: item.body.match(/“(.+?)”/)?.[1] ?? 'Group',
          inviterName: item.title,
          inviterInitials: item.initials,
          inviterAvatarBackground: item.avatarBg,
          timeLabel: item.time,
          policyRevision: 1,
          state: 'pending' as const,
        })) ?? [],
    }),
    [groupAdmissionAdapter, initialNotifications],
  );
  const admissionProjection = useSyncExternalStore(
    admissionAdapter.subscribe,
    admissionAdapter.getSnapshot,
    admissionAdapter.getSnapshot,
  );
  const [notifications, setNotifications] = useState<NotifItem[]>(
    () => initialNotifications
      ?.filter(item => item.kind !== 'group_invite')
      .map((item) => ({ ...item })) ?? [],
  );
  const [dismissedGroupInvitations, setDismissedGroupInvitations] = useState<Set<string>>(
    () => new Set(),
  );
  const [readGroupInvitations, setReadGroupInvitations] = useState<Set<string>>(
    () => new Set(),
  );
  const groupInvitationNotifications = admissionProjection.invitations
    .filter(invitation => !dismissedGroupInvitations.has(invitation.invitationId))
    .map<NotifItem>(invitation => ({
      id: invitation.invitationId,
      kind: 'group_invite',
      title: invitation.inviterName,
      body: invitation.state === 'pending'
        ? `Invited you to join “${invitation.groupName}”.`
        : `Invitation accepted. Waiting for secure membership in “${invitation.groupName}”.`,
      time: invitation.timeLabel,
      read: readGroupInvitations.has(invitation.invitationId),
      initials: invitation.inviterInitials,
      avatarBg: invitation.inviterAvatarBackground,
      pending: invitation.state === 'pending',
      targetPage: 'chat',
    }));
  const visibleNotifications = [...groupInvitationNotifications, ...notifications];
  const [authPrototypeComplete, setAuthPrototypeComplete] = useState(false);
  const [onboardingReset, setOnboardingReset] = useState(false);
  const catalogAdapter = useMemo(() => appletCatalogAdapter ?? appletCatalogScenario(modernChatState), [appletCatalogAdapter, modernChatState]);
  const catalog = useSyncExternalStore(catalogAdapter.subscribe, catalogAdapter.getSnapshot, catalogAdapter.getSnapshot);
  const inventory = useMemo(() => catalogInventory(catalog), [catalog]);
  const settingsAdapter = useMemo(() => {
    if (advancedSettingsAdapter) return bindAppletSettings(advancedSettingsAdapter, catalogAdapter);
    const scenario = advancedSettingsScenario();
    return bindAppletSettings(createAdvancedSettingsAdapter(scenario.projection, {
      ...scenario,
      onResetOnboarding: () => { setOnboardingReset(true); setPaletteOpen(false); },
    }), catalogAdapter);
  }, [advancedSettingsAdapter, catalogAdapter]);
  const unreadCount = visibleNotifications.filter((n) => !n.read).length;
  const [visitedAgentSurfaces, setVisitedAgentSurfaces] = useState<Set<AgentSurfaceId>>(() => {
    const initialSurface = getAgentSurfaceId(defaultPage);
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
    setNotificationView('closed');
    setPage(p);
  };

  const openApplet = async (id: string) => {
    const target = catalogInventory(catalogAdapter.getSnapshot()).find(item => item.id === id);
    if (!target || !canOpenApplet(target)) return;
    navigate(`applet:${id}`);
    if (target.status === 'available') {
      try { await catalogAdapter.install(id); } catch { navigate('applets'); return; }
    }
    const installed = catalogInventory(catalogAdapter.getSnapshot()).find(item => item.id === id);
    if (installed && installed.status !== 'available' && canOpenApplet(installed)) navigate(`applet:${id}`);
  };

  const openNotification = (item: NotifItem) => {
    if (item.kind === 'group_invite') {
      setReadGroupInvitations(current => new Set(current).add(item.id));
    } else {
      setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    }
    setNotificationView('closed');
    if (item.targetPage) navigate(item.targetPage);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
        if (notificationViewRef.current !== 'closed') {
          setNotificationView('closed');
          // Restore the bell after the dialog's own close/focus teardown.
          window.setTimeout(() => notificationButtonRef.current?.focus(), 0);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if ((showAuthPrototype && !authPrototypeComplete) || onboardingReset) {
    return (
      <OAuthLoginPrototype
        onComplete={() => { setAuthPrototypeComplete(true); setOnboardingReset(false); }}
        providers={authProviders}
      />
    );
  }
  if (showIdentityRecoveryPrototype) {
    return <WelcomeLoginPrototype />;
  }

  const applet = page.startsWith('applet:')
    ? inventory.find((a) => `applet:${a.id}` === page)
    : undefined;

  // Resolve the content body: applet surface > injected kernel page > built-in
  // prototype page > thin placeholder. Injected pages let a sibling prototype
  // mount its own block into a real kernel page without re-building the chrome.
  let body: React.ReactNode;
  if (page.startsWith('applet:')) {
    const available = applet && applet.status !== 'available' && canOpenApplet(applet);
    body = applet && catalog.pendingId === applet.id
      ? <div className="catalog-empty" role="status">正在准备 {applet.name}…</div>
      : available && pages?.[page] ? pages[page]!()
      : available && applet.id === 'peers.atelier' ? <AtelierPage />
        : <div className="catalog-empty" style={{ flexDirection: 'column', gap: 16 }} role="status">
          <span>{applet?.name ?? '小程序'} 暂时无法打开。</span>
          <Button onClick={() => navigate('applets')}>返回小程序</Button>
        </div>;
  } else if (pages && pages[page]) {
    body = pages[page]!();
  } else if (page === 'applets') {
    body = <AppletWorkspacePage adapter={catalogAdapter} onOpen={id => void openApplet(id)} />;
  } else if (page === 'chat') {
    body = <SocialChatPage groupAdmissionAdapter={admissionAdapter} />;
  } else if (page === 'agent') {
    body = (
      <AgentChatPage
        onOpenOrchestration={() => navigate('agent-orchestration')}
        profileOpen={false}
        onOpenProfile={() => navigate('agent-profile')}
        onCloseProfile={() => navigate('agent')}
      />
    );
  } else if (page === 'agent-profile') {
    body = (
      <AgentChatPage
        onOpenOrchestration={() => navigate('agent-orchestration')}
        profileOpen
        onOpenProfile={() => navigate('agent-profile')}
        onCloseProfile={() => navigate('agent')}
      />
    );
  } else if (page === 'agent-orchestration') {
    body = <AgentCanvasPage embedded onBack={() => navigate('agent')} />;
  } else if (page === 'settings') {
    body = (
      <SettingsPage
        onOpenCommandPalette={() => setPaletteOpen(true)}
        advancedAdapter={settingsAdapter}
        groupAdmissionAdapter={admissionAdapter}
      />
    );
  } else {
    body = <PagePlaceholder page={page} />;
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 0, overflow: 'hidden', display: 'flex', backgroundColor: T.bg }}>
      <SideNav
        page={page}
        onNavigate={navigate}
        notifOpen={notifOpen}
        unreadCount={unreadCount}
        notificationButtonRef={notificationButtonRef}
        onToggleNotifications={(pointer) => {
          setNotificationView((v) => {
            if (v === 'closed') {
              notificationPointerOpen.current = pointer;
              return 'preview';
            }
            return 'closed';
          });
          // A pointer click on an already keyboard-focused element keeps the
          // :focus-visible ring in Chromium; pointer-openers leave the bell
          // without a visible ring.
          if (pointer) requestAnimationFrame(() => notificationButtonRef.current?.blur());
        }}
      />
      {notifOpen ? (
          <NotificationPanel
            mode={notificationView === 'all' ? 'all' : 'preview'}
            anchorRef={notificationButtonRef}
            keyboardAutoFocus={!notificationPointerOpen.current}
            onShowAll={() => setNotificationView('all')}
            onClose={() => setNotificationView('closed')}
            // Defer past the dialog's own trigger-focus restoration, which
            // targets an element that has already unmounted.
            onRestoreFocus={() => window.setTimeout(
              () => notificationButtonRef.current?.focus(), 0)}
            items={visibleNotifications}
            onMarkAllRead={() => {
              setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
              setReadGroupInvitations(
                new Set(admissionProjection.invitations.map(item => item.invitationId)),
              );
            }}
            onOpenItem={openNotification}
            onDismiss={(id) => {
              if (admissionProjection.invitations.some(item => item.invitationId === id)) {
                setDismissedGroupInvitations(current => new Set(current).add(id));
              } else {
                setNotifications((prev) => prev.filter((n) => n.id !== id));
              }
            }}
            onInviteDecision={(id, accept) => {
              const invitation = admissionProjection.invitations.find(
                item => item.invitationId === id,
              );
              if (!invitation) return;
              void admissionAdapter.decideInvitation({
                invitationId: id,
                accept,
                observedState: invitation.state,
                observedPolicyRevision: invitation.policyRevision,
              }).then(() => {
                setReadGroupInvitations(current => new Set(current).add(id));
              });
            }}
          />
      ) : null}
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
                    {showV2ProductReview ? (
                      <V2ProductReview initialState={modernChatState} />
                    ) : showModernChatReview ? (
                      <ModernChatReview initialState={modernChatState} withTopicRail />
                    ) : (
                      <AgentChatPage
                        onOpenOrchestration={() => navigate('agent-orchestration')}
                        profileOpen={page === 'agent-profile'}
                        onOpenProfile={() => navigate('agent-profile')}
                        onCloseProfile={() => navigate('agent')}
                      />
                    )}
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
        applets={inventory}
        onClose={() => setPaletteOpen(false)}
        onRun={(target) => {
          if (target.startsWith('applet:')) void openApplet(target.slice('applet:'.length));
          else navigate(target);
          setPaletteOpen(false);
        }}
      />
      <ToastHost />
    </div>
  );
}

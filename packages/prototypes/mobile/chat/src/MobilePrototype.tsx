import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Bell,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Crown,
  FolderOpen,
  Globe,
  Image,
  ImagePlus,
  KeyRound,
  Loader,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Mic,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Scissors,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  Smile,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import './mobilePrototype.css';

// Launch flow mirrors apps/mobile/src/App.tsx: station selection -> access gate -> shell.
type LaunchStage = 'station' | 'access-gate' | 'shell';
// Access gate variants are Station-driven in the real app (AccessGateHost.tsx / parseGateFields).
type GateVariant = 'login' | 'invite' | 'blocked' | 'preparing';
type TabId = 'chat' | 'moments' | 'contacts' | 'settings';
type ChatMode = 'list' | 'friend-thread' | 'group-thread';
type ComposerPanel = 'emoji' | 'more' | 'attachment' | null;
// Source truth: apps/mobile/src/features/social/socialApi.ts CHAT_BACKGROUND_OPTIONS.
type ChatBackground = 'default' | 'paper' | 'mint' | 'dusk' | 'calm' | 'graphite';
type ContactModal = 'find-people' | 'create-group' | 'profile' | null;
// Source truth: apps/mobile/src/features/group/groupPermissions.ts GroupRole.
type GroupRole = 'owner' | 'admin' | 'member';

const CHAT_BACKGROUNDS: Array<{ id: ChatBackground; label: string }> = [
  { id: 'default', label: 'Default' },
  { id: 'paper', label: 'Paper' },
  { id: 'mint', label: 'Mint' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'calm', label: 'Calm' },
  { id: 'graphite', label: 'Graphite' },
];

const conversations = [
  {
    id: 'c-design',
    kind: 'group' as const,
    title: 'Design Guild',
    preview: 'Nadia: Shipping the composer today',
    time: '10:42',
    unread: 3,
    pinned: true,
    muted: false,
    online: false,
  },
  {
    id: 'c-sarah',
    kind: 'friend' as const,
    title: 'Sarah Jenkins',
    preview: 'See you at the sync',
    time: '09:18',
    unread: 1,
    pinned: false,
    muted: true,
    online: true,
  },
  {
    id: 'c-ops',
    kind: 'group' as const,
    title: 'Station Ops',
    preview: 'You: Invite accepted',
    time: 'Yesterday',
    unread: 0,
    pinned: false,
    muted: false,
    online: false,
  },
];

const friends = [
  { did: 'did:pt:sarah', name: 'Sarah Jenkins', handle: '@sarah@local.station', state: 'Online' },
  { did: 'did:pt:alex', name: 'Alex Chen', handle: '@alex@relay.peers', state: 'Last seen 2h ago' },
];

const groups = [
  { did: 'group:design-guild', name: 'Design Guild', state: '24 members' },
  { did: 'group:station-ops', name: 'Station Ops', state: '8 members' },
];

const threadMessages = [
  { id: 'm1', mine: false, author: 'Sarah', text: 'Are we still on for the 3pm review?', time: '09:12' },
  { id: 'm2', mine: true, author: 'You', text: 'Yes — pushing the composer branch now.', time: '09:14' },
  { id: 'm3', mine: false, author: 'Sarah', text: 'Perfect. I left notes on the thread layout.', time: '09:15' },
];

export function MobilePrototype() {
  const [stage, setStage] = useState<LaunchStage>('station');
  const [gateVariant, setGateVariant] = useState<GateVariant>('login');
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [chatMode, setChatMode] = useState<ChatMode>('list');
  const [contactModal, setContactModal] = useState<ContactModal>(null);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const tabbarHidden = activeTab === 'chat' && chatMode !== 'list';

  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
    setChatMode('list');
    setContactModal(null);
    setActionSheetOpen(false);
  };

  return (
    <div className="mp-root">
      <div className="mp-stage">
        <section className="device-frame" aria-label="Mobile prototype device">
          <div className="device-statusbar">
            <span>9:41</span>
            <span className="device-statusbar-right">
              <span>5G</span>
              <span>100%</span>
            </span>
          </div>
          <div className="device-viewport">
            {stage === 'station' ? <StationScreen onContinue={() => setStage('access-gate')} /> : null}
            {stage === 'access-gate' ? (
              <AccessGateScreen
                variant={gateVariant}
                onBack={() => setStage('station')}
                onGranted={() => setStage('shell')}
              />
            ) : null}
            {stage === 'shell' ? (
              <div className={`mobile-shell ${tabbarHidden ? 'tabbar-hidden' : ''}`}>
                <div className="mobile-content">
                  {activeTab === 'chat' ? (
                    <ChatProjection
                      mode={chatMode}
                      actionSheetOpen={actionSheetOpen}
                      onMode={setChatMode}
                      onActionSheet={setActionSheetOpen}
                    />
                  ) : null}
                  {activeTab === 'moments' ? <MomentsProjection /> : null}
                  {activeTab === 'contacts' ? (
                    <ContactsProjection modal={contactModal} onModal={setContactModal} onOpenChat={() => selectTab('chat')} />
                  ) : null}
                  {activeTab === 'settings' ? (
                    <SettingsProjection
                      onChangeStation={() => setStage('station')}
                      onLogout={() => {
                        setGateVariant('login');
                        setStage('access-gate');
                      }}
                    />
                  ) : null}
                </div>
                {!tabbarHidden ? <MobileTabbar activeTab={activeTab} onSelect={selectTab} /> : null}
              </div>
            ) : null}
          </div>
        </section>

        <PrototypeNav
          stage={stage}
          gateVariant={gateVariant}
          onStage={setStage}
          onGateVariant={setGateVariant}
        />
      </div>
    </div>
  );
}

// Prototype navigation lives outside the device frame. It is scaffolding for review
// reachability (L3), never product chrome inside the mobile surface.
function PrototypeNav({
  stage,
  gateVariant,
  onStage,
  onGateVariant,
}: {
  stage: LaunchStage;
  gateVariant: GateVariant;
  onStage: (stage: LaunchStage) => void;
  onGateVariant: (variant: GateVariant) => void;
}) {
  const stages: Array<{ id: LaunchStage; label: string }> = [
    { id: 'station', label: 'Station' },
    { id: 'access-gate', label: 'Access gate' },
    { id: 'shell', label: 'Shell' },
  ];
  const gates: Array<{ id: GateVariant; label: string }> = [
    { id: 'login', label: 'Login' },
    { id: 'invite', label: 'Invite' },
    { id: 'blocked', label: 'Blocked' },
    { id: 'preparing', label: 'Preparing' },
  ];
  return (
    <aside className="proto-nav" aria-label="Prototype navigation">
      <div className="proto-nav-kicker">Source-backed prototype · drafting</div>
      <div className="proto-nav-group">
        <span className="proto-nav-label">Launch stage</span>
        <div className="proto-nav-row">
          {stages.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`proto-nav-chip ${stage === item.id ? 'active' : ''}`}
              onClick={() => onStage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {stage === 'access-gate' ? (
        <div className="proto-nav-group">
          <span className="proto-nav-label">Station-driven gate</span>
          <div className="proto-nav-row">
            {gates.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`proto-nav-chip ${gateVariant === item.id ? 'active' : ''}`}
                onClick={() => onGateVariant(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <ul className="proto-nav-sources">
        <li>App.tsx · station / access-gate / shell</li>
        <li>MobileShell.tsx · tabs, badges, tabbar-hidden</li>
        <li>ChatPage.tsx · list, thread, action sheet, composer</li>
        <li>ContactsPage.tsx · requests, friends, groups</li>
        <li>MomentsPage.tsx · composer, image upload states</li>
        <li>SettingsPage.tsx · profile, station, blocked, logout</li>
      </ul>
    </aside>
  );
}

function StationScreen({ onContinue }: { onContinue: () => void }) {
  const [stations, setStations] = useState([
    { title: 'Local Station', url: 'http://localhost:9000', trust: 'local' as const, verified: true },
    { title: 'Review Station', url: 'https://review.peers.social', trust: 'remote' as const, verified: false },
  ]);
  const [selectedUrl, setSelectedUrl] = useState(stations[0]?.url ?? '');
  const [protocol, setProtocol] = useState<'https' | 'http'>('https');
  const [draftAddress, setDraftAddress] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [verifyingUrl, setVerifyingUrl] = useState('');

  const selectedStation = stations.find((station) => station.url === selectedUrl);

  const addStation = () => {
    const trimmed = draftAddress.trim();
    if (!trimmed) return;
    const url = trimmed.startsWith('http') ? trimmed : `${protocol}://${trimmed}`;
    if (stations.some((station) => station.url === url)) {
      setError('This Station is already in your list.');
      return;
    }
    setStations((current) => [
      ...current,
      { title: trimmed.replace(/^https?:\/\//, ''), url, trust: protocol === 'http' ? 'warning' : 'remote', verified: false },
    ]);
    setSelectedUrl(url);
    setDraftAddress('');
    setAdding(false);
    setError('');
  };

  const verifyStation = (url: string) => {
    setVerifyingUrl(url);
    window.setTimeout(() => {
      setStations((current) => current.map((item) => (item.url === url ? { ...item, verified: true } : item)));
      setVerifyingUrl('');
    }, 500);
  };

  return (
    <main className="page-surface launch-screen">
      <header className="launch-brand">
        <div className="launch-brand-top">
          <span className="brand-wordmark">Peers Touch</span>
          <button className="language-switcher" type="button">中文</button>
        </div>
        <p className="launch-kicker">Peers Touch Mobile</p>
        <h1 className="page-title">Choose your Station</h1>
        <p className="launch-lead">Connect to a Station to enter the decentralized network.</p>
      </header>

      <section className="launch-body">
        <div className="section-label-row">
          <span className="section-label">Your Stations</span>
          {!adding ? (
            <button className="link-action" type="button" onClick={() => setAdding(true)}>
              <Plus size={15} />
              Add Station
            </button>
          ) : null}
        </div>

        {adding ? (
          <div className="field-block">
            {/* Case 001: protocol + address are one composite input inside a single FieldFrame. */}
            <div className={`address-field ${error ? 'invalid' : ''}`}>
              <button
                type="button"
                className="address-protocol"
                onClick={() => setProtocol((value) => (value === 'https' ? 'http' : 'https'))}
                aria-label="Toggle protocol"
              >
                {protocol}
              </button>
              <input
                className="address-input"
                value={draftAddress}
                placeholder="station.example.com"
                inputMode="url"
                aria-label="Station address"
                onChange={(event) => {
                  setDraftAddress(event.target.value);
                  setError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addStation();
                }}
              />
              <button type="button" className="address-submit" aria-label="Add Station" disabled={!draftAddress.trim()} onClick={addStation}>
                <Plus size={16} />
              </button>
            </div>
            <div className="field-foot">
              {protocol === 'http' ? (
                <span className="field-hint warning">
                  <AlertTriangle size={13} />
                  HTTP is for local development only.
                </span>
              ) : (
                <span className="field-hint">Enter a Station domain or address.</span>
              )}
              <button type="button" className="link-action subtle" onClick={() => { setAdding(false); setError(''); }}>
                Cancel
              </button>
            </div>
            {error ? <span className="field-error">{error}</span> : null}
          </div>
        ) : null}

        <div className="station-list">
          {stations.map((station) => (
            <StationRow
              key={station.url}
              title={station.title}
              url={station.url}
              trust={station.trust}
              verified={station.verified}
              selected={selectedUrl === station.url}
              verifying={verifyingUrl === station.url}
              onSelect={() => setSelectedUrl(station.url)}
              onVerify={() => verifyStation(station.url)}
              onRemove={() => {
                setStations((current) => current.filter((item) => item.url !== station.url));
                if (selectedUrl === station.url) {
                  setSelectedUrl(stations.find((item) => item.url !== station.url)?.url ?? '');
                }
              }}
            />
          ))}
        </div>
      </section>

      <footer className="launch-footer">
        {selectedStation ? (
          <div className="active-station-note">
            <span className="meta">Active Station</span>
            <strong className="truncate">{selectedStation.title}</strong>
          </div>
        ) : null}
        <button className="btn-primary" type="button" disabled={!selectedUrl} onClick={onContinue}>
          Continue
        </button>
      </footer>
    </main>
  );
}

function StationRow({
  title,
  url,
  trust,
  verified,
  selected,
  verifying,
  onSelect,
  onVerify,
  onRemove,
}: {
  title: string;
  url: string;
  trust: 'local' | 'remote' | 'warning';
  verified: boolean;
  selected: boolean;
  verifying: boolean;
  onSelect: () => void;
  onVerify: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={`station-row ${selected ? 'selected' : ''}`} role="button" tabIndex={0} onClick={onSelect}>
      <span className={`station-glyph trust-${trust}`}>
        <Server size={18} />
      </span>
      <span className="station-copy">
        <strong className="truncate">{title}</strong>
        <span className="station-meta">
          <small className="truncate">{url}</small>
          {verifying ? (
            <span className="status-chip validating">
              <Loader size={12} className="spin" />
              Checking
            </span>
          ) : verified ? (
            <span className="status-chip verified">
              <Check size={12} />
              Verified
            </span>
          ) : (
            <button type="button" className="status-chip verify" onClick={(event) => { event.stopPropagation(); onVerify(); }}>
              Not verified · Check
            </button>
          )}
        </span>
      </span>
      <span className="station-tail">
        {selected ? <Check size={16} className="station-selected-mark" /> : null}
        <button
          type="button"
          className="icon-btn ghost danger"
          aria-label={`Remove ${title}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={15} />
        </button>
      </span>
    </div>
  );
}

function AccessGateScreen({
  variant,
  onBack,
  onGranted,
}: {
  variant: GateVariant;
  onBack: () => void;
  onGranted: () => void;
}) {
  const [email, setEmail] = useState('owner@peers.local');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const title =
    variant === 'invite'
      ? 'Enter invite code'
      : variant === 'blocked'
        ? 'Access blocked'
        : variant === 'preparing'
          ? 'Preparing access'
          : 'Sign in to Station';

  const submit = () => {
    if (variant === 'blocked' || variant === 'preparing') return;
    if (variant === 'login' && (!email.trim() || !password)) {
      setError('Enter your email and password to continue.');
      return;
    }
    if (variant === 'invite' && !inviteCode.trim()) {
      setError('Enter the invite code from your Station.');
      return;
    }
    setError('');
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      onGranted();
    }, 500);
  };

  return (
    <main className="page-surface auth-screen">
      <header className="launch-brand">
        <div className="launch-brand-top">
          <span className="brand-wordmark">Peers Touch</span>
          <button className="language-switcher" type="button">EN</button>
        </div>
        <p className="launch-kicker">Peers Touch Mobile</p>
        <h1 className="page-title">{title}</h1>
      </header>

      <section className="auth-body">
        <div className="station-summary">
          <span className="station-glyph trust-local">
            <Server size={18} />
          </span>
          <span className="station-copy">
            <strong className="truncate">Local Station</strong>
            <small className="truncate">http://localhost:9000</small>
          </span>
        </div>

        <div className={`gate-note ${variant}`}>
          {variant === 'invite' ? <KeyRound size={17} /> : null}
          {variant === 'blocked' ? <Ban size={17} /> : null}
          {variant === 'preparing' ? <Loader size={17} className="spin" /> : null}
          {variant === 'login' ? <LockKeyhole size={17} /> : null}
          <span>
            {variant === 'preparing'
              ? 'Checking access with your Station…'
              : variant === 'blocked'
                ? 'Your Station has blocked access for this account. Contact your Station operator.'
                : variant === 'invite'
                  ? 'This Station requires an invite code to join.'
                  : 'Sign in with the account registered on this Station.'}
          </span>
        </div>

        {variant === 'login' ? (
          <div className="auth-fields">
            <div className="recent-accounts">
              <span className="section-label">Recent accounts</span>
              <div className="recent-account-row">
                {[
                  { label: 'Owner Account', email: 'owner@peers.local' },
                  { label: 'Reviewer Account', email: 'reviewer@peers.local' },
                ].map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    className={`account-chip ${email === account.email ? 'active' : ''}`}
                    onClick={() => setEmail(account.email)}
                  >
                    <strong className="truncate">{account.label}</strong>
                    <small className="truncate">{account.email}</small>
                  </button>
                ))}
              </div>
            </div>
            <label className="text-field">
              <span className="text-field-label">Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@station" />
            </label>
            <label className="text-field">
              <span className="text-field-label">Password</span>
              <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
            </label>
          </div>
        ) : null}

        {variant === 'invite' ? (
          <div className="auth-fields">
            <label className="text-field">
              <span className="text-field-label">Invite code</span>
              <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX" />
            </label>
          </div>
        ) : null}

        {error ? <span className="field-error">{error}</span> : null}
      </section>

      <footer className="auth-footer">
        <button type="button" className="btn-secondary" onClick={onBack}>
          <ArrowLeft size={16} />
          Change Station
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={loading || variant === 'blocked' || variant === 'preparing'}
          onClick={submit}
        >
          {loading ? 'Signing in…' : variant === 'invite' ? 'Join Station' : 'Sign in'}
        </button>
      </footer>
    </main>
  );
}

function MobileTabbar({ activeTab, onSelect }: { activeTab: TabId; onSelect: (tab: TabId) => void }) {
  const tabs: Array<{ id: TabId; label: string; icon: typeof MessageCircle; badge?: number }> = [
    { id: 'chat', label: 'Chat', icon: MessageCircle, badge: 4 },
    { id: 'moments', label: 'Moments', icon: Image },
    { id: 'contacts', label: 'Contacts', icon: Users, badge: 1 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];
  return (
    <nav className="mobile-tabbar" aria-label="Mobile tabs">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = activeTab === tab.id;
        return (
          <button key={tab.id} className={`tabbar-item ${active ? 'active' : ''}`} type="button" onClick={() => onSelect(tab.id)}>
            <span className="tabbar-icon">
              <Icon size={22} strokeWidth={active ? 2.2 : 1.7} />
              {tab.badge ? <span className="badge-dot">{tab.badge}</span> : null}
            </span>
            <span className="tabbar-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ChatProjection({
  mode,
  actionSheetOpen,
  onMode,
  onActionSheet,
}: {
  mode: ChatMode;
  actionSheetOpen: boolean;
  onMode: (mode: ChatMode) => void;
  onActionSheet: (open: boolean) => void;
}) {
  const [composerPanel, setComposerPanel] = useState<ComposerPanel>(null);
  const [draft, setDraft] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [recalledMessageIds, setRecalledMessageIds] = useState<string[]>([]);
  const [deletedMessageIds, setDeletedMessageIds] = useState<string[]>([]);
  const [attachmentDrafts, setAttachmentDrafts] = useState<string[]>([]);
  const [localNotice, setLocalNotice] = useState('');
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [actionState, setActionState] = useState({
    muted: false,
    sticky: true,
    alertEnabled: true,
    background: 'default' as ChatBackground,
    cleared: false,
    peerBlocked: false,
  });

  const isGroup = mode === 'group-thread';

  const toggleComposerPanel = (panel: Exclude<ComposerPanel, null>) => {
    setComposerPanel((current) => (current === panel ? null : panel));
  };
  const updateActionState = (patch: Partial<typeof actionState>) => {
    setActionState((current) => ({ ...current, ...patch }));
  };

  if (mode !== 'list') {
    const visibleMessages = threadMessages.filter((message) => !deletedMessageIds.includes(message.id));
    const composerDisabled = mode === 'friend-thread' && actionState.peerBlocked;

    return (
      <div className={`page-container chat-thread chat-bg-${actionState.background}`}>
        <header className="thread-header">
          <button className="icon-btn ghost" type="button" aria-label="Back" onClick={() => onMode('list')}>
            <ArrowLeft size={18} />
          </button>
          <span className={`avatar ${isGroup ? 'group' : ''}`}>{isGroup ? 'D' : 'S'}</span>
          <div className="thread-heading">
            <strong className="truncate">{isGroup ? 'Design Guild' : 'Sarah Jenkins'}</strong>
            <small>{isGroup ? '24 members · encrypted' : 'Online'}</small>
          </div>
          <button className="icon-btn ghost" type="button" aria-label="More actions" onClick={() => onActionSheet(true)}>
            <MoreHorizontal size={18} />
          </button>
        </header>

        {localNotice ? <InlineNotice onClose={() => setLocalNotice('')}>{localNotice}</InlineNotice> : null}

        <section className="message-viewport" aria-label="Messages">
          {actionState.cleared ? (
            <div className="thread-system-note">History cleared on this device</div>
          ) : null}
          {visibleMessages.map((message) => {
            const recalled = recalledMessageIds.includes(message.id);
            const selected = selectedMessageId === message.id;
            return (
              <div key={message.id} className={`message-row ${message.mine ? 'mine' : 'peer'}`}>
                {!message.mine ? <span className="message-avatar">{isGroup ? message.author.slice(0, 1) : 'S'}</span> : null}
                <div className="message-column">
                  <button
                    type="button"
                    className={`message-bubble ${recalled ? 'recalled' : ''} ${selected ? 'selected' : ''}`}
                    onClick={() => {
                      if (recalled) return;
                      setSelectedMessageId((current) => (current === message.id ? null : message.id));
                    }}
                  >
                    <span className="message-text">{recalled ? 'You recalled a message' : message.text}</span>
                  </button>
                  <span className="message-meta">
                    <small>{message.time}</small>
                    {message.mine && !recalled ? <CheckCheck size={12} className="read-mark" /> : null}
                  </span>
                  {/* Case 002 / chat-message-boundaries: actions render below the bubble,
                      outside the readable body, never as an overlay covering content. */}
                  {selected && message.mine && !recalled ? (
                    <div className="message-action-anchor">
                      <button
                        type="button"
                        className="anchor-action"
                        aria-label="Edit message"
                        onClick={() => {
                          setEditingMessageId(message.id);
                          setDraft(message.text);
                          setComposerPanel(null);
                          setSelectedMessageId(null);
                        }}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="anchor-action"
                        aria-label="Recall message"
                        onClick={() => {
                          setRecalledMessageIds((current) => [...new Set([...current, message.id])]);
                          setSelectedMessageId(null);
                        }}
                      >
                        <RotateCcw size={14} />
                      </button>
                      <button
                        type="button"
                        className="anchor-action danger"
                        aria-label="Delete message"
                        onClick={() => {
                          setDeletedMessageIds((current) => [...new Set([...current, message.id])]);
                          setSelectedMessageId(null);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>

        {composerDisabled ? (
          <footer className="composer disabled">
            <span className="composer-disabled-copy">
              <Ban size={15} />
              You blocked this contact. Unblock to send messages.
            </span>
          </footer>
        ) : (
          <footer className="composer">
            {editingMessageId ? (
              <div className="composer-editing-banner">
                <span>Editing message</span>
                <button
                  type="button"
                  className="icon-btn ghost"
                  aria-label="Cancel edit"
                  onClick={() => {
                    setEditingMessageId(null);
                    setDraft('');
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}

            {composerPanel === 'emoji' ? (
              <div className="composer-panel emoji-panel">
                {['👍', '❤️', '😂', '🎉', '🙏', '👀', '🔥', '✅'].map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="emoji-cell"
                    aria-label="Insert emoji"
                    onClick={() => setDraft((current) => current + emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}

            {composerPanel === 'more' ? (
              <div className="composer-panel tool-panel">
                <ComposerTool icon={<FolderOpen size={18} />} label="File" onClick={() => setComposerPanel('attachment')} />
                <ComposerTool icon={<Scissors size={18} />} label="Screenshot" onClick={() => setLocalNotice('Screenshot capture is a mobile runtime capability.')} />
                <ComposerTool icon={<Mic size={18} />} label="Voice" onClick={() => setLocalNotice('Voice capture requires the mobile runtime.')} />
              </div>
            ) : null}

            {composerPanel === 'attachment' || attachmentDrafts.length > 0 ? (
              <div className="composer-panel attachment-panel">
                {attachmentDrafts.map((name) => (
                  <div className="attachment-chip" key={name}>
                    <Paperclip size={14} />
                    <span className="truncate">{name}</span>
                    <button
                      type="button"
                      className="icon-btn ghost xs"
                      aria-label="Remove attachment"
                      onClick={() => setAttachmentDrafts((current) => current.filter((item) => item !== name))}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {composerPanel === 'attachment' ? (
                  <button
                    type="button"
                    className="attachment-add"
                    onClick={() => setAttachmentDrafts((current) => [...current, `file-${current.length + 1}.pdf`])}
                  >
                    <Plus size={14} />
                    Add file
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="composer-bar">
              <button
                type="button"
                className={`icon-btn ${composerPanel === 'emoji' ? 'active' : 'ghost'}`}
                aria-label="Emoji"
                onClick={() => toggleComposerPanel('emoji')}
              >
                <Smile size={20} />
              </button>
              <input
                className="composer-input"
                value={draft}
                placeholder="Message"
                aria-label="Message composer"
                onChange={(event) => setDraft(event.target.value)}
              />
              <button
                type="button"
                className={`icon-btn ${composerPanel === 'more' ? 'active' : 'ghost'}`}
                aria-label="More tools"
                onClick={() => toggleComposerPanel('more')}
              >
                <Plus size={20} />
              </button>
              <button
                type="button"
                className="btn-send"
                aria-label="Send"
                disabled={!draft.trim()}
                onClick={() => {
                  setDraft('');
                  setEditingMessageId(null);
                  setComposerPanel(null);
                }}
              >
                <Send size={16} />
              </button>
            </div>
          </footer>
        )}

        {actionSheetOpen ? (
          <ChatActionSheet
            state={actionState}
            isGroup={isGroup}
            onState={updateActionState}
            onClose={() => onActionSheet(false)}
            onSearch={() => {
              setLocalNotice('Search in conversation.');
              onActionSheet(false);
            }}
            onManageGroup={() => {
              setGroupManageOpen(true);
              onActionSheet(false);
            }}
          />
        ) : null}
        {groupManageOpen ? <GroupManagementSheet onClose={() => setGroupManageOpen(false)} /> : null}
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">Chat</h1>
      </header>
      <div className="search-bar">
        <span className="search-field">
          <Search size={16} />
          <span className="search-placeholder">Search conversations</span>
        </span>
      </div>
      <section className="list-section">
        <div className="cell-list">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className="conversation-cell"
              type="button"
              onClick={() => onMode(conversation.kind === 'group' ? 'group-thread' : 'friend-thread')}
            >
              <span className="avatar-frame">
                <span className={`avatar ${conversation.kind === 'group' ? 'group' : ''}`}>{conversation.title.slice(0, 1)}</span>
                {conversation.online ? <span className="online-dot" aria-hidden="true" /> : null}
              </span>
              <span className="conversation-copy">
                <span className="conversation-title">
                  <strong className="truncate">{conversation.title}</strong>
                  {conversation.pinned ? <Pin size={12} className="title-icon" /> : null}
                  {conversation.muted ? <VolumeX size={12} className="title-icon" /> : null}
                </span>
                <span className="conversation-preview truncate">{conversation.preview}</span>
              </span>
              <span className="conversation-tail">
                <small>{conversation.time}</small>
                {conversation.unread ? <span className="badge-dot inline">{conversation.unread}</span> : null}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChatActionSheet({
  isGroup,
  state,
  onState,
  onClose,
  onSearch,
  onManageGroup,
}: {
  isGroup: boolean;
  state: {
    muted: boolean;
    sticky: boolean;
    alertEnabled: boolean;
    background: ChatBackground;
    cleared: boolean;
    peerBlocked: boolean;
  };
  onState: (patch: Partial<{
    muted: boolean;
    sticky: boolean;
    alertEnabled: boolean;
    background: ChatBackground;
    cleared: boolean;
    peerBlocked: boolean;
  }>) => void;
  onClose: () => void;
  onSearch: () => void;
  onManageGroup: () => void;
}) {
  return (
    <div className="sheet-shell">
      <button className="sheet-backdrop" type="button" aria-label="Close" onClick={onClose} />
      <aside className="bottom-sheet" role="dialog" aria-modal="true" aria-label="Conversation actions">
        <span className="sheet-handle" aria-hidden="true" />
        <div className="sheet-header">
          <strong>Conversation</strong>
          <button className="icon-btn ghost" type="button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="sheet-body">
          <div className="sheet-group">
            <SheetAction icon={<Search size={18} />} title="Search in conversation" onClick={onSearch} />
            <SheetAction icon={<VolumeX size={18} />} title="Mute" active={state.muted} onClick={() => onState({ muted: !state.muted })} />
            <SheetAction icon={<Pin size={18} />} title="Pin to top" active={state.sticky} onClick={() => onState({ sticky: !state.sticky })} />
            <SheetAction icon={<Bell size={18} />} title="Alerts" active={state.alertEnabled} onClick={() => onState({ alertEnabled: !state.alertEnabled })} />
          </div>

          <div className="sheet-subsection">
            <span className="section-label">Background</span>
            <div className="background-grid">
              {CHAT_BACKGROUNDS.map((background) => (
                <button
                  key={background.id}
                  type="button"
                  className={`background-swatch chat-bg-${background.id} ${state.background === background.id ? 'active' : ''}`}
                  aria-label={background.label}
                  onClick={() => onState({ background: background.id })}
                >
                  {state.background === background.id ? <Check size={14} /> : null}
                  <span>{background.label}</span>
                </button>
              ))}
            </div>
          </div>

          {isGroup ? (
            <div className="sheet-group">
              <SheetAction icon={<Users size={18} />} title="Group members" onClick={onManageGroup} />
            </div>
          ) : null}

          <div className="sheet-group danger-group">
            {state.cleared ? (
              <SheetAction icon={<RotateCcw size={18} />} title="Restore history" onClick={() => onState({ cleared: false })} />
            ) : null}
            <SheetAction icon={<Trash2 size={18} />} title="Clear history" danger onClick={() => onState({ cleared: true })} />
            {!isGroup ? (
              state.peerBlocked ? (
                <SheetAction icon={<RotateCcw size={18} />} title="Unblock contact" onClick={() => onState({ peerBlocked: false })} />
              ) : (
                <SheetAction icon={<Ban size={18} />} title="Block contact" danger onClick={() => onState({ peerBlocked: true })} />
              )
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

function SheetAction({ icon, title, active, danger, onClick }: { icon: ReactNode; title: string; active?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button className={`sheet-action ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} type="button" onClick={onClick}>
      <span className="sheet-action-icon">{icon}</span>
      <span className="sheet-action-title">{title}</span>
      {active ? <Check size={16} className="sheet-action-check" /> : null}
    </button>
  );
}

function ComposerTool({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="composer-tool" type="button" onClick={onClick}>
      <span className="composer-tool-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function InlineNotice({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="inline-notice" role="status">
      <span>{children}</span>
      <button type="button" className="icon-btn ghost xs" aria-label="Dismiss" onClick={onClose}>
        <X size={13} />
      </button>
    </div>
  );
}

// Source truth: apps/mobile/src/features/group/groupPermissions.ts getMobileGroupMemberControlState.
function memberControlState(input: { myRole: GroupRole; targetRole: GroupRole; isSelf: boolean }) {
  const rank: Record<GroupRole, number> = { member: 0, admin: 1, owner: 2 };
  const canManageGroupMembers = input.myRole === 'owner' || input.myRole === 'admin';
  const canManageTarget =
    canManageGroupMembers &&
    !input.isSelf &&
    input.targetRole !== 'owner' &&
    (input.myRole === 'owner' || rank[input.targetRole] < rank[input.myRole]);
  const isOwner = input.myRole === 'owner';
  return {
    canPromoteOrDemote: canManageTarget && isOwner,
    canMute: canManageTarget,
    canRemove: canManageTarget,
  };
}

function GroupManagementSheet({ onClose }: { onClose: () => void }) {
  const myRole: GroupRole = 'owner';
  const [groupMuted, setGroupMuted] = useState(false);
  const [myMuted, setMyMuted] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [showNicknames, setShowNicknames] = useState(true);
  const [members, setMembers] = useState<Array<{ did: string; name: string; role: GroupRole; muted: boolean }>>([
    { did: 'did:pt:owner', name: 'Owner Account', role: 'owner', muted: false },
    { did: 'did:pt:sarah', name: 'Sarah Jenkins', role: 'admin', muted: false },
    { did: 'did:pt:alex', name: 'Alex Chen', role: 'member', muted: true },
  ]);
  const [inviteCandidates, setInviteCandidates] = useState(['Nina Park', 'Morgan Lee']);
  const canTransferOwnership = myRole === 'owner';

  return (
    <PrototypeModal title="Group members" onClose={onClose}>
      <div className="group-manage">
        <SectionTitle title="Group profile" />
        <label className="text-field">
          <span className="text-field-label">Name</span>
          <input defaultValue="Design Guild" aria-label="Group name" />
        </label>
        <label className="text-field">
          <span className="text-field-label">Description</span>
          <textarea defaultValue="Product design working group." aria-label="Group description" />
        </label>
        <button className="btn-primary" type="button">Save profile</button>

        <SectionTitle title="Notifications" />
        <ToggleRow label="Group muted" checked={groupMuted} onToggle={() => setGroupMuted((value) => !value)} />
        <ToggleRow label="Mute my messages" checked={myMuted} onToggle={() => setMyMuted((value) => !value)} />
        <ToggleRow label="Pin to top" checked={pinned} onToggle={() => setPinned((value) => !value)} />
        <ToggleRow label="Show member nicknames" checked={showNicknames} onToggle={() => setShowNicknames((value) => !value)} />

        <SectionTitle title="Members" count={members.length} />
        <div className="member-list">
          {members.map((member) => {
            const control = memberControlState({ myRole, targetRole: member.role, isSelf: member.did === 'did:pt:owner' });
            return (
              <div className="member-row" key={member.did}>
                <span className="avatar">{member.name.slice(0, 1)}</span>
                <span className="member-copy">
                  <strong className="truncate">{member.name}</strong>
                  <small className="truncate">{member.did}</small>
                </span>
                <span className={`role-tag role-${member.role}`}>{member.role}</span>
                {member.muted ? <span className="role-tag muted">muted</span> : null}
                <span className="member-actions">
                  {control.canPromoteOrDemote ? (
                    <button
                      type="button"
                      className="icon-btn ghost"
                      aria-label={member.role === 'admin' ? 'Demote to member' : 'Promote to admin'}
                      onClick={() =>
                        setMembers((current) =>
                          current.map((item) => (item.did === member.did ? { ...item, role: item.role === 'admin' ? 'member' : 'admin' } : item)),
                        )
                      }
                    >
                      {member.role === 'admin' ? <ChevronsDown size={16} /> : <ChevronsUp size={16} />}
                    </button>
                  ) : null}
                  {control.canMute ? (
                    <button
                      type="button"
                      className="icon-btn ghost"
                      aria-label={member.muted ? 'Unmute member' : 'Mute member'}
                      onClick={() => setMembers((current) => current.map((item) => (item.did === member.did ? { ...item, muted: !item.muted } : item)))}
                    >
                      {member.muted ? <Volume2 size={16} /> : <VolumeX size={16} />}
                    </button>
                  ) : null}
                  {control.canRemove ? (
                    <button
                      type="button"
                      className="icon-btn ghost danger"
                      aria-label="Remove member"
                      onClick={() => setMembers((current) => current.filter((item) => item.did !== member.did))}
                    >
                      <UserMinus size={16} />
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>

        <SectionTitle title="Invite friends" count={inviteCandidates.length} />
        <div className="member-list">
          {inviteCandidates.map((name) => (
            <div className="member-row" key={name}>
              <span className="avatar">{name.slice(0, 1)}</span>
              <span className="member-copy">
                <strong className="truncate">{name}</strong>
                <small className="truncate">Friend</small>
              </span>
              <button className="btn-secondary sm" type="button" onClick={() => setInviteCandidates((current) => current.filter((item) => item !== name))}>
                <UserPlus size={15} />
                Invite
              </button>
            </div>
          ))}
        </div>

        {/* Owner transfer and destructive group action are grouped once at the footer. */}
        <div className="group-danger-zone">
          {canTransferOwnership ? (
            <button className="btn-ghost-danger" type="button">
              <Crown size={16} />
              Transfer ownership
            </button>
          ) : null}
          <button className="btn-ghost-danger" type="button">
            {canTransferOwnership ? <Trash2 size={16} /> : <LogOut size={16} />}
            {canTransferOwnership ? 'Dissolve group' : 'Leave group'}
          </button>
        </div>
      </div>
    </PrototypeModal>
  );
}

function ToggleRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <button type="button" className={`switch ${checked ? 'on' : ''}`} onClick={onToggle} aria-label={label} aria-pressed={checked}>
        <span className="switch-knob" />
      </button>
    </div>
  );
}

function ContactsProjection({
  modal,
  onModal,
  onOpenChat,
}: {
  modal: ContactModal;
  onModal: (modal: ContactModal) => void;
  onOpenChat: () => void;
}) {
  const [query, setQuery] = useState('');
  const [friendRequests, setFriendRequests] = useState(['Nina Park']);
  // Source truth: apps/mobile/src/pages/ContactsPage.tsx:320-336 renders sent
  // requests read-only ("waiting for accept"). socialStore exposes accept/reject/
  // send only — there is no cancel/withdraw action.
  const sentRequests = ['Taylor Reed'];
  const normalized = query.trim().toLowerCase();
  const filteredFriends = friends.filter((contact) => contact.name.toLowerCase().includes(normalized));
  const filteredGroups = groups.filter((group) => group.name.toLowerCase().includes(normalized));

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">Contacts</h1>
        <span className="header-actions">
          <button className="icon-btn ghost" type="button" aria-label="Create group" onClick={() => onModal('create-group')}>
            <Users size={20} />
          </button>
          <button className="icon-btn ghost" type="button" aria-label="Find people" onClick={() => onModal('find-people')}>
            <UserPlus size={20} />
          </button>
        </span>
      </header>
      <div className="search-bar">
        <label className="search-field">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contacts" aria-label="Search contacts" />
        </label>
      </div>
      <section className="list-section scroll">
        {friendRequests.length > 0 ? (
          <>
            <SectionTitle title="Friend requests" count={friendRequests.length} />
            <div className="cell-list">
              {friendRequests.map((name) => (
                <div className="contact-cell" key={name}>
                  <span className="avatar">{name.slice(0, 1)}</span>
                  <span className="contact-copy">
                    <strong className="truncate">{name}</strong>
                    <small className="truncate">Would like to connect</small>
                  </span>
                  <span className="row-actions">
                    <button type="button" className="icon-btn primary-soft" aria-label="Accept request" onClick={() => setFriendRequests((current) => current.filter((item) => item !== name))}>
                      <Check size={16} />
                    </button>
                    <button type="button" className="icon-btn ghost" aria-label="Decline request" onClick={() => setFriendRequests((current) => current.filter((item) => item !== name))}>
                      <X size={16} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <SectionTitle title="Friends" count={filteredFriends.length} />
        <div className="cell-list">
          {filteredFriends.length > 0 ? (
            filteredFriends.map((contact) => (
              <button key={contact.did} className="contact-cell" type="button" onClick={() => onModal('profile')}>
                <span className="avatar">{contact.name.slice(0, 1)}</span>
                <span className="contact-copy">
                  <strong className="truncate">{contact.name}</strong>
                  <small className="truncate">{contact.handle}</small>
                </span>
                <ChevronRight size={16} className="cell-chevron" />
              </button>
            ))
          ) : (
            <EmptyState title={normalized ? 'No matching friends' : 'No friends yet'} />
          )}
        </div>

        <SectionTitle title="Groups" count={filteredGroups.length} />
        <div className="cell-list">
          {filteredGroups.length > 0 ? (
            filteredGroups.map((group) => (
              <button key={group.did} className="contact-cell" type="button" onClick={onOpenChat}>
                <span className="avatar group">
                  <Users size={16} />
                </span>
                <span className="contact-copy">
                  <strong className="truncate">{group.name}</strong>
                  <small className="truncate">{group.state}</small>
                </span>
                <ChevronRight size={16} className="cell-chevron" />
              </button>
            ))
          ) : (
            <EmptyState title={normalized ? 'No matching groups' : 'No groups yet'} />
          )}
        </div>

        {sentRequests.length > 0 ? (
          <>
            <SectionTitle title="Sent requests" count={sentRequests.length} />
            <div className="cell-list">
              {sentRequests.map((name) => (
                <div className="contact-cell" key={name}>
                  <span className="avatar">{name.slice(0, 1)}</span>
                  <span className="contact-copy">
                    <strong className="truncate">{name}</strong>
                    <small className="truncate">Waiting for accept</small>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>

      {modal === 'find-people' ? <FindPeopleModal onClose={() => onModal(null)} /> : null}
      {modal === 'create-group' ? <CreateGroupModal onClose={() => onModal(null)} /> : null}
      {modal === 'profile' ? <ProfileModal onClose={() => onModal(null)} /> : null}
    </div>
  );
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="section-title">
      <strong>{title}</strong>
      {typeof count === 'number' ? <span className="section-count">{count}</span> : null}
    </div>
  );
}

function FindPeopleModal({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [requestSent, setRequestSent] = useState(false);
  const hasResult = query.trim().length > 0;

  return (
    <PrototypeModal title="Find people" onClose={onClose}>
      <div className="find-people">
        <label className="search-field standalone">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Username, DID, or federation handle" aria-label="Find people" />
        </label>
        {hasResult ? (
          <div className="result-cell">
            <span className="avatar">S</span>
            <span className="contact-copy">
              <strong className="truncate">Sarah Jenkins</strong>
              <small className="truncate">@sarah@local.station</small>
            </span>
            <button className="btn-secondary sm" type="button" disabled={requestSent} onClick={() => setRequestSent(true)}>
              {requestSent ? 'Request sent' : 'Add friend'}
            </button>
          </div>
        ) : (
          <EmptyState title="Search across your Station and the federation" />
        )}
      </div>
    </PrototypeModal>
  );
}

function CreateGroupModal({ onClose }: { onClose: () => void }) {
  // Source truth: apps/mobile/src/pages/ContactsPage.tsx — the primary action is
  // gated on a non-empty group name (`disabled: !groupName.trim()`), and
  // submitCreateGroup early-returns when the trimmed name is empty. Members are
  // optional; the name is the fail-closed gate.
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>(['did:pt:sarah']);
  const toggle = (did: string) => {
    setSelected((current) => (current.includes(did) ? current.filter((item) => item !== did) : [...current, did]));
  };

  return (
    <PrototypeModal title="Create group" onClose={onClose}>
      <div className="create-group">
        <label className="text-field">
          <span className="text-field-label">Group name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Design Guild"
            aria-label="Group name"
          />
        </label>
        <label className="text-field">
          <span className="text-field-label">Description</span>
          <textarea placeholder="What is this group about?" aria-label="Group description" />
        </label>
        <SectionTitle title="Initial members" count={selected.length} />
        <div className="cell-list">
          {friends.map((contact) => (
            <button className="contact-cell selectable" type="button" key={contact.did} onClick={() => toggle(contact.did)}>
              <span className="avatar">{contact.name.slice(0, 1)}</span>
              <span className="contact-copy">
                <strong className="truncate">{contact.name}</strong>
                <small className="truncate">{contact.handle}</small>
              </span>
              <span className={`checkbox ${selected.includes(contact.did) ? 'checked' : ''}`}>
                {selected.includes(contact.did) ? <Check size={14} /> : null}
              </span>
            </button>
          ))}
        </div>
        <button className="btn-primary" type="button" disabled={!name.trim()}>
          Create group
        </button>
      </div>
    </PrototypeModal>
  );
}

function ProfileModal({ onClose }: { onClose: () => void }) {
  const [blocked, setBlocked] = useState(false);

  return (
    <PrototypeModal title="Profile" onClose={onClose}>
      <div className="profile-card">
        <span className="avatar xl">S</span>
        <strong className="profile-name">Sarah Jenkins</strong>
        <small className="profile-handle">@sarah@local.station</small>
        <span className={`status-chip ${blocked ? 'blocked' : 'verified'}`}>
          {blocked ? <Ban size={12} /> : <Globe size={12} />}
          {blocked ? 'Blocked' : 'Federated'}
        </span>
        <div className="profile-stats">
          <ProfileStat label="Posts" value="128" />
          <ProfileStat label="Following" value="42" />
          <ProfileStat label="Followers" value="380" />
        </div>
        <button className="btn-primary" type="button" disabled={blocked}>
          Open chat
        </button>
        {blocked ? (
          <button className="btn-secondary" type="button" onClick={() => setBlocked(false)}>
            <RotateCcw size={15} />
            Unblock
          </button>
        ) : (
          <button className="btn-ghost-danger" type="button" onClick={() => setBlocked(true)}>
            <Ban size={15} />
            Block
          </button>
        )}
      </div>
    </PrototypeModal>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="profile-stat">
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="empty-state">
      <span>{title}</span>
    </div>
  );
}

function PrototypeModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-shell">
      <button className="sheet-backdrop" type="button" aria-label="Close" onClick={onClose} />
      <section className="modal-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <strong>{title}</strong>
          <button className="icon-btn ghost" type="button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function MomentsProjection() {
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [images, setImages] = useState<Array<{ id: string; status: 'uploading' | 'done' | 'error' }>>([
    { id: 'uploading', status: 'uploading' },
    { id: 'done', status: 'done' },
    { id: 'error', status: 'error' },
  ]);
  const canPublish = Boolean(text.trim()) && !publishing && images.every((image) => image.status === 'done');

  const addImage = () => {
    if (images.length >= 9) {
      setNotice('You can attach up to 9 images.');
      return;
    }
    // Source truth: apps/mobile/src/pages/MomentsPage.tsx uploadOne auto-resolves
    // the tile (uploading -> done/error). There is no manual "mark ready".
    const id = `image-${images.length + 1}`;
    setImages((current) => [...current, { id, status: 'uploading' }]);
    window.setTimeout(() => {
      setImages((current) => current.map((image) => (image.id === id ? { ...image, status: 'done' } : image)));
    }, 500);
  };
  const retryImage = (id: string) => {
    setImages((current) => current.map((image) => (image.id === id ? { ...image, status: 'uploading' } : image)));
    window.setTimeout(() => {
      setImages((current) => current.map((image) => (image.id === id ? { ...image, status: 'done' } : image)));
    }, 500);
  };
  const publish = () => {
    if (!canPublish) {
      setNotice(!text.trim() ? 'Write something to publish.' : 'Resolve pending or failed images first.');
      return;
    }
    setPublishing(true);
    window.setTimeout(() => {
      setPublishing(false);
      setNotice('Moment published.');
      setText('');
      setImages([]);
    }, 500);
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">Moments</h1>
      </header>
      {notice ? <InlineNotice onClose={() => setNotice('')}>{notice}</InlineNotice> : null}
      <section className="list-section scroll">
        <div className="moments-composer">
          <span className="moments-eyebrow">
            <Globe size={13} />
            Public audience
          </span>
          <label className="composer-textarea">
            <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={5000} placeholder="What is happening?" aria-label="Moment text" />
            <small className="char-count">{text.length}/5000</small>
          </label>
          {images.length > 0 ? (
            <div className="moments-grid">
              {images.map((image) => (
                <div className={`moments-tile ${image.status}`} key={image.id}>
                  <Image size={22} />
                  <span className="moments-tile-status">
                    {image.status === 'uploading' ? 'Uploading' : image.status === 'done' ? 'Ready' : 'Failed'}
                  </span>
                  <div className="moments-tile-actions">
                    {image.status === 'error' ? (
                      <button type="button" className="icon-btn ghost xs" aria-label="Retry upload" onClick={() => retryImage(image.id)}>
                        <RotateCcw size={13} />
                      </button>
                    ) : null}
                    <button type="button" className="icon-btn ghost xs" aria-label="Remove image" onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="moments-actions">
            <button type="button" className="btn-secondary" onClick={addImage} disabled={publishing || images.length >= 9}>
              <ImagePlus size={16} />
              Add image ({images.length}/9)
            </button>
            <button type="button" className="btn-primary" disabled={!canPublish} onClick={publish}>
              <Send size={16} />
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsProjection({ onChangeStation, onLogout }: { onChangeStation: () => void; onLogout: () => void }) {
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState(['did:pt:blocked-1', 'did:pt:blocked-2']);

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
      </header>
      <section className="list-section scroll">
        <div className="settings-profile">
          <span className="avatar xl">O</span>
          <div className="settings-profile-copy">
            <strong>Owner Account</strong>
            <small>owner@peers.local</small>
          </div>
        </div>

        <SectionTitle title="Station" />
        <div className="settings-card">
          <div className="station-summary">
            <span className="station-glyph trust-local">
              <Server size={18} />
            </span>
            <span className="station-copy">
              <strong className="truncate">Local Station</strong>
              <small className="truncate">http://localhost:9000</small>
            </span>
            <span className="status-chip verified">
              <Check size={12} />
              Verified
            </span>
          </div>
          <button type="button" className="btn-secondary block" onClick={onChangeStation}>
            Change Station
          </button>
        </div>

        {/* Source truth: apps/mobile/src/pages/SettingsPage.tsx:72-79 — two plain
            block buttons (Blocked users + Sign out). No Account section, chevron
            rows, or count badge. */}
        <div className="settings-actions">
          <button type="button" className="btn-secondary block" onClick={() => setBlockedOpen(true)}>
            <Ban size={16} />
            Blocked users
          </button>
          <button type="button" className="btn-secondary block" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </section>

      {blockedOpen ? (
        <PrototypeModal title="Blocked users" onClose={() => setBlockedOpen(false)}>
          <div className="cell-list">
            {blockedUsers.length > 0 ? (
              blockedUsers.map((did) => (
                <div className="contact-cell" key={did}>
                  <span className="avatar">{did.slice(7, 8).toUpperCase()}</span>
                  <span className="contact-copy">
                    <strong className="truncate">{did}</strong>
                    <small className="truncate">Blocked</small>
                  </span>
                  <button type="button" className="btn-secondary sm" onClick={() => setBlockedUsers((current) => current.filter((item) => item !== did))}>
                    Unblock
                  </button>
                </div>
              ))
            ) : (
              <EmptyState title="No blocked users" />
            )}
          </div>
        </PrototypeModal>
      ) : null}
    </div>
  );
}

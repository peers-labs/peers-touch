import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  ChevronRight,
  Circle,
  Image,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';

type TabId = 'chat' | 'moments' | 'contacts' | 'settings';
type ContactSheet = 'findPeople' | 'createGroup' | null;

const tabs: { id: TabId; label: string; icon: typeof MessageCircle; badge?: number }[] = [
  { id: 'chat', label: 'Chat', icon: MessageCircle, badge: 3 },
  { id: 'moments', label: 'Moments', icon: Image },
  { id: 'contacts', label: 'Contacts', icon: Users, badge: 1 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const conversations = [
  {
    id: 'group:atelier',
    type: 'Group',
    name: 'Atelier Review',
    message: 'Encrypted group projection is ready for mobile.',
    time: '10:42',
    unread: 2,
    tone: '#4f46e5',
  },
  {
    id: 'friend:sarah',
    type: 'Friend',
    name: 'Sarah Jenkins',
    message: 'Can you review the mobile handoff?',
    time: '09:18',
    unread: 1,
    tone: '#0891b2',
  },
  {
    id: 'group:station',
    type: 'Group',
    name: 'Station Ops',
    message: 'Invite gate passed; session restored.',
    time: 'Yesterday',
    unread: 0,
    tone: '#059669',
  },
];

const contactRows = [
  { name: 'Sarah Jenkins', did: 'did:pt:sarah', status: 'Friend session available' },
  { name: 'Alex Chen', did: 'did:pt:alex', status: 'Available for initial group member' },
  { name: 'Station Ops', did: 'group:station-ops', status: 'Group conversation projection' },
];

const messages = [
  { id: 'm1', text: 'Mobile keeps the active tab mounted only while visited.', mine: false },
  { id: 'm2', text: 'The runtime store owns projection freshness across tabs.', mine: true },
  { id: 'm3', text: 'Thread mode hides the tabbar so the composer owns bottom space.', mine: false },
];

export function MobilePrototype() {
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [threadOpen, setThreadOpen] = useState(false);
  const [contactSheet, setContactSheet] = useState<ContactSheet>(null);
  const hideTabbar = activeTab === 'chat' && threadOpen;
  const title = useMemo(() => {
    if (activeTab === 'chat' && threadOpen) return 'Atelier Review';
    return tabs.find((tab) => tab.id === activeTab)?.label ?? 'Mobile';
  }, [activeTab, threadOpen]);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    setThreadOpen(false);
    setContactSheet(null);
  };

  return (
    <div style={styles.stage}>
      <div style={styles.contextPanel}>
        <div style={styles.contextEyebrow}>Source-backed mobile prototype</div>
        <h2 style={styles.contextTitle}>Aligned to apps/mobile</h2>
        <p style={styles.contextText}>
          This card now mirrors the real MobileShell contract: access gate first, one active tab tree, Friend/Group projections, Contacts find/create actions, and a tabbar hidden in chat thread mode.
        </p>
        <div style={styles.sourceGrid}>
          <SourceItem label="Shell" value="MobileShell.tsx" />
          <SourceItem label="Tabs" value="Chat / Moments / Contacts / Settings" />
          <SourceItem label="Contacts" value="find people + create group" />
          <SourceItem label="Thread" value="composer owns bottom safe area" />
        </div>
      </div>

      <div style={styles.phone}>
        <div style={styles.statusBar}>
          <span>9:41</span>
          <span style={styles.statusIcons}>5G 100%</span>
        </div>

        <header style={styles.header}>
          {threadOpen ? (
            <button type="button" style={styles.backButton} onClick={() => setThreadOpen(false)} aria-label="Back to chats">
              <ArrowLeft size={18} />
            </button>
          ) : null}
          <div>
            <div style={styles.kicker}>{threadOpen ? 'Group thread' : 'Peers Touch Mobile'}</div>
            <strong>{title}</strong>
          </div>
          <div style={styles.headerActions}>
            {activeTab === 'chat' ? <Search size={18} /> : null}
            <Bell size={18} />
          </div>
        </header>

        <section style={styles.accessGate}>
          <div style={styles.gateIcon}>
            <LockKeyhole size={16} />
          </div>
          <div style={styles.gateCopy}>
            <strong>Access granted</strong>
            <span>Station session active · runtime subscriptions online</span>
          </div>
          <CheckCircle2 size={17} color="#059669" />
        </section>

        <main style={styles.content}>
          {activeTab === 'chat' ? (
            threadOpen ? <ThreadView /> : <ChatList onOpenThread={() => setThreadOpen(true)} />
          ) : null}
          {activeTab === 'moments' ? <MomentsView /> : null}
          {activeTab === 'contacts' ? <ContactsView sheet={contactSheet} onSheet={setContactSheet} /> : null}
          {activeTab === 'settings' ? <SettingsView /> : null}
        </main>

        {!hideTabbar ? (
          <nav style={styles.tabbar}>
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  style={{ ...styles.tabbarItem, ...(active ? styles.tabbarItemActive : null) }}
                  onClick={() => switchTab(tab.id)}
                >
                  <span style={styles.tabIconWrap}>
                    <Icon size={22} strokeWidth={active ? 2.2 : 1.6} />
                    {tab.badge ? <span style={styles.badge}>{tab.badge}</span> : null}
                  </span>
                  <span style={styles.tabLabel}>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        ) : null}
      </div>
    </div>
  );
}

function ChatList({ onOpenThread }: { onOpenThread: () => void }) {
  return (
    <div style={styles.pageStack}>
      <div style={styles.searchBar}>
        <Search size={16} />
        <span>Search friends, groups, messages</span>
      </div>
      <div style={styles.sectionLabel}>Conversation projection</div>
      {conversations.map((item, index) => (
        <button key={item.id} type="button" style={styles.conversation} onClick={index === 0 ? onOpenThread : undefined}>
          <div style={{ ...styles.avatar, background: item.tone }}>
            {item.type === 'Group' ? <Users size={17} /> : <MessageCircle size={17} />}
          </div>
          <div style={styles.conversationBody}>
            <div style={styles.row}>
              <strong>{item.name}</strong>
              <span>{item.time}</span>
            </div>
            <p style={styles.conversationText}>{item.message}</p>
            <span style={styles.kindPill}>{item.type}</span>
          </div>
          {item.unread ? <span style={styles.unread}>{item.unread}</span> : <ChevronRight size={16} color="#94a3b8" />}
        </button>
      ))}
    </div>
  );
}

function ThreadView() {
  return (
    <div style={styles.threadPage}>
      <div style={styles.threadMeta}>
        <span style={styles.secure}>
          <ShieldCheck size={13} />
          Group E2EE ready
        </span>
        <button type="button" style={styles.iconButton} aria-label="Conversation actions">
          <MoreHorizontal size={18} />
        </button>
      </div>
      <div style={styles.messages}>
        {messages.map((message) => (
          <div key={message.id} style={{ ...styles.bubble, ...(message.mine ? styles.mine : styles.theirs) }}>
            {message.text}
          </div>
        ))}
      </div>
      <div style={styles.composer}>
        <Plus size={17} />
        <span>Message...</span>
        <Send size={16} />
      </div>
    </div>
  );
}

function ContactsView({ sheet, onSheet }: { sheet: ContactSheet; onSheet: (sheet: ContactSheet) => void }) {
  return (
    <div style={styles.pageStack}>
      <div style={styles.contactsToolbar}>
        <div style={styles.searchBarTight}>
          <Search size={16} />
          <span>Search contacts or groups</span>
        </div>
        <button type="button" style={styles.toolbarIcon} onClick={() => onSheet('createGroup')} aria-label="Create group">
          <Users size={20} />
        </button>
        <button type="button" style={styles.toolbarIcon} onClick={() => onSheet('findPeople')} aria-label="Find people">
          <UserPlus size={20} />
        </button>
      </div>

      <div style={styles.requestCard}>
        <div>
          <strong>Friend requests</strong>
          <p>Inbound requests project into the Contacts badge.</p>
        </div>
        <span style={styles.badgeStatic}>1</span>
      </div>

      {contactRows.map((contact) => (
        <div key={contact.did} style={styles.contactRow}>
          <div style={styles.contactAvatar}>{contact.name.slice(0, 1)}</div>
          <div style={styles.conversationBody}>
            <div style={styles.row}>
              <strong>{contact.name}</strong>
              <ChevronRight size={15} color="#94a3b8" />
            </div>
            <p style={styles.conversationText}>{contact.status}</p>
          </div>
        </div>
      ))}

      {sheet ? <ContactSheet sheet={sheet} onClose={() => onSheet(null)} /> : null}
    </div>
  );
}

function ContactSheet({ sheet, onClose }: { sheet: Exclude<ContactSheet, null>; onClose: () => void }) {
  const createGroup = sheet === 'createGroup';
  return (
    <div style={styles.sheetBackdrop}>
      <section style={styles.bottomSheet}>
        <div style={styles.sheetHandle} />
        <div style={styles.sheetHeader}>
          <strong>{createGroup ? 'Create group' : 'Find people'}</strong>
          <button type="button" style={styles.textButton} onClick={onClose}>
            Close
          </button>
        </div>
        {createGroup ? (
          <div style={styles.sheetStack}>
            <MockInput label="Group name" value="Owner review room" />
            <MockInput label="Description" value="Mobile group creation mirrors ContactsPage." />
            <div style={styles.memberPick}>
              {contactRows.slice(0, 2).map((item) => (
                <label key={item.did} style={styles.checkRow}>
                  <span>{item.name}</span>
                  <CheckCircle2 size={16} color="#4f46e5" />
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div style={styles.sheetStack}>
            <MockInput label="Search" value="@sarah or did:pt:sarah" />
            <div style={styles.peopleResult}>
              <div style={styles.contactAvatar}>S</div>
              <div style={styles.conversationBody}>
                <strong>Sarah Jenkins</strong>
                <p style={styles.conversationText}>Verified federation handle</p>
              </div>
              <button type="button" style={styles.primaryTiny}>Send</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function MomentsView() {
  return (
    <div style={styles.pageStack}>
      <div style={styles.composerCard}>
        <strong>Moments composer</strong>
        <p>MobileShell routes Moments as a separate tab; chat runtime state is not owned by this page tree.</p>
      </div>
      <TimelineItem icon={<Image size={16} />} title="Design screenshot posted" text="Social feed remains a mobile tab, not a Chat sub-surface." />
      <TimelineItem icon={<Circle size={16} />} title="Station sync" text="Runtime store keeps data fresh while inactive tabs are unmounted." />
    </div>
  );
}

function SettingsView() {
  return (
    <div style={styles.pageStack}>
      <div style={styles.settingsCard}>
        <div>
          <strong>Active Station</strong>
          <p>local.peers-touch.dev</p>
        </div>
        <button type="button" style={styles.secondaryButton}>Change</button>
      </div>
      <div style={styles.settingsCard}>
        <div>
          <strong>Remembered account</strong>
          <p>did:pt:mobile-owner</p>
        </div>
        <ShieldCheck size={18} color="#059669" />
      </div>
    </div>
  );
}

function SourceItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.sourceItem}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TimelineItem({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div style={styles.timelineItem}>
      <div style={styles.timelineIcon}>{icon}</div>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
    </div>
  );
}

function MockInput({ label, value }: { label: string; value: string }) {
  return (
    <label style={styles.mockInput}>
      <span>{label}</span>
      <strong>{value}</strong>
    </label>
  );
}

const styles: Record<string, CSSProperties> = {
  stage: {
    minHeight: '100%',
    display: 'grid',
    gridTemplateColumns: 'minmax(240px, 360px) minmax(320px, 390px)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    padding: 32,
    background: 'radial-gradient(circle at 20% 20%, rgba(79, 70, 229, 0.18), transparent 32%), linear-gradient(135deg, #f8fafc 0%, #eef2ff 52%, #ecfeff 100%)',
    boxSizing: 'border-box',
  },
  contextPanel: {
    padding: 24,
    borderRadius: 28,
    background: 'rgba(255,255,255,0.74)',
    border: '1px solid rgba(148, 163, 184, 0.22)',
    boxShadow: '0 22px 70px rgba(15, 23, 42, 0.12)',
    backdropFilter: 'blur(18px)',
  },
  contextEyebrow: {
    color: '#4f46e5',
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  contextTitle: {
    margin: '10px 0 8px',
    color: '#0f172a',
    fontSize: 28,
    lineHeight: '34px',
  },
  contextText: {
    margin: 0,
    color: '#475569',
    fontSize: 14,
    lineHeight: '22px',
  },
  sourceGrid: {
    display: 'grid',
    gap: 10,
    marginTop: 20,
  },
  sourceItem: {
    display: 'grid',
    gap: 4,
    padding: 12,
    borderRadius: 16,
    background: 'rgba(248, 250, 252, 0.88)',
    border: '1px solid rgba(226, 232, 240, 0.9)',
    color: '#64748b',
    fontSize: 12,
  },
  phone: {
    width: 390,
    height: 760,
    borderRadius: 38,
    background: '#f2f4fb',
    padding: 10,
    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.28)',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: '1px solid rgba(15, 23, 42, 0.12)',
  },
  statusBar: {
    height: 26,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 18px',
    color: '#0f172a',
    fontSize: 12,
    fontWeight: 800,
  },
  statusIcons: {
    fontSize: 11,
    color: '#334155',
  },
  header: {
    minHeight: 70,
    borderRadius: '28px 28px 18px 18px',
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 18px',
    color: '#111827',
    flexShrink: 0,
  },
  backButton: {
    width: 34,
    height: 34,
    border: 0,
    borderRadius: 14,
    background: '#f1f5f9',
    color: '#334155',
    display: 'grid',
    placeItems: 'center',
    cursor: 'pointer',
  },
  kicker: {
    color: '#64748b',
    fontSize: 11,
    marginBottom: 4,
  },
  headerActions: {
    marginLeft: 'auto',
    display: 'flex',
    gap: 12,
    color: '#475569',
  },
  accessGate: {
    marginTop: 10,
    borderRadius: 18,
    background: '#ffffff',
    color: '#0f172a',
    padding: 12,
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    border: '1px solid rgba(15, 23, 42, 0.06)',
    flexShrink: 0,
  },
  gateIcon: {
    width: 36,
    height: 36,
    borderRadius: 13,
    background: 'rgba(79, 70, 229, 0.1)',
    color: '#4f46e5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateCopy: {
    flex: 1,
    display: 'grid',
    gap: 3,
    fontSize: 13,
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  pageStack: {
    height: '100%',
    overflow: 'auto',
    padding: '12px 8px 18px',
    display: 'grid',
    alignContent: 'start',
    gap: 10,
    boxSizing: 'border-box',
  },
  searchBar: {
    minHeight: 38,
    borderRadius: 12,
    background: '#ffffff',
    color: '#94a3b8',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
    fontSize: 12,
    border: '1px solid rgba(15, 23, 42, 0.06)',
  },
  searchBarTight: {
    minWidth: 0,
    height: 38,
    borderRadius: 10,
    background: '#ffffff',
    color: '#94a3b8',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 10px',
    fontSize: 12,
    border: '1px solid rgba(15, 23, 42, 0.06)',
  },
  sectionLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: 800,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  conversation: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 20,
    background: '#ffffff',
    color: '#0f172a',
    border: '1px solid rgba(15, 23, 42, 0.06)',
    textAlign: 'left',
    cursor: 'pointer',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 14,
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  conversationBody: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
  },
  conversationText: {
    margin: '4px 0 0',
    color: '#64748b',
    fontSize: 12,
    lineHeight: '17px',
  },
  kindPill: {
    display: 'inline-flex',
    marginTop: 7,
    padding: '3px 7px',
    borderRadius: 999,
    background: '#eef2ff',
    color: '#4f46e5',
    fontSize: 10,
    fontWeight: 700,
  },
  unread: {
    width: 20,
    height: 20,
    borderRadius: 999,
    background: '#4f46e5',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    fontSize: 11,
    fontWeight: 800,
  },
  threadPage: {
    height: '100%',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    padding: '10px 8px 0',
    boxSizing: 'border-box',
  },
  threadMeta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 4px 8px',
  },
  secure: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: '#059669',
    fontWeight: 800,
  },
  iconButton: {
    width: 34,
    height: 34,
    border: '1px solid rgba(15, 23, 42, 0.08)',
    borderRadius: 13,
    background: '#ffffff',
    display: 'grid',
    placeItems: 'center',
    color: '#475569',
  },
  messages: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 9,
    padding: '8px 0 14px',
  },
  bubble: {
    maxWidth: '78%',
    padding: '10px 12px',
    borderRadius: 17,
    fontSize: 12,
    lineHeight: '18px',
  },
  mine: {
    alignSelf: 'flex-end',
    background: '#4f46e5',
    color: '#ffffff',
  },
  theirs: {
    alignSelf: 'flex-start',
    background: '#ffffff',
    color: '#334155',
  },
  composer: {
    minHeight: 46,
    borderRadius: 18,
    background: '#ffffff',
    color: '#94a3b8',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px 10px',
    fontSize: 12,
    boxShadow: '0 -8px 24px rgba(15, 23, 42, 0.06)',
    boxSizing: 'border-box',
  },
  contactsToolbar: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 40px 40px',
    alignItems: 'center',
    gap: 8,
  },
  toolbarIcon: {
    width: 40,
    height: 38,
    border: '1px solid rgba(15, 23, 42, 0.08)',
    borderRadius: 10,
    background: '#ffffff',
    color: '#334155',
    display: 'grid',
    placeItems: 'center',
    boxShadow: '0 8px 24px rgba(31, 41, 55, 0.06)',
    cursor: 'pointer',
  },
  requestCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 20,
    background: '#ffffff',
    border: '1px solid rgba(79, 70, 229, 0.14)',
  },
  badgeStatic: {
    width: 22,
    height: 22,
    borderRadius: 999,
    background: '#4f46e5',
    color: '#fff',
    display: 'grid',
    placeItems: 'center',
    fontSize: 12,
    fontWeight: 800,
  },
  contactRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 18,
    background: '#ffffff',
    border: '1px solid rgba(15, 23, 42, 0.06)',
  },
  contactAvatar: {
    width: 38,
    height: 38,
    borderRadius: 14,
    background: '#eef2ff',
    color: '#4f46e5',
    display: 'grid',
    placeItems: 'center',
    fontWeight: 900,
    flexShrink: 0,
  },
  sheetBackdrop: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'flex-end',
    background: 'rgba(15, 23, 42, 0.22)',
    borderRadius: 28,
    overflow: 'hidden',
  },
  bottomSheet: {
    width: '100%',
    padding: '10px 16px 18px',
    borderRadius: '24px 24px 0 0',
    background: '#ffffff',
    boxShadow: '0 -18px 48px rgba(15, 23, 42, 0.18)',
    boxSizing: 'border-box',
  },
  sheetHandle: {
    width: 44,
    height: 4,
    borderRadius: 999,
    background: '#cbd5e1',
    margin: '0 auto 12px',
  },
  sheetHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  textButton: {
    border: 0,
    background: 'transparent',
    color: '#4f46e5',
    fontWeight: 800,
    cursor: 'pointer',
  },
  sheetStack: {
    display: 'grid',
    gap: 10,
  },
  mockInput: {
    display: 'grid',
    gap: 5,
    padding: 12,
    borderRadius: 14,
    background: '#f8fafc',
    color: '#64748b',
    fontSize: 11,
  },
  memberPick: {
    display: 'grid',
    gap: 8,
  },
  checkRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderRadius: 13,
    background: '#f8fafc',
    color: '#334155',
    fontSize: 13,
  },
  peopleResult: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 14,
    background: '#f8fafc',
  },
  primaryTiny: {
    border: 0,
    borderRadius: 999,
    background: '#4f46e5',
    color: '#fff',
    padding: '7px 10px',
    fontWeight: 800,
  },
  composerCard: {
    padding: 16,
    borderRadius: 24,
    background: '#ffffff',
    border: '1px solid rgba(15, 23, 42, 0.06)',
    boxShadow: '0 18px 50px rgba(27, 31, 59, 0.08)',
  },
  timelineItem: {
    display: 'flex',
    gap: 10,
    padding: 14,
    borderRadius: 20,
    background: '#ffffff',
    border: '1px solid rgba(15, 23, 42, 0.06)',
  },
  timelineIcon: {
    width: 34,
    height: 34,
    borderRadius: 13,
    background: '#eef2ff',
    color: '#4f46e5',
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
  },
  settingsCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
    borderRadius: 20,
    background: '#ffffff',
    border: '1px solid rgba(15, 23, 42, 0.06)',
  },
  secondaryButton: {
    border: '1px solid rgba(79, 70, 229, 0.2)',
    borderRadius: 999,
    background: '#eef2ff',
    color: '#4f46e5',
    padding: '7px 12px',
    fontWeight: 800,
  },
  tabbar: {
    height: 64,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTop: '0.5px solid rgba(15, 23, 42, 0.08)',
    background: 'rgba(255, 255, 255, 0.96)',
    backdropFilter: 'blur(20px)',
    flexShrink: 0,
  },
  tabbarItem: {
    flex: 1,
    height: 64,
    border: 0,
    background: 'transparent',
    color: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    cursor: 'pointer',
  },
  tabbarItemActive: {
    color: '#4f46e5',
  },
  tabIconWrap: {
    position: 'relative',
    lineHeight: 0,
  },
  badge: {
    position: 'absolute',
    top: -7,
    right: -10,
    minWidth: 16,
    height: 16,
    padding: '0 4px',
    borderRadius: 999,
    background: '#ef4444',
    color: '#fff',
    fontSize: 10,
    fontWeight: 800,
    display: 'grid',
    placeItems: 'center',
    boxSizing: 'border-box',
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.02em',
  },
};

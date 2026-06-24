import { Bell, Bot, MessageCircle, Search, Send, ShieldCheck, UserRound } from 'lucide-react';

const conversations = [
  { name: 'Sarah', message: 'Voice note synced from desktop', time: '10:42', active: true },
  { name: 'Alex', message: 'Draft checklist is ready', time: '09:18', active: false },
  { name: 'Station Ops', message: 'Dashboard alert resolved', time: 'Yesterday', active: false },
];

const messages = [
  { from: 'Sarah', text: 'Can you review the mobile handoff after the call?', mine: false },
  { from: 'Me', text: 'Yes. I am checking the shared chat contract now.', mine: true },
  { from: 'Sarah', text: 'Great, keep the same message semantics as desktop.', mine: false },
];

export function MobilePrototype() {
  return (
    <div style={styles.stage}>
      <div style={styles.phone}>
        <header style={styles.header}>
          <div>
            <div style={styles.kicker}>Peers Touch Mobile</div>
            <strong>Chat</strong>
          </div>
          <div style={styles.headerActions}>
            <Search size={18} />
            <Bell size={18} />
          </div>
        </header>

        <section style={styles.agentCard}>
          <div style={styles.agentIcon}>
            <Bot size={18} />
          </div>
          <div>
            <strong>Agent summary</strong>
            <p style={styles.agentText}>3 updates synced from desktop and station contexts.</p>
          </div>
        </section>

        <section style={styles.conversationList}>
          {conversations.map((item) => (
            <div key={item.name} style={{ ...styles.conversation, ...(item.active ? styles.conversationActive : null) }}>
              <div style={styles.avatar}>
                <UserRound size={17} />
              </div>
              <div style={styles.conversationBody}>
                <div style={styles.row}>
                  <strong>{item.name}</strong>
                  <span>{item.time}</span>
                </div>
                <p>{item.message}</p>
              </div>
            </div>
          ))}
        </section>

        <section style={styles.chat}>
          <div style={styles.chatTitle}>
            <MessageCircle size={16} />
            <span>Sarah Jenkins</span>
            <span style={styles.secure}>
              <ShieldCheck size={13} />
              E2EE
            </span>
          </div>
          <div style={styles.messages}>
            {messages.map((message) => (
              <div key={message.text} style={{ ...styles.bubble, ...(message.mine ? styles.mine : styles.theirs) }}>
                {message.text}
              </div>
            ))}
          </div>
          <div style={styles.composer}>
            <span>Message...</span>
            <Send size={16} />
          </div>
        </section>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  stage: {
    minHeight: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    background: 'linear-gradient(135deg, #eef2ff 0%, #f8fafc 50%, #ecfeff 100%)',
    boxSizing: 'border-box',
  },
  phone: {
    width: 390,
    height: 760,
    borderRadius: 36,
    background: '#0f172a',
    padding: 10,
    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.28)',
    boxSizing: 'border-box',
  },
  header: {
    height: 72,
    borderRadius: '28px 28px 18px 18px',
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 18px',
    color: '#111827',
  },
  kicker: {
    color: '#64748b',
    fontSize: 11,
    marginBottom: 4,
  },
  headerActions: {
    display: 'flex',
    gap: 12,
    color: '#475569',
  },
  agentCard: {
    marginTop: 10,
    borderRadius: 20,
    background: '#6366f1',
    color: '#ffffff',
    padding: 16,
    display: 'flex',
    gap: 12,
    alignItems: 'center',
  },
  agentIcon: {
    width: 36,
    height: 36,
    borderRadius: 14,
    background: 'rgba(255,255,255,0.18)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentText: {
    margin: '4px 0 0',
    color: '#e0e7ff',
    fontSize: 12,
  },
  conversationList: {
    marginTop: 10,
    display: 'grid',
    gap: 8,
  },
  conversation: {
    display: 'flex',
    gap: 10,
    padding: 12,
    borderRadius: 18,
    background: '#1e293b',
    color: '#cbd5e1',
  },
  conversationActive: {
    background: '#ffffff',
    color: '#111827',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 14,
    background: '#e0f2fe',
    color: '#0369a1',
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
    gap: 8,
    fontSize: 13,
  },
  chat: {
    marginTop: 10,
    borderRadius: 22,
    background: '#ffffff',
    padding: 14,
  },
  chatTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontWeight: 700,
    color: '#111827',
    fontSize: 13,
  },
  secure: {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: '#059669',
  },
  messages: {
    display: 'grid',
    gap: 8,
    marginTop: 12,
  },
  bubble: {
    maxWidth: '78%',
    padding: '9px 11px',
    borderRadius: 16,
    fontSize: 12,
    lineHeight: '17px',
  },
  mine: {
    justifySelf: 'end',
    background: '#4f46e5',
    color: '#ffffff',
  },
  theirs: {
    justifySelf: 'start',
    background: '#f1f5f9',
    color: '#334155',
  },
  composer: {
    marginTop: 12,
    height: 38,
    borderRadius: 999,
    background: '#f8fafc',
    color: '#94a3b8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    fontSize: 12,
  },
};


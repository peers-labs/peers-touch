import { Activity, AlertTriangle, CheckCircle2, Database, MonitorCog, RadioTower, Server, UsersRound } from 'lucide-react';

const metrics = [
  { label: 'Online Stations', value: '24', trend: '+3', icon: RadioTower },
  { label: 'Active Sessions', value: '1,284', trend: '+8.2%', icon: UsersRound },
  { label: 'Storage Health', value: '99.9%', trend: 'stable', icon: Database },
  { label: 'Runtime Alerts', value: '2', trend: 'needs triage', icon: AlertTriangle },
];

const events = [
  { title: 'Station relay recovered', time: '2m ago', tone: 'good' },
  { title: 'Desktop client reconnect spike', time: '14m ago', tone: 'warn' },
  { title: 'Backup ledger checkpoint completed', time: '31m ago', tone: 'good' },
];

export function DashboardPrototype() {
  return (
    <div style={styles.page}>
      <aside style={styles.sidebar}>
        <div style={styles.logo}>
          <MonitorCog size={22} />
          <span>Station</span>
        </div>
        {['Overview', 'Stations', 'Federation', 'Storage', 'Audit'].map((item, index) => (
          <div key={item} style={{ ...styles.navItem, ...(index === 0 ? styles.navItemActive : null) }}>
            {item}
          </div>
        ))}
      </aside>

      <main style={styles.main}>
        <header style={styles.header}>
          <div>
            <div style={styles.kicker}>Station Dashboard Prototype</div>
            <h1 style={styles.h1}>Operations Overview</h1>
          </div>
          <div style={styles.health}>
            <CheckCircle2 size={16} />
            System healthy
          </div>
        </header>

        <section style={styles.metricGrid}>
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <article key={metric.label} style={styles.metricCard}>
                <div style={styles.metricIcon}>
                  <Icon size={18} />
                </div>
                <span style={styles.metricLabel}>{metric.label}</span>
                <strong style={styles.metricValue}>{metric.value}</strong>
                <span style={styles.metricTrend}>{metric.trend}</span>
              </article>
            );
          })}
        </section>

        <section style={styles.bodyGrid}>
          <article style={styles.panel}>
            <div style={styles.panelTitle}>
              <Activity size={17} />
              Federation Throughput
            </div>
            <div style={styles.chart}>
              {[44, 64, 52, 72, 58, 82, 76, 88, 69, 92].map((height, index) => (
                <span key={index} style={{ ...styles.bar, height }} />
              ))}
            </div>
          </article>

          <article style={styles.panel}>
            <div style={styles.panelTitle}>
              <Server size={17} />
              Recent Events
            </div>
            <div style={styles.events}>
              {events.map((event) => (
                <div key={event.title} style={styles.event}>
                  <span style={{ ...styles.dot, ...(event.tone === 'warn' ? styles.dotWarn : styles.dotGood) }} />
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100%',
    display: 'flex',
    background: '#f8fafc',
    color: '#0f172a',
  },
  sidebar: {
    width: 230,
    background: '#0f172a',
    color: '#cbd5e1',
    padding: 18,
    boxSizing: 'border-box',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    color: '#ffffff',
    fontWeight: 800,
    marginBottom: 22,
  },
  navItem: {
    padding: '11px 12px',
    borderRadius: 12,
    fontSize: 13,
    marginBottom: 6,
  },
  navItemActive: {
    background: '#1d4ed8',
    color: '#ffffff',
  },
  main: {
    flex: 1,
    padding: 24,
    minWidth: 0,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  kicker: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  h1: {
    margin: '6px 0 0',
    fontSize: 28,
  },
  health: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 11px',
    borderRadius: 999,
    background: '#dcfce7',
    color: '#166534',
    fontSize: 12,
    fontWeight: 700,
  },
  metricGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 12,
    marginBottom: 14,
  },
  metricCard: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 18,
    padding: 16,
    display: 'grid',
    gap: 7,
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    background: '#eff6ff',
    color: '#2563eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 12,
  },
  metricValue: {
    fontSize: 24,
  },
  metricTrend: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: 700,
  },
  bodyGrid: {
    display: 'grid',
    gridTemplateColumns: '1.4fr 1fr',
    gap: 14,
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 20,
    padding: 18,
  },
  panelTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 14,
    fontWeight: 800,
    marginBottom: 18,
  },
  chart: {
    height: 190,
    display: 'flex',
    alignItems: 'end',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    background: '#f8fafc',
  },
  bar: {
    flex: 1,
    borderRadius: '999px 999px 4px 4px',
    background: 'linear-gradient(180deg, #60a5fa, #2563eb)',
  },
  events: {
    display: 'grid',
    gap: 12,
  },
  event: {
    display: 'flex',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    background: '#f8fafc',
    fontSize: 13,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 4,
    flexShrink: 0,
  },
  dotGood: {
    background: '#22c55e',
  },
  dotWarn: {
    background: '#f59e0b',
  },
};


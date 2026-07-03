import { useEffect, useState, type ComponentType, type CSSProperties, type ReactElement } from 'react';
import { Monitor, PanelsTopLeft, Smartphone } from 'lucide-react';
import { LOCAL_PROTOTYPES } from './registry/localManifests';
import { CURRENT_WORKTREE } from './registry/worktrees';
import type { PrototypeManifest, PrototypeSite } from './registry/types';

const DEFAULT_SITE: PrototypeSite = normalizeSite(import.meta.env.VITE_PROTOTYPE_SITE);

const SITE_META: Record<PrototypeSite, { title: string; subtitle: string; icon: ReactElement }> = {
  desktop: {
    title: 'Desktop Prototypes',
    subtitle: 'Desktop App / desktop-web / applet container experiences',
    icon: <Monitor size={18} />,
  },
  mobile: {
    title: 'Mobile Prototypes',
    subtitle: 'Mobile pages, flows, components, and cross-device UX',
    icon: <Smartphone size={18} />,
  },
  dashboard: {
    title: 'Station Dashboard Prototypes',
    subtitle: 'Station admin, operations, and dashboard experiences',
    icon: <PanelsTopLeft size={18} />,
  },
};

function normalizeSite(value: unknown): PrototypeSite {
  return value === 'mobile' || value === 'dashboard' || value === 'desktop' ? value : 'desktop';
}

export function PrototypePortal() {
  const [site, setSite] = useState<PrototypeSite>(DEFAULT_SITE);
  const meta = SITE_META[site];
  const visible = LOCAL_PROTOTYPES.filter((prototype) => prototype.site === site);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.brand}>Peers Touch Prototype Portal</div>
        <div style={styles.headerControls}>
          <span style={styles.branchChip}>{CURRENT_WORKTREE.branch}</span>
          <div style={styles.worktreeBadge} title={CURRENT_WORKTREE.worktreePath}>
            <span style={styles.worktreeDot} />
            <span style={styles.worktreeBadgePath}>{compactPath(CURRENT_WORKTREE.worktreePath)}</span>
          </div>
        </div>
      </header>

      <main style={styles.main}>
        <aside style={styles.sidebar}>
          {(Object.keys(SITE_META) as PrototypeSite[]).map((key) => {
            const item = SITE_META[key];
            const active = key === site;
            return (
              <div
                key={key}
                style={{ ...styles.siteItem, ...(active ? styles.siteItemActive : null), cursor: 'pointer' }}
                onClick={() => setSite(key)}
              >
                {item.icon}
                <div>
                  <div style={styles.siteTitle}>{key}</div>
                  <div style={styles.siteSubtitle}>{item.title}</div>
                </div>
              </div>
            );
          })}
        </aside>

        <section style={styles.content}>
          <div style={styles.hero}>
            <div>
              <h1 style={styles.h1}>{meta.title}</h1>
              <p style={styles.p}>{meta.subtitle}</p>
            </div>
            <div style={styles.command}>make run-prototype</div>
          </div>

          <div style={styles.grid}>
            {visible.length > 0 ? (
              visible.map((prototype) => <PrototypeCard key={prototype.id} prototype={prototype} />)
            ) : (
              <div style={styles.empty}>
                <strong>No prototypes registered for {site} yet.</strong>
                <span>Add a prototype manifest under packages/prototypes/&lt;id&gt;/ and keep it under the correct first-level site.</span>
              </div>
            )}
          </div>

          {visible[0] ? <PrototypePreview prototype={visible[0]} /> : null}
        </section>
      </main>
    </div>
  );
}

function PrototypePreview({ prototype }: { prototype: PrototypeManifest }) {
  const [Preview, setPreview] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);

    prototype.entry()
      .then((module) => {
        const exportName = prototype.previewExport ?? 'default';
        const candidate = module[exportName] ?? module.default;
        if (typeof candidate !== 'function') {
          throw new Error(`Missing preview export: ${exportName}`);
        }
        if (!cancelled) {
          setPreview(() => candidate as ComponentType);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [prototype]);

  return (
    <div style={styles.preview}>
      <div style={styles.previewHeader}>
        <span>Live Preview</span>
        <span style={styles.previewMeta}>{prototype.title}</span>
      </div>
      <div style={styles.previewBody}>
        {Preview ? (
          <Preview />
        ) : (
          <div style={styles.previewPlaceholder}>
            {error ? `Preview unavailable: ${error}` : `Loading ${prototype.title}...`}
          </div>
        )}
      </div>
    </div>
  );
}

function PrototypeCard({ prototype }: { prototype: PrototypeManifest }) {
  return (
    <article style={styles.card}>
      <div style={styles.cardTop}>
        <span style={styles.cardTitle}>{prototype.title}</span>
        <span style={styles.status}>{prototype.status}</span>
      </div>
      <p style={styles.cardText}>{prototype.description}</p>
      <div style={styles.cardMeta}>
        <span>{prototype.kind}</span>
        <span>module: {prototype.module}</span>
        <span>{prototype.path}</span>
        {prototype.docs ? <span>{prototype.docs}</span> : null}
      </div>
    </article>
  );
}

function compactPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 4) {
    return path;
  }
  return `.../${parts.slice(-4).join('/')}`;
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f6f7fb',
    color: '#1f2329',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  header: {
    height: 56,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    background: '#ffffff',
    borderBottom: '1px solid #e5e7eb',
  },
  brand: {
    fontSize: 15,
    fontWeight: 700,
  },
  headerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  branchChip: {
    display: 'inline-flex',
    alignItems: 'center',
    height: 30,
    padding: '0 12px',
    borderRadius: 8,
    background: '#eef2ff',
    border: '1px solid #c7d2fe',
    color: '#3730a3',
    fontSize: 12,
    fontWeight: 700,
    boxSizing: 'border-box',
  },
  main: {
    display: 'flex',
    minHeight: 'calc(100vh - 56px)',
  },
  sidebar: {
    width: 260,
    padding: 16,
    background: '#ffffff',
    borderRight: '1px solid #e5e7eb',
  },
  siteItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    borderRadius: 10,
    color: '#4b5563',
    marginBottom: 8,
  },
  siteItemActive: {
    background: '#eef2ff',
    color: '#312e81',
  },
  siteTitle: {
    fontSize: 13,
    fontWeight: 700,
  },
  siteSubtitle: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 20,
    minWidth: 0,
  },
  hero: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  h1: {
    margin: 0,
    fontSize: 24,
  },
  p: {
    margin: '8px 0 0',
    color: '#6b7280',
    fontSize: 13,
  },
  command: {
    padding: '6px 10px',
    borderRadius: 8,
    background: '#111827',
    color: '#ffffff',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  worktreeBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    height: 30,
    maxWidth: 320,
    padding: '0 12px',
    borderRadius: 999,
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    boxSizing: 'border-box',
  },
  worktreeDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#22c55e',
    flex: 'none',
  },
  worktreeBadgePath: {
    color: '#64748b',
    fontFamily: 'monospace',
    fontSize: 11,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12,
    marginBottom: 16,
  },
  card: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 14,
    padding: 14,
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: 700,
  },
  status: {
    fontSize: 11,
    color: '#2563eb',
    background: '#dbeafe',
    borderRadius: 999,
    padding: '2px 8px',
  },
  cardText: {
    fontSize: 12,
    color: '#4b5563',
    lineHeight: '18px',
    minHeight: 36,
  },
  cardMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    color: '#6b7280',
    fontSize: 11,
  },
  empty: {
    gridColumn: '1 / -1',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: 18,
    background: '#ffffff',
    border: '1px dashed #cbd5e1',
    borderRadius: 14,
    color: '#475569',
    fontSize: 13,
  },
  preview: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: 16,
    overflow: 'hidden',
  },
  previewHeader: {
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 14px',
    borderBottom: '1px solid #e5e7eb',
    fontSize: 13,
    fontWeight: 700,
  },
  previewMeta: {
    color: '#6b7280',
    fontSize: 11,
    fontWeight: 500,
  },
  previewBody: {
    height: 720,
    minHeight: 0,
    overflow: 'auto',
  },
  previewPlaceholder: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748b',
    fontSize: 13,
  },
};

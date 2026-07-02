import { useEffect, useState, type ComponentType, type CSSProperties, type KeyboardEvent } from 'react';
import { Monitor, PanelsTopLeft, Smartphone } from 'lucide-react';
import { LOCAL_PROTOTYPES } from './registry/localManifests';
import { WORKTREE_TARGETS } from './registry/worktrees';
import type { PrototypeManifest, PrototypeSite, PrototypeWorktreeTarget } from './registry/types';

const site = normalizeSite(import.meta.env.VITE_PROTOTYPE_SITE);

const SITE_META: Record<PrototypeSite, { title: string; subtitle: string; icon: JSX.Element }> = {
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
  const [targetId, setTargetId] = useState(WORKTREE_TARGETS[0]?.id ?? 'current');
  const [selectedPrototypeId, setSelectedPrototypeId] = useState<string | null>(null);
  const meta = SITE_META[site];
  const visible = LOCAL_PROTOTYPES.filter((prototype) => prototype.site === site);
  const entryPrototypes = visible.filter(isEntryPrototype);
  const target = WORKTREE_TARGETS.find((item) => item.id === targetId) ?? WORKTREE_TARGETS[0];
  const localTarget = target.id === 'current';
  const selectedPrototype =
    entryPrototypes.find((prototype) => prototype.id === selectedPrototypeId) ?? entryPrototypes[0] ?? null;

  useEffect(() => {
    if (entryPrototypes.length === 0) {
      setSelectedPrototypeId(null);
      return;
    }

    if (!selectedPrototypeId || !entryPrototypes.some((prototype) => prototype.id === selectedPrototypeId)) {
      setSelectedPrototypeId(entryPrototypes[0].id);
    }
  }, [entryPrototypes, selectedPrototypeId]);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.brand}>Peers Touch Prototype Portal</div>
        <div style={styles.headerControls}>
          <label style={styles.targetPicker}>
            <span>Worktree</span>
            <select value={target.id} onChange={(event) => setTargetId(event.target.value)} style={styles.select}>
              {WORKTREE_TARGETS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} / {item.branch}
                </option>
              ))}
            </select>
          </label>
          <div style={styles.sitePill}>
            {meta.icon}
            <span>{site}</span>
          </div>
        </div>
      </header>

      <main style={styles.main}>
        <aside style={styles.sidebar}>
          {(Object.keys(SITE_META) as PrototypeSite[]).map((key) => {
            const item = SITE_META[key];
            const active = key === site;
            return (
              <div key={key} style={{ ...styles.siteItem, ...(active ? styles.siteItemActive : null) }}>
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
            <div style={styles.command}>make run-prototype {site}</div>
          </div>

          {localTarget ? (
            <div style={styles.grid}>
              {entryPrototypes.length > 0 ? (
                entryPrototypes.map((prototype) => (
                  <PrototypeCard
                    key={prototype.id}
                    prototype={prototype}
                    selected={prototype.id === selectedPrototype?.id}
                    onSelect={() => setSelectedPrototypeId(prototype.id)}
                  />
                ))
              ) : (
                <div style={styles.empty}>
                  <strong>No prototypes registered for {site} yet.</strong>
                  <span>Add a prototype manifest under packages/prototypes/&lt;id&gt;/ and keep it under the correct first-level site.</span>
                </div>
              )}
            </div>
          ) : (
            <RemoteTargetCard target={target} site={site} />
          )}

          {localTarget ? (
            selectedPrototype ? <PrototypePreview prototype={selectedPrototype} /> : null
          ) : (
            <RemoteWorktreePreview target={target} site={site} />
          )}
        </section>
      </main>
    </div>
  );
}

function isEntryPrototype(prototype: PrototypeManifest): boolean {
  if (prototype.site !== 'desktop') return true;
  if (prototype.kind === 'applet') return false;
  return prototype.kind === 'shell' || prototype.module !== 'applet-runtime';
}

function RemoteTargetCard({ target, site }: { target: PrototypeWorktreeTarget; site: PrototypeSite }) {
  const url = target.sites[site];

  return (
    <article style={styles.remoteCard}>
      <div style={styles.cardTop}>
        <span style={styles.cardTitle}>{target.label}</span>
        <span style={styles.status}>remote</span>
      </div>
      <p style={styles.cardText}>
        Branch `{target.branch}` is rendered from its own running prototype service. Portal uses iframe preview for remote worktrees and never imports their source.
      </p>
      <div style={styles.targetMeta}>
        <span>worktree: {target.worktreePath}</span>
        <span>{site}: {url ?? 'not configured'}</span>
      </div>
    </article>
  );
}

function RemoteWorktreePreview({ target, site }: { target: PrototypeWorktreeTarget; site: PrototypeSite }) {
  const url = target.sites[site];

  return (
    <div style={styles.preview}>
      <div style={styles.previewHeader}>
        <span>Remote Preview</span>
        <span style={styles.previewMeta}>{target.label} / {target.branch}</span>
      </div>
      <div style={styles.previewBody}>
        {url ? (
          <iframe title={`${target.label} ${site}`} src={url} style={styles.iframe} />
        ) : (
          <div style={styles.previewPlaceholder}>
            No remote URL configured for {site}. Add it to VITE_PROTOTYPE_WORKTREES.
          </div>
        )}
      </div>
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

function PrototypeCard({
  prototype,
  selected,
  onSelect,
}: {
  prototype: PrototypeManifest;
  selected: boolean;
  onSelect: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect();
  };

  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      style={{ ...styles.card, ...(selected ? styles.cardSelected : null) }}
    >
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
  targetPicker: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    color: '#64748b',
    fontSize: 12,
    fontWeight: 600,
  },
  select: {
    height: 30,
    borderRadius: 8,
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#334155',
    padding: '0 8px',
    fontSize: 12,
  },
  sitePill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderRadius: 999,
    background: '#eef2ff',
    color: '#3730a3',
    fontSize: 12,
    fontWeight: 600,
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
    cursor: 'pointer',
    outline: 'none',
  },
  cardSelected: {
    border: '1px solid #6366f1',
    boxShadow: '0 10px 28px rgba(99, 102, 241, 0.12)',
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
  remoteCard: {
    background: '#ffffff',
    border: '1px solid #dbeafe',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  targetMeta: {
    display: 'grid',
    gap: 4,
    color: '#475569',
    fontSize: 11,
    fontFamily: 'monospace',
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
    overflow: 'hidden',
  },
  previewPlaceholder: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748b',
    fontSize: 13,
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 0,
    display: 'block',
    background: '#ffffff',
  },
};

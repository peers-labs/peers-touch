/**
 * peers-touch Desktop — Settings prototype (FULL production structure).
 *
 * Three-level navigation:
 *   1. Top: Horizontal Group Tabs (2px purple bottom-border active indicator)
 *   2. Left Sidebar (180px): Section items within selected group
 *   3. Right: Content area (max-width 720px, padding 24px)
 *
 * Groups: General, AI, Channels, Applets, Data, Help
 *
 * Standalone web prototype: mock-data only, no real store / kernel / tauri.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Settings,
  Sparkles,
  Send,
  Puzzle,
  Database,
  HelpCircle,
  User,
  Globe,
  Sliders,
  Server,
  Brain,
  HardDrive,
  ScrollText,
  Plug,
  Users,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Activity,
  CheckCircle2,
  XCircle,
  Loader2,
  Pencil,
  Network,
  ExternalLink,
  Shield,
  LogOut,
  Lock,
  FileJson,
  Github,
  Link as LinkIcon,
  FileArchive,
  ShieldCheck,
  ShieldAlert,
  MapPin,
  Clock,
  Calendar,
  BarChart3,
  MessageSquare,
  Cpu,
  Flame,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  Copy,
  Command,
  FolderOpen,
  Bell,
  Image as ImageIcon,
  Upload,
  Wifi,
  Wrench,
  History,
  MonitorSmartphone,
  type LucideIcon,
} from 'lucide-react';
import { T } from './theme';

// ═══════════════════════════════════════════════════════════════════════════════
// DESIGN SYSTEM (canonical atoms — ui-identity components.md §3 scale)
//
// Every Settings surface composes these atoms. Heights come from one scale
// (24/28/30/32/34/36/40), radius from {6,8,10,12}. Interactive atoms are real
// controls with roles/keyboard; legacy sections inherit the design language by
// using them, without changing their own logic.
// ═══════════════════════════════════════════════════════════════════════════════

const CARD_RADIUS = 12;
const inputStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  border: `1px solid ${T.borderSoft}`,
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  lineHeight: 1.4,
  outline: 'none',
  color: T.text,
  backgroundColor: T.bg,
  width: '100%',
};

function Select({
  value,
  options,
  onChange,
  width,
  ariaLabel,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
  width?: number | string;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width,
        height: 32,
        boxSizing: 'border-box',
        border: `1px solid ${T.borderSoft}`,
        borderRadius: 8,
        padding: '0 28px 0 10px',
        fontSize: 13,
        color: T.text,
        backgroundColor: T.bg,
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.label}</option>
      ))}
    </select>
  );
}

/** Canonical switch — real button, switch role, keyboard operable. */
function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      style={{
        width: 40, height: 22, borderRadius: 11, padding: 0,
        border: 'none',
        backgroundColor: on ? T.primary : '#d9d9d9',
        position: 'relative', cursor: 'pointer', flexShrink: 0,
        transition: 'background-color 0.15s ease',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 20 : 2,
        width: 18, height: 18, borderRadius: '50%',
        backgroundColor: T.white, transition: 'left 0.15s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)', display: 'block',
      }} />
    </button>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 11, lineHeight: '18px', padding: '0 7px',
      borderRadius: 6, color, backgroundColor: `${color}14`,
      border: `1px solid ${color}33`,
    }}>
      {text}
    </span>
  );
}

function GhostBtn({ icon: Icon, label, onClick, danger }: {
  icon?: LucideIcon; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 32, padding: '0 12px', borderRadius: 8,
        border: `1px solid ${T.borderSoft}`,
        backgroundColor: T.bg, color: danger ? T.danger : T.textSecondary,
        fontSize: 13, fontWeight: 500, cursor: 'pointer',
      }}
    >
      {Icon ? <Icon size={14} /> : null}
      {label}
    </button>
  );
}

function PrimaryBtn({ icon: Icon, label, onClick }: {
  icon?: LucideIcon; label: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 32, padding: '0 14px', borderRadius: 8,
        border: 'none', backgroundColor: T.primary, color: T.white,
        fontSize: 13, fontWeight: 600, cursor: 'pointer',
      }}
    >
      {Icon ? <Icon size={14} /> : null}
      {label}
    </button>
  );
}

/** Segmented single-choice group (radio semantics, keyboard native). */
function Segmented<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel}
      style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 8, backgroundColor: '#f0f0f0' }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            style={{
              border: 'none', borderRadius: 6, padding: '6px 14px',
              fontSize: 12, fontWeight: active ? 600 : 500, cursor: 'pointer',
              color: active ? T.primary : T.textSecondary,
              backgroundColor: active ? T.white : 'transparent',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT ATOMS
// ═══════════════════════════════════════════════════════════════════════════════

function SettingsContainer({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: '20px 24px 40px',
      width: '100%', maxWidth: 760, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      {children}
    </div>
  );
}

/** A section whose whole header collapses its technical/advanced body. */
function CollapsibleSection({ icon: Icon, title, subtitle, children, defaultOpen = false }: {
  icon: LucideIcon; title: string; subtitle?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <section style={{
      backgroundColor: T.white, borderRadius: CARD_RADIUS, padding: '4px 18px',
      border: `1px solid ${T.borderSoft}`,
    }}>
      <details open={defaultOpen} style={{ width: '100%' }}>
        <summary style={{
          listStyle: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0',
        }}>
          <Icon size={16} color={T.textSecondary} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.text }}>{title}</span>
            {subtitle ? <span style={{ display: 'block', fontSize: 12, color: T.textTertiary, marginTop: 2 }}>{subtitle}</span> : null}
          </span>
          <ChevronDown size={16} color={T.textTertiary} />
        </summary>
        <div style={{ paddingBottom: 16 }}>{children}</div>
      </details>
    </section>
  );
}

function SettingsSection({ icon: Icon, title, subtitle, action, children }: {
  icon: LucideIcon; title: string; subtitle?: string;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section style={{
      backgroundColor: T.white, borderRadius: CARD_RADIUS, padding: '16px 18px',
      border: `1px solid ${T.borderSoft}`,
    }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', marginBottom: children ? 12 : 0, gap: 10 }}>
        <Icon size={16} color={T.textSecondary} style={{ marginTop: 2, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.text }}>{title}</h3>
          {subtitle ? <p style={{ margin: '2px 0 0', fontSize: 12, color: T.textTertiary, lineHeight: 1.45 }}>{subtitle}</p> : null}
        </div>
        {action ? <div style={{ flexShrink: 0 }}>{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

function SettingsRow({ label, desc, children }: {
  label: string; desc?: string; children?: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 16, padding: '9px 0',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{label}</div>
        {desc ? <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2, lineHeight: 1.4 }}>{desc}</div> : null}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

/** A labelled vertical field (label above control). */
function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 13, fontWeight: 500, color: T.text, marginBottom: 6 }}>{label}</span>
      {children}
      {hint ? <span style={{ display: 'block', fontSize: 11, color: T.textTertiary, marginTop: 5 }}>{hint}</span> : null}
    </label>
  );
}

function DangerZone({ title = 'Danger zone', desc, children }: {
  title?: string; desc?: string; children: React.ReactNode;
}) {
  return (
    <section style={{
      backgroundColor: T.white, borderRadius: CARD_RADIUS, padding: '16px 18px',
      border: '1px solid #ffa39e',
    }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: children ? 12 : 0 }}>
        <AlertTriangle size={16} color={T.danger} />
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.danger }}>{title}</h3>
          {desc ? <p style={{ margin: '2px 0 0', fontSize: 12, color: T.textTertiary }}>{desc}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function SettingsItemCard({ children, onClick, active }: {
  children: React.ReactNode; onClick?: () => void; active?: boolean;
}) {
  return (
    <div onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={{
        padding: 12, borderRadius: 10,
        backgroundColor: active ? T.primaryWash : T.surface,
        border: `1px solid ${active ? T.primary : T.borderSoft}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
      }}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: ACCOUNT (General group)
// ═══════════════════════════════════════════════════════════════════════════════

// ── General · Account ────────────────────────────────────────────────────────
const COVER_KEY = 'pt.profile.cover';
const COVER_HISTORY_KEY = 'pt.profile.cover.history';
const DEFAULT_COVER = `linear-gradient(120deg, ${T.primary} 0%, color-mix(in srgb, ${T.primary} 72%, white) 55%, color-mix(in srgb, ${T.primary} 42%, white) 100%)`;
const COVER_HISTORY_LIMIT = 8;
const ACCOUNT_IDENTITY = {
  ptid: 'ptid:01HQX7K3M9VDGF2N8PWJRST6YZ',
  station: 'alpha.peers.social',
} as const;

function readCover(): string {
  if (typeof window === 'undefined') return DEFAULT_COVER;
  return window.localStorage.getItem(COVER_KEY) || DEFAULT_COVER;
}
function readCoverHistory(): string[] {
  if (typeof window === 'undefined') return [DEFAULT_COVER];
  try {
    const raw = JSON.parse(window.localStorage.getItem(COVER_HISTORY_KEY) || '[]') as string[];
    const list = raw.filter(Boolean);
    return list.includes(DEFAULT_COVER) ? list : [DEFAULT_COVER, ...list];
  } catch {
    return [DEFAULT_COVER];
  }
}

function CopyableIdentityRow({ label, value, copyLabel = `Copy ${label}` }: {
  label: string; value: string; copyLabel?: string;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copyState !== 'copied') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 1500);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function copy() {
    setCopyState('pending');
    try {
      await navigator.clipboard.writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <div data-identity-field={label} style={{ minWidth: 0 }}>
      <dt style={{ fontSize: 11, color: T.textTertiary }}>{label}</dt>
      <dd style={{ margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <code data-identity-value style={{
          flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.5, color: T.textSecondary,
          fontFamily: 'ui-monospace, Menlo, monospace', overflowWrap: 'anywhere', userSelect: 'text',
        }}>{value}</code>
        <button
          type="button"
          aria-label={copyLabel}
          title={copyState === 'copied' ? 'Copied' : copyLabel}
          data-copy-state={copyState}
          disabled={copyState === 'pending'}
          onClick={copy}
          style={{
            width: 28, height: 28, flexShrink: 0, borderRadius: 8,
            border: `1px solid ${T.borderSoft}`, background: T.white,
            color: copyState === 'copied' ? T.success : T.textSecondary,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: copyState === 'pending' ? 'wait' : 'pointer',
          }}
        >
          {copyState === 'copied' ? <CheckCircle2 size={14} /> : <Copy size={14} />}
        </button>
      </dd>
      {copyState === 'copied' ? (
        <div role="status" style={{ marginTop: 2, fontSize: 11, color: T.success }}>Copied</div>
      ) : copyState === 'failed' ? (
        <div role="alert" style={{ marginTop: 2, fontSize: 11, color: T.danger }}>Copy failed. Try again.</div>
      ) : null}
    </div>
  );
}

function AccountSection({ federations }: { federations: JoinedFederation[] }) {
  const [displayName, setDisplayName] = useState('Alice Chen');
  const [bio, setBio] = useState('Building decentralized social networks. Open-source advocate.');
  const [region, setRegion] = useState('asia-east');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [cover, setCover] = useState<string>(readCover);
  const [coverHistory, setCoverHistory] = useState<string[]>(readCoverHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [coverName, setCoverName] = useState('');
  const [blockedOpen, setBlockedOpen] = useState(false);

  const applyCover = (value: string, name = '') => {
    window.localStorage.setItem(COVER_KEY, value === DEFAULT_COVER ? '' : value);
    if (value === DEFAULT_COVER) window.localStorage.removeItem(COVER_KEY);
    setCover(value);
    setCoverName(name);
    setCoverHistory((prev) => {
      const next = [value, ...prev.filter((v) => v !== value)].slice(0, COVER_HISTORY_LIMIT);
      window.localStorage.setItem(COVER_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  };

  const pickCover = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => applyCover(String(reader.result), file.name);
    reader.readAsDataURL(file);
  };

  const coverBackground = cover.startsWith('linear-gradient')
    ? cover
    : `center / cover url("${cover}")`;

  return (
    <SettingsContainer>
      {/* Identity: cover banner + avatar seated on its lower edge. The avatar
          overlaps by exactly its 4px ring, so the face is never cropped. */}
      <section
        data-profile-identity
        style={{
          background: T.white, border: `1px solid ${T.borderSoft}`,
          borderRadius: CARD_RADIUS, overflow: 'hidden',
        }}
      >
        <div style={{ position: 'relative' }}>
          <div
            data-profile-cover-preview
            style={{ height: 124, background: coverBackground }}
          />
          {/* Change: upload new or pick a past background */}
          <div style={{ position: 'absolute', right: 10, bottom: 10 }}>
            <button
              type="button"
              data-profile-cover-change
              aria-haspopup="menu"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((v) => !v)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                height: 28, padding: '0 10px', borderRadius: 8,
                border: 'none', background: 'rgba(255,255,255,0.92)',
                color: T.text, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <ImageIcon size={13} /> Change
              <ChevronDown size={12} style={{ transform: historyOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
            {historyOpen ? (
              <>
                <div onClick={() => setHistoryOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div
                  role="menu"
                  data-profile-cover-menu
                  style={{
                    position: 'absolute', right: 0, top: 34, zIndex: 41, width: 248,
                    background: T.white, border: `1px solid ${T.borderSoft}`, borderRadius: 10,
                    boxShadow: '0 10px 32px rgba(15,23,42,0.16)', padding: 8,
                  }}
                >
                  <label
                    role="menuitem"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                      padding: '8px 10px', borderRadius: 8, fontSize: 13, color: T.text,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = T.surface)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <Upload size={14} /> Upload new
                    <input type="file" accept="image/*" hidden onChange={(e) => {
                      setHistoryOpen(false);
                      pickCover(e.target.files?.[0]);
                      e.currentTarget.value = '';
                    }} />
                  </label>
                  {coverHistory.length > 1 ? (
                    <div style={{ borderTop: `1px solid ${T.borderSoft}`, marginTop: 6, paddingTop: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 6px', fontSize: 11, color: T.textTertiary, fontWeight: 600 }}>
                        <History size={12} /> Recent
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: '0 6px 4px' }}>
                        {coverHistory.map((value, i) => {
                          const active = value === cover;
                          return (
                            <button
                              key={i}
                              type="button"
                              role="menuitemradio"
                              aria-checked={active}
                              aria-label={`Use background ${i + 1}`}
                              onClick={() => { applyCover(value, value.startsWith('linear-gradient') ? '' : coverName); setHistoryOpen(false); }}
                              style={{
                                height: 40, borderRadius: 8, padding: 0, cursor: 'pointer',
                                background: value.startsWith('linear-gradient') ? value : `center / cover url("${value}")`,
                                border: active ? `2px solid ${T.primary}` : `1px solid ${T.borderSoft}`,
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div style={{ padding: '0 20px 18px' }}>
          {/* 72px avatar on a 124px banner; 4px overlap == ring width, face fully visible */}
          <div style={{ marginTop: -4 }}>
            <div style={{
              // The separation ring must paint above the positioned cover.
              position: 'relative', zIndex: 1,
              width: 72, height: 72, borderRadius: 14,
              background: `linear-gradient(135deg, ${T.primary} 0%, color-mix(in srgb, ${T.primary} 68%, white) 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26, fontWeight: 700, color: T.white,
              border: `4px solid ${T.white}`,
              boxShadow: '0 4px 14px rgba(15,23,42,0.16)',
            }}>
              AC
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: T.text, letterSpacing: '-0.01em' }}>Alice Chen</div>
            <div style={{ fontSize: 13.5, color: T.textSecondary, marginTop: 2 }}>@alice</div>
            <details data-profile-technical style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 12, color: T.primary, cursor: 'pointer' }}>
                Technical identity
              </summary>
              <dl style={{
                margin: '12px 0 0', paddingTop: 12, borderTop: `1px solid ${T.borderSoft}`,
                display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0,
              }}>
                <CopyableIdentityRow label="PTID" value={ACCOUNT_IDENTITY.ptid} />
                <CopyableIdentityRow label="Home Station" value={ACCOUNT_IDENTITY.station} />
                <div>
                  <dt style={{ fontSize: 11, color: T.textTertiary }}>Federations</dt>
                  <dd style={{ margin: '6px 0 0' }}>
                    {federations.length ? (
                      <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {federations.map((f) => (
                          <CopyableIdentityRow
                            key={f.id} label={f.name} value={f.endpoint}
                            copyLabel={`Copy federation ${f.name}`}
                          />
                        ))}
                      </dl>
                    ) : (
                      <span style={{ fontSize: 12, color: T.textSecondary }}>No joined federations</span>
                    )}
                  </dd>
                </div>
              </dl>
            </details>
          </div>
        </div>
        {coverName ? (
          <div style={{ padding: '0 18px 14px', fontSize: 12, color: T.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {coverName}
          </div>
        ) : null}
      </section>

      <SettingsSection icon={Pencil} title="Public profile" subtitle="Shown on your profile and in mutual conversations.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Display name">
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="Bio" hint={`${bio.length}/280`}>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 280))}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Region">
              <Select value={region} ariaLabel="Region" width="100%" options={[
                { id: 'asia-east', label: 'Asia East' },
                { id: 'asia-southeast', label: 'Asia Southeast' },
                { id: 'us-west', label: 'US West' },
                { id: 'eu-west', label: 'EU West' },
              ]} onChange={setRegion} />
            </Field>
            <Field label="Timezone">
              <Select value={timezone} ariaLabel="Timezone" width="100%" options={[
                { id: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
                { id: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
                { id: 'America/Los_Angeles', label: 'America/Los_Angeles (UTC-7)' },
                { id: 'Europe/London', label: 'Europe/London (UTC+1)' },
              ]} onChange={setTimezone} />
            </Field>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={Users} title="Relationships" subtitle="People you have blocked across all networks.">
        <button
          type="button"
          onClick={() => setBlockedOpen((v) => !v)}
          style={{
            width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
            padding: '4px 0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: T.text, flex: 1 }}>Blocked users</span>
          <span style={{ fontSize: 12, color: T.textTertiary }}>3</span>
          {blockedOpen ? <ChevronDown size={15} color={T.textTertiary} /> : <ChevronRight size={15} color={T.textTertiary} />}
        </button>
        {blockedOpen ? (
          <div style={{ marginTop: 4, borderTop: `1px solid ${T.border}` }}>
            {['Spam Bot', 'Old Contact', 'Noise Account'].map((name) => (
              <SettingsRow key={name} label={name}>
                <GhostBtn label="Unblock" onClick={() => {}} />
              </SettingsRow>
            ))}
          </div>
        ) : null}
      </SettingsSection>
    </SettingsContainer>
  );
}

// ── General · Notifications ──────────────────────────────────────────────────
function NotificationsSettingsSection() {
  const [prefs, setPrefs] = useState({
    mentions: true, invites: true, friendRequests: true, reactions: false, network: true,
    inApp: true, sound: false,
  });
  const flip = (k: keyof typeof prefs) => setPrefs((p) => ({ ...p, [k]: !p[k] }));
  const rows: { k: keyof typeof prefs; label: string; desc: string }[] = [
    { k: 'mentions', label: 'Mentions & replies', desc: 'When someone replies to you or uses your handle.' },
    { k: 'invites', label: 'Group invites', desc: 'Invitations to join a group or channel.' },
    { k: 'friendRequests', label: 'Friend requests', desc: 'New people asking to connect with you.' },
    { k: 'reactions', label: 'Reactions', desc: 'Emoji reactions on your messages.' },
    { k: 'network', label: 'Network events', desc: 'Station connectivity and federation changes.' },
  ];
  return (
    <SettingsContainer>
      <SettingsSection icon={Bell} title="What to notify me about" subtitle="Choose which events reach your notification center.">
        {rows.map((r) => (
          <SettingsRow key={r.k} label={r.label} desc={r.desc}>
            <Toggle label={r.label} on={prefs[r.k]} onToggle={() => flip(r.k)} />
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection icon={Bell} title="Delivery" subtitle="How notifications are delivered on this device.">
        <SettingsRow label="In-app notifications" desc="Show the bell badge and the notification panel.">
          <Toggle label="In-app notifications" on={prefs.inApp} onToggle={() => flip('inApp')} />
        </SettingsRow>
        <SettingsRow label="Sound" desc="Play a short sound for new notifications.">
          <Toggle label="Sound" on={prefs.sound} onToggle={() => flip('sound')} />
        </SettingsRow>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ── General · Privacy & Security ─────────────────────────────────────────────
function PrivacySection() {
  const [pinLock, setPinLock] = useState(false);
  const [hideOnline, setHideOnline] = useState(false);
  const [hideRead, setHideRead] = useState(false);
  return (
    <SettingsContainer>
      <SettingsSection icon={Lock} title="App access" subtitle="Protect Peers Touch on this device.">
        <SettingsRow label="PIN lock" desc="Ask for a PIN to open the app.">
          <Toggle label="PIN lock" on={pinLock} onToggle={() => setPinLock(!pinLock)} />
        </SettingsRow>
        {pinLock ? (
          <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
            <GhostBtn label="Change PIN" onClick={() => {}} />
            <GhostBtn label="Remove PIN" danger onClick={() => setPinLock(false)} />
          </div>
        ) : null}
        <SettingsRow label="Auto lock" desc="Lock automatically after inactivity.">
          <Select value="5m" ariaLabel="Auto lock" width={140} options={[
            { id: '1m', label: 'After 1 minute' },
            { id: '5m', label: 'After 5 minutes' },
            { id: '15m', label: 'After 15 minutes' },
            { id: 'never', label: 'Never' },
          ]} onChange={() => {}} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection icon={Eye} title="What others can see" subtitle="These defaults only affect new conversations.">
        <SettingsRow label="Online status" desc="Let people you talk to see when you are online.">
          <Toggle label="Online status visible" on={!hideOnline} onToggle={() => setHideOnline(!hideOnline)} />
        </SettingsRow>
        <SettingsRow label="Read receipts" desc="Show when you have read a message.">
          <Toggle label="Read receipts" on={!hideRead} onToggle={() => setHideRead(!hideRead)} />
        </SettingsRow>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ── General · Appearance & Language ──────────────────────────────────────────
function AppearanceSection() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  const [language, setLanguage] = useState('zh-CN');
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  return (
    <SettingsContainer>
      <SettingsSection icon={Eye} title="Appearance" subtitle="Make Peers Touch feel right on this screen.">
        <SettingsRow label="Theme" desc="Match system, or choose light or dark.">
          <Segmented value={theme} ariaLabel="Theme"
            options={[{ id: 'system', label: 'System' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]}
            onChange={setTheme} />
        </SettingsRow>
        <SettingsRow label="Message density" desc="Compact fits more messages on screen.">
          <Segmented value={density} ariaLabel="Message density"
            options={[{ id: 'comfortable', label: 'Comfortable' }, { id: 'compact', label: 'Compact' }]}
            onChange={setDensity} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection icon={Globe} title="Language" subtitle="Interface language.">
        <SettingsRow label="Display language">
          <Select value={language} ariaLabel="Display language" width={200} options={[
            { id: 'zh-CN', label: '简体中文' },
            { id: 'en', label: 'English' },
            { id: 'ja', label: '日本語' },
          ]} onChange={setLanguage} />
        </SettingsRow>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: FEDERATION (General group)
// ═══════════════════════════════════════════════════════════════════════════════

type FederationStatus = 'active' | 'degraded' | 'unreachable';

interface JoinedFederation {
  id: string;
  name: string;
  description: string;
  status: FederationStatus;
  stationCount: number;
  visibleActors: number;
  joinedAt: string;
  adminPtid: string;
  endpoint: string;
}

const MOCK_FEDERATIONS: JoinedFederation[] = [
  { id: 'fed-1', name: 'Peers Social Network', description: 'Primary open federation for social communication', status: 'active', stationCount: 12, visibleActors: 3842, joinedAt: '2026-05-12', adminPtid: 'ptid:alice@local', endpoint: 'https://federation.peers.social' },
  { id: 'fed-2', name: 'Lab Federation', description: 'Internal testing federation', status: 'active', stationCount: 3, visibleActors: 89, joinedAt: '2026-06-20', adminPtid: 'ptid:bob@local', endpoint: 'https://fed.lab.internal' },
  { id: 'fed-3', name: 'East Asia Network', description: 'Regional federation for East Asian users', status: 'degraded', stationCount: 7, visibleActors: 1205, joinedAt: '2026-07-01', adminPtid: 'ptid:alice@local', endpoint: 'https://east.peers.network' },
];

const CURRENT_ACTOR_PTID = 'ptid:alice@local';
const STATUS_CONFIG: Record<FederationStatus, { label: string; color: string }> = {
  active: { label: 'Online', color: '#10b981' },
  degraded: { label: 'Degraded', color: '#d48806' },
  unreachable: { label: 'Unreachable', color: '#cf1322' },
};

// ── Network · Your Station ──────────────────────────────────────────────────
function StationSection() {
  const online = true;
  return (
    <SettingsContainer>
      <SettingsSection icon={Wifi} title="Your station" subtitle="The personal center that holds your account and routes your messages.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: T.primaryWash, color: T.primary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Server size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{ACCOUNT_IDENTITY.station}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: online ? T.success : T.textQuaternary }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: online ? T.success : T.textTertiary }}>
                {online ? 'Online · working normally' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16 }}>
          {[
            { label: 'Connected peers', value: '24' },
            { label: 'Seed nodes', value: '3 / 4' },
            { label: 'Last sync', value: 'just now' },
          ].map((s) => (
            <div key={s.label} style={{ background: T.surface, borderRadius: 10, padding: '12px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>{s.value}</div>
              <div style={{ fontSize: 11, color: T.textTertiary, marginTop: 3 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection icon={MonitorSmartphone} title="Authorized devices" subtitle="Devices allowed to run this station.">
        {[
          { name: 'This Mac', meta: 'macOS · current session', current: true },
          { name: 'iPhone 15', meta: 'last seen 2h ago', current: false },
        ].map((d) => (
          <SettingsRow key={d.name} label={d.name} desc={d.meta}>
            {d.current
              ? <Tag text="This device" color={T.primary} />
              : <GhostBtn label="Remove" danger onClick={() => {}} />}
          </SettingsRow>
        ))}
      </SettingsSection>

      <CollapsibleSection icon={Shield} title="Technical details" subtitle="Routing identifiers for advanced troubleshooting.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
          <div>
            <div style={{ fontSize: 11, color: T.textTertiary }}>Actor ID</div>
            <div style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', color: T.textSecondary }}>{ACCOUNT_IDENTITY.ptid}</div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: T.textTertiary }}>Locator sequence</div>
            <div style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', color: T.textSecondary }}>seq:00000142</div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 11, color: T.textTertiary, marginBottom: 4 }}>Relay mounts</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Tag text="relay:east" color="#5b8def" />
              <Tag text="relay:lab" color="#13a8a8" />
              <Tag text="mount:social" color="#722ed1" />
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </SettingsContainer>
  );
}

// ── Network · Discovery ─────────────────────────────────────────────────────
type DiscoveryMode = 'hidden' | 'by_handle' | 'indexed';
function DiscoverySection() {
  const [mode, setMode] = useState<DiscoveryMode>('by_handle');
  const [inbound, setInbound] = useState<'networks' | 'anyone' | 'nobody'>('networks');
  const modeDesc: Record<DiscoveryMode, string> = {
    hidden: 'Invisible unless someone already has your exact handle.',
    by_handle: 'Found only by your exact handle — not listed in any directory.',
    indexed: 'Appears in the public directory and keyword search.',
  };
  return (
    <SettingsContainer>
      <SettingsSection icon={Globe} title="How people find you" subtitle="You stay in control of who can discover and reach you.">
        <Field label="Discoverable as">
          <Segmented<DiscoveryMode> value={mode} ariaLabel="Discoverable as"
            options={[
              { id: 'hidden', label: 'Hidden' },
              { id: 'by_handle', label: 'By handle' },
              { id: 'indexed', label: 'In directory' },
            ]}
            onChange={setMode} />
        </Field>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: T.textTertiary, lineHeight: 1.5 }}>{modeDesc[mode]}</p>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.borderSoft}` }}>
          <SettingsRow label="Your handle" desc="Share this so others can reach you.">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}>
              @alice@alpha.peers.social
              <button type="button" aria-label="Copy handle" title="Copy"
                onClick={() => navigator.clipboard?.writeText('@alice@alpha.peers.social')}
                style={{ width: 28, height: 28, border: 'none', borderRadius: 8, background: 'transparent', color: T.textTertiary, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Copy size={14} />
              </button>
            </span>
          </SettingsRow>
        </div>
      </SettingsSection>

      <SettingsSection icon={Users} title="Who can contact you" subtitle="Incoming friend and group requests.">
        <Field label="Accept requests from">
          <Segmented value={inbound} ariaLabel="Accept requests from"
            options={[
              { id: 'anyone', label: 'Anyone' },
              { id: 'networks', label: 'My networks' },
              { id: 'nobody', label: 'Nobody' },
            ]}
            onChange={setInbound} />
        </Field>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ── Network · Federations ───────────────────────────────────────────────────
function FederationSection({ federations, setFederations }: {
  federations: JoinedFederation[];
  setFederations: Dispatch<SetStateAction<JoinedFederation[]>>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);

  const handleAdd = () => {
    const url = addUrl.trim();
    if (!url) { setAddError('Enter a federation endpoint.'); return; }
    if (!/^(https?:\/\/|[\w-]+(\.[\w-]+)+)/.test(url)) { setAddError('That does not look like a valid endpoint.'); return; }
    const id = `fed-${Date.now()}`;
    setFederations((prev) => [...prev, {
      id, name: url.replace(/^https?:\/\//, '').split('/')[0], description: 'Joined federation',
      status: 'active' as FederationStatus, stationCount: 1, visibleActors: 0,
      joinedAt: new Date().toISOString().slice(0, 10),
      adminPtid: CURRENT_ACTOR_PTID, endpoint: url.startsWith('http') ? url : `https://${url}`,
    }]);
    setAddUrl(''); setAddError(''); setAddOpen(false);
  };

  const handleLeave = (id: string) => {
    setFederations((prev) => prev.filter((f) => f.id !== id));
    setConfirmLeaveId(null);
    if (expandedId === id) setExpandedId(null);
  };

  return (
    <SettingsContainer>
      <SettingsSection
        icon={Network}
        title="Joined networks"
        subtitle="Networks your station participates in. Create a new one from the Station Dashboard."
        action={<button type="button" aria-label="Join a network" title="Join a network"
          onClick={() => setAddOpen((v) => !v)}
          style={{ width: 30, height: 30, borderRadius: 8, border: 'none', backgroundColor: T.primary, color: T.white, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Plus size={15} />
        </button>}
      >
        {addOpen ? (
          <div style={{ border: `1px solid ${T.borderSoft}`, borderRadius: 10, padding: 12, marginBottom: 12, background: T.surface }}>
            <Field label="Network endpoint">
              <input autoFocus value={addUrl} onChange={(e) => { setAddUrl(e.target.value); setAddError(''); }}
                placeholder="https://federation.example.com" style={inputStyle}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAddOpen(false); }} />
            </Field>
            {addError ? <div style={{ color: T.danger, fontSize: 12, margin: '6px 0 0' }}>{addError}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
              <GhostBtn label="Cancel" onClick={() => { setAddOpen(false); setAddUrl(''); setAddError(''); }} />
              <PrimaryBtn icon={Network} label="Join" onClick={handleAdd} />
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {federations.map((f) => {
            const sc = STATUS_CONFIG[f.status];
            const expanded = expandedId === f.id;
            const admin = f.adminPtid === CURRENT_ACTOR_PTID;
            return (
              <SettingsItemCard key={f.id} onClick={() => setExpandedId(expanded ? null : f.id)} active={expanded}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{f.name}</span>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: sc.color, flexShrink: 0 }} title={sc.label} />
                      {admin ? <Shield size={12} color={T.primary} /> : null}
                    </div>
                    {f.description ? <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>{f.description}</div> : null}
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{f.stationCount}</div>
                      <div style={{ fontSize: 10, color: T.textTertiary }}>Stations</div>
                    </div>
                    <div style={{ width: 1, height: 24, backgroundColor: T.borderSoft }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{f.visibleActors.toLocaleString()}</div>
                      <div style={{ fontSize: 10, color: T.textTertiary }}>People</div>
                    </div>
                  </div>
                </div>
                {expanded ? (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.borderSoft}` }}>
                    <details>
                      <summary style={{ fontSize: 12, color: T.primary, cursor: 'pointer' }}>Technical details</summary>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 12, color: T.textSecondary, marginTop: 8, marginBottom: admin ? 12 : 0 }}>
                        <div><span style={{ color: T.textTertiary }}>Endpoint</span><div style={{ wordBreak: 'break-all' }}>{f.endpoint}</div></div>
                        <div><span style={{ color: T.textTertiary }}>Joined</span><div>{f.joinedAt}</div></div>
                      </div>
                    </details>
                    {admin ? (
                      confirmLeaveId === f.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', marginTop: 10, borderRadius: 8, backgroundColor: '#fff2f0', border: '1px solid #ffccc7' }}>
                          <span style={{ fontSize: 12, color: T.danger, flex: 1 }}>Leave this network? Your station will stop syncing its content.</span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); handleLeave(f.id); }}
                            style={{ height: 28, padding: '0 12px', borderRadius: 8, border: 'none', backgroundColor: T.danger, color: T.white, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Leave</button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmLeaveId(null); }}
                            style={{ height: 28, padding: '0 12px', borderRadius: 8, border: `1px solid ${T.borderSoft}`, backgroundColor: T.bg, color: T.textSecondary, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                        </div>
                      ) : (
                        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmLeaveId(f.id); }}
                          style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 4px', border: 'none', background: 'transparent', color: T.danger, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                          <LogOut size={13} /> Leave this network
                        </button>
                      )
                    ) : null}
                  </div>
                ) : null}
              </SettingsItemCard>
            );
          })}
        </div>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: GENERAL (General group)
// ═══════════════════════════════════════════════════════════════════════════════

// legacy GeneralSection removed: language/theme -> General>Appearance, PIN -> General>Privacy, model defaults -> AI>Providers

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: PROVIDERS (AI group)
// ═══════════════════════════════════════════════════════════════════════════════

type ModelKind = 'chat' | 'image' | 'embedding';
type TestState = 'idle' | 'testing' | 'ok' | 'fail';

interface ModelOption { id: string; name: string; kind: ModelKind; enabled: boolean; }
interface Provider { id: string; name: string; apiKey: string; baseUrl: string; models: ModelOption[]; }

const INITIAL_PROVIDERS: Provider[] = [
  { id: 'openai', name: 'OpenAI-compatible', apiKey: 'sk-proj-xxxxxxxxxxxxxxxx', baseUrl: 'https://api.openai.com/v1', models: [
    { id: 'gpt-5.4', name: 'gpt-5.4', kind: 'chat', enabled: true },
    { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini', kind: 'chat', enabled: true },
    { id: 'text-embedding-3', name: 'text-embedding-3', kind: 'embedding', enabled: true },
    { id: 'dall-e-4', name: 'dall-e-4', kind: 'image', enabled: false },
  ]},
  { id: 'anthropic', name: 'Anthropic', apiKey: 'sk-ant-xxxxxxxxxxxxxxxx', baseUrl: 'https://api.anthropic.com', models: [
    { id: 'claude-sonnet', name: 'claude-sonnet-4', kind: 'chat', enabled: true },
    { id: 'claude-haiku', name: 'claude-haiku-4', kind: 'chat', enabled: true },
  ]},
  { id: 'ollama', name: 'Ollama (local)', apiKey: '', baseUrl: 'http://127.0.0.1:11434', models: [
    { id: 'qwen-max', name: 'qwen-max', kind: 'chat', enabled: true },
    { id: 'deepseek-v3', name: 'deepseek-v3', kind: 'chat', enabled: false },
    { id: 'nomic-embed', name: 'nomic-embed-text', kind: 'embedding', enabled: true },
  ]},
];

const KIND_COLORS: Record<ModelKind, string> = { chat: '#1677ff', image: '#722ed1', embedding: '#13a8a8' };

function ProvidersSection() {
  const [providers, setProviders] = useState<Provider[]>(INITIAL_PROVIDERS);
  const [selId, setSelId] = useState('openai');
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>('idle');

  const sel = providers.find((p) => p.id === selId) ?? providers[0];

  const patchProvider = (id: string, p: Partial<Provider>) =>
    setProviders((prev) => prev.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const addProvider = () => {
    const id = `custom-${Date.now()}`;
    setProviders((prev) => [...prev, { id, name: 'New Provider', apiKey: '', baseUrl: 'https://', models: [] }]);
    setSelId(id);
  };

  const runTest = () => {
    setTest('testing');
    setTimeout(() => setTest(sel.baseUrl.startsWith('http') ? 'ok' : 'fail'), 700);
  };

  return (
    <SettingsContainer>
      <div style={{ display: 'flex', gap: 16 }}>
        {/* Provider list (260px) */}
        <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {providers.map((p) => {
            const active = p.id === selId;
            return (
              <div key={p.id} onClick={() => { setSelId(p.id); setTest('idle'); setShowKey(false); }} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${active ? T.primary : T.border}`,
                backgroundColor: active ? T.primaryWash : T.white,
              }}>
                <Server size={16} color={active ? T.primary : T.textTertiary} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: active ? 600 : 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </span>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.apiKey || p.baseUrl.includes('127.0.0.1') ? '#10b981' : T.textQuaternary }} />
              </div>
            );
          })}
          <div style={{ marginTop: 8 }}>
            <GhostBtn icon={Plus} label="Add Provider" onClick={addProvider} />
          </div>
        </div>

        {/* Provider detail panel */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <SettingsSection icon={Server} title={sel.name} subtitle="Provider configuration and available models."
            action={
              <div style={{ display: 'flex', gap: 8 }}>
                <GhostBtn
                  icon={test === 'testing' ? Loader2 : test === 'ok' ? CheckCircle2 : test === 'fail' ? XCircle : Activity}
                  label={test === 'testing' ? 'Testing...' : test === 'ok' ? 'Connected' : test === 'fail' ? 'Failed' : 'Test'}
                  onClick={runTest}
                />
              </div>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.text, marginBottom: 6 }}>API Key</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type={showKey ? 'text' : 'password'} value={sel.apiKey} placeholder="sk-..." onChange={(e) => patchProvider(sel.id, { apiKey: e.target.value })} style={{ ...inputStyle, flex: 1 }} />
                  <GhostBtn icon={showKey ? EyeOff : Eye} label={showKey ? 'Hide' : 'Show'} onClick={() => setShowKey(!showKey)} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: T.text, marginBottom: 6 }}>Base URL</div>
                <input value={sel.baseUrl} onChange={(e) => patchProvider(sel.id, { baseUrl: e.target.value })} style={inputStyle} />
              </div>
            </div>

            {/* Models sub-section */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${T.borderSoft}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Models</span>
                <GhostBtn icon={Plus} label="Add Model" onClick={() => patchProvider(sel.id, { models: [...sel.models, { id: `m-${Date.now()}`, name: 'new-model', kind: 'chat', enabled: true }] })} />
              </div>
              {sel.models.map((m, i) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${T.borderSoft}` }}>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: T.text }}>{m.name}</span>
                  <Tag text={m.kind} color={KIND_COLORS[m.kind]} />
                  <Toggle on={m.enabled} onToggle={() => patchProvider(sel.id, { models: sel.models.map((x) => x.id === m.id ? { ...x, enabled: !x.enabled } : x) })} />
                </div>
              ))}
            </div>
          </SettingsSection>
        </div>
      </div>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: MODELS (AI group) - cross-provider overview
// ═══════════════════════════════════════════════════════════════════════════════

function ModelsSection() {
  const [filter, setFilter] = useState<'all' | ModelKind>('all');

  const allModels = INITIAL_PROVIDERS.flatMap((p) =>
    p.models.map((m) => ({ ...m, provider: p.name }))
  );
  const filtered = filter === 'all' ? allModels : allModels.filter((m) => m.kind === filter);

  return (
    <SettingsContainer>
      <SettingsSection icon={Brain} title="All Models" subtitle="Cross-provider model overview with type filtering.">
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['all', 'chat', 'image', 'embedding'] as const).map((f) => (
            <div key={f} onClick={() => setFilter(f)} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: filter === f ? 600 : 500,
              cursor: 'pointer', color: filter === f ? T.primary : T.textSecondary,
              backgroundColor: filter === f ? T.primaryWash : 'transparent',
            }}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {filtered.map((m, i) => (
            <div key={`${m.provider}-${m.id}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i === 0 ? 'none' : `1px solid ${T.borderSoft}` }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: T.text }}>{m.name}</span>
              <span style={{ fontSize: 12, color: T.textTertiary }}>{m.provider}</span>
              <Tag text={m.kind} color={KIND_COLORS[m.kind]} />
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.enabled ? '#10b981' : T.textQuaternary }} />
            </div>
          ))}
        </div>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: MEMORY (AI group)
// ═══════════════════════════════════════════════════════════════════════════════

function MemorySection() {
  const [enabled, setEnabled] = useState(true);
  const [embModel, setEmbModel] = useState('text-embedding-3');
  const [storage, setStorage] = useState<'sqlite' | 'postgres'>('sqlite');
  const [dsn, setDsn] = useState('postgres://user:***@localhost:5432/peers_memory');
  const [dsnTest, setDsnTest] = useState<'idle' | 'testing' | 'ok'>('idle');
  const testDsn = () => {
    setDsnTest('testing');
    window.setTimeout(() => setDsnTest('ok'), 650);
  };
  const [vectorWeight, setVectorWeight] = useState(70);
  const [keywordWeight, setKeywordWeight] = useState(30);

  return (
    <SettingsContainer>
      <SettingsSection icon={Brain} title="Memory" subtitle="Long-term memory for AI conversations.">
        <SettingsRow label="Enable Memory" desc="Store and retrieve conversation context across sessions.">
          <Toggle on={enabled} onToggle={() => setEnabled(!enabled)} />
        </SettingsRow>
        <SettingsRow label="Embedding Model" desc="Model used for semantic search indexing.">
          <Select value={embModel} width={200} options={[
            { id: 'text-embedding-3', label: 'text-embedding-3' },
            { id: 'nomic-embed-text', label: 'nomic-embed-text' },
          ]} onChange={setEmbModel} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon={HardDrive} title="Storage Backend" subtitle="Where memory vectors and metadata are stored.">
        <SettingsRow label="Storage Type">
          <div style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {(['sqlite', 'postgres'] as const).map((s, i) => (
              <div key={s} onClick={() => setStorage(s)} style={{
                padding: '6px 14px', fontSize: 12, fontWeight: storage === s ? 700 : 500, cursor: 'pointer',
                color: storage === s ? T.white : T.textSecondary,
                backgroundColor: storage === s ? T.primary : T.bg,
                borderLeft: i === 0 ? 'none' : `1px solid ${T.border}`,
              }}>
                {s === 'sqlite' ? 'SQLite' : 'PostgreSQL'}
              </div>
            ))}
          </div>
        </SettingsRow>
        {storage === 'postgres' ? (
          <div style={{ paddingTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: T.text, marginBottom: 6 }}>PostgreSQL DSN</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={dsn} onChange={(e) => { setDsn(e.target.value); setDsnTest('idle'); }} style={{ ...inputStyle, flex: 1, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
              <GhostBtn
                icon={dsnTest === 'ok' ? CheckCircle2 : Activity}
                label={dsnTest === 'testing' ? 'Testing…' : dsnTest === 'ok' ? 'Reachable' : 'Test'}
                onClick={testDsn}
              />
            </div>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection icon={Sliders} title="Search Weights" subtitle="Balance between semantic (vector) and keyword search.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: T.text }}>Vector Weight</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>{vectorWeight}%</span>
            </div>
            <input type="range" min={0} max={100} value={vectorWeight} onChange={(e) => { setVectorWeight(+e.target.value); setKeywordWeight(100 - +e.target.value); }} style={{ width: '100%', accentColor: T.primary }} />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: T.text }}>Keyword Weight</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>{keywordWeight}%</span>
            </div>
            <input type="range" min={0} max={100} value={keywordWeight} onChange={(e) => { setKeywordWeight(+e.target.value); setVectorWeight(100 - +e.target.value); }} style={{ width: '100%', accentColor: T.primary }} />
          </div>
        </div>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: SKILLS (AI group)
// ═══════════════════════════════════════════════════════════════════════════════

type SkillTab = 'installed' | 'builtin' | 'market';

interface SkillItem {
  id: string; name: string; desc: string;
  source: 'user' | 'github' | 'builtin' | 'market';
  scan: 'passed' | 'warning'; enabled: boolean; installed: boolean;
}

const SKILLS_DATA: SkillItem[] = [
  { id: 'sk-1', name: 'meeting-digest', desc: 'Compress meeting notes into actionable items.', source: 'github', scan: 'passed', enabled: true, installed: true },
  { id: 'sk-2', name: 'pdf-extract', desc: 'Extract structured fields from PDF documents.', source: 'user', scan: 'warning', enabled: true, installed: true },
  { id: 'sk-3', name: 'web-summarize', desc: 'Fetch web page content and generate summaries.', source: 'builtin', scan: 'passed', enabled: true, installed: true },
  { id: 'sk-4', name: 'code-review', desc: 'Review diffs with key-point analysis.', source: 'builtin', scan: 'passed', enabled: false, installed: true },
  { id: 'sk-5', name: 'translate-pro', desc: 'Terminology-consistent multi-language translation.', source: 'market', scan: 'passed', enabled: false, installed: false },
  { id: 'sk-6', name: 'sql-explain', desc: 'Explain and optimize SQL queries.', source: 'market', scan: 'passed', enabled: false, installed: false },
  { id: 'sk-7', name: 'image-caption', desc: 'Generate descriptive captions for images.', source: 'market', scan: 'passed', enabled: false, installed: false },
];

function SkillsSection() {
  const [tab, setTab] = useState<SkillTab>('installed');
  const [skills, setSkills] = useState<SkillItem[]>(SKILLS_DATA);
  const [importOpen, setImportOpen] = useState(false);
  const [importKind, setImportKind] = useState<'github' | 'url' | 'zip'>('github');
  const [importAddr, setImportAddr] = useState('');

  const list = skills.filter((s) =>
    tab === 'installed' ? s.installed && s.source !== 'builtin' : tab === 'builtin' ? s.source === 'builtin' : !s.installed
  );

  const patch = (id: string, p: Partial<SkillItem>) => setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));

  const doImport = () => {
    if (!importAddr.trim()) return;
    const id = `sk-${Date.now()}`;
    const name = importAddr.trim().split('/').pop()?.replace(/\.(zip|git)$/, '') || 'imported-skill';
    setSkills((prev) => [{ id, name, desc: `Imported from ${importKind}.`, source: 'user' as const, scan: 'warning' as const, enabled: false, installed: true }, ...prev]);
    setImportAddr('');
    setImportOpen(false);
    setTab('installed');
  };

  return (
    <SettingsContainer>
      <SettingsSection icon={ScrollText} title="Skills" subtitle="Reusable capability packages. Import from GitHub, URL, or ZIP."
        action={<PrimaryBtn icon={Plus} label="Import Skill" onClick={() => setImportOpen(!importOpen)} />}
      >
        {importOpen ? (
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 14, marginBottom: 16, backgroundColor: T.fillQuaternary }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {(['github', 'url', 'zip'] as const).map((k) => {
                const Icon = k === 'github' ? Github : k === 'url' ? LinkIcon : FileArchive;
                return (
                  <div key={k} onClick={() => setImportKind(k)} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                    borderRadius: 8, fontSize: 12, fontWeight: importKind === k ? 700 : 500, cursor: 'pointer',
                    color: importKind === k ? T.primary : T.textSecondary,
                    backgroundColor: importKind === k ? T.primaryWash : T.white,
                    border: `1px solid ${importKind === k ? T.primary : T.border}`,
                  }}>
                    <Icon size={13} />{k.toUpperCase()}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={importAddr} onChange={(e) => setImportAddr(e.target.value)} placeholder={importKind === 'github' ? 'owner/repo' : importKind === 'url' ? 'https://...' : 'path/to/skill.zip'} style={{ ...inputStyle, flex: 1 }} />
              <PrimaryBtn label="Import" onClick={doImport} />
            </div>
          </div>
        ) : null}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
          {(['installed', 'builtin', 'market'] as SkillTab[]).map((t) => (
            <div key={t} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 13,
              fontWeight: tab === t ? 600 : 500, cursor: 'pointer',
              color: tab === t ? T.primary : T.textSecondary,
              backgroundColor: tab === t ? T.primaryWash : 'transparent',
            }}>
              {t === 'installed' ? 'Installed' : t === 'builtin' ? 'Builtin' : 'Market'}
            </div>
          ))}
        </div>

        {list.length === 0 ? (
          <div style={{ fontSize: 13, color: T.textTertiary, padding: '8px 0' }}>No skills in this category.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {list.map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i === 0 ? 'none' : `1px solid ${T.borderSoft}` }}>
                <ScrollText size={18} color={T.textTertiary} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{s.name}</span>
                    <Tag text={s.source} color="#722ed1" />
                    {s.scan === 'passed'
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#10b981' }}><ShieldCheck size={12} />Scanned</span>
                      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#d48806' }}><ShieldAlert size={12} />Review</span>
                    }
                  </div>
                  <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>{s.desc}</div>
                </div>
                {tab === 'market' ? (
                  <PrimaryBtn label="Install" onClick={() => patch(s.id, { installed: true, enabled: true })} />
                ) : (
                  <Toggle on={s.enabled} onToggle={() => patch(s.id, { enabled: !s.enabled })} />
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: MCP (AI group)
// ═══════════════════════════════════════════════════════════════════════════════

type Transport = 'stdio' | 'http' | 'sse';

interface MCPServer {
  id: string; name: string; transport: Transport;
  endpoint: string; enabled: boolean; toolCount: number;
  tools: string[]; test: TestState;
}

const INITIAL_MCP: MCPServer[] = [
  { id: 'mcp-1', name: 'integrated_browser', transport: 'stdio', endpoint: 'npx @pt/mcp-browser', enabled: true, toolCount: 6, tools: ['navigate', 'click', 'snapshot', 'type', 'screenshot', 'evaluate'], test: 'ok' },
  { id: 'mcp-2', name: 'web_search', transport: 'http', endpoint: 'https://mcp.example.com/search', enabled: true, toolCount: 2, tools: ['search', 'fetch'], test: 'idle' },
  { id: 'mcp-3', name: 'filesystem', transport: 'stdio', endpoint: 'npx @pt/mcp-fs', enabled: false, toolCount: 4, tools: ['read', 'write', 'list', 'stat'], test: 'idle' },
];

const JSON_SAMPLE = `{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["@pt/mcp-fs", "/path"] },
    "web_search": { "url": "https://mcp.example.com/search" }
  }
}`;

const TRANSPORT_COLOR: Record<Transport, string> = { stdio: '#722ed1', http: '#1677ff', sse: '#13a8a8' };

function MCPSection() {
  const [servers, setServers] = useState<MCPServer[]>(INITIAL_MCP);
  const [addOpen, setAddOpen] = useState(false);
  const [addMode, setAddMode] = useState<'form' | 'json'>('form');
  const [draft, setDraft] = useState({ name: '', transport: 'stdio' as Transport, endpoint: '' });
  const [jsonText, setJsonText] = useState(JSON_SAMPLE);
  const [expanded, setExpanded] = useState<string | null>(null);

  const patch = (id: string, p: Partial<MCPServer>) => setServers((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const remove = (id: string) => setServers((prev) => prev.filter((s) => s.id !== id));

  const addServer = () => {
    if (!draft.name.trim() || !draft.endpoint.trim()) return;
    setServers((prev) => [...prev, { id: `mcp-${Date.now()}`, name: draft.name, transport: draft.transport, endpoint: draft.endpoint, enabled: true, toolCount: 0, tools: [], test: 'idle' }]);
    setDraft({ name: '', transport: 'stdio', endpoint: '' });
    setAddOpen(false);
  };

  const runTest = (id: string) => {
    patch(id, { test: 'testing' });
    setTimeout(() => patch(id, { test: 'ok' }), 700);
  };

  return (
    <SettingsContainer>
      <SettingsSection icon={Plug} title="MCP Servers" subtitle="Model Context Protocol servers (stdio / http / sse)."
        action={<PrimaryBtn icon={Plus} label="Add Server" onClick={() => setAddOpen(!addOpen)} />}
      >
        {addOpen ? (
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 14, marginBottom: 16, backgroundColor: T.fillQuaternary }}>
            <div style={{ display: 'inline-flex', gap: 2, padding: 2, borderRadius: 8, backgroundColor: T.fillTertiary, marginBottom: 12 }}>
              {(['form', 'json'] as const).map((m) => (
                <span key={m} onClick={() => setAddMode(m)} style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  color: addMode === m ? T.primary : T.textSecondary,
                  backgroundColor: addMode === m ? T.white : 'transparent',
                }}>
                  {m === 'form' ? 'Single Add' : 'JSON Import'}
                </span>
              ))}
            </div>
            {addMode === 'form' ? (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Server name" style={{ ...inputStyle, flex: 1 }} />
                  <Select value={draft.transport} width={120} options={(['stdio', 'http', 'sse'] as Transport[]).map((t) => ({ id: t, label: t }))} onChange={(v) => setDraft({ ...draft, transport: v as Transport })} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input value={draft.endpoint} onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })} placeholder={draft.transport === 'stdio' ? 'npx @pt/mcp-xxx' : 'https://...'} style={{ ...inputStyle, flex: 1 }} />
                  <PrimaryBtn label="Add" onClick={addServer} />
                </div>
              </>
            ) : (
              <>
                <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={8} spellCheck={false} style={{ ...inputStyle, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, resize: 'vertical' }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                  <PrimaryBtn icon={FileJson} label="Import Config" onClick={() => setAddOpen(false)} />
                </div>
              </>
            )}
          </div>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {servers.map((s, i) => (
            <div key={s.id} style={{ padding: '12px 0', borderTop: i === 0 ? 'none' : `1px solid ${T.borderSoft}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Plug size={18} color={T.textTertiary} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{s.name}</span>
                    <Tag text={s.transport} color={TRANSPORT_COLOR[s.transport]} />
                    {s.toolCount > 0 ? (
                      <span onClick={() => setExpanded(expanded === s.id ? null : s.id)} style={{ fontSize: 11, color: T.primary, cursor: 'pointer' }}>{s.toolCount} tools</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2, fontFamily: 'ui-monospace, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.endpoint}
                  </div>
                </div>
                <GhostBtn
                  icon={s.test === 'testing' ? Loader2 : s.test === 'ok' ? CheckCircle2 : Activity}
                  label={s.test === 'testing' ? '...' : s.test === 'ok' ? 'OK' : 'Test'}
                  onClick={() => runTest(s.id)}
                />
                <Toggle on={s.enabled} onToggle={() => patch(s.id, { enabled: !s.enabled })} />
                <Trash2 size={15} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={() => remove(s.id)} />
              </div>
              {expanded === s.id && s.tools.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, marginLeft: 30 }}>
                  {s.tools.map((t) => <Tag key={t} text={t} color={T.textSecondary} />)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: CHANNELS (Channels group)
// ═══════════════════════════════════════════════════════════════════════════════

function ChannelsSection() {
  const channels = [
    { id: 'ch-1', name: 'Direct Messages', type: 'dm', icon: MessageSquare, connected: true },
    { id: 'ch-2', name: 'Group Chats', type: 'group', icon: Users, connected: true },
    { id: 'ch-3', name: 'Federation Relay', type: 'relay', icon: Network, connected: true },
    { id: 'ch-4', name: 'Email Bridge', type: 'bridge', icon: Send, connected: false },
    { id: 'ch-5', name: 'Matrix Bridge', type: 'bridge', icon: Globe, connected: false },
  ];

  const TYPE_COLORS: Record<string, string> = { dm: '#1677ff', group: '#722ed1', relay: '#13a8a8', bridge: '#d48806' };

  return (
    <SettingsContainer>
      <SettingsSection icon={Send} title="Communication Channels" subtitle="Connected messaging channels and bridge integrations.">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {channels.map((ch, i) => {
            const Icon = ch.icon;
            return (
              <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', borderTop: i === 0 ? 'none' : `1px solid ${T.borderSoft}` }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: T.fillQuaternary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={18} color={T.textSecondary} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{ch.name}</div>
                </div>
                <Tag text={ch.type} color={TYPE_COLORS[ch.type] || T.textSecondary} />
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ch.connected ? '#10b981' : T.textQuaternary }} />
                <span style={{ fontSize: 12, color: ch.connected ? '#10b981' : T.textTertiary }}>{ch.connected ? 'Connected' : 'Offline'}</span>
              </div>
            );
          })}
        </div>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: APPLETS (Applets group)
// ═══════════════════════════════════════════════════════════════════════════════

function AppletsSection() {
  const [applets, setApplets] = useState([
    { id: 'ap-1', name: 'Note', version: 'v1.2.0', status: 'active', desc: 'Rich-text note-taking with markdown support.', enabled: true },
    { id: 'ap-2', name: 'Calendar', version: 'v1.0.3', status: 'active', desc: 'Schedule management and event reminders.', enabled: true },
    { id: 'ap-3', name: 'Todo', version: 'v0.9.1', status: 'beta', desc: 'Task management with Kanban board view.', enabled: true },
    { id: 'ap-4', name: 'Whiteboard', version: 'v0.8.0', status: 'beta', desc: 'Collaborative drawing and diagramming tool.', enabled: false },
    { id: 'ap-5', name: 'Code Snippet', version: 'v1.1.0', status: 'active', desc: 'Syntax-highlighted code snippet manager.', enabled: true },
    { id: 'ap-6', name: 'RSS Reader', version: 'v0.5.0', status: 'experimental', desc: 'Feed aggregation and reading experience.', enabled: false },
  ]);

  const STATUS_COLORS: Record<string, string> = { active: '#10b981', beta: '#d48806', experimental: '#722ed1' };

  return (
    <SettingsContainer>
      <SettingsSection icon={Puzzle} title="Installed Applets" subtitle="Manage applet modules loaded into the workspace.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {applets.map((ap) => (
            <div key={ap.id} style={{
              padding: 16, borderRadius: 10, backgroundColor: T.fillQuaternary,
              border: `1px solid ${T.border}`, opacity: ap.enabled ? 1 : 0.6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Puzzle size={18} color={T.primary} />
                <span style={{ fontSize: 14, fontWeight: 600, color: T.text, flex: 1 }}>{ap.name}</span>
                <Toggle on={ap.enabled} onToggle={() => setApplets((prev) => prev.map((a) => a.id === ap.id ? { ...a, enabled: !a.enabled } : a))} />
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <Tag text={ap.version} color={T.textSecondary} />
                <Tag text={ap.status} color={STATUS_COLORS[ap.status] || T.textTertiary} />
              </div>
              <div style={{ fontSize: 12, color: T.textTertiary }}>{ap.desc}</div>
            </div>
          ))}
        </div>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: STATISTICS (Data group)
// ═══════════════════════════════════════════════════════════════════════════════

function StatisticsSection() {
  const summaryCards = [
    { label: 'Sessions', value: '1,842', icon: MessageSquare, color: '#1677ff' },
    { label: 'Messages', value: '24,391', icon: Send, color: '#722ed1' },
    { label: 'Words', value: '1.2M', icon: ScrollText, color: '#13a8a8' },
    { label: 'Agents', value: '7', icon: Cpu, color: '#d48806' },
  ];

  // Simplified activity heatmap (7 columns x 4 rows)
  // Fixed demo series (never random — a settings screen must not change on render).
  const heatmapData = [0.2,0.5,0.8,0.6,0.3,0.1,0.4,0.7,0.9,0.5,0.2,0.3,0.6,0.8,0.4,0.2,0.5,0.7,0.6,0.3,0.1,0.4,0.6,0.8,0.5,0.3,0.2,0.4];

  const rankModels = [
    { name: 'gpt-5.4', count: 8420 },
    { name: 'claude-sonnet-4', count: 5210 },
    { name: 'qwen-max', count: 2130 },
    { name: 'deepseek-v3', count: 890 },
  ];

  const rankAgents = [
    { name: 'Research Assistant', count: 3240 },
    { name: 'Writing Partner', count: 2810 },
    { name: 'Code Reviewer', count: 1950 },
  ];

  const rankTopics = [
    { name: 'Architecture Design', count: 420 },
    { name: 'Bug Fixing', count: 380 },
    { name: 'Documentation', count: 290 },
    { name: 'Code Generation', count: 250 },
  ];

  return (
    <SettingsContainer>
      {/* Summary Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {summaryCards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} style={{
              padding: 16, borderRadius: 12, backgroundColor: T.white,
              border: `1px solid ${T.border}`, textAlign: 'center',
            }}>
              <Icon size={20} color={c.color} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{c.value}</div>
              <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 4 }}>{c.label}</div>
            </div>
          );
        })}
      </div>

      {/* Activity Heatmap */}
      <SettingsSection icon={Flame} title="Activity Heatmap" subtitle="Message activity over the past 4 weeks.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {heatmapData.map((v, i) => (
            <div key={i} style={{
              width: '100%', paddingTop: '100%', borderRadius: 4, position: 'relative',
              backgroundColor: v > 0.7 ? T.primary : v > 0.4 ? T.primaryWash : v > 0.15 ? T.fillTertiary : T.fillQuaternary,
            }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: T.textTertiary }}>Less</span>
          {[T.fillQuaternary, T.fillTertiary, T.primaryWash, T.primary].map((c, i) => (
            <div key={i} style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: c }} />
          ))}
          <span style={{ fontSize: 11, color: T.textTertiary }}>More</span>
        </div>
      </SettingsSection>

      {/* Rank Lists */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        {[
          { title: 'Model Usage', data: rankModels },
          { title: 'Agent Usage', data: rankAgents },
          { title: 'Topic Frequency', data: rankTopics },
        ].map((section) => (
          <div key={section.title} style={{ backgroundColor: T.white, borderRadius: 12, padding: 16, border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 12 }}>{section.title}</div>
            {section.data.map((item, i) => {
              const maxCount = section.data[0].count;
              return (
                <div key={item.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: T.text }}>{i + 1}. {item.name}</span>
                    <span style={{ fontSize: 11, color: T.textTertiary }}>{item.count}</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, backgroundColor: T.fillTertiary }}>
                    <div style={{ height: '100%', borderRadius: 2, backgroundColor: T.primary, width: `${(item.count / maxCount) * 100}%`, opacity: 1 - i * 0.2 }} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: LOGS (Data group)
// ═══════════════════════════════════════════════════════════════════════════════

type LogLevel = 'info' | 'warn' | 'error';

function LogsSection() {
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');

  const logs: { time: string; level: LogLevel; source: string; message: string }[] = [
    { time: '2026-07-21 14:32:01', level: 'info', source: 'federation', message: 'Routing table refreshed. 24 peers active.' },
    { time: '2026-07-21 14:31:58', level: 'info', source: 'mcp', message: 'Server integrated_browser connected (6 tools).' },
    { time: '2026-07-21 14:30:12', level: 'warn', source: 'provider', message: 'Anthropic API rate limit approaching (80% quota).' },
    { time: '2026-07-21 14:28:44', level: 'error', source: 'federation', message: 'Station Delta unreachable after 3 retries.' },
    { time: '2026-07-21 14:25:00', level: 'info', source: 'memory', message: 'Memory index rebuilt. 12,480 embeddings indexed.' },
    { time: '2026-07-21 14:22:33', level: 'warn', source: 'applet', message: 'Whiteboard applet failed health check. Retrying.' },
    { time: '2026-07-21 14:20:01', level: 'info', source: 'kernel', message: 'Boot sequence complete. 5 runtimes initialized.' },
    { time: '2026-07-21 14:18:55', level: 'error', source: 'provider', message: 'Ollama connection refused at 127.0.0.1:11434.' },
    { time: '2026-07-21 14:15:20', level: 'info', source: 'skill', message: 'Skill meeting-digest loaded from GitHub cache.' },
  ];

  const LEVEL_COLORS: Record<LogLevel, string> = { info: '#1677ff', warn: '#d48806', error: '#cf1322' };
  const filtered = levelFilter === 'all' ? logs : logs.filter((l) => l.level === levelFilter);

  return (
    <SettingsContainer>
      <SettingsSection icon={ScrollText} title="System Logs" subtitle="Recent system events and diagnostic messages.">
        {/* Level filter */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['all', 'info', 'warn', 'error'] as const).map((l) => (
            <div key={l} onClick={() => setLevelFilter(l)} style={{
              padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: levelFilter === l ? 600 : 500,
              cursor: 'pointer', color: levelFilter === l ? T.primary : T.textSecondary,
              backgroundColor: levelFilter === l ? T.primaryWash : 'transparent',
              border: `1px solid ${levelFilter === l ? T.primary : 'transparent'}`,
            }}>
              {l === 'all' ? 'All' : l.toUpperCase()}
            </div>
          ))}
        </div>

        {/* Log table */}
        <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.border}` }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '150px 60px 100px 1fr', padding: '8px 12px', backgroundColor: T.fillQuaternary, fontSize: 11, fontWeight: 600, color: T.textTertiary, textTransform: 'uppercase' }}>
            <span>Timestamp</span>
            <span>Level</span>
            <span>Source</span>
            <span>Message</span>
          </div>
          {filtered.map((log, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 60px 100px 1fr', padding: '8px 12px', fontSize: 12, borderTop: `1px solid ${T.borderSoft}`, alignItems: 'center' }}>
              <span style={{ color: T.textTertiary, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{log.time}</span>
              <span><Tag text={log.level} color={LEVEL_COLORS[log.level]} /></span>
              <span style={{ color: T.textSecondary }}>{log.source}</span>
              <span style={{ color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.message}</span>
            </div>
          ))}
        </div>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: HELP (Help group)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Advanced · Data & Storage ──────────────────────────────────────────────
function DataStorageSection() {
  const [cacheCleared, setCacheCleared] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const buckets = [
    { label: 'Messages & media', value: '384 MB', pct: 62 },
    { label: 'AI memory index', value: '128 MB', pct: 21 },
    { label: 'Applets & skills', value: '64 MB', pct: 11 },
    { label: 'Cache', value: '40 MB', pct: 6 },
  ];
  return (
    <SettingsContainer>
      <SettingsSection icon={HardDrive} title="Local storage" subtitle="Everything lives on this device and your station.">
        {buckets.map((b) => (
          <div key={b.label} style={{ margin: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
              <span style={{ color: T.text }}>{b.label}</span>
              <span style={{ color: T.textTertiary }}>{b.value}</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: '#f0f0f0', overflow: 'hidden' }}>
              <div style={{ width: `${b.pct}%`, height: '100%', background: T.primary, borderRadius: 3 }} />
            </div>
          </div>
        ))}
      </SettingsSection>

      <SettingsSection icon={Database} title="Backup & files" subtitle="Take your data with you.">
        <SettingsRow label="My files" desc="2 files · 4.2 MB">
          <GhostBtn label="Manage files" onClick={() => {}} />
        </SettingsRow>
        <SettingsRow label="Export local data" desc="Download a copy of your messages and settings.">
          <GhostBtn label="Export" onClick={() => {}} />
        </SettingsRow>
        <SettingsRow label="Clear cache" desc={cacheCleared ? 'Cache cleared.' : 'Frees space without deleting your messages.'}>
          <GhostBtn label={cacheCleared ? 'Cleared' : 'Clear'} onClick={() => setCacheCleared(true)} />
        </SettingsRow>
      </SettingsSection>

      <DangerZone title="Reset" desc="Start the first-run setup again on the next launch. Your station data on disk is not deleted.">
        {confirmReset ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: T.danger, flex: 1, minWidth: 200 }}>Re-show onboarding and reset local preferences?</span>
            <button type="button"
              onClick={() => { setConfirmReset(false); }}
              style={{ height: 28, padding: '0 12px', borderRadius: 8, border: `1px solid ${T.borderSoft}`, background: T.bg, color: T.textSecondary, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            <button type="button"
              onClick={() => setConfirmReset(false)}
              style={{ height: 28, padding: '0 12px', borderRadius: 8, border: 'none', background: T.danger, color: T.white, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Reset onboarding</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmReset(true)}
            style={{ height: 32, padding: '0 14px', borderRadius: 8, border: 'none', background: T.danger, color: T.white, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Reset onboarding
          </button>
        )}
      </DangerZone>
    </SettingsContainer>
  );
}

// ── Advanced · About ────────────────────────────────────────────────────────
function AboutSection() {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const featureGroups = [
    { id: 'messaging', label: 'Messaging', items: ['End-to-end encrypted DMs', 'Group chats across networks', 'Rich media attachments', 'Reactions and threads'] },
    { id: 'ai', label: 'AI features', items: ['Multi-provider models', 'Custom skill packages', 'MCP server integration', 'Long-term memory'] },
    { id: 'network', label: 'Your network', items: ['Your own station', 'Cross-station messaging', 'Decentralized identity', 'Relay routing'] },
    { id: 'applets', label: 'Applets', items: ['Notes', 'Calendar', 'Task boards', 'Extensible plugins'] },
  ];
  return (
    <SettingsContainer>
      <SettingsSection icon={Info} title="About Peers Touch" subtitle="Your social world, held in your own center.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          <SettingsRow label="Version" desc="v0.9.2-beta" />
          <SettingsRow label="Build" desc="20261012.1012" />
          <SettingsRow label="Platform" desc="macOS arm64 · Tauri 2.x" />
          <SettingsRow label="Runtime" desc="WebKit + Rust" />
        </div>
      </SettingsSection>

      <SettingsSection icon={HelpCircle} title="What's inside" subtitle="A quick tour of the capabilities in this build.">
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {featureGroups.map((fg) => {
            const expanded = expandedGroup === fg.id;
            return (
              <div key={fg.id}>
                <button type="button" aria-expanded={expanded} onClick={() => setExpandedGroup(expanded ? null : fg.id)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px',
                    borderRadius: 8, cursor: 'pointer', border: 'none', background: 'transparent', textAlign: 'left',
                  }}>
                  {expanded ? <ChevronDown size={15} color={T.textSecondary} /> : <ChevronRight size={15} color={T.textSecondary} />}
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{fg.label}</span>
                  <span style={{ fontSize: 12, color: T.textTertiary, marginLeft: 'auto' }}>{fg.items.length}</span>
                </button>
                {expanded ? (
                  <div style={{ paddingLeft: 30, paddingBottom: 8 }}>
                    {fg.items.map((item) => (
                      <div key={item} style={{ fontSize: 13, color: T.textSecondary, padding: '4px 0' }}>{item}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </SettingsSection>
    </SettingsContainer>
  );
}

function CronJobsSection() {
  return (
    <SettingsContainer>
      <SettingsSection icon={Clock} title="Cron Jobs">
        <SettingsRow label="Daily workspace summary" desc="Every day at 09:00">
          <span style={{ color: T.success, fontSize: 12 }}>Active</span>
        </SettingsRow>
        <SettingsRow label="Weekly backup" desc="Every Sunday at 02:00">
          <span style={{ color: T.textTertiary, fontSize: 12 }}>Paused</span>
        </SettingsRow>
      </SettingsSection>
    </SettingsContainer>
  );
}

function CommandPaletteSection({ onOpen }: { onOpen: () => void }) {
  return (
    <SettingsContainer>
      <SettingsSection
        icon={Command}
        title="Command Palette"
        action={<PrimaryBtn label="Open Command Palette" icon={Command} onClick={onOpen} />}
      >
        <span />
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IA + PAGE SHELL (4 groups; non-technical content first)
// ═══════════════════════════════════════════════════════════════════════════════

type GroupId = 'general' | 'network' | 'ai' | 'advanced';
type SectionId =
  | 'account' | 'notifications' | 'privacy' | 'appearance'
  | 'station' | 'discovery' | 'federation'
  | 'providers' | 'models' | 'memory' | 'skills' | 'mcp'
  | 'storage' | 'channels' | 'applets' | 'statistics' | 'cron' | 'command-menu' | 'logs' | 'about';

interface SectionDef { id: SectionId; label: string; icon: LucideIcon; }
interface GroupDef { id: GroupId; label: string; icon: LucideIcon; sections: SectionDef[]; }

const GROUPS: GroupDef[] = [
  {
    id: 'general', label: 'General', icon: Settings,
    sections: [
      { id: 'account', label: 'Account', icon: User },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'privacy', label: 'Privacy & Security', icon: Lock },
      { id: 'appearance', label: 'Appearance & Language', icon: Sliders },
    ],
  },
  {
    id: 'network', label: 'Network', icon: Globe,
    sections: [
      { id: 'station', label: 'Your Station', icon: Server },
      { id: 'discovery', label: 'Discovery', icon: Globe },
      { id: 'federation', label: 'Networks', icon: Network },
    ],
  },
  {
    id: 'ai', label: 'AI', icon: Sparkles,
    sections: [
      { id: 'providers', label: 'Providers', icon: Server },
      { id: 'models', label: 'Models', icon: Brain },
      { id: 'memory', label: 'Memory', icon: HardDrive },
      { id: 'skills', label: 'Skills', icon: ScrollText },
      { id: 'mcp', label: 'MCP', icon: Plug },
    ],
  },
  {
    id: 'advanced', label: 'Advanced', icon: Wrench,
    sections: [
      { id: 'storage', label: 'Data & Storage', icon: Database },
      { id: 'channels', label: 'Channels', icon: Send },
      { id: 'applets', label: 'Applets', icon: Puzzle },
      { id: 'statistics', label: 'Statistics', icon: BarChart3 },
      { id: 'logs', label: 'Diagnostics & Logs', icon: ScrollText },
      { id: 'cron', label: 'Scheduled Tasks', icon: Clock },
      { id: 'command-menu', label: 'Command Palette', icon: Command },
      { id: 'about', label: 'About', icon: Info },
    ],
  },
];

function renderSection(sectionId: SectionId, onOpenCommandPalette: () => void,
  federations: JoinedFederation[], setFederations: Dispatch<SetStateAction<JoinedFederation[]>>) {
  switch (sectionId) {
    case 'account': return <AccountSection federations={federations} />;
    case 'notifications': return <NotificationsSettingsSection />;
    case 'privacy': return <PrivacySection />;
    case 'appearance': return <AppearanceSection />;
    case 'station': return <StationSection />;
    case 'discovery': return <DiscoverySection />;
    case 'federation': return <FederationSection federations={federations} setFederations={setFederations} />;
    case 'providers': return <ProvidersSection />;
    case 'models': return <ModelsSection />;
    case 'memory': return <MemorySection />;
    case 'skills': return <SkillsSection />;
    case 'mcp': return <MCPSection />;
    case 'storage': return <DataStorageSection />;
    case 'channels': return <ChannelsSection />;
    case 'applets': return <AppletsSection />;
    case 'statistics': return <StatisticsSection />;
    case 'logs': return <LogsSection />;
    case 'cron': return <CronJobsSection />;
    case 'command-menu': return <CommandPaletteSection onOpen={onOpenCommandPalette} />;
    case 'about': return <AboutSection />;
    default: return null;
  }
}

export function SettingsPage({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  const [activeGroup, setActiveGroup] = useState<GroupId>('general');
  const [activeSection, setActiveSection] = useState<SectionId>('account');
  const [federations, setFederations] = useState<JoinedFederation[]>(MOCK_FEDERATIONS);

  const group = GROUPS.find((g) => g.id === activeGroup) ?? GROUPS[0];
  const current = group.sections.find((s) => s.id === activeSection) ?? group.sections[0];
  // Level-2 navigation is always a vertical section rail (never a second
  // horizontal tab strip). All groups currently have >1 section.
  const showSidebar = group.sections.length > 1;

  const onGroupChange = (gid: GroupId) => {
    setActiveGroup(gid);
    const g = GROUPS.find((x) => x.id === gid) ?? GROUPS[0];
    setActiveSection(g.sections[0].id);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: T.surface }}>
      {/* Level 1: group tab bar */}
      <div role="tablist" aria-label="Settings groups" style={{
        height: 48, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 0,
        padding: '0 16px',
        borderBottom: `1px solid ${T.borderSoft}`,
        backgroundColor: T.white, overflowX: 'auto',
      }}>
        {GROUPS.map((g) => {
          const active = g.id === activeGroup;
          const Icon = g.icon;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onGroupChange(g.id)}
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                height: 48, padding: '0 14px',
                fontSize: 13, fontWeight: active ? 600 : 500,
                color: active ? T.primary : T.textSecondary,
                background: 'transparent', border: 'none', cursor: 'pointer',
              }}
            >
              <Icon size={15} />
              {g.label}
              {active ? (
                <span style={{ position: 'absolute', bottom: 0, left: 14, right: 14, height: 2, borderRadius: 1, backgroundColor: T.primary }} />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* Level 2 + 3 */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {showSidebar ? (
          <nav aria-label="Settings sections" style={{
            width: 190, flexShrink: 0,
            borderRight: `1px solid ${T.borderSoft}`,
            backgroundColor: T.navBg,
            display: 'flex', flexDirection: 'column', gap: 2,
            padding: '14px 8px', overflowY: 'auto',
          }}>
            {group.sections.map((s) => {
              const active = s.id === activeSection;
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setActiveSection(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                    padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
                    border: 'none',
                    color: active ? T.primary : T.textSecondary,
                    backgroundColor: active ? T.primaryWash : 'transparent',
                    fontSize: 13, fontWeight: active ? 600 : 500,
                  }}
                >
                  <Icon size={15} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </nav>
        ) : null}

        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {renderSection(current.id, onOpenCommandPalette, federations, setFederations)}
        </div>
      </div>
    </div>
  );
}

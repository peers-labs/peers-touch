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
import { useState } from 'react';
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
  RotateCcw,
  Copy,
  Command,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import { T } from './theme';

// ═══════════════════════════════════════════════════════════════════════════════
// UI ATOMS
// ═══════════════════════════════════════════════════════════════════════════════

const inputStyle: React.CSSProperties = {
  boxSizing: 'border-box',
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
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
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
  width?: number | string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width,
        height: 36,
        boxSizing: 'border-box',
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: '0 10px',
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

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      style={{
        width: 40, height: 22, borderRadius: 11,
        backgroundColor: on ? T.primary : T.fillTertiary,
        position: 'relative', cursor: 'pointer',
        transition: 'background-color 0.15s ease', flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: on ? 20 : 2,
        width: 18, height: 18, borderRadius: '50%',
        backgroundColor: T.white, transition: 'left 0.15s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </div>
  );
}

function Tag({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 11, lineHeight: '18px', padding: '0 7px',
      borderRadius: 5, color, backgroundColor: `${color}14`,
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
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 32, padding: '0 12px', borderRadius: 8,
        border: `1px solid ${T.border}`,
        backgroundColor: T.bg, color: danger ? '#d4380d' : T.textSecondary,
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

// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT ATOMS (production mirror)
// ═══════════════════════════════════════════════════════════════════════════════

function SettingsContainer({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '16px 20px', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {children}
    </div>
  );
}

function SettingsSection({ icon: Icon, title, subtitle, action, children }: {
  icon: LucideIcon; title: string; subtitle?: string;
  action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{
      backgroundColor: T.white, borderRadius: 10, padding: '14px 16px',
      border: `1px solid ${T.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1 }}>
          <Icon size={15} color={T.primary} style={{ marginTop: 2, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{title}</div>
            {subtitle ? <div style={{ fontSize: 11, color: T.textTertiary, marginTop: 1 }}>{subtitle}</div> : null}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function SettingsRow({ label, desc, children }: {
  label: string; desc?: string; children: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12, padding: '8px 0',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{label}</div>
        {desc ? <div style={{ fontSize: 11, color: T.textTertiary, marginTop: 1 }}>{desc}</div> : null}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function SettingsItemCard({ children, onClick, active }: {
  children: React.ReactNode; onClick?: () => void; active?: boolean;
}) {
  return (
    <div onClick={onClick} style={{
      padding: 12, borderRadius: 8,
      backgroundColor: active ? T.primaryWash : T.fillQuaternary,
      border: `1px solid ${active ? T.primary : T.border}`,
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

function AccountSection() {
  const [displayName, setDisplayName] = useState('Alice Chen');
  const [bio, setBio] = useState('Building decentralized social networks. Open-source advocate.');
  const [region, setRegion] = useState('asia-east');
  const [timezone, setTimezone] = useState('Asia/Shanghai');

  return (
    <SettingsContainer>
      {/* Identity Card */}
      <SettingsSection icon={User} title="Identity" subtitle="Your account identity in the Peers-Touch network.">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'linear-gradient(135deg, #6b5bd6 0%, #a78bfa 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, fontWeight: 700, color: T.white, flexShrink: 0,
          }}>
            AC
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>Alice Chen</div>
            <div style={{ fontSize: 13, color: T.textSecondary, marginTop: 2 }}>@alice</div>
            <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 4, fontFamily: 'ui-monospace, Menlo, monospace' }}>
              ptid:01HQX7K3M9VDGF2N8PWJRST6YZ
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 20 }}>
          {[
            { label: 'Posts', value: '1,247' },
            { label: 'Following', value: '328' },
            { label: 'Followers', value: '1,892' },
            { label: 'Created', value: '2025-03-14' },
          ].map((s) => (
            <div key={s.label} style={{
              textAlign: 'center', padding: '12px 8px', borderRadius: 8,
              backgroundColor: T.fillQuaternary,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{s.value}</div>
              <div style={{ fontSize: 11, color: T.textTertiary, marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </SettingsSection>

      {/* Public Profile */}
      <SettingsSection icon={Pencil} title="Public Profile" subtitle="Information visible to other users in the network.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: T.text, marginBottom: 6 }}>Display Name</div>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: T.text }}>Bio</span>
              <span style={{ fontSize: 11, color: T.textTertiary }}>{bio.length}/280</span>
            </div>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 280))}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: T.text, marginBottom: 6 }}>Region</div>
              <Select value={region} width="100%" options={[
                { id: 'asia-east', label: 'Asia East' },
                { id: 'asia-southeast', label: 'Asia Southeast' },
                { id: 'us-west', label: 'US West' },
                { id: 'eu-west', label: 'EU West' },
              ]} onChange={setRegion} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: T.text, marginBottom: 6 }}>Timezone</div>
              <Select value={timezone} width="100%" options={[
                { id: 'Asia/Shanghai', label: 'Asia/Shanghai (UTC+8)' },
                { id: 'Asia/Tokyo', label: 'Asia/Tokyo (UTC+9)' },
                { id: 'America/Los_Angeles', label: 'America/Los_Angeles (UTC-7)' },
                { id: 'Europe/London', label: 'Europe/London (UTC+1)' },
              ]} onChange={setTimezone} />
            </div>
          </div>
        </div>
      </SettingsSection>

      {/* Relationships */}
      <SettingsSection icon={Users} title="Relationships" subtitle="Manage blocked users and relationships.">
        <SettingsRow label="Blocked Users" desc="3 users currently blocked">
          <GhostBtn label="Manage" onClick={() => {}} />
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

function FederationSection() {
  const [visibility, setVisibility] = useState('by_handle');
  const [federations, setFederations] = useState<JoinedFederation[]>(MOCK_FEDERATIONS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState('');

  const [confirmLeaveId, setConfirmLeaveId] = useState<string | null>(null);

  const handleAdd = () => {
    if (!addUrl.trim()) return;
    const id = `fed-${Date.now()}`;
    setFederations((prev) => [...prev, {
      id, name: addUrl.trim(), description: '',
      status: 'active' as FederationStatus, stationCount: 1, visibleActors: 0,
      joinedAt: new Date().toISOString().slice(0, 10),
      adminPtid: CURRENT_ACTOR_PTID, endpoint: addUrl.startsWith('http') ? addUrl : `https://${addUrl}`,
    }]);
    setAddUrl('');
    setAddOpen(false);
  };

  const handleLeave = (id: string) => {
    setFederations((prev) => prev.filter((f) => f.id !== id));
    setConfirmLeaveId(null);
    if (expandedId === id) setExpandedId(null);
  };

  const visibilityDesc: Record<string, string> = {
    hidden: 'Your profile is invisible to all federation nodes. Others must have your exact handle to contact you.',
    by_handle: 'Others can find you only when they search your exact handle. Not listed in any directory.',
    indexed: 'Your profile appears in the federation public directory. Anyone can discover you by keyword search.',
  };

  return (
    <SettingsContainer>
      {/* Basic Info — identity + health + discovery merged */}
      <SettingsSection icon={Globe} title="Basic Info" subtitle="Your federation identity, routing status, and discovery settings.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 13 }}>
          <div>
            <span style={{ color: T.textTertiary, fontSize: 11 }}>Handle</span>
            <div style={{ fontWeight: 500, color: T.text, display: 'flex', alignItems: 'center', gap: 6 }}>
              @alice@alpha.peers.social
              <Copy size={12} color={T.textTertiary} style={{ cursor: 'pointer' }} onClick={() => navigator.clipboard?.writeText('@alice@alpha.peers.social')} />
            </div>
          </div>
          <div><span style={{ color: T.textTertiary, fontSize: 11 }}>Home Station</span><div style={{ fontWeight: 500, color: T.text }}>alpha.peers.social <Tag text="primary" color={T.primary} /></div></div>
          <div><span style={{ color: T.textTertiary, fontSize: 11 }}>Locator Seq</span><div style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: T.textSecondary }}>seq:00000142</div></div>
          <div><span style={{ color: T.textTertiary, fontSize: 11 }}>Relay Mounts</span><div style={{ display: 'flex', gap: 4, marginTop: 2 }}><Tag text="relay:east" color="#1677ff" /><Tag text="relay:lab" color="#13a8a8" /><Tag text="mount:social" color="#722ed1" /></div></div>
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.borderSoft}`, display: 'flex', alignItems: 'center', gap: 20, fontSize: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <CheckCircle2 size={14} color="#10b981" />
            <span style={{ fontWeight: 600, color: '#10b981' }}>Ready</span>
          </div>
          <span style={{ color: T.textTertiary }}>·</span>
          <span style={{ color: T.textSecondary }}><strong style={{ color: T.text }}>24</strong> peers in routing table</span>
          <span style={{ color: T.textTertiary }}>·</span>
          <span style={{ color: T.textSecondary }}>Seeds <strong style={{ color: T.text }}>3</strong>/4 connected</span>
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.borderSoft}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 500, color: T.text }}>Discoverable as</span>
            <div style={{ fontSize: 11, color: T.textTertiary, marginTop: 1 }}>{visibilityDesc[visibility]}</div>
          </div>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            style={{ height: 30, padding: '0 28px 0 10px', borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: T.bg, fontSize: 12, color: T.text, cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
          >
            <option value="hidden">Hidden</option>
            <option value="by_handle">By Handle</option>
            <option value="indexed">Indexed</option>
          </select>
        </div>
      </SettingsSection>

      {/* Joined Federations — correct hierarchy: Federation > Station > Actor */}
      <SettingsSection
        icon={Network}
        title="Joined Federations"
        subtitle="Federations this Station participates in. To create a new federation, use the Station Dashboard."
        action={<div onClick={() => setAddOpen(true)} style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><Plus size={14} color={T.white} /></div>}
      >
        {addOpen ? (
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, marginBottom: 12, backgroundColor: T.fillQuaternary }}>
            <div style={{ fontSize: 12, color: T.textTertiary, marginBottom: 6 }}>Enter federation endpoint URL</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="https://federation.example.com" style={{ ...inputStyle, flex: 1 }} onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAddOpen(false); }} />
              <div onClick={handleAdd} style={{ height: 32, padding: '0 12px', borderRadius: 6, backgroundColor: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontSize: 12, fontWeight: 500, color: T.white, gap: 4 }}><Network size={13} /> Join</div>
              <div onClick={() => { setAddOpen(false); setAddUrl(''); }} style={{ height: 32, padding: '0 10px', borderRadius: 6, border: `1px solid ${T.border}`, backgroundColor: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, fontSize: 12, color: T.textSecondary }}>Cancel</div>
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
                    {f.description ? <div style={{ fontSize: 11, color: T.textTertiary, marginTop: 2 }}>{f.description}</div> : null}
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{f.stationCount}</div>
                      <div style={{ fontSize: 10, color: T.textTertiary }}>Stations</div>
                    </div>
                    <div style={{ width: 1, height: 24, backgroundColor: T.border }} />
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{f.visibleActors.toLocaleString()}</div>
                      <div style={{ fontSize: 10, color: T.textTertiary }}>Actors</div>
                    </div>
                  </div>
                </div>
                {expanded ? (
                  <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.borderSoft}` }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 16px', fontSize: 12, color: T.textSecondary, marginBottom: admin ? 12 : 0 }}>
                      <div><span style={{ color: T.textTertiary }}>Endpoint</span><div>{f.endpoint}</div></div>
                      <div><span style={{ color: T.textTertiary }}>Joined</span><div>{f.joinedAt}</div></div>
                      <div><span style={{ color: T.textTertiary }}>Admin</span><div>{f.adminPtid}</div></div>
                    </div>
                    {admin ? (
                      confirmLeaveId === f.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, backgroundColor: '#fff2f0', border: '1px solid #ffccc7' }}>
                          <span style={{ fontSize: 12, color: '#cf1322', flex: 1 }}>Confirm leaving this federation? This cannot be undone.</span>
                          <div onClick={() => handleLeave(f.id)} style={{ height: 26, padding: '0 10px', borderRadius: 4, backgroundColor: '#cf1322', color: T.white, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>Leave</div>
                          <div onClick={() => setConfirmLeaveId(null)} style={{ height: 26, padding: '0 10px', borderRadius: 4, border: `1px solid ${T.border}`, backgroundColor: T.bg, color: T.textSecondary, fontSize: 11, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>Cancel</div>
                        </div>
                      ) : (
                        <div onClick={() => setConfirmLeaveId(f.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#cf1322', cursor: 'pointer' }}>
                          <LogOut size={12} /> Leave this federation
                        </div>
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

function GeneralSection() {
  const [language, setLanguage] = useState('zh-CN');
  const [defProvider, setDefProvider] = useState('openai');
  const [defModel, setDefModel] = useState('gpt-5.4');
  const [effort, setEffort] = useState('Medium');
  const [pinLock, setPinLock] = useState(false);

  return (
    <SettingsContainer>
      <SettingsSection icon={Globe} title="Language" subtitle="Interface language preference.">
        <SettingsRow label="Display Language" desc="Change requires page reload.">
          <Select value={language} width={180} options={[
            { id: 'zh-CN', label: '\u7B80\u4F53\u4E2D\u6587' },
            { id: 'en', label: 'English' },
            { id: 'ja', label: '\u65E5\u672C\u8A9E' },
          ]} onChange={setLanguage} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon={Sparkles} title="Agent Defaults" subtitle="Default LLM configuration for new conversations and agents.">
        <SettingsRow label="Default Provider">
          <Select value={defProvider} width={180} options={[
            { id: 'openai', label: 'OpenAI-compatible' },
            { id: 'anthropic', label: 'Anthropic' },
            { id: 'ollama', label: 'Ollama (local)' },
          ]} onChange={setDefProvider} />
        </SettingsRow>
        <SettingsRow label="Default Model">
          <Select value={defModel} width={180} options={[
            { id: 'gpt-5.4', label: 'gpt-5.4' },
            { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
            { id: 'claude-sonnet', label: 'claude-sonnet' },
          ]} onChange={setDefModel} />
        </SettingsRow>
        <SettingsRow label="Effort Level" desc="Controls reasoning depth and token usage.">
          <Select value={effort} width={120} options={[
            { id: 'Low', label: 'Low' },
            { id: 'Medium', label: 'Medium' },
            { id: 'High', label: 'High' },
          ]} onChange={setEffort} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection icon={Lock} title="Security" subtitle="PIN lock and authentication settings.">
        <SettingsRow label="PIN Lock" desc="Require PIN to unlock the application.">
          <Toggle on={pinLock} onToggle={() => setPinLock(!pinLock)} />
        </SettingsRow>
        {pinLock ? (
          <div style={{ display: 'flex', gap: 8, paddingTop: 8 }}>
            <GhostBtn label="Change PIN" onClick={() => {}} />
            <GhostBtn label="Remove PIN" danger onClick={() => setPinLock(false)} />
          </div>
        ) : null}
      </SettingsSection>
    </SettingsContainer>
  );
}

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
              <input value={dsn} onChange={(e) => setDsn(e.target.value)} style={{ ...inputStyle, flex: 1, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} />
              <GhostBtn icon={Activity} label="Test" onClick={() => {}} />
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
  const heatmapData = Array.from({ length: 28 }, () => Math.random());

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

function HelpSection() {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const featureGroups = [
    { id: 'messaging', label: 'Messaging', items: ['End-to-end encrypted DMs', 'Group chats with federation', 'Rich media attachments', 'Message reactions and threads'] },
    { id: 'ai', label: 'AI Features', items: ['Multi-provider LLM support', 'Custom skill packages', 'MCP server integration', 'Long-term memory'] },
    { id: 'federation', label: 'Federation', items: ['Multi-station network', 'Cross-station messaging', 'Decentralized identity', 'Relay routing'] },
    { id: 'applets', label: 'Applets', items: ['Note taking', 'Calendar management', 'Task boards', 'Extensible plugin system'] },
  ];

  return (
    <SettingsContainer>
      {/* About Card */}
      <SettingsSection icon={Info} title="About Peers-Touch" subtitle="Decentralized federated social network framework.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
          <SettingsRow label="Version" desc="v0.9.2-beta"><span /></SettingsRow>
          <SettingsRow label="Build" desc="20260721.1432"><span /></SettingsRow>
          <SettingsRow label="Platform" desc="macOS arm64 (Tauri 2.x)"><span /></SettingsRow>
          <SettingsRow label="Runtime" desc="WebKit + Rust"><span /></SettingsRow>
        </div>
      </SettingsSection>

      {/* Feature Sections */}
      <SettingsSection icon={HelpCircle} title="Features" subtitle="Explore available features in Peers-Touch Desktop.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {featureGroups.map((fg) => {
            const expanded = expandedGroup === fg.id;
            return (
              <div key={fg.id}>
                <div onClick={() => setExpandedGroup(expanded ? null : fg.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                  borderRadius: 8, cursor: 'pointer',
                  backgroundColor: expanded ? T.fillQuaternary : 'transparent',
                }}>
                  {expanded ? <ChevronDown size={14} color={T.textSecondary} /> : <ChevronRight size={14} color={T.textSecondary} />}
                  <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{fg.label}</span>
                  <span style={{ fontSize: 12, color: T.textTertiary, marginLeft: 'auto' }}>{fg.items.length} items</span>
                </div>
                {expanded ? (
                  <div style={{ paddingLeft: 34, paddingBottom: 8 }}>
                    {fg.items.map((item) => (
                      <div key={item} style={{ fontSize: 13, color: T.textSecondary, padding: '4px 0' }}>
                        {item}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </SettingsSection>

      {/* Danger Zone */}
      <div style={{
        backgroundColor: T.white, borderRadius: 12, padding: 24,
        border: '1px solid #ffa39e',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <AlertTriangle size={18} color="#cf1322" />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#cf1322' }}>Danger Zone</div>
            <div style={{ fontSize: 12, color: T.textTertiary, marginTop: 2 }}>Irreversible actions that reset application state.</div>
          </div>
        </div>
        <SettingsRow label="Reset Onboarding" desc="Re-show the first-run setup wizard on next launch.">
          <button onClick={() => {}} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 32, padding: '0 14px', borderRadius: 8,
            border: '1px solid #ffa39e', backgroundColor: '#fff2f0',
            color: '#cf1322', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
            <RotateCcw size={14} />
            Reset
          </button>
        </SettingsRow>
      </div>
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
        action={<PrimaryButton label="Open Command Palette" icon={Command} onClick={onOpen} />}
      >
        <span />
      </SettingsSection>
    </SettingsContainer>
  );
}

function MyFilesSection() {
  return (
    <SettingsContainer>
      <SettingsSection icon={FolderOpen} title="My Files">
        <SettingsRow label="product-brief.pdf" desc="2.4 MB · Private">
          <span style={{ color: T.textTertiary, fontSize: 12 }}>PDF</span>
        </SettingsRow>
        <SettingsRow label="team-photo.jpg" desc="1.8 MB · Shared in Chat">
          <span style={{ color: T.textTertiary, fontSize: 12 }}>Image</span>
        </SettingsRow>
      </SettingsSection>
    </SettingsContainer>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE SHELL: Three-level navigation
// ═══════════════════════════════════════════════════════════════════════════════

type GroupId = 'general' | 'federation' | 'ai' | 'tools' | 'channels' | 'applets' | 'data' | 'help';
type SectionId = 'account' | 'federation' | 'general' | 'providers' | 'models' | 'memory' | 'skills' | 'mcp' | 'cron' | 'command-menu' | 'channels' | 'applets' | 'statistics' | 'oss' | 'logs' | 'help';

interface SectionDef { id: SectionId; label: string; icon: LucideIcon; }
interface GroupDef { id: GroupId; label: string; icon: LucideIcon; sections: SectionDef[]; }

const GROUPS: GroupDef[] = [
  {
    id: 'general', label: 'General', icon: Settings,
    sections: [
      { id: 'account', label: 'Account', icon: User },
      { id: 'general', label: 'General', icon: Sliders },
    ],
  },
  {
    id: 'federation', label: 'Federation', icon: Globe,
    sections: [
      { id: 'federation', label: 'Federation', icon: Globe },
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
    id: 'tools', label: 'Tools', icon: Sliders,
    sections: [
      { id: 'cron', label: 'Cron Jobs', icon: Clock },
      { id: 'command-menu', label: 'Command Palette', icon: Command },
    ],
  },
  {
    id: 'channels', label: 'Channels', icon: Send,
    sections: [
      { id: 'channels', label: 'Channels', icon: Send },
    ],
  },
  {
    id: 'applets', label: 'Applets', icon: Puzzle,
    sections: [
      { id: 'applets', label: 'Applets', icon: Puzzle },
    ],
  },
  {
    id: 'data', label: 'Data', icon: Database,
    sections: [
      { id: 'statistics', label: 'Statistics', icon: BarChart3 },
      { id: 'oss', label: 'My Files', icon: FolderOpen },
      { id: 'logs', label: 'Logs', icon: ScrollText },
    ],
  },
  {
    id: 'help', label: 'Help', icon: HelpCircle,
    sections: [
      { id: 'help', label: 'Help', icon: HelpCircle },
    ],
  },
];

function renderSection(sectionId: SectionId, onOpenCommandPalette: () => void) {
  switch (sectionId) {
    case 'account': return <AccountSection />;
    case 'federation': return <FederationSection />;
    case 'general': return <GeneralSection />;
    case 'providers': return <ProvidersSection />;
    case 'models': return <ModelsSection />;
    case 'memory': return <MemorySection />;
    case 'skills': return <SkillsSection />;
    case 'mcp': return <MCPSection />;
    case 'cron': return <CronJobsSection />;
    case 'command-menu': return <CommandPaletteSection onOpen={onOpenCommandPalette} />;
    case 'channels': return <ChannelsSection />;
    case 'applets': return <AppletsSection />;
    case 'statistics': return <StatisticsSection />;
    case 'oss': return <MyFilesSection />;
    case 'logs': return <LogsSection />;
    case 'help': return <HelpSection />;
    default: return null;
  }
}

export function SettingsPage({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  const [activeGroup, setActiveGroup] = useState<GroupId>('general');
  const [activeSection, setActiveSection] = useState<SectionId>('account');

  const group = GROUPS.find((g) => g.id === activeGroup) ?? GROUPS[0];
  const current = group.sections.find((s) => s.id === activeSection) ?? group.sections[0];
  const showSidebar = group.sections.length > 1;

  const onGroupChange = (gid: GroupId) => {
    setActiveGroup(gid);
    const g = GROUPS.find((x) => x.id === gid) ?? GROUPS[0];
    setActiveSection(g.sections[0].id);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: T.bg }}>
      {/* Level 1: Horizontal Group Tab Bar */}
      <div style={{
        height: 48, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 0,
        padding: '0 24px',
        borderBottom: `1px solid ${T.border}`,
        backgroundColor: T.white,
      }}>
        {GROUPS.map((g) => {
          const active = g.id === activeGroup;
          const Icon = g.icon;
          return (
            <div
              key={g.id}
              onClick={() => onGroupChange(g.id)}
              style={{
                position: 'relative',
                display: 'flex', alignItems: 'center', gap: 6,
                height: 48, padding: '0 16px',
                fontSize: 13, fontWeight: active ? 600 : 500,
                color: active ? T.primary : T.textSecondary,
                cursor: 'pointer', transition: 'color 0.15s ease',
              }}
            >
              <Icon size={15} />
              {g.label}
              {active ? (
                <div style={{
                  position: 'absolute', bottom: 0, left: 16, right: 16,
                  height: 2, borderRadius: 1, backgroundColor: T.primary,
                }} />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Level 2 + 3: Sidebar + Content */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Level 2: Section Sidebar (180px, only when group has >1 section) */}
        {showSidebar ? (
          <div style={{
            width: 180, flexShrink: 0,
            borderRight: `1px solid ${T.border}`,
            backgroundColor: T.navBg,
            display: 'flex', flexDirection: 'column',
            padding: '16px 8px', overflow: 'auto',
          }}>
            {group.sections.map((s) => {
              const active = s.id === activeSection;
              const Icon = s.icon;
              return (
                <div
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                    color: active ? T.primary : T.textSecondary,
                    backgroundColor: active ? T.primaryWash : 'transparent',
                    fontSize: 13, fontWeight: active ? 600 : 500,
                    transition: 'background-color 0.12s ease',
                  }}
                >
                  <Icon size={15} />
                  <span>{s.label}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Level 3: Section Content */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
          {renderSection(current.id, onOpenCommandPalette)}
        </div>
      </div>
    </div>
  );
}

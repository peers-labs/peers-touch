import { useState, type ReactNode } from 'react';
import { Button, Input, Select, Typography } from 'antd';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Database,
  Download,
  ExternalLink,
  KeyRound,
  LogOut,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import type { SettingEntry, SettingId } from '../types';
import { demoAvatarUrls } from '../data';
import { IdentityAvatar } from './IdentityAvatar';

const { Text } = Typography;

type Federation = {
  id: string;
  name: string;
  endpoint: string;
  role: 'Operator' | 'Member';
  stations: number;
};

const initialFederations: Federation[] = [
  { id: 'peers', name: 'Peers Social Network', endpoint: 'federation.peers.social', role: 'Operator', stations: 12 },
  { id: 'lab', name: 'Lab Federation', endpoint: 'fed.lab.internal', role: 'Member', stations: 3 },
  { id: 'east', name: 'East Asia Network', endpoint: 'east.peers.network', role: 'Member', stations: 7 },
];

function SettingSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mp-setting-section">
      <div className="mp-setting-section-heading">
        <Text strong>{title}</Text>
        {description && <Text type="secondary">{description}</Text>}
      </div>
      <div className="mp-setting-detail-card">{children}</div>
    </section>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mp-setting-detail-row">
      <span className="mp-setting-row-copy">
        <span className="mp-setting-detail-label">{label}</span>
        {description && <span className="mp-setting-row-description">{description}</span>}
      </span>
      {children}
    </div>
  );
}

function SettingActionRow({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="mp-setting-detail-row mp-setting-action-row" onClick={onClick}>
      <span className="mp-setting-detail-label">{label}</span>
      {icon}
    </button>
  );
}

function SettingToggle({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`mp-toggle ${checked ? 'active' : ''}`}
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

function Choice({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  label: string;
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      options={options}
      onChange={onChange}
      popupMatchSelectWidth={false}
    />
  );
}

function SettingList({
  rows,
}: {
  rows: Array<{ title: string; detail: string; value?: string; status?: 'ready' | 'warning' }>;
}) {
  return (
    <div className="mp-setting-list">
      {rows.map((row) => (
        <div key={row.title} className="mp-setting-list-item">
          <span className={`mp-setting-status ${row.status ?? 'ready'}`} aria-hidden="true" />
          <span className="mp-setting-list-copy">
            <Text strong>{row.title}</Text>
            <Text type="secondary">{row.detail}</Text>
          </span>
          {row.value && <Text type="secondary" className="mp-setting-list-value">{row.value}</Text>}
        </div>
      ))}
    </div>
  );
}

export function SettingDetailView({
  setting,
  onBack,
  onChangeStation,
}: {
  setting: SettingEntry;
  onBack: () => void;
  onChangeStation: () => void;
}) {
  const [toggles, setToggles] = useState<Record<string, boolean>>({
    mentions: true,
    invites: true,
    friendRequests: true,
    reactions: false,
    networkEvents: true,
    inApp: true,
    sound: false,
    pinLock: true,
    discoverable: true,
    peersFederation: true,
    labFederation: false,
    eastFederation: true,
    memory: true,
    diagnostics: false,
    emailChannel: true,
    webhookChannel: false,
  });
  const [theme, setTheme] = useState('system');
  const [language, setLanguage] = useState('en');
  const [reach, setReach] = useState('federations');
  const [defaultVisibility, setDefaultVisibility] = useState('followers');
  const [defaultModel, setDefaultModel] = useState('claude-sonnet');
  const [federations, setFederations] = useState(initialFederations);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinEndpoint, setJoinEndpoint] = useState('');
  const [joinError, setJoinError] = useState('');
  const [copied, setCopied] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState(['Bob Lin', 'Carol Wu']);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [displayName, setDisplayName] = useState('Alice Chen');
  const [bio, setBio] = useState('Building decentralized social networks.');
  const [profileEditing, setProfileEditing] = useState(false);
  const [pinChangeOpen, setPinChangeOpen] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinUpdated, setPinUpdated] = useState(false);
  const [providerRows, setProviderRows] = useState([
    { title: 'OpenAI', detail: 'API key · last checked 2m ago', value: 'Ready' },
    { title: 'Anthropic', detail: 'OAuth · last checked 5m ago', value: 'Ready' },
    { title: 'Local runtime', detail: 'No endpoint configured', value: 'Not configured', status: 'warning' as const },
  ]);
  const [memoryEntries, setMemoryEntries] = useState(['Prefers concise answers', 'Project: Peers Touch', 'Timezone: Asia/Shanghai']);
  const [memoryReviewOpen, setMemoryReviewOpen] = useState(false);
  const [cacheMb, setCacheMb] = useState(204);
  const [cronTasks, setCronTasks] = useState([
    { title: 'Daily project brief', detail: 'Every weekday · 09:00', value: 'Active' },
    { title: 'Weekly dependency review', detail: 'Monday · 10:00', value: 'Active' },
  ]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandResult, setCommandResult] = useState('');
  const [devices, setDevices] = useState([
    { id: 'this', name: 'This iPhone', detail: 'iOS · current session', current: true },
    { id: 'mac', name: 'MacBook Pro', detail: 'macOS · last seen 2h ago', current: false },
  ]);

  const flip = (key: string, value: boolean) => {
    setToggles((current) => ({ ...current, [key]: value }));
  };

  const exportDiagnostics = () => {
    const payload = JSON.stringify({
      generatedAt: new Date().toISOString(),
      station: 'alpha.peers.social',
      checks: ['station:pass', 'message-projection:pass'],
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'peers-touch-diagnostics.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const settingContent: Record<SettingId, () => ReactNode> = {
    account: () => (
      <>
        <section className="mp-account-identity">
          <div className="mp-account-cover" aria-hidden="true" />
          <div className="mp-account-person">
            <IdentityAvatar name={displayName} initials="AC" src={demoAvatarUrls.alice} size={64} />
            <span>
              <Text strong className="mp-account-name">{displayName}</Text>
              <Text type="secondary">@alice@alpha.peers.social</Text>
            </span>
            <Button size="small" onClick={() => setProfileEditing((editing) => !editing)}>
              {profileEditing ? 'Done' : 'Edit'}
            </Button>
          </div>
        </section>
        <SettingSection title="Public profile" description="Shown in conversations and Social.">
          <SettingRow label="Display name">
            {profileEditing
              ? <Input aria-label="Display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              : <Text type="secondary">{displayName}</Text>}
          </SettingRow>
          <SettingRow label="Bio">
            {profileEditing
              ? <Input aria-label="Bio" value={bio} onChange={(event) => setBio(event.target.value.slice(0, 280))} />
              : <Text type="secondary">{bio}</Text>}
          </SettingRow>
          <SettingRow label="Region"><Text type="secondary">Asia East</Text></SettingRow>
          <SettingRow label="Timezone"><Text type="secondary">Asia/Shanghai</Text></SettingRow>
        </SettingSection>
        <SettingSection title="Technical identity" description="Stable account coordinates.">
          <SettingRow label="PTID"><code className="mp-setting-code">ptid:v1:actor:alice:a3f9</code></SettingRow>
          <SettingRow label="Home Station"><code className="mp-setting-code">alpha.peers.social</code></SettingRow>
        </SettingSection>
        <SettingSection title="Blocked users" description="Blocked across every joined federation.">
          {blockedUsers.length === 0 ? (
            <div className="mp-setting-empty">No blocked users</div>
          ) : blockedUsers.map((name) => (
            <SettingRow key={name} label={name} description={`${name.toLowerCase().replace(' ', '.')}@peers.social`}>
              <Button size="small" onClick={() => setBlockedUsers((current) => current.filter((item) => item !== name))}>Unblock</Button>
            </SettingRow>
          ))}
        </SettingSection>
      </>
    ),
    notifications: () => (
      <>
        <SettingSection title="What to notify me about" description="Events that reach your notification center.">
          {[
            ['mentions', 'Mentions & replies', 'Replies and uses of your handle'],
            ['invites', 'Group invites', 'Invitations to groups and channels'],
            ['friendRequests', 'Friend requests', 'New people asking to connect'],
            ['reactions', 'Reactions', 'Emoji reactions on your messages'],
            ['networkEvents', 'Network events', 'Station and federation changes'],
          ].map(([key, label, description]) => (
            <SettingRow key={key} label={label} description={description}>
              <SettingToggle label={label} checked={toggles[key]} onChange={(value) => flip(key, value)} />
            </SettingRow>
          ))}
        </SettingSection>
        <SettingSection title="Delivery" description="How notifications arrive on this device.">
          <SettingRow label="In-app notifications" description="Show the notification badge and inbox.">
            <SettingToggle label="In-app notifications" checked={toggles.inApp} onChange={(value) => flip('inApp', value)} />
          </SettingRow>
          <SettingRow label="Sound" description="Play a short sound for new notifications.">
            <SettingToggle label="Notification sound" checked={toggles.sound} onChange={(value) => flip('sound', value)} />
          </SettingRow>
        </SettingSection>
      </>
    ),
    privacy: () => (
      <>
        <SettingSection title="App access" description="Protect Peers Touch on this device.">
          <SettingRow label="PIN lock" description="Ask for your PIN when opening the app.">
            <SettingToggle label="PIN lock" checked={toggles.pinLock} onChange={(value) => flip('pinLock', value)} />
          </SettingRow>
          {toggles.pinLock && (
            <>
              {pinChangeOpen && (
                <div className="mp-pin-change">
                  <Input.Password
                    aria-label="New PIN"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="Enter a new PIN"
                    value={pinValue}
                    onChange={(event) => setPinValue(event.target.value.replace(/\D/g, ''))}
                  />
                  <Button type="primary" disabled={pinValue.length < 4} onClick={() => {
                    setPinUpdated(true);
                    setPinValue('');
                    setPinChangeOpen(false);
                  }}>Save PIN</Button>
                </div>
              )}
              <div className="mp-setting-inline-actions">
                <Button icon={<KeyRound size={14} />} onClick={() => setPinChangeOpen((open) => !open)}>Change PIN</Button>
                <Button danger onClick={() => flip('pinLock', false)}>Remove PIN</Button>
              </div>
              {pinUpdated && <div className="mp-setting-success" role="status">PIN updated on this device.</div>}
            </>
          )}
        </SettingSection>
        <SettingSection title="Social privacy" description="Defaults for new Social posts.">
          <SettingRow label="Default audience" description="You can still change this for each post.">
            <Choice
              label="Default audience"
              value={defaultVisibility}
              onChange={setDefaultVisibility}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'followers', label: 'Followers' },
                { value: 'private', label: 'Only me' },
              ]}
            />
          </SettingRow>
        </SettingSection>
      </>
    ),
    appearance: () => (
      <>
        <SettingSection title="Appearance" description="Choose the interface theme.">
          <div className="mp-setting-segmented" role="group" aria-label="Theme">
            {['system', 'light', 'dark'].map((value) => (
              <button key={value} type="button" className={theme === value ? 'active' : ''} onClick={() => setTheme(value)}>
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </SettingSection>
        <SettingSection title="Language" description="Interface language on this device.">
          <SettingRow label="Display language">
            <Choice
              label="Display language"
              value={language}
              onChange={setLanguage}
              options={[
                { value: 'en', label: 'English' },
                { value: 'zh-CN', label: '简体中文' },
              ]}
            />
          </SettingRow>
        </SettingSection>
      </>
    ),
    station: () => (
      <>
        <SettingSection title="Your Station" description="Hosts your account and routes your messages.">
          <div className="mp-station-binding">
            <span className="mp-setting-hero-icon"><Server size={22} /></span>
            <span>
              <Text strong>Local Station</Text>
              <Text type="secondary">alpha.peers.social</Text>
            </span>
            <span className="mp-station-connected"><Check size={13} /> Connected</span>
          </div>
          <div className="mp-setting-note">Federation readiness and relay transport are operated in the Station Dashboard.</div>
        </SettingSection>
        <SettingSection title="Authorized devices" description="Devices signed in to this account.">
          {devices.map((device) => (
            <SettingRow key={device.id} label={device.name} description={device.detail}>
              {device.current
                ? <Text type="secondary">This device</Text>
                : <Button size="small" onClick={() => setDevices((current) => current.filter((item) => item.id !== device.id))}>Remove</Button>}
            </SettingRow>
          ))}
        </SettingSection>
        <section className="mp-setting-danger">
          <Text strong>Switch Station</Text>
          <Text type="secondary">Sign out and choose another Station. Local conversations stay on this device.</Text>
          {confirmSwitch ? (
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setConfirmSwitch(false)}>Cancel</Button>
              <Button danger type="primary" onClick={onChangeStation}>Sign out & switch</Button>
            </div>
          ) : (
            <Button danger icon={<LogOut size={14} />} onClick={() => setConfirmSwitch(true)}>Switch Station</Button>
          )}
        </section>
      </>
    ),
    discovery: () => (
      <>
        <SettingSection title="How people find you" description="Control account visibility across federations.">
          <SettingRow label="Discoverable" description={toggles.discoverable ? 'Your account can be resolved across federations.' : 'Hidden everywhere.'}>
            <SettingToggle label="Discoverable" checked={toggles.discoverable} onChange={(value) => flip('discoverable', value)} />
          </SettingRow>
          <div className={toggles.discoverable ? '' : 'mp-setting-disabled'}>
            <SettingRow label="Peers Social Network" description="Listed in the federation directory.">
              <SettingToggle label="Visible in Peers Social Network" checked={toggles.peersFederation} onChange={(value) => flip('peersFederation', value)} disabled={!toggles.discoverable} />
            </SettingRow>
            <SettingRow label="Lab Federation" description="Reachable only by exact handle.">
              <SettingToggle label="Visible in Lab Federation" checked={toggles.labFederation} onChange={(value) => flip('labFederation', value)} disabled={!toggles.discoverable} />
            </SettingRow>
            <SettingRow label="East Asia Network" description="Listed in the federation directory.">
              <SettingToggle label="Visible in East Asia Network" checked={toggles.eastFederation} onChange={(value) => flip('eastFederation', value)} disabled={!toggles.discoverable} />
            </SettingRow>
          </div>
          <SettingRow label="Your handle" description="Share this exact handle so people can reach you.">
            <Button
              size="small"
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={() => {
                void navigator.clipboard?.writeText('@alice@alpha.peers.social');
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </SettingRow>
        </SettingSection>
        <SettingSection title="Who can contact you" description="Separate from being discoverable.">
          <SettingRow label="Accept requests from">
            <Choice
              label="Accept requests from"
              value={reach}
              onChange={setReach}
              options={[
                { value: 'anyone', label: 'Anyone' },
                { value: 'federations', label: 'My federations' },
                { value: 'nobody', label: 'Nobody' },
              ]}
            />
          </SettingRow>
        </SettingSection>
      </>
    ),
    federation: () => (
      <SettingSection title="Joined federations" description="Networks your Station participates in.">
        <div className="mp-setting-section-action">
          <Button icon={<Plus size={14} />} onClick={() => setJoinOpen((open) => !open)}>Join</Button>
        </div>
        {joinOpen && (
          <div className="mp-federation-join">
            <Input
              autoFocus
              value={joinEndpoint}
              status={joinError ? 'error' : undefined}
              placeholder="https://federation.example.com"
              onChange={(event) => {
                setJoinEndpoint(event.target.value);
                setJoinError('');
              }}
            />
            {joinError && <Text type="danger">{joinError}</Text>}
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setJoinOpen(false)}>Cancel</Button>
              <Button type="primary" onClick={() => {
                const endpoint = joinEndpoint.trim();
                if (!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+/.test(endpoint)) {
                  setJoinError('Enter a valid federation endpoint.');
                  return;
                }
                const host = endpoint.replace(/^https?:\/\//, '').split('/')[0];
                setFederations((current) => [...current, {
                  id: `joined-${Date.now()}`,
                  name: host,
                  endpoint: host,
                  role: 'Member',
                  stations: 1,
                }]);
                setJoinEndpoint('');
                setJoinOpen(false);
              }}>Join federation</Button>
            </div>
          </div>
        )}
        <div className="mp-federation-list">
          {federations.map((federation) => (
            <article key={federation.id} className="mp-federation-item">
              <span className="mp-federation-main">
                <Text strong>{federation.name}</Text>
                <Text type="secondary">{federation.endpoint}</Text>
                <span className="mp-federation-meta">{federation.role} · {federation.stations} Stations</span>
              </span>
              <Button
                danger
                type="text"
                aria-label={`Leave ${federation.name}`}
                icon={<Trash2 size={15} />}
                onClick={() => setFederations((current) => current.filter((item) => item.id !== federation.id))}
              />
            </article>
          ))}
        </div>
      </SettingSection>
    ),
    providers: () => (
      <>
        <SettingSection title="Model providers" description="Connections available to Agent.">
          <SettingList rows={providerRows} />
        </SettingSection>
        <Button block icon={<Plus size={14} />} onClick={() => {
          if (providerRows.some((row) => row.title === 'Custom endpoint')) return;
          setProviderRows((current) => [...current, {
            title: 'Custom endpoint',
            detail: 'OpenAI-compatible · added just now',
            value: 'Ready',
          }]);
        }}>Add provider</Button>
      </>
    ),
    models: () => (
      <>
        <SettingSection title="Default routing" description="Choose the model used for new Agent chats.">
          <SettingRow label="Default model">
            <Choice
              label="Default model"
              value={defaultModel}
              onChange={setDefaultModel}
              options={[
                { value: 'claude-sonnet', label: 'Claude Sonnet' },
                { value: 'gpt-5', label: 'GPT-5' },
                { value: 'auto', label: 'Automatic' },
              ]}
            />
          </SettingRow>
        </SettingSection>
        <SettingSection title="Available capabilities" description="Resolved from provider model metadata.">
          <SettingList rows={[
            { title: 'Claude Sonnet', detail: 'Text · vision · tools', value: 'Default' },
            { title: 'GPT-5', detail: 'Text · vision · tools', value: 'Ready' },
          ]} />
        </SettingSection>
      </>
    ),
    memory: () => (
      <>
        <SettingSection title="Personal memory" description="Agent can reuse durable preferences and project context.">
          <SettingRow label="Enable memory" description="Store approved durable facts.">
            <SettingToggle label="Enable memory" checked={toggles.memory} onChange={(value) => flip('memory', value)} />
          </SettingRow>
          <SettingRow label="Stored memories" description="Review or remove memory entries.">
            <Button size="small" onClick={() => setMemoryReviewOpen((open) => !open)}>
              Review {memoryEntries.length}
            </Button>
          </SettingRow>
          {memoryReviewOpen && (
            <div className="mp-memory-review">
              {memoryEntries.map((entry) => (
                <div key={entry}>
                  <Text>{entry}</Text>
                  <Button type="text" danger icon={<Trash2 size={14} />}
                    aria-label={`Remove ${entry}`}
                    onClick={() => setMemoryEntries((current) => current.filter((item) => item !== entry))} />
                </div>
              ))}
              {memoryEntries.length === 0 && <Text type="secondary">No stored memories.</Text>}
            </div>
          )}
        </SettingSection>
        <div className="mp-setting-note">Conversation transcripts are not memories unless explicitly promoted.</div>
      </>
    ),
    skills: () => (
      <SettingSection title="Installed skills" description="Capabilities Agent can invoke.">
        <SettingList rows={[
          { title: 'Code Review', detail: 'Project skill · enabled', value: 'Enabled' },
          { title: 'Browser Testing', detail: 'Global skill · enabled', value: 'Ready' },
          { title: 'Research', detail: 'Global skill · enabled', value: 'Ready' },
          { title: 'Prototype Design', detail: 'Project skill · enabled', value: 'Ready' },
        ]} />
      </SettingSection>
    ),
    mcp: () => (
      <SettingSection title="Tool connections" description="External services exposed to Agent.">
        <SettingList rows={[
          { title: 'PostgreSQL', detail: 'Local project server', value: 'Connected' },
          { title: 'GitHub', detail: 'OAuth · repository access', value: 'Connected' },
          { title: 'Browser', detail: 'Local automation session', value: 'Connected' },
        ]} />
      </SettingSection>
    ),
    storage: () => (
      <>
        <SettingSection title="Device storage" description="Local copies remain scoped to this device.">
          <div className="mp-storage-summary">
            <span><Database size={22} /></span>
            <strong>2.8 GB used</strong>
            <Text type="secondary">Messages 1.2 GB · Media 1.4 GB · Cache 0.2 GB</Text>
          </div>
          <SettingRow label="Media retention" description="Keep downloaded media for 30 days.">
            <Text type="secondary">30 days</Text>
          </SettingRow>
        </SettingSection>
        <Button block danger disabled={cacheMb === 0} onClick={() => setCacheMb(0)}>
          {cacheMb === 0 ? 'Cache cleared' : `Clear cache · ${cacheMb} MB`}
        </Button>
      </>
    ),
    channels: () => (
      <SettingSection title="Notification channels" description="External delivery for selected events.">
        <SettingRow label="Email" description="alice@peers.social">
          <SettingToggle label="Email channel" checked={toggles.emailChannel} onChange={(value) => flip('emailChannel', value)} />
        </SettingRow>
        <SettingRow label="Webhook" description="No endpoint configured">
          <SettingToggle label="Webhook channel" checked={toggles.webhookChannel} onChange={(value) => flip('webhookChannel', value)} />
        </SettingRow>
      </SettingSection>
    ),
    applets: () => (
      <SettingSection title="Installed applets" description="Product units available on this device.">
        <SettingList rows={[
          { title: 'Notes', detail: 'v1.4.0 · enabled', value: 'Enabled' },
          { title: 'Tasks', detail: 'v1.2.1 · enabled', value: 'Enabled' },
          { title: 'Atelier', detail: 'v0.9.0 · enabled', value: 'Enabled' },
          { title: 'RSS Reader', detail: 'v0.5.0 · disabled', value: 'Disabled', status: 'warning' },
        ]} />
      </SettingSection>
    ),
    statistics: () => (
      <>
        <SettingSection title="Last 30 days" description="Private usage totals stored on this device.">
          <div className="mp-stat-grid">
            <span><strong>1,284</strong><small>Messages</small></span>
            <span><strong>34</strong><small>Posts</small></span>
            <span><strong>18</strong><small>Agent runs</small></span>
            <span><strong>99.8%</strong><small>Runtime health</small></span>
          </div>
        </SettingSection>
      </>
    ),
    logs: () => (
      <>
        <SettingSection title="Diagnostics" description="Collect enough data to investigate failures.">
          <SettingRow label="Diagnostic logging" description="May include technical identifiers, never message content.">
            <SettingToggle label="Diagnostic logging" checked={toggles.diagnostics} onChange={(value) => flip('diagnostics', value)} />
          </SettingRow>
          <SettingList rows={[
            { title: 'Station connection', detail: 'Healthy · checked just now', value: 'Pass' },
            { title: 'Message projection', detail: 'Healthy · 12 ms', value: 'Pass' },
          ]} />
        </SettingSection>
        <Button block icon={<Download size={14} />} onClick={exportDiagnostics}>Export diagnostic bundle</Button>
      </>
    ),
    cron: () => (
      <SettingSection title="Scheduled tasks" description="Recurring work owned by Agent.">
        <SettingList rows={cronTasks} />
        <div className="mp-setting-section-action">
          <Button icon={<Plus size={14} />} onClick={() => {
            if (cronTasks.some((task) => task.title === 'Monthly archive')) return;
            setCronTasks((current) => [...current, {
              title: 'Monthly archive',
              detail: 'First day · 18:00',
              value: 'Active',
            }]);
          }}>New task</Button>
        </div>
      </SettingSection>
    ),
    'command-menu': () => (
      <>
        <SettingSection title="Command Palette" description="Search actions without leaving your current context.">
          <div className="mp-command-preview">
            <span>⌘ K</span>
            <Text type="secondary">Search pages, applets, and actions</Text>
          </div>
        </SettingSection>
        <Button block onClick={() => setCommandOpen(true)}>Open Command Palette</Button>
      </>
    ),
    about: () => (
      <>
        <section className="mp-about-hero">
          <span className="mp-setting-hero-icon"><ShieldCheck size={26} /></span>
          <Text strong>Peers Touch</Text>
          <Text type="secondary">Version 1.0.0 · Build 2026.10.14</Text>
        </section>
        <SettingSection title="Product">
          <SettingActionRow label="Release notes" icon={<ChevronRight size={16} />}
            onClick={() => setCommandResult('Release notes opened')} />
          <SettingActionRow label="Open-source licenses" icon={<ExternalLink size={16} />}
            onClick={() => setCommandResult('Open-source licenses opened')} />
          <SettingActionRow label="Support" icon={<ExternalLink size={16} />}
            onClick={() => setCommandResult('Support opened')} />
        </SettingSection>
      </>
    ),
  };

  const Icon = setting.icon;

  return (
    <div className="mp-detail-page" data-prototype-page="setting-detail" data-setting-detail={setting.id}>
      <header className="mp-detail-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <span className={`mp-detail-title-icon tone-${setting.tint}`}><Icon size={17} /></span>
        <span className="mp-detail-heading-copy">
          <h2 className="mp-detail-header-title">{setting.label}</h2>
          <Text type="secondary">{setting.description}</Text>
        </span>
      </header>
      <div className="mp-setting-detail-content">
        {settingContent[setting.id]?.() ?? (
          <div className="mp-setting-empty">
            <CircleAlert size={18} />
            This setting is unavailable.
          </div>
        )}
      </div>
      {commandOpen && (
        <div className="mp-command-sheet" role="dialog" aria-label="Command Palette">
          <button type="button" className="mp-command-sheet-backdrop" aria-label="Close Command Palette"
            onClick={() => setCommandOpen(false)} />
          <section>
            <div className="mp-command-sheet-header">
              <Text strong>Command Palette</Text>
              <Button type="text" onClick={() => setCommandOpen(false)}>Close</Button>
            </div>
            <Input
              autoFocus
              allowClear
              aria-label="Search commands"
              placeholder="Search commands"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
            />
            <div className="mp-command-results">
              {['Open Chats', 'New Post', 'Switch Station']
                .filter((command) => command.toLowerCase().includes(commandQuery.trim().toLowerCase()))
                .map((command) => (
                  <button key={command} type="button" onClick={() => {
                    setCommandResult(command);
                    setCommandOpen(false);
                    setCommandQuery('');
                  }}>{command}</button>
                ))}
            </div>
          </section>
        </div>
      )}
      {commandResult && <div className="mp-toast" role="status">{commandResult} selected</div>}
    </div>
  );
}

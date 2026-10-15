import {
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { Button, Input, Typography } from 'antd';
import {
  Camera,
  Check,
  Copy,
  Download,
  ImagePlus,
  KeyRound,
  LogOut,
  Pencil,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { DesignThemeMode } from '../../../../../shared/design-tokens';
import type {
  AuthorizedDevice,
  Federation,
  MobileSettingsState,
} from '../../settingsState';
import { ConfirmationDialog } from '../ConfirmationDialog';
import { IdentityAvatar } from '../IdentityAvatar';
import {
  Capability,
  Choice,
  DegradedCapability,
  InlineStatus,
  SettingRow,
  SettingSection,
  SettingToggle,
} from './SettingPrimitives';

const { Text } = Typography;

type SettingsOwnerProps = {
  state: MobileSettingsState;
  setState: Dispatch<SetStateAction<MobileSettingsState>>;
};

function updateField<K extends keyof MobileSettingsState>(
  setState: SettingsOwnerProps['setState'],
  key: K,
  value: SetStateAction<MobileSettingsState[K]>,
) {
  setState((current) => ({
    ...current,
    [key]: typeof value === 'function'
      ? (value as (previous: MobileSettingsState[K]) => MobileSettingsState[K])(current[key])
      : value,
  }));
}

export function AccountSettingsSection({ state, setState }: SettingsOwnerProps) {
  const [draft, setDraft] = useState(state.profile);
  const [editing, setEditing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const visible = editing ? draft : state.profile;

  const beginEdit = () => {
    setDraft(state.profile);
    setEditing(true);
  };

  const chooseMedia = (kind: 'avatar' | 'cover') => {
    if (!editing) beginEdit();
    (kind === 'avatar' ? avatarInputRef : coverInputRef).current?.click();
  };

  const readMedia = (kind: 'avatar' | 'cover', file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') return;
      setDraft((current) => ({
        ...current,
        [kind === 'avatar' ? 'avatarSrc' : 'coverSrc']: reader.result as string,
      }));
    });
    reader.readAsDataURL(file);
  };

  return (
    <>
      <section className="mp-account-identity">
        <Capability id="account.profile.background">
          <button
            type="button"
            className="mp-account-cover"
            aria-label="Change profile background"
            data-capability-action="account.profile.background"
            onClick={() => chooseMedia('cover')}
            style={visible.coverSrc ? { backgroundImage: `url("${visible.coverSrc}")` } : undefined}
          >
            <span className="mp-account-media-action"><ImagePlus size={15} /> Background</span>
          </button>
        </Capability>
        <div className="mp-account-person">
          <Capability id="account.profile.avatar">
            <span className="mp-account-avatar-action" data-capability-action="account.profile.avatar">
              <IdentityAvatar
                name={`${visible.displayName} profile photo`}
                initials="AC"
                src={visible.avatarSrc}
                size={64}
                onClick={() => chooseMedia('avatar')}
              />
              <Camera size={14} aria-hidden="true" />
            </span>
          </Capability>
          <span>
            <Text strong className="mp-account-name">{visible.displayName}</Text>
            <Text type="secondary">@alice@alpha.peers.social</Text>
          </span>
        </div>
        <input
          ref={avatarInputRef}
          hidden
          type="file"
          accept="image/*"
          aria-label="Choose profile photo"
          onChange={(event) => {
            readMedia('avatar', event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <input
          ref={coverInputRef}
          hidden
          type="file"
          accept="image/*"
          aria-label="Choose profile background"
          onChange={(event) => {
            readMedia('cover', event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </section>

      <Capability id="account.profile.edit">
        <SettingSection
          title="Public profile"
          description="Shown in conversations and Social."
          action={editing ? (
            <span className="mp-account-edit-actions">
              <Button size="small" onClick={() => {
                setDraft(state.profile);
                setEditing(false);
              }}>Cancel</Button>
              <Button
                size="small"
                type="primary"
                icon={<Check size={13} />}
                data-capability-action="account.profile.edit"
                disabled={!draft.displayName.trim()}
                onClick={() => {
                  updateField(setState, 'profile', {
                    ...draft,
                    displayName: draft.displayName.trim(),
                    bio: draft.bio.trim(),
                  });
                  setEditing(false);
                }}
              >
                Save
              </Button>
            </span>
          ) : (
            <Button size="small" icon={<Pencil size={13} />} onClick={beginEdit}>Edit</Button>
          )}
        >
          {editing ? (
            <div className="mp-account-profile-form" data-account-mode="edit">
              <label>
                <span>Display name</span>
                <Input
                  autoFocus
                  aria-label="Display name"
                  value={draft.displayName}
                  onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                />
              </label>
              <label>
                <span>Bio</span>
                <Input.TextArea
                  aria-label="Bio"
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  maxLength={280}
                  value={draft.bio}
                  onChange={(event) => setDraft((current) => ({ ...current, bio: event.target.value }))}
                />
              </label>
              <label>
                <span>Region</span>
                <Input
                  aria-label="Region"
                  value={draft.region}
                  onChange={(event) => setDraft((current) => ({ ...current, region: event.target.value }))}
                />
              </label>
              <label>
                <span>Timezone</span>
                <Input
                  aria-label="Timezone"
                  value={draft.timezone}
                  onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}
                />
              </label>
              <div className="mp-account-media-controls">
                <Button icon={<Camera size={14} />} onClick={() => chooseMedia('avatar')}>Change photo</Button>
                <Button icon={<ImagePlus size={14} />} onClick={() => chooseMedia('cover')}>Change background</Button>
                {draft.coverSrc && (
                  <Button onClick={() => setDraft((current) => ({ ...current, coverSrc: undefined }))}>
                    Remove background
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div data-account-mode="view">
              <SettingRow label="Display name"><Text type="secondary">{state.profile.displayName}</Text></SettingRow>
              <SettingRow label="Bio"><Text type="secondary">{state.profile.bio}</Text></SettingRow>
              <SettingRow label="Region"><Text type="secondary">{state.profile.region}</Text></SettingRow>
              <SettingRow label="Timezone"><Text type="secondary">{state.profile.timezone}</Text></SettingRow>
            </div>
          )}
        </SettingSection>
      </Capability>

      <Capability id="account.identity.copy">
        <SettingSection className="mp-account-technical" title="Technical identity" description="Stable account coordinates.">
          <SettingRow label="PTID">
            <code className="mp-setting-code">ptid:v1:actor:alice:a3f9</code>
          </SettingRow>
          <SettingRow label="Home Station">
            <code className="mp-setting-code">alpha.peers.social</code>
          </SettingRow>
          <div className="mp-setting-section-action">
            <Button
              size="small"
              icon={copyStatus === 'copied' ? <Check size={13} /> : <Copy size={13} />}
              data-capability-action="account.identity.copy"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText('ptid:v1:actor:alice:a3f9');
                  setCopyStatus('copied');
                } catch {
                  setCopyStatus('failed');
                }
              }}
            >
              {copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Copy unavailable' : 'Copy PTID'}
            </Button>
          </div>
        </SettingSection>
      </Capability>

      <Capability id="account.blocked.unblock">
        <SettingSection title="Blocked users" description="Blocked across every joined federation.">
          {state.blockedUsers.length === 0 ? (
            <div className="mp-setting-empty">No blocked users</div>
          ) : state.blockedUsers.map((name) => (
            <SettingRow key={name} label={name} description={`${name.toLowerCase().replace(' ', '.')}@peers.social`}>
              <Button
                size="small"
                data-capability-action="account.blocked.unblock"
                onClick={() => updateField(
                  setState,
                  'blockedUsers',
                  (current) => current.filter((item) => item !== name),
                )}
              >
                Unblock
              </Button>
            </SettingRow>
          ))}
        </SettingSection>
      </Capability>
    </>
  );
}

const RECOVERY_WORDS = 'anchor bright cedar drift ember field glass harbor island juniper kernel lantern';

export function SecuritySettingsSection({ state, setState }: SettingsOwnerProps) {
  const [pinOpen, setPinOpen] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinStatus, setPinStatus] = useState('');
  const [recoveryWords, setRecoveryWords] = useState('');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreValue, setRestoreValue] = useState('');
  const [restoreStatus, setRestoreStatus] = useState('');
  const [pendingDevice, setPendingDevice] = useState<AuthorizedDevice | null>(null);

  const setToggle = (key: string, value: boolean) => updateField(
    setState,
    'toggles',
    (current) => ({ ...current, [key]: value }),
  );

  const downloadBackup = () => {
    const payload = JSON.stringify({ actor: '@alice@alpha.peers.social', recoveryWords }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'peers-touch-recovery-backup.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <SettingSection title="PIN lock" description="Protect this account on the current device.">
        <SettingRow
          capability="security.pin.change"
          label="PIN lock"
          description={state.toggles.pinLock ? 'Active on this device.' : 'No PIN is configured.'}
        >
          <SettingToggle
            label="PIN lock"
            checked={state.toggles.pinLock}
            capability="security.pin.change"
            onChange={(value) => setToggle('pinLock', value)}
          />
        </SettingRow>
        {state.toggles.pinLock && (
          <>
            {pinOpen && (
              <div className="mp-pin-change">
                <Input.Password
                  aria-label="New PIN"
                  inputMode="numeric"
                  maxLength={8}
                  placeholder="Enter a new PIN"
                  value={pinValue}
                  onChange={(event) => setPinValue(event.target.value.replace(/\D/g, ''))}
                />
                <Button
                  type="primary"
                  disabled={pinValue.length < 4}
                  onClick={() => {
                    setPinStatus('PIN updated on this device.');
                    setPinValue('');
                    setPinOpen(false);
                  }}
                >
                  Save PIN
                </Button>
              </div>
            )}
            <div className="mp-setting-inline-actions">
              <Button
                icon={<KeyRound size={14} />}
                data-capability-action="security.pin.change"
                onClick={() => setPinOpen((open) => !open)}
              >
                Change PIN
              </Button>
              <Capability id="security.pin.remove">
                <Button
                  danger
                  data-capability-action="security.pin.remove"
                  onClick={() => {
                    setToggle('pinLock', false);
                    setPinStatus('PIN removed from this device.');
                  }}
                >
                  Remove PIN
                </Button>
              </Capability>
            </div>
          </>
        )}
        {pinStatus && <InlineStatus tone="success">{pinStatus}</InlineStatus>}
      </SettingSection>

      <SettingSection title="Account recovery" description="Recovery material stays encrypted until you export it.">
        {!recoveryWords ? (
          <Capability id="security.recovery.generate">
            <div className="mp-setting-section-action">
              <Button
                type="primary"
                icon={<ShieldCheck size={14} />}
                data-capability-action="security.recovery.generate"
                onClick={() => setRecoveryWords(RECOVERY_WORDS)}
              >
                Generate recovery phrase
              </Button>
            </div>
          </Capability>
        ) : (
          <>
            <div className="mp-recovery-phrase">{recoveryWords}</div>
            <div className="mp-setting-inline-actions">
              <Capability id="security.recovery.copy">
                <Button
                  icon={<Copy size={14} />}
                  data-capability-action="security.recovery.copy"
                  onClick={() => void navigator.clipboard.writeText(recoveryWords)}
                >
                  Copy phrase
                </Button>
              </Capability>
              <Capability id="security.recovery.backup">
                <Button
                  icon={<Download size={14} />}
                  data-capability-action="security.recovery.backup"
                  onClick={downloadBackup}
                >
                  Create backup
                </Button>
              </Capability>
            </div>
          </>
        )}
        <Capability id="security.recovery.restore">
          <div className="mp-setting-section-action">
            <Button data-capability-action="security.recovery.restore" onClick={() => setRestoreOpen((open) => !open)}>
              Restore from phrase
            </Button>
          </div>
          {restoreOpen && (
            <div className="mp-setting-editor">
              <Input.TextArea
                aria-label="Recovery phrase"
                autoSize={{ minRows: 3, maxRows: 4 }}
                placeholder="Enter the 12-word recovery phrase"
                value={restoreValue}
                onChange={(event) => {
                  setRestoreValue(event.target.value);
                  setRestoreStatus('');
                }}
              />
              <Button
                type="primary"
                onClick={() => {
                  const words = restoreValue.trim().split(/\s+/);
                  setRestoreStatus(words.length === 12 ? 'Recovery phrase verified.' : 'Enter all 12 recovery words.');
                }}
              >
                Verify phrase
              </Button>
            </div>
          )}
          {restoreStatus && (
            <InlineStatus tone={restoreStatus.startsWith('Recovery') ? 'success' : 'danger'}>
              {restoreStatus}
            </InlineStatus>
          )}
        </Capability>
      </SettingSection>

      <Capability id="security.devices.remove">
        <SettingSection title="Authorized devices" description="Devices signed in to this account.">
          {state.devices.map((device) => (
            <SettingRow key={device.id} label={device.name} description={device.detail}>
              {device.current ? (
                <Text type="secondary">This device</Text>
              ) : (
                <Button
                  size="small"
                  data-capability-action="security.devices.remove"
                  onClick={() => setPendingDevice(device)}
                >
                  Remove
                </Button>
              )}
            </SettingRow>
          ))}
        </SettingSection>
      </Capability>

      {pendingDevice && (
        <ConfirmationDialog
          title={`Remove ${pendingDevice.name}?`}
          description="That device must sign in again before it can access this account."
          confirmLabel="Remove"
          onCancel={() => setPendingDevice(null)}
          onConfirm={() => {
            updateField(setState, 'devices', (current) => (
              current.filter((item) => item.id !== pendingDevice.id)
            ));
            setPendingDevice(null);
          }}
        />
      )}
    </>
  );
}

export function GeneralSettingsSection({
  state,
  setState,
  themeMode,
  onThemeModeChange,
}: SettingsOwnerProps & {
  themeMode: DesignThemeMode;
  onThemeModeChange: (theme: DesignThemeMode) => void;
}) {
  const setToggle = (key: string, value: boolean) => updateField(
    setState,
    'toggles',
    (current) => ({ ...current, [key]: value }),
  );

  return (
    <>
      <SettingSection title="Interface" description="Device-level presentation preferences.">
        <SettingRow capability="general.language.select" label="Display language">
          <Choice
            capability="general.language.select"
            label="Display language"
            value={state.language}
            onChange={(value) => updateField(setState, 'language', value as MobileSettingsState['language'])}
            options={[
              { value: 'en', label: 'English' },
              { value: 'zh-CN', label: '简体中文' },
            ]}
          />
        </SettingRow>
        <SettingRow capability="general.theme.select" label="Theme">
          <div className="mp-setting-segmented compact" role="group" aria-label="Theme">
            {(['light', 'dark'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={themeMode === value ? 'active' : ''}
                aria-pressed={themeMode === value}
                data-capability-action="general.theme.select"
                onClick={() => onThemeModeChange(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </SettingRow>
      </SettingSection>

      <Capability id="general.notifications.configure">
        <SettingSection title="Notifications" description="Events and delivery on this device.">
          {[
            ['mentions', 'Mentions & replies'],
            ['invites', 'Group invites'],
            ['friendRequests', 'Friend requests'],
            ['reactions', 'Reactions'],
            ['networkEvents', 'Network events'],
            ['inApp', 'In-app notifications'],
            ['sound', 'Notification sound'],
          ].map(([key, label]) => (
            <SettingRow key={key} label={label}>
              <SettingToggle
                label={label}
                checked={state.toggles[key]}
                capability="general.notifications.configure"
                onChange={(value) => setToggle(key, value)}
              />
            </SettingRow>
          ))}
        </SettingSection>
      </Capability>

      <SettingSection title="Social defaults" description="You can still change the audience for each post.">
        <SettingRow capability="general.social.default-audience" label="Default audience">
          <Choice
            capability="general.social.default-audience"
            label="Default audience"
            value={state.defaultVisibility}
            onChange={(defaultVisibility) => updateField(
              setState,
              'defaultVisibility',
              defaultVisibility as MobileSettingsState['defaultVisibility'],
            )}
            options={[
              { value: 'public', label: 'Public' },
              { value: 'followers', label: 'Followers' },
            ]}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Agent defaults" description="Used when a new Agent task does not specify routing.">
        <SettingRow capability="general.agent.default-provider" label="Default provider">
          <Choice
            capability="general.agent.default-provider"
            label="Default provider"
            value={state.defaultProvider}
            onChange={(value) => updateField(setState, 'defaultProvider', value)}
            options={state.providers
              .filter((provider) => provider.runtime === 'cloud')
              .map((provider) => ({ value: provider.id, label: provider.name }))}
          />
        </SettingRow>
        <SettingRow capability="general.agent.default-model" label="Default model">
          <Choice
            capability="general.agent.default-model"
            label="Default model"
            value={state.defaultModel}
            onChange={(value) => updateField(setState, 'defaultModel', value)}
            options={state.providers.flatMap((provider) => provider.models
              .filter((model) => model.enabled)
              .map((model) => ({ value: model.id, label: model.name })))}
          />
        </SettingRow>
        <SettingRow capability="general.agent.default-effort" label="Reasoning effort">
          <Choice
            capability="general.agent.default-effort"
            label="Reasoning effort"
            value={state.defaultEffort}
            onChange={(value) => updateField(setState, 'defaultEffort', value as MobileSettingsState['defaultEffort'])}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Desktop integration">
        <DegradedCapability
          id="general.chat.shortcut"
          title="Screenshot shortcut"
          reason="Global keyboard shortcuts are managed by the operating system on Mobile."
        />
      </SettingSection>
    </>
  );
}

export function FederationSettingsSection({
  state,
  setState,
  onChangeStation,
}: SettingsOwnerProps & { onChangeStation: () => void }) {
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinEndpoint, setJoinEndpoint] = useState('');
  const [joinError, setJoinError] = useState('');
  const [copyStatus, setCopyStatus] = useState('Copy handle');
  const [pendingFederation, setPendingFederation] = useState<Federation | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState(false);

  const setToggle = (key: string, value: boolean) => updateField(
    setState,
    'toggles',
    (current) => ({ ...current, [key]: value }),
  );

  return (
    <>
      <SettingSection title="Federated identity" description="How your account is resolved outside this Station.">
        <div className="mp-station-binding">
          <span className="mp-setting-hero-icon"><Server size={22} /></span>
          <span>
            <Text strong>Local Station</Text>
            <Text type="secondary">alpha.peers.social</Text>
          </span>
          <span className="mp-station-connected"><Check size={13} /> Connected</span>
        </div>
        <SettingRow capability="federation.identity.copy-handle" label="Your handle" description="@alice@alpha.peers.social">
          <Button
            size="small"
            icon={copyStatus === 'Copied' ? <Check size={13} /> : <Copy size={13} />}
            data-capability-action="federation.identity.copy-handle"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText('@alice@alpha.peers.social');
                setCopyStatus('Copied');
              } catch {
                setCopyStatus('Unavailable');
              }
            }}
          >
            {copyStatus}
          </Button>
        </SettingRow>
        <SettingRow capability="federation.visibility.select" label="Federation visibility">
          <Choice
            capability="federation.visibility.select"
            label="Federation visibility"
            value={state.federationVisibility}
            onChange={(value) => updateField(
              setState,
              'federationVisibility',
              value as MobileSettingsState['federationVisibility'],
            )}
            options={[
              { value: 'public', label: 'Public' },
              { value: 'federations', label: 'My federations' },
              { value: 'by-handle', label: 'By handle only' },
            ]}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Discovery" description="Visibility and contact admission are independent.">
        <SettingRow capability="federation.discovery.toggle" label="Discoverable">
          <SettingToggle
            label="Discoverable"
            checked={state.toggles.discoverable}
            capability="federation.discovery.toggle"
            onChange={(value) => setToggle('discoverable', value)}
          />
        </SettingRow>
        <SettingRow capability="federation.discovery.reach" label="Accept requests from">
          <Choice
            capability="federation.discovery.reach"
            label="Accept requests from"
            value={state.reach}
            onChange={(value) => updateField(setState, 'reach', value as MobileSettingsState['reach'])}
            options={[
              { value: 'anyone', label: 'Anyone' },
              { value: 'federations', label: 'My federations' },
              { value: 'nobody', label: 'Nobody' },
            ]}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Federation contexts"
        description="Networks this Station participates in."
        action={(
          <Capability id="federation.context.join">
            <Button
              size="small"
              icon={<Plus size={14} />}
              data-capability-action="federation.context.join"
              onClick={() => setJoinOpen((open) => !open)}
            >
              Join
            </Button>
          </Capability>
        )}
      >
        {joinOpen && (
          <div className="mp-setting-editor">
            <Input
              autoFocus
              aria-label="Federation endpoint"
              placeholder="https://federation.example.com"
              status={joinError ? 'error' : undefined}
              value={joinEndpoint}
              onChange={(event) => {
                setJoinEndpoint(event.target.value);
                setJoinError('');
              }}
            />
            {joinError && <Text type="danger">{joinError}</Text>}
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setJoinOpen(false)}>Cancel</Button>
              <Button
                type="primary"
                onClick={() => {
                  const endpoint = joinEndpoint.trim();
                  if (!/^(https?:\/\/)?[\w-]+(\.[\w-]+)+/.test(endpoint)) {
                    setJoinError('Enter a valid federation endpoint.');
                    return;
                  }
                  const host = endpoint.replace(/^https?:\/\//, '').split('/')[0];
                  if (state.federations.some((federation) => federation.endpoint === host)) {
                    setJoinError('This federation is already joined.');
                    return;
                  }
                  updateField(setState, 'federations', (current) => [...current, {
                    id: `joined-${Date.now()}`,
                    name: host,
                    endpoint: host,
                    role: 'Member',
                    stations: 1,
                  }]);
                  setJoinEndpoint('');
                  setJoinOpen(false);
                }}
              >
                Join federation
              </Button>
            </div>
          </div>
        )}
        <div className="mp-federation-list">
          {state.federations.map((federation) => {
            const capability = federation.role === 'Operator'
              ? 'federation.context.delete'
              : 'federation.context.leave';
            return (
              <Capability id={capability} key={federation.id}>
                <article className="mp-federation-item">
                  <span className="mp-federation-main">
                    <Text strong>{federation.name}</Text>
                    <Text type="secondary">{federation.endpoint}</Text>
                    <span className="mp-federation-meta">{federation.role} · {federation.stations} Stations</span>
                  </span>
                  <Button
                    danger
                    type="text"
                    aria-label={`${federation.role === 'Operator' ? 'Delete' : 'Leave'} ${federation.name}`}
                    data-capability-action={capability}
                    icon={federation.role === 'Operator' ? <Trash2 size={15} /> : <LogOut size={15} />}
                    onClick={() => setPendingFederation(federation)}
                  >
                    {federation.role === 'Operator' ? 'Delete' : 'Leave'}
                  </Button>
                </article>
              </Capability>
            );
          })}
        </div>
      </SettingSection>

      <Capability id="federation.station.switch">
        <section className="mp-setting-danger">
          <Text strong>Switch Station</Text>
          <Text type="secondary">Sign out and choose another Station. Local conversations stay on this device.</Text>
          {confirmSwitch ? (
            <div className="mp-setting-inline-actions">
              <Button onClick={() => setConfirmSwitch(false)}>Cancel</Button>
              <Button
                danger
                type="primary"
                data-capability-action="federation.station.switch"
                onClick={onChangeStation}
              >
                Sign out & switch
              </Button>
            </div>
          ) : (
            <Button
              danger
              icon={<LogOut size={14} />}
              onClick={() => setConfirmSwitch(true)}
            >
              Switch Station
            </Button>
          )}
        </section>
      </Capability>

      {pendingFederation && (
        <ConfirmationDialog
          title={`${pendingFederation.role === 'Operator' ? 'Delete' : 'Leave'} ${pendingFederation.name}?`}
          description={pendingFederation.role === 'Operator'
            ? 'Member Stations will lose this federation after deletion.'
            : 'Your Station will stop participating in this federation.'}
          confirmLabel={pendingFederation.role === 'Operator' ? 'Delete' : 'Leave'}
          onCancel={() => setPendingFederation(null)}
          onConfirm={() => {
            updateField(setState, 'federations', (current) => (
              current.filter((item) => item.id !== pendingFederation.id)
            ));
            setPendingFederation(null);
          }}
        />
      )}
    </>
  );
}

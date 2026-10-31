/**
 * AccountSection — prototype counterpart of desktop AccountTab + DeviceLinkPanel.
 *
 * Card order follows what friends look at first: identity → public profile →
 * devices. The banner is its own tile (the avatar never overlaps the tinted
 * gradient, so there is no edge staining); the identity card uses the same
 * clean surface as the in-chat profile card plus configuration controls.
 * Secondary affordances (copy) stay quiet icon buttons — identity content
 * carries the visual weight. Linked devices paginate five per page and only
 * show the pager + total beyond five. Device link keeps the simulated QR flow
 * (qr -> request -> comparison-code approval -> result) and appends a row.
 */
import { useRef, useState } from 'react';
import { Camera, Link2, Plus, Smartphone, Trash2 } from 'lucide-react';
import {
  Avatar, Button, Dialog, IconButton, QrCode, Select, Tag, TextArea, TextField,
} from '@peers-touch/ui';
import { SettingsItemCard, SettingsRow, SettingsSection } from '../SettingsPrimitives';
import { locTag, useT, type Locale } from '../../prefs';
import '../settings.css';

interface ProfileLink { id: string; label: string; url: string }

const INITIAL_LINKS: ProfileLink[] = [
  { id: 'link-1', label: '共享书架', url: 'https://songshelf.local/linye' },
];

const TIMEZONES = ['Asia/Shanghai', 'Asia/Tokyo', 'Europe/Berlin', 'America/Los_Angeles'];

// The QR approval flow always names the requesting device; a completed link
// appends this model to the list (one simulated new device in the prototype).
const LINKING_DEVICE_MODEL = 'iPhone 15';
const DEVICE_PAGE_SIZE = 5;

interface LinkedDevice {
  id: string;
  model: string;
  joinedAt: number;
  lastUsedAt: number;
  current?: boolean;
}

// Six seeded rows so pagination genuinely exists; dates are fixed fixtures.
const INITIAL_DEVICES: LinkedDevice[] = [
  { id: 'dev-1', model: 'MacBook Pro 14″', joinedAt: Date.UTC(2025, 9, 3), lastUsedAt: Date.now() - 2 * 3_600_000, current: true },
  { id: 'dev-2', model: 'iPhone 15', joinedAt: Date.UTC(2025, 9, 3), lastUsedAt: Date.now() - 26 * 3_600_000 },
  { id: 'dev-3', model: 'iPad Air', joinedAt: Date.UTC(2025, 11, 15), lastUsedAt: Date.now() - 9 * 86_400_000 },
  { id: 'dev-4', model: 'MacBook Air (Home)', joinedAt: Date.UTC(2026, 5, 20), lastUsedAt: Date.now() - 41 * 86_400_000 },
  { id: 'dev-5', model: 'Pixel 8', joinedAt: Date.UTC(2026, 7, 1), lastUsedAt: Date.now() - 63 * 86_400_000 },
  { id: 'dev-6', model: 'Web · Safari', joinedAt: Date.UTC(2026, 9, 21), lastUsedAt: Date.now() - 11 * 86_400_000 },
];

function formatDate(ts: number, locale: Locale): string {
  return new Date(ts).toLocaleDateString(locTag(locale), { year: 'numeric', month: 'short', day: 'numeric' });
}
function formatDateTime(ts: number, locale: Locale): string {
  return new Date(ts).toLocaleString(locTag(locale), {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function readImage(file: File | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('no file'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function ImagePick({ label, onPick }: { label: string; onPick: (dataUrl: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" hidden
        onChange={event => { const file = event.target.files?.[0]; if (file) void readImage(file).then(onPick); event.target.value = ''; }} />
      <Button actionId="account.pick-image" emphasis="quiet" density="compact" leading={<Camera size={13} />}
        label={label} onActivate={() => inputRef.current?.click()} />
    </>
  );
}

type LinkStage = 'qr' | 'approve' | 'finishing' | 'complete' | 'expired';

export function AccountSection() {
  const { t, locale } = useT();
  const [displayName, setDisplayName] = useState('林野');
  const [bio, setBio] = useState('共享书架轮值 · 小区生活圈 · 喜欢把邻居连接起来的小事');
  const [region, setRegion] = useState('上海');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [tags, setTags] = useState<string[]>(['书架', '种子交换']);
  const [tagDraft, setTagDraft] = useState('');
  const [links, setLinks] = useState<ProfileLink[]>(INITIAL_LINKS);
  const [avatar, setAvatar] = useState<string>('');
  const [banner, setBanner] = useState<string>('');

  const [devices, setDevices] = useState<LinkedDevice[]>(INITIAL_DEVICES);
  const [devicePage, setDevicePage] = useState(1);
  const [linkOpen, setLinkOpen] = useState(false);
  const [stage, setStage] = useState<LinkStage>('qr');

  const addTag = () => {
    const value = tagDraft.trim();
    if (value && !tags.includes(value)) setTags(list => [...list, value]);
    setTagDraft('');
  };
  const addLink = () => setLinks(list => [...list, { id: `local-${Date.now()}`, label: '', url: '' }]);

  const devicePages = Math.max(1, Math.ceil(devices.length / DEVICE_PAGE_SIZE));
  const visibleDevices = devices.slice((devicePage - 1) * DEVICE_PAGE_SIZE, devicePage * DEVICE_PAGE_SIZE);
  const removeDevice = (id: string) => {
    setDevices(list => {
      const next = list.filter(device => device.id !== id);
      setDevicePage(page => Math.min(page, Math.max(1, Math.ceil(next.length / DEVICE_PAGE_SIZE))));
      return next;
    });
  };

  const openDeviceLink = () => { setStage('qr'); setLinkOpen(true); };
  const startApproval = () => setStage('approve');
  const allow = () => {
    setStage('finishing');
    window.setTimeout(() => {
      const now = Date.now();
      setDevices(list => [{
        id: `local-${now}`, model: LINKING_DEVICE_MODEL, joinedAt: now, lastUsedAt: now,
      }, ...list]);
      setDevicePage(1);
      setStage('complete');
    }, 800);
  };

  return (
    <>
      {/* Identity — clean card grammar matching the in-chat profile card;
          the banner is a separate tile, never under the avatar. */}
      <SettingsSection title={t('account.identity')} subtitle={t('account.identitySubtitle')}>
        <div className="sk-banner" data-has-image={banner ? 'true' : 'false'}>
          {banner && <img src={banner} alt="" />}
          <div className="sk-banner-action"><ImagePick label={t('account.bannerChange')} onPick={setBanner} /></div>
        </div>
        <SettingsItemCard>
          <div className="sk-identity-row">
            <div className="sk-identity-avatar">
              <Avatar name={displayName} source={avatar || undefined} background="#22302a"
                size={80} style={{ borderRadius: 22 }} />
              <ImagePick label={t('account.avatarChange')} onPick={setAvatar} />
            </div>
            <div className="sk-identity-meta">
              <div className="sk-identity-names">
                <strong>{displayName || t('account.unnamed')}</strong>
                <Tag tone="info">@{displayName ? 'linye' : ''}</Tag>
                <Tag>{t('account.localIdentity')}</Tag>
              </div>
              <div className="sk-identity-stats">
                <span><strong>12</strong> {t('account.statsPosts')}</span>
                <span><strong>86</strong> {t('account.statsFollows')}</span>
                <span><strong>104</strong> {t('account.statsFollowers')}</span>
                <span className="sk-identity-joined">{t('account.joined', { date: '2025-10' })}</span>
              </div>
            </div>
          </div>
          <div className="sk-identity-fields">
            <div className="sk-identity-field">
              <span>{t('account.usernamePreferred')}</span>
              <code>@linye</code>
              <IconButton iconId="copy" iconSize={13} density="compact" emphasis="quiet"
                actionId="account.copy-username" label={t('account.copy')}
                onActivate={() => { void navigator.clipboard?.writeText('linye'); }} />
            </div>
            <div className="sk-identity-field">
              <span>PTID</span>
              <code>ptid:3f9a7c21:8c2e04ab</code>
              <IconButton iconId="copy" iconSize={13} density="compact" emphasis="quiet"
                actionId="account.copy-ptid" label={t('account.copy')}
                onActivate={() => { void navigator.clipboard?.writeText('ptid:3f9a7c21:8c2e04ab'); }} />
            </div>
          </div>
        </SettingsItemCard>
      </SettingsSection>

      {/* Public profile — friends read this first, so it precedes devices. */}
      <SettingsSection title={t('account.publicProfile')} subtitle={t('account.publicProfileSubtitle')}>
        <SettingsRow label={t('account.displayName')} vertical>
          <TextField aria-label={t('account.displayName')} value={displayName} maxLength={60} onValueChange={setDisplayName} />
        </SettingsRow>
        <SettingsRow label={t('account.bio')} vertical>
          <TextArea framing="embedded" aria-label={t('account.bio')} value={bio} maxLength={280} characterCount
            minimumRows={3} onValueChange={setBio} data-bio-value={bio} />
        </SettingsRow>
        <div className="sk-form-grid">
          <SettingsRow label={t('account.region')} description={t('account.optional')}>
            <TextField aria-label={t('account.region')} value={region} onValueChange={setRegion} />
          </SettingsRow>
          <SettingsRow label={t('account.timezone')} description={t('account.optional')}>
            <Select<string> aria-label={t('account.timezone')} searchable options={TIMEZONES.map(value => ({ value, label: value }))}
              value={timezone} onValueChange={value => setTimezone(String(value))} />
          </SettingsRow>
        </div>
        <SettingsRow label={t('account.tags')} description={t('account.tagsDesc')} vertical>
          <div className="sk-tag-editor">
            {tags.map(tag => (
              <Tag key={tag} tone="neutral" dismissLabel={t('account.tagRemove', { tag })}
                onDismiss={() => setTags(list => list.filter(entry => entry !== tag))}>{tag}</Tag>
            ))}
            <TextField className="sk-tag-input" aria-label={t('account.tags')} placeholder={t('account.tagPlaceholder')}
              value={tagDraft} onValueChange={setTagDraft}
              onEnter={event => { event.preventDefault(); addTag(); }} />
          </div>
        </SettingsRow>
        <SettingsRow label={t('account.links')} vertical>
          <div className="sk-links-head">
            <span><Link2 size={13} /> {t('account.linksDesc')}</span>
            <Button actionId="account.link-add" emphasis="quiet" density="compact" leading={<Plus size={13} />}
              label={t('account.addLink')} onActivate={addLink} />
          </div>
          <div className="sk-links-list">
            {links.map((link, index) => (
              <div className="sk-link-row" key={link.id}>
                <TextField aria-label={`${t('account.linkName')} ${index + 1}`} placeholder={t('account.linkName')} value={link.label}
                  onValueChange={value => setLinks(list => list.map((entry, i) => i === index ? { ...entry, label: value } : entry))} />
                <TextField aria-label={`${t('account.linkUrl')} ${index + 1}`} placeholder="https://…" value={link.url}
                  onValueChange={value => setLinks(list => list.map((entry, i) => i === index ? { ...entry, url: value } : entry))} />
                <Button actionId={`account.link-remove-${index}`} emphasis="quiet" density="compact"
                  aria-label={t('account.removeLink')} leading={<Trash2 size={14} />} label=""
                  onActivate={() => setLinks(list => list.filter((_, i) => i !== index))} />
              </div>
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* Devices — link action at the title row's end; linked devices below. */}
      <SettingsSection title={t('account.devices')} subtitle={t('account.devicesSubtitle')}
        extra={
          <Button actionId="device.link-start" emphasis="secondary" density="compact" leading={<Smartphone size={14} />}
            label={t('account.linkDevice')} onActivate={openDeviceLink} />
        }>
        <div className="sk-device-list" data-device-count={devices.length}>
          <div className="sk-device-row is-head">
            <span>{t('account.deviceModel')}</span>
            <span>{t('account.deviceJoined')}</span>
            <span>{t('account.deviceLastUsed')}</span>
            <span />
          </div>
          {visibleDevices.map(device => (
            <div className="sk-device-row" key={device.id} data-device-id={device.id}>
              <span className="sk-device-model">
                <Smartphone size={14} className="sk-device-icon" />
                <strong>{device.model}</strong>
                {device.current && <Tag tone="info">{t('account.deviceCurrent')}</Tag>}
              </span>
              <span>{formatDate(device.joinedAt, locale)}</span>
              <span>{formatDateTime(device.lastUsedAt, locale)}</span>
              <span className="sk-device-op">
                {!device.current && (
                  <IconButton iconId="delete" iconSize={14} density="compact" emphasis="quiet"
                    actionId={`device.remove-${device.id}`}
                    label={t('account.deviceRemoveAria', { name: device.model })}
                    onActivate={() => removeDevice(device.id)} />
                )}
              </span>
            </div>
          ))}
        </div>
        {devices.length > DEVICE_PAGE_SIZE && (
          <div className="sk-device-pager" data-device-pager>
            <span>{t('account.deviceCount', { n: devices.length })} · {t('account.devicePage', { page: devicePage, pages: devicePages })}</span>
            <span className="sk-device-pager-controls">
              <IconButton iconId="chevron-left" iconSize={14} density="compact" emphasis="quiet"
                actionId="device.page-prev" label={t('account.devicePrev')}
                availability={devicePage === 1 ? { kind: 'disabled', reason: t('doc.firstPage') } : undefined}
                onActivate={() => setDevicePage(page => Math.max(1, page - 1))} />
              <IconButton iconId="chevron-right" iconSize={14} density="compact" emphasis="quiet"
                actionId="device.page-next" label={t('account.deviceNext')}
                availability={devicePage === devicePages ? { kind: 'disabled', reason: t('doc.lastPage') } : undefined}
                onActivate={() => setDevicePage(page => Math.min(devicePages, page + 1))} />
            </span>
          </div>
        )}

        <Dialog open={linkOpen} onDismiss={() => setLinkOpen(false)} title={t('account.linkDialogTitle')} width={400}
          closeLabel={t('common.close')}
          footer={stage === 'complete'
            ? <Button actionId="device.link-done" emphasis="primary" label={t('common.done')} onActivate={() => setLinkOpen(false)} />
            : stage === 'expired'
              ? <Button actionId="device.link-refresh" emphasis="primary" label={t('account.refreshQr')} onActivate={() => setStage('qr')} />
              : undefined}>
          <div className="sk-device-stage" data-stage={stage}>
            {stage === 'qr' && (
              <>
                <QrCode value="peers-touch://device-link/offer/local-909" label={t('account.qrLabel')} size={220} />
                <p className="sk-device-hint">{t('account.qrHint')}</p>
                <Button actionId="device.link-simulate" emphasis="quiet" label={t('account.simulateScan')}
                  onActivate={startApproval} />
              </>
            )}
            {stage === 'approve' && (
              <>
                <strong>{t('account.deviceRequesting', { model: LINKING_DEVICE_MODEL })}</strong>
                <span className="sk-device-code">47 2096</span>
                <p className="sk-device-hint">{t('account.codeHint')}</p>
                <div className="sk-device-decide">
                  <Button actionId="device.link-allow" emphasis="primary" label={t('common.allow')} onActivate={allow} />
                  <Button actionId="device.link-deny" emphasis="secondary" label={t('common.deny')}
                    onActivate={() => setStage('expired')} />
                </div>
              </>
            )}
            {stage === 'finishing' && <span className="sk-device-status" role="status">{t('account.deviceFinishing')}</span>}
            {stage === 'complete' && <span className="sk-device-status" role="status">{t('account.deviceComplete')}</span>}
            {stage === 'expired' && <span className="sk-device-status" role="status">{t('account.deviceExpired')}</span>}
          </div>
        </Dialog>
      </SettingsSection>
    </>
  );
}

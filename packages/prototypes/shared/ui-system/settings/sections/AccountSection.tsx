/**
 * AccountSection — prototype counterpart of desktop AccountTab.
 *
 * Desktop Settings IA parity: Identity → Public profile → Relationships
 * (blocked users). Authorized devices and the QR linking flow live under
 * Network › Your Station (LinkedDevices). Identity is one tile: the banner
 * bleeds to the card's top corners and the avatar overlaps its lower edge
 * with a card-colored separation ring (reference profile geometry).
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Link2, Plus, Trash2, Users } from 'lucide-react';
import {
  Avatar, Button, FilePicker, IconButton, Select, Tag, TextArea, TextField,
} from '@peers-touch/ui';
import { useT } from '../../prefs';
import { SettingsRow, SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

interface ProfileLink { id: string; label: string; url: string }

const INITIAL_LINKS: ProfileLink[] = [
  { id: 'link-1', label: '共享书架', url: 'https://songshelf.local/linye' },
];

const TIMEZONES = ['Asia/Shanghai', 'Asia/Tokyo', 'Europe/Berlin', 'America/Los_Angeles'];

const INITIAL_BLOCKED = [
  { id: 'bl-1', name: 'Spam Bot' },
  { id: 'bl-2', name: 'Old Contact' },
  { id: 'bl-3', name: 'Noise Account' },
];

function readImageFile(files: readonly File[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const file = files[0];
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

export function AccountSection() {
  const { t } = useT();
  const [displayName, setDisplayName] = useState('林野');
  const [bio, setBio] = useState('共享书架轮值 · 小区生活圈 · 喜欢把邻居连接起来的小事');
  const [region, setRegion] = useState('上海');
  const [timezone, setTimezone] = useState('Asia/Shanghai');
  const [tags, setTags] = useState<string[]>(['书架', '种子交换']);
  const [tagDraft, setTagDraft] = useState('');
  const [links, setLinks] = useState<ProfileLink[]>(INITIAL_LINKS);
  const [avatar, setAvatar] = useState<string>('');
  const [banner, setBanner] = useState<string>('');
  const [blocked, setBlocked] = useState(INITIAL_BLOCKED);
  const [blockedOpen, setBlockedOpen] = useState(false);

  const addTag = () => {
    const value = tagDraft.trim();
    if (value && !tags.includes(value)) setTags(list => [...list, value]);
    setTagDraft('');
  };
  const addLink = () => setLinks(list => [...list, { id: `local-${Date.now()}`, label: '', url: '' }]);

  const applyImage = (setter: (value: string) => void) => (files: readonly File[]) => {
    void readImageFile(files).then(setter).catch(() => undefined);
  };

  return (
    <>
      {/* Identity — one tile, avatar overlaps the banner's lower edge. */}
      <SettingsSection title={t('account.identity')} subtitle={t('account.identitySubtitle')}>
        <div className="sk-identity" data-profile-identity>
          <div className="sk-banner" data-has-image={banner ? 'true' : 'false'}>
            {banner && <img src={banner} alt="" />}
            <span className="sk-banner-action">
              <FilePicker iconOnly iconId="edit" accept="image/*" label={t('account.bannerChange')}
                onFiles={applyImage(setBanner)} />
            </span>
          </div>
          <div className="sk-identity-card">
            <div className="sk-identity-row">
              <div className="sk-identity-avatar">
                <Avatar name={displayName} source={avatar || undefined} background="#2f6a50"
                  size={80} style={{ borderRadius: 22 }} />
                <span className="sk-identity-avatar-action">
                  <FilePicker iconOnly iconId="edit" accept="image/*" label={t('account.avatarChange')}
                    onFiles={applyImage(setAvatar)} />
                </span>
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
          </div>
        </div>
      </SettingsSection>

      {/* Public profile */}
      <SettingsSection title={t('account.publicProfile')} subtitle={t('account.publicProfileSubtitle')}>
        <SettingsRow label={t('account.displayName')}>
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

      {/* Relationships */}
      <SettingsSection icon={Users} title={t('account.relationships')} subtitle={t('account.relationshipsDesc')}>
        <button type="button" className="sk-blocked-head" data-blocked-toggle
          aria-expanded={blockedOpen} onClick={() => setBlockedOpen(open => !open)}>
          <span className="sk-blocked-title">{t('account.blockedUsers')}</span>
          <span className="sk-blocked-count">{blocked.length}</span>
          {blockedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        {blockedOpen && (
          <div className="sk-blocked-list" data-blocked-list>
            {blocked.map(person => (
              <SettingsRow key={person.id} label={person.name}>
                <Button actionId={`account.unblock-${person.id}`} emphasis="quiet" density="compact"
                  label={t('account.unblock')}
                  onActivate={() => setBlocked(list => list.filter(entry => entry.id !== person.id))} />
            </SettingsRow>
            ))}
            {blocked.length === 0 && <p className="sk-field-hint">{t('account.blockedEmpty')}</p>}
          </div>
        )}
      </SettingsSection>
    </>
  );
}

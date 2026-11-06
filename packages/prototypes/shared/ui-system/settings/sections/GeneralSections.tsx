/**
 * General-group sections (desktop Settings.tsx parity):
 * Notifications, Privacy & Security, Appearance & Language.
 *
 * Shape grammar: these are flat preference surfaces. Section/heading and the
 * label-left/control-right row come from the peers-ui ListSection/ListRow
 * primitives (full-bleed hairlines, zero per-row chrome); in-row selects are
 * the quiet ghost variant and status notices are inline alerts. This module
 * only composes primitives and owns genuinely specialized layout (the 24-word
 * recovery phrase); it never restyles a `.pt-*` primitive.
 *
 * Toggles/segmented choices persist through the shared prefs module so chat
 * and settings observe the same values; PIN auto-lock minutes stay local.
 */
import { useState } from 'react';
import { Bell, Eye, KeyRound, Lock, Upload } from 'lucide-react';
import { Button, CopyButton, Dialog, ListRow, ListSection, Select, Segmented, Switch, TextArea } from '@peers-touch/ui';
import {
  makeTranslate, setPrefs, usePrefs,
  type DensityMode, type NotificationPrefs, type Prefs, type ThemeMode, type Translate,
} from '../../prefs';
import { SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

const HEADING_ICON = 14;

function useGeneralPrefs(): { t: Translate; prefs: Prefs } {
  const prefs = usePrefs();
  return { t: makeTranslate(prefs.locale), prefs };
}

/* ── Notifications (desktop NotificationsSettingsSection) ─────────────── */

export function NotificationsSection() {
  const { t, prefs } = useGeneralPrefs();
  const flip = (key: keyof NotificationPrefs) => {
    setPrefs({ notifications: { ...prefs.notifications, [key]: !prefs.notifications[key] } });
  };
  const rows: { key: keyof NotificationPrefs; label: string; desc: string }[] = [
    { key: 'mentions', label: t('settings.n.mentions'), desc: t('settings.n.mentionsDesc') },
    { key: 'invites', label: t('settings.n.invites'), desc: t('settings.n.invitesDesc') },
    { key: 'friendRequests', label: t('settings.n.friendRequests'), desc: t('settings.n.friendRequestsDesc') },
    { key: 'reactions', label: t('settings.n.reactions'), desc: t('settings.n.reactionsDesc') },
    { key: 'network', label: t('settings.n.network'), desc: t('settings.n.networkDesc') },
  ];
  return (
    <>
      <ListSection inset icon={<Bell size={HEADING_ICON} strokeWidth={1.8} />}
        title={t('settings.notifyWhat')} description={t('settings.notifyWhatSubtitle')}>
        {rows.map(row => (
          <ListRow key={row.key} label={row.label} description={row.desc}
            control={<Switch checked={prefs.notifications[row.key]} aria-label={row.label}
              data-notify={row.key} onCheckedChange={() => flip(row.key)} />} />
        ))}
      </ListSection>
      <ListSection inset icon={<Bell size={HEADING_ICON} strokeWidth={1.8} />}
        title={t('settings.notifyDelivery')} description={t('settings.notifyDeliverySubtitle')}>
        <ListRow label={t('settings.n.inApp')} description={t('settings.n.inAppDesc')}
          control={<Switch checked={prefs.notifications.inApp} aria-label={t('settings.n.inApp')}
            data-notify="inApp" onCheckedChange={() => flip('inApp')} />} />
        <ListRow label={t('settings.n.sound')} description={t('settings.n.soundDesc')}
          control={<Switch checked={prefs.notifications.sound} aria-label={t('settings.n.sound')}
            data-notify="sound" onCheckedChange={() => flip('sound')} />} />
      </ListSection>
    </>
  );
}

/* ── Privacy & Security (desktop PrivacySection) ──────────────────────── */

export function PrivacySection() {
  const { t, prefs } = useGeneralPrefs();
  const [autoLock, setAutoLock] = useState('5m');
  const privacy = prefs.privacy;
  const flip = (key: keyof typeof privacy) => {
    setPrefs({ privacy: { ...privacy, [key]: !privacy[key] } });
  };
  return (
    <>
      <ListSection inset icon={<Lock size={HEADING_ICON} strokeWidth={1.8} />}
        title={t('privacy.appAccess')} description={t('privacy.appAccessDesc')}>
        <ListRow label={t('privacy.pinLock')} description={t('privacy.pinLockDesc')}
          control={<Switch checked={privacy.pinLock} aria-label={t('privacy.pinLock')}
            data-privacy="pinLock" onCheckedChange={() => flip('pinLock')} />} />
        {privacy.pinLock && (
          <div className="sk-inline-actions sk-pin-manage">
            <Button actionId="privacy.change-pin" emphasis="quiet" density="compact"
              label={t('privacy.changePin')} />
            <Button actionId="privacy.remove-pin" emphasis="quiet" density="compact" tone="danger"
              label={t('privacy.removePin')} onActivate={() => flip('pinLock')} />
          </div>
        )}
        <ListRow label={t('privacy.autoLock')} description={t('privacy.autoLockDesc')}
          control={<Select<'1m' | '5m' | '15m' | 'never'> appearance="ghost" aria-label={t('privacy.autoLock')}
            value={autoLock as '1m' | '5m' | '15m' | 'never'}
            onValueChange={value => setAutoLock((Array.isArray(value) ? value[0] : value) ?? '5m')}
            options={[
              { value: '1m', label: t('privacy.lock.1m') },
              { value: '5m', label: t('privacy.lock.5m') },
              { value: '15m', label: t('privacy.lock.15m') },
              { value: 'never', label: t('privacy.lock.never') },
            ]} />} />
      </ListSection>
      <ListSection inset icon={<Eye size={HEADING_ICON} strokeWidth={1.8} />}
        title={t('privacy.visibility')} description={t('privacy.visibilityDesc')}>
        <ListRow label={t('privacy.online')} description={t('privacy.onlineDesc')}
          control={<Switch checked={privacy.onlineVisible} aria-label={t('privacy.online')}
            data-privacy="online" onCheckedChange={() => flip('onlineVisible')} />} />
        <ListRow label={t('privacy.readReceipts')} description={t('privacy.readReceiptsDesc')}
          control={<Switch checked={privacy.readReceipts} aria-label={t('privacy.readReceipts')}
            data-privacy="readReceipts" onCheckedChange={() => flip('readReceipts')} />} />
      </ListSection>

      <RecoveryBlock />
    </>
  );
}

/* ── Account recovery (24-word phrase; prototype-local state) ─────────── */

const WORD_POOL = [
  'river', 'maple', 'mint', 'harbor', 'lantern', 'bridge', 'cedar', 'atlas',
  'meadow', 'quartz', 'willow', 'anchor', 'ember', 'garden', 'compass', 'linden',
  'osprey', 'pebble', 'summit', 'creek', 'bicycle', 'shelf', 'paper', 'fennel',
];
function generatePhrase(): string[] {
  return Array.from({ length: 24 }, () => WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]);
}

function RecoveryBlock() {
  const { t, prefs } = useGeneralPrefs();
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [backupExists, setBackupExists] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lastBackup, setLastBackup] = useState('');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');

  const generate = () => {
    setGenerating(true);
    window.setTimeout(() => { setPhrase(generatePhrase()); setGenerating(false); }, 500);
  };
  const createBackup = () => {
    if (!phrase) return;
    setCreating(true);
    window.setTimeout(() => {
      setCreating(false); setBackupExists(true); setRestored(false);
      setLastBackup(new Date().toLocaleString(prefs.locale === 'en' ? 'en-US' : 'zh-CN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }));
    }, 600);
  };
  const confirmRestore = () => {
    setRestoring(true);
    window.setTimeout(() => {
      setRestoring(false); setRestoreOpen(false); setRestored(true); setPhraseInput('');
    }, 700);
  };

  return (
    <>
      <SettingsSection icon={KeyRound} title={t('security.title')} subtitle={t('security.subtitle')}
        extra={
          <Button actionId="security.restore-open" emphasis="quiet" density="compact"
            label={t('security.restoreOpen')}
            onActivate={() => { setRestored(false); setRestoreOpen(true); }} />
        }>
        {/* Backup status is one quiet label/value row, never a nested warning
            callout: "no backup yet" is the default empty state, not a fault.
            A small status dot is the only tone; no triangle, no inset rail. */}
        <div className="sk-settings-row">
          <div className="sk-settings-row-text">
            <span className="sk-settings-row-label">{t('security.backupStatus')}</span>
            <span className="sk-settings-row-desc">{t('security.noBackupDesc')}</span>
          </div>
          <div className="sk-settings-row-control">
            <span className={`sk-recovery-state${backupExists ? ' is-backed' : ''}`} data-recovery-state={backupExists ? 'backed' : 'none'}>
              <i className="sk-recovery-dot" aria-hidden="true" />
              {backupExists ? t('security.lastBackup', { time: lastBackup }) : t('security.noBackupTitle')}
            </span>
          </div>
        </div>
        {restored && (
          <div className="sk-settings-row" data-recovery-restored>
            <div className="sk-settings-row-text">
              <span className="sk-settings-row-label">{t('security.restoredTitle')}</span>
              <span className="sk-settings-row-desc">{t('security.restoredDesc')}</span>
            </div>
          </div>
        )}

        <div className="sk-settings-row is-vertical">
          <div className="sk-settings-row-text">
            <span className="sk-settings-row-label">{t('security.keyLabel')}</span>
            <span className="sk-settings-row-desc">{t('security.keyDesc')}</span>
          </div>
          <div className="sk-settings-row-control">
            {phrase ? (
              <div className="sk-recovery-phrase">
                <ol data-phrase-words={phrase.length}>
                  {phrase.map((word, index) => <li key={`${word}-${index}`}><em>{index + 1}</em>{word}</li>)}
                </ol>
                <CopyButton actionId="security.copy-phrase" text={phrase.join(' ')}
                  label={t('security.copyPhrase')} copiedLabel={t('account.copied')} />
              </div>
            ) : (
              <Button actionId="security.generate" emphasis="secondary" leading={<KeyRound size={14} />}
                label={t('security.generate')} execution={generating ? 'pending' : 'idle'} onActivate={generate} />
            )}
          </div>
        </div>
        {/* Forward path only: create-backup stays the ink primary action next
            to the key it acts on. Restore is the separate reverse entry in the
            section header, not a sibling posing as the same flow. */}
        <div className="sk-recovery-actions">
          <Button actionId="security.backup-create" emphasis="primary" leading={<Upload size={14} />}
            label={t('security.createBackup')} execution={creating ? 'pending' : 'idle'}
            availability={!phrase || creating
              ? { kind: 'disabled', reason: phrase ? t('security.creating') : t('security.generateFirst') }
              : undefined}
            onActivate={createBackup} />
        </div>
      </SettingsSection>

      <Dialog open={restoreOpen} onDismiss={() => setRestoreOpen(false)} title={t('security.dialogTitle')}
        width={460} closeLabel={t('common.close')}
        footer={
          <>
            <Button actionId="security.restore-cancel" emphasis="quiet" label={t('common.cancel')}
              onActivate={() => setRestoreOpen(false)} />
            <Button actionId="security.restore-confirm" emphasis="primary" label={t('security.restoreConfirm')}
              execution={restoring ? 'pending' : 'idle'}
              availability={phraseInput.trim().split(/\s+/).length < 24
                ? { kind: 'disabled', reason: t('security.need24') }
                : undefined}
              onActivate={confirmRestore} />
          </>
        }>
        <TextArea framing="embedded" aria-label={t('security.inputAria')} minimumRows={5}
          className="sk-restore-input" placeholder={t('security.inputPlaceholder')}
          value={phraseInput} onValueChange={setPhraseInput} data-restore-value={phraseInput} />
      </Dialog>
    </>
  );
}

/* ── Appearance & Language (desktop AppearanceSection + user-requested
   bubble-alignment habit) ─────────────────────────────────────────────── */

export function AppearanceSection() {
  const { t, prefs } = useGeneralPrefs();
  return (
    <ListSection inset title={t('appearance.title')}>
      <ListRow label={t('appearance.theme')} description={t('appearance.themeDesc')}
        control={<Segmented<ThemeMode>
          label={t('appearance.theme')}
          options={[
            { value: 'system', label: t('appearance.theme.system') },
            { value: 'light', label: t('appearance.theme.light') },
            { value: 'dark', label: t('appearance.theme.dark') },
          ]}
          value={prefs.theme}
          onValueChange={value => setPrefs({ theme: value ?? 'system' })} />} />
      <ListRow label={t('appearance.density')} description={t('appearance.densityDesc')}
        control={<Segmented<DensityMode>
          label={t('appearance.density')}
          options={[
            { value: 'comfortable', label: t('appearance.density.comfortable') },
            { value: 'compact', label: t('appearance.density.compact') },
          ]}
          value={prefs.density}
          onValueChange={value => setPrefs({ density: value ?? 'comfortable' })} />} />
      <ListRow label={t('settings.messageLayout')} description={t('settings.messageLayoutHint')}
        control={<Segmented
          label={t('settings.messageLayout')}
          options={[
            { value: 'sides', label: t('settings.messageLayoutSides') },
            { value: 'left', label: t('settings.messageLayoutLeft') },
          ]}
          value={prefs.messageLayout}
          onValueChange={value => setPrefs({ messageLayout: (value ?? 'sides') as 'sides' | 'left' })} />} />
      {prefs.messageLayout === 'sides' && (
        <ListRow label={t('settings.hideOwnAvatar')} description={t('settings.hideOwnAvatarHint')}
          control={<Switch checked={prefs.hideOwnAvatarInSides} aria-label={t('settings.hideOwnAvatar')}
            data-hide-own-avatar-switch
            onCheckedChange={value => setPrefs({ hideOwnAvatarInSides: value })} />} />
      )}
      <ListRow label={t('settings.language')} description={t('settings.languageHint')}
        control={<Select<'zh-CN' | 'en'> appearance="ghost" aria-label={t('settings.language')}
          options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]}
          value={prefs.locale}
          onValueChange={value => setPrefs({ locale: (Array.isArray(value) ? value[0] : value) ?? 'zh-CN' })} />} />
    </ListSection>
  );
}

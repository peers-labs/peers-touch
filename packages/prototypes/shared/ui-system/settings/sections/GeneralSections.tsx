/**
 * General-group sections (desktop Settings.tsx parity):
 * Notifications, Privacy & Security, Appearance & Language.
 *
 * Toggles/segmented choices persist through the shared prefs module so chat
 * and settings observe the same values; PIN auto-lock minutes stay local.
 */
import { useState } from 'react';
import { Bell, CheckCircle2, Eye, KeyRound, Lock, ShieldAlert, SlidersHorizontal, Upload } from 'lucide-react';
import { Alert, Button, CopyButton, Dialog, Select, Segmented, Switch, TextArea } from '@peers-touch/ui';
import {
  makeTranslate, setPrefs, usePrefs,
  type DensityMode, type NotificationPrefs, type Prefs, type ThemeMode, type Translate,
} from '../../prefs';
import { SettingsRow, SettingsSection } from '../SettingsPrimitives';
import '../settings.css';

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
      <SettingsSection icon={Bell} title={t('settings.notifyWhat')} subtitle={t('settings.notifyWhatSubtitle')}>
        {rows.map(row => (
          <SettingsRow key={row.key} label={row.label} description={row.desc}>
            <Switch checked={prefs.notifications[row.key]} aria-label={row.label}
              data-notify={row.key} onCheckedChange={() => flip(row.key)} />
          </SettingsRow>
        ))}
      </SettingsSection>
      <SettingsSection icon={Bell} title={t('settings.notifyDelivery')} subtitle={t('settings.notifyDeliverySubtitle')}>
        <SettingsRow label={t('settings.n.inApp')} description={t('settings.n.inAppDesc')}>
          <Switch checked={prefs.notifications.inApp} aria-label={t('settings.n.inApp')}
            data-notify="inApp" onCheckedChange={() => flip('inApp')} />
        </SettingsRow>
        <SettingsRow label={t('settings.n.sound')} description={t('settings.n.soundDesc')}>
          <Switch checked={prefs.notifications.sound} aria-label={t('settings.n.sound')}
            data-notify="sound" onCheckedChange={() => flip('sound')} />
        </SettingsRow>
      </SettingsSection>
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
      <SettingsSection icon={Lock} title={t('privacy.appAccess')} subtitle={t('privacy.appAccessDesc')}>
        <SettingsRow label={t('privacy.pinLock')} description={t('privacy.pinLockDesc')}>
          <Switch checked={privacy.pinLock} aria-label={t('privacy.pinLock')}
            data-privacy="pinLock" onCheckedChange={() => flip('pinLock')} />
        </SettingsRow>
        {privacy.pinLock && (
          <div className="sk-inline-actions">
            <Button actionId="privacy.change-pin" emphasis="quiet" density="compact"
              label={t('privacy.changePin')} />
            <Button actionId="privacy.remove-pin" emphasis="quiet" density="compact" tone="danger"
              label={t('privacy.removePin')} onActivate={() => flip('pinLock')} />
          </div>
        )}
        <SettingsRow label={t('privacy.autoLock')} description={t('privacy.autoLockDesc')}>
          <Select<'1m' | '5m' | '15m' | 'never'> aria-label={t('privacy.autoLock')}
            value={autoLock as '1m' | '5m' | '15m' | 'never'}
            onValueChange={value => setAutoLock((Array.isArray(value) ? value[0] : value) ?? '5m')}
            options={[
              { value: '1m', label: t('privacy.lock.1m') },
              { value: '5m', label: t('privacy.lock.5m') },
              { value: '15m', label: t('privacy.lock.15m') },
              { value: 'never', label: t('privacy.lock.never') },
            ]} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection icon={Eye} title={t('privacy.visibility')} subtitle={t('privacy.visibilityDesc')}>
        <SettingsRow label={t('privacy.online')} description={t('privacy.onlineDesc')}>
          <Switch checked={privacy.onlineVisible} aria-label={t('privacy.online')}
            data-privacy="online" onCheckedChange={() => flip('onlineVisible')} />
        </SettingsRow>
        <SettingsRow label={t('privacy.readReceipts')} description={t('privacy.readReceiptsDesc')}>
          <Switch checked={privacy.readReceipts} aria-label={t('privacy.readReceipts')}
            data-privacy="readReceipts" onCheckedChange={() => flip('readReceipts')} />
        </SettingsRow>
      </SettingsSection>

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
      <SettingsSection icon={ShieldAlert} title={t('security.title')} subtitle={t('security.subtitle')}>
        <div className="sk-recovery-status">
          <span className="sk-recovery-head">
            {backupExists
              ? <CheckCircle2 size={16} className="is-ok" />
              : <ShieldAlert size={16} className="is-warn" />}
            <strong>{t('security.backupStatus')}</strong>
          </span>
          {backupExists
            ? <span className="sk-recovery-meta">{t('security.lastBackup', { time: lastBackup })}</span>
            : <Alert tone="warning" title={t('security.noBackupTitle')} description={t('security.noBackupDesc')} />}
          {restored && <Alert tone="success" title={t('security.restoredTitle')} description={t('security.restoredDesc')} />}
        </div>
        <SettingsRow label={t('security.keyLabel')} description={t('security.keyDesc')} vertical>
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
        </SettingsRow>
        <div className="sk-recovery-actions">
          <Button actionId="security.backup-create" emphasis="primary" leading={<Upload size={14} />}
            label={t('security.createBackup')} execution={creating ? 'pending' : 'idle'}
            availability={!phrase || creating
              ? { kind: 'disabled', reason: phrase ? t('security.creating') : t('security.generateFirst') }
              : undefined}
            onActivate={createBackup} />
          <Button actionId="security.restore-open" emphasis="secondary" label={t('security.restoreOpen')}
            onActivate={() => { setRestored(false); setRestoreOpen(true); }} />
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
    <SettingsSection icon={SlidersHorizontal} title={t('appearance.title')} subtitle={t('appearance.subtitle')}>
      <SettingsRow label={t('appearance.theme')} description={t('appearance.themeDesc')}>
        <Segmented<ThemeMode>
          label={t('appearance.theme')}
          options={[
            { value: 'system', label: t('appearance.theme.system') },
            { value: 'light', label: t('appearance.theme.light') },
            { value: 'dark', label: t('appearance.theme.dark') },
          ]}
          value={prefs.theme}
          onValueChange={value => setPrefs({ theme: value ?? 'system' })} />
      </SettingsRow>
      <SettingsRow label={t('appearance.density')} description={t('appearance.densityDesc')}>
        <Segmented<DensityMode>
          label={t('appearance.density')}
          options={[
            { value: 'comfortable', label: t('appearance.density.comfortable') },
            { value: 'compact', label: t('appearance.density.compact') },
          ]}
          value={prefs.density}
          onValueChange={value => setPrefs({ density: value ?? 'comfortable' })} />
      </SettingsRow>
      <SettingsRow label={t('settings.messageLayout')} description={t('settings.messageLayoutHint')}>
        <Segmented
          label={t('settings.messageLayout')}
          options={[
            { value: 'sides', label: t('settings.messageLayoutSides') },
            { value: 'left', label: t('settings.messageLayoutLeft') },
          ]}
          value={prefs.messageLayout}
          onValueChange={value => setPrefs({ messageLayout: (value ?? 'sides') as 'sides' | 'left' })} />
      </SettingsRow>
      {prefs.messageLayout === 'sides' && (
        <SettingsRow className="sk-settings-subrow"
          label={t('settings.hideOwnAvatar')} description={t('settings.hideOwnAvatarHint')}>
          <Switch checked={prefs.hideOwnAvatarInSides} aria-label={t('settings.hideOwnAvatar')}
            data-hide-own-avatar-switch
            onCheckedChange={value => setPrefs({ hideOwnAvatarInSides: value })} />
        </SettingsRow>
      )}
      <SettingsRow label={t('settings.language')} description={t('settings.languageHint')}>
        <Select<'zh-CN' | 'en'> aria-label={t('settings.language')}
          options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]}
          value={prefs.locale}
          onValueChange={value => setPrefs({ locale: (Array.isArray(value) ? value[0] : value) ?? 'zh-CN' })} />
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * SecuritySection — prototype counterpart of desktop RecoverySettings.
 * Local-only recovery state: backup status card, recovery-phrase generation
 * with copy, create-backup gating, and a restore confirmation dialog.
 */
import { useState } from 'react';
import { CheckCircle2, KeyRound, ShieldAlert, Upload } from 'lucide-react';
import { Alert, Button, CopyButton, Dialog, TextArea } from '@peers-touch/ui';
import { SettingsItemCard, SettingsRow, SettingsSection } from '../SettingsPrimitives';
import { locTag, useT } from '../../prefs';
import '../settings.css';

const WORD_POOL = [
  'river', 'maple', 'mint', 'harbor', 'lantern', 'bridge', 'cedar', 'atlas',
  'meadow', 'quartz', 'willow', 'anchor', 'ember', 'garden', 'compass', 'linden',
  'osprey', 'pebble', 'summit', 'creek', 'bicycle', 'shelf', 'paper', 'fennel',
];

function generatePhrase(): string[] {
  return Array.from({ length: 24 }, () => WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]);
}

export function SecuritySection() {
  const { t, locale } = useT();
  const [phrase, setPhrase] = useState<string[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [backupExists, setBackupExists] = useState(false);
  const [creating, setCreating] = useState(false);
  const [lastBackup, setLastBackup] = useState<string>('');
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');

  const generate = () => {
    setGenerating(true);
    window.setTimeout(() => {
      setPhrase(generatePhrase());
      setGenerating(false);
    }, 500);
  };

  const createBackup = () => {
    if (!phrase) return;
    setCreating(true);
    window.setTimeout(() => {
      setCreating(false);
      setBackupExists(true);
      setRestored(false);
      setLastBackup(new Date().toLocaleString(locTag(locale), {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }));
    }, 600);
  };

  const confirmRestore = () => {
    setRestoring(true);
    window.setTimeout(() => {
      setRestoring(false);
      setRestoreOpen(false);
      setRestored(true);
      setPhraseInput('');
    }, 700);
  };

  return (
    <>
      <SettingsSection title={t('security.title')} subtitle={t('security.subtitle')}>
        <SettingsItemCard>
          <div className="sk-recovery-status">
            <span className="sk-recovery-head">
              {backupExists
                ? <CheckCircle2 size={16} className="is-ok" aria-hidden="true" />
                : <ShieldAlert size={16} className="is-warn" aria-hidden="true" />}
              <strong>{t('security.backupStatus')}</strong>
            </span>
            {backupExists
              ? <span className="sk-recovery-meta">{t('security.lastBackup', { time: lastBackup })}</span>
              : <Alert tone="warning" title={t('security.noBackupTitle')} description={t('security.noBackupDesc')} />}
            {restored && <Alert tone="success" title={t('security.restoredTitle')} description={t('security.restoredDesc')} />}
          </div>
        </SettingsItemCard>

        <SettingsItemCard>
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
        </SettingsItemCard>

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

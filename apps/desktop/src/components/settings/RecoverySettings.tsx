import { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  Icon,
  Spin,
  Tag,
  Text,
  TextArea,
  Tooltip,
} from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';

import { SettingsContainer, SettingsRow, SettingsSection } from './SettingsLayout';
import { messagingRecoveryService } from '../../services/messaging-recovery-service';
import { useMessagingRecoveryStore } from '../../store/messagingRecovery';
import { useSessionStore } from '../../store/session';
import { log } from '../../utils/logger';
import { notifyError, notifySuccess } from '../../ui/feedback';

// ---------------------------------------------------------------------------
// Recovery Phrase Display
// ---------------------------------------------------------------------------

function RecoveryPhraseDisplay({
  words,
  onCopy,
  t,
}: {
  words: string[];
  onCopy: () => void;
  t: (key: string) => string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="sc-recovery-phrase">
      <div className="sc-recovery-phrase__head">
        <Text strong style={{ fontSize: 13 }}>
          {t('provider.account.recovery.phraseLabel')}
        </Text>
        <span className="sc-recovery-phrase__actions">
          <Button
            actionId="recovery-reveal"
            data-recovery-reveal
            density="compact"
            leading={<Icon iconId={visible ? 'eye-off' : 'eye'} size={14} />}
            label={visible
              ? t('provider.account.recovery.hide')
              : t('provider.account.recovery.reveal')}
            onActivate={() => setVisible(!visible)}
          />
          <Button
            actionId="recovery-copy-phrase"
            density="compact"
            leading={<Icon iconId="copy" size={14} />}
            label={t('provider.account.recovery.copy')}
            onActivate={onCopy}
          />
        </span>
      </div>

      {visible ? (
        <div className="sc-recovery-phrase__grid" data-recovery-phrase>
          {words.map((word, index) => (
            <span className="sc-recovery-phrase__word" key={index}>
              <Text tone="muted" className="sc-recovery-phrase__index">
                {index + 1}.
              </Text>
              <Text className="sc-recovery-phrase__word-text">{word}</Text>
            </span>
          ))}
        </div>
      ) : (
        <div className="sc-recovery-phrase__hidden">
          <Text tone="secondary" style={{ fontSize: 13 }}>
            {t('provider.account.recovery.hiddenMessage')}
          </Text>
        </div>
      )}

      <Alert
        tone="warning"
        icon={<Icon iconId="warning" size={16} />}
        title={t('provider.account.recovery.phraseWarning')}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Restore Flow Modal
// ---------------------------------------------------------------------------

function RestoreModal({
  open,
  onClose,
  onRestore,
  restoring,
  t,
}: {
  open: boolean;
  onClose: () => void;
  onRestore: (words: string[]) => void;
  restoring: boolean;
  t: (key: string) => string;
}) {
  const [inputValue, setInputValue] = useState('');

  const handleRestore = useCallback(() => {
    const words = inputValue
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (words.length !== 24) {
      notifyError(t('provider.account.recovery.restoreWordCountError'));
      return;
    }
    onRestore(words);
  }, [inputValue, onRestore, t]);

  const wordCount = inputValue.trim().split(/\s+/).filter(Boolean).length;

  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      title={t('provider.account.recovery.restoreTitle')}
      width={560}
      closeLabel={t('provider.account.recovery.cancel')}
      footer={
        <>
          <Button
            actionId="recovery-restore-cancel"
            label={t('provider.account.recovery.cancel')}
            availability={restoring
              ? { kind: 'disabled', reason: t('provider.account.recovery.cancel') }
              : undefined}
            onActivate={onClose}
          />
          <Button
            actionId="recovery-restore-submit"
            data-recovery-restore-submit
            emphasis="primary"
            execution={restoring ? 'pending' : 'idle'}
            label={t('provider.account.recovery.restoreButton')}
            availability={wordCount !== 24 || restoring
              ? { kind: 'disabled', reason: t('provider.account.recovery.restoreButton') }
              : undefined}
            onActivate={handleRestore}
          />
        </>
      }
    >
      <div className="sc-recovery-restore">
        <Text tone="secondary">
          {t('provider.account.recovery.restoreDescription')}
        </Text>

        <div className="sc-recovery-restore__field">
          <div className="sc-recovery-restore__field-head">
            <Text strong style={{ fontSize: 13 }}>
              {t('provider.account.recovery.enterPhrase')}
            </Text>
            <Tag tone={wordCount === 24 ? 'success' : 'neutral'}>
              {wordCount}/24
            </Tag>
          </div>
          <TextArea
            data-recovery-restore-input
            value={inputValue}
            onValueChange={setInputValue}
            rows={4}
            placeholder={t('provider.account.recovery.restorePlaceholder')}
            className="sc-recovery-restore__input"
            disabled={restoring}
          />
        </div>

        <Alert
          tone="info"
          title={t('provider.account.recovery.restoreInfoMessage')}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function RecoverySettings() {
  const actorPtid = useSessionStore((s) =>
    s.authenticated ? s.currentUser?.actorPtid ?? null : null);
  return actorPtid ? <AuthenticatedRecoverySettings key={actorPtid} /> : null;
}

function AuthenticatedRecoverySettings() {
  const { t } = useTranslation('provider');

  const identity = useMessagingRecoveryStore((s) => s.identity);
  const backupExists = useMessagingRecoveryStore((s) => s.exists);
  const latestRevision = useMessagingRecoveryStore((s) => s.latest);
  const creating = useMessagingRecoveryStore((s) => s.creating);
  const restoring = useMessagingRecoveryStore((s) => s.restoring);
  const loading = useMessagingRecoveryStore((s) => s.loading);
  const error = useMessagingRecoveryStore((s) => s.error);
  const refresh = useMessagingRecoveryStore((s) => s.refresh);
  const createRevision = useMessagingRecoveryStore((s) => s.createRevision);
  const restoreLatest = useMessagingRecoveryStore((s) => s.restoreLatest);

  const [recoveryWords, setRecoveryWords] = useState<string[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const busy = loading || creating || restoring;

  const handleGenerateRecoverySecret = async () => {
    setGenerating(true);
    try {
      const result = await messagingRecoveryService.generatePhrase();
      setRecoveryWords(result.words);
    } catch (err) {
      log.error('RecoverySettings', 'failed to generate recovery secret', { err });
      notifyError(t('provider.account.recovery.generateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateBackup = async () => {
    if (!recoveryWords || recoveryWords.length !== 24) {
      notifyError(t('provider.account.recovery.noRecoveryKey'));
      return;
    }

    try {
      await createRevision(recoveryWords.join(' '));
      notifySuccess(t('provider.account.recovery.backupCreated'));
    } catch (err) {
      log.error('RecoverySettings', 'backup creation failed', { err });
      notifyError(t('provider.account.recovery.backupFailed'));
    }
  };

  const handleRestore = async (words: string[]) => {
    try {
      const result = await restoreLatest(words.join(' '));
      notifySuccess(
        t('provider.account.recovery.restoreSuccess', {
          count: result.messageCount,
        }),
      );
      setRestoreOpen(false);
    } catch (err) {
      log.error('RecoverySettings', 'restore failed', { err });
      notifyError(t('provider.account.recovery.restoreFailed'));
    }
  };

  const handleCopyPhrase = () => {
    if (!recoveryWords) return;
    const phrase = recoveryWords.join(' ');
    navigator.clipboard.writeText(phrase).then(
      () => notifySuccess(t('provider.account.recovery.copied')),
      () => notifyError(t('provider.account.recovery.copyFailed')),
    );
  };

  const formatBackupTime = (unixMs: number): string => {
    if (unixMs <= 0) return '—';
    return new Date(unixMs).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <SettingsContainer>
      <SettingsSection
        icon={<Icon iconId="shield" size={18} />}
        title={t('provider.account.recovery.title')}
        subtitle={t('provider.account.recovery.subtitle')}
      >
        {!identity?.ready && !loading && !error && (
          <Text tone="secondary">
            {t('provider.account.recovery.notInitialized')}
          </Text>
        )}
        {/* Backup Status */}
        <div className="sc-recovery-status">
            <div className="sc-recovery-status__head">
              <span className="sc-recovery-status__title">
                {backupExists ? (
                  <Icon iconId="circle-check-big" size={16} className="sc-recovery-status__ok" />
                ) : loading || error ? (
                  <Icon iconId="shield" size={16} className="sc-recovery-status__idle" />
                ) : (
                  <Icon iconId="warning" size={16} className="sc-recovery-status__warn" />
                )}
                <Text strong style={{ fontSize: 13 }}>
                  {t('provider.account.recovery.backupStatus')}
                </Text>
              </span>
              {busy && <Spin size="small" />}
            </div>

            {error ? (
              <div className="sc-recovery-status__error">
                <Alert tone="danger" title={t('provider.account.recovery.statusFailed')} />
                <Button
                  actionId="recovery-status-retry"
                  leading={<Icon iconId="refresh-cw" size={14} />}
                  execution={loading ? 'pending' : 'idle'}
                  label={t('common:common.action.retry')}
                  onActivate={() => {
                    void refresh().catch((err) => {
                      log.warn('RecoverySettings', 'status retry failed', { err });
                    });
                  }}
                />
              </div>
            ) : loading ? (
              <Text tone="secondary">{t('common:common.state.loading')}</Text>
            ) : backupExists ? (
              <Text tone="secondary" style={{ fontSize: 12 }}>
                {t('provider.account.recovery.lastBackup', {
                  time: formatBackupTime(latestRevision?.createdAtUnixMs ?? 0),
                })}
              </Text>
            ) : identity?.ready ? (
              <Alert
                tone="warning"
                icon={<Icon iconId="warning" size={14} />}
                title={t('provider.account.recovery.noBackupWarning')}
              />
            ) : null}
          </div>

        {/* Recovery Phrase Generation */}
        {identity?.ready && (
          <SettingsRow
            label={t('provider.account.recovery.recoveryKey')}
            description={t('provider.account.recovery.recoveryKeyDesc')}
            vertical
          >
            {recoveryWords ? (
              <RecoveryPhraseDisplay
                words={recoveryWords}
                onCopy={handleCopyPhrase}
                t={t}
              />
            ) : (
              <Button
                actionId="recovery-generate"
                data-recovery-generate
                leading={<Icon iconId="key-round" size={14} />}
                execution={generating ? 'pending' : 'idle'}
                label={t('provider.account.recovery.generateKey')}
                availability={busy
                  ? { kind: 'disabled', reason: t('provider.account.recovery.generateKey') }
                  : undefined}
                onActivate={() => void handleGenerateRecoverySecret()}
              />
            )}
          </SettingsRow>
        )}

        {/* Actions */}
        <div className="sc-recovery-actions">
          {identity?.ready && (
            <Tooltip
              label={
                !recoveryWords
                  ? t('provider.account.recovery.generateFirstTooltip')
                  : ''
              }
            >
              <Button
                actionId="recovery-backup-create"
                data-recovery-backup-create
                emphasis="primary"
                leading={<Icon iconId="upload" size={14} />}
                execution={creating ? 'pending' : 'idle'}
                label={t('provider.account.recovery.createBackup')}
                availability={(!recoveryWords || busy)
                  ? { kind: 'disabled', reason: t('provider.account.recovery.createBackup') }
                  : undefined}
                onActivate={() => void handleCreateBackup()}
              />
            </Tooltip>
          )}

          <Button
            actionId="recovery-restore-open"
            data-recovery-restore-open
            leading={<Icon iconId="download" size={14} />}
            label={t('provider.account.recovery.restoreFromBackup')}
            availability={(!backupExists || busy)
              ? { kind: 'disabled', reason: t('provider.account.recovery.restoreFromBackup') }
              : undefined}
            onActivate={() => setRestoreOpen(true)}
          />
        </div>
      <RestoreModal
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        onRestore={handleRestore}
        restoring={restoring}
        t={t}
      />
    </SettingsSection>
    </SettingsContainer>
  );
}

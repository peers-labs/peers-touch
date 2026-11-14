import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Icon, TextArea } from '@peers-touch/ui';

import { identityRuntime } from '../../kernel/identityRuntime';
import { useMessagingRecoveryStore } from '../../store/messagingRecovery';

/**
 * Blocks the messaging-dependent chat surface when the local actor identity
 * failed Station continuity verification (new/reinstalled device). The
 * authenticated HTTP surfaces still work, but without a messaging engine the
 * conversation list and timeline can only mislead as a half-working shell;
 * this gate turns that soft failure into an explicit, actionable state:
 *
 * - a recovery backup exists -> restore with the recovery phrase in place;
 * - no backup -> explain the path and offer sign-out / settings;
 * - transient `inactive`/`unknown` never gates (normal startup window).
 *
 * The gate clears itself once a successful restore flips typed readiness
 * back to `active`; it never relaxes the continuity check itself.
 */
export function MessagingRecoveryGate() {
  const { t } = useTranslation('chat');
  const readiness = useMessagingRecoveryStore((s) => s.readiness);
  const exists = useMessagingRecoveryStore((s) => s.exists);
  const loading = useMessagingRecoveryStore((s) => s.loading);
  const restoring = useMessagingRecoveryStore((s) => s.restoring);
  const storeError = useMessagingRecoveryStore((s) => s.error);
  const refresh = useMessagingRecoveryStore((s) => s.refresh);
  const restoreLatest = useMessagingRecoveryStore((s) => s.restoreLatest);

  const [phrase, setPhrase] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const recoveryRequired = readiness === 'recovery_required';

  const handleRestore = useCallback(async () => {
    const trimmed = phrase.trim();
    if (!trimmed) {
      setLocalError(t('chat.social.recovery.phraseRequired'));
      return;
    }
    setLocalError(null);
    try {
      await restoreLatest(trimmed);
      setPhrase('');
      await refresh();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }, [phrase, refresh, restoreLatest, t]);

  const handleSignOut = useCallback(async () => {
    setLocalError(null);
    try {
      await identityRuntime.logout();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleRetry = useCallback(() => {
    setLocalError(null);
    void refresh();
  }, [refresh]);

  if (!recoveryRequired) return null;

  const errorMessage = localError ?? storeError;

  return (
    <div
      className="sc-recovery"
      data-chat-recovery-gate="true"
      data-chat-recovery-backup={exists ? 'true' : 'false'}
    >
      <div className="sc-recovery__card">
        <div className="sc-recovery__head">
          <span className="sc-recovery__glyph">
            <Icon iconId="key-round" size={20} />
          </span>
          <div>
            <h3 className="sc-recovery__title">{t('chat.social.recovery.title')}</h3>
            <div className="sc-recovery__subtitle">{t('chat.social.recovery.subtitle')}</div>
          </div>
        </div>

        <p className="sc-recovery__desc">
          {exists
            ? t('chat.social.recovery.backupAvailableDescription')
            : t('chat.social.recovery.noBackupDescription')}
        </p>

        {errorMessage && (
          <Alert
            className="sc-recovery__error"
            data-chat-recovery-error="true"
            tone="danger"
            title={errorMessage}
          />
        )}

        {exists && (
          <>
            <TextArea
              className="sc-recovery__phrase"
              data-chat-recovery-phrase="true"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={t('chat.social.recovery.phrasePlaceholder')}
              rows={3}
              minimumRows={3}
              disabled={restoring}
            />
            <Button
              actionId="chat.recovery.restore"
              data-chat-recovery-restore="true"
              emphasis="primary"
              fullWidth
              availability={restoring || !phrase.trim() ? {
                kind: 'disabled',
                reason: t(restoring ? 'chat.social.recovery.restoring' : 'chat.social.recovery.phraseRequired'),
              } : undefined}
              execution={restoring ? 'pending' : 'idle'}
              leading={restoring ? undefined : <Icon iconId="key-round" size={16} />}
              onActivate={handleRestore}
            >
              {restoring ? t('chat.social.recovery.restoring') : t('chat.social.recovery.restore')}
            </Button>
          </>
        )}

        <div className="sc-recovery__footer">
          <Button
            actionId="chat.recovery.retry"
            data-chat-recovery-retry="true"
            emphasis="quiet"
            density="compact"
            availability={restoring ? { kind: 'disabled', reason: t('chat.social.recovery.restoring') } : undefined}
            leading={<Icon iconId="refresh-cw" size={14} className={loading ? 'sc-recovery__spinning' : undefined} />}
            onActivate={handleRetry}
          >
            {t('chat.social.recovery.retry')}
          </Button>
          <Button
            actionId="chat.recovery.signout"
            data-chat-recovery-signout="true"
            emphasis="quiet"
            tone="danger"
            density="compact"
            availability={restoring ? { kind: 'disabled', reason: t('chat.social.recovery.restoring') } : undefined}
            leading={<Icon iconId="log-out" size={14} />}
            onActivate={handleSignOut}
          >
            {t('chat.social.recovery.signOut')}
          </Button>
        </div>
      </div>
    </div>
  );
}

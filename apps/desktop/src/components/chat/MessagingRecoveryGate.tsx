import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Input, Spin, Typography } from 'antd';
import { KeyRound, LogOut, RefreshCw } from 'lucide-react';

import { identityRuntime } from '../../kernel/identityRuntime';
import { useMessagingRecoveryStore } from '../../store/messagingRecovery';

const { Text, Title, Paragraph } = Typography;

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
      data-chat-recovery-gate="true"
      data-chat-recovery-backup={exists ? 'true' : 'false'}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(255, 255, 255, 0.92)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          padding: '28px 28px 24px',
          borderRadius: 16,
          border: '1px solid rgba(0,0,0,0.08)',
          background: '#fff',
          boxShadow: '0 12px 40px rgba(0,0,0,0.10)',
        }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: '#fff2e8',
              color: '#fa8c16',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 auto',
            }}
          >
            <KeyRound size={20} />
          </div>
          <div>
            <Title level={5} style={{ margin: 0 }}>
              {t('chat.social.recovery.title')}
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t('chat.social.recovery.subtitle')}
            </Text>
          </div>
        </div>

        <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
          {exists
            ? t('chat.social.recovery.backupAvailableDescription')
            : t('chat.social.recovery.noBackupDescription')}
        </Paragraph>

        {errorMessage && (
          <Alert
            data-chat-recovery-error="true"
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={errorMessage}
          />
        )}

        {exists && (
          <>
            <Input.TextArea
              data-chat-recovery-phrase="true"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={t('chat.social.recovery.phrasePlaceholder')}
              autoSize={{ minRows: 3, maxRows: 5 }}
              disabled={restoring}
              style={{ marginBottom: 12 }}
            />
            <Button
              data-chat-recovery-restore="true"
              type="primary"
              block
              disabled={restoring || !phrase.trim()}
              onClick={handleRestore}
              icon={restoring ? <Spin size="small" /> : <KeyRound size={16} />}
            >
              {restoring
                ? t('chat.social.recovery.restoring')
                : t('chat.social.recovery.restore')}
            </Button>
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, gap: 8 }}>
          <Button
            data-chat-recovery-retry="true"
            type="text"
            size="small"
            icon={
              <RefreshCw
                size={14}
                style={loading ? { animation: 'spin 1s linear infinite' } : undefined}
              />
            }
            onClick={handleRetry}
            disabled={restoring}
          >
            {t('chat.social.recovery.retry')}
          </Button>
          <Button
            data-chat-recovery-signout="true"
            type="text"
            size="small"
            danger
            icon={<LogOut size={14} />}
            onClick={handleSignOut}
            disabled={restoring}
          >
            {t('chat.social.recovery.signOut')}
          </Button>
        </div>
      </div>
    </div>
  );
}

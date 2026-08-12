import { useCallback, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Tooltip, toast } from '@lobehub/ui';
import {
  Alert,
  Input,
  Modal,
  Spin,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  Download,
  Eye,
  EyeOff,
  Key,
  Shield,
  Upload,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SettingsItemCard, SettingsRow, SettingsSection } from './SettingsLayout';
import { messagingRecoveryService } from '../../services/messaging-recovery-service';
import { useMessagingRecoveryStore } from '../../store/messagingRecovery';
import { log } from '../../utils/logger';

const { Text } = Typography;
const { TextArea } = Input;

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
  const { token } = theme.useToken();
  const [visible, setVisible] = useState(false);

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align="center" justify="space-between">
        <Text strong style={{ fontSize: 13 }}>
          {t('provider.account.recovery.phraseLabel')}
        </Text>
        <Flexbox horizontal gap={8}>
          <Button
            data-recovery-reveal
            size="small"
            icon={visible ? <EyeOff size={14} /> : <Eye size={14} />}
            onClick={() => setVisible(!visible)}
          >
            {visible
              ? t('provider.account.recovery.hide')
              : t('provider.account.recovery.reveal')}
          </Button>
          <Button
            size="small"
            icon={<ClipboardCopy size={14} />}
            onClick={onCopy}
          >
            {t('provider.account.recovery.copy')}
          </Button>
        </Flexbox>
      </Flexbox>

      {visible ? (
        <div
          data-recovery-phrase
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            padding: 16,
            borderRadius: 10,
            background: token.colorFillQuaternary,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {words.map((word, index) => (
            <Flexbox
              key={index}
              horizontal
              align="center"
              gap={6}
              style={{
                padding: '4px 8px',
                borderRadius: 6,
                background: token.colorBgContainer,
                border: `1px solid ${token.colorBorder}`,
              }}
            >
              <Text type="secondary" style={{ fontSize: 11, minWidth: 18 }}>
                {index + 1}.
              </Text>
              <Text style={{ fontSize: 13, fontFamily: 'monospace' }}>
                {word}
              </Text>
            </Flexbox>
          ))}
        </div>
      ) : (
        <Flexbox
          align="center"
          justify="center"
          style={{
            height: 80,
            borderRadius: 10,
            background: token.colorFillQuaternary,
            border: `1px dashed ${token.colorBorder}`,
          }}
        >
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('provider.account.recovery.hiddenMessage')}
          </Text>
        </Flexbox>
      )}

      <Alert
        type="warning"
        showIcon
        icon={<AlertTriangle size={16} />}
        message={t('provider.account.recovery.phraseWarning')}
        style={{ borderRadius: 8 }}
      />
    </Flexbox>
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
      toast.error(t('provider.account.recovery.restoreWordCountError'));
      return;
    }
    onRestore(words);
  }, [inputValue, onRestore, t]);

  const wordCount = inputValue.trim().split(/\s+/).filter(Boolean).length;

  return (
    <Modal
      title={t('provider.account.recovery.restoreTitle')}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={560}
    >
      <Flexbox gap={16} style={{ paddingTop: 8 }}>
        <Text type="secondary">
          {t('provider.account.recovery.restoreDescription')}
        </Text>

        <Flexbox gap={6}>
          <Flexbox horizontal align="center" justify="space-between">
            <Text strong style={{ fontSize: 13 }}>
              {t('provider.account.recovery.enterPhrase')}
            </Text>
            <Tag color={wordCount === 24 ? 'success' : 'default'}>
              {wordCount}/24
            </Tag>
          </Flexbox>
          <TextArea
            data-recovery-restore-input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            rows={4}
            placeholder={t('provider.account.recovery.restorePlaceholder')}
            style={{
              fontFamily: 'monospace',
              fontSize: 13,
              resize: 'vertical',
            }}
            disabled={restoring}
          />
        </Flexbox>

        <Alert
          type="info"
          showIcon
          message={t('provider.account.recovery.restoreInfoMessage')}
          style={{ borderRadius: 8 }}
        />

        <Flexbox horizontal justify="flex-end" gap={8}>
          <Button onClick={onClose} disabled={restoring}>
            {t('provider.account.recovery.cancel')}
          </Button>
          <Button
            data-recovery-restore-submit
            type="primary"
            onClick={handleRestore}
            loading={restoring}
            disabled={wordCount !== 24 || restoring}
          >
            {t('provider.account.recovery.restoreButton')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function RecoverySettings() {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();

  const identity = useMessagingRecoveryStore((s) => s.identity);
  const backupExists = useMessagingRecoveryStore((s) => s.exists);
  const latestRevision = useMessagingRecoveryStore((s) => s.latest);
  const creating = useMessagingRecoveryStore((s) => s.creating);
  const restoring = useMessagingRecoveryStore((s) => s.restoring);
  const createRevision = useMessagingRecoveryStore((s) => s.createRevision);
  const restoreLatest = useMessagingRecoveryStore((s) => s.restoreLatest);

  const [recoveryWords, setRecoveryWords] = useState<string[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const handleGenerateRecoverySecret = async () => {
    setGenerating(true);
    try {
      const result = await messagingRecoveryService.generatePhrase();
      setRecoveryWords(result.words);
    } catch (err) {
      log.error('RecoverySettings', 'failed to generate recovery secret', { err });
      toast.error(t('provider.account.recovery.generateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateBackup = async () => {
    if (!recoveryWords || recoveryWords.length !== 24) {
      toast.error(t('provider.account.recovery.noRecoveryKey'));
      return;
    }

    try {
      await createRevision(recoveryWords.join(' '));
      toast.success(t('provider.account.recovery.backupCreated'));
    } catch (err) {
      log.error('RecoverySettings', 'backup creation failed', { err });
      toast.error(t('provider.account.recovery.backupFailed'));
    }
  };

  const handleRestore = async (words: string[]) => {
    try {
      const result = await restoreLatest(words.join(' '));
      toast.success(
        t('provider.account.recovery.restoreSuccess', {
          count: result.messageCount,
        }),
      );
      setRestoreOpen(false);
    } catch (err) {
      log.error('RecoverySettings', 'restore failed', { err });
      toast.error(t('provider.account.recovery.restoreFailed'));
    }
  };

  const handleCopyPhrase = () => {
    if (!recoveryWords) return;
    const phrase = recoveryWords.join(' ');
    navigator.clipboard.writeText(phrase).then(
      () => toast.success(t('provider.account.recovery.copied')),
      () => toast.error(t('provider.account.recovery.copyFailed')),
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

  if (!identity?.ready) {
    return (
      <SettingsSection
        icon={<Shield size={18} style={{ color: token.colorTextTertiary }} />}
        title={t('provider.account.recovery.title')}
        subtitle={t('provider.account.recovery.subtitle')}
      >
        <Text type="secondary">
          {t('provider.account.recovery.notInitialized')}
        </Text>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      icon={<Shield size={18} style={{ color: token.colorPrimary }} />}
      title={t('provider.account.recovery.title')}
      subtitle={t('provider.account.recovery.subtitle')}
    >
        {/* Backup Status */}
        <SettingsItemCard>
          <Flexbox gap={12}>
            <Flexbox horizontal align="center" justify="space-between">
              <Flexbox horizontal align="center" gap={8}>
                {backupExists ? (
                  <CheckCircle2 size={16} style={{ color: token.colorSuccess }} />
                ) : (
                  <AlertTriangle size={16} style={{ color: token.colorWarning }} />
                )}
                <Text strong style={{ fontSize: 13 }}>
                  {t('provider.account.recovery.backupStatus')}
                </Text>
              </Flexbox>
              {(creating || restoring) && <Spin size="small" />}
            </Flexbox>

            {backupExists ? (
              <Flexbox gap={4}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('provider.account.recovery.lastBackup', {
                    time: formatBackupTime(latestRevision?.createdAtUnixMs ?? 0),
                  })}
                </Text>
              </Flexbox>
            ) : (
              <Alert
                type="warning"
                showIcon
                icon={<AlertTriangle size={14} />}
                message={t('provider.account.recovery.noBackupWarning')}
                style={{ borderRadius: 8 }}
              />
            )}
          </Flexbox>
        </SettingsItemCard>

        {/* Recovery Phrase Generation */}
        <SettingsItemCard>
          <Flexbox gap={12}>
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
                  data-recovery-generate
                  icon={<Key size={14} />}
                  onClick={handleGenerateRecoverySecret}
                  loading={generating}
                >
                  {t('provider.account.recovery.generateKey')}
                </Button>
              )}
            </SettingsRow>
          </Flexbox>
        </SettingsItemCard>

        {/* Actions */}
        <Flexbox horizontal gap={12} style={{ flexWrap: 'wrap' }}>
          <Tooltip
            title={
              !recoveryWords
                ? t('provider.account.recovery.generateFirstTooltip')
                : undefined
            }
          >
            <Button
              data-recovery-backup-create
              icon={<Upload size={14} />}
              type="primary"
              onClick={handleCreateBackup}
              loading={creating}
              disabled={!recoveryWords || creating || restoring}
            >
              {t('provider.account.recovery.createBackup')}
            </Button>
          </Tooltip>

          <Button
            data-recovery-restore-open
            icon={<Download size={14} />}
            onClick={() => setRestoreOpen(true)}
            disabled={creating || restoring}
          >
            {t('provider.account.recovery.restoreFromBackup')}
          </Button>
        </Flexbox>
      <RestoreModal
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        onRestore={handleRestore}
        restoring={restoring}
        t={t}
      />
    </SettingsSection>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Modal, Spin, Typography } from 'antd';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { useMobileI18n } from '../../app/mobileI18n';
import { getMobileLifecycleKernel } from '../../app/lifecycle/MobileLifecycleKernel';
import { MobileNotice } from '../../components/MobileNotice';
import { executeNativeRecovery, MobileRecoveryAction } from '../../services/nativeRecovery';
import { useSettingsRequests } from './useSettingsRequests';

type RecoveryResult = Awaited<ReturnType<typeof executeNativeRecovery>>;

export function RecoverySection({ session }: { session: MobileAuthSession }) {
  const { t } = useMobileI18n();
  const requests = useSettingsRequests(session);
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [completed, setCompleted] = useState<MobileRecoveryAction | null>(null);
  const [restore, setRestore] = useState(false);
  const reload = useCallback(async () => {
    const next = await requests.run(() => executeNativeRecovery(session, MobileRecoveryAction.STATUS));
    if (next) setResult(next);
  }, [session, requests.run]);
  useEffect(() => { void reload(); }, [reload]);
  const run = async (action: MobileRecoveryAction) => {
    setCompleted(null);
    const next = await requests.run(() => executeNativeRecovery(session, action), true);
    if (!next) return;
    setResult(next);
    setCompleted(action);
    if (action === MobileRecoveryAction.RESTORE) {
      await getMobileLifecycleKernel().restartRuntimeGraph('reliability-recovery');
    }
  };
  return <Card className="settings-section" variant="borderless">
    <Typography.Text strong>{t('mobile.settings.security.recovery')}</Typography.Text>
    <Typography.Paragraph type="secondary">{t('mobile.settings.security.recoveryBody')}</Typography.Paragraph>
    {result === null && !requests.error ? <Spin /> : null}
    {requests.error ? <MobileNotice>{t(requests.error)}</MobileNotice> : null}
    {result ? <Typography.Paragraph data-recovery-exists={String(result.exists)}>
      {result.exists
        ? t('mobile.settings.security.backupDate', { date: new Date(Number(result.createdAtUnixMs)).toLocaleString() })
        : t('mobile.settings.security.noBackup')}
    </Typography.Paragraph> : null}
    {completed ? <Typography.Paragraph role="status" data-recovery-completed={completed}>
      {t(completed === MobileRecoveryAction.CREATE
        ? 'mobile.settings.security.backupCreated' : 'mobile.settings.security.backupRestored', {
        messages: String(result?.messageCount ?? 0n),
      })}
    </Typography.Paragraph> : null}
    <div className="settings-security-form">
      <Button type="primary" block loading={requests.busy} data-recovery-action="create"
        onClick={() => void run(MobileRecoveryAction.CREATE)}>{t('mobile.settings.security.createBackup')}</Button>
      <Button block disabled={requests.busy} data-recovery-action="restore"
        onClick={() => setRestore(true)}>{t('mobile.settings.security.restoreBackup')}</Button>
    </div>
    <Modal open={restore} title={t('mobile.settings.security.restoreBackup')}
      okText={t('common.action.confirm')} cancelText={t('common.action.cancel')}
      onCancel={() => setRestore(false)} onOk={() => {
        setRestore(false); void run(MobileRecoveryAction.RESTORE);
      }} destroyOnHidden>{t('mobile.settings.security.restoreBackupBody')}</Modal>
  </Card>;
}

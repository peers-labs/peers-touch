import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Modal } from 'antd';
import { ArrowLeft } from 'lucide-react';
import { useMobileI18n } from '../../app/mobileI18n';
import { registerSettingsExitGuard, type SettingsExitAction } from '../../app/navigation';
import { DirtyBar } from './SettingsSections';

export interface SettingsDraftOwner {
  readonly dirty: boolean;
  readonly conflict: boolean;
  readonly saveStatus: string;
  readonly saveError: string | null;
  save(): Promise<boolean>;
  discard(): void;
  reload(): Promise<void>;
}

export function SettingsExitBoundary({
  title, settingId, owner, onBack, children,
}: {
  title: string;
  settingId: string;
  owner: SettingsDraftOwner | null;
  onBack: () => void;
  children: ReactNode;
}) {
  const { t } = useMobileI18n();
  const [pendingExit, setPendingExit] = useState<{ action: SettingsExitAction } | null>(null);
  const [saving, setSaving] = useState(false);
  const requestExit = useCallback((action: SettingsExitAction) => {
    if (!owner?.dirty && owner?.saveStatus !== 'saving') {
      void action();
      return;
    }
    setPendingExit({ action });
  }, [owner?.dirty, owner?.saveStatus]);
  useEffect(() => registerSettingsExitGuard(requestExit), [requestExit]);
  useEffect(() => {
    if (!pendingExit || saving || owner?.dirty || owner?.saveStatus === 'saving') return;
    const action = pendingExit.action;
    setPendingExit(null);
    void action();
  }, [pendingExit, saving, owner?.dirty, owner?.saveStatus]);

  const finish = async (save: boolean) => {
    if (owner?.saveStatus === 'saving') return;
    setSaving(true);
    try {
      if (save && owner && !(await owner.save())) return;
      if (!save) owner?.discard();
      const action = pendingExit?.action;
      setPendingExit(null);
      await action?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container settings-page mobile-detail-page" data-product-surface={`settings.${settingId}`}>
      <header className="page-header">
        <button type="button" className="header-action" aria-label={t('common.action.back')} onClick={() => requestExit(onBack)}>
          <ArrowLeft size={20} />
        </button>
        <h1 className="header-title compact">{title}</h1>
      </header>
      <div className="settings-detail-body">
        {owner ? <DirtyBar
          dirty={owner.dirty} conflict={owner.conflict}
          saveStatus={owner.saveStatus} saveError={owner.saveError}
          onSave={() => void owner.save()} onDiscard={owner.discard}
          onReload={() => void owner.reload()}
        /> : null}
        {children}
      </div>
      <Modal
        title={t('mobile.settings.exit.title')} open={pendingExit !== null}
        closable={!saving} maskClosable={false} onCancel={() => setPendingExit(null)}
        footer={[
          <Button key="stay" disabled={saving} onClick={() => setPendingExit(null)}>{t('mobile.settings.exit.stay')}</Button>,
          <Button key="discard" danger disabled={saving || owner?.saveStatus === 'saving'} onClick={() => void finish(false)}>{t('mobile.settings.exit.discard')}</Button>,
          <Button key="save" type="primary" loading={saving} disabled={owner?.saveStatus === 'saving'} onClick={() => void finish(true)}>{t('mobile.settings.exit.save')}</Button>,
        ]}
        destroyOnHidden
      >
        <div data-acceptance-id="settings-unsaved-exit" data-product-surface="settings.unsaved-exit">{t('mobile.settings.exit.body')}</div>
      </Modal>
    </div>
  );
}

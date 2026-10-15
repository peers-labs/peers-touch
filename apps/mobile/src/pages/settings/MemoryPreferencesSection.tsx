import { useState } from 'react';
import { Button, Card, InputNumber, Modal, Spin, Switch, Typography } from 'antd';
import { RotateCcw } from 'lucide-react';
import { useMobileI18n } from '../../app/mobileI18n';
import { MobileNotice } from '../../components/MobileNotice';
import type { useMemoryPreferencesController } from './useMemoryPreferencesController';

export function MemoryPreferencesSection({ controller }: {
  readonly controller: ReturnType<typeof useMemoryPreferencesController>;
}) {
  const { t } = useMobileI18n();
  const [resetOpen, setResetOpen] = useState(false);
  const { draft } = controller;
  if (controller.loading) return <Spin />;
  if (!draft) return controller.error ? <MobileNotice>{t(controller.error)}</MobileNotice> : null;
  return <Card className="settings-section" variant="borderless" data-memory-preferences>
    <div className="settings-row">
      <Typography.Text strong>{t('mobile.settings.memory.preferences')}</Typography.Text>
      <Button icon={<RotateCcw size={16} />} disabled={controller.busy}
        data-memory-action="reset" onClick={() => setResetOpen(true)}>{t('mobile.settings.memory.reset')}</Button>
    </div>
    <div className="settings-row">
      <Typography.Text>{t('mobile.settings.memory.enabled')}</Typography.Text>
      <Switch checked={draft.enabled} disabled={controller.busy}
        aria-label={t('mobile.settings.memory.enabled')} data-memory-field="enabled"
        onChange={(enabled) => controller.patch({ enabled })} />
    </div>
    <Typography.Paragraph type="secondary">{t('mobile.settings.memory.enabledHelp')}</Typography.Paragraph>
    <div className="settings-row">
      <Typography.Text>{t('mobile.settings.memory.tuning')}</Typography.Text>
      <Switch checked={draft.tuningEnabled} disabled={controller.busy}
        aria-label={t('mobile.settings.memory.tuning')} data-memory-field="tuning"
        onChange={(tuningEnabled) => controller.patch({ tuningEnabled })} />
    </div>
    <Typography.Paragraph type="secondary">{t('mobile.settings.memory.tuningHelp')}</Typography.Paragraph>
    {(['vectorWeight', 'keywordWeight'] as const).map((field) => <div className="settings-row" key={field}>
      <Typography.Text>{t(`mobile.settings.memory.${field}`)}</Typography.Text>
      <InputNumber min={0} max={1} step={0.05} value={draft[field]} disabled={controller.busy}
        aria-label={t(`mobile.settings.memory.${field}`)} data-memory-field={field}
        onChange={(value) => { if (value !== null) controller.patch({ [field]: value }); }} />
    </div>)}
    <Typography.Paragraph type="secondary">{t('mobile.settings.memory.weightsHelp')}</Typography.Paragraph>
    {controller.error ? <MobileNotice>{t(controller.error)}</MobileNotice> : null}
    <Modal open={resetOpen} title={t('mobile.settings.memory.reset')} okText={t('common.action.confirm')}
      cancelText={t('common.action.cancel')} onCancel={() => setResetOpen(false)} destroyOnHidden
      onOk={() => { controller.reset(); setResetOpen(false); }}>
      {t('mobile.settings.memory.resetConfirm')}
    </Modal>
  </Card>;
}

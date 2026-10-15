import { useState } from 'react';
import { Button, Empty, Input, Modal, Typography } from 'antd';
import { ChevronRight, RefreshCw } from 'lucide-react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { useMobileI18n } from '../../app/mobileI18n';
import { requestSettingsExit } from '../../app/navigation';
import { BoundedList } from '../../components/BoundedList';
import { MobileNotice } from '../../components/MobileNotice';
import { SettingsExitBoundary } from './SettingsExitBoundary';
import { SettingsAgentScope } from './SettingsAgentScope';
import { useMemorySettingsController } from './useMemorySettingsController';
import { useMemoryPreferencesController } from './useMemoryPreferencesController';
import { MemoryPreferencesSection } from './MemoryPreferencesSection';
import './agent-settings.css';

export function MemoryDetail({ session, onBack }: {
  readonly session: MobileAuthSession | null; readonly onBack: () => void;
}) {
  const { t } = useMobileI18n();
  const controller = useMemorySettingsController(session);
  const preferences = useMemoryPreferencesController(controller.gateway, controller.agentId);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = controller.draft !== null;
  return <SettingsExitBoundary title={t('mobile.settings.memory.title')} settingId="memory"
    owner={selected ? controller.owner : preferences.owner} onBack={selected ? () => controller.select(null) : onBack}>
    <SettingsAgentScope agents={controller.agents} agentId={controller.agentId}
      loading={controller.loading} disabled={controller.busy || preferences.busy} onChange={controller.selectAgent} />
    {controller.error ? <MobileNotice>{t(controller.error)}</MobileNotice> : null}
    {!selected ? <>
      <MemoryPreferencesSection controller={preferences} />
      <div className="settings-agent-actions"><Button icon={<RefreshCw size={16} />} loading={controller.loading}
        disabled={controller.busy} onClick={() => void controller.reload()}>{t('common.action.refresh')}</Button>
        <Typography.Text type="secondary">{t('mobile.settings.memory.entryCount', { count: controller.total })}</Typography.Text>
      </div>
      {controller.embedding ? <div className="settings-row">
        <Typography.Text>{t('mobile.settings.memory.embedding')}</Typography.Text>
        <Typography.Text type="secondary">{controller.embedding.model || t('mobile.settings.memory.embeddingNone')}</Typography.Text>
      </div> : null}
      {!controller.loading && !controller.entries.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('mobile.settings.memory.empty')} /> : null}
      <BoundedList surfaceKey={`settings:memory:${controller.agentId}`} items={controller.entries}
        itemKey={(entry) => entry.memoryId} size={40}>
        {(items) => items.map((entry) => <button type="button" key={entry.memoryId}
          className="setting-row settings-agent-provider" data-memory-id={entry.memoryId}
          onClick={() => requestSettingsExit(() => controller.select(entry.memoryId))}>
          <span className="settings-agent-copy"><Typography.Text>{entry.summary || entry.content}</Typography.Text>
            <Typography.Text type="secondary">{t(`mobile.settings.memory.layer.${entry.layer}`)}</Typography.Text></span>
          <ChevronRight size={18} />
        </button>)}
      </BoundedList>
      {controller.hasMore ? <Button block loading={controller.loading} disabled={controller.busy}
        onClick={() => void controller.loadMore()}>{t('common.action.loadMore')}</Button> : null}
    </> : <section className="settings-agent-editor" data-memory-editor={controller.selectedId}>
      <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.memory.content')}</Typography.Text>
        <Input.TextArea value={controller.draft ?? ''} disabled={controller.busy}
          data-memory-field="content" autoSize={{ minRows: 6, maxRows: 20 }}
          onChange={(event) => controller.patch(event.target.value)} /></label>
      <Button block danger disabled={controller.busy || controller.owner.dirty}
        onClick={() => setConfirmDelete(true)}>{t('common.action.delete')}</Button>
    </section>}
    <Modal open={confirmDelete} title={t('common.action.delete')} okText={t('common.action.delete')}
      okButtonProps={{ danger: true }} cancelText={t('common.action.cancel')} confirmLoading={controller.busy}
      onOk={() => void controller.remove().then((removed) => { if (removed) setConfirmDelete(false); })}
      onCancel={() => { if (!controller.busy) setConfirmDelete(false); }} destroyOnHidden>
      {t('mobile.settings.memory.deleteConfirm')}
    </Modal>
  </SettingsExitBoundary>;
}

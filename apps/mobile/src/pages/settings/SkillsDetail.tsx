import { useRef, useState } from 'react';
import { Button, Empty, Input, Modal, Segmented, Spin, Switch, Typography } from 'antd';
import { ChevronRight, Plus, RefreshCw, Upload } from 'lucide-react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { requestSettingsExit } from '../../app/navigation';
import { useMobileI18n } from '../../app/mobileI18n';
import { BoundedList } from '../../components/BoundedList';
import { MobileNotice } from '../../components/MobileNotice';
import { MobileSearchField } from '../../components/MobileSearchField';
import { SettingsExitBoundary } from './SettingsExitBoundary';
import { SettingsAgentScope } from './SettingsAgentScope';
import { useSkillSettingsController } from './useSkillSettingsController';
import './agent-settings.css';

export function SkillsDetail({ session, onBack }: {
  readonly session: MobileAuthSession | null; readonly onBack: () => void;
}) {
  const { t } = useMobileI18n();
  const controller = useSkillSettingsController(session);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const entries = controller.skills.filter((entry) => (
    `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (filter === 'all' || (filter === 'enabled' ? entry.enabled : !entry.enabled))
  ));
  const draft = controller.draft;
  const startUpload = () => requestSettingsExit(() => { controller.select(''); upload.current?.click(); });
  const importFile = async (file: File) => {
    if (file.size > 128 * 1024) { setUploadError(true); return; }
    try {
      const content = await file.text();
      controller.patch({ name: file.name.replace(/\.md$/i, ''), content });
      setUploadError(false);
    } catch { setUploadError(true); }
  };
  return <SettingsExitBoundary title={t('mobile.settings.skills.title')} settingId="skills"
    owner={controller.owner} onBack={controller.selectedId !== null ? () => { void controller.select(null); } : onBack}>
    <SettingsAgentScope agents={controller.agents} agentId={controller.agentId}
      loading={controller.loading} disabled={controller.busy} onChange={controller.selectAgent} />
    {controller.error ? <MobileNotice>{t(controller.error)}</MobileNotice> : null}
    {uploadError ? <MobileNotice>{t('mobile.settings.skills.uploadFailed')}</MobileNotice> : null}
    <input ref={upload} type="file" accept=".md,text/markdown,text/plain" className="settings-file-input"
      aria-label={t('mobile.settings.skills.upload')} onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void importFile(file);
        event.target.value = '';
      }} />
    {controller.selectedId === null ? <>
      <div className="settings-agent-actions">
        <Button icon={<RefreshCw size={16} />} loading={controller.loading} disabled={controller.busy}
          onClick={() => void controller.reload()}>{t('common.action.refresh')}</Button>
        <Button icon={<Plus size={16} />} disabled={controller.busy || !controller.agentId}
          onClick={() => controller.select('')}>{t('mobile.settings.skills.create')}</Button>
        <Button icon={<Upload size={16} />} disabled={controller.busy || !controller.agentId}
          onClick={startUpload}>{t('mobile.settings.skills.upload')}</Button>
      </div>
      <MobileSearchField query={query} onChange={setQuery} onSearch={setQuery}
        placeholder={t('mobile.settings.skills.search')} loading={controller.loading} />
      <Segmented block value={filter} onChange={(value) => setFilter(String(value))}
        options={['all', 'enabled', 'disabled'].map((value) => ({
          value, label: t(`mobile.settings.skills.filter.${value}`),
        }))} />
      {!controller.loading && !entries.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('mobile.settings.skills.empty')} /> : null}
      <BoundedList surfaceKey={`settings:skills:${controller.agentId}:${query}:${filter}`}
        items={entries} itemKey={(entry) => entry.skillId} size={40}>
        {(items) => items.map((entry) => <div className="settings-row" key={entry.skillId} data-skill-id={entry.skillId}>
          <button type="button" className="settings-agent-item-trigger" onClick={() => controller.select(entry.skillId)}>
            <span className="settings-agent-copy"><Typography.Text strong>{entry.name}</Typography.Text>
              <Typography.Text type="secondary">{entry.description}</Typography.Text></span>
            <ChevronRight size={18} />
          </button>
          <Switch checked={entry.enabled} disabled={controller.busy} aria-label={entry.name}
            onChange={() => void controller.toggle(entry)} />
        </div>)}
      </BoundedList>
    </> : draft ? <section className="settings-agent-editor" data-skill-editor={controller.selectedId || 'new'}>
      <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.skills.name')}</Typography.Text>
        <Input value={draft.name} disabled={controller.busy} data-skill-field="name"
          onChange={(event) => controller.patch({ name: event.target.value })} /></label>
      <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.skills.description')}</Typography.Text>
        <Input value={draft.description} disabled={controller.busy} data-skill-field="description"
          onChange={(event) => controller.patch({ description: event.target.value })} /></label>
      <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.skills.content')}</Typography.Text>
        <Input.TextArea value={draft.content} disabled={controller.busy} autoSize={{ minRows: 8, maxRows: 20 }}
          data-skill-field="content" onChange={(event) => controller.patch({ content: event.target.value })} /></label>
      <div className="settings-row"><Typography.Text>{t('common.action.enable')}</Typography.Text>
        <Switch checked={draft.enabled} disabled={controller.busy}
          onChange={(enabled) => controller.patch({ enabled })} /></div>
      {controller.original ? <Typography.Text type="secondary">
        {t('mobile.settings.skills.scanResult', { verdict: controller.original.scanVerdict, version: controller.original.version })}
      </Typography.Text> : null}
      {controller.original ? <Button danger block disabled={controller.busy || controller.owner.dirty}
        onClick={() => setConfirmDelete(true)}>{t('common.action.delete')}</Button> : null}
    </section> : controller.detailLoading ? <Spin /> : <Button block
      onClick={() => void controller.select(controller.selectedId)}>{t('common.action.retry')}</Button>}
    <MobileNotice tone="info">{t('mobile.settings.skills.stationScope')}</MobileNotice>
    <Modal open={confirmDelete} title={t('common.action.delete')} okText={t('common.action.delete')}
      okButtonProps={{ danger: true }} cancelText={t('common.action.cancel')} confirmLoading={controller.busy}
      onOk={() => void controller.remove().then((removed) => { if (removed) setConfirmDelete(false); })}
      onCancel={() => { if (!controller.busy) setConfirmDelete(false); }} destroyOnHidden>
      {t('mobile.settings.skills.deleteConfirm', { name: controller.original?.name ?? '' })}
    </Modal>
  </SettingsExitBoundary>;
}

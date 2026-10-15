import { useState } from 'react';
import { Button, Empty, Input, Modal, Segmented, Switch, Typography } from 'antd';
import { ChevronRight, Plus, RefreshCw } from 'lucide-react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { useMobileI18n } from '../../app/mobileI18n';
import { McpTransport } from '../../gen/proto/domain/agent/capability_pb';
import { BoundedList } from '../../components/BoundedList';
import { MobileNotice } from '../../components/MobileNotice';
import { SettingsExitBoundary } from './SettingsExitBoundary';
import { useMcpSettingsController } from './useMcpSettingsController';
import './agent-settings.css';

export function McpDetail({ session, onBack }: {
  readonly session: MobileAuthSession | null; readonly onBack: () => void;
}) {
  const { t } = useMobileI18n();
  const controller = useMcpSettingsController(session);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const draft = controller.draft;
  return <SettingsExitBoundary title={t('mobile.settings.mcp.title')} settingId="mcp"
    owner={controller.owner} onBack={draft ? () => controller.select(null) : onBack}>
    {controller.error ? <MobileNotice>{t(controller.error)}</MobileNotice> : null}
    {!draft ? <>
      <div className="settings-agent-actions">
        <Button icon={<RefreshCw size={16} />} loading={controller.loading} disabled={controller.busy}
          onClick={() => void controller.reload()}>{t('common.action.refresh')}</Button>
        <Button icon={<Plus size={16} />} disabled={controller.busy}
          onClick={() => controller.select('')}>{t('mobile.settings.mcp.add')}</Button>
      </div>
      {!controller.loading && !controller.servers.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('mobile.settings.mcp.empty')} /> : null}
      <BoundedList surfaceKey="settings:mcp" items={controller.servers} itemKey={(entry) => entry.serverId} size={40}>
        {(items) => items.map((entry) => <button type="button" key={entry.serverId}
          className="setting-row settings-agent-provider" data-mcp-id={entry.serverId}
          onClick={() => controller.select(entry.serverId)}>
          <span className="settings-agent-copy"><Typography.Text strong>{entry.title || entry.name}</Typography.Text>
            <Typography.Text type="secondary">{t(entry.enabled ? `mobile.settings.mcp.status.${entry.status}` : 'common.action.disabled')}</Typography.Text></span>
          <ChevronRight size={18} />
        </button>)}
      </BoundedList>
    </> : <section className="settings-agent-editor" data-mcp-editor={controller.selectedId || 'new'}>
      {controller.localRuntime ? <MobileNotice tone="info">{t('mobile.settings.mcp.localRuntime')}</MobileNotice> : <>
        <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.mcp.name')}</Typography.Text>
          <Input value={draft.name} disabled={controller.busy} data-mcp-field="name" autoCapitalize="none"
            onChange={(event) => controller.patch({ name: event.target.value })} /></label>
        <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.mcp.displayName')}</Typography.Text>
          <Input value={draft.title} disabled={controller.busy} data-mcp-field="title"
            onChange={(event) => controller.patch({ title: event.target.value })} /></label>
        <Segmented block value={draft.transport} disabled={controller.busy}
          options={[{ label: 'HTTP', value: McpTransport.HTTP }, { label: 'SSE', value: McpTransport.SSE }]}
          onChange={(transport) => controller.patch({ transport: transport as McpTransport })} />
        <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.mcp.url')}</Typography.Text>
          <Input value={draft.url} disabled={controller.busy} type="url" autoCapitalize="none" autoCorrect="off"
            data-mcp-field="url" onChange={(event) => controller.patch({ url: event.target.value })} /></label>
        <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.mcp.headers')}</Typography.Text>
          <Input.TextArea value={controller.headerDraft} disabled={controller.busy} autoComplete="off"
            autoCapitalize="none" autoCorrect="off" autoSize={{ minRows: 2, maxRows: 6 }} data-mcp-field="headers"
            placeholder={t('mobile.settings.mcp.headersPlaceholder')} onChange={(event) => controller.setHeaderDraft(event.target.value)} />
          <Typography.Text type="secondary">{t('mobile.settings.mcp.headersHint')}</Typography.Text>
        </label>
        <div className="settings-row"><Typography.Text>{t('common.action.enable')}</Typography.Text>
          <Switch checked={draft.enabled} disabled={controller.busy}
            onChange={(enabled) => controller.patch({ enabled })} /></div>
      </>}
      {controller.selected ? <>
        <div className="settings-row"><Typography.Text>{t('mobile.settings.mcp.connection')}</Typography.Text>
          <Typography.Text type="secondary">{t(`mobile.settings.mcp.status.${controller.selected.status}`)}</Typography.Text></div>
        {controller.selected.lastError ? <MobileNotice>{controller.selected.lastError}</MobileNotice> : null}
        {!controller.localRuntime ? <Button block loading={controller.busy} disabled={controller.owner.dirty}
          onClick={() => void controller.refresh()}>{t('mobile.settings.mcp.test')}</Button> : null}
        <BoundedList surfaceKey={`settings:mcp-tools:${controller.selected.serverId}`}
          items={controller.selected.tools} itemKey={(tool) => tool.toolName} size={40}>
          {(tools) => tools.map((tool) => <details className="settings-agent-tool" key={tool.toolName}>
            <summary><Typography.Text>{tool.toolName}</Typography.Text><ChevronRight size={16} /></summary>
            <Typography.Paragraph type="secondary">{tool.description}</Typography.Paragraph>
          </details>)}
        </BoundedList>
        <Button danger block disabled={controller.busy || controller.owner.dirty}
          onClick={() => setConfirmDelete(true)}>{t('common.action.delete')}</Button>
      </> : null}
    </section>}
    <Modal open={confirmDelete} title={t('common.action.delete')} okText={t('common.action.delete')}
      okButtonProps={{ danger: true }} cancelText={t('common.action.cancel')} confirmLoading={controller.busy}
      onOk={() => void controller.remove().then((removed) => { if (removed) setConfirmDelete(false); })}
      onCancel={() => { if (!controller.busy) setConfirmDelete(false); }} destroyOnHidden>
      {t('mobile.settings.mcp.deleteConfirm', { name: controller.selected?.title || controller.selected?.name || '' })}
    </Modal>
  </SettingsExitBoundary>;
}

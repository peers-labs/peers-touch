import { useMemo, useState } from 'react';
import { Button, Empty, Input, Modal, Switch, Typography } from 'antd';
import { ChevronRight, Plus, RefreshCw } from 'lucide-react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import { useMobileI18n } from '../../app/mobileI18n';
import { requestSettingsExit } from '../../app/navigation';
import { BoundedList } from '../../components/BoundedList';
import { MobileNotice } from '../../components/MobileNotice';
import { MobileSearchField } from '../../components/MobileSearchField';
import { SettingsExitBoundary, type SettingsDraftOwner } from './SettingsExitBoundary';
import { useAvailableModelsController, useProviderSettingsController } from './useProviderSettingsController';
import { useProviderOperationsController } from './useProviderOperationsController';
import { ProviderOperationsSection } from './ProviderOperationsSection';
import './agent-settings.css';

const { Text } = Typography;
interface Props {
  readonly session: MobileAuthSession | null;
  readonly onBack: () => void;
}

export function ProvidersDetail({ session, onBack }: Props) {
  const { t } = useMobileI18n();
  const controller = useProviderSettingsController(session);
  const [query, setQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const providers = useMemo(() => controller.providers.filter((value) => (
    `${value.name} ${value.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )), [controller.providers, query]);
  const selected = controller.providers.find((value) => value.id === controller.selectedId);
  const operations = useProviderOperationsController(session, selected, controller.reload);
  const draft = controller.draft;
  const owners = [controller.owner, operations.owner];
  const owner: SettingsDraftOwner = {
    dirty: owners.some((entry) => entry.dirty), conflict: owners.some((entry) => entry.conflict),
    saveStatus: owners.some((entry) => entry.saveStatus === 'saving') ? 'saving'
      : owners.some((entry) => entry.saveStatus === 'error') ? 'error' : 'idle',
    saveError: owners.find((entry) => entry.saveError)?.saveError ?? null,
    save: async () => {
      for (const entry of owners) if (entry.dirty && !await entry.save()) return false;
      return true;
    },
    discard: () => owners.forEach((entry) => entry.discard()),
    reload: controller.reload,
  };
  const busy = owner.saveStatus === 'saving';
  const localRuntime = selected?.runtimeKind === 'cli';

  return (
    <SettingsExitBoundary title={t('mobile.settings.agent.providers')} settingId="providers"
      owner={owner} onBack={draft ? () => controller.select(null) : onBack}>
      {controller.readError ? <MobileNotice>{t(controller.readError)}</MobileNotice> : null}
      {!draft ? <>
      <div className="settings-agent-actions">
        <Button icon={<RefreshCw size={16} />} loading={controller.loading}
          disabled={busy} onClick={() => void controller.reload()}>{t('common.action.refresh')}</Button>
        <Button icon={<Plus size={16} />} disabled={busy}
          onClick={() => requestSettingsExit(() => controller.select(''))}>{t('mobile.settings.agent.addProvider')}</Button>
      </div>
      <MobileSearchField query={query} onChange={setQuery} onSearch={setQuery}
        placeholder={t('mobile.settings.agent.searchProviders')} loading={controller.loading} />
      {!controller.loading && providers.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('mobile.settings.agent.noProviders')} /> : null}
      <BoundedList surfaceKey={`settings:providers:${query}`} items={providers} itemKey={(entry) => entry.id} size={40}>
        {(items) => items.map((entry) => (
          <button type="button" className="setting-row settings-agent-provider" key={entry.id}
            data-provider-id={entry.id} aria-pressed={entry.id === controller.selectedId}
            onClick={() => requestSettingsExit(() => controller.select(entry.id))}>
            <span className="settings-agent-copy"><Text strong>{entry.name}</Text><Text type="secondary">{entry.protocol}</Text></span>
            <Text type="secondary">{t(entry.enabled ? 'common.action.enabled' : 'common.action.disabled')}</Text>
            <ChevronRight size={18} />
          </button>
        ))}
      </BoundedList>
      </> : null}
      {draft ? (
        <section className="settings-agent-editor" data-provider-editor={controller.selectedId || 'new'}>
          <h2>{selected?.name ?? t('mobile.settings.agent.addProvider')}</h2>
          {localRuntime ? <MobileNotice tone="info">{t('mobile.settings.agent.localRuntime')}</MobileNotice> : (
            <>
              {controller.selectedId === '' ? <label className="settings-profile-field">
                <Text>{t('mobile.settings.agent.providerId')}</Text>
                <Input value={draft.id} disabled={busy} autoCapitalize="none" autoCorrect="off"
                  data-provider-field="id" onChange={(event) => controller.patch({ id: event.target.value })} />
              </label> : null}
              <label className="settings-profile-field"><Text>{t('mobile.settings.profile.displayName')}</Text>
                <Input value={draft.displayName} disabled={busy} data-provider-field="displayName"
                  onChange={(event) => controller.patch({ displayName: event.target.value })} />
              </label>
              <label className="settings-profile-field"><Text>{t('mobile.settings.agent.baseUrl')}</Text>
                <Input value={draft.baseUrl} disabled={busy} type="url" autoCapitalize="none" autoCorrect="off"
                  data-provider-field="baseUrl" onChange={(event) => controller.patch({ baseUrl: event.target.value })} />
              </label>
              <div className="settings-row"><Text>{t('common.action.enable')}</Text>
                <Switch checked={draft.enabled} disabled={busy} aria-label={t('common.action.enable')}
                  onChange={(enabled) => controller.patch({ enabled })} />
              </div>
              <label className="settings-profile-field"><Text>{t('mobile.settings.agent.apiKey')}</Text>
                <Input.Password value={controller.apiKey} disabled={busy} autoComplete="new-password"
                  data-provider-field="apiKey" placeholder={t('mobile.settings.agent.replaceKey')}
                  onChange={(event) => controller.setApiKey(event.target.value)} />
                <Text type="secondary">{t(selected?.credentialStatus === 'configured'
                  ? 'mobile.settings.agent.keyConfigured' : 'mobile.settings.agent.keyMissing')}</Text>
              </label>
              {selected ? <ProviderOperationsSection provider={selected} controller={operations}
                disabled={busy || controller.owner.dirty} /> : null}
              {selected?.source === 'custom' ? <Button block danger
                disabled={busy || owner.dirty || operations.activity !== null}
                onClick={() => setConfirmDelete(true)}>{t('mobile.settings.agent.deleteProvider')}</Button> : null}
            </>
          )}
        </section>
      ) : null}
      <Modal open={confirmDelete} title={t('mobile.settings.agent.deleteProvider')}
        okText={t('common.action.delete')} okButtonProps={{ danger: true }}
        cancelText={t('common.action.cancel')} confirmLoading={busy}
        onOk={() => void controller.remove().then((removed) => { if (removed) setConfirmDelete(false); })}
        onCancel={() => { if (!busy) setConfirmDelete(false); }} destroyOnHidden>
        {t('mobile.settings.agent.deleteConfirm', { name: selected?.name ?? '' })}
      </Modal>
    </SettingsExitBoundary>
  );
}

export function ModelsDetail({ session, onBack }: Props) {
  const { t } = useMobileI18n();
  const controller = useAvailableModelsController(session);
  const [query, setQuery] = useState('');
  const models = controller.models.filter((value) => (
    `${value.displayName} ${value.id} ${value.providerName}`.toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  ));
  return (
    <SettingsExitBoundary title={t('mobile.settings.agent.models')} settingId="models" owner={null} onBack={onBack}>
      <MobileSearchField query={query} onChange={setQuery} onSearch={setQuery}
        placeholder={t('mobile.settings.agent.searchModels')} loading={controller.loading} />
      <Button icon={<RefreshCw size={16} />} loading={controller.loading}
        onClick={() => void controller.reload()}>{t('common.action.refresh')}</Button>
      {controller.error ? <MobileNotice>{t(controller.error)}</MobileNotice> : null}
      {!controller.loading && models.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={t('mobile.settings.agent.noModels')} /> : null}
      <BoundedList surfaceKey={`settings:models:${query}`} items={models}
        itemKey={(entry) => `${entry.providerId}:${entry.id}`} size={40}>
        {(items) => items.map((entry) => <div className="settings-row" data-model-id={entry.id} key={`${entry.providerId}:${entry.id}`}>
          <span className="settings-agent-copy"><Text strong>{entry.displayName || entry.id}</Text>
            <Text type="secondary">{entry.providerName}</Text></span>
          <Text type="secondary">{entry.contextWindow}</Text>
        </div>)}
      </BoundedList>
    </SettingsExitBoundary>
  );
}

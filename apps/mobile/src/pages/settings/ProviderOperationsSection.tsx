import { Button, Input, Typography } from 'antd';
import { Plus, RefreshCw } from 'lucide-react';
import type { AgentProviderInfo } from '../../gen/proto/domain/agent/provider_pb';
import { useMobileI18n } from '../../app/mobileI18n';
import { requestSettingsExit } from '../../app/navigation';
import { BoundedList } from '../../components/BoundedList';
import { MobileNotice } from '../../components/MobileNotice';
import { SettingsChoiceField } from './SettingsChoiceField';
import type { useProviderOperationsController } from './useProviderOperationsController';

export function ProviderOperationsSection({ provider, controller, disabled }: {
  readonly provider: AgentProviderInfo;
  readonly controller: ReturnType<typeof useProviderOperationsController>;
  readonly disabled: boolean;
}) {
  const { t } = useMobileI18n();
  const busy = controller.activity !== null;
  const candidates = controller.candidates.filter((entry) => !provider.models.some((model) => model.id === entry.id));
  const draft = controller.modelDraft;
  const result = controller.result;
  const knownFailures = ['authentication', 'rate_limit', 'model_unavailable', 'timeout', 'invalid_response', 'unreachable'];
  return <>
    <SettingsChoiceField label={t('mobile.settings.agent.checkModel')} field="provider-check-model"
      value={controller.modelId} disabled={disabled || busy}
      options={controller.eligibleModels.map((entry) => ({ value: entry.id, label: entry.displayName || entry.id }))}
      onChange={controller.setModelSelection} />
    <Button block data-provider-action="check" disabled={disabled || busy || !provider.enabled || !controller.modelId}
      loading={controller.activity === 'check'} onClick={() => void controller.check()}>
      {t('mobile.settings.agent.testConnection')}
    </Button>
    <Typography.Text type="secondary">{t('mobile.settings.agent.testConnectionHint')}</Typography.Text>
    <Button block data-provider-action="discover" icon={<RefreshCw size={16} />}
      disabled={disabled || busy || !provider.enabled} loading={controller.activity === 'discover'}
      onClick={() => void controller.discover()}>{t('mobile.settings.agent.refreshModels')}</Button>
    {busy ? <Button block onClick={controller.cancel}>{t('common.action.cancel')}</Button> : null}
    {controller.error ? <MobileNotice>{t(controller.error)}</MobileNotice> : null}
    {result ? <div data-provider-check-connected={String(result.connected)} role="status">
      <MobileNotice tone={result.connected ? 'info' : 'error'}>
        {result.connected ? t('mobile.settings.agent.connected', { model: result.modelId, latency: String(result.latencyMs) })
          : t(`mobile.settings.agent.probe.${knownFailures.includes(result.failureCode) ? result.failureCode : 'unreachable'}`)}
      </MobileNotice>
    </div> : null}
    <BoundedList surfaceKey={`settings:provider-models:${provider.id}`} items={provider.models}
      itemKey={(entry) => entry.id} size={40}>
      {(items) => items.map((entry) => <div className="settings-row" key={entry.id} data-provider-model-id={entry.id}>
        <span className="settings-agent-copy"><Typography.Text>{entry.displayName || entry.id}</Typography.Text>
          <Typography.Text type="secondary">{entry.id}</Typography.Text></span>
        <Typography.Text type="secondary">{entry.contextWindow > 1 ? entry.contextWindow : t('mobile.settings.general.notConfigured')}</Typography.Text>
      </div>)}
    </BoundedList>
    <Button block icon={<Plus size={16} />} disabled={disabled || busy}
      data-provider-action="add-model" onClick={() => requestSettingsExit(() => controller.editModel())}>
      {t('mobile.settings.agent.addModel')}
    </Button>
    {candidates.length ? <Typography.Text strong>{t('mobile.settings.agent.discoveredModels')}</Typography.Text> : null}
    <BoundedList surfaceKey={`settings:discovered-models:${provider.id}`} items={candidates}
      itemKey={(entry) => entry.id} size={40}>
      {(items) => items.map((entry) => <button type="button" className="setting-row settings-agent-provider"
        key={entry.id} data-discovered-model-id={entry.id} disabled={disabled || busy}
        onClick={() => requestSettingsExit(() => controller.editModel(entry))}>
        <span className="settings-agent-copy"><Typography.Text>{entry.displayName || entry.id}</Typography.Text></span>
        <Plus size={18} />
      </button>)}
    </BoundedList>
    {draft ? <section className="settings-agent-editor" data-provider-model-editor>
      <Typography.Text strong>{t('mobile.settings.agent.addModel')}</Typography.Text>
      <Typography.Text type="secondary">{t('mobile.settings.agent.modelMetadataHint')}</Typography.Text>
      <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.agent.modelId')}</Typography.Text>
        <Input value={draft.id} autoCapitalize="none" autoCorrect="off" disabled={disabled}
          data-provider-model-field="id" onChange={(event) => controller.patchModel({ id: event.target.value })} /></label>
      <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.profile.displayName')}</Typography.Text>
        <Input value={draft.displayName} disabled={disabled} data-provider-model-field="displayName"
          onChange={(event) => controller.patchModel({ displayName: event.target.value })} /></label>
      <label className="settings-profile-field"><Typography.Text>{t('mobile.settings.agent.contextWindow')}</Typography.Text>
        <Input value={draft.contextWindow} inputMode="numeric" disabled={disabled} data-provider-model-field="contextWindow"
          onChange={(event) => controller.patchModel({ contextWindow: event.target.value })} /></label>
    </section> : null}
  </>;
}

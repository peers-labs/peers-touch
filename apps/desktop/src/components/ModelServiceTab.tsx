// Settings renders the account default owned by Station and the Provider store.
import { useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Alert, Button, toast } from '@lobehub/ui';
import { Typography, theme } from 'antd';
import type { ModelRef } from '../services/desktop_api';
import { ModelSelect } from './ModelSelect';
import { SettingsContainer } from './settings/SettingsLayout';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../store/agent';
import { useActiveProviderSlice } from './settings/useActiveSettingsStores';

const { Title, Text } = Typography;

const SLOT_KEYS = ['default'] as const;

export function ModelServiceTab() {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const { runtimeDefault, setRuntimeDefault, defaultStatus, defaultSaving, loadRuntimeDefault } = useActiveProviderSlice((s) => ({
    runtimeDefault: s.runtimeDefault, setRuntimeDefault: s.setRuntimeDefault,
    defaultStatus: s.defaultStatus, defaultSaving: s.defaultSaving, loadRuntimeDefault: s.loadRuntimeDefault,
  }));
  const config = { default: runtimeDefault
    ? { provider: runtimeDefault.providerId, model: runtimeDefault.modelId } : undefined };
  const availableModels = useAgentStore((state) => state.availableModels);
  const models = useMemo(() => availableModels.filter(
    (model) => model.enabled && (!model.type || model.type === 'chat'),
  ), [availableModels]);
  const modelsLoading = useAgentStore((state) => state.loading);

  const handleDefaultChange = async (ref: ModelRef) => {
    try { await setRuntimeDefault(ref.provider, ref.model); }
    catch { toast.error(t('provider.modelService.failedToSave')); }
  };

  if (defaultStatus === 'idle' || defaultStatus === 'loading' || (modelsLoading && models.length === 0)) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 40 }}>
        <Text type="secondary">{t('provider.modelService.loading')}</Text>
      </Flexbox>
    );
  }

  const noModels = models.length === 0;

  return (
    <SettingsContainer fullHeight tier="standard">
      <Flexbox gap={0}>
        <Title level={5} style={{ margin: '0 0 4px' }}>{t('provider.modelService.title')}</Title>
        <Text type="secondary" style={{ fontSize: 13, marginBottom: 20 }}>
          {t('provider.modelService.desc')}
        </Text>
      </Flexbox>

      {defaultStatus === 'error' && <Flexbox gap={8} style={{ marginBottom: token.margin }}>
        <Text role="alert" type="secondary">{t('provider.modelService.defaultLoadFailed')}</Text>
        <Button onClick={() => void loadRuntimeDefault()}>{t('provider.menu.retry')}</Button>
      </Flexbox>}
      {defaultSaving && <Text role="status" type="secondary">{t('provider.modelService.saving')}</Text>}

      {noModels && (
        <Alert
          type="warning"
          showIcon
          message={t('provider.modelService.noModels')}
          description={t('provider.modelService.noModelsDesc')}
          style={{ marginBottom: 16 }}
        />
      )}

      <Flexbox gap={0}>
        {SLOT_KEYS.map((slotKey, i) => {
          const ref = config[slotKey];
          const isInvalid = ref?.model && !models.some(
            (m) => m.provider_id === ref.provider && m.id === ref.model
          );

          return (
            <Flexbox
              key={slotKey}
              style={{
                padding: '20px 24px',
                background: token.colorBgContainer,
                borderRadius: i === 0 ? '12px 12px 0 0' : i === SLOT_KEYS.length - 1 ? '0 0 12px 12px' : 0,
                borderBottom: i < SLOT_KEYS.length - 1 ? `1px solid ${token.colorBorderSecondary}` : undefined,
              }}
            >
              <Text strong style={{ fontSize: 15, marginBottom: 4 }}>{t(`provider.modelService.slot.${slotKey}.title`)}</Text>

              <Flexbox
                align="center"
                justify="space-between"
                gap={16}
                style={{ marginTop: 4, flexDirection: 'row', flexWrap: 'wrap' }}
              >
                <Flexbox flex={1}>
                  <Text type="secondary" style={{ fontSize: 13 }}>{t('provider.modelService.modelLabel')}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t(`provider.modelService.slot.${slotKey}.desc`)}</Text>
                </Flexbox>

                <ModelSelect
                  className="pt-model-service-default-select"
                  value={ref}
                  onChange={(next) => {
                    if (next) void handleDefaultChange(next);
                  }}
                  models={models}
                  allowClear={false}
                  showWarning={!!isInvalid}
                  style={{ width: 280, maxWidth: '100%' }}
                  disabled={noModels || defaultSaving || defaultStatus !== 'ready'}
                />
              </Flexbox>

              {isInvalid && (
                <Text type="warning" style={{ fontSize: 12, marginTop: 4 }}>
                  {t('provider.modelService.modelInvalid')}
                </Text>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
    </SettingsContainer>
  );
}

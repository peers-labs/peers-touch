/**
 * ModelServiceTab — Settings tab for configuring which model each scenario uses.
 *
 * Architecture:
 *   - Config stored in KV as "prefs:model-registry" (key-value map)
 *   - Each slot key: default, topicNaming, translation, etc.
 *   - API: GET/PUT /api/model-config/:key
 *   - Invalid references (disabled provider) show inline warnings
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Alert, toast } from '@lobehub/ui';
import { Typography, theme } from 'antd';
import { api, type ModelServiceConfig, type ModelRef, type AvailableModel } from '../services/desktop_api';
import { ModelSelect } from './ModelSelect';
import { SettingsContainer } from './settings/SettingsLayout';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

const SLOT_KEYS: (keyof ModelServiceConfig)[] = [
  'default',
  'topicNaming',
  'translation',
  'historyCompress',
  'cronDefault',
  'agentRouter',
];

export function ModelServiceTab() {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const [config, setConfig] = useState<ModelServiceConfig>({});
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.listModelConfig(),
      api.listAvailableModels(),
    ])
      .then(([cfgMap, modelsResp]) => {
        setConfig(cfgMap as ModelServiceConfig);
        setModels(modelsResp.models || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSlotChange = useCallback((key: keyof ModelServiceConfig, ref: ModelRef) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: ref };

      // Debounced save per key
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const body = ref.provider || ref.model ? ref : null;
        api.setModelConfig(key, body).catch(() => toast.error(t('provider.modelService.failedToSave')));
      }, 500);

      return next;
    });
  }, []);

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 40 }}>
        <Text type="secondary">{t('provider.modelService.loading')}</Text>
      </Flexbox>
    );
  }

  const noModels = models.length === 0;

  return (
    <SettingsContainer fullHeight>
      <Flexbox gap={0}>
        <Title level={5} style={{ margin: '0 0 4px' }}>{t('provider.modelService.title')}</Title>
        <Text type="secondary" style={{ fontSize: 13, marginBottom: 20 }}>
          {t('provider.modelService.desc')}
        </Text>
      </Flexbox>

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
                horizontal
                align="center"
                justify="space-between"
                gap={16}
                style={{ marginTop: 4 }}
              >
                <Flexbox flex={1}>
                  <Text type="secondary" style={{ fontSize: 13 }}>{t('provider.modelService.modelLabel')}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t(`provider.modelService.slot.${slotKey}.desc`)}</Text>
                </Flexbox>

                <ModelSelect
                  value={ref?.model}
                  onChange={(v) => {
                    const m = models.find((m) => m.id === v);
                    if (m) handleSlotChange(slotKey, { provider: m.provider_id, model: m.id });
                  }}
                  models={models}
                  showWarning={!!isInvalid}
                  style={{ width: 280 }}
                  disabled={noModels}
                />
              </Flexbox>

              {isInvalid && (
                <Text type="warning" style={{ fontSize: 12, marginTop: 4 }}>
                  ⚠ {t('provider.modelService.modelInvalid', { model: ref?.model, provider: ref?.provider })}
                </Text>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
    </SettingsContainer>
  );
}

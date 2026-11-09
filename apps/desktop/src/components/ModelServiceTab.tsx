/**
 * ModelServiceTab — Settings row for configuring which model each scenario uses.
 *
 * Architecture:
 *   - Config stored in KV as "prefs:model-registry" (key-value map)
 *   - Each slot key: default, topicNaming, translation, etc.
 *   - API: GET/PUT /api/model-config/:key
 *   - Invalid references (disabled provider) show inline warnings
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Text } from '@peers-touch/ui';
import { Brain } from 'lucide-react';
import { api, type ModelServiceConfig, type ModelRef } from '../services/desktop_api';
import { ModelSelect } from './ModelSelect';
import { SettingsContainer, SettingsSection, SettingsRow } from './settings/SettingsLayout';
import { useTranslation } from 'react-i18next';
import { log } from '../utils/logger';
import { useAgentStore } from '../store/agent';
import { notifyError } from '../ui/feedback';

const SLOT_KEYS: (keyof ModelServiceConfig)[] = [
  'default',
];

export function ModelServiceTab() {
  const { t } = useTranslation('provider');
  const [config, setConfig] = useState<ModelServiceConfig>({});
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const models = useAgentStore((state) => state.availableModels);
  const modelsLoading = useAgentStore((state) => state.loading);

  useEffect(() => {
    api.listModelConfig()
      .then((cfgMap) => {
        setConfig(cfgMap as ModelServiceConfig);
      })
      .catch((err) => {
        log.error('model-service', 'Failed to load model service config', err);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const handleSlotChange = useCallback((key: keyof ModelServiceConfig, ref: ModelRef) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: ref };

      // Debounced save per key
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const body = ref.provider || ref.model ? ref : null;
        api.setModelConfig(key, body)
          .then(() => useAgentStore.getState().loadModels())
          .catch(() => notifyError(t('provider.modelService.failedToSave')));
      }, 500);

      return next;
    });
  }, [t]);

  if (loading || (modelsLoading && models.length === 0)) {
    return (
      <SettingsContainer>
        <Text tone="secondary">{t('provider.modelService.loading')}</Text>
      </SettingsContainer>
    );
  }

  const noModels = models.length === 0;

  return (
    <SettingsContainer>
      <SettingsSection icon={<Brain size={15} />} title={t('provider.modelService.title')} subtitle={t('provider.modelService.desc')}>
        {noModels && (
          <Alert
            tone="warning"
            title={t('provider.modelService.noModels')}
            description={t('provider.modelService.noModelsDesc')}
          />
        )}
        {SLOT_KEYS.map((slotKey) => {
          const ref = config[slotKey];
          const isInvalid = ref?.model && !models.some(
            (m) => m.provider_id === ref.provider && m.id === ref.model,
          );
          return (
            <SettingsRow
              key={slotKey}
              label={t(`provider.modelService.slot.${slotKey}.title`)}
              description={t(`provider.modelService.slot.${slotKey}.desc`)}
            >
              <span className="sc-model-service-control">
                <ModelSelect
                  className="pt-model-service-default-select"
                  value={ref}
                  onChange={(next) => {
                    if (next) handleSlotChange(slotKey, next);
                  }}
                  models={models}
                  style={{ width: 280 }}
                  disabled={noModels}
                />
                {isInvalid && (
                  <Text tone="warning" className="sc-model-service-control__invalid">
                    {t('provider.modelService.modelInvalid', { model: ref?.model, provider: ref?.provider })}
                  </Text>
                )}
              </span>
            </SettingsRow>
          );
        })}
      </SettingsSection>
    </SettingsContainer>
  );
}

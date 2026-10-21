import { useMemo } from 'react';
import { Select, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { ProviderIcon } from './settings/ProviderIcon';
import type { AvailableModel, ModelRef } from '../services/desktop_api';
import { useTranslation } from 'react-i18next';
import {
  availableModelIdentityKey,
  findAvailableModel,
  modelIdentityKey,
  parseModelIdentityKey,
} from '../utils/modelIdentity';

interface ModelSelectProps {
  models: AvailableModel[];
  value?: ModelRef;
  onChange?: (model?: ModelRef) => void;
  className?: string;
  placeholder?: string;
  style?: React.CSSProperties;
  size?: 'small' | 'middle' | 'large';
  allowClear?: boolean;
  showWarning?: boolean;
  disabled?: boolean;
}

export function ModelSelect({
  models,
  value,
  onChange,
  className,
  placeholder,
  style,
  size = 'middle',
  allowClear = true,
  showWarning: _showWarning,
  disabled,
}: ModelSelectProps) {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const effectivePlaceholder = placeholder ?? t('provider.modelSelect.placeholder');

  const groupedOptions = useMemo(() => {
    const groups = new Map<string, AvailableModel[]>();
    for (const m of models) {
      if (!m.enabled) continue;
      const key = m.provider_name || m.provider_id || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }
    return Array.from(groups.entries()).map(([provider, items]) => ({
      label: provider,
      options: items.map((m) => ({
        value: availableModelIdentityKey(m),
        className: 'pt-model-select-option',
        'data-pt-model-provider': m.provider_id,
        'data-pt-model-id': m.id,
        label: (
          <Flexbox horizontal align="center" gap={8}>
            <ProviderIcon providerId={m.provider_id || ''} providerName={m.provider_name} size={16} />
            <span style={{ fontSize: 13 }}>{m.display_name || m.id}</span>
            {m.vision && (
              <span style={{ fontSize: 10, color: token.colorTextDescription, marginLeft: 'auto' }}>
                {t('provider.modelSelect.vision')}
              </span>
            )}
          </Flexbox>
        ),
      })),
    }));
  }, [models, t, token]);

  const selectedModel = findAvailableModel(models, value);
  const selectedKey = value?.provider && value.model
    ? modelIdentityKey(value.provider, value.model)
    : undefined;

  return (
    <Select
      className={className}
      value={selectedKey}
      onChange={(next) => onChange?.(parseModelIdentityKey(next))}
      onClear={() => onChange?.(undefined)}
      placeholder={effectivePlaceholder}
      style={{ minWidth: 200, ...style }}
      size={size}
      allowClear={allowClear}
      disabled={disabled}
      showSearch
      filterOption={(input, option) => {
        const ref = parseModelIdentityKey(
          String((option as Record<string, unknown>)?.value ?? ''),
        );
        const model = findAvailableModel(models, ref);
        const query = input.toLowerCase();
        return Boolean(model && [
          model.id,
          model.display_name,
          model.provider_id,
          model.provider_name,
        ].some((entry) => entry?.toLowerCase().includes(query)));
      }}
      options={groupedOptions}
      labelRender={() =>
        selectedModel ? (
          <Flexbox horizontal align="center" gap={6}>
            <ProviderIcon providerId={selectedModel.provider_id || ''} providerName={selectedModel.provider_name} size={16} />
            <span style={{ fontSize: 13 }}>{selectedModel.display_name || selectedModel.id}</span>
          </Flexbox>
        ) : (
          <span style={{ color: token.colorTextPlaceholder }}>{effectivePlaceholder}</span>
        )
      }
    />
  );
}

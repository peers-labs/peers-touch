import { useMemo } from 'react';
import { Select, Text } from '@peers-touch/ui';
import { ProviderIcon } from './settings/ProviderIcon';
import type { AvailableModel, ModelRef } from '../services/desktop_api';
import { useTranslation } from 'react-i18next';
import {
  availableModelIdentityKey,
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
  const effectivePlaceholder = placeholder ?? t('provider.modelSelect.placeholder');

  const options = useMemo(() => {
    const groups = new Map<string, AvailableModel[]>();
    for (const m of models) {
      if (!m.enabled) continue;
      const key = m.provider_name || m.provider_id || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    return Array.from(groups.entries()).flatMap(([provider, items]) =>
      items.map((m) => ({
        value: availableModelIdentityKey(m),
        groupLabel: provider,
        searchText: [m.id, m.display_name, m.provider_id, m.provider_name]
          .filter(Boolean)
          .join(' '),
        attributes: {
          className: 'pt-model-select-option',
          'data-pt-model-provider': m.provider_id,
          'data-pt-model-id': m.id,
        } as Record<string, string>,
        label: (
          <span className="sc-model-select-label">
            <ProviderIcon providerId={m.provider_id || ''} providerName={m.provider_name} size={16} />
            <span style={{ fontSize: 13 }}>{m.display_name || m.id}</span>
            {m.vision && (
              <Text tone="secondary" style={{ fontSize: 10, marginLeft: 'auto' }}>
                {t('provider.modelSelect.vision')}
              </Text>
            )}
          </span>
        ),
      })),
    );
  }, [models, t]);

  const selectedKey = value?.provider && value.model
    ? modelIdentityKey(value.provider, value.model)
    : undefined;

  return (
    <Select<string>
      className={className}
      value={selectedKey}
      onValueChange={(next) => {
        if (typeof next !== 'string') {
          onChange?.(undefined);
          return;
        }
        onChange?.(parseModelIdentityKey(next));
      }}
      placeholder={effectivePlaceholder}
      style={{ minWidth: 200, ...style }}
      density={size === 'small' ? 'compact' : 'normal'}
      clearable={allowClear}
      disabled={disabled}
      searchable
      options={options}
    />
  );
}

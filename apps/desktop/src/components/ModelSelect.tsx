import { useMemo } from 'react';
import { Select, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { ProviderIcon } from './settings/ProviderIcon';
import type { AvailableModel } from '../services/api';

interface ModelSelectProps {
  models: AvailableModel[];
  value?: string;
  onChange?: (modelId: string) => void;
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
  placeholder = 'Select model...',
  style,
  size = 'middle',
  allowClear = true,
  showWarning: _showWarning,
  disabled,
}: ModelSelectProps) {
  const { token } = theme.useToken();

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
        value: m.id,
        label: (
          <Flexbox horizontal align="center" gap={8}>
            <ProviderIcon providerId={m.provider_id || ''} providerName={m.provider_name} size={16} />
            <span style={{ fontSize: 13 }}>{m.display_name || m.id}</span>
            {m.vision && (
              <span style={{ fontSize: 10, color: token.colorTextDescription, marginLeft: 'auto' }}>
                vision
              </span>
            )}
          </Flexbox>
        ),
      })),
    }));
  }, [models, token]);

  const selectedModel = models.find((m) => m.id === value);

  return (
    <Select
      value={value || undefined}
      onChange={onChange}
      placeholder={placeholder}
      style={{ minWidth: 200, ...style }}
      size={size}
      allowClear={allowClear}
      disabled={disabled}
      showSearch
      filterOption={(input, option) =>
        ((option as Record<string, unknown>)?.value as string)?.toLowerCase().includes(input.toLowerCase()) ?? false
      }
      options={groupedOptions}
      labelRender={() =>
        selectedModel ? (
          <Flexbox horizontal align="center" gap={6}>
            <ProviderIcon providerId={selectedModel.provider_id || ''} providerName={selectedModel.provider_name} size={16} />
            <span style={{ fontSize: 13 }}>{selectedModel.display_name || selectedModel.id}</span>
          </Flexbox>
        ) : (
          <span style={{ color: token.colorTextPlaceholder }}>{placeholder}</span>
        )
      }
    />
  );
}

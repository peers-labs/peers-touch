import { useMemo } from 'react';
import { Form, Select, theme } from 'antd';
import type { FormInstance } from 'antd';
import { useTranslation } from 'react-i18next';

import type { AvailableModel } from '../../../services/desktop_api';
import type { AgentCreateFormValues } from './agentCreateModel';

interface AgentCreateRuntimeFieldsProps {
  availableModels: AvailableModel[];
  disabled: boolean;
  form: FormInstance<AgentCreateFormValues>;
}

export function AgentCreateRuntimeFields({
  availableModels,
  disabled,
  form,
}: AgentCreateRuntimeFieldsProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const selectedProvider = Form.useWatch('provider', form);

  const providerOptions = useMemo(
    () => Array.from(
      new Map(
        availableModels
          .filter((model) => model.enabled)
          .map((model) => [
            model.provider_id || model.provider_name,
            {
              label: model.provider_name || model.provider_id,
              value: model.provider_id || model.provider_name,
            },
          ]),
      ).values(),
    ).filter((option) => option.value),
    [availableModels],
  );

  const modelOptions = useMemo(
    () => availableModels
      .filter(
        (model) =>
          model.enabled
          && (!selectedProvider || model.provider_id === selectedProvider),
      )
      .map((model) => ({
        label: model.display_name || model.id,
        value: model.id,
      })),
    [availableModels, selectedProvider],
  );

  return (
    <div
      style={{
        display: 'grid',
        gap: `0 ${token.marginMD}px`,
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}
    >
      <Form.Item
        label={t('agent.drawer.provider')}
        name="provider"
      >
        <Select
          allowClear
          disabled={disabled}
          options={providerOptions}
          placeholder={t('agent.drawer.providerPlaceholder')}
          showSearch
          optionFilterProp="label"
          onChange={(provider) => {
            const model = availableModels.find(
              (item) => item.id === form.getFieldValue('model'),
            );
            if (
              provider
              && model
              && model.provider_id !== provider
            ) {
              form.setFieldValue('model', undefined);
            }
          }}
        />
      </Form.Item>

      <Form.Item
        extra={t('agent.drawer.modelOverrideExtra')}
        label={t('agent.drawer.modelOverride')}
        name="model"
      >
        <Select
          allowClear
          disabled={disabled}
          options={modelOptions}
          placeholder={t('agent.drawer.modelOverridePlaceholder')}
          showSearch
          optionFilterProp="label"
        />
      </Form.Item>

      <Form.Item
        label={t('agent.drawer.effort')}
        name="effort"
      >
        <Select
          disabled={disabled}
          options={[
            {
              label: t('agent.drawer.effort.low'),
              value: 'low',
            },
            {
              label: t('agent.drawer.effort.medium'),
              value: 'medium',
            },
            {
              label: t('agent.drawer.effort.high'),
              value: 'high',
            },
          ]}
        />
      </Form.Item>

      <Form.Item
        label={t('agent.drawer.visibility')}
        name="visibility"
      >
        <Select
          disabled={disabled}
          options={[
            {
              label: t('agent.drawer.visibility.private'),
              value: 'private',
            },
            {
              label: t('agent.drawer.visibility.workspace'),
              value: 'workspace',
            },
          ]}
        />
      </Form.Item>
    </div>
  );
}

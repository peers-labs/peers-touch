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
import { Typography, theme, message, Alert } from 'antd';
import { api, type ModelServiceConfig, type ModelRef, type AvailableModel } from '../services/desktop_api';
import { ModelSelect } from './ModelSelect';

const { Title, Text } = Typography;

interface SlotDef {
  key: keyof ModelServiceConfig;
  title: string;
  description: string;
}

const SLOTS: SlotDef[] = [
  {
    key: 'default',
    title: 'Default Agent Settings',
    description: 'Default model used when creating a new Agent or when no model is specified.',
  },
  {
    key: 'topicNaming',
    title: 'Topic Auto-Naming Agent',
    description: 'Model designated for automatic topic renaming.',
  },
  {
    key: 'translation',
    title: 'Message Translation Agent',
    description: 'Specify the model used for translation.',
  },
  {
    key: 'historyCompress',
    title: 'Conversation History Compression Agent',
    description: 'Specify the model used to compress conversation history.',
  },
  {
    key: 'cronDefault',
    title: 'Cron Job Default Agent',
    description: 'Default model for scheduled cron job agent tasks.',
  },
  {
    key: 'agentRouter',
    title: 'Agent Proxy Router',
    description: 'Model used by Agent Proxy to intelligently route requests to the best-fit agent.',
  },
];

export function ModelServiceTab() {
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
        api.setModelConfig(key, body).catch(() => message.error('Failed to save'));
      }, 500);

      return next;
    });
  }, []);

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ padding: 40 }}>
        <Text type="secondary">Loading model configuration...</Text>
      </Flexbox>
    );
  }

  const noModels = models.length === 0;

  return (
    <Flexbox gap={0} style={{ padding: '16px 24px' }}>
      <Title level={5} style={{ margin: '0 0 4px' }}>Model Service</Title>
      <Text type="secondary" style={{ fontSize: 13, marginBottom: 20 }}>
        Configure which model each scenario uses. All models are governed by Provider settings — disabling a provider invalidates its model assignments here.
      </Text>

      {noModels && (
        <Alert
          type="warning"
          showIcon
          message="No models available"
          description="Enable at least one provider and configure its API key in the Providers tab."
          style={{ marginBottom: 16 }}
        />
      )}

      <Flexbox gap={0}>
        {SLOTS.map((slot, i) => {
          const ref = config[slot.key];
          const isInvalid = ref?.model && !models.some(
            (m) => m.provider_id === ref.provider && m.id === ref.model
          );

          return (
            <Flexbox
              key={slot.key}
              style={{
                padding: '20px 24px',
                background: token.colorBgContainer,
                borderRadius: i === 0 ? '12px 12px 0 0' : i === SLOTS.length - 1 ? '0 0 12px 12px' : 0,
                borderBottom: i < SLOTS.length - 1 ? `1px solid ${token.colorBorderSecondary}` : undefined,
              }}
            >
              <Text strong style={{ fontSize: 15, marginBottom: 4 }}>{slot.title}</Text>

              <Flexbox
                horizontal
                align="center"
                justify="space-between"
                gap={16}
                style={{ marginTop: 4 }}
              >
                <Flexbox flex={1}>
                  <Text type="secondary" style={{ fontSize: 13 }}>Model</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{slot.description}</Text>
                </Flexbox>

                <ModelSelect
                  value={ref?.model}
                  onChange={(v) => {
                    const m = models.find((m) => m.id === v);
                    if (m) handleSlotChange(slot.key, { provider: m.provider_id, model: m.id });
                  }}
                  models={models}
                  showWarning={!!isInvalid}
                  style={{ width: 280 }}
                  disabled={noModels}
                />
              </Flexbox>

              {isInvalid && (
                <Text type="warning" style={{ fontSize: 12, marginTop: 4 }}>
                  ⚠ Model "{ref?.model}" from provider "{ref?.provider}" is no longer available. Please reconfigure.
                </Text>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
    </Flexbox>
  );
}

import { useState, useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, Typography, theme, message, Divider, Radio } from 'antd';
import { Key, ExternalLink, Zap, CheckCircle } from 'lucide-react';
import { api } from '../../../services/desktop_api';
import type { WizardStep, ProviderListItem, ProviderDetail } from '../../../services/desktop_api';

const { Text, Link } = Typography;

interface PresetConfig {
  provider: string;
  label: string;
  auto_apply?: boolean;
}

interface Props {
  step: WizardStep;
  onNext: (data: Record<string, any>) => void;
  onBack: () => void;
}

export function ProviderSelectStep({ step, onNext, onBack }: Props) {
  const { token } = theme.useToken();
  const config = step.config || {};
  const presets = (config.presets as PresetConfig[]) || [];
  const showPresets = config.show_presets === true && presets.length > 0;
  const showBuiltin = config.show_builtin !== false;
  const builtinFilter = (config.builtin_filter as string[]) || [];

  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<ProviderDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!showBuiltin) return;
    api.listProviders().then((list: ProviderListItem[]) => {
      let filtered = list;
      if (builtinFilter.length > 0) {
        filtered = list.filter((p) => builtinFilter.includes(p.id));
      }
      setProviders(filtered);
      if (filtered.length > 0 && !selectedId) {
        setSelectedId(filtered[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDetail(null);
      return;
    }
    api.getProvider(selectedId).then(setSelectedDetail).catch(() => setSelectedDetail(null));
  }, [selectedId]);

  const selectedProvider = providers.find((p) => p.id === selectedId);

  const handleApplyPreset = async (preset: PresetConfig) => {
    setApplying(true);
    try {
      const result = await api.applyPreset(preset.provider);
      if (result.ok) {
        message.success('Provider configured');
        setDone(true);
        onNext({ provider: preset.provider, mode: 'preset' });
      }
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : 'Failed to apply preset');
    } finally {
      setApplying(false);
    }
  };

  const handleCheck = async () => {
    if (!selectedId) return;
    setChecking(true);
    try {
      const result = await api.checkProvider(selectedId, { api_key: apiKey || undefined });
      if (result.ok) {
        message.success('Connection successful');
      } else {
        message.error(result.error || 'Connection failed');
      }
    } catch {
      message.error('Connection check failed');
    } finally {
      setChecking(false);
    }
  };

  const handleSaveBuiltin = async () => {
    if (!selectedId || !apiKey) return;
    setApplying(true);
    try {
      const detail = await api.getProvider(selectedId);
      await api.updateProvider(selectedId, {
        api_key: apiKey,
        base_url: detail.base_url || detail.default_base_url || '',
        enabled: true,
      });
      message.success('Provider configured');
      setDone(true);
      onNext({ provider: selectedId, mode: 'manual' });
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setApplying(false);
    }
  };

  if (done) {
    return (
      <Flexbox align="center" justify="center" gap={32} style={{ minHeight: '100%', padding: '40px 24px' }}>
        <CheckCircle size={64} color={token.colorSuccess} />
        <h2 style={{ fontSize: 22, fontWeight: 600, color: token.colorText, margin: 0 }}>Provider Configured</h2>
      </Flexbox>
    );
  }

  return (
    <Flexbox align="center" justify="center" gap={28} style={{ minHeight: '100%', padding: '40px 24px' }}>
      <Flexbox align="center" gap={12}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #a18cd1, #fbc2eb)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Key size={28} color="#fff" />
        </div>
        <h2 style={{ fontSize: 26, fontWeight: 700, color: token.colorText, margin: 0 }}>
          {step.title}
        </h2>
        {step.desc && (
          <p style={{ fontSize: 15, color: token.colorTextSecondary, margin: 0, textAlign: 'center', maxWidth: 400 }}>
            {step.desc}
          </p>
        )}
      </Flexbox>

      <Flexbox gap={16} style={{ width: '100%', maxWidth: 420 }}>
        {/* Preset providers (team-provided, one-click) */}
        {showPresets && presets.map((preset) => (
          <Button
            key={preset.provider}
            type="primary"
            size="large"
            icon={<Zap size={16} />}
            onClick={() => handleApplyPreset(preset)}
            loading={applying}
            style={{
              height: 48,
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              background: 'linear-gradient(135deg, #667eea, #764ba2)',
              border: 'none',
            }}
            block
          >
            {preset.label}
          </Button>
        ))}

        {showPresets && showBuiltin && (
          <Divider style={{ margin: '4px 0', fontSize: 13, color: token.colorTextQuaternary }}>
            or configure manually
          </Divider>
        )}

        {/* Built-in provider selection */}
        {showBuiltin && providers.length > 0 && (
          <Flexbox
            gap={12}
            style={{
              padding: 20,
              borderRadius: 12,
              background: token.colorFillQuaternary,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Text strong style={{ fontSize: 15 }}>Select Provider</Text>
            <Radio.Group
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); setApiKey(''); }}
              style={{ width: '100%' }}
            >
              <Flexbox gap={8}>
                {providers.map((p) => (
                  <Radio
                    key={p.id}
                    value={p.id}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: selectedId === p.id ? token.colorPrimaryBg : 'transparent',
                      border: `1px solid ${selectedId === p.id ? token.colorPrimary : token.colorBorderSecondary}`,
                      transition: 'all 0.2s',
                    }}
                  >
                    <Flexbox horizontal gap={8} align="center">
                      <Text strong>{p.name}</Text>
                      {p.description && (
                        <Text type="secondary" style={{ fontSize: 12 }}>{p.description}</Text>
                      )}
                    </Flexbox>
                  </Radio>
                ))}
              </Flexbox>
            </Radio.Group>

            {selectedProvider && selectedDetail && (
              <Flexbox gap={8} style={{ marginTop: 8 }}>
                <Flexbox horizontal justify="space-between" align="center">
                  <Text style={{ fontSize: 13, fontWeight: 500 }}>API Key</Text>
                  {selectedDetail.api_key_url && (
                    <Link href={selectedDetail.api_key_url} target="_blank" style={{ fontSize: 12 }}>
                      Get Key <ExternalLink size={11} />
                    </Link>
                  )}
                </Flexbox>
                <Input.Password
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`Enter ${selectedProvider.name} API key`}
                  size="middle"
                />
                <Flexbox horizontal gap={8}>
                  <Button size="small" onClick={handleCheck} loading={checking} disabled={!apiKey}>
                    Test
                  </Button>
                  <Button type="primary" size="small" onClick={handleSaveBuiltin} loading={applying} disabled={!apiKey}>
                    Save & Continue
                  </Button>
                </Flexbox>
              </Flexbox>
            )}
          </Flexbox>
        )}
      </Flexbox>

      <Flexbox horizontal gap={12}>
        <Button size="large" onClick={onBack} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
          Back
        </Button>
        {!step.required && (
          <Button size="large" onClick={() => onNext({})} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
            Skip
          </Button>
        )}
      </Flexbox>
    </Flexbox>
  );
}

import { useState, useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, Typography, theme, message, Divider } from 'antd';
import { Key, ExternalLink, Zap } from 'lucide-react';
import { api, type ProviderDetail } from '../../services/desktop_api';

const { Text, Link } = Typography;

interface Props {
  onComplete: () => void;
  onBack: () => void;
}

export function ProviderSetupStep({ onComplete, onBack }: Props) {
  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);
  const { token } = theme.useToken();

  useEffect(() => {
    api.listProviders().then((providers) => {
      const defaultProvider = providers.find((p) => p.enabled) || providers[0];
      if (defaultProvider) {
        api.getProvider(defaultProvider.id).then(setProvider);
      }
    });
  }, []);

  const handleCheck = async () => {
    if (!provider) return;
    setChecking(true);
    try {
      const result = await api.checkProvider(provider.id, { api_key: apiKey || undefined });
      if (result.ok) {
        message.success('Connection successful!');
      } else {
        message.error(result.error || 'Connection failed');
      }
    } catch {
      message.error('Connection check failed');
    } finally {
      setChecking(false);
    }
  };

  const handleApplyPreset = async () => {
    if (!provider) return;
    setApplyingPreset(true);
    try {
      const result = await api.applyPreset(provider.id);
      if (result.ok) {
        message.success('Preset provider configured!');
        await api.setOnboarding({ completed: true });
        onComplete();
      }
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : 'Failed to apply preset');
    } finally {
      setApplyingPreset(false);
    }
  };

  const handleComplete = async () => {
    if (provider && apiKey) {
      try {
        await api.updateProvider(provider.id, {
          api_key: apiKey,
          base_url: provider.base_url,
          enabled: true,
        });
      } catch {
        // Continue anyway
      }
    }
    await api.setOnboarding({ completed: true }).catch(() => {});
    onComplete();
  };

  return (
    <Flexbox align="center" justify="center" gap={32} style={{ minHeight: '100%', padding: '40px 24px' }}>
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
          Connect a provider
        </h2>
        <p style={{ fontSize: 15, color: token.colorTextSecondary, margin: 0, textAlign: 'center', maxWidth: 400 }}>
          Set up your AI model provider. You can always change this later in Settings.
        </p>
      </Flexbox>

      {provider && (
        <Flexbox gap={16} style={{ width: '100%', maxWidth: 420 }}>
          {/* Quick preset button */}
          <Button
            type="primary"
            size="large"
            icon={<Zap size={16} />}
            onClick={handleApplyPreset}
            loading={applyingPreset}
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
            Use Preset Provider (Ark)
          </Button>

          <Divider style={{ margin: '4px 0', fontSize: 13, color: token.colorTextQuaternary }}>
            or enter your own API key
          </Divider>

          {/* Manual setup */}
          <Flexbox
            gap={12}
            style={{
              padding: 20,
              borderRadius: 12,
              background: token.colorFillQuaternary,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Flexbox horizontal justify="space-between" align="center">
              <Text strong style={{ fontSize: 16 }}>{provider.name}</Text>
              {provider.api_key_url && (
                <Link href={provider.api_key_url} target="_blank" style={{ fontSize: 13 }}>
                  Get API Key <ExternalLink size={12} style={{ marginLeft: 4 }} />
                </Link>
              )}
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 13 }}>{provider.description}</Text>

            <Flexbox gap={8}>
              <Text style={{ fontSize: 13, fontWeight: 500 }}>API Key</Text>
              <Input.Password
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                size="large"
              />
            </Flexbox>

            {provider.show_checker && (
              <Button onClick={handleCheck} loading={checking} disabled={!apiKey}>
                Test Connection
              </Button>
            )}
          </Flexbox>
        </Flexbox>
      )}

      <Flexbox horizontal gap={12}>
        <Button size="large" onClick={onBack} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
          Back
        </Button>
        <Button onClick={handleComplete} size="large" style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
          Skip
        </Button>
        <Button type="primary" size="large" onClick={handleComplete} disabled={!apiKey} style={{ height: 44, paddingInline: 32, borderRadius: 22 }}>
          Complete Setup
        </Button>
      </Flexbox>
    </Flexbox>
  );
}

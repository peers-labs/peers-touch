import { useState, useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Typography, Tag, theme, Tooltip, Input, Modal, message, Alert } from 'antd';
import { Clock, Check, Copy, Settings2 } from 'lucide-react';
import type { OAuth2ProviderSummary } from '../../services/desktop_api';
import { api } from '../../services/desktop_api';
import { useOAuth2Store } from '../../store/oauth2';
import { PlatformLogo } from '../common/PlatformLogo';

const { Text } = Typography;

interface Props {
  provider: OAuth2ProviderSummary;
}

function CredentialsModal({
  provider,
  open,
  onClose,
}: {
  provider: OAuth2ProviderSummary;
  open: boolean;
  onClose: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string>('none');
  const [yamlConflict, setYamlConflict] = useState(false);
  const { loadAll } = useOAuth2Store();

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.oauth2GetCredentialInfo(provider.id)
      .then(info => {
        setClientId(info.client_id || '');
        setClientSecret('');
        setSource(info.source);
        setYamlConflict(info.source === 'ui' && info.yaml_has_conf);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, provider.id]);

  const handleSave = async () => {
    if (!clientId.trim()) {
      message.error('Client ID is required');
      return;
    }
    if (source === 'none' && !clientSecret.trim()) {
      message.error('Client Secret is required for first-time configuration');
      return;
    }
    if (!clientSecret.trim() && source !== 'none') {
      message.info('No changes — secret was not updated');
      onClose();
      return;
    }
    setSaving(true);
    try {
      await api.oauth2SetCredentials(provider.id, clientId.trim(), clientSecret.trim());
      message.success('Credentials saved');
      await loadAll();
      onClose();
    } catch (err: any) {
      message.error(`Failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`Configure ${provider.name}`}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      okText="Save"
      destroyOnClose
    >
      <Flexbox gap={16} style={{ paddingBlock: 12 }}>
        <Text type="secondary" style={{ fontSize: 13 }}>
          Register Agent Box as an OAuth2 client with {provider.name}.
        </Text>

        {provider.callback_url && (
          <Flexbox gap={4}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Redirect URI (register this with {provider.name}):
            </Text>
            <Input.Search
              readOnly
              value={provider.callback_url}
              enterButton={<Copy size={12} />}
              size="small"
              onSearch={() => {
                navigator.clipboard.writeText(provider.callback_url);
                message.success('Copied');
              }}
              styles={{ input: { fontSize: 12, fontFamily: 'monospace' } }}
            />
          </Flexbox>
        )}

        {source === 'yaml' && (
          <Alert
            type="info"
            showIcon
            message={
              <span style={{ fontSize: 12 }}>
                Currently using credentials from config file (<code>~/.peers-touch/oauth2/{provider.id}.yml</code>).
                Saving here will override the config file values.
              </span>
            }
            style={{ borderRadius: 8 }}
          />
        )}

        {yamlConflict && (
          <Alert
            type="warning"
            showIcon
            message={
              <span style={{ fontSize: 12 }}>
                Config file also has credentials. The values saved here take priority.
                Remove them from YAML if no longer needed.
              </span>
            }
            style={{ borderRadius: 8 }}
          />
        )}

        <Flexbox gap={4}>
          <Text strong style={{ fontSize: 12 }}>Client ID</Text>
          <Input
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            placeholder="Enter client_id"
            disabled={loading}
          />
        </Flexbox>

        <Flexbox gap={4}>
          <Text strong style={{ fontSize: 12 }}>Client Secret</Text>
          <Input.Password
            value={clientSecret}
            onChange={e => setClientSecret(e.target.value)}
            placeholder={source !== 'none' ? 'Re-enter to update' : 'Enter client_secret'}
            disabled={loading}
          />
          {source !== 'none' && !clientSecret && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              Secret is stored encrypted. Re-enter to change it, or leave blank to keep the existing one.
            </Text>
          )}
        </Flexbox>
      </Flexbox>
    </Modal>
  );
}

export function OAuth2ProviderCard({ provider }: Props) {
  const { token } = theme.useToken();
  const [credModalOpen, setCredModalOpen] = useState(false);

  const isComingSoon = provider.status === 'coming_soon';
  const hasCreds = provider.has_credentials;

  const statusTag = isComingSoon ? (
    <Tag style={{
      margin: 0, fontSize: 11, borderRadius: 4,
      display: 'inline-flex', alignItems: 'center', gap: 4, lineHeight: 1,
    }}>
      <Clock size={11} style={{ flexShrink: 0 }} />
      Coming Soon
    </Tag>
  ) : hasCreds ? (
    <Tag color="success" style={{ margin: 0, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Check size={11} />
      Configured
    </Tag>
  ) : (
    <Tag style={{ margin: 0, fontSize: 11 }}>Not Configured</Tag>
  );

  return (
    <>
      <Flexbox
        style={{
          padding: 16,
          borderRadius: 12,
          border: `1px solid ${hasCreds ? provider.color + '40' : token.colorBorderSecondary}`,
          background: isComingSoon
            ? token.colorFillQuaternary
            : hasCreds
            ? provider.color + '06'
            : token.colorBgContainer,
          transition: 'all 0.2s',
          cursor: 'default',
          minWidth: 240,
          maxWidth: 300,
          flex: '1 1 240px',
          opacity: isComingSoon ? 0.7 : 1,
        }}
        gap={10}
      >
        <Flexbox horizontal justify="space-between" align="center">
          <Flexbox horizontal align="center" gap={10}>
            <Flexbox
              align="center"
              justify="center"
              style={{
                width: 36, height: 36, borderRadius: 8,
                background: provider.color + '18',
              }}
            >
              <PlatformLogo providerId={provider.id} size={20} color={provider.color} />
            </Flexbox>
            <Text strong style={{ fontSize: 14 }}>{provider.name}</Text>
          </Flexbox>
          {statusTag}
        </Flexbox>

        <Text type="secondary" style={{ fontSize: 12, lineHeight: '18px' }}>
          {provider.description}
        </Text>

        {!isComingSoon && (
          <Flexbox horizontal gap={8}>
            {hasCreds ? (
              <Tooltip title="Edit credentials">
                <Button size="small" icon={<Settings2 size={14} />} onClick={() => setCredModalOpen(true)}>
                  Edit
                </Button>
              </Tooltip>
            ) : (
              <Button
                size="small"
                type="primary"
                icon={<Settings2 size={14} />}
                onClick={() => setCredModalOpen(true)}
              >
                Configure
              </Button>
            )}
          </Flexbox>
        )}
      </Flexbox>

      <CredentialsModal
        provider={provider}
        open={credModalOpen}
        onClose={() => setCredModalOpen(false)}
      />
    </>
  );
}

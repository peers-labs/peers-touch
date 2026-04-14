import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Typography, Modal, Form, theme, Divider, Avatar } from 'antd';
import { Input, Button, TextArea, InputPassword, toast } from '@lobehub/ui';
import { Search, Plus, Brain } from 'lucide-react';
import { useProviderStore } from '../../store/provider';
import { ProviderIcon } from './ProviderIcon';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

export function ProviderMenu() {
  const { t } = useTranslation('provider');
  const { providers, selectedId, loadProviders, selectProvider, createProvider } = useProviderStore();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const { token } = theme.useToken();

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const filtered = providers.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );
  const enabledList = filtered.filter((p) => p.enabled);
  const disabledList = filtered.filter((p) => !p.enabled);

  const renderItem = (p: typeof providers[0]) => {
    const isSelected = p.id === selectedId;
    const dotColor = p.enabled ? '#52c41a' : token.colorTextQuaternary;

    return (
      <Flexbox
        key={p.id}
        data-item-id={p.id}
        horizontal
        align="center"
        gap={10}
        onClick={(e) => {
          e.stopPropagation();
          selectProvider(p.id);
        }}
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          cursor: 'pointer',
          background: isSelected ? token.colorPrimaryBg : 'transparent',
          border: isSelected ? `1px solid ${token.colorPrimaryBorderHover}` : '1px solid transparent',
          transition: 'all 0.15s',
        }}
      >
        {p.logo ? (
          <Avatar src={p.logo} shape="circle" size={28} />
        ) : (
          <ProviderIcon providerId={p.id} providerName={p.name} size={28} />
        )}
        <Flexbox flex={1} style={{ minWidth: 0 }}>
          <Text strong ellipsis style={{ fontSize: 14 }}>{p.name}</Text>
        </Flexbox>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
          }}
        />
      </Flexbox>
    );
  };

  return (
    <Flexbox gap={8} style={{ height: '100%', padding: '16px 12px 12px' }}>
      <Flexbox horizontal gap={6}>
        <Input
          prefix={<Search size={12} style={{ color: token.colorTextQuaternary }} />}
          placeholder={t('provider.menu.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="small"
          style={{ borderRadius: 8, flex: 1, fontSize: 12 }}
        />
        <Button
          icon={<Plus size={14} />}
          size="small"
          onClick={() => setShowCreate(true)}
          title={t('provider.menu.addCustomProvider')}
          style={{ borderRadius: 8, flexShrink: 0 }}
        />
      </Flexbox>

      <Flexbox flex={1} gap={4} style={{ overflow: 'auto' }}>
        {enabledList.length > 0 && (
          <>
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, padding: '8px 14px 2px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('provider.menu.enabled')}
            </Text>
            {enabledList.map(renderItem)}
          </>
        )}
        {disabledList.length > 0 && (
          <>
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 600, padding: '12px 14px 2px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('provider.menu.disabled')}
            </Text>
            {disabledList.map(renderItem)}
          </>
        )}
      </Flexbox>

      <CreateProviderModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={createProvider}
      />
    </Flexbox>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <>
      <Divider style={{ margin: '8px 0 16px' }} />
      <Text strong style={{ fontSize: 14, color: token.colorText, display: 'block', marginBottom: 16 }}>
        {children}
      </Text>
    </>
  );
}

function CreateProviderModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { id: string; name: string; description?: string; logo?: string; base_url: string; api_key?: string }) => Promise<void>;
}) {
  const { t } = useTranslation('provider');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await onCreate(values);
      toast.success(t('provider.menu.created'));
      form.resetFields();
      onClose();
    } catch (e: unknown) {
      if (e instanceof Error) toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <Flexbox horizontal gap={8} align="center">
          <Brain size={18} />
          <span>{t('provider.menu.createTitle')}</span>
        </Flexbox>
      }
      open={open}
      onCancel={onClose}
      footer={
        <Button
          type="primary"
          block
          size="large"
          loading={loading}
          onClick={handleOk}
          style={{ borderRadius: 8 }}
        >
          {t('provider.menu.createBtn')}
        </Button>
      }
      destroyOnClose
      width={520}
    >
      <Form form={form} layout="horizontal" labelCol={{ span: 8 }} wrapperCol={{ span: 16 }} style={{ marginTop: 8 }}>
        <SectionTitle>{t('provider.menu.basicInfo')}</SectionTitle>

        <Form.Item
          name="id"
          label={t('provider.menu.providerId')}
          rules={[
            { required: true, message: t('provider.menu.providerIdRequired') },
            { pattern: /^[\d_a-z-]+$/, message: t('provider.menu.providerIdPattern') },
          ]}
          extra={
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('provider.menu.providerIdExtra')}
            </Text>
          }
        >
          <Input placeholder={t('provider.menu.providerIdPlaceholder')} variant="filled" />
        </Form.Item>

        <Form.Item name="name" label={t('provider.menu.providerName')}>
          <Input placeholder={t('provider.menu.providerNamePlaceholder')} variant="filled" />
        </Form.Item>

        <Form.Item name="description" label={t('provider.menu.providerDescription')}>
          <TextArea placeholder={t('provider.menu.providerDescPlaceholder')} rows={3} variant="filled" />
        </Form.Item>

        <Form.Item name="logo" label={t('provider.menu.providerLogo')}>
          <Input placeholder="https://example.com/logo.png" variant="filled" allowClear />
        </Form.Item>

        <SectionTitle>{t('provider.menu.configInfo')}</SectionTitle>

        <Form.Item
          name="base_url"
          label={t('provider.menu.proxyUrl')}
          rules={[{ required: true, message: t('provider.menu.proxyUrlRequired') }]}
        >
          <Input placeholder="https://your-proxy-url.com/v1" variant="filled" />
        </Form.Item>

        <Form.Item name="api_key" label={t('provider.menu.apiKey')}>
          <InputPassword
            placeholder={t('provider.menu.apiKeyPlaceholder')}
            variant="filled"
            autoComplete="new-password"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

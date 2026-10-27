import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Typography, Modal, Form, theme, Divider, Avatar, Radio, Select, Switch } from 'antd';
import { Input, Button, TextArea, InputPassword, Tag, toast } from '@lobehub/ui';
import { Search, Plus, Brain, TerminalSquare, Star } from 'lucide-react';
import { ProviderIcon } from './ProviderIcon';
import { useTranslation } from 'react-i18next';
import { isProviderUsable, mapProviderUIStatus } from '../../store/providerReadiness';
import type { ProviderReadinessStatus } from '../../store/providerReadiness';
import { useActiveProviderSlice, useActiveSettingsSlice } from './useActiveSettingsStores';
import { useAgentStore } from '../../store/agent';

const { Text } = Typography;

export function ProviderMenu() {
  const { t } = useTranslation('provider');
  const { providers, selectedId, selectProvider, createProvider, readinessById, runtimeDefault, setRuntimeDefault } = useActiveProviderSlice((s) => ({
    providers: s.providers,
    selectedId: s.selectedId,
    selectProvider: s.selectProvider,
    createProvider: s.createProvider,
    readinessById: s.readinessById,
    runtimeDefault: s.runtimeDefault,
    setRuntimeDefault: s.setRuntimeDefault,
  }));
  const availableModels = useAgentStore((state) => state.availableModels);
  const { showUsableOnly, setShowUsableOnly } = useActiveSettingsSlice((state) => ({
    showUsableOnly: state.showUsableProvidersOnly,
    setShowUsableOnly: state.setShowUsableProvidersOnly,
  }));
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const providerListRef = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();

  const usableProviders = useMemo(
    () => providers.filter((provider) =>
      isProviderUsable(provider, readinessById[provider.id])),
    [providers, readinessById],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (showUsableOnly ? usableProviders : providers).filter((provider) =>
      !query
      || provider.name.toLowerCase().includes(query)
      || provider.id.toLowerCase().includes(query),
    );
  }, [providers, search, showUsableOnly, usableProviders]);

  useEffect(() => {
    if (!showUsableOnly || usableProviders.length === 0) return;
    if (usableProviders.some((provider) => provider.id === selectedId)) return;
    void selectProvider(usableProviders[0].id);
  }, [selectProvider, selectedId, showUsableOnly, usableProviders]);

  const selectedProviderIsListed = filtered.some((provider) => provider.id === selectedId);
  useEffect(() => {
    if (!selectedId || !selectedProviderIsListed) return;
    const selectedRow = Array.from(
      providerListRef.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [],
    ).find((row) => row.dataset.itemId === selectedId);
    selectedRow?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, selectedProviderIsListed]);

  const makeDefault = async (providerId: string) => {
    const model = availableModels.find((candidate) =>
      candidate.provider_id === providerId
      && candidate.enabled
      && (candidate.type === 'chat' || !candidate.type),
    );
    if (!model) {
      toast.error(t('provider.menu.defaultNeedsModel'));
      return;
    }
    try {
      await setRuntimeDefault(providerId, model.id);
      toast.success(t('provider.menu.defaultSet'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'set runtime default failed');
    }
  };

  const renderItem = (p: typeof providers[0]) => {
    const isSelected = p.id === selectedId;
    const readiness = readinessById[p.id];
    const status = readiness?.status ?? mapProviderUIStatus(p).status;
    const dotColor = statusColor(status, token);
    const isDefaultProvider = runtimeDefault?.providerId === p.id;

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
        <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
          <Text strong ellipsis style={{ fontSize: 14 }}>{p.name}</Text>
          <Flexbox horizontal gap={4} style={{ flexWrap: 'wrap' }}>
            <Tag
              color={p.runtime_kind === 'cli' ? 'purple' : 'blue'}
              style={{ margin: 0, fontSize: 10, lineHeight: '16px', paddingInline: 6 }}
            >
              {t(`provider.runtime.${p.runtime_kind}`)}
            </Tag>
          </Flexbox>
        </Flexbox>
        <Button
          size="small"
          type="text"
          data-default-provider={isDefaultProvider ? 'true' : 'false'}
          icon={(
            <Star
              size={14}
              fill={isDefaultProvider ? token.colorWarning : 'none'}
              color={isDefaultProvider ? token.colorWarning : token.colorTextTertiary}
            />
          )}
          title={isDefaultProvider
            ? t('provider.menu.defaultCurrent')
            : t('provider.menu.setDefault')}
          onClick={(event) => {
            event.stopPropagation();
            void makeDefault(p.id);
          }}
        />
        <div
          title={t(`provider.menu.status.${status}`)}
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

      <Flexbox horizontal align="center" justify="space-between" style={{ minHeight: 32, padding: '0 4px' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('provider.menu.showUsableOnly')}
        </Text>
        <Switch
          size="small"
          checked={showUsableOnly}
          aria-label={t('provider.menu.showUsableOnly')}
          onChange={(checked) => {
            void setShowUsableOnly(checked).catch(() => {
              toast.error(t('provider.menu.preferenceSaveFailed'));
            });
          }}
        />
      </Flexbox>

      <Flexbox
        ref={providerListRef}
        flex={1}
        gap={4}
        style={{
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          paddingRight: 4,
          scrollbarWidth: 'thin',
        }}
      >
        {filtered.map(renderItem)}
        {filtered.length === 0 && (
          <Text type="secondary" style={{ padding: '16px 8px', fontSize: 12 }}>
            {showUsableOnly
              ? t('provider.menu.noUsableProviders')
              : t('provider.menu.noMatchingProviders')}
          </Text>
        )}
      </Flexbox>

      <CreateProviderModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={createProvider}
        providers={providers}
        onSelectProvider={async (providerId) => {
          if (showUsableOnly) await setShowUsableOnly(false);
          await selectProvider(providerId);
        }}
      />
    </Flexbox>
  );
}

function statusColor(status: ProviderReadinessStatus, token: {
  colorSuccess: string;
  colorError: string;
  colorWarning: string;
  colorTextTertiary: string;
  colorTextQuaternary: string;
  colorInfo: string;
}): string {
  switch (status) {
    case 'ready':
      return token.colorSuccess;
    case 'invalid':
    case 'error':
      return token.colorError;
    case 'unconfigured':
      return token.colorWarning;
    case 'checking':
    case 'loading':
      return token.colorInfo;
    case 'unavailable':
      return token.colorTextQuaternary;
    case 'unverified':
    default:
      return token.colorTextTertiary;
  }
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
  providers,
  onSelectProvider,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: { id: string; name: string; description?: string; logo?: string; base_url: string; api_key?: string }) => Promise<void>;
  providers: Array<{ id: string; name: string; runtime_kind: string }>;
  onSelectProvider: (providerId: string) => Promise<void>;
}) {
  const { t } = useTranslation('provider');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const providerKind = Form.useWatch<'direct' | 'cli'>('kind', form) ?? 'direct';
  const cliProviders = providers.filter((provider) => provider.runtime_kind === 'cli');

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      if (values.kind === 'cli') {
        await onSelectProvider(values.cli_provider_id);
      } else {
        await onCreate(values);
        toast.success(t('provider.menu.created'));
      }
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
          {providerKind === 'cli'
            ? t('provider.menu.configureBtn')
            : t('provider.menu.createBtn')}
        </Button>
      }
      destroyOnHidden
      width={520}
      afterOpenChange={(nextOpen) => {
        if (nextOpen) form.setFieldsValue({ kind: 'direct' });
      }}
    >
      <Form form={form} layout="horizontal" labelCol={{ span: 8 }} wrapperCol={{ span: 16 }} style={{ marginTop: 8 }}>
        <Form.Item name="kind" label={t('provider.menu.providerType')} initialValue="direct">
          <Radio.Group>
            <Radio value="direct" className="pt-provider-kind-direct">
              {t('provider.menu.directModel')}
            </Radio>
            <Radio value="cli" className="pt-provider-kind-cli">
              {t('provider.menu.cli')}
            </Radio>
          </Radio.Group>
        </Form.Item>

        {providerKind === 'cli' ? (
          <Form.Item
            name="cli_provider_id"
            label={t('provider.menu.registeredAdapter')}
            rules={[{ required: true, message: t('provider.menu.registeredAdapterRequired') }]}
          >
            <Select
              className="pt-provider-cli-adapter-select"
              options={cliProviders.map((provider) => ({
                value: provider.id,
                className: 'pt-provider-cli-adapter-option',
                label: (
                  <Flexbox horizontal align="center" gap={8}>
                    <TerminalSquare size={14} />
                    <span>{provider.name}</span>
                  </Flexbox>
                ),
              }))}
              placeholder={t('provider.menu.registeredAdapterPlaceholder')}
            />
          </Form.Item>
        ) : (
          <>
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
          <Input placeholder={t('provider.menu.providerLogoPlaceholder')} variant="filled" allowClear />
        </Form.Item>

        <SectionTitle>{t('provider.menu.configInfo')}</SectionTitle>

        <Form.Item
          name="base_url"
          label={t('provider.menu.proxyUrl')}
          rules={[{ required: true, message: t('provider.menu.proxyUrlRequired') }]}
        >
          <Input placeholder={t('provider.menu.proxyUrlPlaceholder')} variant="filled" />
        </Form.Item>

        <Form.Item name="api_key" label={t('provider.menu.apiKey')}>
          <InputPassword
            placeholder={t('provider.menu.apiKeyPlaceholder')}
            variant="filled"
            autoComplete="new-password"
          />
        </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}

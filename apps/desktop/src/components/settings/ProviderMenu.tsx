import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  Field,
  Icon,
  IconButton,
  Radio,
  Select,
  Switch,
  Tag,
  Text,
  TextField,
  TextArea,
} from '@peers-touch/ui';
import { ProviderIcon } from './ProviderIcon';
import { useTranslation } from 'react-i18next';
import { isProviderUsable, mapProviderUIStatus } from '../../store/providerReadiness';
import { useActiveProviderSlice, useActiveSettingsSlice } from './useActiveSettingsStores';
import { useAgentStore } from '../../store/agent';
import { notifyError, notifySuccess } from '../../ui/feedback';

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
    setShowUsableOnly: state.setShowUsableOnly,
  }));
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const providerListRef = useRef<HTMLDivElement>(null);

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
      notifyError(t('provider.menu.defaultNeedsModel'));
      return;
    }
    try {
      await setRuntimeDefault(providerId, model.id);
      notifySuccess(t('provider.menu.defaultSet'));
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'set runtime default failed');
    }
  };

  const renderItem = (p: typeof providers[0]) => {
    const isSelected = p.id === selectedId;
    const readiness = readinessById[p.id];
    const status = readiness?.status ?? mapProviderUIStatus(p).status;
    const isDefaultProvider = runtimeDefault?.providerId === p.id;

    return (
      <div
        key={p.id}
        className={`sc-provider-menu-row${isSelected ? ' is-selected' : ''}`}
        data-item-id={p.id}
        role="button"
        tabIndex={0}
        aria-current={isSelected}
        aria-label={p.name}
        onClick={() => selectProvider(p.id)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          selectProvider(p.id);
        }}
      >
        {p.logo ? (
          <img className="sc-provider-menu-row__logo" src={p.logo} alt="" width={28} height={28} />
        ) : (
          <ProviderIcon providerId={p.id} providerName={p.name} size={28} />
        )}
        <div className="sc-provider-menu-row__body">
          <Text strong truncate style={{ fontSize: 14 }}>{p.name}</Text>
          <span className="sc-provider-menu-row__tags">
            <Tag tone={p.runtime_kind === 'cli' ? 'info' : 'neutral'}>
              {t(`provider.runtime.${p.runtime_kind}`)}
            </Tag>
          </span>
        </div>
        <IconButton
          actionId={`provider-default-${p.id}`}
          data-default-provider={isDefaultProvider ? 'true' : 'false'}
          iconId="star"
          iconSize={14}
          density="compact"
          emphasis="quiet"
          className={isDefaultProvider
            ? 'sc-provider-menu-row__star is-default'
            : 'sc-provider-menu-row__star'}
          title={isDefaultProvider
            ? t('provider.menu.defaultCurrent')
            : t('provider.menu.setDefault')}
          label={isDefaultProvider
            ? t('provider.menu.defaultCurrent')
            : t('provider.menu.setDefault')}
          onActivate={(event) => {
            event.stopPropagation();
            void makeDefault(p.id);
          }}
        />
        <div
          className="sc-provider-menu-row__dot"
          data-provider-status={status}
          title={t(`provider.menu.status.${status}`)}
        />
      </div>
    );
  };

  return (
    <div className="sc-provider-menu">
      <div className="sc-provider-menu__search">
        <TextField
          clearable
          density="compact"
          leading={<Icon iconId="search" size={12} className="sc-provider-menu__search-icon" />}
          placeholder={t('provider.menu.searchPlaceholder')}
          value={search}
          onValueChange={setSearch}
        />
        <IconButton
          actionId="provider-add-custom"
          iconId="plus"
          iconSize={14}
          density="compact"
          label={t('provider.menu.addCustomProvider')}
          title={t('provider.menu.addCustomProvider')}
          onActivate={() => setShowCreate(true)}
        />
      </div>

      <div className="sc-provider-menu__filter">
        <Text tone="secondary" style={{ fontSize: 12 }}>
          {t('provider.menu.showUsableOnly')}
        </Text>
        <Switch
          checked={showUsableOnly}
          aria-label={t('provider.menu.showUsableOnly')}
          onCheckedChange={(checked) => {
            void setShowUsableOnly(checked).catch(() => {
              notifyError(t('provider.menu.preferenceSaveFailed'));
            });
          }}
        />
      </div>

      <div className="sc-provider-menu__list" ref={providerListRef}>
        {filtered.map(renderItem)}
        {filtered.length === 0 && (
          <Text tone="secondary" className="sc-provider-menu__empty">
            {showUsableOnly
              ? t('provider.menu.noUsableProviders')
              : t('provider.menu.noMatchingProviders')}
          </Text>
        )}
      </div>

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
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <>
      <hr className="sc-provider-section-divider" />
      <Text strong className="sc-provider-section-title">
        {children}
      </Text>
    </>
  );
}

type ProviderKind = 'direct' | 'cli';

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
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<ProviderKind>('direct');
  const [cliProviderId, setCliProviderId] = useState<string>('');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logo, setLogo] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  // Reset to direct whenever the modal opens (antd afterOpenChange parity).
  useEffect(() => {
    if (open) setKind('direct');
  }, [open]);

  const cliProviders = providers.filter((provider) => provider.runtime_kind === 'cli');

  const idValid = /^[\d_a-z-]+$/.test(id);
  const formInvalid = kind === 'cli'
    ? !cliProviderId
    : !id.trim() || !idValid || !baseUrl.trim();

  const submitLabel = kind === 'cli'
    ? t('provider.menu.configureBtn')
    : t('provider.menu.createBtn');

  const handleOk = async () => {
    if (formInvalid) return;
    setLoading(true);
    try {
      if (kind === 'cli') {
        await onSelectProvider(cliProviderId);
      } else {
        await onCreate({
          id,
          name: name || id,
          description: description || undefined,
          logo: logo || undefined,
          base_url: baseUrl,
          api_key: apiKey || undefined,
        });
        notifySuccess(t('provider.menu.created'));
      }
      setCliProviderId('');
      setId('');
      setName('');
      setDescription('');
      setLogo('');
      setBaseUrl('');
      setApiKey('');
      onClose();
    } catch (e: unknown) {
      if (e instanceof Error) notifyError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      width={520}
      title={(
        <span className="sc-provider-create-title">
          <Icon iconId="brain" size={18} />
          <span>{t('provider.menu.createTitle')}</span>
        </span>
      )}
      footer={
        <Button
          actionId="provider-create-submit"
          className="sc-provider-create-submit"
          emphasis="primary"
          execution={loading ? 'pending' : 'idle'}
          label={submitLabel}
          availability={formInvalid
            ? { kind: 'disabled', reason: submitLabel }
            : undefined}
          onActivate={() => void handleOk()}
        />
      }
    >
      <div className="sc-provider-create-form">
        <Field label={t('provider.menu.providerType')}>
          <div className="sc-provider-kind">
            <Radio
              name="provider-kind"
              value="direct"
              className="pt-provider-kind-direct"
              checked={kind === 'direct'}
              onChange={() => setKind('direct')}
            >
              {t('provider.menu.directModel')}
            </Radio>
            <Radio
              name="provider-kind"
              value="cli"
              className="pt-provider-kind-cli"
              checked={kind === 'cli'}
              onChange={() => setKind('cli')}
            >
              {t('provider.menu.cli')}
            </Radio>
          </div>
        </Field>

        {kind === 'cli' ? (
          <Field label={t('provider.menu.registeredAdapter')}>
            <Select
              className="pt-provider-cli-adapter-select"
              value={cliProviderId || undefined}
              placeholder={t('provider.menu.registeredAdapterPlaceholder')}
              options={cliProviders.map((provider) => ({
                value: provider.id,
                attributes: { className: 'pt-provider-cli-adapter-option' },
                label: (
                  <span className="sc-provider-cli-option">
                    <Icon iconId="terminal" size={14} />
                    <span>{provider.name}</span>
                  </span>
                ),
              }))}
              onValueChange={(value) => {
                if (typeof value === 'string') setCliProviderId(value);
              }}
            />
          </Field>
        ) : (
          <>
            <SectionTitle>{t('provider.menu.basicInfo')}</SectionTitle>

            <Field
              label={t('provider.menu.providerId')}
              description={t('provider.menu.providerIdExtra')}
              validation={id && !idValid
                ? { state: 'invalid', message: t('provider.menu.providerIdPattern') }
                : undefined}
            >
              <TextField
                placeholder={t('provider.menu.providerIdPlaceholder')}
                value={id}
                onValueChange={setId}
              />
            </Field>

            <Field label={t('provider.menu.providerName')}>
              <TextField
                placeholder={t('provider.menu.providerNamePlaceholder')}
                value={name}
                onValueChange={setName}
              />
            </Field>

            <Field label={t('provider.menu.providerDescription')}>
              <TextArea
                placeholder={t('provider.menu.providerDescPlaceholder')}
                rows={3}
                value={description}
                onValueChange={setDescription}
              />
            </Field>

            <Field label={t('provider.menu.providerLogo')}>
              <TextField
                clearable
                placeholder={t('provider.menu.providerLogoPlaceholder')}
                value={logo}
                onValueChange={setLogo}
              />
            </Field>

            <SectionTitle>{t('provider.menu.configInfo')}</SectionTitle>

            <Field label={t('provider.menu.proxyUrl')}>
              <TextField
                placeholder={t('provider.menu.proxyUrlPlaceholder')}
                value={baseUrl}
                onValueChange={setBaseUrl}
              />
            </Field>

            <Field label={t('provider.menu.apiKey')}>
              <TextField
                type="password"
                autoComplete="new-password"
                placeholder={t('provider.menu.apiKeyPlaceholder')}
                value={apiKey}
                onValueChange={setApiKey}
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

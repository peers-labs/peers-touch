import { useMemo, useState, type ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Divider, InputNumber, Modal, Select, Switch, Typography, theme } from 'antd';
import { Button, Input, Tag, TextArea, Tooltip, toast } from '@lobehub/ui';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  Image,
  RadioTower,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  api,
  type ModelItem,
  type ProviderDetail,
  type ProviderRuntimeConfig,
} from '../../services/desktop_api';
import { ProviderIcon } from './ProviderIcon';
import { useActiveProviderSlice } from './useActiveSettingsStores';

const { Text, Title } = Typography;

function runtimeConfigFromDetail(detail: ProviderDetail): ProviderRuntimeConfig {
  return {
    default_model: detail.runtime_config.default_model,
    startup_args: [...detail.runtime_config.startup_args],
    environment: { ...detail.runtime_config.environment },
    timeout_seconds: detail.runtime_config.timeout_seconds,
  };
}

function environmentToText(environment: Record<string, string>): string {
  return Object.entries(environment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

class EnvironmentEntryError extends Error {
  constructor(readonly line: number) {
    super(`invalid environment entry at line ${line}`);
  }
}

function parseEnvironment(value: string): Record<string, string> {
  const environment: Record<string, string> = {};
  value.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      throw new EnvironmentEntryError(index + 1);
    }
    environment[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1);
  });
  return environment;
}

function modelMatches(model: ModelItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    model.id,
    model.display_name,
    model.description,
    model.default_reasoning_level,
    ...(model.supported_reasoning_levels ?? []),
  ].some((value) => value?.toLowerCase().includes(normalized));
}

function formatContextWindow(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

export function CliProviderDetail({ detail }: { detail: ProviderDetail }) {
  const { t } = useTranslation('provider');
  const { token } = theme.useToken();
  const {
    checkProvider,
    discoverModels,
    readinessById,
    toggleProvider,
    updateProviderRuntimeConfig,
  } = useActiveProviderSlice((state) => ({
    checkProvider: state.checkProvider,
    discoverModels: state.discoverModels,
    readinessById: state.readinessById,
    toggleProvider: state.toggleProvider,
    updateProviderRuntimeConfig: state.updateProviderRuntimeConfig,
  }));
  const [runtimeConfig, setRuntimeConfig] = useState(() => runtimeConfigFromDetail(detail));
  const [startupArgs, setStartupArgs] = useState(
    () => detail.runtime_config.startup_args.join('\n'),
  );
  const [environment, setEnvironment] = useState(
    () => environmentToText(detail.runtime_config.environment),
  );
  const [enabled, setEnabled] = useState(detail.enabled);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [modelSearch, setModelSearch] = useState('');

  const readiness = readinessById[detail.id]?.status ?? 'loading';
  const readinessColor = readiness === 'ready'
    ? 'success'
    : readiness === 'invalid' || readiness === 'error'
      ? 'error'
      : readiness === 'saving' || readiness === 'checking'
        ? 'processing'
        : 'default';
  const models = useMemo(
    () => detail.models.filter((model) => modelMatches(model, modelSearch)),
    [detail.models, modelSearch],
  );
  const defaultModelOptions = useMemo(() => {
    const options = detail.models.map((model) => ({
      value: model.id,
      label: model.display_name || model.id,
    }));
    const registeredDefault = detail.default_runtime_config.default_model;
    if (registeredDefault && !options.some((option) => option.value === registeredDefault)) {
      options.unshift({ value: registeredDefault, label: registeredDefault });
    }
    return options;
  }, [detail.default_runtime_config.default_model, detail.models]);
  const capabilities = detail.adapter_capabilities;

  const save = async () => {
    setSaving(true);
    try {
      const next: ProviderRuntimeConfig = {
        ...runtimeConfig,
        startup_args: capabilities.startup_args
          ? startupArgs.split('\n').map((value) => value.trim()).filter(Boolean)
          : runtimeConfig.startup_args,
        environment: capabilities.environment
          ? parseEnvironment(environment)
          : runtimeConfig.environment,
      };
      await updateProviderRuntimeConfig(detail.id, next);
      toast.success(t('provider.cli.saved'));
    } catch (error) {
      toast.error(
        error instanceof EnvironmentEntryError
          ? t('provider.cli.environmentInvalid', { line: error.line })
          : error instanceof Error
            ? error.message
            : t('provider.cli.saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const restoreDefaults = () => {
    const defaults = detail.default_runtime_config;
    setRuntimeConfig({
      default_model: defaults.default_model,
      startup_args: [...defaults.startup_args],
      environment: { ...defaults.environment },
      timeout_seconds: defaults.timeout_seconds,
    });
    setStartupArgs(defaults.startup_args.join('\n'));
    setEnvironment(environmentToText(defaults.environment));
  };

  const check = async () => {
    setChecking(true);
    try {
      const result = await checkProvider(detail.id);
      if (result.ok) {
        toast.success(t('provider.cli.ready'));
      } else {
        toast.error(result.installHint || result.error || t('provider.cli.notReady'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('provider.cli.notReady'));
    } finally {
      setChecking(false);
    }
  };

  const discover = async () => {
    setDiscovering(true);
    try {
      const result = await discoverModels(detail.id);
      toast.success(t('provider.cli.discovered', { count: result.count }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('provider.cli.discoveryFailed'));
    } finally {
      setDiscovering(false);
    }
  };

  const toggleEnabled = async (next: boolean) => {
    if (!next) {
      try {
        const references = await api.getProviderReferences(detail.id);
        if (references.length > 0) {
          Modal.confirm({
            title: t('provider.detail.disableConfirm.title'),
            content: t('provider.detail.disableConfirm.note'),
            okText: t('provider.detail.disableConfirm.ok'),
            cancelText: t('provider.detail.disableConfirm.cancel'),
            onOk: async () => {
              setEnabled(false);
              try {
                await toggleProvider(detail.id, false);
              } catch {
                setEnabled(true);
                toast.error(t('provider.detail.failedToToggle'));
              }
            },
          });
          return;
        }
      } catch {
        // Station remains authoritative; continue with the explicit toggle.
      }
    }
    setEnabled(next);
    try {
      await toggleProvider(detail.id, next);
    } catch {
      setEnabled(!next);
      toast.error(t('provider.detail.failedToToggle'));
    }
  };

  return (
    <Flexbox
      gap={0}
      style={{
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        padding: '18px 24px 24px',
      }}
    >
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        gap={16}
        style={{ paddingBottom: 16, borderBottom: `1px solid ${token.colorBorderSecondary}` }}
      >
        <Flexbox horizontal align="center" gap={12} style={{ minWidth: 0 }}>
          <ProviderIcon providerId={detail.id} providerName={detail.name} size={32} />
          <Flexbox gap={2} style={{ minWidth: 0 }}>
            <Flexbox horizontal align="center" gap={8}>
              <Title level={5} ellipsis style={{ margin: 0, fontSize: 16 }}>
                {detail.name}
              </Title>
              <Tag color="gold" bordered={false} style={{ margin: 0 }}>
                {t('provider.runtime.cli')}
              </Tag>
              <Tag color={readinessColor} bordered={false} style={{ margin: 0 }}>
                {t(`provider.readiness.${readiness}`)}
              </Tag>
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('provider.cli.subtitle')}
            </Text>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={8} style={{ flexShrink: 0 }}>
          <Button
            icon={<CheckCircle2 size={14} />}
            loading={checking}
            onClick={check}
          >
            {t('provider.cli.check')}
          </Button>
          <Switch
            checked={enabled}
            aria-label={t('provider.cli.enabled')}
            onChange={toggleEnabled}
          />
        </Flexbox>
      </Flexbox>

      <Flexbox gap={0} style={{ padding: '4px 0 0' }}>
        <CliField
          label={t('provider.cli.defaultModel')}
          description={t('provider.cli.defaultModelDesc')}
        >
          <Select
            value={runtimeConfig.default_model || undefined}
            options={defaultModelOptions}
            onChange={(value) => setRuntimeConfig((current) => ({
              ...current,
              default_model: value,
            }))}
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
          />
        </CliField>

        {capabilities.startup_args && (
          <CliField
            label={t('provider.cli.startupArgs')}
            description={t('provider.cli.startupArgsDesc')}
          >
            <TextArea
              value={startupArgs}
              onChange={(event) => setStartupArgs(event.target.value)}
              rows={3}
              style={{ width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
            />
          </CliField>
        )}

        {capabilities.environment && (
          <CliField
            label={t('provider.cli.environment')}
            description={t('provider.cli.environmentDesc')}
          >
            <TextArea
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              rows={3}
              style={{ width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
            />
          </CliField>
        )}

        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
          style={{
            width: '100%',
            minHeight: 40,
            padding: 0,
            border: 0,
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            background: 'transparent',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: token.colorTextSecondary,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {t('provider.cli.advanced')}
        </button>

        {advancedOpen && (
          <Flexbox gap={0} style={{ paddingLeft: 22 }}>
            <CliField
              label={t('provider.cli.command')}
              description={t('provider.cli.commandDesc')}
            >
              <Input
                readOnly
                value={detail.cli_command}
                style={{ width: '100%', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }}
              />
            </CliField>
            <CliField label={t('provider.cli.workspace')}>
              <Input
                readOnly
                value={t(
                  `provider.cli.workspacePolicy.${detail.workspace_policy || 'unknown'}`,
                  { defaultValue: detail.workspace_policy || t('provider.cli.workspacePolicy.unknown') },
                )}
                style={{ width: '100%' }}
              />
            </CliField>
            {capabilities.configurable_timeout && (
              <CliField label={t('provider.cli.timeout')}>
                <Flexbox horizontal align="center" gap={8}>
                  <InputNumber
                    min={10}
                    max={3600}
                    value={runtimeConfig.timeout_seconds}
                    onChange={(value) => setRuntimeConfig((current) => ({
                      ...current,
                      timeout_seconds: Number(value || 10),
                    }))}
                    style={{ width: 120 }}
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('provider.cli.seconds')}
                  </Text>
                </Flexbox>
              </CliField>
            )}
            <CliField label={t('provider.cli.capabilities')}>
              <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
                {capabilities.runtime_capabilities.map((capability) => (
                  <Tag key={capability} color="cyan" style={{ margin: 0 }}>
                    {t(`provider.cli.capability.${capability}`, { defaultValue: capability })}
                  </Tag>
                ))}
              </Flexbox>
            </CliField>
          </Flexbox>
        )}

        <Flexbox
          horizontal
          justify="flex-end"
          gap={8}
          style={{ padding: '14px 0 18px', borderTop: `1px solid ${token.colorBorderSecondary}` }}
        >
          <Button icon={<RotateCcw size={14} />} onClick={restoreDefaults}>
            {t('provider.cli.restoreDefaults')}
          </Button>
          <Button type="primary" icon={<Save size={14} />} loading={saving} onClick={save}>
            {t('provider.cli.save')}
          </Button>
        </Flexbox>
      </Flexbox>

      <Divider style={{ margin: 0 }} />

      <Flexbox gap={12} style={{ paddingTop: 18, minHeight: 240 }}>
        <Flexbox horizontal align="center" justify="space-between" gap={12}>
          <Flexbox gap={2}>
            <Title level={5} style={{ margin: 0, fontSize: 14 }}>
              {t('provider.cli.models')}
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('provider.cli.modelsDesc', { count: detail.models.length })}
            </Text>
          </Flexbox>
          {capabilities.model_discovery && (
            <Button
              icon={<RefreshCw size={14} />}
              loading={discovering}
              onClick={discover}
            >
              {t('provider.cli.refreshModels')}
            </Button>
          )}
        </Flexbox>

        {detail.models.length > 0 && (
          <Input
            prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
            value={modelSearch}
            onChange={(event) => setModelSearch(event.target.value)}
            placeholder={t('provider.model.searchModels')}
            allowClear
          />
        )}

        <div data-ui-rows="cli-provider-models">
          {models.map((model, index) => (
            <Flexbox
              key={model.id}
              data-ui-row={model.id}
              horizontal
              align="center"
              gap={12}
              style={{
                minHeight: 54,
                padding: '8px 2px',
                borderBottom: index < models.length - 1
                  ? `1px solid ${token.colorBorderSecondary}`
                  : undefined,
              }}
            >
              <Flexbox flex={1} gap={2} style={{ minWidth: 0 }} data-ui-column="content">
                <Text strong ellipsis style={{ fontSize: 13 }}>
                  {model.display_name || model.id}
                </Text>
                <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                  {model.description || model.id}
                </Text>
              </Flexbox>
              <Flexbox
                horizontal
                align="center"
                gap={6}
                data-ui-column="metadata"
                data-ui-column-align="end"
                style={{ flexShrink: 0 }}
              >
                {model.context_window > 0 && <Tag style={{ margin: 0 }}>{formatContextWindow(model.context_window)}</Tag>}
                {model.streaming && <Tooltip title={t('provider.model.capability.streaming')}><RadioTower size={13} /></Tooltip>}
                {model.function_call && <Tooltip title={t('provider.model.capability.toolUse')}><Wrench size={13} /></Tooltip>}
                {model.vision && <Tooltip title={t('provider.model.capability.vision')}><Eye size={13} /></Tooltip>}
                {model.reasoning && <Tooltip title={t('provider.model.capability.deepThinking')}><Sparkles size={13} /></Tooltip>}
                {model.image_output && <Tooltip title={t('provider.model.capability.imageOutput')}><Image size={13} /></Tooltip>}
              </Flexbox>
            </Flexbox>
          ))}
          {models.length === 0 && (
            <Flexbox align="center" gap={4} style={{ padding: '28px 0' }}>
              <Text strong>{t('provider.cli.noModels')}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {capabilities.model_discovery
                  ? t('provider.cli.noModelsRefresh')
                  : t('provider.cli.noModelsStatic')}
              </Text>
            </Flexbox>
          )}
        </div>
      </Flexbox>
    </Flexbox>
  );
}

function CliField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      gap={8}
      style={{
        padding: '14px 0',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Flexbox gap={2}>
        <Text strong style={{ fontSize: 13 }}>{label}</Text>
        {description && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {description}
          </Text>
        )}
      </Flexbox>
      {children}
    </Flexbox>
  );
}

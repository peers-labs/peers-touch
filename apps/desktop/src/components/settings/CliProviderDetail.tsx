import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  Divider,
  Field,
  Icon,
  NumberField,
  Select,
  Switch,
  Tag,
  Text,
  TextField,
  TextArea,
  Tooltip,
  type Tone,
} from '@peers-touch/ui';
import { useTranslation } from 'react-i18next';

import {
  api,
  type ModelItem,
  type ProviderDetail,
  type ProviderRuntimeConfig,
} from '../../services/desktop_api';
import { ProviderIcon } from './ProviderIcon';
import { useActiveProviderSlice } from './useActiveSettingsStores';
import { confirmRequest, notifyError, notifySuccess } from '../../ui/feedback';

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

function readinessTone(readiness: string): Tone {
  if (readiness === 'ready') return 'success';
  if (readiness === 'invalid' || readiness === 'error') return 'danger';
  if (readiness === 'saving' || readiness === 'checking') return 'info';
  return 'neutral';
}

export function CliProviderDetail({ detail }: { detail: ProviderDetail }) {
  const { t } = useTranslation('provider');
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
      notifySuccess(t('provider.cli.saved'));
    } catch (error) {
      notifyError(
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
        notifySuccess(t('provider.cli.ready'));
      } else {
        notifyError(result.installHint || result.error || t('provider.cli.notReady'));
      }
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t('provider.cli.notReady'));
    } finally {
      setChecking(false);
    }
  };

  const discover = async () => {
    setDiscovering(true);
    try {
      const result = await discoverModels(detail.id);
      notifySuccess(t('provider.cli.discovered', { count: result.count }));
    } catch (error) {
      notifyError(error instanceof Error ? error.message : t('provider.cli.discoveryFailed'));
    } finally {
      setDiscovering(false);
    }
  };

  const toggleEnabled = async (next: boolean) => {
    if (!next) {
      try {
        const references = await api.getProviderReferences(detail.id);
        if (references.length > 0) {
          const confirmed = await confirmRequest({
            tone: 'warning',
            title: t('provider.detail.disableConfirm.title'),
            description: t('provider.detail.disableConfirm.note'),
            confirmLabel: t('provider.detail.disableConfirm.ok'),
            cancelLabel: t('provider.detail.disableConfirm.cancel'),
          });
          if (!confirmed) return;
          setEnabled(false);
          try {
            await toggleProvider(detail.id, false);
          } catch {
            setEnabled(true);
            notifyError(t('provider.detail.failedToToggle'));
          }
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
      notifyError(t('provider.detail.failedToToggle'));
    }
  };

  return (
    <div className="sc-cli-detail">
      <div className="sc-cli-detail__header">
        <div className="sc-cli-detail__identity">
          <ProviderIcon providerId={detail.id} providerName={detail.name} size={32} />
          <div className="sc-cli-detail__identity-text">
            <div className="sc-cli-detail__title-row">
              <Text strong truncate className="sc-cli-detail__title">
                {detail.name}
              </Text>
              <Tag tone="warning">{t('provider.runtime.cli')}</Tag>
              <Tag tone={readinessTone(readiness)}>
                {t(`provider.readiness.${readiness}`)}
              </Tag>
            </div>
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {t('provider.cli.subtitle')}
            </Text>
          </div>
        </div>
        <div className="sc-cli-detail__header-actions">
          <Button
            actionId="cli-provider-check"
            leading={<Icon iconId="circle-check-big" size={14} />}
            execution={checking ? 'pending' : 'idle'}
            label={t('provider.cli.check')}
            onActivate={() => void check()}
          />
          <Switch
            checked={enabled}
            aria-label={t('provider.cli.enabled')}
            onCheckedChange={(value) => void toggleEnabled(value)}
          />
        </div>
      </div>

      <div className="sc-cli-detail__body">
        <CliField
          label={t('provider.cli.defaultModel')}
          description={t('provider.cli.defaultModelDesc')}
        >
          <Select
            searchable
            value={runtimeConfig.default_model || undefined}
            options={defaultModelOptions}
            onValueChange={(value) => {
              if (typeof value === 'string') {
                setRuntimeConfig((current) => ({ ...current, default_model: value }));
              }
            }}
          />
        </CliField>

        {capabilities.startup_args && (
          <CliField
            label={t('provider.cli.startupArgs')}
            description={t('provider.cli.startupArgsDesc')}
          >
            <TextArea
              value={startupArgs}
              onValueChange={setStartupArgs}
              rows={3}
              className="sc-cli-detail__mono"
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
              onValueChange={setEnvironment}
              rows={3}
              className="sc-cli-detail__mono"
            />
          </CliField>
        )}

        <Button
          actionId="cli-detail-advanced-toggle"
          className="sc-cli-detail__advanced"
          emphasis="quiet"
          aria-expanded={advancedOpen}
          leading={<Icon iconId={advancedOpen ? 'chevron-down' : 'chevron-right'} size={14} />}
          onActivate={() => setAdvancedOpen((open) => !open)}
        >
          {t('provider.cli.advanced')}
        </Button>

        {advancedOpen && (
          <div className="sc-cli-detail__advanced-body">
            <CliField
              label={t('provider.cli.command')}
              description={t('provider.cli.commandDesc')}
            >
              <TextField
                readOnly
                value={detail.cli_command}
                className="sc-cli-detail__mono"
              />
            </CliField>
            <CliField label={t('provider.cli.workspace')}>
              <TextField
                readOnly
                value={t(
                  `provider.cli.workspacePolicy.${detail.workspace_policy || 'unknown'}`,
                  {
                    defaultValue:
                      detail.workspace_policy || t('provider.cli.workspacePolicy.unknown'),
                  },
                )}
              />
            </CliField>
            {capabilities.configurable_timeout && (
              <CliField label={t('provider.cli.timeout')}>
                <div className="sc-cli-detail__timeout">
                  <NumberField
                    min={10}
                    max={3600}
                    value={runtimeConfig.timeout_seconds}
                    style={{ width: 120 }}
                    onValueChange={(value) => setRuntimeConfig((current) => ({
                      ...current,
                      timeout_seconds: Number(value || 10),
                    }))}
                  />
                  <Text tone="secondary" style={{ fontSize: 12 }}>
                    {t('provider.cli.seconds')}
                  </Text>
                </div>
              </CliField>
            )}
            <CliField label={t('provider.cli.capabilities')}>
              <div className="sc-cli-detail__capabilities">
                {capabilities.runtime_capabilities.map((capability) => (
                  <Tag key={capability} tone="info">
                    {t(`provider.cli.capability.${capability}`, { defaultValue: capability })}
                  </Tag>
                ))}
              </div>
            </CliField>
          </div>
        )}

        <div className="sc-cli-detail__form-actions">
          <Button
            actionId="cli-provider-restore"
            leading={<Icon iconId="rotate-ccw" size={14} />}
            label={t('provider.cli.restoreDefaults')}
            onActivate={restoreDefaults}
          />
          <Button
            actionId="cli-provider-save"
            emphasis="primary"
            leading={<Icon iconId="save" size={14} />}
            execution={saving ? 'pending' : 'idle'}
            label={t('provider.cli.save')}
            onActivate={() => void save()}
          />
        </div>
      </div>

      <Divider />

      <div className="sc-cli-detail__models">
        <div className="sc-cli-detail__models-head">
          <div className="sc-cli-detail__models-title">
            <Text strong style={{ fontSize: 14 }}>{t('provider.cli.models')}</Text>
            <Text tone="secondary" style={{ fontSize: 12 }}>
              {t('provider.cli.modelsDesc', { count: detail.models.length })}
            </Text>
          </div>
          {capabilities.model_discovery && (
            <Button
              actionId="cli-provider-discover"
              leading={<Icon iconId="refresh-cw" size={14} />}
              execution={discovering ? 'pending' : 'idle'}
              label={t('provider.cli.refreshModels')}
              onActivate={() => void discover()}
            />
          )}
        </div>

        {detail.models.length > 0 && (
          <TextField
            clearable
            leading={<Icon iconId="search" size={14} />}
            value={modelSearch}
            placeholder={t('provider.model.searchModels')}
            onValueChange={setModelSearch}
          />
        )}

        <div data-ui-rows="cli-provider-models">
          {models.map((model, index) => (
            <div
              key={model.id}
              data-ui-row={model.id}
              className="sc-cli-model-row"
              data-border={index < models.length - 1 ? 'true' : 'false'}
            >
              <div className="sc-cli-model-row__content" data-ui-column="content">
                <Text strong truncate style={{ fontSize: 13 }}>
                  {model.display_name || model.id}
                </Text>
                <Text tone="secondary" truncate style={{ fontSize: 11 }}>
                  {model.description || model.id}
                </Text>
              </div>
              <div
                className="sc-cli-model-row__meta"
                data-ui-column="metadata"
                data-ui-column-align="end"
              >
                {model.context_window > 0 && <Tag>{formatContextWindow(model.context_window)}</Tag>}
                {model.streaming && (
                  <Tooltip label={t('provider.model.capability.streaming')}>
                    <Icon iconId="radio-tower" size={13} />
                  </Tooltip>
                )}
                {model.function_call && (
                  <Tooltip label={t('provider.model.capability.toolUse')}>
                    <Icon iconId="wrench" size={13} />
                  </Tooltip>
                )}
                {model.vision && (
                  <Tooltip label={t('provider.model.capability.vision')}>
                    <Icon iconId="eye" size={13} />
                  </Tooltip>
                )}
                {model.reasoning && (
                  <Tooltip label={t('provider.model.capability.deepThinking')}>
                    <Icon iconId="sparkles" size={13} />
                  </Tooltip>
                )}
                {model.image_output && (
                  <Tooltip label={t('provider.model.capability.imageOutput')}>
                    <Icon iconId="image" size={13} />
                  </Tooltip>
                )}
              </div>
            </div>
          ))}
          {models.length === 0 && (
            <div className="sc-cli-model-row__empty">
              <Text strong>{t('provider.cli.noModels')}</Text>
              <Text tone="secondary" style={{ fontSize: 12 }}>
                {capabilities.model_discovery
                  ? t('provider.cli.noModelsRefresh')
                  : t('provider.cli.noModelsStatic')}
              </Text>
            </div>
          )}
        </div>
      </div>
    </div>
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
  return (
    <Field label={label} description={description} className="sc-cli-field">
      {children}
    </Field>
  );
}

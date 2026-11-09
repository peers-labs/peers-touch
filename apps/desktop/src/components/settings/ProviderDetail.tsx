import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  Divider,
  Empty,
  Field,
  Flex,
  Icon,
  IconButton,
  NumberField,
  Select,
  Slider,
  Spin,
  Switch,
  Tag,
  Text,
  TextField,
  Tooltip,
  type Tone,
} from '@peers-touch/ui';
import { UpdateProviderModal } from './UpdateProviderModal';
import { CliProviderDetail } from './CliProviderDetail';
import { api, type ProviderDetail as ProviderDetailRecord } from '../../services/desktop_api';
import { useTranslation } from 'react-i18next';
import { useActiveProviderSlice } from './useActiveSettingsStores';
import { SettingsSection, SettingsRow } from './SettingsLayout';
import {
  confirmRequest,
  notifyError,
  notifySuccess,
  notifyWarning,
} from '../../ui/feedback';

const CONTEXT_MARKS: Record<number, string> = {
  0: '0',
  1: '4K',
  2: '8K',
  3: '16K',
  4: '32K',
  5: '64K',
  6: '128K',
  7: '200K',
  8: '1M',
  9: '2M',
};
const CONTEXT_TICKS = Object.entries(CONTEXT_MARKS).map(([value, label]) => ({
  value: Number(value),
  label,
}));
const CONTEXT_VALUES = [0, 4000, 8000, 16000, 32000, 64000, 128000, 200000, 1000000, 2000000];

function contextToSlider(v: number): number {
  for (let i = CONTEXT_VALUES.length - 1; i >= 0; i--) {
    if (v >= CONTEXT_VALUES[i]) return i;
  }
  return 0;
}
function sliderToContext(i: number): number {
  return CONTEXT_VALUES[i] ?? 0;
}
function formatContextWindow(v: number): string {
  if (v >= 1000000) return `${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}K`;
  return String(v);
}

function readinessTone(readiness: string): Tone {
  if (readiness === 'ready') return 'success';
  if (readiness === 'invalid' || readiness === 'error') return 'danger';
  if (readiness === 'saving' || readiness === 'checking') return 'info';
  return 'neutral';
}

interface ModelCapabilityField {
  key:
    | 'streaming'
    | 'function_call'
    | 'vision'
    | 'reasoning'
    | 'search'
    | 'image_output'
    | 'video';
  labelKey: string;
  extraKey: string;
}

const MODEL_CAPABILITIES: readonly ModelCapabilityField[] = [
  { key: 'streaming', labelKey: 'provider.addModel.supportStreaming', extraKey: 'provider.addModel.supportStreamingExtra' },
  { key: 'function_call', labelKey: 'provider.addModel.supportToolUse', extraKey: 'provider.addModel.supportToolUseExtra' },
  { key: 'vision', labelKey: 'provider.addModel.supportVision', extraKey: 'provider.addModel.supportVisionExtra' },
  { key: 'reasoning', labelKey: 'provider.addModel.supportDeepThinking', extraKey: 'provider.addModel.supportDeepThinkingExtra' },
  { key: 'search', labelKey: 'provider.addModel.supportSearch', extraKey: 'provider.addModel.supportSearchExtra' },
  { key: 'image_output', labelKey: 'provider.addModel.supportImageGen', extraKey: 'provider.addModel.supportImageGenExtra' },
  { key: 'video', labelKey: 'provider.addModel.supportVideo', extraKey: 'provider.addModel.supportVideoExtra' },
];

const MODEL_TYPE_OPTIONS = [
  'chat',
  'image',
  'video',
  'embedding',
  'stt',
  'tts',
  'realtime',
] as const;

export function ProviderDetail() {
  const { t } = useTranslation('provider');
  const { detail, loading, selectedId } = useActiveProviderSlice((state) => ({
    detail: state.detail,
    loading: state.loading,
    selectedId: state.selectedId,
  }));

  if (loading && !detail) {
    return (
      <Flex align="center" justify="center" className="sc-provider-detail__state">
        <Spin active />
      </Flex>
    );
  }

  if (!detail) {
    return (
      <Flex align="center" justify="center" className="sc-provider-detail__state">
        <Text tone="secondary">{t('provider.detail.selectProvider')}</Text>
      </Flex>
    );
  }

  if (selectedId && detail.id !== selectedId) {
    return (
      <Flex align="center" justify="center" className="sc-provider-detail__state">
        <Spin active />
      </Flex>
    );
  }

  if (detail.runtime_kind === 'cli') {
    return <CliProviderDetail key={`${detail.id}:${detail.version}`} detail={detail} />;
  }

  return (
    <DirectProviderDetail
      key={`${detail.id}:${detail.version}`}
      detail={detail}
    />
  );
}

interface ModelFormState {
  id: string;
  display_name: string;
  type: string;
  contextWindow: number;
  enabled: boolean;
  streaming: boolean;
  function_call: boolean;
  vision: boolean;
  reasoning: boolean;
  search: boolean;
  image_output: boolean;
  video: boolean;
}

function DirectProviderDetail({ detail }: { detail: ProviderDetailRecord }) {
  const { t } = useTranslation('provider');
  const {
    updateProvider, toggleProvider,
    checkProvider, deleteProvider, addModel, updateModel, deleteModel,
    toggleModel, readinessById,
  } = useActiveProviderSlice((s) => ({
    updateProvider: s.updateProvider,
    toggleProvider: s.toggleProvider,
    checkProvider: s.checkProvider,
    deleteProvider: s.deleteProvider,
    addModel: s.addModel,
    updateModel: s.updateModel,
    deleteModel: s.deleteModel,
    toggleModel: s.toggleModel,
    readinessById: s.readinessById,
  }));
  const [apiKey, setApiKey] = useState(detail.api_key);
  const [baseUrl, setBaseUrl] = useState(
    detail.base_url || detail.default_base_url || '',
  );
  const [enabled, setEnabled] = useState(detail.enabled);
  const [checking, setChecking] = useState(false);
  const [checkPass, setCheckPass] = useState(false);
  const [checkModel, setCheckModel] = useState(
    detail.check_model || detail.models[0]?.id || '',
  );
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [modelSearchKeyword, setModelSearchKeyword] = useState('');
  const [editModel, setEditModel] = useState<{ id: string; display_name?: string; type?: string; context_window?: number; enabled?: boolean; streaming?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const debouncedSave = useCallback(
    (key: string, url: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await updateProvider(detail.id, key, url, detail.enabled);
        } catch {
          notifyError(t('provider.detail.saveFailed'));
        }
      }, 800);
    },
    [detail, t, updateProvider],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleApiKeyChange = useCallback(
    (val: string) => {
      setApiKey(val);
      debouncedSave(val, baseUrl);
    },
    [baseUrl, debouncedSave],
  );

  const handleBaseUrlChange = useCallback(
    (val: string) => {
      setBaseUrl(val);
      debouncedSave(apiKey, val);
    },
    [apiKey, debouncedSave],
  );

  const allModels = useMemo(() => detail.models, [detail.models]);
  const filteredModels = useMemo(() => {
    const kw = modelSearchKeyword.trim().toLowerCase();
    if (!kw) return allModels;
    return allModels.filter((m) =>
      (m.id || '').toLowerCase().includes(kw) ||
      (m.display_name || '').toLowerCase().includes(kw),
    );
  }, [allModels, modelSearchKeyword]);

  const handleCheck = async () => {
    if (!checkModel) {
      notifyWarning(t('provider.detail.checkWarning'));
      return;
    }
    setChecking(true);
    setCheckPass(false);
    try {
      const result = await checkProvider(detail.id, apiKey || undefined, baseUrl || undefined, checkModel);
      if (result.ok) {
        setCheckPass(true);
        notifySuccess(t('provider.detail.connectionSuccessful'));
      } else {
        notifyError(result.error || t('provider.detail.connectionFailed'));
      }
    } catch {
      notifyError(t('provider.detail.connectionCheckFailed'));
    } finally {
      setChecking(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProvider(detail.id);
      notifySuccess(t('provider.detail.deleted'));
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : t('provider.detail.failedToDelete'));
    }
  };

  const requestDelete = () => {
    void confirmRequest({
      tone: 'danger',
      title: t('provider.detail.deleteConfirm.title'),
      description: t('provider.detail.deleteConfirm.content', { name: detail.name }),
      confirmLabel: t('provider.detail.deleteConfirm.ok'),
      cancelLabel: t('provider.detail.disableConfirm.cancel'),
      onConfirm: () => void handleDelete(),
    });
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      await deleteModel(detail.id, modelId);
      notifySuccess(t('provider.model.removed'));
    } catch (e: unknown) {
      notifyError(e instanceof Error ? e.message : t('provider.model.failedToRemove'));
    }
  };

  const handleToggleEnabled = async (checked: boolean) => {
    if (!checked) {
      try {
        const refs = await api.getProviderReferences(detail.id);
        if (refs.length > 0) {
          const slotNames = refs
            .map((r) => `• ${r.slot || r.service || r.key || 'default'} (${r.model})`)
            .join('\n');
          const confirmed = await confirmRequest({
            tone: 'warning',
            title: t('provider.detail.disableConfirm.title'),
            description: (
              <div className="sc-provider-disable">
                <p>{t('provider.detail.disableConfirm.desc')}</p>
                <pre className="sc-provider-disable__list">{slotNames}</pre>
                <p>{t('provider.detail.disableConfirm.note')}</p>
              </div>
            ),
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

    setEnabled(checked);
    try {
      await toggleProvider(detail.id, checked);
    } catch {
      setEnabled(!checked);
      notifyError(t('provider.detail.failedToToggle'));
    }
  };

  const readiness = readinessById[detail.id]?.status ?? 'loading';
  const isUnconfigured = readiness === 'unconfigured' && apiKey.trim().length === 0;
  const [showKey, setShowKey] = useState(false);
  const checkModelOptions = allModels.map((m) => ({
    value: m.id,
    label: m.display_name || m.id,
    searchText: `${m.id} ${m.display_name || m.id}`,
  }));

  return (
    <div className="sc-provider-detail">
      <SettingsSection
        title={detail.name}
        extra={
          <Flex direction="row" gap={8} align="center" className="sc-provider-detail__actions">
            <Tag tone={detail.runtime_kind === 'cli' ? 'warning' : 'info'}>
              {t(`provider.runtime.${detail.runtime_kind}`)}
            </Tag>
            {isUnconfigured ? (
              <Tag tone="neutral">{t('provider.detail.notConfigured')}</Tag>
            ) : (
              <Tag tone={readinessTone(readiness)}>
                {t(`provider.readiness.${readiness}`)}
              </Tag>
            )}
            {detail.show_checker && (
              <Button
                actionId="provider-connection-check"
                emphasis="secondary"
                density="compact"
                className={checkPass ? 'sc-provider-check__pass' : undefined}
                leading={
                  checking
                    ? <Icon iconId="refresh-cw" size={14} className="sk-spin" />
                    : checkPass
                      ? <Icon iconId="circle-check-big" size={14} />
                      : <Icon iconId="activity" size={14} />
                }
                execution={checking ? 'pending' : 'idle'}
                availability={!checkModel
                  ? { kind: 'disabled', reason: t('provider.detail.checkWarning') }
                  : undefined}
                label={checking
                  ? t('provider.detail.checking')
                  : checkPass ? t('provider.detail.checkPass') : t('provider.detail.check')}
                onActivate={() => void handleCheck()}
              />
            )}
            <Tooltip label={t('provider.detail.providerSettings')}>
              <IconButton
                actionId="provider-edit-settings"
                iconId="settings-2"
                iconSize={14}
                density="compact"
                emphasis="quiet"
                label={t('provider.detail.providerSettings')}
                onActivate={() => setShowEditModal(true)}
              />
            </Tooltip>
            {!detail.builtin && (
              <Tooltip label={t('provider.detail.delete')}>
                <IconButton
                  actionId="provider-delete"
                  iconId="delete"
                  iconSize={14}
                  density="compact"
                  emphasis="quiet"
                  tone="danger"
                  label={t('provider.detail.delete')}
                  onActivate={requestDelete}
                />
              </Tooltip>
            )}
          </Flex>
        }
      >
        <SettingsRow
          label={t('provider.detail.enabled')}
          description={t('provider.detail.enabledDesc')}
        >
          <Switch
            data-pt-provider-enabled-toggle={detail.id}
            checked={enabled}
            aria-label={t('provider.detail.enabled')}
            onCheckedChange={(value) => void handleToggleEnabled(value)}
          />
        </SettingsRow>

        {detail.show_api_key !== false && (
          <SettingsRow
            label={t('provider.detail.apiKey')}
            description={
              detail.api_key_url ? (
                <>
                  {t('provider.detail.apiKeyDescWithLink', { name: detail.name })}{' '}
                  <a
                    className="pt-link"
                    href={detail.api_key_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('provider.detail.getApiKey')}{' '}
                    <Icon iconId="external-link" size={10} />
                  </a>
                </>
              ) : (
                t('provider.detail.apiKeyDesc', { name: detail.name })
              )
            }
          >
            <span className="sk-key-row">
              <TextField
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onValueChange={handleApiKeyChange}
                placeholder={detail.has_api_key && !apiKey ? '••••••••••••••••' : t('provider.detail.apiKeyPlaceholder')}
                autoComplete="new-password"
                aria-label={t('provider.detail.apiKey')}
              />
              <IconButton
                actionId="provider-toggle-key"
                iconId={showKey ? 'eye-off' : 'eye'}
                iconSize={14}
                density="compact"
                emphasis="quiet"
                label={showKey ? 'Hide' : 'Show'}
                onActivate={() => setShowKey((v) => !v)}
              />
            </span>
          </SettingsRow>
        )}

        <SettingsRow
          label={t('provider.detail.apiProxyUrl')}
          description={t('provider.detail.apiProxyUrlDesc')}
        >
          <TextField
            clearable
            value={baseUrl}
            onValueChange={handleBaseUrlChange}
            placeholder={detail.default_base_url || t('provider.detail.apiProxyUrlPlaceholder')}
            aria-label={t('provider.detail.apiProxyUrl')}
            style={{ width: 280 }}
          />
        </SettingsRow>

        {detail.show_checker && (
          <SettingsRow
            vertical
            label={t('provider.detail.connectivityCheck')}
            description={t('provider.detail.connectivityCheckDesc')}
          >
            <span className="sk-key-row">
              <Select
                searchable
                createValue={(query) => query}
                value={checkModel || undefined}
                options={checkModelOptions}
                placeholder={t('provider.detail.enterModelId')}
                onValueChange={(value) => {
                  if (typeof value === 'string') {
                    setCheckModel(value);
                    setCheckPass(false);
                  }
                }}
              />
            </span>
          </SettingsRow>
        )}

        <div className="sc-provider-notice">
          <Icon iconId="lock" size={12} />
          <span>{t('provider.detail.encryptionNotice')}</span>
        </div>

        <div className="sk-model-list" data-pt-provider-models={detail.id}>
          <div className="sk-model-head">
            <strong>{t('provider.model.title')}</strong>
            <Button
              actionId="provider-add-model"
              emphasis="quiet"
              density="compact"
              leading={<Icon iconId="plus" size={13} />}
              label={t('provider.model.addModel')}
              onActivate={() => setShowAddModel(true)}
            />
          </div>

          {allModels.length > 0 && (
            <TextField
              className="sc-provider-models__search"
              clearable
              leading={<Icon iconId="search" size={14} />}
              placeholder={t('provider.model.searchModels')}
              value={modelSearchKeyword}
              onValueChange={setModelSearchKeyword}
            />
          )}

          {filteredModels.length > 0 ? (
            filteredModels.map((m) => (
              <div key={m.id} className="sk-model-row">
                <span className="sk-model-name">{m.display_name || m.id}</span>
                {m.context_window > 0 && (
                  <Tag>{formatContextWindow(m.context_window)}</Tag>
                )}
                <Tag tone={m.type === 'embedding' ? 'success' : 'info'}>{m.type}</Tag>
                {m.streaming && (
                  <Tooltip label={t('provider.model.capability.streaming')}>
                    <Icon iconId="radio-tower" size={13} className="sc-provider-capability" />
                  </Tooltip>
                )}
                {m.function_call && (
                  <Tooltip label={t('provider.model.capability.toolUse')}>
                    <Icon iconId="wrench" size={13} className="sc-provider-capability" />
                  </Tooltip>
                )}
                {m.vision && (
                  <Tooltip label={t('provider.model.capability.vision')}>
                    <Icon iconId="eye" size={13} className="sc-provider-capability" />
                  </Tooltip>
                )}
                {m.reasoning && (
                  <Tooltip label={t('provider.model.capability.deepThinking')}>
                    <Icon iconId="sparkles" size={13} className="sc-provider-capability" />
                  </Tooltip>
                )}
                {m.search && (
                  <Tooltip label={t('provider.model.capability.builtInSearch')}>
                    <Icon iconId="globe" size={13} className="sc-provider-capability" />
                  </Tooltip>
                )}
                {m.image_output && (
                  <Tooltip label={t('provider.model.capability.imageOutput')}>
                    <Icon iconId="image" size={13} className="sc-provider-capability" />
                  </Tooltip>
                )}
                {m.video && (
                  <Tooltip label={t('provider.model.capability.videoRecognition')}>
                    <Icon iconId="video" size={13} className="sc-provider-capability" />
                  </Tooltip>
                )}
                <Switch
                  data-pt-provider-model-toggle={m.id}
                  data-pt-provider-model-provider={detail.id}
                  checked={m.enabled}
                  aria-label={t('provider.model.title')}
                  onCheckedChange={(checked) => {
                    void (async () => {
                      try {
                        await toggleModel(detail.id, m.id, checked);
                      } catch {
                        notifyError(t('provider.model.failedToToggle'));
                      }
                    })();
                  }}
                />
                <Tooltip label={t('provider.model.editConfig')}>
                  <IconButton
                    actionId={`provider-model-edit-${m.id}`}
                    iconId="pencil-line"
                    iconSize={14}
                    density="compact"
                    emphasis="quiet"
                    label={t('provider.model.editConfig')}
                    onActivate={() => setEditModel({
                      id: m.id,
                      display_name: m.display_name,
                      type: m.type,
                      context_window: m.context_window,
                      enabled: m.enabled,
                      streaming: m.streaming,
                      function_call: m.function_call,
                      vision: m.vision,
                      reasoning: m.reasoning,
                      search: m.search,
                      image_output: m.image_output,
                      video: m.video,
                    })}
                  />
                </Tooltip>
                <Tooltip label={t('provider.model.removeModel')}>
                  <IconButton
                    actionId={`provider-model-remove-${m.id}`}
                    iconId="close"
                    iconSize={14}
                    density="compact"
                    emphasis="quiet"
                    tone="danger"
                    label={t('provider.model.removeModel')}
                    onActivate={() => void handleDeleteModel(m.id)}
                  />
                </Tooltip>
              </div>
            ))
          ) : (
            <Empty
              className="sc-provider-empty"
              icon={<Icon iconId="brain" size={28} />}
              description={t('provider.model.empty.title')}
              action={
                <Button
                  actionId="provider-add-model-empty"
                  emphasis="secondary"
                  leading={<Icon iconId="plus" size={14} />}
                  label={t('provider.model.addModel')}
                  onActivate={() => setShowAddModel(true)}
                />
              }
            />
          )}
        </div>
      </SettingsSection>

      <UpdateProviderModal
        open={showEditModal}
        detail={detail}
        onClose={() => setShowEditModal(false)}
      />

      <AddModelModal
        open={showAddModel}
        providerId={detail.id}
        onClose={() => setShowAddModel(false)}
        onAdd={addModel}
      />

      {editModel ? (
        <EditModelModal
          key={editModel.id}
          model={editModel}
          onClose={() => setEditModel(null)}
          onSave={async (data) => {
            await updateModel(detail.id, editModel.id, data);
            notifySuccess(t('provider.model.updated'));
            setEditModel(null);
          }}
        />
      ) : null}
    </div>
  );
}

function modelTypeSelectOptions(t: (key: string) => string) {
  return MODEL_TYPE_OPTIONS.map((kind) => ({
    value: kind,
    label: t(`provider.addModel.type.${kind}`),
  }));
}

function ContextRangeControl({
  sliderValue,
  numericValue,
  onSliderChange,
  onNumericChange,
}: {
  sliderValue: number;
  numericValue: number;
  onSliderChange: (index: number) => void;
  onNumericChange: (raw: number) => void;
}) {
  return (
    <div className="sc-provider-context">
      <div className="sc-provider-context__row">
        <Slider
          className="sc-provider-context__slider"
          min={0}
          max={9}
          ticks={CONTEXT_TICKS}
          value={sliderValue}
          valueLabel={(index) => formatContextWindow(sliderToContext(index))}
          onValueChange={onSliderChange}
        />
        <NumberField
          style={{ width: 96 }}
          value={numericValue}
          onValueChange={(value) => onNumericChange(value ?? 0)}
        />
      </div>
    </div>
  );
}

// ── Add Model Modal ──

function AddModelModal({
  open,
  providerId,
  onClose,
  onAdd,
}: {
  open: boolean;
  providerId: string;
  onClose: () => void;
  onAdd: (providerId: string, data: {
    id: string; display_name?: string; type?: string; context_window?: number;
    streaming?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean;
    search?: boolean; image_output?: boolean; video?: boolean;
  }) => Promise<void>;
}) {
  const { t } = useTranslation('provider');
  const [form, setForm] = useState<ModelFormState>(() => ({
    id: '',
    display_name: '',
    type: 'chat',
    contextWindow: 128000,
    enabled: true,
    streaming: true,
    function_call: false,
    vision: false,
    reasoning: false,
    search: false,
    image_output: false,
    video: false,
  }));
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const ctxSlider = contextToSlider(form.contextWindow);
  const idMissing = form.id.trim().length === 0;
  const showIdError = submitted && idMissing;

  const patch = <K extends keyof ModelFormState>(key: K, value: ModelFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleOk = async () => {
    setSubmitted(true);
    if (idMissing) return;
    try {
      setLoading(true);
      await onAdd(providerId, {
        id: form.id.trim(),
        display_name: form.display_name,
        type: form.type,
        context_window: form.contextWindow,
        streaming: form.streaming,
        function_call: form.function_call,
        vision: form.vision,
        reasoning: form.reasoning,
        search: form.search,
        image_output: form.image_output,
        video: form.video,
      });
      notifySuccess(t('provider.addModel.created'));
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
      title={t('provider.addModel.title')}
      width={560}
      closeLabel={t('provider.detail.disableConfirm.cancel')}
      footer={
        <>
          <Button
            actionId="add-model-cancel"
            emphasis="quiet"
            label={t('provider.detail.disableConfirm.cancel')}
            onActivate={onClose}
          />
          <Button
            actionId="add-model-ok"
            emphasis="primary"
            execution={loading ? 'pending' : 'idle'}
            availability={idMissing
              ? { kind: 'disabled', reason: t('provider.addModel.modelIdRequired') }
              : undefined}
            label={t('provider.addModel.createBtn')}
            onActivate={() => void handleOk()}
          />
        </>
      }
    >
      <div className="sc-provider-form">
        <Field
          label={t('provider.addModel.modelId')}
          required
          description={t('provider.addModel.modelIdExtra')}
          validation={showIdError
            ? { state: 'invalid', message: t('provider.addModel.modelIdRequired') }
            : undefined}
        >
          <TextField
            autoFocus
            placeholder={t('provider.addModel.modelIdPlaceholder')}
            value={form.id}
            onValueChange={(value) => patch('id', value)}
          />
        </Field>

        <Field label={t('provider.addModel.displayName')}>
          <TextField
            placeholder={t('provider.addModel.displayNamePlaceholder')}
            value={form.display_name}
            onValueChange={(value) => patch('display_name', value)}
          />
        </Field>

        <Field
          label={t('provider.addModel.maxContext')}
          description={t('provider.addModel.maxContextDesc')}
        >
          <ContextRangeControl
            sliderValue={ctxSlider}
            numericValue={form.contextWindow}
            onSliderChange={(index) => patch('contextWindow', sliderToContext(index))}
            onNumericChange={(raw) => patch('contextWindow', raw)}
          />
        </Field>

        <Divider />

        {MODEL_CAPABILITIES.map((capability) => (
          <Field
            key={capability.key}
            label={t(capability.labelKey)}
            description={t(capability.extraKey)}
          >
            <Checkbox
              checked={form[capability.key]}
              onCheckedChange={(checked) => patch(capability.key, checked)}
            />
          </Field>
        ))}

        <Field
          label={t('provider.addModel.modelType')}
          description={t('provider.addModel.modelTypeExtra')}
        >
          <Select
            options={modelTypeSelectOptions(t)}
            value={form.type}
            placeholder={t('provider.addModel.modelTypePlaceholder')}
            onValueChange={(value) => {
              if (typeof value === 'string') patch('type', value);
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}

// ── Edit Model Modal ──

function EditModelModal({
  model,
  onClose,
  onSave,
}: {
  model: { id: string; display_name?: string; type?: string; context_window?: number; enabled?: boolean; streaming?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean };
  onClose: () => void;
  onSave: (data: { display_name?: string; type?: string; context_window?: number; enabled?: boolean; streaming?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean }) => Promise<void>;
}) {
  const { t } = useTranslation('provider');
  const initialContext = model.context_window ?? 128000;
  const [form, setForm] = useState<ModelFormState>(() => ({
    id: model.id,
    display_name: model.display_name || model.id,
    type: model.type || 'chat',
    contextWindow: initialContext,
    enabled: model.enabled ?? true,
    streaming: model.streaming ?? false,
    function_call: model.function_call ?? false,
    vision: model.vision ?? false,
    reasoning: model.reasoning ?? false,
    search: model.search ?? false,
    image_output: model.image_output ?? false,
    video: model.video ?? false,
  }));
  const [loading, setLoading] = useState(false);

  const ctxSlider = contextToSlider(form.contextWindow);

  const patch = <K extends keyof ModelFormState>(key: K, value: ModelFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleOk = async () => {
    try {
      setLoading(true);
      await onSave({
        display_name: form.display_name,
        type: form.type,
        context_window: form.contextWindow,
        enabled: form.enabled,
        streaming: form.streaming,
        function_call: form.function_call,
        vision: form.vision,
        reasoning: form.reasoning,
        search: form.search,
        image_output: form.image_output,
        video: form.video,
      });
      onClose();
    } catch (e: unknown) {
      if (e instanceof Error) notifyError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onDismiss={onClose}
      title={t('provider.editModel.title')}
      width={560}
      closeLabel={t('provider.detail.disableConfirm.cancel')}
      footer={
        <>
          <Button
            actionId="edit-model-cancel"
            emphasis="quiet"
            label={t('provider.detail.disableConfirm.cancel')}
            onActivate={onClose}
          />
          <Button
            actionId="edit-model-ok"
            emphasis="primary"
            execution={loading ? 'pending' : 'idle'}
            label={t('provider.editModel.saveChanges')}
            onActivate={() => void handleOk()}
          />
        </>
      }
    >
      <div className="sc-provider-form">
        <Field label={t('provider.editModel.modelId')}>
          <Text tone="secondary">{model.id}</Text>
        </Field>

        <Field label={t('provider.editModel.displayName')}>
          <TextField
            placeholder={t('provider.editModel.displayNamePlaceholder')}
            value={form.display_name}
            onValueChange={(value) => patch('display_name', value)}
          />
        </Field>

        <Field label={t('provider.editModel.maxContext')}>
          <ContextRangeControl
            sliderValue={ctxSlider}
            numericValue={form.contextWindow}
            onSliderChange={(index) => patch('contextWindow', sliderToContext(index))}
            onNumericChange={(raw) => patch('contextWindow', raw)}
          />
        </Field>

        <Field label={t('provider.editModel.enabled')}>
          <Switch
            checked={form.enabled}
            aria-label={t('provider.editModel.enabled')}
            onCheckedChange={(checked) => patch('enabled', checked)}
          />
        </Field>

        <Divider />

        {MODEL_CAPABILITIES.map((capability) => (
          <Field
            key={capability.key}
            label={t(capability.labelKey)}
            description={t(capability.extraKey)}
          >
            <Checkbox
              checked={form[capability.key]}
              onCheckedChange={(checked) => patch(capability.key, checked)}
            />
          </Field>
        ))}

        <Field
          label={t('provider.addModel.modelType')}
          description={t('provider.addModel.modelTypeExtra')}
        >
          <Select
            options={modelTypeSelectOptions(t)}
            value={form.type}
            placeholder={t('provider.addModel.modelTypePlaceholder')}
            onValueChange={(value) => {
              if (typeof value === 'string') patch('type', value);
            }}
          />
        </Field>
      </div>
    </Dialog>
  );
}

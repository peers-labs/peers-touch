import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Switch, Typography, theme, message,
  Spin, Divider, Modal, Form, Slider, Checkbox, AutoComplete, Select, Tabs,
} from 'antd';
import { Input, Button, Tag, Avatar, Tooltip, InputPassword } from '@lobehub/ui';
import {
  CheckCircle2, Settings2, ExternalLink, Lock, Trash2, Plus,
  Brain, X, RefreshCw, Wrench, Eye, Sparkles, Pencil,
  MessageSquare, Image, Zap, Mic, AudioLines, Grid3X3, Globe, Video, Search,
} from 'lucide-react';
import { useProviderStore } from '../../store/provider';
import { ProviderIcon } from './ProviderIcon';
import { UpdateProviderModal } from './UpdateProviderModal';
import { api } from '../../services/desktop_api';
import { useTranslation } from 'react-i18next';

const { Text, Title, Link } = Typography;

function FormRow({
  label,
  desc,
  children,
  last,
  extra,
}: {
  label: string;
  desc?: ReactNode;
  children: ReactNode;
  last?: boolean;
  extra?: ReactNode;
}) {
  const { token } = theme.useToken();
  return (
    <>
      <Flexbox
        horizontal
        justify="space-between"
        align="center"
        gap={24}
        style={{ padding: '16px 0', minHeight: 56 }}
      >
        <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Flexbox horizontal align="center" gap={4}>
            <Text strong style={{ fontSize: 14 }}>{label}</Text>
            {extra}
          </Flexbox>
          {desc && (
            <Text type="secondary" style={{ fontSize: 12, lineHeight: '18px' }}>
              {desc}
            </Text>
          )}
        </Flexbox>
        <Flexbox style={{ flexShrink: 0, maxWidth: '55%', minWidth: 200 }} align="flex-end">
          {children}
        </Flexbox>
      </Flexbox>
      {!last && <Divider style={{ margin: 0, borderColor: token.colorBorderSecondary }} />}
    </>
  );
}

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

export function ProviderDetail() {
  const { t } = useTranslation('provider');
  const {
    detail, loading, updateProvider, toggleProvider,
    checkProvider, deleteProvider, addModel, updateModel, deleteModel,
    fetchRemoteModels, selectProvider, toggleModel, toggleAllModels,
    selectedId,
  } = useProviderStore();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkPass, setCheckPass] = useState(false);
  const [checkModel, setCheckModel] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [modelTypeTab, setModelTypeTab] = useState<string>('all');
  const [modelSearchKeyword, setModelSearchKeyword] = useState('');
  const [editModel, setEditModel] = useState<{ id: string; display_name?: string; type?: string; context_window?: number; enabled?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean } | null>(null);
  const { token } = theme.useToken();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Whether the displayed detail matches the currently selected provider.
  // When switching, detail still holds old provider data until the new one loads.
  const isStale = detail != null && selectedId != null && detail.id !== selectedId;

  useEffect(() => {
    if (detail && !isStale) {
      setApiKey(detail.api_key || '');
      setBaseUrl(detail.base_url || detail.default_base_url || '');
      setEnabled(detail.enabled);
      setCheckModel(detail.check_model || detail.models?.[0]?.id || '');
      setCheckPass(false);
    }
  }, [detail, isStale]);

  const debouncedSave = useCallback(
    (key: string, url: string) => {
      if (!detail) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await updateProvider(detail.id, key, url, detail.enabled);
        } catch {
          // silently fail
        }
      }, 800);
    },
    [detail, updateProvider],
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

  const allModels = detail?.models || [];
  const modelTypeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allModels.length };
    for (const m of allModels) {
      const t = (m.type || 'chat').toLowerCase();
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  }, [allModels]);
  const filteredModels = useMemo(() => {
    let list = modelTypeTab === 'all' ? allModels : allModels.filter((m) => (m.type || 'chat').toLowerCase() === modelTypeTab);
    const kw = modelSearchKeyword.trim().toLowerCase();
    if (kw) {
      list = list.filter((m) =>
        (m.id || '').toLowerCase().includes(kw) ||
        (m.display_name || '').toLowerCase().includes(kw),
      );
    }
    return list;
  }, [allModels, modelTypeTab, modelSearchKeyword]);

  if (loading && !detail) {
    return (
      <Flexbox flex={1} align="center" justify="center">
        <Spin />
      </Flexbox>
    );
  }

  if (!detail) {
    return (
      <Flexbox flex={1} align="center" justify="center">
        <Text type="secondary">{t('provider.detail.selectProvider')}</Text>
      </Flexbox>
    );
  }

  const handleCheck = async () => {
    if (!checkModel) {
      message.warning(t('provider.detail.checkWarning'));
      return;
    }
    setChecking(true);
    setCheckPass(false);
    try {
      const result = await checkProvider(detail.id, apiKey || undefined, baseUrl || undefined, checkModel);
      if (result.ok) {
        setCheckPass(true);
        message.success(t('provider.detail.connectionSuccessful'));
        doFetchModels(true);
      } else {
        message.error(result.error || t('provider.detail.connectionFailed'));
      }
    } catch {
      message.error(t('provider.detail.connectionCheckFailed'));
    } finally {
      setChecking(false);
    }
  };

  const doFetchModels = async (silent = false) => {
    setFetching(true);
    try {
      const result = await fetchRemoteModels(detail.id, apiKey || undefined, baseUrl || undefined);
      if (result.ok && result.models) {
        const existingIds = new Set((detail.models || []).map((m) => m.id));
        const newModels = result.models.filter((id) => !existingIds.has(id));
        if (newModels.length > 0) {
          for (const id of newModels) {
            await addModel(detail.id, { id, display_name: '', type: 'chat', context_window: 128000 });
          }
          message.success(t('provider.model.fetchedNew', { count: newModels.length }));
        } else if (!silent) {
          message.info(t('provider.model.noNewModels'));
        }
        await selectProvider(detail.id);
      } else if (!silent) {
        message.error(result.error || t('provider.model.failedToFetch'));
      }
    } catch (e: unknown) {
      if (!silent) {
        message.error(e instanceof Error ? e.message : t('provider.model.failedToFetch'));
      }
    } finally {
      setFetching(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProvider(detail.id);
      message.success(t('provider.detail.deleted'));
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : t('provider.detail.failedToDelete'));
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      await deleteModel(detail.id, modelId);
      message.success(t('provider.model.removed'));
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : t('provider.model.failedToRemove'));
    }
  };

  const isUnconfigured = apiKey.trim().length === 0;
  const modelOptions = allModels.map((m) => ({
    value: m.id,
    label: m.display_name || m.id,
  }));

  return (
    <Flexbox
      gap={16}
      style={{
        padding: '16px 24px 24px',
        height: '100%',
        overflow: 'hidden',
        opacity: isStale ? 0 : 1,
        transition: 'opacity 0.15s ease-out',
        pointerEvents: isStale ? 'none' : 'auto',
      }}
    >
      {/* Config Card - fixed height */}
      <div
        style={{
          borderRadius: 12,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {/* Header */}
        <Flexbox
          horizontal
          justify="space-between"
          align="center"
          style={{
            padding: '16px 20px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Flexbox
            horizontal
            align="center"
            gap={10}
            style={{
              ...(enabled ? {} : { filter: 'grayscale(100%)', opacity: 0.66 }),
              transition: 'all 0.2s',
            }}
          >
            {detail.logo ? (
              <Avatar src={detail.logo} shape="circle" size={32} />
            ) : (
              <ProviderIcon providerId={detail.id} providerName={detail.name} size={32} />
            )}
            <Flexbox horizontal align="center" gap={8}>
              <Title level={5} style={{ margin: 0, fontSize: 16 }}>{detail.name}</Title>
              {isUnconfigured && (
                <Tag
                  bordered={false}
                  color="default"
                  style={{
                    margin: 0,
                    fontSize: 11,
                    lineHeight: '16px',
                    paddingInline: 6,
                    color: token.colorTextTertiary,
                  }}
                >
                  {t('provider.detail.notConfigured')}
                </Tag>
              )}
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            <Tooltip title={t('provider.detail.providerSettings')}>
              <Button
                type="text"
                size="small"
                icon={<Settings2 size={14} />}
                onClick={() => setShowEditModal(true)}
                style={{ color: token.colorTextSecondary }}
              />
            </Tooltip>
            {!detail.builtin && (
              <Button
                danger
                size="small"
                icon={<Trash2 size={14} />}
                onClick={() => {
                  Modal.confirm({
                    title: t('provider.detail.deleteConfirm.title'),
                    content: t('provider.detail.deleteConfirm.content', { name: detail.name }),
                    okText: t('provider.detail.deleteConfirm.ok'),
                    okButtonProps: { danger: true },
                    onOk: handleDelete,
                  });
                }}
              >
                {t('provider.detail.delete')}
              </Button>
            )}
            <Switch
              checked={enabled}
              onChange={async (checked, event) => {
                event?.stopPropagation();

                // When disabling, check if Model Service references this provider
                if (!checked) {
                  try {
                    const refs = await api.getProviderReferences(detail.id);
                    if (refs.length > 0) {
                      const slotNames = refs.map((r) => `• ${r.slot} (${r.model})`).join('\n');
                      Modal.confirm({
                        title: t('provider.detail.disableConfirm.title'),
                        content: (
                          <div>
                            <p>{t('provider.detail.disableConfirm.desc')}</p>
                            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{slotNames}</pre>
                            <p>{t('provider.detail.disableConfirm.note')}</p>
                          </div>
                        ),
                        onOk: async () => {
                          setEnabled(false);
                          try { await toggleProvider(detail.id, false); }
                          catch { setEnabled(true); message.error(t('provider.detail.failedToToggle')); }
                        },
                        okText: t('provider.detail.disableConfirm.ok'),
                        cancelText: t('provider.detail.disableConfirm.cancel'),
                      });
                      return;
                    }
                  } catch { /* proceed if ref check fails */ }
                }

                setEnabled(checked);
                try {
                  await toggleProvider(detail.id, checked);
                } catch {
                  setEnabled(!checked);
                  message.error(t('provider.detail.failedToToggle'));
                }
              }}
            />
          </Flexbox>
        </Flexbox>

        {/* Form Body */}
        <div style={{ padding: '0 20px' }}>
          <FormRow
            label={t('provider.detail.apiKey')}
            desc={
              detail.api_key_url ? (
                <>
                  {t('provider.detail.apiKeyDescWithLink', { name: detail.name })}{' '}
                  <Link href={detail.api_key_url} target="_blank" style={{ fontSize: 12 }}>
                    {t('provider.detail.getApiKey')} <ExternalLink size={10} style={{ marginLeft: 2 }} />
                  </Link>
                </>
              ) : (
                t('provider.detail.apiKeyDesc', { name: detail.name })
              )
            }
          >
            <InputPassword
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder={t('provider.detail.apiKeyPlaceholder')}
              autoComplete="new-password"
              style={{ width: '100%' }}
            />
          </FormRow>

          <FormRow
            label={t('provider.detail.apiProxyUrl')}
            desc={t('provider.detail.apiProxyUrlDesc')}
          >
            <Input
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder={detail.default_base_url || 'https://your-proxy-url.com/v1'}
              allowClear
              style={{ width: '100%' }}
            />
          </FormRow>

          {detail.show_checker && (
            <FormRow
              label={t('provider.detail.connectivityCheck')}
              desc={t('provider.detail.connectivityCheckDesc')}
            >
              <Flexbox horizontal gap={8} style={{ width: '100%' }}>
                <AutoComplete
                  value={checkModel}
                  onChange={(val) => {
                    setCheckModel(val);
                    setCheckPass(false);
                  }}
                  options={modelOptions}
                  placeholder={t('provider.detail.enterModelId')}
                  style={{ flex: 1 }}
                  filterOption={(input, option) =>
                    (option?.value as string)?.toLowerCase().includes(input.toLowerCase()) ||
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                />
                <Button
                  onClick={handleCheck}
                  loading={checking}
                  disabled={!checkModel}
                  icon={checkPass ? <CheckCircle2 size={14} /> : undefined}
                  style={
                    checkPass
                      ? { borderColor: token.colorSuccess, color: token.colorSuccess }
                      : undefined
                  }
                >
                  {checkPass ? t('provider.detail.checkPass') : t('provider.detail.check')}
                </Button>
              </Flexbox>
            </FormRow>
          )}

          <Flexbox
            horizontal
            align="center"
            justify="center"
            gap={4}
            style={{
              padding: '12px 0 16px',
              fontSize: 12,
              color: token.colorTextDescription,
              opacity: 0.66,
            }}
          >
            <Lock size={12} />
            <span>
              {t('provider.detail.encryptionNotice')}
            </span>
          </Flexbox>
        </div>
      </div>

      {/* Model List - takes remaining space with independent scroll */}
      <Flexbox gap={12} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Flexbox horizontal justify="space-between" align="center" style={{ flexShrink: 0 }}>
          <Flexbox horizontal align="center" gap={8}>
            <Title level={5} style={{ margin: 0 }}>{t('provider.model.title')}</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t('provider.model.count', { filtered: filteredModels.length, total: allModels.length })}
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={8} align="center">
            {filteredModels.length > 0 && (
              <>
                <Button
                  size="small"
                  icon={<CheckCircle2 size={14} />}
                  loading={fetching}
                  onClick={async () => {
                    try {
                      await toggleAllModels(detail.id, true);
                      message.success(t('provider.model.allEnabled'));
                    } catch (e) {
                      message.error(t('provider.model.failedToEnableAll'));
                    }
                  }}
                >
                  {t('provider.model.enableAll')}
                </Button>
                <Button
                  size="small"
                  icon={<X size={14} />}
                  loading={fetching}
                  onClick={async () => {
                    try {
                      await toggleAllModels(detail.id, false);
                      message.success(t('provider.model.allDisabled'));
                    } catch (e) {
                      message.error(t('provider.model.failedToDisableAll'));
                    }
                  }}
                >
                  {t('provider.model.disableAll')}
                </Button>
              </>
            )}
            <Button size="small" icon={<Plus size={14} />} onClick={() => setShowAddModel(true)}>
              {t('provider.model.addModel')}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<RefreshCw size={14} />}
              loading={fetching}
              onClick={() => doFetchModels(false)}
            >
              {t('provider.model.fetchModels')}
            </Button>
          </Flexbox>
        </Flexbox>

        {allModels.length > 0 && (
          <>
          <Input
            size="small"
            placeholder={t('provider.model.searchModels')}
            prefix={<Search size={12} style={{ color: token.colorTextQuaternary }} />}
            value={modelSearchKeyword}
            onChange={(e) => setModelSearchKeyword(e.target.value)}
            allowClear
            style={{ marginBottom: 8, maxWidth: 240, fontSize: 12 }}
          />
          <Tabs
            size="small"
            activeKey={modelTypeTab}
            onChange={setModelTypeTab}
            style={{ flexShrink: 0 }}
            items={[
              { key: 'all', label: <span><Grid3X3 size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />{t('provider.model.tab.all', { count: modelTypeCounts.all })}</span> },
              { key: 'chat', label: <span><MessageSquare size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />{t('provider.model.tab.chat', { count: modelTypeCounts.chat ?? 0 })}</span> },
              { key: 'image', label: <span><Image size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />{t('provider.model.tab.image', { count: modelTypeCounts.image ?? 0 })}</span> },
              { key: 'video', label: <span><Video size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />{t('provider.model.tab.video', { count: modelTypeCounts.video ?? 0 })}</span> },
              { key: 'embedding', label: <span><Zap size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />{t('provider.model.tab.embedding', { count: modelTypeCounts.embedding ?? 0 })}</span> },
              { key: 'stt', label: <span><Mic size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />{t('provider.model.tab.asr', { count: modelTypeCounts.stt ?? 0 })}</span> },
              { key: 'tts', label: <span><AudioLines size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />{t('provider.model.tab.tts', { count: modelTypeCounts.tts ?? 0 })}</span> },
            ]}
          />
          </>
        )}

        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {filteredModels.length > 0 ? (
            <div
              style={{
                borderRadius: 12,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                overflow: 'hidden',
              }}
            >
              {filteredModels.map((m, i) => (
                <Flexbox
                  key={m.id}
                  horizontal
                  align="center"
                  gap={12}
                  style={{
                    padding: '12px 16px',
                    borderBottom: i < filteredModels.length - 1 ? `1px solid ${token.colorBorderSecondary}` : undefined,
                  }}
                >
                  <div style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <ProviderIcon providerId={detail.id} providerName={detail.name} size={22} />
                  </div>
                  <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13 }} ellipsis>
                      {m.display_name || m.id}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11 }} ellipsis>{m.id}</Text>
                  </Flexbox>
                  <Flexbox horizontal align="center" gap={6} style={{ flexShrink: 0 }}>
                    {m.context_window > 0 && (
                      <Tag style={{ fontSize: 11, margin: 0 }}>{formatContextWindow(m.context_window)}</Tag>
                    )}
                    <Tag style={{ fontSize: 11, margin: 0 }}>{m.type}</Tag>
                    {m.type === 'embedding' && (
                      <Tag color="green" style={{ fontSize: 10, margin: 0 }}>{t('provider.model.embeddingTag')}</Tag>
                    )}
                    {m.function_call && (
                      <Tooltip title={t('provider.model.capability.toolUse')}><Wrench size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    {m.vision && (
                      <Tooltip title={t('provider.model.capability.vision')}><Eye size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    {m.reasoning && (
                      <Tooltip title={t('provider.model.capability.deepThinking')}><Sparkles size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    {m.search && (
                      <Tooltip title={t('provider.model.capability.builtInSearch')}><Globe size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    {m.image_output && (
                      <Tooltip title={t('provider.model.capability.imageOutput')}><Image size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    {m.video && (
                      <Tooltip title={t('provider.model.capability.videoRecognition')}><Video size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    <Switch
                      size="small"
                      checked={m.enabled}
                      onChange={async (checked) => {
                        try {
                          await toggleModel(detail.id, m.id, checked);
                        } catch (e) {
                          message.error(t('provider.model.failedToToggle'));
                        }
                      }}
                    />
                    <Tooltip title={t('provider.model.editConfig')}>
                      <Button
                        type="text"
                        size="small"
                        icon={<Pencil size={14} />}
                        onClick={() => setEditModel({ id: m.id, display_name: m.display_name, type: m.type, context_window: m.context_window, enabled: m.enabled, function_call: m.function_call, vision: m.vision, reasoning: m.reasoning, search: m.search, image_output: m.image_output, video: m.video })}
                        style={{ width: 24, height: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: token.colorTextSecondary }}
                      />
                    </Tooltip>
                    <Tooltip title={t('provider.model.removeModel')}>
                      <Button
                        type="text"
                        size="small"
                        danger
                        icon={<X size={14} />}
                        onClick={() => handleDeleteModel(m.id)}
                        style={{ width: 24, height: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      />
                    </Tooltip>
                  </Flexbox>
                </Flexbox>
              ))}
            </div>
          ) : (
            <Flexbox
              align="center"
              justify="center"
              gap={16}
              style={{
                padding: '48px 24px',
                borderRadius: 12,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: token.colorFillQuaternary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Brain size={28} style={{ color: token.colorTextQuaternary }} />
              </div>
              <Flexbox align="center" gap={4}>
                <Text strong style={{ fontSize: 14 }}>{t('provider.model.empty.title')}</Text>
                <Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
                  {t('provider.model.empty.desc')}
                </Text>
              </Flexbox>
              <Flexbox horizontal gap={12}>
                <Button icon={<Plus size={14} />} onClick={() => setShowAddModel(true)}>
                  {t('provider.model.addModel')}
                </Button>
                <Button
                  type="primary"
                  icon={<RefreshCw size={14} />}
                  loading={fetching}
                  onClick={() => doFetchModels(false)}
                >
                  {t('provider.model.fetchModels')}
                </Button>
              </Flexbox>
            </Flexbox>
          )}
        </div>
      </Flexbox>

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

      <EditModelModal
        open={!!editModel}
        model={editModel}
        onClose={() => setEditModel(null)}
        onSave={async (data) => {
          if (!editModel) return;
          await updateModel(detail.id, editModel.id, data);
          message.success(t('provider.model.updated'));
          setEditModel(null);
        }}
      />
    </Flexbox>
  );
}

// ── Add Model Modal (LobeHub-style) ──

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
    function_call?: boolean; vision?: boolean; reasoning?: boolean;
    search?: boolean; image_output?: boolean; video?: boolean;
  }) => Promise<void>;
}) {
  const { t } = useTranslation('provider');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [ctxSlider, setCtxSlider] = useState(6);
  const [ctxValue, setCtxValue] = useState(128000);
  const { token } = theme.useToken();

  const handleSliderChange = (v: number) => {
    setCtxSlider(v);
    const val = sliderToContext(v);
    setCtxValue(val);
    form.setFieldValue('context_window', val);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseInt(e.target.value.replace(/[^\d]/g, '') || '0');
    setCtxValue(raw);
    setCtxSlider(contextToSlider(raw));
    form.setFieldValue('context_window', raw);
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      values.context_window = ctxValue;
      await onAdd(providerId, values);
      message.success(t('provider.addModel.created'));
      form.resetFields();
      setCtxSlider(6);
      setCtxValue(128000);
      onClose();
    } catch (e: unknown) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('provider.addModel.title')}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={560}
    >
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 7 }}
        wrapperCol={{ span: 17 }}
        style={{ marginTop: 24 }}
        initialValues={{ type: 'chat', context_window: 128000 }}
        labelAlign="left"
        colon={false}
      >
        <Form.Item
          name="id"
          label={t('provider.addModel.modelId')}
          rules={[{ required: true, message: t('provider.addModel.modelIdRequired') }]}
          extra={t('provider.addModel.modelIdExtra')}
        >
          <Input placeholder={t('provider.addModel.modelIdPlaceholder')} autoFocus />
        </Form.Item>

        <Form.Item
          name="display_name"
          label={t('provider.addModel.displayName')}>
          <Input placeholder={t('provider.addModel.displayNamePlaceholder')} />
        </Form.Item>

        <Form.Item label={t('provider.addModel.maxContext')}>
          <Flexbox gap={12}>
            <Flexbox horizontal gap={16} align="center">
              <Slider
                min={0}
                max={9}
                marks={CONTEXT_MARKS}
                value={ctxSlider}
                onChange={handleSliderChange}
                tooltip={{ formatter: (v) => (v !== undefined ? formatContextWindow(sliderToContext(v)) : '') }}
                style={{ flex: 1 }}
              />
              <Input
                value={ctxValue}
                onChange={handleInputChange}
                style={{ width: 90, textAlign: 'right' }}
                suffix={null}
              />
            </Flexbox>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('provider.addModel.maxContextDesc')}
            </Text>
          </Flexbox>
        </Form.Item>

        <Divider style={{ margin: '8px 0 16px', borderColor: token.colorBorderSecondary }} />

        <Form.Item
          name="function_call"
          valuePropName="checked"
          label={t('provider.addModel.supportToolUse')}
          extra={t('provider.addModel.supportToolUseExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="vision"
          valuePropName="checked"
          label={t('provider.addModel.supportVision')}
          extra={t('provider.addModel.supportVisionExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="reasoning"
          valuePropName="checked"
          label={t('provider.addModel.supportDeepThinking')}
          extra={t('provider.addModel.supportDeepThinkingExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="search"
          valuePropName="checked"
          label={t('provider.addModel.supportSearch')}
          extra={t('provider.addModel.supportSearchExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="image_output"
          valuePropName="checked"
          label={t('provider.addModel.supportImageGen')}
          extra={t('provider.addModel.supportImageGenExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="video"
          valuePropName="checked"
          label={t('provider.addModel.supportVideo')}
          extra={t('provider.addModel.supportVideoExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="type"
          label={t('provider.addModel.modelType')}
          extra={t('provider.addModel.modelTypeExtra')}
        >
          <Select
            options={[
              { value: 'chat', label: t('provider.addModel.type.chat') },
              { value: 'image', label: t('provider.addModel.type.image') },
              { value: 'video', label: t('provider.addModel.type.video') },
              { value: 'embedding', label: t('provider.addModel.type.embedding') },
              { value: 'stt', label: t('provider.addModel.type.stt') },
              { value: 'tts', label: t('provider.addModel.type.tts') },
              { value: 'realtime', label: t('provider.addModel.type.realtime') },
            ]}
            placeholder={t('provider.addModel.modelTypePlaceholder')}
          />
        </Form.Item>

        <Button type="primary" block size="large" onClick={handleOk} loading={loading}>
          {t('provider.addModel.createBtn')}
        </Button>
      </Form>
    </Modal>
  );
}

// ── Edit Model Modal ──

function EditModelModal({
  open,
  model,
  onClose,
  onSave,
}: {
  open: boolean;
  model: { id: string; display_name?: string; type?: string; context_window?: number; enabled?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean } | null;
  onClose: () => void;
  onSave: (data: { display_name?: string; type?: string; context_window?: number; enabled?: boolean; function_call?: boolean; vision?: boolean; reasoning?: boolean; search?: boolean; image_output?: boolean; video?: boolean }) => Promise<void>;
}) {
  const { t } = useTranslation('provider');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [ctxSlider, setCtxSlider] = useState(6);
  const [ctxValue, setCtxValue] = useState(128000);
  const { token } = theme.useToken();

  useEffect(() => {
    if (open && model) {
      const ctx = model.context_window ?? 128000;
      setCtxValue(ctx);
      setCtxSlider(contextToSlider(ctx));
      form.setFieldsValue({
        display_name: model.display_name || model.id,
        type: model.type || 'chat',
        context_window: ctx,
        enabled: model.enabled ?? true,
        function_call: model.function_call ?? false,
        vision: model.vision ?? false,
        reasoning: model.reasoning ?? false,
        search: model.search ?? false,
        image_output: model.image_output ?? false,
        video: model.video ?? false,
      });
    }
  }, [open, model, form]);

  const handleSliderChange = (v: number) => {
    setCtxSlider(v);
    const val = sliderToContext(v);
    setCtxValue(val);
    form.setFieldValue('context_window', val);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseInt(e.target.value.replace(/[^\d]/g, '') || '0');
    setCtxValue(raw);
    setCtxSlider(contextToSlider(raw));
    form.setFieldValue('context_window', raw);
  };

  const handleOk = async () => {
    if (!model) return;
    try {
      const values = await form.validateFields();
      setLoading(true);
      values.context_window = ctxValue;
      await onSave(values);
      onClose();
    } catch (e: unknown) {
      if (e instanceof Error) message.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!model) return null;

  return (
    <Modal
      title={t('provider.editModel.title')}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={560}
    >
      <Form
        form={form}
        layout="horizontal"
        labelCol={{ span: 7 }}
        wrapperCol={{ span: 17 }}
        style={{ marginTop: 24 }}
        labelAlign="left"
        colon={false}
      >
        <Form.Item label={t('provider.editModel.modelId')}>
          <Text type="secondary">{model.id}</Text>
        </Form.Item>

        <Form.Item name="display_name" label={t('provider.editModel.displayName')}>
          <Input placeholder={t('provider.editModel.displayNamePlaceholder')} />
        </Form.Item>

        <Form.Item label={t('provider.editModel.maxContext')}>
          <Flexbox gap={12}>
            <Flexbox horizontal gap={16} align="center">
              <Slider
                min={0}
                max={9}
                marks={CONTEXT_MARKS}
                value={ctxSlider}
                onChange={handleSliderChange}
                tooltip={{ formatter: (v) => (v !== undefined ? formatContextWindow(sliderToContext(v)) : '') }}
                style={{ flex: 1 }}
              />
              <Input
                value={ctxValue}
                onChange={handleInputChange}
                style={{ width: 90, textAlign: 'right' }}
                suffix={null}
              />
            </Flexbox>
          </Flexbox>
        </Form.Item>

        <Form.Item name="enabled" valuePropName="checked" label={t('provider.editModel.enabled')}>
          <Switch />
        </Form.Item>

        <Divider style={{ margin: '8px 0 16px', borderColor: token.colorBorderSecondary }} />

        <Form.Item
          name="function_call"
          valuePropName="checked"
          label={t('provider.addModel.supportToolUse')}
          extra={t('provider.addModel.supportToolUseExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="vision"
          valuePropName="checked"
          label={t('provider.addModel.supportVision')}
          extra={t('provider.addModel.supportVisionExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="reasoning"
          valuePropName="checked"
          label={t('provider.addModel.supportDeepThinking')}
          extra={t('provider.addModel.supportDeepThinkingExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="search"
          valuePropName="checked"
          label={t('provider.addModel.supportSearch')}
          extra={t('provider.addModel.supportSearchExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="image_output"
          valuePropName="checked"
          label={t('provider.addModel.supportImageGen')}
          extra={t('provider.addModel.supportImageGenExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="video"
          valuePropName="checked"
          label={t('provider.addModel.supportVideo')}
          extra={t('provider.addModel.supportVideoExtra')}
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="type"
          label={t('provider.addModel.modelType')}
          extra={t('provider.addModel.modelTypeExtra')}
        >
          <Select
            options={[
              { value: 'chat', label: t('provider.addModel.type.chat') },
              { value: 'image', label: t('provider.addModel.type.image') },
              { value: 'video', label: t('provider.addModel.type.video') },
              { value: 'embedding', label: t('provider.addModel.type.embedding') },
              { value: 'stt', label: t('provider.addModel.type.stt') },
              { value: 'tts', label: t('provider.addModel.type.tts') },
              { value: 'realtime', label: t('provider.addModel.type.realtime') },
            ]}
            placeholder={t('provider.addModel.modelTypePlaceholder')}
          />
        </Form.Item>

        <Button type="primary" block size="large" onClick={handleOk} loading={loading}>
          {t('provider.editModel.saveChanges')}
        </Button>
      </Form>
    </Modal>
  );
}

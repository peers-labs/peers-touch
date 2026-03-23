import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Input, Button, Switch, Typography, Tag, theme, message,
  Spin, Divider, Avatar, Tooltip, Modal, Form, Slider, Checkbox, AutoComplete, Select, Tabs,
} from 'antd';
import {
  CheckCircle2, Settings2, ExternalLink, Lock, Trash2, Plus,
  Brain, X, RefreshCw, Wrench, Eye, Sparkles, Pencil,
  MessageSquare, Image, Zap, Mic, AudioLines, Grid3X3, Globe, Video, Search,
} from 'lucide-react';
import { useProviderStore } from '../../store/provider';
import { ProviderIcon } from './ProviderIcon';
import { UpdateProviderModal } from './UpdateProviderModal';
import { api } from '../../services/api';

const { Text, Title, Link } = Typography;

function FormRow({
  label,
  desc,
  children,
  last,
  extra,
}: {
  label: string;
  desc?: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
  extra?: React.ReactNode;
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
  const {
    detail, loading, updateProvider, toggleProvider,
    checkProvider, deleteProvider, addModel, updateModel, deleteModel,
    fetchRemoteModels, selectProvider, toggleModel, toggleAllModels,
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

  useEffect(() => {
    if (detail) {
      setApiKey(detail.api_key || '');
      setBaseUrl(detail.base_url || detail.default_base_url || '');
      setEnabled(detail.enabled);
      setCheckModel(detail.check_model || detail.models?.[0]?.id || '');
      setCheckPass(false);
    }
  }, [detail]);

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

  if (loading) {
    return (
      <Flexbox flex={1} align="center" justify="center">
        <Spin />
      </Flexbox>
    );
  }

  if (!detail) {
    return (
      <Flexbox flex={1} align="center" justify="center">
        <Text type="secondary">Select a provider from the list</Text>
      </Flexbox>
    );
  }

  const handleCheck = async () => {
    if (!checkModel) {
      message.warning('Please enter a model ID for connectivity test');
      return;
    }
    setChecking(true);
    setCheckPass(false);
    try {
      const result = await checkProvider(detail.id, apiKey || undefined, baseUrl || undefined, checkModel);
      if (result.ok) {
        setCheckPass(true);
        message.success('Connection successful!');
        if (!detail.builtin) {
          doFetchModels(true);
        }
      } else {
        message.error(result.error || 'Connection failed');
      }
    } catch {
      message.error('Connection check failed');
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
          message.success(`Fetched ${newModels.length} new model(s)`);
        } else if (!silent) {
          message.info('No new models found');
        }
        await selectProvider(detail.id);
      } else if (!silent) {
        message.error(result.error || 'Failed to fetch models');
      }
    } catch (e: unknown) {
      if (!silent) {
        message.error(e instanceof Error ? e.message : 'Failed to fetch models');
      }
    } finally {
      setFetching(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProvider(detail.id);
      message.success('Provider deleted');
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      await deleteModel(detail.id, modelId);
      message.success('Model removed');
    } catch (e: unknown) {
      message.error(e instanceof Error ? e.message : 'Failed to delete model');
    }
  };

  const isUnconfigured = apiKey.trim().length === 0;
  const modelOptions = allModels.map((m) => ({
    value: m.id,
    label: m.display_name || m.id,
  }));

  return (
    <Flexbox gap={16} style={{ padding: 24, height: '100%', overflow: 'hidden' }}>
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
                  Not Configured
                </Tag>
              )}
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align="center" gap={8}>
            {!detail.builtin && (
              <>
                <Tooltip title="Provider Settings">
                  <Button
                    type="text"
                    size="small"
                    icon={<Settings2 size={16} />}
                    onClick={() => setShowEditModal(true)}
                    style={{ color: token.colorTextSecondary }}
                  />
                </Tooltip>
                <Button
                  danger
                  size="small"
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    Modal.confirm({
                      title: 'Delete this provider?',
                      content: `Provider "${detail.name}" and all its configuration will be permanently deleted.`,
                      okText: 'Delete',
                      okButtonProps: { danger: true },
                      onOk: handleDelete,
                    });
                  }}
                >
                  Delete
                </Button>
              </>
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
                        title: 'Provider in use by Model Service',
                        content: (
                          <div>
                            <p>Disabling this provider will affect these Model Service configurations:</p>
                            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{slotNames}</pre>
                            <p>You will need to reconfigure them in Settings → Model Service.</p>
                          </div>
                        ),
                        onOk: async () => {
                          setEnabled(false);
                          try { await toggleProvider(detail.id, false); }
                          catch { setEnabled(true); message.error('Failed to toggle provider'); }
                        },
                        okText: 'Disable anyway',
                        cancelText: 'Cancel',
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
                  message.error('Failed to toggle provider');
                }
              }}
            />
          </Flexbox>
        </Flexbox>

        {/* Form Body */}
        <div style={{ padding: '0 20px' }}>
          <FormRow
            label="API Key"
            desc={
              detail.api_key_url ? (
                <>
                  Please enter your {detail.name} API Key.{' '}
                  <Link href={detail.api_key_url} target="_blank" style={{ fontSize: 12 }}>
                    Get API Key <ExternalLink size={10} style={{ marginLeft: 2 }} />
                  </Link>
                </>
              ) : (
                `Please enter your ${detail.name} API Key`
              )
            }
          >
            <Input.Password
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder="Please enter your API Key"
              autoComplete="new-password"
              style={{ width: '100%' }}
            />
          </FormRow>

          <FormRow
            label="API Proxy URL"
            desc="Must include http(s)://"
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
              label="Connectivity Check"
              desc="Test if the API Key and proxy URL are correctly filled"
            >
              <Flexbox horizontal gap={8} style={{ width: '100%' }}>
                <AutoComplete
                  value={checkModel}
                  onChange={(val) => {
                    setCheckModel(val);
                    setCheckPass(false);
                  }}
                  options={modelOptions}
                  placeholder="Enter or select model ID"
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
                  {checkPass ? 'Pass' : 'Check'}
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
              Your key and proxy URL will be encrypted using{' '}
              <a
                href="https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt#aes-gcm"
                target="_blank"
                rel="noreferrer"
                style={{ color: token.colorPrimary }}
              >
                AES-GCM
              </a>{' '}
              encryption algorithm
            </span>
          </Flexbox>
        </div>
      </div>

      {/* Model List - takes remaining space with independent scroll */}
      <Flexbox gap={12} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Flexbox horizontal justify="space-between" align="center" style={{ flexShrink: 0 }}>
          <Flexbox horizontal align="center" gap={8}>
            <Title level={5} style={{ margin: 0 }}>Model List</Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {filteredModels.length} of {allModels.length} models
            </Text>
          </Flexbox>
          <Flexbox horizontal gap={8}>
            {filteredModels.length > 5 && (
              <>
                <Button
                  size="small"
                  loading={fetching}
                  onClick={async () => {
                    try {
                      await toggleAllModels(detail.id, true);
                      message.success('All models enabled');
                    } catch (e) {
                      message.error('Failed to enable all models');
                    }
                  }}
                >
                  Enable All
                </Button>
                <Button
                  size="small"
                  loading={fetching}
                  onClick={async () => {
                    try {
                      await toggleAllModels(detail.id, false);
                      message.success('All models disabled');
                    } catch (e) {
                      message.error('Failed to disable all models');
                    }
                  }}
                >
                  Disable All
                </Button>
              </>
            )}
            {!detail.builtin && (
              <>
                <Button size="small" icon={<Plus size={14} />} onClick={() => setShowAddModel(true)}>
                  Add Model
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<RefreshCw size={14} />}
                  loading={fetching}
                  onClick={() => doFetchModels(false)}
                >
                  Fetch models
                </Button>
              </>
            )}
          </Flexbox>
        </Flexbox>

        {allModels.length > 0 && (
          <>
          <Input
            placeholder="Search models..."
            prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
            value={modelSearchKeyword}
            onChange={(e) => setModelSearchKeyword(e.target.value)}
            allowClear
            style={{ marginBottom: 8, maxWidth: 240 }}
          />
          <Tabs
            size="small"
            activeKey={modelTypeTab}
            onChange={setModelTypeTab}
            style={{ flexShrink: 0 }}
            items={[
              { key: 'all', label: <span><Grid3X3 size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />All ({modelTypeCounts.all})</span> },
              { key: 'chat', label: <span><MessageSquare size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Chat ({modelTypeCounts.chat ?? 0})</span> },
              { key: 'image', label: <span><Image size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Image ({modelTypeCounts.image ?? 0})</span> },
              { key: 'video', label: <span><Video size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Video ({modelTypeCounts.video ?? 0})</span> },
              { key: 'embedding', label: <span><Zap size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />Embedding ({modelTypeCounts.embedding ?? 0})</span> },
              { key: 'stt', label: <span><Mic size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />ASR ({modelTypeCounts.stt ?? 0})</span> },
              { key: 'tts', label: <span><AudioLines size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />TTS ({modelTypeCounts.tts ?? 0})</span> },
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
                    {m.function_call && (
                      <Tooltip title="Tool Use"><Wrench size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    {m.vision && (
                      <Tooltip title="Vision"><Eye size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    {m.reasoning && (
                      <Tooltip title="Deep Thinking"><Sparkles size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    {m.search && (
                      <Tooltip title="Built-in Search"><Globe size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    {m.image_output && (
                      <Tooltip title="Image Output"><Image size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    {m.video && (
                      <Tooltip title="Video"><Video size={13} style={{ color: token.colorTextSecondary }} /></Tooltip>
                    )}
                    <Switch
                      size="small"
                      checked={m.enabled}
                      onChange={async (checked) => {
                        try {
                          await toggleModel(detail.id, m.id, checked);
                        } catch (e) {
                          message.error('Failed to toggle model');
                        }
                      }}
                    />
                    <Tooltip title="Edit model config">
                      <Button
                        type="text"
                        size="small"
                        icon={<Pencil size={14} />}
                        onClick={() => setEditModel({ id: m.id, display_name: m.display_name, type: m.type, context_window: m.context_window, enabled: m.enabled, function_call: m.function_call, vision: m.vision, reasoning: m.reasoning, search: m.search, image_output: m.image_output, video: m.video })}
                        style={{ width: 24, height: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: token.colorTextSecondary }}
                      />
                    </Tooltip>
                    {!detail.builtin && (
                      <Tooltip title="Remove model">
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<X size={14} />}
                          onClick={() => handleDeleteModel(m.id)}
                          style={{ width: 24, height: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        />
                      </Tooltip>
                    )}
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
                <Text strong style={{ fontSize: 14 }}>No available models</Text>
                <Text type="secondary" style={{ fontSize: 13, textAlign: 'center' }}>
                  Please create a custom model<br />or pull a model to get started.
                </Text>
              </Flexbox>
              {!detail.builtin && (
                <Flexbox horizontal gap={12}>
                  <Button icon={<Plus size={14} />} onClick={() => setShowAddModel(true)}>
                    Add Model
                  </Button>
                  <Button
                    type="primary"
                    icon={<RefreshCw size={14} />}
                    loading={fetching}
                    onClick={() => doFetchModels(false)}
                  >
                    Fetch models
                  </Button>
                </Flexbox>
              )}
            </Flexbox>
          )}
        </div>
      </Flexbox>

      {!detail.builtin && (
        <UpdateProviderModal
          open={showEditModal}
          detail={detail}
          onClose={() => setShowEditModal(false)}
        />
      )}

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
          message.success('Model updated');
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
      message.success('Model added');
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
      title="Create Custom AI Model"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
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
          label="Model ID"
          rules={[{ required: true, message: 'Model ID is required' }]}
          extra="This cannot be modified after creation and will be used as the model ID when calling AI"
        >
          <Input placeholder="Please enter the model ID, e.g., gpt-4o or claude-3.5-sonnet" autoFocus />
        </Form.Item>

        <Form.Item
          name="display_name"
          label="Model Display Name"
        >
          <Input placeholder="Please enter the display name of the model, e.g., ChatGPT, GPT-4, etc." />
        </Form.Item>

        <Form.Item label="Maximum Context Window">
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
              Set the maximum number of tokens supported by the model
            </Text>
          </Flexbox>
        </Form.Item>

        <Divider style={{ margin: '8px 0 16px', borderColor: token.colorBorderSecondary }} />

        <Form.Item
          name="function_call"
          valuePropName="checked"
          label="Support Tool Use"
          extra="This configuration will only enable the model's ability to use tools. Whether the model can truly use the tools depends entirely on the model itself; please test for usability on your own."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="vision"
          valuePropName="checked"
          label="Support Vision"
          extra="This configuration will only enable image upload capabilities in the application. Whether recognition is supported depends entirely on the model itself. Please test the visual recognition capabilities of the model yourself."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="reasoning"
          valuePropName="checked"
          label="Support Deep Thinking"
          extra="This configuration will enable the model's deep thinking capabilities, and the specific effects depend entirely on the model itself. Please test whether this model has usable deep thinking abilities."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="search"
          valuePropName="checked"
          label="Support Built-in Search"
          extra="This setting enables the model's built-in web search capability. Whether the built-in search engine is supported depends on the model itself. Please test the model to verify the availability of this feature."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="image_output"
          valuePropName="checked"
          label="Support Image Generation"
          extra="This setting enables the model's image generation capability only. The actual performance depends entirely on the model itself. Please test the model to determine if it supports image generation."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="video"
          valuePropName="checked"
          label="Support Video Recognition"
          extra="This setting enables video recognition configuration within the application. Whether video recognition is supported depends entirely on the model itself. Please test the model to verify the availability of this feature."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="type"
          label="Model Type"
          extra="Different model types have distinct use cases and capabilities."
        >
          <Select
            options={[
              { value: 'chat', label: 'Chat (chat)' },
              { value: 'image', label: 'Image (image)' },
              { value: 'video', label: 'Video (video)' },
              { value: 'embedding', label: 'Embedding (embedding)' },
              { value: 'stt', label: 'ASR (stt)' },
              { value: 'tts', label: 'TTS (tts)' },
              { value: 'realtime', label: 'Realtime (realtime)' },
            ]}
            placeholder="Select model type"
          />
        </Form.Item>

        <Button type="primary" block size="large" onClick={handleOk} loading={loading}>
          Create Model
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
      title="Custom Model Configuration"
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
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
        <Form.Item label="Model ID">
          <Text type="secondary">{model.id}</Text>
        </Form.Item>

        <Form.Item name="display_name" label="Model Display Name">
          <Input placeholder="Display name" />
        </Form.Item>

        <Form.Item label="Maximum Context Window">
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

        <Form.Item name="enabled" valuePropName="checked" label="Enabled">
          <Switch />
        </Form.Item>

        <Divider style={{ margin: '8px 0 16px', borderColor: token.colorBorderSecondary }} />

        <Form.Item
          name="function_call"
          valuePropName="checked"
          label="Support Tool Use"
          extra="This configuration will only enable the model's ability to use tools. Whether the model can truly use the tools depends entirely on the model itself; please test for usability on your own."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="vision"
          valuePropName="checked"
          label="Support Vision"
          extra="This configuration will only enable image upload capabilities in the application. Whether recognition is supported depends entirely on the model itself. Please test the visual recognition capabilities of the model yourself."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="reasoning"
          valuePropName="checked"
          label="Support Deep Thinking"
          extra="This configuration will enable the model's deep thinking capabilities, and the specific effects depend entirely on the model itself. Please test whether this model has usable deep thinking abilities."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="search"
          valuePropName="checked"
          label="Support Built-in Search"
          extra="This setting enables the model's built-in web search capability. Whether the built-in search engine is supported depends on the model itself. Please test the model to verify the availability of this feature."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="image_output"
          valuePropName="checked"
          label="Support Image Generation"
          extra="This setting enables the model's image generation capability only. The actual performance depends entirely on the model itself. Please test the model to determine if it supports image generation."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="video"
          valuePropName="checked"
          label="Support Video Recognition"
          extra="This setting enables video recognition configuration within the application. Whether video recognition is supported depends entirely on the model itself. Please test the model to verify the availability of this feature."
        >
          <Checkbox />
        </Form.Item>
        <Form.Item
          name="type"
          label="Model Type"
          extra="Different model types have distinct use cases and capabilities."
        >
          <Select
            options={[
              { value: 'chat', label: 'Chat (chat)' },
              { value: 'image', label: 'Image (image)' },
              { value: 'video', label: 'Video (video)' },
              { value: 'embedding', label: 'Embedding (embedding)' },
              { value: 'stt', label: 'ASR (stt)' },
              { value: 'tts', label: 'TTS (tts)' },
              { value: 'realtime', label: 'Realtime (realtime)' },
            ]}
            placeholder="Select model type"
          />
        </Form.Item>

        <Button type="primary" block size="large" onClick={handleOk} loading={loading}>
          Save Changes
        </Button>
      </Form>
    </Modal>
  );
}

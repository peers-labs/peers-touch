import { useEffect, useState, type ReactNode } from 'react';
import {
  Divider,
  Drawer,
  Form,
  message,
  Select,
  Switch,
  Tabs,
  theme,
  Typography,
} from 'antd';
import { Bot, Brain, Code2, Database, Rocket, Search, ShieldCheck, Sparkles, Wrench } from 'lucide-react';
import { Input, Button, Tag, TextArea } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { api, type Agent, type AgentCreate, type AvailableModel } from '../services/desktop_api';
import { useAgentStore } from '../store/agent';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const AVATAR_OPTIONS = ['🤖', '👨‍💻', '🔬', '✍️', '🧠', '🎨', '📊', '🔧', '🌐', '📝', '🎯', '💡', '🛡️', '🚀', '🎓', '🧪'];

type AgentTemplateKey = 'research' | 'coding' | 'operator';

interface AgentTemplate {
  key: AgentTemplateKey;
  icon: ReactNode;
  avatar: string;
  name: string;
  title: string;
  description: string;
  systemPrompt: string;
  openingMessage: string;
  openingQuestions: string[];
  toolsProfile: 'standard' | 'minimal' | 'all';
}

interface AgentSettingsDrawerProps {
  open: boolean;
  editingAgent: Agent | null;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
}

export function AgentSettingsDrawer({ open, editingAgent, onClose, onSaved }: AgentSettingsDrawerProps) {
  const { t } = useTranslation('agent');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState('🤖');
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const { token } = theme.useToken();
  const { loadAgents } = useAgentStore();
  const previewTitle = Form.useWatch('title', form);
  const previewDescription = Form.useWatch('description', form);
  const previewModel = Form.useWatch('model', form);
  const selectedProvider = Form.useWatch('provider', form);
  const previewToolsProfile = Form.useWatch('toolsProfile', form);
  const selectedModelConfig = availableModels.find(
    (model) => model.id === previewModel && (!selectedProvider || model.provider_id === selectedProvider),
  );
  const selectedCliCommand = selectedModelConfig?.runtime_kind === 'cli' ? selectedModelConfig.cli_command || '' : '';
  const providerOptions = Array.from(
    new Map(
      availableModels.map((model) => [
        model.provider_id || model.provider_name,
        {
          label: model.provider_name || model.provider_id,
          value: model.provider_id || model.provider_name,
        },
      ]),
    ).values(),
  ).filter((option) => option.value);
  const modelOptions = availableModels
    .filter((model) => !selectedProvider || model.provider_id === selectedProvider)
    .map((model) => ({
      label: model.display_name || model.id,
      value: model.id,
    }));

  useEffect(() => {
    if (open) {
      void api.listAvailableModels().then((result) => setAvailableModels(result.models)).catch(() => setAvailableModels([]));
      if (editingAgent) {
        form.setFieldsValue({
          name: editingAgent.name,
          title: editingAgent.title,
          description: editingAgent.description,
          systemPrompt: editingAgent.systemPrompt,
          provider: editingAgent.provider || '',
          model: editingAgent.model,
          effort: editingAgent.effort || 'medium',
          visibility: editingAgent.visibility || 'private',
          toolsProfile: editingAgent.toolsProfile || 'standard',
          openingMessage: editingAgent.openingMessage,
          openingQuestions: parseJsonArray(editingAgent.openingQuestions).join('\n'),
          pinned: editingAgent.pinned,
        });
        setSelectedAvatar(editingAgent.avatar || '🤖');
      } else {
        form.resetFields();
        void loadAgentCreationDefaults(form, setAvailableModels);
        setSelectedAvatar('🤖');
      }
    }
  }, [open, editingAgent, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const questionsText = (values.openingQuestions || '').trim();
      const questionsArray = questionsText
        ? questionsText.split('\n').map((q: string) => q.trim()).filter(Boolean)
        : [];

      let savedAgent: Agent;
      if (editingAgent) {
        savedAgent = await api.updateAgent(editingAgent.id, {
          title: values.title,
          description: values.description,
          avatar: selectedAvatar,
          systemPrompt: values.systemPrompt,
          provider: values.provider || '',
          model: values.model,
          effort: values.effort || 'medium',
          visibility: values.visibility || 'private',
          cliCommand: selectedCliCommand,
          toolsProfile: values.toolsProfile,
          openingMessage: values.openingMessage,
          openingQuestions: JSON.stringify(questionsArray),
          pinned: values.pinned,
        });
        message.success(t('agent.drawer.toast.updated'));
      } else {
        const data: AgentCreate = {
          name: values.name,
          title: values.title || values.name,
          description: values.description || '',
          avatar: selectedAvatar,
          systemPrompt: values.systemPrompt || '',
          provider: values.provider || '',
          model: values.model || '',
          effort: values.effort || 'medium',
          visibility: values.visibility || 'private',
          cliCommand: selectedCliCommand,
          toolsProfile: values.toolsProfile || 'standard',
          openingMessage: values.openingMessage || '',
          openingQuestions: JSON.stringify(questionsArray),
          pinned: values.pinned || false,
        };
        savedAgent = await api.createAgent(data);
        message.success(t('agent.drawer.toast.created'));
      }
      await loadAgents();
      onSaved(savedAgent);
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const isBuiltIn = editingAgent?.isDefault;
  const templates: AgentTemplate[] = [
    {
      key: 'research',
      icon: <Search size={16} />,
      avatar: '🔬',
      name: 'research-analyst',
      title: t('agent.drawer.template.research.title'),
      description: t('agent.drawer.template.research.description'),
      systemPrompt: t('agent.drawer.template.research.prompt'),
      openingMessage: t('agent.drawer.template.research.opening'),
      openingQuestions: templateQuestions(t('agent.drawer.template.research.questions')),
      toolsProfile: 'standard',
    },
    {
      key: 'coding',
      icon: <Code2 size={16} />,
      avatar: '👨‍💻',
      name: 'coding-copilot',
      title: t('agent.drawer.template.coding.title'),
      description: t('agent.drawer.template.coding.description'),
      systemPrompt: t('agent.drawer.template.coding.prompt'),
      openingMessage: t('agent.drawer.template.coding.opening'),
      openingQuestions: templateQuestions(t('agent.drawer.template.coding.questions')),
      toolsProfile: 'all',
    },
    {
      key: 'operator',
      icon: <Rocket size={16} />,
      avatar: '🚀',
      name: 'workflow-operator',
      title: t('agent.drawer.template.operator.title'),
      description: t('agent.drawer.template.operator.description'),
      systemPrompt: t('agent.drawer.template.operator.prompt'),
      openingMessage: t('agent.drawer.template.operator.opening'),
      openingQuestions: templateQuestions(t('agent.drawer.template.operator.questions')),
      toolsProfile: 'standard',
    },
  ];

  const applyTemplate = (template: AgentTemplate) => {
    if (!editingAgent) {
      form.setFieldsValue({ name: template.name });
    }
    form.setFieldsValue({
      title: template.title,
      description: template.description,
      systemPrompt: template.systemPrompt,
      openingMessage: template.openingMessage,
      openingQuestions: template.openingQuestions.join('\n'),
      toolsProfile: template.toolsProfile,
      pinned: true,
    });
    setSelectedAvatar(template.avatar);
  };

  return (
    <Drawer
      title={editingAgent ? t('agent.drawer.titleEdit') : t('agent.drawer.titleCreate')}
      open={open}
      onClose={onClose}
      width={760}
      extra={
        <Button type="primary" loading={saving} onClick={handleSubmit}>
          {editingAgent ? t('agent.drawer.save') : t('agent.drawer.create')}
        </Button>
      }
    >
      <Form form={form} layout="vertical" size="middle">
        <Flexbox gap={16}>
          <Flexbox
            gap={14}
            style={{
              padding: 18,
              borderRadius: 18,
              color: '#fff',
              background:
                'radial-gradient(circle at top left, rgba(255,255,255,0.28), transparent 32%), linear-gradient(135deg, #1d4ed8 0%, #7c3aed 54%, #db2777 100%)',
              boxShadow: '0 18px 50px rgba(79, 70, 229, 0.22)',
            }}
          >
            <Flexbox horizontal align="center" gap={14}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 20,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 32,
                  background: 'rgba(255,255,255,0.18)',
                  border: '1px solid rgba(255,255,255,0.28)',
                }}
              >
                {selectedAvatar}
              </div>
              <Flexbox gap={4} style={{ minWidth: 0 }}>
                <Flexbox horizontal align="center" gap={8}>
                  <Tag style={{ margin: 0, color: '#fff', borderColor: 'rgba(255,255,255,0.36)', background: 'rgba(255,255,255,0.16)' }}>
                    {t('agent.drawer.workbenchBadge')}
                  </Tag>
                  {isBuiltIn && (
                    <Tag style={{ margin: 0, color: '#fff', borderColor: 'rgba(255,255,255,0.36)', background: 'rgba(255,255,255,0.16)' }}>
                      {t('agent.profile.builtIn')}
                    </Tag>
                  )}
                </Flexbox>
                <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>
                  {previewTitle || t('agent.drawer.previewTitle')}
                </span>
                <span style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(255,255,255,0.78)' }}>
                  {previewDescription || t('agent.drawer.previewDescription')}
                </span>
              </Flexbox>
            </Flexbox>

            <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
              <CapabilityPill icon={<Bot size={13} />} label={previewModel || t('agent.drawer.defaultModel')} />
              <CapabilityPill icon={<Wrench size={13} />} label={t(`agent.drawer.toolAccess.${previewToolsProfile || 'standard'}`)} />
              <CapabilityPill icon={<Brain size={13} />} label={t('agent.drawer.previewMemory')} />
              <CapabilityPill icon={<ShieldCheck size={13} />} label={t('agent.drawer.previewApproval')} />
            </Flexbox>
          </Flexbox>

          {!editingAgent && (
            <Flexbox gap={10}>
              <Flexbox horizontal align="center" justify="space-between">
                <Flexbox gap={2}>
                  <Text strong>{t('agent.drawer.template.title')}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{t('agent.drawer.template.description')}</Text>
                </Flexbox>
                <Sparkles size={16} style={{ color: token.colorPrimary }} />
              </Flexbox>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                {templates.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    onClick={() => applyTemplate(template)}
                    style={{
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: 14,
                      padding: 12,
                      minHeight: 112,
                      textAlign: 'left',
                      cursor: 'pointer',
                      background: token.colorBgContainer,
                      color: token.colorText,
                    }}
                  >
                    <Flexbox gap={8}>
                      <Flexbox horizontal align="center" gap={8}>
                        <span style={{ display: 'flex', color: token.colorPrimary }}>{template.icon}</span>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{template.title}</span>
                      </Flexbox>
                      <span style={{ fontSize: 12, color: token.colorTextSecondary, lineHeight: 1.5 }}>
                        {template.description}
                      </span>
                    </Flexbox>
                  </button>
                ))}
              </div>
            </Flexbox>
          )}

          <Tabs
            items={[
              {
                key: 'identity',
                label: t('agent.drawer.tab.identity'),
                children: (
                  <Flexbox gap={14}>
                    <Form.Item label={t('agent.drawer.avatar')}>
                      <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
                        {AVATAR_OPTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => setSelectedAvatar(emoji)}
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 12,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: 20,
                              cursor: 'pointer',
                              border: selectedAvatar === emoji ? `2px solid ${token.colorPrimary}` : `1px solid ${token.colorBorderSecondary}`,
                              background: selectedAvatar === emoji ? token.colorPrimaryBg : token.colorFillQuaternary,
                              transition: 'all 0.15s',
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </Flexbox>
                    </Form.Item>

                    {!editingAgent && (
                      <Form.Item
                        name="name"
                        label={t('agent.drawer.nameSlug')}
                        rules={[
                          { required: true, message: t('agent.drawer.nameRequired') },
                          { pattern: /^[a-z][a-z0-9-]*$/, message: t('agent.drawer.namePattern') },
                        ]}
                        extra={t('agent.drawer.nameExtra')}
                      >
                        <Input placeholder={t('agent.drawer.namePlaceholder')} />
                      </Form.Item>
                    )}

                    <Form.Item name="title" label={t('agent.drawer.displayName')} rules={[{ required: true }]}>
                      <Input placeholder={t('agent.drawer.displayNamePlaceholder')} />
                    </Form.Item>

                    <Form.Item name="description" label={t('agent.drawer.description')}>
                      <Input placeholder={t('agent.drawer.descriptionPlaceholder')} />
                    </Form.Item>

                    <Flexbox horizontal align="center" justify="space-between" style={{ padding: 12, borderRadius: 12, background: token.colorFillQuaternary }}>
                      <Flexbox>
                        <Text style={{ fontSize: 14 }}>{t('agent.drawer.pinToSidebar')}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('agent.drawer.pinToSidebarDesc')}</Text>
                      </Flexbox>
                      <Form.Item name="pinned" valuePropName="checked" style={{ marginBottom: 0 }}>
                        <Switch />
                      </Form.Item>
                    </Flexbox>
                  </Flexbox>
                ),
              },
              {
                key: 'prompt',
                label: t('agent.drawer.tab.prompt'),
                children: (
                  <Flexbox gap={14}>
                    <Form.Item
                      name="systemPrompt"
                      label={t('agent.drawer.systemPrompt')}
                      extra={t('agent.drawer.systemPromptExtra')}
                    >
                      <TextArea
                        rows={10}
                        placeholder={t('agent.drawer.systemPromptPlaceholder')}
                        style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6 }}
                      />
                    </Form.Item>
                  </Flexbox>
                ),
              },
              {
                key: 'runtime',
                label: t('agent.drawer.tab.runtime'),
                children: (
                  <Flexbox gap={14}>
                    <Form.Item name="provider" label={t('agent.drawer.provider')}>
                      <Select
                        allowClear
                        showSearch
                        placeholder={t('agent.drawer.providerPlaceholder')}
                        options={providerOptions}
                        onChange={() => form.setFieldValue('model', '')}
                        filterOption={(input, option) =>
                          String(option?.label || '').toLowerCase().includes(input.toLowerCase())
                        }
                      />
                    </Form.Item>

                    <Form.Item
                      name="model"
                      label={t('agent.drawer.modelOverride')}
                      extra={t('agent.drawer.modelOverrideExtra')}
                    >
                      <Select
                        allowClear
                        showSearch
                        placeholder={t('agent.drawer.modelOverridePlaceholder')}
                        options={modelOptions}
                        filterOption={(input, option) =>
                          String(option?.label || '').toLowerCase().includes(input.toLowerCase())
                        }
                      />
                    </Form.Item>

                    <Form.Item name="effort" label={t('agent.drawer.effort')}>
                      <Select
                        options={[
                          { label: t('agent.drawer.effort.low'), value: 'low' },
                          { label: t('agent.drawer.effort.medium'), value: 'medium' },
                          { label: t('agent.drawer.effort.high'), value: 'high' },
                        ]}
                      />
                    </Form.Item>

                    <Form.Item name="visibility" label={t('agent.drawer.visibility')}>
                      <Select
                        options={[
                          { label: t('agent.drawer.visibility.private'), value: 'private' },
                          { label: t('agent.drawer.visibility.workspace'), value: 'workspace' },
                          { label: t('agent.drawer.visibility.public'), value: 'public' },
                        ]}
                      />
                    </Form.Item>

                    <Form.Item name="toolsProfile" label={t('agent.drawer.toolAccess')}>
                      <Select
                        options={[
                          { label: t('agent.drawer.toolAccess.standard'), value: 'standard' },
                          { label: t('agent.drawer.toolAccess.minimal'), value: 'minimal' },
                          { label: t('agent.drawer.toolAccess.all'), value: 'all' },
                        ]}
                      />
                    </Form.Item>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                      <CapabilityCard icon={<Wrench size={16} />} title={t('agent.drawer.capability.tools')} desc={t('agent.drawer.capability.toolsDesc')} />
                      <CapabilityCard icon={<Database size={16} />} title={t('agent.drawer.capability.knowledge')} desc={t('agent.drawer.capability.knowledgeDesc')} />
                      <CapabilityCard icon={<Brain size={16} />} title={t('agent.drawer.capability.memory')} desc={t('agent.drawer.capability.memoryDesc')} />
                      <CapabilityCard icon={<ShieldCheck size={16} />} title={t('agent.drawer.capability.approval')} desc={t('agent.drawer.capability.approvalDesc')} />
                    </div>
                  </Flexbox>
                ),
              },
              {
                key: 'opening',
                label: t('agent.drawer.tab.opening'),
                children: (
                  <Flexbox gap={14}>
                    <Form.Item name="openingMessage" label={t('agent.drawer.welcomeMessage')}>
                      <Input placeholder={t('agent.drawer.welcomeMessagePlaceholder')} />
                    </Form.Item>

                    <Form.Item
                      name="openingQuestions"
                      label={t('agent.drawer.suggestedQuestions')}
                      extra={t('agent.drawer.suggestedQuestionsExtra')}
                    >
                      <TextArea rows={5} placeholder={t('agent.drawer.suggestedQuestionsPlaceholder')} />
                    </Form.Item>
                  </Flexbox>
                ),
              },
            ]}
          />

          <Divider style={{ margin: '0 0 4px' }} />

          <Text type="secondary" style={{ fontSize: 12 }}>
            {isBuiltIn ? t('agent.drawer.builtInNote') : t('agent.drawer.workbenchFooter')}
          </Text>
        </Flexbox>
      </Form>
    </Drawer>
  );
}

function CapabilityPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 999,
        fontSize: 12,
        color: 'rgba(255,255,255,0.9)',
        background: 'rgba(255,255,255,0.14)',
        border: '1px solid rgba(255,255,255,0.22)',
      }}
    >
      {icon}
      {label}
    </span>
  );
}

function CapabilityCard({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      gap={6}
      style={{
        padding: 12,
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <Flexbox horizontal align="center" gap={8}>
        <span style={{ display: 'flex', color: token.colorPrimary }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>{title}</span>
      </Flexbox>
      <span style={{ fontSize: 12, color: token.colorTextSecondary, lineHeight: 1.5 }}>{desc}</span>
    </Flexbox>
  );
}

function parseJsonArray(json: string): string[] {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function settingString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function settingResultString(result: unknown): string {
  return settingString((result as { data?: { value?: unknown }; value?: unknown })?.data?.value)
    || settingString((result as { value?: unknown })?.value);
}

async function loadAgentCreationDefaults(
  form: ReturnType<typeof Form.useForm>[0],
  setAvailableModels: (models: AvailableModel[]) => void,
) {
  const [modelsResult, providerResult, modelResult, effortResult] = await Promise.all([
    api.listAvailableModels().catch(() => ({ models: [] as AvailableModel[] })),
    api.settingsGet({ key: 'settings.agent.defaultProvider' }).catch(() => ({ value: '' })),
    api.settingsGet({ key: 'settings.agent.defaultModel' }).catch(() => ({ value: '' })),
    api.settingsGet({ key: 'settings.agent.defaultEffort' }).catch(() => ({ value: 'medium' })),
  ]);
  const models = modelsResult.models;
  const defaultProvider = settingResultString(providerResult);
  const defaultModel = settingResultString(modelResult);
  const fallbackModel = models.find((model) => model.id === defaultModel) || models[0];

  setAvailableModels(models);
  form.setFieldsValue({
    provider: defaultProvider || fallbackModel?.provider_id || '',
    model: defaultModel || fallbackModel?.id || '',
    effort: settingResultString(effortResult) || 'medium',
    visibility: 'private',
    toolsProfile: 'standard',
    pinned: false,
  });
}

function templateQuestions(raw: string): string[] {
  return raw
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

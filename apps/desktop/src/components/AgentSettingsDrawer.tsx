import { useEffect, useState } from 'react';
import {
  Form,
  Select,
  Switch,
  Typography,
  message,
} from 'antd';
import { Drawer, Input, Button, TextArea } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { api, type Agent, type AgentCreate } from '../services/desktop_api';
import { useChatStore } from '../store/chat';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const AVATAR_OPTIONS = ['🤖', '👨‍💻', '🔬', '✍️', '🧠', '🎨', '📊', '🔧', '🌐', '📝', '🎯', '💡', '🛡️', '🚀', '🎓', '🧪'];

interface AgentSettingsDrawerProps {
  open: boolean;
  editingAgent: Agent | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AgentSettingsDrawer({ open, editingAgent, onClose, onSaved }: AgentSettingsDrawerProps) {
  const { t } = useTranslation('agent');
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState('🤖');
  const { loadAgents } = useChatStore();

  useEffect(() => {
    if (open) {
      if (editingAgent) {
        form.setFieldsValue({
          name: editingAgent.name,
          title: editingAgent.title,
          description: editingAgent.description,
          systemPrompt: editingAgent.systemPrompt,
          model: editingAgent.model,
          toolsProfile: editingAgent.toolsProfile || 'standard',
          openingMessage: editingAgent.openingMessage,
          openingQuestions: parseJsonArray(editingAgent.openingQuestions).join('\n'),
          pinned: editingAgent.pinned,
        });
        setSelectedAvatar(editingAgent.avatar || '🤖');
      } else {
        form.resetFields();
        form.setFieldsValue({
          toolsProfile: 'standard',
          pinned: false,
        });
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

      if (editingAgent) {
        await api.updateAgent(editingAgent.id, {
          title: values.title,
          description: values.description,
          avatar: selectedAvatar,
          systemPrompt: values.systemPrompt,
          model: values.model,
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
          model: values.model || '',
          toolsProfile: values.toolsProfile || 'standard',
          openingMessage: values.openingMessage || '',
          openingQuestions: JSON.stringify(questionsArray),
          pinned: values.pinned || false,
        };
        await api.createAgent(data);
        message.success(t('agent.drawer.toast.created'));
      }
      loadAgents();
      onSaved();
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const isBuiltIn = editingAgent?.isDefault;

  return (
    <Drawer
      title={editingAgent ? t('agent.drawer.titleEdit') : t('agent.drawer.titleCreate')}
      open={open}
      onClose={onClose}
      size="default"
      extra={
        <Button type="primary" loading={saving} onClick={handleSubmit}>
          {editingAgent ? t('agent.drawer.save') : t('agent.drawer.create')}
        </Button>
      }
    >
      <Form form={form} layout="vertical" size="middle">
        {/* Avatar picker */}
        <Form.Item label={t('agent.drawer.avatar')}>
          <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
            {AVATAR_OPTIONS.map((emoji) => (
              <div
                key={emoji}
                onClick={() => setSelectedAvatar(emoji)}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                  cursor: 'pointer',
                  border: selectedAvatar === emoji ? '2px solid #667eea' : '2px solid transparent',
                  background: selectedAvatar === emoji ? '#f0f5ff' : '#f5f5f5',
                  transition: 'all 0.15s',
                }}
              >
                {emoji}
              </div>
            ))}
          </Flexbox>
        </Form.Item>

        {/* Name (slug) — only for create */}
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
            <Input placeholder="my-agent" />
          </Form.Item>
        )}

        {/* Display name */}
        <Form.Item name="title" label={t('agent.drawer.displayName')} rules={[{ required: true }]}>
          <Input placeholder="My Custom Agent" />
        </Form.Item>

        <Form.Item name="description" label={t('agent.drawer.description')}>
          <Input placeholder={t('agent.drawer.descriptionPlaceholder')} />
        </Form.Item>

        {/* System Prompt */}
        <Form.Item
          name="systemPrompt"
          label={t('agent.drawer.systemPrompt')}
          extra={t('agent.drawer.systemPromptExtra')}
        >
          <TextArea
            rows={6}
            placeholder={t('agent.drawer.systemPromptPlaceholder')}
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </Form.Item>

        {/* Model */}
        <Form.Item
          name="model"
          label={t('agent.drawer.modelOverride')}
          extra={t('agent.drawer.modelOverrideExtra')}
        >
          <Input placeholder={t('agent.drawer.modelOverridePlaceholder')} />
        </Form.Item>

        {/* Tools Profile */}
        <Form.Item name="toolsProfile" label={t('agent.drawer.toolAccess')}>
          <Select
            options={[
              { label: t('agent.drawer.toolAccess.standard'), value: 'standard' },
              { label: t('agent.drawer.toolAccess.minimal'), value: 'minimal' },
              { label: t('agent.drawer.toolAccess.all'), value: 'all' },
            ]}
          />
        </Form.Item>

        <Form.Item name="openingMessage" label={t('agent.drawer.welcomeMessage')}>
          <Input placeholder={t('agent.drawer.welcomeMessagePlaceholder')} />
        </Form.Item>

        {/* Opening Questions */}
        <Form.Item
          name="openingQuestions"
          label={t('agent.drawer.suggestedQuestions')}
          extra={t('agent.drawer.suggestedQuestionsExtra')}
        >
          <TextArea rows={3} placeholder={"Help me write code\nSearch the web\nAnalyze a file"} />
        </Form.Item>

        {/* Pinned */}
        <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 16 }}>
          <Flexbox>
            <Text style={{ fontSize: 14 }}>{t('agent.drawer.pinToSidebar')}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{t('agent.drawer.pinToSidebarDesc')}</Text>
          </Flexbox>
          <Form.Item name="pinned" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch />
          </Form.Item>
        </Flexbox>

        {isBuiltIn && (
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            {t('agent.drawer.builtInNote')}
          </Text>
        )}
      </Form>
    </Drawer>
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

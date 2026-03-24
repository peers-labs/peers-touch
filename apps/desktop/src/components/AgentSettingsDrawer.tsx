import { useEffect, useState } from 'react';
import {
  Drawer,
  Form,
  Input,
  Select,
  Button,
  Switch,
  Typography,
  message,
} from 'antd';
import { Flexbox } from 'react-layout-kit';
import { api, type Agent, type AgentCreate } from '../services/desktop_api';
import { useChatStore } from '../store/chat';

const { TextArea } = Input;
const { Text } = Typography;

const AVATAR_OPTIONS = ['🤖', '👨‍💻', '🔬', '✍️', '🧠', '🎨', '📊', '🔧', '🌐', '📝', '🎯', '💡', '🛡️', '🚀', '🎓', '🧪'];

interface AgentSettingsDrawerProps {
  open: boolean;
  editingAgent: Agent | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AgentSettingsDrawer({ open, editingAgent, onClose, onSaved }: AgentSettingsDrawerProps) {
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
        message.success('Agent updated');
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
        message.success('Agent created');
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
      title={editingAgent ? 'Agent Profile' : 'Create Agent'}
      open={open}
      onClose={onClose}
      size="default"
      extra={
        <Button type="primary" loading={saving} onClick={handleSubmit}>
          {editingAgent ? 'Save' : 'Create'}
        </Button>
      }
    >
      <Form form={form} layout="vertical" size="middle">
        {/* Avatar picker */}
        <Form.Item label="Avatar">
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
            label="Name (slug)"
            rules={[
              { required: true, message: 'Name is required' },
              { pattern: /^[a-z][a-z0-9-]*$/, message: 'Lowercase letters, numbers, hyphens only' },
            ]}
            extra="Unique identifier. Cannot be changed after creation."
          >
            <Input placeholder="my-agent" />
          </Form.Item>
        )}

        {/* Display name */}
        <Form.Item name="title" label="Display Name" rules={[{ required: true }]}>
          <Input placeholder="My Custom Agent" />
        </Form.Item>

        <Form.Item name="description" label="Description">
          <Input placeholder="A brief description of what this agent does" />
        </Form.Item>

        {/* System Prompt */}
        <Form.Item
          name="systemPrompt"
          label="System Prompt"
          extra="The agent's personality, instructions, and behavior. Leave empty to use the default."
        >
          <TextArea
            rows={6}
            placeholder="You are a helpful assistant that..."
            style={{ fontFamily: 'monospace', fontSize: 13 }}
          />
        </Form.Item>

        {/* Model */}
        <Form.Item
          name="model"
          label="Model Override"
          extra="Leave empty to use the system default model."
        >
          <Input placeholder="e.g. gpt-4o, claude-sonnet-4-20250514" />
        </Form.Item>

        {/* Tools Profile */}
        <Form.Item name="toolsProfile" label="Tool Access">
          <Select
            options={[
              { label: 'Standard (file, shell, web, memory)', value: 'standard' },
              { label: 'Minimal (no shell, no file write)', value: 'minimal' },
              { label: 'All tools', value: 'all' },
            ]}
          />
        </Form.Item>

        {/* Opening Message */}
        <Form.Item name="openingMessage" label="Welcome Message">
          <Input placeholder="Hi! How can I help you today?" />
        </Form.Item>

        {/* Opening Questions */}
        <Form.Item
          name="openingQuestions"
          label="Suggested Questions"
          extra="One per line. Shown as quick-action buttons on the welcome screen."
        >
          <TextArea rows={3} placeholder={"Help me write code\nSearch the web\nAnalyze a file"} />
        </Form.Item>

        {/* Pinned */}
        <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 16 }}>
          <Flexbox>
            <Text style={{ fontSize: 14 }}>Pin to sidebar</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>Keep this agent at the top of the list</Text>
          </Flexbox>
          <Form.Item name="pinned" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch />
          </Form.Item>
        </Flexbox>

        {isBuiltIn && (
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            This is a built-in agent. You can customize it but cannot delete it.
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

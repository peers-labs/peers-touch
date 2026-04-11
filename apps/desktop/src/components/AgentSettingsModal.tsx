import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Select,
  Switch,
  Slider,
  InputNumber,
  Divider,
  message,
  theme,
} from 'antd';
import { Tabs, Input, TextArea, Button } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { User, MessageSquare, Settings2, Cpu, Plus, X, GripVertical } from 'lucide-react';
import { api, type Agent, type AgentChatConfig, type AgentParams, parseAgentChatConfig, parseAgentParams } from '../services/desktop_api';

const AVATAR_OPTIONS = ['🤖', '👨‍💻', '🔬', '✍️', '🧠', '🎨', '📊', '🔧', '🌐', '📝', '🎯', '💡', '🛡️', '🚀', '🎓', '🧪', '🏗️', '🎭', '📈', '🔍'];

const COLOR_SWATCHES = [
  '', '#f5222d', '#fa541c', '#fa8c16', '#fadb14',
  '#52c41a', '#13c2c2', '#1677ff', '#2f54eb',
  '#722ed1', '#eb2f96', '#ff4d4f', '#ff7a45',
];

interface AgentSettingsModalProps {
  open: boolean;
  agent: Agent;
  onClose: () => void;
  onSaved: (agent: Agent) => void;
}

function SliderWithToggle({
  label,
  description,
  value,
  checked,
  onToggle,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  description?: string;
  value: number | undefined;
  checked: boolean;
  onToggle: (v: boolean) => void;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox style={{ marginBottom: 16 }}>
      <Flexbox horizontal align="center" justify="space-between">
        <Flexbox>
          <span style={{ fontSize: 14, fontWeight: 500, color: token.colorText }}>{label}</span>
          {description && (
            <span style={{ fontSize: 12, color: token.colorTextDescription }}>{description}</span>
          )}
        </Flexbox>
        <Flexbox horizontal align="center" gap={12}>
          {checked && (
            <Flexbox horizontal align="center" gap={8} style={{ width: 220 }}>
              <Slider
                min={min}
                max={max}
                step={step}
                value={value ?? min}
                onChange={onChange}
                style={{ flex: 1 }}
              />
              <InputNumber
                min={min}
                max={max}
                step={step}
                value={value ?? min}
                onChange={(v) => v !== null && onChange(v)}
                size="small"
                style={{ width: 68 }}
              />
            </Flexbox>
          )}
          <Switch checked={checked} onChange={onToggle} size={checked ? 'small' : 'default'} />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}

export function AgentSettingsModal({ open, agent, onClose, onSaved }: AgentSettingsModalProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('info');

  // Agent Info state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState('');
  const [bgColor, setBgColor] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // Opening state
  const [openingMessage, setOpeningMessage] = useState('');
  const [openingQuestions, setOpeningQuestions] = useState<string[]>([]);
  const [newQuestion, setNewQuestion] = useState('');

  // Chat preferences state
  const [chatConfig, setChatConfig] = useState<AgentChatConfig>({});

  // Model params state
  const [params, setParams] = useState<AgentParams>({});
  const [enabledParams, setEnabledParams] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open || !agent) return;
    setTitle(agent.title || '');
    setDescription(agent.description || '');
    setAvatar(agent.avatar || '🤖');
    setBgColor(agent.backgroundColor || '');
    try {
      setTags(JSON.parse(agent.tags || '[]'));
    } catch {
      setTags([]);
    }
    setOpeningMessage(agent.openingMessage || '');
    try {
      setOpeningQuestions(JSON.parse(agent.openingQuestions || '[]'));
    } catch {
      setOpeningQuestions([]);
    }
    const cc = parseAgentChatConfig(agent);
    setChatConfig(cc);
    const p = parseAgentParams(agent);
    setParams(p);
    setEnabledParams({
      temperature: p.temperature !== undefined,
      top_p: p.top_p !== undefined,
      frequency_penalty: p.frequency_penalty !== undefined,
      presence_penalty: p.presence_penalty !== undefined,
      max_tokens: p.max_tokens !== undefined,
    });
  }, [open, agent]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const finalParams: AgentParams = {};
      if (enabledParams.temperature) finalParams.temperature = params.temperature ?? 0.7;
      if (enabledParams.top_p) finalParams.top_p = params.top_p ?? 1;
      if (enabledParams.frequency_penalty) finalParams.frequency_penalty = params.frequency_penalty ?? 0;
      if (enabledParams.presence_penalty) finalParams.presence_penalty = params.presence_penalty ?? 0;
      if (enabledParams.max_tokens) finalParams.max_tokens = params.max_tokens ?? 4096;

      const updated = await api.updateAgent(agent.id, {
        title,
        description,
        avatar,
        backgroundColor: bgColor,
        tags: JSON.stringify(tags),
        openingMessage,
        openingQuestions: JSON.stringify(openingQuestions),
        chatConfig: JSON.stringify(chatConfig),
        params: JSON.stringify(finalParams),
      });
      message.success(t('agent.settings.saved'));
      onSaved(updated);
    } catch (err: any) {
      message.error(err.message || t('agent.settings.failedToSave'));
    } finally {
      setSaving(false);
    }
  }, [agent, title, description, avatar, bgColor, tags, openingMessage, openingQuestions, chatConfig, params, enabledParams, onSaved, t]);

  const addQuestion = useCallback(() => {
    const q = newQuestion.trim();
    if (!q) return;
    if (openingQuestions.includes(q)) {
      message.warning(t('agent.settings.opening.questionExists'));
      return;
    }
    setOpeningQuestions((prev) => [...prev, q]);
    setNewQuestion('');
  }, [newQuestion, openingQuestions, t]);

  const removeQuestion = useCallback((idx: number) => {
    setOpeningQuestions((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const tabItems = useMemo(() => [
    {
      key: 'info',
      label: (
        <Flexbox horizontal align="center" gap={6}>
          <User size={14} />
          {t('agent.settings.tab.info')}
        </Flexbox>
      ),
      children: (
        <Flexbox gap={16} style={{ padding: '8px 0' }}>
          {/* Avatar */}
          <Flexbox gap={6}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.info.avatar')}</span>
            <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
              {AVATAR_OPTIONS.map((emoji) => (
                <div
                  key={emoji}
                  onClick={() => setAvatar(emoji)}
                  style={{
                    width: 40, height: 40, borderRadius: 10,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, cursor: 'pointer',
                    border: avatar === emoji ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                    background: avatar === emoji ? token.colorPrimaryBg : token.colorFillQuaternary,
                    transition: 'all 0.15s',
                  }}
                >
                  {emoji}
                </div>
              ))}
            </Flexbox>
          </Flexbox>

          {/* Background Color */}
          <Flexbox gap={6}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.info.bgColor')}</span>
            <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
              {COLOR_SWATCHES.map((color) => (
                <div
                  key={color || 'none'}
                  onClick={() => setBgColor(color)}
                  style={{
                    width: 28, height: 28, borderRadius: 14,
                    background: color || `repeating-conic-gradient(${token.colorBorderSecondary} 0% 25%, transparent 0% 50%) 50% / 12px 12px`,
                    cursor: 'pointer',
                    border: bgColor === color ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                    transition: 'all 0.15s',
                  }}
                />
              ))}
            </Flexbox>
          </Flexbox>

          {/* Name */}
          <Flexbox gap={4}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.info.name')}</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('agent.settings.info.namePlaceholder')} />
          </Flexbox>

          {/* Description */}
          <Flexbox gap={4}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.info.description')}</span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('agent.settings.info.descriptionPlaceholder')} />
          </Flexbox>

          {/* Tags */}
          <Flexbox gap={4}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.info.tags')}</span>
            <Select
              mode="tags"
              value={tags}
              onChange={setTags}
              placeholder={t('agent.settings.info.tagsPlaceholder')}
              style={{ width: '100%' }}
              tokenSeparators={[',']}
            />
          </Flexbox>
        </Flexbox>
      ),
    },
    {
      key: 'opening',
      label: (
        <Flexbox horizontal align="center" gap={6}>
          <MessageSquare size={14} />
          {t('agent.settings.tab.opening')}
        </Flexbox>
      ),
      children: (
        <Flexbox gap={16} style={{ padding: '8px 0' }}>
          {/* Opening Message */}
          <Flexbox gap={4}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.opening.message')}</span>
            <span style={{ fontSize: 12, color: token.colorTextDescription }}>
              {t('agent.settings.opening.messageDesc')}
            </span>
            <TextArea
              value={openingMessage}
              onChange={(e) => setOpeningMessage(e.target.value)}
              rows={4}
              placeholder={t('agent.settings.opening.messagePlaceholder')}
            />
          </Flexbox>

          {/* Opening Questions */}
          <Flexbox gap={4}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.opening.questions')}</span>
            <span style={{ fontSize: 12, color: token.colorTextDescription }}>
              {t('agent.settings.opening.questionsDesc')}
            </span>
            <Flexbox gap={6}>
              {openingQuestions.map((q, i) => (
                <Flexbox
                  key={i}
                  horizontal
                  align="center"
                  gap={8}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                  }}
                >
                  <GripVertical size={14} style={{ color: token.colorTextQuaternary, cursor: 'grab' }} />
                  <span style={{ flex: 1, fontSize: 13 }}>{q}</span>
                  <X
                    size={14}
                    style={{ cursor: 'pointer', color: token.colorTextSecondary }}
                    onClick={() => removeQuestion(i)}
                  />
                </Flexbox>
              ))}
              <Flexbox horizontal gap={8}>
                <Input
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder={t('agent.settings.opening.questionPlaceholder')}
                  onPressEnter={addQuestion}
                  style={{ flex: 1 }}
                />
                <Button icon={<Plus size={14} />} onClick={addQuestion} />
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      ),
    },
    {
      key: 'chat',
      label: (
        <Flexbox horizontal align="center" gap={6}>
          <Settings2 size={14} />
          {t('agent.settings.tab.chat')}
        </Flexbox>
      ),
      children: (
        <Flexbox gap={4} style={{ padding: '8px 0' }}>
          {/* Streaming */}
          <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 12 }}>
            <Flexbox>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.chat.streaming')}</span>
              <span style={{ fontSize: 12, color: token.colorTextDescription }}>{t('agent.settings.chat.streamingDesc')}</span>
            </Flexbox>
            <Switch
              checked={chatConfig.enableStreaming !== false}
              onChange={(v) => setChatConfig((c) => ({ ...c, enableStreaming: v }))}
            />
          </Flexbox>

          {/* History Count */}
          <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 12 }}>
            <Flexbox>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.chat.historyCount')}</span>
              <span style={{ fontSize: 12, color: token.colorTextDescription }}>{t('agent.settings.chat.historyCountDesc')}</span>
            </Flexbox>
            <Switch
              checked={chatConfig.enableHistoryCount ?? false}
              onChange={(v) => setChatConfig((c) => ({ ...c, enableHistoryCount: v }))}
            />
          </Flexbox>
          {chatConfig.enableHistoryCount && (
            <Flexbox horizontal align="center" gap={12} style={{ marginBottom: 12, paddingLeft: 16 }}>
              <Slider
                min={1}
                max={50}
                value={chatConfig.historyCount ?? 20}
                onChange={(v) => setChatConfig((c) => ({ ...c, historyCount: v }))}
                style={{ flex: 1 }}
              />
              <InputNumber
                min={1}
                max={50}
                value={chatConfig.historyCount ?? 20}
                onChange={(v) => v !== null && setChatConfig((c) => ({ ...c, historyCount: v }))}
                size="small"
                style={{ width: 60 }}
              />
            </Flexbox>
          )}

          {/* Context Compression */}
          <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 12 }}>
            <Flexbox>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.chat.contextCompression')}</span>
              <span style={{ fontSize: 12, color: token.colorTextDescription }}>{t('agent.settings.chat.contextCompressionDesc')}</span>
            </Flexbox>
            <Switch
              checked={chatConfig.enableContextCompression ?? false}
              onChange={(v) => setChatConfig((c) => ({ ...c, enableContextCompression: v }))}
            />
          </Flexbox>

          {/* Search Mode */}
          <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 12 }}>
            <Flexbox>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.chat.searchMode')}</span>
              <span style={{ fontSize: 12, color: token.colorTextDescription }}>{t('agent.settings.chat.searchModeDesc')}</span>
            </Flexbox>
            <Select
              value={chatConfig.searchMode ?? 'off'}
              onChange={(v) => setChatConfig((c) => ({ ...c, searchMode: v }))}
              style={{ width: 120 }}
              size="small"
              options={[
                { value: 'off', label: t('agent.settings.chat.searchMode.off') },
                { value: 'auto', label: t('agent.settings.chat.searchMode.auto') },
                { value: 'on', label: t('agent.settings.chat.searchMode.always') },
              ]}
            />
          </Flexbox>

          <Divider style={{ margin: '8px 0' }} />

          {/* Memory */}
          <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 12 }}>
            <Flexbox>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.chat.memory')}</span>
              <span style={{ fontSize: 12, color: token.colorTextDescription }}>{t('agent.settings.chat.memoryDesc')}</span>
            </Flexbox>
            <Switch
              checked={chatConfig.memory?.enabled ?? false}
              onChange={(v) => setChatConfig((c) => ({ ...c, memory: { ...c.memory, enabled: v } }))}
            />
          </Flexbox>
          {chatConfig.memory?.enabled && (
            <Flexbox horizontal align="center" justify="space-between" style={{ marginBottom: 12, paddingLeft: 16 }}>
              <span style={{ fontSize: 13, color: token.colorTextSecondary }}>{t('agent.settings.chat.memoryEffort')}</span>
              <Select
                value={chatConfig.memory?.effort ?? 'medium'}
                onChange={(v) => setChatConfig((c) => ({ ...c, memory: { ...c.memory, enabled: true, effort: v } }))}
                style={{ width: 120 }}
                size="small"
                options={[
                  { value: 'low', label: t('agent.settings.chat.memoryEffort.low') },
                  { value: 'medium', label: t('agent.settings.chat.memoryEffort.medium') },
                  { value: 'high', label: t('agent.settings.chat.memoryEffort.high') },
                ]}
              />
            </Flexbox>
          )}
        </Flexbox>
      ),
    },
    {
      key: 'model',
      label: (
        <Flexbox horizontal align="center" gap={6}>
          <Cpu size={14} />
          {t('agent.settings.tab.model')}
        </Flexbox>
      ),
      children: (
        <Flexbox gap={4} style={{ padding: '8px 0' }}>
          <SliderWithToggle
            label={t('agent.settings.model.temperature')}
            description={t('agent.settings.model.temperatureDesc')}
            value={params.temperature}
            checked={enabledParams.temperature ?? false}
            onToggle={(v) => {
              setEnabledParams((e) => ({ ...e, temperature: v }));
              if (v && params.temperature === undefined) setParams((p) => ({ ...p, temperature: 0.7 }));
            }}
            onChange={(v) => setParams((p) => ({ ...p, temperature: v }))}
            min={0}
            max={2}
            step={0.1}
          />
          <SliderWithToggle
            label={t('agent.settings.model.topP')}
            description={t('agent.settings.model.topPDesc')}
            value={params.top_p}
            checked={enabledParams.top_p ?? false}
            onToggle={(v) => {
              setEnabledParams((e) => ({ ...e, top_p: v }));
              if (v && params.top_p === undefined) setParams((p) => ({ ...p, top_p: 1 }));
            }}
            onChange={(v) => setParams((p) => ({ ...p, top_p: v }))}
            min={0}
            max={1}
            step={0.1}
          />
          <SliderWithToggle
            label={t('agent.settings.model.frequencyPenalty')}
            description={t('agent.settings.model.frequencyPenaltyDesc')}
            value={params.frequency_penalty}
            checked={enabledParams.frequency_penalty ?? false}
            onToggle={(v) => {
              setEnabledParams((e) => ({ ...e, frequency_penalty: v }));
              if (v && params.frequency_penalty === undefined) setParams((p) => ({ ...p, frequency_penalty: 0 }));
            }}
            onChange={(v) => setParams((p) => ({ ...p, frequency_penalty: v }))}
            min={-2}
            max={2}
            step={0.1}
          />
          <SliderWithToggle
            label={t('agent.settings.model.presencePenalty')}
            description={t('agent.settings.model.presencePenaltyDesc')}
            value={params.presence_penalty}
            checked={enabledParams.presence_penalty ?? false}
            onToggle={(v) => {
              setEnabledParams((e) => ({ ...e, presence_penalty: v }));
              if (v && params.presence_penalty === undefined) setParams((p) => ({ ...p, presence_penalty: 0 }));
            }}
            onChange={(v) => setParams((p) => ({ ...p, presence_penalty: v }))}
            min={-2}
            max={2}
            step={0.1}
          />
          <SliderWithToggle
            label={t('agent.settings.model.maxTokens')}
            description={t('agent.settings.model.maxTokensDesc')}
            value={params.max_tokens}
            checked={enabledParams.max_tokens ?? false}
            onToggle={(v) => {
              setEnabledParams((e) => ({ ...e, max_tokens: v }));
              if (v && params.max_tokens === undefined) setParams((p) => ({ ...p, max_tokens: 4096 }));
            }}
            onChange={(v) => setParams((p) => ({ ...p, max_tokens: v }))}
            min={1}
            max={32000}
            step={100}
          />
        </Flexbox>
      ),
    },
  ], [
    avatar, bgColor, title, description, tags, token,
    openingMessage, openingQuestions, newQuestion, addQuestion, removeQuestion,
    chatConfig, params, enabledParams, t,
  ]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={800}
      title={
        <Flexbox horizontal align="center" gap={8}>
          <span style={{ fontSize: 20 }}>{avatar}</span>
          <span>{title || agent?.name || t('agent.settings.title')}</span>
        </Flexbox>
      }
      footer={
        <Flexbox horizontal justify="flex-end" gap={8}>
          <Button onClick={onClose}>{t('common.action.cancel', { ns: 'common' })}</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            {t('common.action.save', { ns: 'common' })}
          </Button>
        </Flexbox>
      }
      styles={{ body: { height: '60vh', overflow: 'auto' } }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        tabPosition="left"
        items={tabItems}
        style={{ height: '100%' }}
      />
    </Modal>
  );
}

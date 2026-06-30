import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Select, message, theme } from 'antd';
import { Button, Input, Tabs, TextArea } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { Bot, GripVertical, MessageSquare, Plus, User, X } from 'lucide-react';
import { api, type Agent } from '../services/desktop_api';

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

export function AgentSettingsModal({ open, agent, onClose, onSaved }: AgentSettingsModalProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('info');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bgColor, setBgColor] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [openingMessage, setOpeningMessage] = useState('');
  const [openingQuestions, setOpeningQuestions] = useState<string[]>([]);
  const [newQuestion, setNewQuestion] = useState('');

  useEffect(() => {
    if (!open || !agent) return;
    setActiveTab('info');
    setTitle(agent.title || '');
    setDescription(agent.description || '');
    setBgColor(agent.backgroundColor || '');
    setOpeningMessage(agent.openingMessage || '');
    try {
      setTags(JSON.parse(agent.tags || '[]'));
    } catch {
      setTags([]);
    }
    try {
      setOpeningQuestions(JSON.parse(agent.openingQuestions || '[]'));
    } catch {
      setOpeningQuestions([]);
    }
  }, [open, agent]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updated = await api.updateAgent(agent.id, {
        title,
        description,
        backgroundColor: bgColor,
        tags: JSON.stringify(tags),
        openingMessage,
        openingQuestions: JSON.stringify(openingQuestions),
      });
      message.success(t('agent.settings.saved'));
      onSaved(updated);
    } catch (err: unknown) {
      message.error(err instanceof Error ? err.message : t('agent.settings.failedToSave'));
    } finally {
      setSaving(false);
    }
  }, [agent.id, bgColor, description, openingMessage, openingQuestions, onSaved, tags, t, title]);

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
          <Flexbox gap={4}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.info.name')}</span>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('agent.settings.info.namePlaceholder')} />
          </Flexbox>

          <Flexbox gap={4}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.info.description')}</span>
            <Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('agent.settings.info.descriptionPlaceholder')} />
          </Flexbox>

          <Flexbox gap={6}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.info.bgColor')}</span>
            <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
              {COLOR_SWATCHES.map((color) => (
                <button
                  key={color || 'none'}
                  type="button"
                  onClick={() => setBgColor(color)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    background: color || `repeating-conic-gradient(${token.colorBorderSecondary} 0% 25%, transparent 0% 50%) 50% / 12px 12px`,
                    cursor: 'pointer',
                    border: bgColor === color ? `2px solid ${token.colorPrimary}` : '2px solid transparent',
                    transition: 'all 0.15s',
                  }}
                />
              ))}
            </Flexbox>
          </Flexbox>

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
          <Flexbox gap={4}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.opening.message')}</span>
            <span style={{ fontSize: 12, color: token.colorTextDescription }}>
              {t('agent.settings.opening.messageDesc')}
            </span>
            <TextArea
              value={openingMessage}
              onChange={(event) => setOpeningMessage(event.target.value)}
              rows={4}
              placeholder={t('agent.settings.opening.messagePlaceholder')}
            />
          </Flexbox>

          <Flexbox gap={4}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t('agent.settings.opening.questions')}</span>
            <span style={{ fontSize: 12, color: token.colorTextDescription }}>
              {t('agent.settings.opening.questionsDesc')}
            </span>
            <Flexbox gap={6}>
              {openingQuestions.map((q, i) => (
                <Flexbox
                  key={`${q}-${i}`}
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
                  onChange={(event) => setNewQuestion(event.target.value)}
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
  ], [addQuestion, bgColor, description, newQuestion, openingMessage, openingQuestions, removeQuestion, t, tags, title, token]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={720}
      title={(
        <Flexbox horizontal align="center" gap={8}>
          <span style={{ color: token.colorPrimary, display: 'flex' }}><Bot size={18} /></span>
          <span>{title || agent?.name || t('agent.settings.title')}</span>
        </Flexbox>
      )}
      footer={(
        <Flexbox horizontal justify="flex-end" gap={8}>
          <Button onClick={onClose}>{t('common.action.cancel', { ns: 'common' })}</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            {t('common.action.save', { ns: 'common' })}
          </Button>
        </Flexbox>
      )}
      styles={{ body: { height: '48vh', overflow: 'auto' } }}
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

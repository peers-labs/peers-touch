import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  Badge, Card, Drawer, Empty, Form, Modal, Progress, Select, Switch,
  Typography, theme, message, Popconfirm, Space, Divider,
  Descriptions, Statistic,
} from 'antd';
import { Button, Input, Tabs, Tag, Alert, Tooltip, TextArea, InputPassword } from '@lobehub/ui';
import {
  Plus, Trash2, Zap, Settings2, Send, RefreshCw, Play, Square,
  Webhook, MessageSquare, Bot, Hash, ArrowDownLeft, ArrowUpRight,
  BarChart3, AlertCircle, Timer, Inbox, QrCode, CheckCircle, Loader2,
} from 'lucide-react';
import { api, type Channel, type ChatTarget, type ChannelEvent, type ChannelEventStats } from '../services/desktop_api';
import { PageHeader } from '../components/PageHeader';
import { LarkSimulateLoginModal } from '../components/settings/LarkSimulateLoginModal';
import { useOAuth2Store } from '../store/oauth2';
import { EVENT, eventBus } from '../kernel/events';

const { Text } = Typography;

const TelegramIcon = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="#0088cc">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
  </svg>
);

const LarkIcon = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="7 7 26 26" width={size} height={size} fill="none">
    <path fill="#00d6b9" d="m21.069 20.504.063-.06.125-.122.085-.084.256-.254.348-.344.299-.296.281-.278.293-.289.269-.266.374-.37.218-.206.419-.359.404-.306.598-.386.617-.33.606-.265.348-.127.177-.058a14.8 14.8 0 0 0-2.793-5.603 1.34 1.34 0 0 0-1.047-.502H12.221a.201.201 0 0 0-.119.364 31.5 31.5 0 0 1 8.943 10.162l.025-.023z"/>
    <path fill="#3370ff" d="M16.791 30c5.57 0 10.423-3.074 12.955-7.618q.133-.239.258-.484a6 6 0 0 1-.425.699 6 6 0 0 1-.17.23 6 6 0 0 1-.225.274q-.092.105-.188.206a6 6 0 0 1-.407.384 6 6 0 0 1-.24.195 7 7 0 0 1-.292.21q-.094.065-.191.122c-.097.057-.134.081-.204.119q-.21.116-.428.215a6 6 0 0 1-.385.157 6 6 0 0 1-.43.138 6 6 0 0 1-.661.143 6 6 0 0 1-.491.055 6.125 6.125 0 0 1-1.543-.085 7 7 0 0 1-.38-.079l-.2-.051-.555-.155-.275-.081-.41-.125-.334-.107-.317-.104-.215-.073-.26-.091-.186-.066-.367-.134-.212-.081-.284-.11-.299-.119-.193-.079-.24-.1-.185-.078-.192-.084-.166-.073-.152-.067-.153-.07-.159-.073-.2-.093-.208-.099-.222-.108-.189-.093a31.2 31.2 0 0 1-8.822-6.583.202.202 0 0 0-.349.138l.005 9.52v.773c0 .448.222.87.595 1.118A14.75 14.75 0 0 0 16.791 30"/>
    <path fill="#133c9a" d="M33.151 16.582a8.45 8.45 0 0 0-3.744-.869 8.5 8.5 0 0 0-2.303.317l-.252.075-.177.058-.348.127-.606.265-.617.33-.598.386-.404.306-.419.359-.218.206-.374.37-.269.266-.293.289-.281.278-.299.296-.348.344-.256.254-.085.084-.125.122-.063.06-.095.09-.105.099a15 15 0 0 1-3.072 2.175l.2.093.159.073.153.07.152.067.166.073.192.084.185.078.24.1.193.079.299.119.284.11.212.081.367.134.186.066.26.09.215.073.317.104.334.107.41.125.275.081.555.155.2.051.379.079.433.062.585.037.525-.014.491-.055a6 6 0 0 0 .66-.143l.43-.138.385-.158.427-.215.204-.119.191-.122.292-.21.24-.195.407-.384.188-.206.225-.274.17-.23a6 6 0 0 0 .421-.693l.144-.288 1.305-2.599-.003.006a8.1 8.1 0 0 1 1.697-2.439z"/>
  </svg>
);

const DiscordIcon = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="#5865F2">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

const SlackIcon = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size}>
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#e01e5a"/>
    <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36c5f0"/>
    <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2eb67d"/>
    <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ecb22e"/>
  </svg>
);

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

interface ChannelTypeInfo {
  value: string;
  label: string;
  color: string;
  icon: React.ReactNode;
  desc: string;
  isBot: boolean;
  namePlaceholder: string;
  setupGuide: string;
  comingSoon?: boolean;
}

function getChannelTypes(t: TFunc): ChannelTypeInfo[] {
  return [
    {
      value: 'lark',
      label: t('channels.type.lark.label'),
      color: '#3370ff',
      icon: <LarkIcon />,
      desc: t('channels.type.lark.desc'),
      isBot: true,
      namePlaceholder: t('channels.type.lark.namePlaceholder'),
      setupGuide: t('channels.type.lark.setupGuide'),
    },
    {
      value: 'telegram',
      label: t('channels.type.telegram.label'),
      color: '#0088cc',
      icon: <TelegramIcon />,
      desc: t('channels.type.telegram.desc'),
      isBot: true,
      namePlaceholder: t('channels.type.telegram.namePlaceholder'),
      setupGuide: t('channels.type.telegram.setupGuide'),
      comingSoon: true,
    },
    {
      value: 'slack',
      label: t('channels.type.slack.label'),
      color: '#4a154b',
      icon: <SlackIcon />,
      desc: t('channels.type.slack.desc'),
      isBot: true,
      namePlaceholder: t('channels.type.slack.namePlaceholder'),
      setupGuide: t('channels.type.slack.setupGuide'),
      comingSoon: true,
    },
    {
      value: 'discord',
      label: t('channels.type.discord.label'),
      color: '#5865F2',
      icon: <DiscordIcon />,
      desc: t('channels.type.discord.desc'),
      isBot: true,
      namePlaceholder: t('channels.type.discord.namePlaceholder'),
      setupGuide: t('channels.type.discord.setupGuide'),
      comingSoon: true,
    },
    {
      value: 'webhook',
      label: t('channels.type.webhook.label'),
      color: '#6366f1',
      icon: <Webhook size={20} />,
      desc: t('channels.type.webhook.desc'),
      isBot: false,
      namePlaceholder: t('channels.type.webhook.namePlaceholder'),
      setupGuide: t('channels.type.webhook.setupGuide'),
      comingSoon: true,
    },
  ];
}

interface ConfigField {
  key: string;
  label: string;
  placeholder: string;
  type?: 'text' | 'password';
  required?: boolean;
  help?: string;
}

function getConfigFields(t: TFunc): Record<string, ConfigField[]> {
  return {
    telegram: [
      {
        key: 'botToken', label: t('channels.config.telegram.botToken.label'), placeholder: t('channels.config.telegram.botToken.placeholder'),
        type: 'password', required: true,
        help: t('channels.config.telegram.botToken.help'),
      },
      {
        key: 'chatId', label: t('channels.config.telegram.chatId.label'), placeholder: t('channels.config.telegram.chatId.placeholder'),
        help: t('channels.config.telegram.chatId.help'),
      },
    ],
    lark: [
      {
        key: 'appId', label: t('channels.config.lark.appId.label'), placeholder: t('channels.config.lark.appId.placeholder'),
        required: true,
        help: t('channels.config.lark.appId.help'),
      },
      {
        key: 'appSecret', label: t('channels.config.lark.appSecret.label'), placeholder: '',
        type: 'password', required: true,
        help: t('channels.config.lark.appSecret.help'),
      },
    ],
    slack: [
      {
        key: 'appToken', label: t('channels.config.slack.appToken.label'), placeholder: t('channels.config.slack.appToken.placeholder'),
        type: 'password', required: true,
        help: t('channels.config.slack.appToken.help'),
      },
      {
        key: 'botToken', label: t('channels.config.slack.botToken.label'), placeholder: t('channels.config.slack.botToken.placeholder'),
        type: 'password', required: true,
        help: t('channels.config.slack.botToken.help'),
      },
      {
        key: 'channelId', label: t('channels.config.slack.channelId.label'), placeholder: t('channels.config.slack.channelId.placeholder'),
        help: t('channels.config.slack.channelId.help'),
      },
    ],
    discord: [
      {
        key: 'botToken', label: t('channels.config.discord.botToken.label'), placeholder: t('channels.config.discord.botToken.placeholder'),
        type: 'password', required: true,
        help: t('channels.config.discord.botToken.help'),
      },
      {
        key: 'channelId', label: t('channels.config.discord.channelId.label'), placeholder: t('channels.config.discord.channelId.placeholder'),
        help: t('channels.config.discord.channelId.help'),
      },
    ],
    webhook: [
      { key: 'url', label: t('channels.config.webhook.url.label'), placeholder: t('channels.config.webhook.url.placeholder'), required: true },
      { key: 'method', label: t('channels.config.webhook.method.label'), placeholder: t('channels.config.webhook.method.placeholder') },
      {
        key: 'secret', label: t('channels.config.webhook.secret.label'), placeholder: t('channels.config.webhook.secret.placeholder'), type: 'password',
        help: t('channels.config.webhook.secret.help'),
      },
    ],
  };
}

function parseConfig(ch: Channel): Record<string, string> {
  try { return JSON.parse(ch.config); } catch { return {}; }
}

const CREATE_BOT_STEPS_COUNT = 4;

function CreateBotProgressModal({
  open,
  step,
  error,
  onClose,
}: {
  open: boolean;
  step: number;
  error: string | null;
  onClose: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('channels');
  const steps = [t('channels.progress.step1'), t('channels.progress.step2'), t('channels.progress.step3'), t('channels.progress.step4')];
  const completed = step >= steps.length && !error;
  const percent = Math.min(100, ((step + 1) / steps.length) * 100);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={error ? <Button onClick={onClose}>{t('channels.progress.close')}</Button> : null}
      closable={!!error}
      maskClosable={!!error}
      width={400}
      centered
      destroyOnHidden
      title={t('channels.progress.title')}
    >
      <Flexbox direction="vertical" gap={20} style={{ padding: '8px 0' }}>
        <Progress
          percent={completed ? 100 : percent}
          status={error ? 'exception' : completed ? 'success' : 'active'}
          strokeColor={error ? token.colorError : undefined}
        />
        {error ? (
          <Alert type="error" showIcon message={error} />
        ) : completed ? (
          <Flexbox horizontal align="center" gap={12} style={{ color: token.colorSuccess }}>
            <CheckCircle size={24} />
            <Text strong>{t('channels.progress.success')}</Text>
          </Flexbox>
        ) : (
          <Flexbox horizontal align="center" gap={12}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <Text type="secondary">{steps[Math.min(step, steps.length - 1)]}</Text>
          </Flexbox>
        )}
      </Flexbox>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </Modal>
  );
}

export function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [form] = Form.useForm();
  const [channelType, setChannelType] = useState<string>('lark');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [sendDrawer, setSendDrawer] = useState<Channel | null>(null);
  const [sendText, setSendText] = useState('');
  const [sending, setSending] = useState(false);
  const [togglingBot, setTogglingBot] = useState<string | null>(null);
  const [detailChannel, setDetailChannel] = useState<Channel | null>(null);
  const [larkQRModalOpen, setLarkQRModalOpen] = useState(false);
  const [creatingBot, setCreatingBot] = useState(false);
  const [larkSetupTab, setLarkSetupTab] = useState<'scan' | 'bind'>('scan');
  const [createBotProgressOpen, setCreateBotProgressOpen] = useState(false);
  const [createBotProgressStep, setCreateBotProgressStep] = useState(0);
  const [createBotProgressError, setCreateBotProgressError] = useState<string | null>(null);
  const connections = useOAuth2Store((s) => s.connections);
  const loadOAuth2 = useOAuth2Store((s) => s.loadAll);
  const hasLarkSimulate = connections.some((c) => c.provider_id === 'lark_simulate');
  const { t } = useTranslation('channels');

  const channelTypes = getChannelTypes(t);
  const configFields = getConfigFields(t);

  const getTypeInfo = (type: string): ChannelTypeInfo =>
    channelTypes.find((ct) => ct.value === type) || channelTypes[0];

  useEffect(() => {
    loadOAuth2();
  }, [loadOAuth2]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChannels(await api.listChannels());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = () => {
    setEditing(null);
    setChannelType('lark');
    setLarkSetupTab('scan');
    form.resetFields();
    form.setFieldsValue({ type: 'lark', enabled: true });
    setDrawerOpen(true);
  };

  const handleEdit = (ch: Channel) => {
    setEditing(ch);
    setChannelType(ch.type);
    setLarkSetupTab('bind');
    let configObj: Record<string, unknown> = {};
    try { configObj = JSON.parse(ch.config); } catch { /* empty */ }
    form.setFieldsValue({ name: ch.name, type: ch.type, enabled: ch.enabled, ...configObj });
    setDrawerOpen(true);
  };

  const handleTypeChange = (v: string) => {
    setChannelType(v);
    form.setFieldsValue({ name: form.getFieldValue('name') || '' });
    // Clear config fields from previous type
    const allKeys = Object.values(configFields).flatMap(fields => fields.map(f => f.key));
    const resetObj: Record<string, undefined> = {};
    allKeys.forEach(k => { resetObj[k] = undefined; });
    form.setFieldsValue(resetObj);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const { name, type: chType, enabled, ...configValues } = values;
      const cleanConfig: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(configValues)) {
        if (v !== undefined && v !== '') cleanConfig[k] = v;
      }
      const data = { name, type: chType, config: JSON.stringify(cleanConfig), enabled };
      if (editing) {
        await api.updateChannel(editing.id, data);
        message.success(t('channels.toast.channelUpdated'));
      } else {
        await api.createChannel(data);
        message.success(t('channels.toast.channelCreated'));
      }
      setDrawerOpen(false);
      load();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'message' in err) {
        message.error(String((err as { message: string }).message));
      }
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      await api.testChannel(id);
      message.success(t('channels.toast.testPassed'));
    } catch (err: unknown) {
      message.error(t('channels.toast.testFailed', { error: err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : 'error' }));
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleBot = async (ch: Channel) => {
    setTogglingBot(ch.id);
    try {
      if (ch.botStatus?.connected) {
        await api.stopBot(ch.id);
        message.success(t('channels.toast.botStopped'));
      } else {
        await api.startBot(ch.id);
        message.success(t('channels.toast.botStarted'));
      }
      setTimeout(load, 500);
    } catch (err: unknown) {
      message.error(t('channels.toast.botActionFailed', { error: err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : 'error' }));
    } finally {
      setTogglingBot(null);
    }
  };

  const handleSend = async () => {
    if (!sendDrawer || !sendText.trim()) return;
    setSending(true);
    try {
      await api.sendChannelMessage(sendDrawer.id, sendText.trim());
      message.success(t('channels.toast.messageSent'));
      setSendText('');
    } catch (err: unknown) {
      message.error(t('channels.toast.sendFailed', { error: err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : 'error' }));
    } finally {
      setSending(false);
    }
  };

  return (
    <Flexbox gap={0} style={{ height: '100%', overflow: 'hidden' }}>
      <PageHeader
        title={t('channels.title')}
        subtitle={t('channels.subtitle')}
        actions={<>
          <Button icon={<RefreshCw size={14} />} onClick={load} loading={loading}>{t('channels.action.refresh')}</Button>
          <Button type="primary" icon={<Plus size={14} />} onClick={handleCreate}>{t('channels.action.addChannel')}</Button>
        </>}
      />

      {/* Channel List */}
      <Flexbox flex={1} style={{ overflow: 'auto', padding: 24 }} gap={16}>
        {channels.length === 0 && !loading ? (
          <Empty description={t('channels.empty.title')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
            <Flexbox gap={12} align="center">
              <Text type="secondary" style={{ maxWidth: 400, textAlign: 'center' }}>
                {t('channels.empty.description')}
              </Text>
              <Button type="primary" onClick={handleCreate}>{t('channels.action.addFirstChannel')}</Button>
            </Flexbox>
          </Empty>
        ) : (
          <>
            {channelTypes.map((typeInfo) => {
              const typed = channels.filter((ch) => ch.type === typeInfo.value);
              if (typed.length === 0) return null;
              return (
                <div key={typeInfo.value}>
                  <Flexbox horizontal align="center" gap={8} style={{ marginBottom: 8 }}>
                    {typeInfo.icon}
                    <Text strong style={{ fontSize: 14 }}>{typeInfo.label}</Text>
                    <Tag>{typed.length}</Tag>
                  </Flexbox>
                  <Flexbox gap={8} style={{ marginBottom: 8 }}>
                    {typed.map((ch) => {
                      const info = getTypeInfo(ch.type);
                      const isBot = info.isBot;
                      const botConnected = ch.botStatus?.connected;
                      const cfg = parseConfig(ch);

                      return (
                        <Card
                          key={ch.id}
                          size="small"
                          hoverable
                          onClick={() => setDetailChannel(ch)}
                          style={{ opacity: ch.enabled ? 1 : 0.5, cursor: 'pointer' }}
                        >
                          <Flexbox horizontal align="center" justify="space-between">
                            <Flexbox horizontal align="center" gap={12}>
                              <div style={{ display: 'flex', alignItems: 'center' }}>
                                {isBot ? (
                                  <Badge status={botConnected ? 'success' : 'default'} offset={[-2, 18]} dot>
                                    {info.icon}
                                  </Badge>
                                ) : info.icon}
                              </div>
                              <Flexbox>
                                <Flexbox horizontal align="center" gap={8}>
                                  <Text strong>{ch.name}</Text>
                                  {!ch.enabled && <Tag color="default">{t('channels.card.disabled')}</Tag>}
                                  {isBot && botConnected && (
                                    <Tag color="success" style={{ margin: 0 }}>
                                      {ch.botStatus?.botName ? t('channels.card.connectedWithName', { botName: ch.botStatus.botName }) : t('channels.card.connected')}
                                    </Tag>
                                  )}
                                  {isBot && !botConnected && ch.enabled && (
                                    <Tag color={ch.type === 'lark' ? 'error' : 'warning'} style={{ margin: 0 }}>
                                      {ch.type === 'lark' ? t('channels.card.incomplete') : t('channels.card.disconnected')}
                                    </Tag>
                                  )}
                                </Flexbox>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  {ch.id} · {new Date(ch.createdAt).toLocaleDateString()}
                                  {isBot && cfg.botToken && ` · ${t('channels.card.tokenPrefix', { token: cfg.botToken.slice(0, 8) })}`}
                                  {isBot && cfg.appId && ` · ${t('channels.card.appPrefix', { appId: cfg.appId })}`}
                                  {ch.botStatus?.error && (
                                    <Text type="danger" style={{ fontSize: 12, marginLeft: 8 }}>
                                      {t('channels.card.errorPrefix', { error: ch.botStatus.error })}
                                    </Text>
                                  )}
                                </Text>
                              </Flexbox>
                            </Flexbox>
                            <Space onClick={(e) => e.stopPropagation()}>
                              {isBot && ch.enabled && (
                                <Tooltip title={botConnected ? t('channels.tooltip.stopBot') : t('channels.tooltip.startBot')}>
                                  <Button
                                    size="small"
                                    type={botConnected ? 'default' : 'primary'}
                                    icon={botConnected ? <Square size={14} /> : <Play size={14} />}
                                    loading={togglingBot === ch.id}
                                    onClick={() => handleToggleBot(ch)}
                                  />
                                </Tooltip>
                              )}
                              <Switch size="small" checked={ch.enabled}
                                onChange={async (v) => {
                                  await api.updateChannel(ch.id, { enabled: v });
                                  load();
                                }}
                              />
                              <Tooltip title={t('channels.tooltip.testConnection')}>
                                <Button size="small" icon={<Zap size={14} />}
                                  loading={testingId === ch.id}
                                  onClick={() => handleTest(ch.id)}
                                />
                              </Tooltip>
                              <Tooltip title={t('channels.tooltip.edit')}>
                                <Button size="small" icon={<Settings2 size={14} />}
                                  onClick={() => handleEdit(ch)}
                                />
                              </Tooltip>
                              <Popconfirm title={t('channels.confirm.deleteChannel')} onConfirm={async () => { await api.deleteChannel(ch.id); load(); }}>
                                <Button size="small" danger icon={<Trash2 size={14} />} />
                              </Popconfirm>
                            </Space>
                          </Flexbox>
                        </Card>
                      );
                    })}
                  </Flexbox>
                </div>
              );
            })}
          </>
        )}
      </Flexbox>

      {/* Create / Edit Drawer */}
      <Drawer
        title={editing ? t('channels.drawer.titleEdit') : t('channels.drawer.titleAdd')}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size="default"
        extra={
          editing ? (
            <Button type="primary" onClick={handleSave}>{t('channels.drawer.save')}</Button>
          ) : channelType === 'lark' && larkSetupTab === 'scan' ? null : (
            <Button type="primary" onClick={handleSave}>{t('channels.drawer.create')}</Button>
          )
        }
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'lark', enabled: true }}>
          <Form.Item name="name" label={t('channels.form.name')} rules={[{ required: true }]}>
            <Input placeholder={getTypeInfo(channelType).namePlaceholder} />
          </Form.Item>

          <Form.Item name="type" label={t('channels.form.type')} rules={[{ required: true }]}>
            <Select onChange={handleTypeChange}>
              {channelTypes.map((ct) => (
                <Select.Option key={ct.value} value={ct.value} disabled={!!ct.comingSoon}>
                  <Tooltip title={ct.comingSoon ? t('channels.type.comingSoon') : undefined}>
                    <Flexbox horizontal align="center" gap={8}>
                      {ct.icon} <span>{ct.label}</span>
                    </Flexbox>
                  </Tooltip>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="enabled" label={t('channels.form.enabled')} valuePropName="checked">
            <Switch />
          </Form.Item>

          <Divider style={{ margin: '12px 0' }} />

          {channelType === 'lark' && !editing ? (
            <Tabs
              activeKey={larkSetupTab}
              onChange={(k) => setLarkSetupTab(k as 'scan' | 'bind')}
              items={[
                {
                  key: 'scan',
                  label: t('channels.larkSetup.tabScan'),
                  children: (
                    <div style={{ paddingTop: 8 }}>
                      {hasLarkSimulate && (
                        <Card size="small" style={{ marginBottom: 16, background: 'rgba(82,196,26,0.06)', borderColor: 'rgba(82,196,26,0.3)' }}>
                          <Flexbox horizontal align="center" justify="space-between" gap={12}>
                            <Flexbox horizontal align="center" gap={8}>
                              <Badge status="success" />
                              <Text strong>{t('channels.larkSetup.loggedIn')}</Text>
                            </Flexbox>
                            <Button
                              type="link"
                              size="small"
                              style={{ padding: 0 }}
                              onClick={() => eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'settings', id: 'account' })}
                            >
                              {t('channels.larkSetup.loginInfo')}
                            </Button>
                          </Flexbox>
                        </Card>
                      )}
                      <Button
                        icon={<QrCode size={14} />}
                        loading={creatingBot}
                        disabled={creatingBot}
                        onClick={async () => {
                          if (creatingBot) return;
                          if (hasLarkSimulate) {
                            setCreatingBot(true);
                            setCreateBotProgressError(null);
                            setCreateBotProgressStep(0);
                            setCreateBotProgressOpen(true);
                            const stepInterval = setInterval(() => {
                              setCreateBotProgressStep((s) => Math.min(s + 1, CREATE_BOT_STEPS_COUNT - 1));
                            }, 3000);
                            try {
                              const res = await api.oauthSimulateLarkCreateBotSession(form.getFieldValue('name') || t('channels.type.lark.namePlaceholder'));
                              clearInterval(stepInterval);
                              setCreateBotProgressStep(CREATE_BOT_STEPS_COUNT);
                              if (res.status === 'success' && res.bot) {
                                load();
                                if (res.channel_id) {
                                  api.getChannel(res.channel_id).then(setDetailChannel);
                                }
                                setTimeout(() => {
                                  setCreateBotProgressOpen(false);
                                  setDrawerOpen(false);
                                  message.success(t('channels.toast.botCreated'));
                                }, 600);
                              }
                            } catch (err: any) {
                              clearInterval(stepInterval);
                              const msg = err?.message || '';
                              setCreateBotProgressError(
                                msg.includes('no stored') || msg.includes('stored session')
                                  ? t('channels.progress.noSessionError')
                                  : msg || t('channels.progress.defaultError'),
                              );
                            } finally {
                              setCreatingBot(false);
                            }
                          } else {
                            setLarkQRModalOpen(true);
                          }
                        }}
                        block
                        type="primary"
                        size="large"
                      >
                        {hasLarkSimulate ? t('channels.larkSetup.createBotNoQR') : t('channels.larkSetup.createViaQR')}
                      </Button>
                      {hasLarkSimulate && (
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, marginTop: 8, display: 'block' }}
                          onClick={() => setLarkQRModalOpen(true)}
                        >
                          {t('channels.larkSetup.orCreateViaQR')}
                        </Button>
                      )}
                      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12, lineHeight: 1.5 }}>
                        {hasLarkSimulate
                          ? t('channels.larkSetup.hintWithSession')
                          : t('channels.larkSetup.hintWithoutSession')}
                      </Text>
                    </div>
                  ),
                },
                {
                  key: 'bind',
                  label: t('channels.larkSetup.tabBind'),
                  children: (
                    <div style={{ paddingTop: 8 }}>
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message={t('channels.form.alertBotConnection')}
                        description={getTypeInfo('lark').desc}
                      />
                      {(configFields.lark || []).map((field) => (
                        <Form.Item
                          key={field.key}
                          name={field.key}
                          label={field.label}
                          rules={field.required ? [{ required: true }] : undefined}
                          extra={field.help ? <Text type="secondary" style={{ fontSize: 12 }}>{field.help}</Text> : undefined}
                        >
                          {field.type === 'password' ? (
                            <InputPassword placeholder={field.placeholder} />
                          ) : (
                            <Input placeholder={field.placeholder} />
                          )}
                        </Form.Item>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          ) : (
            <>
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message={getTypeInfo(channelType).isBot ? t('channels.form.alertBotConnection') : t('channels.form.alertOutboundWebhook')}
                description={getTypeInfo(channelType).desc}
              />
              {(configFields[channelType] || []).map((field) => (
                <Form.Item
                  key={field.key}
                  name={field.key}
                  label={field.label}
                  rules={field.required ? [{ required: true }] : undefined}
                  extra={field.help ? <Text type="secondary" style={{ fontSize: 12 }}>{field.help}</Text> : undefined}
                >
                  {field.type === 'password' ? (
                    <InputPassword placeholder={field.placeholder} />
                  ) : (
                    <Input placeholder={field.placeholder} />
                  )}
                </Form.Item>
              ))}
            </>
          )}

          <Divider style={{ margin: '12px 0' }} />
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
            <strong>{t('channels.form.setupGuide')}</strong>{'\n'}{getTypeInfo(channelType).setupGuide}
          </Text>
        </Form>
      </Drawer>

      {/* Channel Detail Drawer */}
      <Drawer
        title={detailChannel ? (
          <Flexbox horizontal align="center" gap={8}>
            {getTypeInfo(detailChannel.type).icon}
            <span>{detailChannel.name}</span>
          </Flexbox>
        ) : t('channels.detail.title')}
        open={!!detailChannel}
        onClose={() => setDetailChannel(null)}
        size="large"
        extra={detailChannel && (
          <Space>
            <Button icon={<Settings2 size={14} />} onClick={() => {
              if (detailChannel) { handleEdit(detailChannel); setDetailChannel(null); }
            }}>{t('channels.detail.editButton')}</Button>
          </Space>
        )}
      >
        {detailChannel && <ChannelDetailPanel
          channel={detailChannel}
          onToggleBot={handleToggleBot}
          onTest={handleTest}
          togglingBot={togglingBot}
          testingId={testingId}
          onRefresh={async () => {
            const updated = await api.getChannel(detailChannel.id);
            setDetailChannel(updated);
            load();
          }}
          onDelete={async () => {
            await api.deleteChannel(detailChannel.id);
            setDetailChannel(null);
            load();
          }}
        />}
      </Drawer>

      <LarkSimulateLoginModal
        open={larkQRModalOpen}
        onClose={() => setLarkQRModalOpen(false)}
        intent="bot"
        appName={form.getFieldValue('name') || t('channels.type.lark.namePlaceholder')}
        onSuccess={(result) => {
          if (result.bot) {
            setLarkQRModalOpen(false);
            load(); // Channel already persisted by backend
            if (result.channel_id) {
              api.getChannel(result.channel_id).then(setDetailChannel);
            }
          }
        }}
      />

      <CreateBotProgressModal
        open={createBotProgressOpen}
        step={createBotProgressStep}
        error={createBotProgressError}
        onClose={() => {
          if (!creatingBot) {
            const hadError = createBotProgressError;
            setCreateBotProgressOpen(false);
            setCreateBotProgressError(null);
            if (hadError) setLarkQRModalOpen(true);
          }
        }}
      />

      {/* Send Message Drawer (webhook only) */}
      <Drawer
        title={t('channels.sendDrawer.title', { name: sendDrawer?.name || '' })}
        open={!!sendDrawer}
        onClose={() => setSendDrawer(null)}
        size="default"
      >
        <Flexbox gap={12}>
          <TextArea
            rows={6}
            value={sendText}
            onChange={(e) => setSendText(e.target.value)}
            placeholder={t('channels.sendDrawer.placeholder')}
          />
          <Button
            type="primary"
            icon={<Send size={14} />}
            loading={sending}
            onClick={handleSend}
            disabled={!sendText.trim()}
          >
            {t('channels.sendDrawer.sendButton')}
          </Button>
        </Flexbox>
      </Drawer>
    </Flexbox>
  );
}

/* ─── Channel Detail Panel ─── */

function ChannelDetailPanel({
  channel: ch,
  onToggleBot,
  onTest,
  togglingBot,
  testingId,
  onRefresh,
  onDelete,
}: {
  channel: Channel;
  onToggleBot: (ch: Channel) => void;
  onTest: (id: string) => void;
  togglingBot: string | null;
  testingId: string | null;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('channels');
  const channelTypes = getChannelTypes(t);
  const getTypeInfo = (type: string): ChannelTypeInfo =>
    channelTypes.find((ct) => ct.value === type) || channelTypes[0];
  const info = getTypeInfo(ch.type);
  const botConnected = ch.botStatus?.connected;
  const cfg = parseConfig(ch);

  return (
    <Flexbox gap={0} style={{ height: '100%' }}>
      {/* Bot Status Bar */}
      {info.isBot && (
        <Card size="small" style={{ marginBottom: 12 }}>
          <Flexbox horizontal align="center" justify="space-between">
            <Flexbox horizontal align="center" gap={8}>
              <Badge status={botConnected ? 'success' : 'default'} />
              <Text strong>{botConnected ? t('channels.detail.botStatus.connected') : ch.type === 'lark' ? t('channels.detail.botStatus.incomplete') : t('channels.detail.botStatus.disconnected')}</Text>
              {ch.botStatus?.botName && <Text type="secondary">@{ch.botStatus.botName}</Text>}
            </Flexbox>
            <Space>
              <Button
                size="small"
                type={botConnected ? 'default' : 'primary'}
                icon={botConnected ? <Square size={14} /> : <Play size={14} />}
                loading={togglingBot === ch.id}
                onClick={() => onToggleBot(ch)}
              >
                {botConnected ? t('channels.detail.botAction.stop') : ch.type === 'lark' ? t('channels.detail.botAction.continueSetup') : t('channels.detail.botAction.start')}
              </Button>
              <Button size="small" icon={<Zap size={14} />} loading={testingId === ch.id}
                onClick={() => onTest(ch.id)}>{t('channels.detail.botAction.test')}</Button>
            </Space>
          </Flexbox>
          {ch.botStatus?.error && (
            <Alert type="error" message={ch.botStatus.error} style={{ marginTop: 8 }} showIcon />
          )}
        </Card>
      )}

      {/* Tabs: Info | Messages | Stats */}
      <Tabs
        defaultActiveKey="messages"
        size="small"
        style={{ flex: 1 }}
        items={[
          {
            key: 'messages',
            label: <Flexbox horizontal align="center" gap={4}><MessageSquare size={13} /> {t('channels.detail.tab.messages')}</Flexbox>,
            children: <MessageLogPanel channelId={ch.id} />,
          },
          {
            key: 'stats',
            label: <Flexbox horizontal align="center" gap={4}><BarChart3 size={13} /> {t('channels.detail.tab.stats')}</Flexbox>,
            children: <ChannelStatsPanel channelId={ch.id} />,
          },
          {
            key: 'info',
            label: <Flexbox horizontal align="center" gap={4}><Hash size={13} /> {t('channels.detail.tab.info')}</Flexbox>,
            children: (
              <Flexbox gap={12} style={{ paddingTop: 8 }}>
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label={t('channels.detail.info.id')}>{ch.id}</Descriptions.Item>
                  <Descriptions.Item label={t('channels.detail.info.type')}>
                    <Tag color={info.color}>{info.label}</Tag>
                    {info.isBot ? <Tag>{t('channels.type.bidirectional')}</Tag> : <Tag>{t('channels.type.outboundOnly')}</Tag>}
                  </Descriptions.Item>
                  <Descriptions.Item label={t('channels.detail.info.enabled')}>
                    <Switch size="small" checked={ch.enabled}
                      onChange={async (v) => {
                        await api.updateChannel(ch.id, { enabled: v });
                        onRefresh();
                      }} />
                  </Descriptions.Item>
                  <Descriptions.Item label={t('channels.detail.info.created')}>{new Date(ch.createdAt).toLocaleString()}</Descriptions.Item>
                  <Descriptions.Item label={t('channels.detail.info.updated')}>{new Date(ch.updatedAt).toLocaleString()}</Descriptions.Item>
                </Descriptions>
                <Card size="small" title={t('channels.detail.info.configuration')}>
                  {Object.entries(cfg).map(([key, val]) => {
                    const isSecret = key.toLowerCase().includes('secret') || key.toLowerCase().includes('token');
                    return (
                      <Flexbox key={key} horizontal justify="space-between" style={{ marginBottom: 4 }}>
                        <Text type="secondary">{key}</Text>
                        <Text code>{isSecret && typeof val === 'string' ? val.slice(0, 8) + '...' : String(val)}</Text>
                      </Flexbox>
                    );
                  })}
                </Card>
                {info.isBot && <SendTestCard channelId={ch.id} connected={!!botConnected} />}
                <Popconfirm title={t('channels.confirm.deleteChannel')} onConfirm={onDelete}>
                  <Button danger icon={<Trash2 size={14} />} block>{t('channels.detail.info.deleteChannel')}</Button>
                </Popconfirm>
              </Flexbox>
            ),
          },
        ]}
      />
    </Flexbox>
  );
}

/* ─── Message Log Panel ─── */

function MessageLogPanel({ channelId }: { channelId: string }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('channels');
  const [events, setEvents] = useState<ChannelEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const limit = 30;

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await api.listChannelEvents(channelId, limit, p * limit);
      setEvents(res.events || []);
      setTotal(res.total);
      setPage(p);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => { load(0); }, [load]);

  if (!loading && events.length === 0) {
    return (
      <Flexbox align="center" justify="center" gap={8} style={{ padding: '40px 0' }}>
        <Inbox size={32} style={{ color: token.colorTextQuaternary }} />
        <Text type="secondary">{t('channels.messages.empty.title')}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('channels.messages.empty.description')}
        </Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={0} style={{ paddingTop: 4 }}>
      {/* Summary */}
      <Flexbox horizontal justify="space-between" align="center" style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{t('channels.messages.total', { count: total })}</Text>
        <Button size="small" icon={<RefreshCw size={12} />} onClick={() => load(page)} loading={loading}>
          {t('channels.messages.refresh')}
        </Button>
      </Flexbox>

      {/* Timeline */}
      <Flexbox gap={2}>
        {events.map((ev) => {
          const isInbound = ev.direction === 'inbound';
          const isFailed = ev.phase === 'failed';
          const time = new Date(ev.timestamp);
          const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });
          const text = ev.msgText || '';
          const isTruncated = text.length > 200;
          const isExpanded = expandedIds.has(ev.id);
          const displayText = isTruncated && !isExpanded ? text.slice(0, 200) : text;

          return (
            <Flexbox
              key={ev.id}
              horizontal
              gap={10}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: isFailed ? token.colorErrorBg : isInbound ? token.colorInfoBg : token.colorFillQuaternary,
                border: `1px solid ${isFailed ? token.colorErrorBorder : 'transparent'}`,
                fontSize: 13,
              }}
            >
              {/* Direction icon */}
              <div style={{
                flexShrink: 0,
                width: 24,
                height: 24,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isInbound ? token.colorPrimaryBg : isFailed ? token.colorErrorBg : token.colorSuccessBg,
              }}>
                {isFailed ? (
                  <AlertCircle size={14} style={{ color: token.colorError }} />
                ) : isInbound ? (
                  <ArrowDownLeft size={14} style={{ color: token.colorPrimary }} />
                ) : (
                  <ArrowUpRight size={14} style={{ color: token.colorSuccess }} />
                )}
              </div>

              {/* Content */}
              <Flexbox flex={1} gap={2}>
                <Flexbox horizontal align="center" gap={6}>
                  <Tag
                    color={isInbound ? 'blue' : isFailed ? 'red' : 'green'}
                    style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px', margin: 0 }}
                  >
                    {isInbound ? t('channels.messages.directionIn') : t('channels.messages.directionOut')}
                  </Tag>
                  {ev.senderName && (
                    <Text strong style={{ fontSize: 12 }}>{ev.senderName}</Text>
                  )}
                  {ev.senderId && !ev.senderName && (
                    <Text type="secondary" style={{ fontSize: 11 }}>{ev.senderId}</Text>
                  )}
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                    {dateStr} {timeStr}
                  </Text>
                </Flexbox>
                <Text className="selectable" style={{ fontSize: 13, lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {displayText}
                  {isTruncated && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedIds(prev => {
                          const next = new Set(prev);
                          if (next.has(ev.id)) next.delete(ev.id);
                          else next.add(ev.id);
                          return next;
                        });
                      }}
                      style={{
                        color: token.colorPrimary,
                        cursor: 'pointer',
                        marginLeft: 4,
                        fontSize: 12,
                      }}
                    >
                      {isExpanded ? t('channels.messages.collapse') : t('channels.messages.expand')}
                    </span>
                  )}
                </Text>
                <Flexbox horizontal gap={8} style={{ marginTop: 2 }}>
                  {ev.latencyMs != null && ev.latencyMs > 0 && (
                    <Flexbox horizontal align="center" gap={3}>
                      <Timer size={11} style={{ color: token.colorTextTertiary }} />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {ev.latencyMs < 1000 ? `${ev.latencyMs}ms` : `${(ev.latencyMs / 1000).toFixed(1)}s`}
                      </Text>
                    </Flexbox>
                  )}
                  {ev.sessionId && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {t('channels.messages.sessionPrefix', { sessionId: ev.sessionId.slice(0, 20) })}
                    </Text>
                  )}
                  {ev.error && (
                    <Text type="danger" style={{ fontSize: 11 }}>{ev.error}</Text>
                  )}
                </Flexbox>
              </Flexbox>
            </Flexbox>
          );
        })}
      </Flexbox>

      {/* Pagination */}
      {total > limit && (
        <Flexbox horizontal justify="center" gap={8} style={{ marginTop: 12 }}>
          <Button size="small" disabled={page === 0} onClick={() => load(page - 1)}>{t('channels.messages.pagination.previous')}</Button>
          <Text type="secondary" style={{ fontSize: 12, lineHeight: '24px' }}>
            {t('channels.messages.pagination.pageInfo', { current: page + 1, total: Math.ceil(total / limit) })}
          </Text>
          <Button size="small" disabled={(page + 1) * limit >= total} onClick={() => load(page + 1)}>{t('channels.messages.pagination.next')}</Button>
        </Flexbox>
      )}
    </Flexbox>
  );
}

/* ─── Channel Stats Panel ─── */

function ChannelStatsPanel({ channelId }: { channelId: string }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('channels');
  const [stats, setStats] = useState<ChannelEventStats | null>(null);

  useEffect(() => {
    api.getChannelStats(channelId).then(setStats).catch(() => {});
  }, [channelId]);

  if (!stats) {
    return <Text type="secondary" style={{ padding: 20 }}>{t('channels.stats.loading')}</Text>;
  }

  const totalMessages = stats.totalInbound + stats.totalOutbound;

  return (
    <Flexbox gap={16} style={{ paddingTop: 8 }}>
      {/* Today */}
      <Card size="small" title={t('channels.stats.today')}>
        <Flexbox horizontal gap={16}>
          <Statistic
            title={<Flexbox horizontal align="center" gap={4}><ArrowDownLeft size={12} /> {t('channels.stats.received')}</Flexbox>}
            value={stats.todayInbound}
            valueStyle={{ fontSize: 24, color: token.colorPrimary }}
          />
          <Statistic
            title={<Flexbox horizontal align="center" gap={4}><ArrowUpRight size={12} /> {t('channels.stats.sent')}</Flexbox>}
            value={stats.todayOutbound}
            valueStyle={{ fontSize: 24, color: token.colorSuccess }}
          />
        </Flexbox>
      </Card>

      {/* All time */}
      <Card size="small" title={t('channels.stats.allTime')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          <Statistic title={t('channels.stats.totalMessages')} value={totalMessages} />
          <Statistic title={t('channels.stats.avgResponse')} value={stats.avgLatencyMs < 1000 ? `${stats.avgLatencyMs}ms` : `${(stats.avgLatencyMs / 1000).toFixed(1)}s`} />
          <Statistic title={t('channels.stats.inbound')} value={stats.totalInbound} valueStyle={{ color: token.colorPrimary }} />
          <Statistic title={t('channels.stats.outbound')} value={stats.totalOutbound} valueStyle={{ color: token.colorSuccess }} />
          <Statistic title={t('channels.stats.errors')} value={stats.totalErrors} valueStyle={{ color: stats.totalErrors > 0 ? token.colorError : undefined }} />
          {totalMessages > 0 && (
            <Statistic
              title={t('channels.stats.successRate')}
              value={`${(((totalMessages - stats.totalErrors) / totalMessages) * 100).toFixed(1)}%`}
              valueStyle={{ color: token.colorSuccess }}
            />
          )}
        </div>
      </Card>
    </Flexbox>
  );
}

function SendTestCard({ channelId, connected }: { channelId: string; connected: boolean }) {
  const { t } = useTranslation('channels');
  const [mode, setMode] = useState<'self' | 'group'>('self');
  const [chats, setChats] = useState<ChatTarget[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [testText, setTestText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!testText.trim()) return;
    setSending(true);
    try {
      if (mode === 'self') {
        const p2pUsers = chats.filter((c) => c.type === 'p2p');
        if (p2pUsers.length === 0) {
          message.warning(t('channels.sendTest.noDMContacts'));
          setSending(false);
          return;
        }
        await api.sendChannelMessage(channelId, testText.trim(), undefined, p2pUsers[0].id, 'p2p');
      } else {
        if (!selectedChat) {
          message.warning(t('channels.sendTest.selectGroupChat'));
          setSending(false);
          return;
        }
        await api.sendChannelMessage(channelId, testText.trim(), undefined, selectedChat, 'group');
      }
      message.success(t('channels.toast.testMessageSent'));
    } catch (err: unknown) {
      message.error(t('channels.toast.sendFailed', { error: err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : 'error' }));
    } finally {
      setSending(false);
    }
  };

  const groups = chats.filter((c) => c.type === 'group');
  const hasP2p = chats.some((c) => c.type === 'p2p');

  useEffect(() => {
    if (connected && chats.length === 0) {
      setLoadingChats(true);
      api.listChannelChats(channelId)
        .then((res) => {
          const list = res.chats || [];
          setChats(list);
          const firstGroup = list.find((c) => c.type === 'group');
          if (firstGroup) setSelectedChat(firstGroup.id);
        })
        .catch(() => {})
        .finally(() => setLoadingChats(false));
    }
  }, [connected, channelId, chats.length]);

  if (!connected) {
    return (
      <Card size="small" title={<Flexbox horizontal align="center" gap={6}><Send size={14} /> {t('channels.sendTest.title')}</Flexbox>}>
        <Text type="secondary">{t('channels.sendTest.startBotFirst')}</Text>
      </Card>
    );
  }

  return (
    <Card size="small" title={<Flexbox horizontal align="center" gap={6}><Send size={14} /> {t('channels.sendTest.title')}</Flexbox>}>
      <Flexbox gap={12}>
        <Select value={mode} onChange={(v) => setMode(v)} style={{ width: '100%' }}>
          <Select.Option value="self">
            <Flexbox horizontal align="center" gap={6}>
              <MessageSquare size={14} />
              {t('channels.sendTest.modeSelf')}
            </Flexbox>
          </Select.Option>
          <Select.Option value="group">
            <Flexbox horizontal align="center" gap={6}>
              <Bot size={14} />
              {t('channels.sendTest.modeGroup')}
            </Flexbox>
          </Select.Option>
        </Select>

        {mode === 'self' && !hasP2p && (
          <Alert
            type="info"
            showIcon
            message={t('channels.sendTest.dmHint')}
            style={{ fontSize: 12 }}
          />
        )}

        {mode === 'group' && (
          <Select
            value={selectedChat}
            onChange={setSelectedChat}
            loading={loadingChats}
            placeholder={t('channels.sendTest.groupPlaceholder')}
            style={{ width: '100%' }}
            options={groups.map((c) => ({
              value: c.id,
              label: c.name || c.id,
            }))}
            notFoundContent={
              loadingChats ? t('channels.sendTest.groupLoadingContent') : t('channels.sendTest.groupEmptyContent')
            }
          />
        )}

        <TextArea
          rows={2}
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder={t('channels.sendTest.messagePlaceholder')}
          style={{ fontSize: 13 }}
        />

        <Button
          type="primary"
          icon={<Send size={14} />}
          loading={sending}
          onClick={handleSend}
          disabled={!testText.trim() || (mode === 'group' && !selectedChat)}
          block
        >
          {t('channels.sendTest.sendButton')}
        </Button>
      </Flexbox>
    </Card>
  );
}

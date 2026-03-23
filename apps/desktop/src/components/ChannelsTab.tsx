import { useCallback, useEffect, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import {
  Badge, Button, Card, Dropdown, Empty, Switch,
  Tag, Typography, theme, message, Tooltip, Space, Alert,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  ChevronDown, ExternalLink, Zap, Webhook,
} from 'lucide-react';
import { api, type Channel } from '../services/api';
import { LarkSimulateLoginModal } from './settings/LarkSimulateLoginModal';

const { Text, Title } = Typography;

const TelegramIcon = ({ size = 16 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="#0088cc">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
  </svg>
);

const LarkIcon = ({ size = 16 }: { size?: number }) => (
  <svg viewBox="7 7 26 26" width={size} height={size} fill="none">
    <path fill="#00d6b9" d="m21.069 20.504.063-.06.125-.122.085-.084.256-.254.348-.344.299-.296.281-.278.293-.289.269-.266.374-.37.218-.206.419-.359.404-.306.598-.386.617-.33.606-.265.348-.127.177-.058a14.8 14.8 0 0 0-2.793-5.603 1.34 1.34 0 0 0-1.047-.502H12.221a.201.201 0 0 0-.119.364 31.5 31.5 0 0 1 8.943 10.162l.025-.023z"/>
    <path fill="#3370ff" d="M16.791 30c5.57 0 10.423-3.074 12.955-7.618q.133-.239.258-.484a6 6 0 0 1-.425.699 6 6 0 0 1-.17.23 6 6 0 0 1-.225.274q-.092.105-.188.206a6 6 0 0 1-.407.384 6 6 0 0 1-.24.195 7 7 0 0 1-.292.21q-.094.065-.191.122c-.097.057-.134.081-.204.119q-.21.116-.428.215a6 6 0 0 1-.385.157 6 6 0 0 1-.43.138 6 6 0 0 1-.661.143 6 6 0 0 1-.491.055 6.125 6.125 0 0 1-1.543-.085 7 7 0 0 1-.38-.079l-.2-.051-.555-.155-.275-.081-.41-.125-.334-.107-.317-.104-.215-.073-.26-.091-.186-.066-.367-.134-.212-.081-.284-.11-.299-.119-.193-.079-.24-.1-.185-.078-.192-.084-.166-.073-.152-.067-.153-.07-.159-.073-.2-.093-.208-.099-.222-.108-.189-.093a31.2 31.2 0 0 1-8.822-6.583.202.202 0 0 0-.349.138l.005 9.52v.773c0 .448.222.87.595 1.118A14.75 14.75 0 0 0 16.791 30"/>
    <path fill="#133c9a" d="M33.151 16.582a8.45 8.45 0 0 0-3.744-.869 8.5 8.5 0 0 0-2.303.317l-.252.075-.177.058-.348.127-.606.265-.617.33-.598.386-.404.306-.419.359-.218.206-.374.37-.269.266-.293.289-.281.278-.299.296-.348.344-.256.254-.085.084-.125.122-.063.06-.095.09-.105.099a15 15 0 0 1-3.072 2.175l.2.093.159.073.153.07.152.067.166.073.192.084.185.078.24.1.193.079.299.119.284.11.212.081.367.134.186.066.26.09.215.073.317.104.334.107.41.125.275.081.555.155.2.051.379.079.433.062.585.037.525-.014.491-.055a6 6 0 0 0 .66-.143l.43-.138.385-.158.427-.215.204-.119.191-.122.292-.21.24-.195.407-.384.188-.206.225-.274.17-.23a6 6 0 0 0 .421-.693l.144-.288 1.305-2.599-.003.006a8.1 8.1 0 0 1 1.697-2.439z"/>
  </svg>
);

const SlackIcon = ({ size = 16 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size}>
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#e01e5a"/>
    <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36c5f0"/>
    <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2eb67d"/>
    <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ecb22e"/>
  </svg>
);

function getIcon(type: string, size = 16) {
  switch (type) {
    case 'telegram': return <TelegramIcon size={size} />;
    case 'lark': return <LarkIcon size={size} />;
    case 'slack': return <SlackIcon size={size} />;
    default: return <Webhook size={size} />;
  }
}

const TYPE_LABELS: Record<string, string> = {
  telegram: 'Telegram', lark: 'Lark (飞书)', slack: 'Slack', webhook: 'Webhook',
};

const TYPE_COLORS: Record<string, string> = {
  telegram: '#0088cc', lark: '#3370ff', slack: '#4a154b', webhook: '#6366f1',
};

const IS_BOT: Record<string, boolean> = {
  telegram: true, lark: true, slack: true, webhook: false,
};

interface ChannelsTabProps {
  onNavigate?: (page: string) => void;
}

export function ChannelsTab({ onNavigate }: ChannelsTabProps) {
  const { token } = theme.useToken();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [larkModalOpen, setLarkModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChannels(await api.listChannels());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      await api.testChannel(id);
      message.success('Test passed!');
    } catch (err: unknown) {
      message.error(`Test failed: ${err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : 'error'}`);
    } finally {
      setTestingId(null);
    }
  };

  const botCount = channels.filter(ch => IS_BOT[ch.type]).length;
  const connectedCount = channels.filter(ch => ch.botStatus?.connected).length;
  const webhookCount = channels.filter(ch => ch.type === 'webhook').length;

  const addMenuItems: MenuProps['items'] = [
    {
      key: 'lark',
      label: (
        <Flexbox horizontal align="center" gap={8}>
          <LarkIcon size={16} />
          <span>Lark (飞书)</span>
        </Flexbox>
      ),
      onClick: () => setLarkModalOpen(true),
    },
  ];

  const handleLarkBotSuccess = useCallback(
    async (result: { bot?: { app_id: string; app_secret: string } }) => {
      if (!result.bot) return;
      try {
        await api.createChannel({
          name: 'My Lark Bot',
          type: 'lark',
          config: JSON.stringify({ appId: result.bot.app_id, appSecret: result.bot.app_secret }),
          enabled: true,
        });
        message.success('Lark bot channel created');
        load();
      } catch (err: unknown) {
        message.error(`Create channel failed: ${err && typeof err === 'object' && 'message' in err ? (err as { message: string }).message : 'error'}`);
      }
    },
    [load],
  );

  return (
    <Flexbox gap={16} style={{ padding: 16 }}>
      <Flexbox horizontal align="center" justify="space-between">
        <Flexbox>
          <Title level={5} style={{ margin: 0 }}>Channels Overview</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Quick view of connected bots and webhooks. For full management, go to the Channels page.
          </Text>
        </Flexbox>
        <Space>
          <Dropdown menu={{ items: addMenuItems }} trigger={['click']}>
            <Button icon={<ChevronDown size={14} />}>
              新增
            </Button>
          </Dropdown>
          {onNavigate && (
            <Button type="primary" icon={<ExternalLink size={14} />} onClick={() => onNavigate('channels')}>
              Open Channels
            </Button>
          )}
        </Space>
      </Flexbox>

      {/* Summary */}
      <Flexbox horizontal gap={12}>
        <Card size="small" style={{ flex: 1, textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Bots</Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{botCount}</div>
        </Card>
        <Card size="small" style={{ flex: 1, textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Connected</Text>
          <div style={{ fontSize: 24, fontWeight: 600, color: token.colorSuccess }}>{connectedCount}</div>
        </Card>
        <Card size="small" style={{ flex: 1, textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Webhooks</Text>
          <div style={{ fontSize: 24, fontWeight: 600 }}>{webhookCount}</div>
        </Card>
      </Flexbox>

      {channels.length === 0 && !loading ? (
        <Empty description="No channels configured" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          {onNavigate ? (
            <Button type="primary" onClick={() => onNavigate('channels')}>Configure Channels</Button>
          ) : (
            <Text type="secondary">Add channels from the Channels page in the sidebar.</Text>
          )}
        </Empty>
      ) : (
        <Flexbox gap={8}>
          {channels.map((ch) => {
            const isBot = IS_BOT[ch.type];
            const botConnected = ch.botStatus?.connected;
            return (
              <Card key={ch.id} size="small" style={{ opacity: ch.enabled ? 1 : 0.6 }}>
                <Flexbox horizontal align="center" justify="space-between">
                  <Flexbox horizontal align="center" gap={10}>
                    {isBot ? (
                      <Badge status={botConnected ? 'success' : 'default'} offset={[-2, 14]} dot>
                        {getIcon(ch.type)}
                      </Badge>
                    ) : getIcon(ch.type)}
                    <Flexbox>
                      <Flexbox horizontal align="center" gap={6}>
                        <Text strong style={{ fontSize: 13 }}>{ch.name}</Text>
                        <Tag color={TYPE_COLORS[ch.type]} style={{ margin: 0, fontSize: 11 }}>
                          {TYPE_LABELS[ch.type]}
                        </Tag>
                        {isBot && botConnected && (
                          <Tag color="success" style={{ margin: 0, fontSize: 11 }}>Connected</Tag>
                        )}
                        {isBot && !botConnected && ch.enabled && (
                          <Tag color="warning" style={{ margin: 0, fontSize: 11 }}>Offline</Tag>
                        )}
                        {!ch.enabled && (
                          <Tag color="default" style={{ margin: 0, fontSize: 11 }}>Disabled</Tag>
                        )}
                      </Flexbox>
                    </Flexbox>
                  </Flexbox>
                  <Space size={4}>
                    <Switch size="small" checked={ch.enabled}
                      onChange={async (v) => { await api.updateChannel(ch.id, { enabled: v }); load(); }}
                    />
                    <Tooltip title="Test">
                      <Button size="small" icon={<Zap size={14} />}
                        loading={testingId === ch.id} onClick={() => handleTest(ch.id)} />
                    </Tooltip>
                  </Space>
                </Flexbox>
                {ch.botStatus?.error && (
                  <Alert type="error" message={ch.botStatus.error} style={{ marginTop: 8 }} showIcon banner />
                )}
              </Card>
            );
          })}
        </Flexbox>
      )}

      <LarkSimulateLoginModal
        open={larkModalOpen}
        onClose={() => setLarkModalOpen(false)}
        intent="bot"
        onSuccess={handleLarkBotSuccess}
      />
    </Flexbox>
  );
}

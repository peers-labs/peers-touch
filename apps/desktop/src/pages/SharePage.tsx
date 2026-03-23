import { useState, useEffect } from 'react';
import { Flexbox, Center } from 'react-layout-kit';
import { Markdown } from '@lobehub/ui';
import { Alert, Spin, theme } from 'antd';
import { Bot, User } from 'lucide-react';

interface SharedMessage {
  id: string;
  role: string;
  content: string;
  model?: string;
  created_at: string;
}

interface SharedData {
  share_id: string;
  title: string;
  messages: SharedMessage[];
}

const BASE_URL = import.meta.env.VITE_API_URL || '/api';

async function fetchSharedSession(token: string): Promise<SharedData> {
  const res = await fetch(`${BASE_URL}/share/${token}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Not found');
  }
  return res.json();
}

export default function SharePage({ token }: { token: string }) {
  const { token: themeToken } = theme.useToken();
  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchSharedSession(token)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <Center height="100vh" width="100%">
        <Spin size="large" />
      </Center>
    );
  }

  if (error || !data) {
    return (
      <Center height="100vh" width="100%">
        <Flexbox align="center" gap={16} style={{ maxWidth: 400 }}>
          <Alert
            type="error"
            message="Share not found"
            description={error || 'This share link may have expired or been revoked.'}
            showIcon
          />
        </Flexbox>
      </Center>
    );
  }

  const visibleMessages = data.messages.filter((m) => m.role !== 'system' && m.role !== 'tool');

  return (
    <Flexbox
      height="100vh"
      width="100%"
      style={{ background: themeToken.colorBgLayout }}
    >
      {/* Header */}
      <Flexbox
        horizontal
        align="center"
        justify="center"
        gap={12}
        style={{
          padding: '12px 24px',
          borderBottom: `1px solid ${themeToken.colorBorderSecondary}`,
          background: themeToken.colorBgContainer,
        }}
      >
        <Bot size={24} style={{ color: themeToken.colorPrimary }} />
        <span style={{ fontSize: 15, fontWeight: 600, color: themeToken.colorText }}>
          Agent Box
        </span>
      </Flexbox>

      {/* Content */}
      <Flexbox flex={1} style={{ overflow: 'auto' }}>
        <Flexbox
          style={{
            maxWidth: 800,
            width: '100%',
            margin: '0 auto',
            padding: '24px 16px',
          }}
          gap={8}
        >
          {/* Title */}
          <Center style={{ marginBottom: 16 }}>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 600,
                color: themeToken.colorText,
                margin: 0,
                textAlign: 'center',
              }}
            >
              {data.title || 'Shared Conversation'}
            </h2>
          </Center>

          {/* Messages */}
          {visibleMessages.map((msg) => (
            <Flexbox
              key={msg.id}
              horizontal
              gap={12}
              style={{
                padding: '16px 0',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background:
                    msg.role === 'user'
                      ? themeToken.colorPrimary
                      : themeToken.colorFillSecondary,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {msg.role === 'user' ? (
                  <User size={18} color="#fff" />
                ) : (
                  <Bot size={18} color={themeToken.colorPrimary} />
                )}
              </div>
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: themeToken.colorTextTertiary,
                    marginBottom: 4,
                    fontWeight: 500,
                  }}
                >
                  {msg.role === 'user' ? 'You' : 'Assistant'}
                  {msg.model && (
                    <span style={{ marginLeft: 8, fontWeight: 400 }}>{msg.model}</span>
                  )}
                </div>
                <Markdown variant="chat" fontSize={14}>
                  {msg.content}
                </Markdown>
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      </Flexbox>

      {/* Footer disclaimer */}
      <Center
        style={{
          padding: '12px 24px',
          borderTop: `1px solid ${themeToken.colorBorderSecondary}`,
          opacity: 0.6,
        }}
      >
        <span style={{ fontSize: 12, color: themeToken.colorTextTertiary }}>
          This is a shared conversation. Content is generated by AI and may not be accurate.
        </span>
      </Center>
    </Flexbox>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Typography, Tag, Spin } from 'antd';
import { theme } from 'antd';
import {
  Blocks,
  Clock,
  ChevronRight,
} from 'lucide-react';
import AppletManager from '../applet/AppletManager';
import type { AppletInfo } from '../applet/AppletManager';
import { PageHeader } from '../components/PageHeader';

const { Text, Paragraph } = Typography;

export function AppletsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [applets, setApplets] = useState<AppletInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { token } = theme.useToken();
  const appletManager = AppletManager.getInstance();

  const loadApplets = useCallback(async () => {
    try {
      const data = await appletManager.scanApplets();
      setApplets(data);
    } catch {
      setApplets([]);
    } finally {
      setLoading(false);
    }
  }, [appletManager]);

  useEffect(() => {
    loadApplets();
  }, [loadApplets]);

  const handleOpen = useCallback((id: string) => {
    if (onNavigate) {
      onNavigate(`applet:${id}`);
    }
  }, [onNavigate]);

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%' }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  return (
    <Flexbox style={{ height: '100%', overflow: 'auto' }}>
      <PageHeader
        title="Agent Applets"
        subtitle="Extend Peers Touch with pluggable applets — each is a self-contained agent with its own UI, tools, and knowledge."
        icon={<Blocks size={20} />}
      />

      {/* Card Grid */}
      <div
        style={{
          padding: '28px 40px 48px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 20,
          alignContent: 'start',
        }}
      >
        {applets.map((info) => (
          <AppletCard
            key={info.id}
            info={info}
            onOpen={() => handleOpen(info.id)}
          />
        ))}

        {applets.length === 0 && (
          <Flexbox
            align="center"
            justify="center"
            gap={12}
            style={{
              gridColumn: '1 / -1',
              padding: 64,
              color: token.colorTextTertiary,
            }}
          >
            <Blocks size={48} strokeWidth={1} />
            <Text type="secondary">No applets installed yet.</Text>
          </Flexbox>
        )}
      </div>
    </Flexbox>
  );
}

function AppletCard({
  info,
  onOpen,
}: {
  info: AppletInfo;
  onOpen: () => void;
}) {
  const { token } = theme.useToken();

  return (
    <div className="applet-card">
      <div
        style={{
          borderRadius: 16,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          overflow: 'hidden',
          transition: 'all 0.25s ease',
          cursor: 'pointer',
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = token.colorPrimary;
          e.currentTarget.style.boxShadow = `0 4px 24px ${token.colorPrimaryBg}`;
          e.currentTarget.style.transform = 'translateY(-2px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = token.colorBorderSecondary;
          e.currentTarget.style.boxShadow = 'none';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        {/* Top color accent bar */}
        <div
          style={{
            height: 3,
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            transition: 'background 0.3s',
          }}
        />

        <Flexbox style={{ padding: '20px 20px 16px' }} gap={14}>
          {/* Row 1: Icon + Name + Status */}
          <Flexbox horizontal align="center" gap={14}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: 'linear-gradient(135deg, #667eea, #764ba2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                opacity: 1,
                transition: 'opacity 0.2s, box-shadow 0.2s',
              }}
            >
              <Blocks size={28} color="#fff" />
            </div>

            <Flexbox flex={1} style={{ minWidth: 0 }}>
              <Flexbox horizontal align="center" gap={8}>
                <Text strong style={{ fontSize: 16, lineHeight: 1.3 }}>
                  {info.name}
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  v{info.version}
                </Text>
                <Tag color="default" style={{ margin: 0 }}>Installed</Tag>
              </Flexbox>
              <Text type="secondary" style={{ fontSize: 12 }}>
                by {info.author}
              </Text>
            </Flexbox>
          </Flexbox>

          {/* Row 2: Description */}
          <Paragraph
            type="secondary"
            style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}
            ellipsis={{ rows: 2 }}
          >
            {info.description}
          </Paragraph>

          <Flexbox horizontal align="center" gap={6} wrap="wrap">
            {info.capabilities?.map((cap) => {
              return (
                <Tag
                  key={cap}
                  style={{
                    fontSize: 11,
                    lineHeight: '20px',
                    padding: '0 8px',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    margin: 0,
                  }}
                >
                  {cap}
                </Tag>
              );
            })}
            {info.permissions?.map((perm) => {
              return (
                <Tag
                  key={perm}
                  color="blue"
                  style={{
                    fontSize: 11,
                    lineHeight: '20px',
                    padding: '0 8px',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    margin: 0,
                  }}
                >
                  {perm}
                </Tag>
              );
            })}
          </Flexbox>

          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{
              paddingTop: 12,
              borderTop: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Flexbox horizontal align="center" gap={6}>
              <Clock size={12} style={{ color: token.colorTextQuaternary }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Runtime: /applets-dist/{info.id}
              </Text>
            </Flexbox>

            <Flexbox
              horizontal
              align="center"
              gap={4}
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: token.colorPrimary,
                cursor: 'pointer',
              }}
            >
              Open
              <ChevronRight size={14} />
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </div>
    </div>
  );
}

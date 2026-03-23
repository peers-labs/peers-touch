import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Typography, theme } from 'antd';

const { Title, Text } = Typography;

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  extra?: ReactNode;
}

export function PageHeader({ title, subtitle, icon, actions, extra }: PageHeaderProps) {
  const { token } = theme.useToken();

  return (
    <Flexbox
      horizontal
      align="center"
      justify="space-between"
      style={{
        padding: '16px 24px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        flexShrink: 0,
        minHeight: 64,
      }}
    >
      <Flexbox horizontal align="center" gap={10}>
        {icon}
        <Flexbox gap={2}>
          <Title level={4} style={{ margin: 0 }}>{title}</Title>
          {subtitle && (
            <Text type="secondary" style={{ fontSize: 13 }}>{subtitle}</Text>
          )}
        </Flexbox>
      </Flexbox>
      <Flexbox horizontal gap={12} align="center" style={{ flexShrink: 0 }}>
        {extra}
        {actions}
      </Flexbox>
    </Flexbox>
  );
}

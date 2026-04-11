/**
 * Reusable page header component.
 * Provides a consistent title + subtitle + action slot layout
 * across all dashboard pages.
 *
 * Created: 2026-04-10
 */

import { Typography, theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import type { ReactNode } from 'react';

const { Title, Text } = Typography;

interface Props {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}

export default function PageHeader({ title, subtitle, extra }: Props) {
  const { token } = theme.useToken();

  return (
    <Flexbox
      horizontal
      align="center"
      justify="space-between"
      style={{
        padding: '20px 24px 16px',
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <Flexbox gap={4}>
        <Title level={4} style={{ margin: 0 }}>{title}</Title>
        {subtitle && <Text type="secondary">{subtitle}</Text>}
      </Flexbox>

      {extra && <Flexbox horizontal gap={8}>{extra}</Flexbox>}
    </Flexbox>
  );
}

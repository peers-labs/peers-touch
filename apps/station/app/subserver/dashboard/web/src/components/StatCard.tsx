/**
 * Statistics card for the overview dashboard.
 * Renders a compact metric with title, icon, formatted value, and
 * optional subtitle for contextual detail.
 *
 * Created: 2026-04-10
 */

import { theme, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import type { ReactNode } from 'react';
import { formatNumber } from '../utils/format';

const { Text } = Typography;

interface Props {
  title: string;
  value: number;
  icon: ReactNode;
  color?: string;
  subtitle?: string;
}

export default function StatCard({ title, value, icon, color, subtitle }: Props) {
  const { token } = theme.useToken();

  return (
    <Flexbox
      gap={12}
      style={{
        padding: 20,
        borderRadius: token.borderRadiusLG,
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        flex: 1,
        minWidth: 200,
      }}
    >
      {/* Header row: label + icon badge */}
      <Flexbox horizontal align="center" justify="space-between">
        <Text type="secondary" style={{ fontSize: 13 }}>{title}</Text>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: color || token.colorPrimaryBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: color ? '#fff' : token.colorPrimary,
          }}
        >
          {icon}
        </div>
      </Flexbox>

      {/* Primary metric value */}
      <Text strong style={{ fontSize: 28, lineHeight: 1 }}>
        {formatNumber(value)}
      </Text>

      {/* Optional context line */}
      {subtitle && (
        <Text type="secondary" style={{ fontSize: 12 }}>{subtitle}</Text>
      )}
    </Flexbox>
  );
}

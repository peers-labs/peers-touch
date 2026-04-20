import type { CSSProperties, ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Typography, theme } from 'antd';

const { Text, Title } = Typography;

const MAX_WIDTH = 720;
const CONTAINER_PADDING = 24;
const SECTION_PADDING = 24;
const SECTION_BORDER_RADIUS = 12;

interface SettingsContainerProps {
  children: ReactNode;
  maxWidth?: number;
  style?: CSSProperties;
  fullHeight?: boolean;
}

export function SettingsContainer({
  children,
  maxWidth = MAX_WIDTH,
  style,
  fullHeight,
}: SettingsContainerProps) {
  return (
    <Flexbox
      gap={24}
      style={{
        padding: CONTAINER_PADDING,
        maxWidth,
        height: fullHeight ? '100%' : undefined,
        overflow: fullHeight ? 'auto' : undefined,
        ...style,
      }}
    >
      {children}
    </Flexbox>
  );
}

interface SettingsSectionProps {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}

export function SettingsSection({
  icon,
  title,
  subtitle,
  extra,
  children,
  style,
}: SettingsSectionProps) {
  const { token } = theme.useToken();

  return (
    <Flexbox
      gap={16}
      style={{
        background: token.colorBgContainer,
        borderRadius: SECTION_BORDER_RADIUS,
        padding: SECTION_PADDING,
        border: `1px solid ${token.colorBorderSecondary}`,
        ...style,
      }}
    >
      <Flexbox horizontal align="center" justify="space-between">
        <Flexbox gap={4}>
          <Flexbox horizontal align="center" gap={8}>
            {icon}
            <Title level={5} style={{ margin: 0 }}>{title}</Title>
          </Flexbox>
          {subtitle && (
            <Text type="secondary" style={{ fontSize: 13 }}>{subtitle}</Text>
          )}
        </Flexbox>
        {extra}
      </Flexbox>
      {children}
    </Flexbox>
  );
}

interface SettingsRowProps {
  label: ReactNode;
  description?: string;
  children: ReactNode;
  vertical?: boolean;
  style?: CSSProperties;
}

export function SettingsRow({
  label,
  description,
  children,
  vertical,
  style,
}: SettingsRowProps) {
  if (vertical) {
    return (
      <Flexbox gap={8} style={style}>
        <Flexbox gap={2}>
          <Text strong style={{ fontSize: 13 }}>{label}</Text>
          {description && (
            <Text type="secondary" style={{ fontSize: 12 }}>{description}</Text>
          )}
        </Flexbox>
        {children}
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" justify="space-between" style={style}>
      <Flexbox gap={2} style={{ flex: 1 }}>
        <Text strong style={{ fontSize: 13 }}>{label}</Text>
        {description && (
          <Text type="secondary" style={{ fontSize: 12 }}>{description}</Text>
        )}
      </Flexbox>
      <Flexbox style={{ flexShrink: 0 }}>{children}</Flexbox>
    </Flexbox>
  );
}

interface SettingsItemCardProps {
  children: ReactNode;
  style?: CSSProperties;
}

export function SettingsItemCard({ children, style }: SettingsItemCardProps) {
  const { token } = theme.useToken();

  return (
    <Flexbox
      style={{
        padding: 16,
        borderRadius: 8,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        ...style,
      }}
    >
      {children}
    </Flexbox>
  );
}

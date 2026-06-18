import { ReactNode } from 'react';
import { Button } from '@lobehub/ui';
import { Segmented, Typography, theme } from 'antd';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// SocialScopeBar — the single header block that owns the Social page title,
// optional scope tabs (Home / Public / Search / Circles), and the primary
// New Post CTA.
//
// Why one component instead of three disconnected pieces:
//   - The title, tabs, and CTA must share height, radius, and padding
//     rhythm, otherwise they look assembled from different designs.
//   - Narrow (low-width) windows collapse the CTA under tabs, but the
//     group stays one visual unit.
//
// Visual contract (Quiet Protocol Minimalism):
//   - No heavy bordered container.
//   - Title = primary text; subtitle = secondary text; both compact.
//   - Tabs = Segmented using the theme primary token (the same visual
//     system that styles the primary button).
//   - New Post CTA = one primary button with the same token; it does
//     not out-weight the tabs.

const { Text } = Typography;

export interface SocialScopeBarTab {
  value: string;
  label: string;
}

export interface SocialScopeBarProps {
  title?: string;
  subtitle?: string;
  tabs?: SocialScopeBarTab[];
  activeTab?: string;
  onTabChange?: (value: string) => void;
  primaryAction?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
  extra?: ReactNode;
  compact?: boolean;
}

export function SocialScopeBar({
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  primaryAction,
  extra,
  compact,
}: SocialScopeBarProps) {
  const { t } = useTranslation('moments');

  const defaultTitle = title ?? t('moments.title');
  const defaultSubtitle = subtitle ?? t('moments.subtitle');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: compact ? 'column' : 'row',
        alignItems: compact ? 'flex-start' : 'flex-end',
        justifyContent: 'space-between',
        gap: compact ? 10 : 18,
        padding: `${compact ? 4 : 6}px 2px ${compact ? 4 : 6}px`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <Text strong style={{ fontSize: compact ? 16 : 19, lineHeight: 1.3 }}>
          {defaultTitle}
        </Text>
        <Text type="secondary" style={{ fontSize: 12.5, lineHeight: 1.5, maxWidth: 620 }}>
          {defaultSubtitle}
        </Text>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
          width: compact ? '100%' : undefined,
          justifyContent: compact ? 'flex-start' : 'flex-end',
        }}
      >
        {tabs && tabs.length > 0 && (
          <Segmented
            value={activeTab}
            onChange={(value) => onTabChange?.(String(value))}
            size={compact ? 'small' : 'middle'}
            options={tabs.map((tab) => ({ value: tab.value, label: tab.label }))}
          />
        )}
        {primaryAction && (
          <Button
            type="primary"
            size={compact ? 'small' : 'middle'}
            icon={<Plus size={compact ? 12 : 14} />}
            onClick={primaryAction.onClick}
            disabled={primaryAction.disabled}
            style={{ minHeight: compact ? 28 : 32 }}
          >
            {primaryAction.label}
          </Button>
        )}
        {extra}
      </div>
    </div>
  );
}

// ScopeHint — the small contextual description under the scope bar
// (Home / Federated / Search / Circles body text).
// Kept as a single-component rule to keep the look consistent across tabs.
export interface SocialScopeHintProps {
  children?: ReactNode;
}

export function SocialScopeHint({ children }: SocialScopeHintProps) {
  const { token } = theme.useToken();
  return (
    <Text
      type="secondary"
      style={{
        fontSize: 12.5,
        lineHeight: 1.6,
        color: token.colorTextSecondary,
      }}
    >
      {children}
    </Text>
  );
}

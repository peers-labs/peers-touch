/**
 * Agent AI-settings layout atoms, peers-ui only.
 *
 * SettingsSection is a titled Card; SettingsRow is a label/description +
 * control grid. Only layout wrappers live here — every interactive control
 * (Switch/Select/Slider/TextField/Button) is a peers-ui primitive, so the
 * module still passes the agent peer-only gate.
 */
import type { ReactNode } from 'react';
import type { IconId } from '@peers-touch/ui-assets';
import { Card, Flex, Icon, Text } from '@peers-touch/ui';

interface SettingsSectionProps {
  iconId: IconId;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  testId?: string;
}

export function SettingsSection({ iconId, title, subtitle, actions, children, testId }: SettingsSectionProps) {
  return (
    <Card
      flat
      className="pa-aisec"
      heading={(
        <Flex direction="row" align="center" gap={8} className="pa-aisec__heading">
          <Icon iconId={iconId} size={16} className="pa-aisec__icon" />
          <span>{title}</span>
        </Flex>
      )}
      actions={actions}
      data-pt-ai-section={testId}
    >
      {subtitle && <Text tone="muted" className="pa-aisec__subtitle">{subtitle}</Text>}
      <Flex direction="column" gap={10} className="pa-aisec__rows">
        {children}
      </Flex>
    </Card>
  );
}

interface SettingsRowProps {
  label: string;
  description?: string;
  children: ReactNode;
}

export function SettingsRow({ label, description, children }: SettingsRowProps) {
  return (
    <Flex direction="row" align="center" justify="space-between" gap={12} className="pa-airow">
      <span className="pa-airow__text">
        <Text strong className="pa-airow__label">{label}</Text>
        {description && <Text tone="muted" className="pa-airow__desc">{description}</Text>}
      </span>
      <span className="pa-airow__control">{children}</span>
    </Flex>
  );
}

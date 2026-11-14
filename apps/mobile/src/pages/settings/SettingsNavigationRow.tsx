import { Button, Icon, Text } from '@peers-touch/ui';

export function SettingsNavigationRow({ actionId, settingId, label, description, onActivate }: {
  readonly actionId: string;
  readonly settingId?: string | undefined;
  readonly label: string;
  readonly description?: string | undefined;
  readonly onActivate: () => void;
}) {
  return <Button actionId={actionId} data-setting-id={settingId} fullWidth emphasis="quiet" density="comfortable" onActivate={onActivate}>
    <span className="mobile-setting-navigation-row">
      <span className="mobile-setting-navigation-copy">
        <Text>{label}</Text>
        {description ? <Text tone="secondary">{description}</Text> : null}
      </span>
      <Icon iconId="chevron-right" size={18} />
    </span>
  </Button>;
}

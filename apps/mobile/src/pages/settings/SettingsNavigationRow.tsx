import type { KeyboardEvent } from 'react';
import { Icon, ListRow } from '@peers-touch/ui';

/**
 * Settings navigation row built 100% from peers-ui primitives: ListRow owns
 * the two-zone grid (label left, control right) and the inset hairline
 * rhythm; Icon provides the chevron. The component only adds the press /
 * focus contract shared by every tappable list row, mirroring the prototype
 * NavRow pattern. No app-owned layout CSS, no hand-rolled button chrome.
 */
export function SettingsNavigationRow({ actionId, settingId, label, description, onActivate }: {
  readonly actionId: string;
  readonly settingId?: string | undefined;
  readonly label: string;
  readonly description?: string | undefined;
  readonly onActivate: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
    }
  };

  return (
    <ListRow
      role="button"
      tabIndex={0}
      data-action-id={actionId}
      data-setting-id={settingId}
      label={label}
      description={description}
      onClick={onActivate}
      onKeyDown={handleKeyDown}
      control={<Icon iconId="chevron-right" size={17} />}
    />
  );
}

import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import type { ActionBarContext, ActionBarItem } from './types';

const TOOL_BUTTON_STYLE = {
  borderRadius: 8,
  border: '1px solid #ececec',
  background: '#ffffff',
  boxShadow: '0 1px 4px rgba(15,23,42,0.04)',
} as const;

interface ActionBarProps {
  items: ActionBarItem[];
  context: ActionBarContext;
}

/**
 * Registry-driven toolbar that renders ActionBarItem[] as icon buttons.
 * Adding/removing actions requires only changing the registry array.
 */
export function ActionBar({ items, context }: ActionBarProps) {
  const { t } = useTranslation('chat');

  const visibleItems = items.filter((item) => {
    if (item.visible === undefined) return true;
    return typeof item.visible === 'function' ? item.visible(context) : item.visible;
  });

  if (visibleItems.length === 0) return null;

  return (
    <Flexbox horizontal align="center" gap={8}>
      {visibleItems.map((item) => {
        const isDisabled = typeof item.disabled === 'function'
          ? item.disabled(context)
          : (item.disabled ?? false);

        return (
          <ActionIcon
            key={item.key}
            icon={item.icon}
            onClick={() => { if (!isDisabled) item.onAction(context); }}
            disabled={isDisabled}
            title={t(item.titleKey)}
            size={{ blockSize: 28, size: 13 }}
            style={{
              ...TOOL_BUTTON_STYLE,
              cursor: isDisabled ? 'not-allowed' : 'pointer',
            }}
          />
        );
      })}
    </Flexbox>
  );
}

export type { ActionBarContext, ActionBarItem } from './types';
export { defaultLeftActions, defaultRightActions } from './registry';

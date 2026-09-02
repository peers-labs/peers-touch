import { type CSSProperties, useMemo } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Dropdown } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';
import { buildMessageActions, type MessageActionContext } from './actions';

interface MessageActionBarProps {
  context: MessageActionContext;
  style?: CSSProperties;
}

export function MessageActionBar({ context, style }: MessageActionBarProps) {
  const { t } = useTranslation('chat');
  const { primary, menu } = useMemo(() => buildMessageActions(context), [context]);

  const visibleMenu = menu.filter((a) => !a.hidden);
  if (primary.length === 0 && visibleMenu.length === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, ...style }}>
      {primary.map((action) => (
        <button
          data-pt-message-action={action.key}
          key={action.key}
          onClick={action.onClick}
          disabled={action.disabled}
          title={t(action.label)}
          style={buttonStyle}
        >
          <action.icon size={14} />
        </button>
      ))}
      {visibleMenu.length > 0 && (
        <Dropdown
          menu={{
            items: visibleMenu.map((action) => ({
              key: action.key,
              label: <span data-pt-message-action={action.key}>{t(action.label)}</span>,
              icon: <action.icon size={14} />,
              danger: action.danger,
              disabled: action.disabled,
              onClick: action.onClick,
            })),
          }}
          trigger={['click']}
        >
          <button
            data-pt-message-actions-more
            style={buttonStyle}
            title={t('chat.message.action.more')}
          >
            <MoreHorizontal size={14} />
          </button>
        </Dropdown>
      )}
    </div>
  );
}

const buttonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  cursor: 'pointer',
  color: 'inherit',
  opacity: 0.6,
  transition: 'opacity 0.15s, background 0.15s',
};

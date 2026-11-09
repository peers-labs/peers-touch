import { type CSSProperties, useMemo } from 'react';
import { Button, IconButton, Menu } from '@peers-touch/ui';
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
    <div className="sc-msg-actions-bar" data-message-actions style={style}>
      {primary.map((action) => (
        <Button
          key={action.key}
          actionId={`msg-action-${action.key}`}
          data-pt-message-action={action.key}
          emphasis="quiet"
          density="compact"
          leading={<action.icon size={14} />}
          label={t(action.label)}
          availability={action.disabled ? { kind: 'disabled', reason: t(action.label) } : undefined}
          onActivate={action.onClick}
        />
      ))}
      {visibleMenu.length > 0 && (
        <Menu
          placement="top"
          onAction={(id) => visibleMenu.find((a) => a.key === id)?.onClick()}
          actions={visibleMenu.map((action) => ({
            id: action.key,
            label: t(action.label),
            leading: <action.icon size={14} />,
            tone: action.danger ? 'danger' : undefined,
            availability: action.disabled
              ? { kind: 'disabled' as const, reason: '' }
              : undefined,
          }))}
        >
          <IconButton
            actionId="msg-action-more"
            data-pt-message-actions-more
            iconId="more-horizontal"
            iconSize={14}
            density="compact"
            emphasis="quiet"
            label={t('chat.message.action.more')}
          />
        </Menu>
      )}
    </div>
  );
}

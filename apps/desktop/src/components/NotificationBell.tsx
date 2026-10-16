import { useRef, useState } from 'react';
import { ActionIcon, Modal } from '@lobehub/ui';
import { Badge, Popover } from 'antd';
import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '../store/notification';
import { useSessionStore } from '../store/session';
import { NotificationCenter } from './notifications/NotificationCenter';

export function NotificationBell() {
  const sessionEpoch = useSessionStore((state) => state.sessionEpoch);
  return <SessionNotificationBell key={sessionEpoch} />;
}

function SessionNotificationBell() {
  const { t } = useTranslation('layout');
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const unread = useNotificationStore((state) => state.unreadTotal);
  const expand = () => {
    setOpen(false);
    setExpanded(true);
  };

  return (
    <>
      <Popover
        open={open && !expanded} onOpenChange={setOpen}
        trigger="click" placement="rightBottom" arrow={false}
        destroyOnHidden
        styles={{ container: { padding: 0 } }}
        content={<NotificationCenter expanded={false} onExpand={expand} />}
        align={{ offset: [8, 0] }}
      >
        <div ref={triggerRef}>
          <Badge count={unread} size="small" offset={[-2, 2]}>
            <ActionIcon data-shell-notification-trigger icon={Bell} size="large" title={t('layout.notifications.title')}
              aria-haspopup="dialog" aria-expanded={open || expanded} />
          </Badge>
        </div>
      </Popover>
      <Modal open={expanded} centered width={760} footer={null} destroyOnHidden
        title={t('layout.notifications.all')} onCancel={() => setExpanded(false)}
        afterClose={() => triggerRef.current?.querySelector<HTMLElement>('[role="button"]')?.focus()}>
        <NotificationCenter expanded onExpand={expand} />
      </Modal>
    </>
  );
}

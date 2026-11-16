import { useTranslation } from 'react-i18next';
import { DrawerRailResizer, type DrawerAssemblyController } from '@peers-touch/ui';
import { WindowDragRegion } from '../shell/WindowDragRegion';

/** Native hit-test adapter; shared UI owns gesture, cancellation and stops. */
export function ChatRailResizer({ assembly }: { assembly: DrawerAssemblyController }) {
  const { t } = useTranslation('chat');
  return (
    <WindowDragRegion mode="none">
      <DrawerRailResizer assembly={assembly} label={t('chat.rail.resize')}
        className="sc-chat-rail-resizer" lineClassName="sc-chat-rail-resizer__line" />
    </WindowDragRegion>
  );
}

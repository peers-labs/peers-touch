import { Flexbox } from 'react-layout-kit';

import { ActionBar } from './ActionBar';
import { ModelPicker } from './ModelPicker';
import { SendControl } from './SendControl';
import type { ActionBarContext } from './ActionBar/types';
import type { ActionBarItem } from './ActionBar/types';

interface ComposerFooterProps {
  leftActions: ActionBarItem[];
  actionContext: ActionBarContext;
  isStreaming: boolean;
  sendDisabled: boolean;
  onSend: () => void;
  onStop: () => void;
}

/**
 * Bottom bar of the composer: left actions | spacer | model picker | send/stop.
 */
export function ComposerFooter({
  leftActions,
  actionContext,
  isStreaming,
  sendDisabled,
  onSend,
  onStop,
}: ComposerFooterProps) {
  return (
    <Flexbox horizontal align="center" gap={8}>
      <ActionBar items={leftActions} context={actionContext} />
      <div style={{ flex: 1, minWidth: 8 }} />
      <ModelPicker />
      <SendControl
        isStreaming={isStreaming}
        disabled={sendDisabled}
        onSend={onSend}
        onStop={onStop}
      />
    </Flexbox>
  );
}

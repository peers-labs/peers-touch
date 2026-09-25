import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MessageActionSheet } from './ChatOverlayHost';

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));

const NOOP = () => undefined;
const message = {
  ulid: 'message-1',
  sessionUlid: 'conversation-1',
  senderPtid: 'ptid:alice',
  receiverPtid: 'ptid:bob',
  type: 1,
  content: 'hello',
  status: 2,
  recalled: false,
  reactions: [],
  attachments: [],
  moderated: false,
};

function render(canModerate: boolean) {
  return renderToStaticMarkup(
    <MessageActionSheet
      message={message}
      currentUserPtid="ptid:alice"
      canEdit
      canModerate={canModerate}
      commandBusy={false}
      flagged={false}
      flagLabel="mobile.chat.flagOnDevice"
      flagLoading={false}
      onClose={NOOP}
      onReply={NOOP}
      onForward={NOOP}
      onOpenThread={NOOP}
      onToggleReaction={NOOP}
      onTogglePin={NOOP}
      onToggleFlag={NOOP}
      onEdit={NOOP}
      onRecall={NOOP}
      onHideForMe={NOOP}
      onModerate={NOOP}
    />,
  );
}

describe('MessageActionSheet', () => {
  it('renders forward, retract, and actor-scoped delete as distinct actions', () => {
    const markup = render(false);

    expect(markup).toContain('mobile.chat.forward');
    expect(markup).toContain('mobile.chat.recall');
    expect(markup).toContain('mobile.chat.deleteForMe');
    expect(markup).not.toContain('mobile.chat.moderate');
  });

  it('adds the separate moderation action for authorized group roles', () => {
    expect(render(true)).toContain('mobile.chat.moderate');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChatThreadPageContent } from './ChatPageContent';

function render(writeAdmissionOpen: boolean) {
  return renderToStaticMarkup(
    <ChatThreadPageContent
      activeInputPanel="none"
      keyboardOverlapHeight={0}
      productSurface="chat.direct-thread"
      style={{}}
      tabBarVisible={false}
      writeAdmissionOpen={writeAdmissionOpen}
    >
      <span>message</span>
    </ChatThreadPageContent>,
  );
}

describe('ChatThreadPageContent write admission', () => {
  it('projects open admission for foreground mutation controls', () => {
    expect(render(true)).toContain('data-chat-write-admission="open"');
  });

  it('projects closed admission while resume reconciliation is pending', () => {
    expect(render(false)).toContain('data-chat-write-admission="closed"');
  });
});

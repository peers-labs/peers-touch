// PageDescriptor for the social chat page.
//
// Chat is the ready landing page. The kernel owns its eager, persistent tree.
//
// `keepAlive: 'forever'` matches the legacy KEEP_ALIVE_PAGES semantics:
// destroying the chat tree on every tab switch loses live P2P state and
// triggers an expensive remount, which the user noticed as "lag on
// first click". The kernel preserves it.

import { registerPage } from '../kernel/page';
import { SocialChatPage } from './SocialChatPage';

export function registerSocialChatPage(): void {
  registerPage({
    id: 'chat',
    title: 'Chat',
    factory: () => <SocialChatPage />,
    preload: 'eager',
    keepAlive: 'forever',
    runtimes: ['messaging', 'social'],
  });
}

// PageDescriptor for the social chat page.
//
// `preload: 'idle'` — ChatPage's React tree is heavy (encryption init,
// store wiring, sub-component theme work), so we mount it during the
// first idle window after first paint. Subsequent navigations are then
// pure visibility flips.
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
    preload: 'idle',
    keepAlive: 'forever',
    runtimes: ['messaging', 'social'],
  });
}

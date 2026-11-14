import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Regression guard for React error #185 (Maximum update depth exceeded):
// getIMConversations() builds a fresh array of fresh projection objects on
// every call. Subscribing to it inside a reactive zustand selector makes
// useSyncExternalStore observe a "changed" snapshot on every store
// notification, which re-renders forever once the component mounts. Such
// derived projections must be read imperatively (getState() in handlers)
// or memoized, never selected reactively.
it('never subscribes to the getIMConversations derived array reactively', () => {
  const source = readFileSync(
    new URL('./ProfilePrimaryAction.tsx', import.meta.url),
    'utf8',
  );

  expect(source).not.toMatch(
    /useSocialChatStore\(\s*\(\s*state\s*\)\s*=>\s*state\.getIMConversations\(\)/,
  );
  // The derived projection is still used, but only at action time.
  expect(source).toMatch(/useSocialChatStore\.getState\(\)\s*\.getIMConversations\(\)/);
});

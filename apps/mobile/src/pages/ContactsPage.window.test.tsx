import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsPage } from './ContactsPage';
import { normalizeFriendRequest } from '../features/social/socialNormalizers';
import { useSocialStore } from '../features/social/socialStore';
import { clearAllScrollPositions, saveListAnchor } from '../app/navigation/scrollRestoration';

vi.mock('../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('../features/social/socialStore', async (original) => {
  const module = await original<typeof import('../features/social/socialStore')>();
  return {
    ...module,
    useSocialStore: Object.assign(
      (select: (state: ReturnType<typeof module.useSocialStore.getState>) => unknown) =>
        select(module.useSocialStore.getState()),
      module.useSocialStore,
    ),
  };
});
function render() {
  return renderToStaticMarkup(<ContactsPage
    activeContactPtid={null} activeOverlay={null}
    onOpenChat={() => undefined} onOpenContact={() => undefined}
    onOpenOverlay={() => undefined} onCloseOverlay={() => undefined}
    onBack={() => undefined}
  />);
}

describe('Contacts bounded surface', () => {
  beforeEach(() => {
    clearAllScrollPositions();
    useSocialStore.setState(useSocialStore.getInitialState(), true);
    useSocialStore.setState({
      currentUserPtid: 'ptid:alice',
      friendRequests: Array.from({ length: 240 }, (_, index) => normalizeFriendRequest({
        requestId: `request-${index}`, senderPtid: 'ptid:alice',
        receiverPtid: `ptid:peer-${index}`, federationId: 'federation',
        receiverDisplayName: `Peer ${String(index).padStart(3, '0')}`, status: 2,
      })),
    });
  });
  it('bounds contacts without suppressing traversal to later accepted peers', () => {
    const html = render();
    expect(html.match(/class="contact-item-row"/g)).toHaveLength(100);
    expect(html).toContain('data-window-total="240"');
    expect(html).toContain('mobile.list.next');
    expect(html).not.toContain('Peer 239');
  });
  it('restores a later contact window after tab remount', () => {
    saveListAnchor('contacts:friends:', 'ptid:peer-140');
    const html = render();
    expect(html.match(/class="contact-item-row"/g)).toHaveLength(100);
    expect(html).toContain('Peer 239');
    expect(html).toContain('mobile.list.previous');
  });
});

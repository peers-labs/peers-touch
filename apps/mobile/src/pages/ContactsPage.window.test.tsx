import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsPage } from './ContactsPage';
import { normalizeFriendRequest } from '../features/social/socialNormalizers';
import { useSocialStore } from '../features/social/socialStore';
import { clearAllScrollPositions, saveListAnchor } from '../app/navigation/scrollRestoration';

const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

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
    expect(html.match(/data-identity-role="person"/g)).toHaveLength(100);
    expect(html).toContain('contact-row-chevron');
    expect(html).toContain('<button class="contact-item-row"');
    expect(html).not.toContain('ant-avatar-square');
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

describe('Contacts short landscape layout', () => {
  it('keeps the empty-state recovery action inside the content viewport', () => {
    const marker = '/* Keep the Contacts recovery action visible above the tabbar on short screens. */';
    const start = styles.indexOf(marker);
    const end = styles.indexOf('/* ── Recovery layer ── */', start);
    const contract = styles.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(contract).toContain('@media (orientation: landscape) and (max-height: 500px)');
    expect(contract).toContain(".page-container[data-product-surface='contacts.list'] .contacts-body");
    expect(contract).toContain('padding-block: 0');
    expect(contract).toContain(".page-container[data-product-surface='contacts.list'] .ant-empty");
    expect(contract).toContain('margin-block: 6px');
    expect(contract).toContain(".page-container[data-product-surface='contacts.list'] .ant-empty-image");
    expect(contract).toContain('height: 24px');
    expect(contract).toContain(".page-container[data-product-surface='contacts.list'] .empty-copy .ant-btn");
    expect(contract).toContain('margin-top: 2px');
  });
});

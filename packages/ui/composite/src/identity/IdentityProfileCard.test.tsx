/**
 * IdentityProfileCard behavior tests.
 *
 * CMP-D07 constraint: NO @testing-library — react-dom/client act() +
 * createRoot only. Covers the three variants, gate data hooks, SurfaceHooks
 * legacy class/attr merging, moment + technical-detail intents, slots and
 * unsafe-link rejection.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { StrictMode, act, type ReactNode } from 'react';
import { IdentityProfileCard } from './IdentityProfileCard';
import type { IdentityProfileCardProps, IdentityProfileModel } from './identity.types';

const baseModel: IdentityProfileModel = {
  displayName: 'Alice',
  isSelf: false,
  avatarSlot: <span data-test-avatar>A</span>,
  handle: { localPart: 'alice', home: 'station.example' },
  stationLines: ['Home Station'],
  bio: 'hello',
};

const makeProps = (partial: Partial<IdentityProfileCardProps> = {}): IdentityProfileCardProps => ({
  variant: 'author',
  profile: baseModel,
  intents: {
    onCopyTechnical: vi.fn(),
    onOpenMoment: vi.fn(),
    onOpenProfile: vi.fn(),
  },
  t: (key: string) => key,
  ...partial,
});

let container: HTMLDivElement;

afterEach(() => {
  if (container.isConnected) {
    act(() => { container.parentElement?.removeChild(container); });
  }
  document.body.innerHTML = '';
});

function mount(node: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<StrictMode>{node}</StrictMode>); });
  return container;
}

describe('IdentityProfileCard — variants', () => {
  it('renders self / author / sheet grammar classes', () => {
    for (const variant of ['self', 'author', 'sheet'] as const) {
      const c = mount(<IdentityProfileCard {...makeProps({ variant })} />);
      expect(c.querySelector(`.ptc-profile-card--${variant}`)).not.toBeNull();
    }
  });

  it('places the host avatarSlot inside the avatar region', () => {
    const c = mount(<IdentityProfileCard {...makeProps()} />);
    expect(c.querySelector('[data-test-avatar]')).not.toBeNull();
    expect(c.querySelector('.ptc-profile-avatar')?.textContent).toContain('A');
  });
});

describe('IdentityProfileCard — production gate data hooks', () => {
  it('projects avatar identity markers onto the root', () => {
    const c = mount(
      <IdentityProfileCard
        {...makeProps({
          profile: { ...baseModel, avatarPtid: 'ptid-1', avatarSrc: 'https://x/a.png' },
        })}
      />,
    );
    const root = c.querySelector('[data-chat-profile-card]') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.dataset.chatAvatarPtid).toBe('ptid-1');
    expect(root.dataset.chatAvatarSrc).toBe('https://x/a.png');
  });

  it('self variant marks banner image vs gradient', () => {
    const withImage = mount(
      <IdentityProfileCard {...makeProps({ variant: 'self', profile: { ...baseModel, isSelf: true, headerImage: 'https://x/h.png' } })} />,
    );
    expect(withImage.querySelector('[data-chat-profile-banner="image"]')).not.toBeNull();
    const gradient = mount(
      <IdentityProfileCard {...makeProps({ variant: 'self', profile: { ...baseModel, isSelf: true } })} />,
    );
    expect(gradient.querySelector('[data-chat-profile-banner="gradient"]')).not.toBeNull();
  });

  it('renders relation and technical-detail gate hooks with copy intent', () => {
    const onCopyTechnical = vi.fn();
    const c = mount(
      <IdentityProfileCard
        {...makeProps({
          intents: { onCopyTechnical },
          profile: {
            ...baseModel,
            relation: { label: 'Friend', tone: 'success' },
            technicalDetailsLabel: 'Identity',
            technicalDetails: [{
              id: 'actor-ptid', label: 'PTID', value: 'ptid-xyz',
              copyLabel: 'Copy', copiedLabel: 'Copied', copyFailedLabel: 'Failed',
            }],
          },
        })}
      />,
    );
    expect(c.querySelector('[data-chat-profile-relation="Friend"]')).not.toBeNull();
    expect(c.querySelector('[data-chat-profile-technical-details]')).not.toBeNull();
    const row = c.querySelector('[data-chat-profile-technical-detail="actor-ptid"]');
    expect(row).not.toBeNull();
    const copy = c.querySelector('[data-chat-profile-copy="actor-ptid"]') as HTMLButtonElement;
    act(() => { copy.click(); });
    expect(onCopyTechnical).toHaveBeenCalledWith('actor-ptid');
  });
});

describe('IdentityProfileCard — SurfaceHooks legacy merge', () => {
  it('injects host class names and prototype root data attributes', () => {
    const c = mount(
      <IdentityProfileCard
        {...makeProps()}
        hooks={{
          classNames: { card: 'sk-author-card', moments: 'sk-author-moments' },
          dataAttributes: {
            card: { 'data-author-name': 'Alice', 'data-author-self': 'false', 'data-author-seeded': 'true' },
          },
        }}
      />,
    );
    const root = c.querySelector('.ptc-profile-card') as HTMLElement;
    expect(root.classList.contains('sk-author-card')).toBe(true);
    expect(root.dataset.authorName).toBe('Alice');
    expect(root.dataset.authorSeeded).toBe('true');
  });
});

describe('IdentityProfileCard — moments and slots', () => {
  it('renders the moments strip and fires onOpenMoment', () => {
    const onOpenMoment = vi.fn();
    const c = mount(
      <IdentityProfileCard
        {...makeProps({
          intents: { onOpenMoment },
          profile: {
            ...baseModel,
            moments: [
              { id: 'm1', text: 'first post' },
              { id: 'm2', text: 'second post', image: 'https://x/m.png' },
            ],
          },
        })}
      />,
    );
    const section = c.querySelector('[data-author-moments="2"]');
    expect(section).not.toBeNull();
    const tile = c.querySelector('[data-author-moment="m1"]') as HTMLButtonElement;
    act(() => { tile.click(); });
    expect(onOpenMoment).toHaveBeenCalledWith('m1');
  });

  it('renders the host actionsSlot in the actions region', () => {
    const c = mount(
      <IdentityProfileCard
        {...makeProps()}
        actionsSlot={<button type="button" data-test-action>go</button>}
      />,
    );
    const action = c.querySelector('[data-test-action]');
    expect(action).not.toBeNull();
    expect(c.querySelector('.ptc-profile-actions')?.contains(action)).toBe(true);
  });

  it('drops non-http links', () => {
    const c = mount(
      <IdentityProfileCard
        {...makeProps({
          profile: {
            ...baseModel,
            links: [
              { url: 'https://ok.example' },
              { url: 'javascript:alert(1)' },
            ],
          },
        })}
      />,
    );
    const anchors = Array.from(c.querySelectorAll('.ptc-profile-link'));
    expect(anchors).toHaveLength(1);
    expect((anchors[0] as HTMLAnchorElement).href).toContain('ok.example');
  });
});

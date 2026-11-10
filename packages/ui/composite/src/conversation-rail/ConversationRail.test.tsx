/**
 * ConversationRail behavior tests (react-dom primitives, no @testing-library).
 * Covers pane gate hooks, row data projection, selection/quick/row intents,
 * search tile, tab switch, contacts slot replacement, empty/error states and
 * SurfaceHooks legacy class merging.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { StrictMode, act, type ReactNode } from 'react';
import { UIProvider } from '@peers-touch/ui';
import { ConversationRail } from './ConversationRail';
import type {
  ConversationRailIntents, ConversationRailModel, ConversationRailProps, ConversationRowModel,
} from './conversation-rail.types';

// UIProvider reads prefers-color-scheme through matchMedia, which jsdom lacks.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const rows: ConversationRowModel[] = [
  {
    id: 'c1', kind: 'friend', name: 'Alice', preview: 'hi', timeLabel: '10:00',
    unread: 3, muted: false, pinned: true, online: true,
    avatarSlot: <span data-av> A</span>,
    rowActions: [{ id: 'pin', label: 'Unpin', iconId: 'pin' }],
    quickActions: [{ id: 'mute', iconId: 'bell-off', labelKey: 'rail.mute' }],
    hooks: { 'data-pt-conversation-item': 'c1', 'data-chat-session-ulid': 'c1' },
  },
  {
    id: 'g1', kind: 'group', name: 'Team', preview: '', timeLabel: '09:00',
    unread: 0, muted: true, pinned: false,
    avatarSlot: <span data-av>G</span>,
    rowActions: [],
    quickActions: [],
    hooks: { 'data-chat-group-ulid': 'g1' },
  },
];

const makeModel = (partial: Partial<ConversationRailModel> = {}): ConversationRailModel => ({
  tab: 'chats',
  searchOpen: false,
  searchValue: '',
  recentLabelKey: 'rail.recent',
  searchPlaceholderKey: 'rail.search',
  searchCloseLabelKey: 'rail.cancelSearch',
  rows,
  selectedRowKey: 'c1',
  plusMenuActions: [{ id: 'new-group', label: 'Group', iconId: 'users' }],
  tabLabelKeys: { chats: 'tab.chats', contacts: 'tab.contacts' },
  ...partial,
});

const makeIntents = (): ConversationRailIntents => ({
  onTabChange: vi.fn(),
  onOpenSearch: vi.fn(),
  onCloseSearch: vi.fn(),
  onSearchChange: vi.fn(),
  onSelectRow: vi.fn(),
  onQuickAction: vi.fn(),
  onRowAction: vi.fn(),
  onRetry: vi.fn(),
});

const makeProps = (partial: Partial<ConversationRailProps> = {}): ConversationRailProps => ({
  model: makeModel(),
  intents: makeIntents(),
  t: (key: string) => key,
  ...partial,
});

let container: HTMLDivElement;

afterEach(() => {
  if (container.isConnected) act(() => { container.parentElement?.removeChild(container); });
  document.body.innerHTML = '';
});

function mount(node: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(<StrictMode><UIProvider>{node}</UIProvider></StrictMode>); });
  return container;
}

describe('ConversationRail — pane and rows', () => {
  it('renders the pane gate hook and tab/search state', () => {
    const c = mount(<ConversationRail {...makeProps()} />);
    const pane = c.querySelector('[data-chat-conversation-pane]') as HTMLElement;
    expect(pane).not.toBeNull();
    expect(pane.dataset.railTab).toBe('chats');
    expect(pane.dataset.railSearch).toBe('idle');
  });

  it('projects row gate hooks, presence, unread and pinned flags', () => {
    const c = mount(<ConversationRail {...makeProps()} />);
    const item = c.querySelector('[data-pt-conversation-item="c1"]') as HTMLElement;
    expect(item).not.toBeNull();
    expect(item.dataset.pinned).toBe('true');
    expect(c.querySelector('[data-chat-group-ulid="g1"]')).not.toBeNull();
    expect(c.querySelector('[data-presence="online"]')).not.toBeNull();
    const unread = c.querySelector('[data-unread="3"]');
    expect(unread).not.toBeNull();
    expect(c.querySelector('[data-session-count="2"]')).not.toBeNull();
  });

  it('places host avatarSlot nodes inside row avatar regions', () => {
    const c = mount(<ConversationRail {...makeProps()} />);
    expect(c.querySelectorAll('[data-av]')).toHaveLength(2);
  });
});

describe('ConversationRail — intents', () => {
  it('fires onSelectRow when a row button is clicked', () => {
    const intents = makeIntents();
    const c = mount(<ConversationRail {...makeProps({ intents })} />);
    const rowBtn = c.querySelector('.ptc-conv-row') as HTMLButtonElement;
    act(() => { rowBtn.click(); });
    expect(intents.onSelectRow).toHaveBeenCalledWith('c1');
  });

  it('fires onQuickAction with row key and action id', () => {
    const intents = makeIntents();
    const c = mount(<ConversationRail {...makeProps({ intents })} />);
    const quick = c.querySelector('[data-row-action="mute"]') as HTMLButtonElement;
    act(() => { quick.click(); });
    expect(intents.onQuickAction).toHaveBeenCalledWith('c1', 'mute');
  });

  it('fires onTabChange via the segmented control', () => {
    const intents = makeIntents();
    const c = mount(<ConversationRail {...makeProps({ intents })} />);
    // Segmented renders the contacts option as a clickable control.
    const options = c.querySelectorAll('button');
    const contacts = Array.from(options).find(b => b.textContent?.includes('tab.contacts'));
    if (contacts) act(() => { contacts.click(); });
    expect(intents.onTabChange).toHaveBeenCalled();
  });

  it('opens search and routes change/close intents', () => {
    const intents = makeIntents();
    const c = mount(<ConversationRail {...makeProps({ intents })} />);
    const trigger = c.querySelector('[data-rail-search-trigger]') as HTMLButtonElement;
    act(() => { trigger.click(); });
    expect(intents.onOpenSearch).toHaveBeenCalled();

    const openIntents = makeIntents();
    const c2 = mount(<ConversationRail {...makeProps({
      intents: openIntents,
      model: makeModel({ searchOpen: true, searchValue: 'ali' }),
    })} />);
    expect(c2.querySelector('[data-rail-search-value="ali"]')).not.toBeNull();
    const close = c2.querySelector('[data-action-id="chat.rail-search-close"]') as HTMLButtonElement;
    act(() => { close.click(); });
    expect(openIntents.onCloseSearch).toHaveBeenCalled();
  });
});

describe('ConversationRail — slots and states', () => {
  it('replaces the body with contactsSlot on the contacts tab', () => {
    const c = mount(
      <ConversationRail
        {...makeProps({
          model: makeModel({ tab: 'contacts' }),
          slots: { contactsSlot: <div data-contacts>contacts</div> },
        })}
      />,
    );
    expect(c.querySelector('[data-contacts]')).not.toBeNull();
    expect(c.querySelector('.ptc-conv-list')).toBeNull();
  });

  it('renders empty and error containers from the model', () => {
    const emptyProps = makeProps({ model: makeModel({ rows: [], emptyKey: 'rail.empty' }) });
    const empty = mount(<ConversationRail {...emptyProps} />);
    expect(empty.querySelector('.ptc-conv-empty')).not.toBeNull();

    const errorProps = makeProps({
      model: makeModel({ rows: [], error: { titleKey: 'rail.error', retryLabelKey: 'rail.retry', mode: 'blocking' } }),
    });
    const error = mount(<ConversationRail {...errorProps} />);
    expect(error.querySelector('[data-chat-session-list-error-mode="blocking"]')).not.toBeNull();
    expect(error.querySelector('[data-chat-session-list-retry]')).not.toBeNull();
  });

  it('merges host legacy class names through SurfaceHooks', () => {
    const c = mount(
      <ConversationRail
        {...makeProps({
          hooks: { classNames: { pane: 'sc-sessions', row: 'sc-session-row' } },
        })}
      />,
    );
    expect(c.querySelector('.sc-sessions')).not.toBeNull();
    expect(c.querySelector('.sc-session-row')).not.toBeNull();
  });
});

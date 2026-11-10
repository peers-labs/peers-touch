import { useCallback, useEffect, useRef, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@peers-touch/ui';
import { useCommandMenuStore } from '../store/commandMenu';
import { useCommandMenuItems } from '../hooks/useCommandMenuItems';
import type { CommandItem, CommandItemType } from '../store/commandMenu';
import type { Page } from '../types/navigation';
import './search/SearchOverlay.css';
import './CommandMenu.css';

// Command items carry PascalCase lucide names from useCommandMenuItems; map
// them onto the Peers glyph set so the directory matches the search palette.
type GlyphId = ComponentProps<typeof Icon>['iconId'];
const GLYPH_MAP: Record<string, GlyphId> = {
  Home: 'house',
  MessageSquare: 'message-square',
  MessagesSquare: 'messages-square',
  Bot: 'bot',
  Settings: 'settings',
  UserCircle: 'user-round',
  Users: 'users',
  FileText: 'file-text',
  Plus: 'plus',
  PlusCircle: 'user-plus',
  Compass: 'compass',
};

interface CommandMenuProps {
  navigateTo: (page: Page) => void;
  navigateToAgentSurface: (agentName: string, surface: 'chat' | 'profile') => void;
  navigateToSettings: (tab: string) => void;
}

export function CommandMenu({ navigateTo, navigateToAgentSurface, navigateToSettings }: CommandMenuProps) {
  const { t } = useTranslation('agent');
  const open = useCommandMenuStore((s) => s.open);
  const query = useCommandMenuStore((s) => s.query);
  const selectedIndex = useCommandMenuStore((s) => s.selectedIndex);
  const closeMenu = useCommandMenuStore((s) => s.closeMenu);
  const setQuery = useCommandMenuStore((s) => s.setQuery);
  const setSelectedIndex = useCommandMenuStore((s) => s.setSelectedIndex);
  const executeCommand = useCommandMenuStore((s) => s.executeCommand);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const grouped = useCommandMenuItems({ navigateTo, navigateToAgentSurface, navigateToSettings });

  // Build flat list for keyboard navigation
  const flatItems: CommandItem[] = [
    ...grouped.pages,
    ...grouped.agents,
    ...grouped.topics,
    ...grouped.actions,
  ];

  const totalCount = flatItems.length;

  // Auto-focus the input when the palette opens
  useEffect(() => {
    if (open) {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 16);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = selectedIndex < totalCount - 1 ? selectedIndex + 1 : 0;
          setSelectedIndex(next);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = selectedIndex > 0 ? selectedIndex - 1 : totalCount - 1;
          setSelectedIndex(prev);
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const item = flatItems[selectedIndex];
          if (item) executeCommand(item);
          break;
        }
        case 'Escape': {
          e.preventDefault();
          closeMenu();
          break;
        }
      }
    },
    [selectedIndex, totalCount, flatItems, setSelectedIndex, executeCommand, closeMenu],
  );

  const groupLabel = (type: CommandItemType): string => {
    const keyMap: Record<CommandItemType, string> = {
      page: 'agent.commandMenu.pages',
      agent: 'agent.commandMenu.agents',
      topic: 'agent.commandMenu.topics',
      action: 'agent.commandMenu.actions',
    };
    return t(keyMap[type]);
  };

  const renderGroup = (items: CommandItem[], type: CommandItemType, startIdx: number) => {
    if (items.length === 0) return null;
    return (
      <div key={type} className="pt-search-group">
        <div className="pt-search-group-title">{groupLabel(type)}</div>
        <div className="pt-search-list">
          {items.map((item, idx) => {
            const globalIdx = startIdx + idx;
            const isSelected = globalIdx === selectedIndex;
            return (
              <div
                key={item.id}
                className={isSelected ? 'pt-search-row active' : 'pt-search-row'}
                data-selected={isSelected}
              >
                <button
                  type="button"
                  className="pt-search-row-target"
                  onClick={() => executeCommand(item)}
                  onMouseEnter={() => setSelectedIndex(globalIdx)}
                >
                  <span className="pt-search-row-icon">
                    <Icon iconId={GLYPH_MAP[item.icon ?? ''] ?? 'file-text'} size={15} />
                  </span>
                  <span className="pt-search-main">
                    <span className="pt-search-title">{item.title}</span>
                    {item.subtitle && (
                      <span className="pt-search-snippet">{item.subtitle}</span>
                    )}
                  </span>
                  {type === 'page' && getShortcutHint(item.id) && (
                    <span className="pt-command-hint-chip">{getShortcutHint(item.id)}</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Calculate start indices for each group
  let offset = 0;
  const pagesStart = offset;
  offset += grouped.pages.length;
  const agentsStart = offset;
  offset += grouped.agents.length;
  const topicsStart = offset;
  offset += grouped.topics.length;
  const actionsStart = offset;

  if (!open) return null;

  return (
    <div
      className="pt-search-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('agent.commandMenu.placeholder')}
    >
      <div className="pt-search-scrim" onClick={closeMenu} />
      <div className="pt-search-panel pt-command-panel">
        <div className="pt-search-field-area">
          <div className="pt-search-field">
            <Icon iconId="search" size={16} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('agent.commandMenu.placeholder')}
              aria-label={t('agent.commandMenu.placeholder')}
            />
            <span className="pt-command-kbd">
              <Icon iconId="command" size={11} />
              <span>⇧K</span>
            </span>
          </div>
        </div>

        <div ref={listRef} className="pt-search-body">
          {totalCount === 0 ? (
            <div className="pt-search-empty">{t('agent.commandMenu.noResults')}</div>
          ) : (
            <>
              {renderGroup(grouped.pages, 'page', pagesStart)}
              {renderGroup(grouped.agents, 'agent', agentsStart)}
              {renderGroup(grouped.topics, 'topic', topicsStart)}
              {renderGroup(grouped.actions, 'action', actionsStart)}
            </>
          )}
        </div>

        <div className="pt-search-footer">
          <span className="pt-command-foot">
            <kbd>↑↓</kbd>
            {t('agent.commandMenu.navigate')}
          </span>
          <span className="pt-command-foot">
            <kbd>↵</kbd>
            {t('agent.commandMenu.select')}
          </span>
          <span className="pt-command-foot">
            <kbd>{t('agent.commandMenu.escapeKey')}</kbd>
            {t('agent.commandMenu.close')}
          </span>
        </div>
      </div>
    </div>
  );
}

function getShortcutHint(pageId: string): string {
  const hints: Record<string, string> = {
    'page:home': '⌘1',
    'page:chat': '⌘2',
    'page:settings': '⌘,',
  };
  return hints[pageId] ?? '';
}

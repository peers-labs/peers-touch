import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Modal, theme } from 'antd';
import {
  Search,
  Home,
  MessageSquare,
  Bot,
  Settings,
  FileText,
  FlaskConical,
  UserCircle,
  Network,
  Users,
  Store,
  Puzzle,
  Plus,
  PlusCircle,
  MessagesSquare,
  Command,
  type LucideIcon,
} from 'lucide-react';

import { useCommandMenuStore } from '../store/commandMenu';
import { useCommandMenuItems } from '../hooks/useCommandMenuItems';
import type { CommandItem, CommandItemType } from '../store/commandMenu';
import type { Page } from '../types/navigation';

const ICON_MAP: Record<string, LucideIcon> = {
  Home,
  MessageSquare,
  Bot,
  Settings,
  Search,
  FileText,
  FlaskConical,
  UserCircle,
  Network,
  Users,
  Store,
  Puzzle,
  Plus,
  PlusCircle,
  MessagesSquare,
  Command,
};

interface CommandMenuProps {
  navigateTo: (page: Page) => void;
  navigateToAgentSurface: (agentName: string, surface: 'chat' | 'profile') => void;
  navigateToSettings: (tab: string) => void;
}

export function CommandMenu({ navigateTo, navigateToAgentSurface, navigateToSettings }: CommandMenuProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
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

  // Auto-focus the input when modal opens
  useEffect(() => {
    if (open) {
      // Allow the modal animation to complete before focusing
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
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
      <Flexbox key={type} gap={2}>
        <Flexbox
          style={{
            padding: '6px 12px 4px',
            fontSize: 11,
            fontWeight: 600,
            color: token.colorTextTertiary,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {groupLabel(type)}
        </Flexbox>
        {items.map((item, idx) => {
          const globalIdx = startIdx + idx;
          const isSelected = globalIdx === selectedIndex;
          const IconComponent = ICON_MAP[item.icon ?? ''] ?? FileText;
          return (
            <Flexbox
              key={item.id}
              horizontal
              align="center"
              gap={10}
              data-selected={isSelected}
              onClick={() => executeCommand(item)}
              onMouseEnter={() => setSelectedIndex(globalIdx)}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                background: isSelected ? token.colorFillSecondary : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              <IconComponent size={16} color={token.colorTextSecondary} />
              <Flexbox flex={1} style={{ minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 13,
                    color: token.colorText,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.title}
                </span>
                {item.subtitle && (
                  <span
                    style={{
                      fontSize: 11,
                      color: token.colorTextTertiary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.subtitle}
                  </span>
                )}
              </Flexbox>
              {type === 'page' && (
                <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>
                  {getShortcutHint(item.id)}
                </span>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
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

  return (
    <Modal
      open={open}
      onCancel={closeMenu}
      footer={null}
      closable={false}
      centered
      width={560}
      destroyOnClose
      styles={{
        body: {
          padding: 0,
        },
        mask: {
          backdropFilter: 'blur(2px)',
        },
      }}
      style={{
        borderRadius: 12,
      }}
      className="command-menu-modal"
    >
      <Flexbox style={{ maxHeight: '70vh' }}>
        {/* Search input */}
        <Flexbox
          horizontal
          align="center"
          gap={8}
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Search size={16} color={token.colorTextTertiary} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('agent.commandMenu.placeholder')}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 14,
              color: token.colorText,
              lineHeight: '22px',
            }}
          />
          <Flexbox
            horizontal
            align="center"
            gap={2}
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              background: token.colorFillTertiary,
              fontSize: 11,
              color: token.colorTextTertiary,
            }}
          >
            <Command size={11} />
            <span>K</span>
          </Flexbox>
        </Flexbox>

        {/* Results list */}
        <Flexbox
          ref={listRef}
          gap={4}
          style={{
            padding: '8px',
            overflowY: 'auto',
            maxHeight: 'calc(70vh - 50px)',
          }}
        >
          {totalCount === 0 ? (
            <Flexbox
              align="center"
              justify="center"
              style={{
                padding: '24px 16px',
                color: token.colorTextTertiary,
                fontSize: 13,
              }}
            >
              {t('agent.commandMenu.noResults')}
            </Flexbox>
          ) : (
            <>
              {renderGroup(grouped.pages, 'page', pagesStart)}
              {renderGroup(grouped.agents, 'agent', agentsStart)}
              {renderGroup(grouped.topics, 'topic', topicsStart)}
              {renderGroup(grouped.actions, 'action', actionsStart)}
            </>
          )}
        </Flexbox>

        {/* Footer hint */}
        <Flexbox
          horizontal
          align="center"
          justify="center"
          gap={16}
          style={{
            padding: '8px 16px',
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            fontSize: 11,
            color: token.colorTextQuaternary,
          }}
        >
          <span>↑↓ {t('agent.commandMenu.navigate')}</span>
          <span>↵ {t('agent.commandMenu.select')}</span>
          <span>esc {t('agent.commandMenu.close')}</span>
        </Flexbox>
      </Flexbox>
    </Modal>
  );
}

function getShortcutHint(pageId: string): string {
  const hints: Record<string, string> = {
    'page:home': '⌘1',
    'page:chat': '⌘2',
    'page:search': '⌘3',
    'page:settings': '⌘,',
  };
  return hints[pageId] ?? '';
}

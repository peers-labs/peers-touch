import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';

const MAX_RECENT_COMMANDS = 5;
const RECENT_COMMANDS_STORAGE_KEY = 'commandMenu.recentCommands';

export type CommandItemType = 'page' | 'agent' | 'topic' | 'action';

export interface CommandItem {
  id: string;
  type: CommandItemType;
  title: string;
  subtitle?: string;
  icon?: string;
  action: () => void;
}

interface CommandMenuState {
  open: boolean;
  query: string;
  selectedIndex: number;
  recentCommands: string[];
}

interface CommandMenuActions {
  toggle: () => void;
  openMenu: () => void;
  closeMenu: () => void;
  setQuery: (query: string) => void;
  setSelectedIndex: (index: number) => void;
  executeCommand: (item: CommandItem) => void;
  addRecentCommand: (commandId: string) => void;
}

type CommandMenuStore = CommandMenuState & CommandMenuActions;

function loadRecentCommands(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_COMMANDS_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT_COMMANDS);
  } catch {
    return [];
  }
}

function persistRecentCommands(commands: string[]): void {
  try {
    localStorage.setItem(RECENT_COMMANDS_STORAGE_KEY, JSON.stringify(commands));
  } catch {
    log.warn('commandMenu', 'Failed to persist recent commands');
  }
}

export const useCommandMenuStore = createDesktopStore<CommandMenuStore>('commandMenu', (set, get) => ({
  open: false,
  query: '',
  selectedIndex: 0,
  recentCommands: loadRecentCommands(),

  toggle: () => {
    const { open } = get();
    if (open) {
      set({ open: false, query: '', selectedIndex: 0 });
    } else {
      set({ open: true, query: '', selectedIndex: 0 });
    }
  },

  openMenu: () => {
    set({ open: true, query: '', selectedIndex: 0 });
  },

  closeMenu: () => {
    set({ open: false, query: '', selectedIndex: 0 });
  },

  setQuery: (query: string) => {
    set({ query, selectedIndex: 0 });
  },

  setSelectedIndex: (index: number) => {
    set({ selectedIndex: index });
  },

  executeCommand: (item: CommandItem) => {
    item.action();
    get().addRecentCommand(item.id);
    set({ open: false, query: '', selectedIndex: 0 });
  },

  addRecentCommand: (commandId: string) => {
    const { recentCommands } = get();
    const updated = [commandId, ...recentCommands.filter((id) => id !== commandId)].slice(0, MAX_RECENT_COMMANDS);
    set({ recentCommands: updated });
    persistRecentCommands(updated);
  },
}));

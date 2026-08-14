import { createDesktopStore } from './createDesktopStore';

// Terminal line represents a single output entry in the inline terminal
export interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'system';
  content: string;
  timestamp: number;
}

export interface ChatTerminalState {
  visible: boolean;
  height: number;
  lines: TerminalLine[];
  inputValue: string;
  history: string[];
  historyIndex: number;
}

export interface ChatTerminalActions {
  toggle: () => void;
  show: () => void;
  hide: () => void;
  setHeight: (height: number) => void;
  executeCommand: (command: string) => void;
  addLine: (line: Omit<TerminalLine, 'id' | 'timestamp'>) => void;
  clearLines: () => void;
  setInputValue: (value: string) => void;
  navigateHistory: (direction: 'up' | 'down') => void;
  getOutputAsContext: () => string;
}

type ChatTerminalStore = ChatTerminalState & ChatTerminalActions;

const STORAGE_KEY = 'peers-chat-terminal-history';
const MAX_HISTORY = 100;
const MAX_LINES = 500;
const CONTEXT_LINE_LIMIT = 50;

function generateLineId(): string {
  return `ln-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.slice(-MAX_HISTORY) as string[];
    return [];
  } catch {
    return [];
  }
}

function persistHistory(history: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
    // Storage quota exceeded — silently ignore
  }
}

export const useChatTerminalStore = createDesktopStore<ChatTerminalStore>(
  'chatTerminal',
  (set, get) => ({
    // State
    visible: false,
    height: 220,
    lines: [],
    inputValue: '',
    history: loadHistory(),
    historyIndex: -1,

    // Actions
    toggle: () => set((s) => ({ visible: !s.visible })),
    show: () => set({ visible: true }),
    hide: () => set({ visible: false }),

    setHeight: (height: number) => {
      const clamped = Math.max(120, Math.min(500, height));
      set({ height: clamped });
    },

    executeCommand: (command: string) => {
      const trimmed = command.trim();
      if (!trimmed) return;

      const { history } = get();

      // Add input line
      const inputLine: TerminalLine = {
        id: generateLineId(),
        type: 'input',
        content: trimmed,
        timestamp: Date.now(),
      };

      // Update history (deduplicate last entry)
      const updatedHistory =
        history[history.length - 1] === trimmed
          ? history
          : [...history, trimmed].slice(-MAX_HISTORY);

      persistHistory(updatedHistory);

      // In v1 display mode: show system message indicating command is forwarded
      const systemLine: TerminalLine = {
        id: generateLineId(),
        type: 'system',
        content: `[forwarded to agent as /run ${trimmed}]`,
        timestamp: Date.now(),
      };

      set((s) => ({
        lines: [...s.lines, inputLine, systemLine].slice(-MAX_LINES),
        inputValue: '',
        history: updatedHistory,
        historyIndex: -1,
      }));
    },

    addLine: (line) => {
      const fullLine: TerminalLine = {
        ...line,
        id: generateLineId(),
        timestamp: Date.now(),
      };
      set((s) => ({
        lines: [...s.lines, fullLine].slice(-MAX_LINES),
      }));
    },

    clearLines: () => set({ lines: [] }),

    setInputValue: (value: string) => set({ inputValue: value, historyIndex: -1 }),

    navigateHistory: (direction: 'up' | 'down') => {
      const { history, historyIndex } = get();
      if (history.length === 0) return;

      let nextIndex: number;
      if (direction === 'up') {
        nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      } else {
        nextIndex = historyIndex === -1 ? -1 : historyIndex + 1;
        if (nextIndex >= history.length) nextIndex = -1;
      }

      const value = nextIndex === -1 ? '' : (history[nextIndex] ?? '');
      set({ historyIndex: nextIndex, inputValue: value });
    },

    getOutputAsContext: () => {
      const { lines } = get();
      const recent = lines.slice(-CONTEXT_LINE_LIMIT);
      return recent
        .map((ln) => {
          switch (ln.type) {
            case 'input':
              return `$ ${ln.content}`;
            case 'output':
              return ln.content;
            case 'error':
              return `[ERROR] ${ln.content}`;
            case 'system':
              return `[SYSTEM] ${ln.content}`;
          }
        })
        .join('\n');
    },
  }),
);

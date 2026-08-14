import { useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { Flexbox } from 'react-layout-kit';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { X, Trash2, Copy } from 'lucide-react';
import { ActionIcon } from '@lobehub/ui';
import { useChatTerminalStore, type TerminalLine } from '../../store/chatTerminal';
import { useChatStore } from '../../store/chat';

const MONOSPACE_FAMILY = "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Monaco, Consolas, monospace";
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 500;

export function ChatTerminalPanel() {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  const visible = useChatTerminalStore((s) => s.visible);
  const height = useChatTerminalStore((s) => s.height);
  const lines = useChatTerminalStore((s) => s.lines);
  const inputValue = useChatTerminalStore((s) => s.inputValue);
  const setInputValue = useChatTerminalStore((s) => s.setInputValue);
  const executeCommand = useChatTerminalStore((s) => s.executeCommand);
  const navigateHistory = useChatTerminalStore((s) => s.navigateHistory);
  const clearLines = useChatTerminalStore((s) => s.clearLines);
  const hide = useChatTerminalStore((s) => s.hide);
  const setHeight = useChatTerminalStore((s) => s.setHeight);
  const getOutputAsContext = useChatTerminalStore((s) => s.getOutputAsContext);

  const sendMessage = useChatStore((s) => s.sendMessage);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  // Auto-scroll to bottom on new lines
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input when panel becomes visible
  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const trimmed = inputValue.trim();
        if (!trimmed) return;

        // Forward command to agent chat as /run prefix
        executeCommand(trimmed);
        sendMessage(`/run ${trimmed}`);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateHistory('up');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateHistory('down');
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        clearLines();
      }
    },
    [inputValue, executeCommand, sendMessage, navigateHistory, clearLines],
  );

  const handleCopyOutput = useCallback(() => {
    const output = getOutputAsContext();
    if (output) {
      navigator.clipboard.writeText(output);
    }
  }, [getOutputAsContext]);

  // Drag resize handlers
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startHeight: height };

      const handleMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = dragRef.current.startY - ev.clientY;
        setHeight(dragRef.current.startHeight + delta);
      };

      const handleUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    },
    [height, setHeight],
  );

  if (!visible) return null;

  return (
    <div
      style={{
        width: '100%',
        height,
        minHeight: MIN_HEIGHT,
        maxHeight: MAX_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        borderTop: `1px solid ${token.colorBorderSecondary}`,
        background: '#1e1e2e',
        borderRadius: '8px 8px 0 0',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        style={{
          height: 6,
          cursor: 'ns-resize',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ width: 36, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.15)' }} />
      </div>

      {/* Header bar */}
      <Flexbox
        horizontal
        align="center"
        gap={8}
        style={{
          padding: '4px 12px',
          flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', fontFamily: MONOSPACE_FAMILY }}>
          {t('agent.terminal.title')}
        </span>
        <div style={{ flex: 1 }} />
        <ActionIcon
          icon={Copy}
          size="small"
          onClick={handleCopyOutput}
          title={t('agent.terminal.copyOutput')}
          style={{ color: 'rgba(255,255,255,0.4)' }}
        />
        <ActionIcon
          icon={Trash2}
          size="small"
          onClick={clearLines}
          title={t('agent.terminal.clear')}
          style={{ color: 'rgba(255,255,255,0.4)' }}
        />
        <ActionIcon
          icon={X}
          size="small"
          onClick={hide}
          title={t('agent.terminal.close')}
          style={{ color: 'rgba(255,255,255,0.4)' }}
        />
      </Flexbox>

      {/* Output area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '8px 12px',
          fontFamily: MONOSPACE_FAMILY,
          fontSize: 12,
          lineHeight: 1.6,
          minHeight: 0,
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', fontSize: 11 }}>
            {t('agent.terminal.noOutput')}
          </div>
        ) : (
          lines.map((line) => <TerminalLineRow key={line.id} line={line} />)
        )}
      </div>

      {/* Input line */}
      <Flexbox
        horizontal
        align="center"
        gap={0}
        style={{
          padding: '6px 12px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#a6e3a1', fontFamily: MONOSPACE_FAMILY, fontSize: 12, marginRight: 6, fontWeight: 600, userSelect: 'none' }}>
          $
        </span>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('agent.terminal.placeholder')}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#cdd6f4',
            fontFamily: MONOSPACE_FAMILY,
            fontSize: 12,
            lineHeight: 1.5,
            caretColor: '#a6e3a1',
          }}
        />
      </Flexbox>
    </div>
  );
}

// Memoized terminal line rendering
function TerminalLineRow({ line }: { line: TerminalLine }) {
  const styleMap: Record<TerminalLine['type'], React.CSSProperties> = {
    input: { color: '#a6e3a1' },
    output: { color: '#cdd6f4' },
    error: { color: '#f38ba8' },
    system: { color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },
  };

  const prefix = line.type === 'input' ? '$ ' : '';

  return (
    <div style={{ ...styleMap[line.type], whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
      {prefix}
      {line.content}
    </div>
  );
}

import type { ReactNode } from 'react';
import { theme } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { ArrowUp, ChevronDown, Image as ImageIcon, Slash, Square } from 'lucide-react';

const COMPOSER_COLORS = {
  border: '#d1d1d1',
  borderSoft: '#ececec',
  primaryDisabled: '#d8d3fb',
  textTertiary: '#9b9b9b',
  toolButtonShadow: '0 1px 4px rgba(15,23,42,0.04)',
} as const;

export interface PromptComposerProps {
  value?: string;
  onChange?: (value: string) => void;
  onSend?: () => void;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  modelLabel?: string;
  modelNode?: ReactNode;
  trailingTools?: ReactNode;
  maxWidth?: number | string;
  minHeight?: number;
  sendDisabled?: boolean;
  density?: 'comfortable' | 'compact';
}

export function PromptComposer({
  value,
  onChange,
  onSend,
  onStop,
  isStreaming = false,
  placeholder = 'Help you write code, debugs, optimize performance and other development work, deliver production-ready code.',
  modelLabel = 'GPT-5.5',
  modelNode,
  trailingTools,
  maxWidth = 1068,
  minHeight,
  sendDisabled = !value,
  density = 'comfortable',
}: PromptComposerProps) {
  const { token } = theme.useToken();
  const compact = density === 'compact';
  const resolvedMinHeight = minHeight ?? (compact ? 92 : 124);
  const toolSize = compact ? 28 : 38;
  const sendSize = compact ? 34 : 42;
  const iconSize = compact ? 13 : 17;
  const sendIconSize = compact ? 16 : 20;
  const modelControl = modelNode ?? (
    <button
      type="button"
      style={{
        height: compact ? 28 : 34,
        border: 0,
        background: 'transparent',
        color: token.colorTextSecondary,
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 3 : 5,
        fontSize: compact ? 13 : 15,
        cursor: 'pointer',
        padding: compact ? '0 4px' : '0 8px',
        maxWidth: '100%',
        lineHeight: 1,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>{modelLabel}</span>
      <ChevronDown size={compact ? 12 : 14} color={COMPOSER_COLORS.textTertiary} style={{ flexShrink: 0 }} />
    </button>
  );

  return (
    <section
      style={{
        width: typeof maxWidth === 'number' ? `min(${maxWidth}px, 100%)` : maxWidth,
        minHeight: resolvedMinHeight,
        margin: '0 auto',
        border: `1px solid ${COMPOSER_COLORS.border}`,
        borderRadius: compact ? 18 : 22,
        background: '#ffffff',
        boxSizing: 'border-box',
        padding: compact ? '12px 14px 10px' : '18px 18px 14px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: compact ? 8 : 14,
      }}
    >
      <style>
        {`
          .pt-prompt-composer-input::placeholder {
            color: ${COMPOSER_COLORS.textTertiary};
            opacity: 1;
            font-weight: 400;
          }
        `}
      </style>
      <textarea
        className="pt-prompt-composer-input"
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !sendDisabled && !isStreaming) {
            event.preventDefault();
            onSend?.();
          }
        }}
        placeholder={placeholder}
        rows={2}
        style={{
          width: '100%',
          minHeight: compact ? 34 : 48,
          maxHeight: 190,
          border: 0,
          outline: 'none',
          resize: 'none',
          color: token.colorText,
          fontSize: compact ? 14 : 16,
          lineHeight: 1.5,
          fontFamily: 'inherit',
          background: 'transparent',
          boxSizing: 'border-box',
          padding: 0,
        }}
      />

      <Flexbox horizontal align="center" gap={compact ? 8 : 16}>
        <Flexbox horizontal align="center" gap={compact ? 8 : 10}>
          <ActionIcon
            icon={Slash}
            title="Slash commands"
            size={{ blockSize: toolSize, size: iconSize }}
            style={{
              borderRadius: toolSize <= 28 ? 8 : 10,
              border: `1px solid ${COMPOSER_COLORS.borderSoft}`,
              background: '#ffffff',
              color: token.colorText,
              boxShadow: COMPOSER_COLORS.toolButtonShadow,
            }}
          />
          <ActionIcon
            icon={ImageIcon}
            title="Add image"
            size={{ blockSize: toolSize, size: iconSize }}
            style={{
              borderRadius: toolSize <= 28 ? 8 : 10,
              border: `1px solid ${COMPOSER_COLORS.borderSoft}`,
              background: '#ffffff',
              color: token.colorText,
              boxShadow: COMPOSER_COLORS.toolButtonShadow,
            }}
          />
        </Flexbox>

        <div style={{ flex: 1, minWidth: compact ? 8 : 20 }} />

        <div style={{ minWidth: 0, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
          {modelControl}
        </div>

        <Flexbox horizontal align="center" gap={compact ? 8 : 18} justify="flex-end">
          {trailingTools}
          {isStreaming ? (
            <ActionIcon
              icon={Square}
              title="Stop"
              onClick={onStop}
              size={{ blockSize: sendSize, size: sendIconSize }}
              style={{
                borderRadius: compact ? 10 : 12,
                background: token.colorError,
                color: '#ffffff',
              }}
            />
          ) : (
            <ActionIcon
              icon={ArrowUp}
              title="Send"
              onClick={() => {
                if (!sendDisabled) onSend?.();
              }}
              size={{ blockSize: sendSize, size: sendIconSize }}
              disabled={sendDisabled}
              style={{
                borderRadius: compact ? 10 : 12,
                background: sendDisabled ? COMPOSER_COLORS.primaryDisabled : token.colorPrimary,
                color: sendDisabled ? COMPOSER_COLORS.textTertiary : '#ffffff',
                cursor: sendDisabled ? 'default' : 'pointer',
              }}
            />
          )}
        </Flexbox>
      </Flexbox>
    </section>
  );
}

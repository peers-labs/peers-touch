import type { ReactNode } from 'react';
import { ArrowUp, Image as ImageIcon, Slash } from 'lucide-react';

const D = {
  text: '#262626',
  textSecondary: '#595959',
  textTertiary: '#9b9b9b',
  border: '#d1d1d1',
  borderSoft: '#ececec',
  fill: '#ffffff',
  fillSubtle: '#fafafa',
  primary: '#6b5bd6',
  primaryDisabled: '#d8d3fb',
} as const;

export interface PromptComposerProps {
  value?: string;
  onChange?: (value: string) => void;
  onSend?: () => void;
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
  placeholder = 'Help you write code, debugs, optimize performance and other development work, deliver production-ready code.',
  modelLabel = 'GPT-5.5',
  modelNode,
  trailingTools,
  maxWidth = 1068,
  minHeight,
  sendDisabled = !value,
  density = 'comfortable',
}: PromptComposerProps) {
  const compact = density === 'compact';
  const resolvedMinHeight = minHeight ?? (compact ? 92 : 124);
  const toolSize = compact ? 28 : 38;
  const sendSize = compact ? 34 : 42;
  const iconSize = compact ? 13 : 17;
  const modelControl = modelNode ?? (
    <button
      style={{
        height: compact ? 28 : 34,
        border: 0,
        background: 'transparent',
        color: D.textSecondary,
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 7,
        fontSize: compact ? 13 : 18,
        cursor: 'pointer',
        padding: compact ? '0 4px' : '0 8px',
        maxWidth: '100%',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{modelLabel}</span>
      <span style={{ fontSize: 17, color: D.textTertiary }}>⌄</span>
    </button>
  );

  return (
    <section
      style={{
        width: typeof maxWidth === 'number' ? `min(${maxWidth}px, 100%)` : maxWidth,
        minHeight: resolvedMinHeight,
        margin: '0 auto',
        border: `1px solid ${D.border}`,
        borderRadius: compact ? 18 : 22,
        background: D.fill,
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
            color: ${D.textTertiary};
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
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !sendDisabled) {
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
          color: D.text,
          fontSize: compact ? 14 : 16,
          lineHeight: 1.5,
          fontFamily: 'inherit',
          background: 'transparent',
          boxSizing: 'border-box',
          padding: 0,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 10 }}>
          <ComposerToolButton title="斜杠命令" size={toolSize}>
            <Slash size={iconSize} strokeWidth={2.1} />
          </ComposerToolButton>
          <ComposerToolButton title="添加图片" size={toolSize}>
            <ImageIcon size={iconSize} strokeWidth={2} />
          </ComposerToolButton>
        </div>

        <div style={{ flex: 1, minWidth: compact ? 8 : 20 }} />

        <div style={{ minWidth: 0, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
          {modelControl}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 8 : 18, justifyContent: 'flex-end' }}>
          {trailingTools}
          <button
            title="发送"
            onClick={() => {
              if (!sendDisabled) onSend?.();
            }}
            style={{
              width: sendSize,
              height: sendSize,
              border: 0,
              borderRadius: compact ? 10 : 12,
              background: sendDisabled ? D.primaryDisabled : D.primary,
              color: sendDisabled ? D.textTertiary : '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: sendDisabled ? 'default' : 'pointer',
              flexShrink: 0,
            }}
          >
            <ArrowUp size={compact ? 16 : 20} strokeWidth={2.1} />
          </button>
        </div>
      </div>
    </section>
  );
}

function ComposerToolButton({ title, children, size }: { title: string; children: ReactNode; size: number }) {
  return (
    <button
      title={title}
      style={{
        width: size,
        height: size,
        border: `1px solid ${D.borderSoft}`,
        borderRadius: size <= 28 ? 8 : 10,
        background: D.fill,
        color: D.text,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: '0 1px 4px rgba(15,23,42,0.04)',
      }}
    >
      {children}
    </button>
  );
}

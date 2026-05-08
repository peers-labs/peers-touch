import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, EmojiPicker, TextArea, Tooltip } from '@lobehub/ui';
import { theme } from 'antd';
import { Paperclip, Send } from 'lucide-react';

type ComposerLayout = 'inline' | 'stacked';

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  onSend: () => void;
  onAttach: () => void;
  canSend: boolean;
  disabled?: boolean;
  sending?: boolean;
  attachDisabled?: boolean;
  attachLoading?: boolean;
  layout?: ComposerLayout;
  placeholder: string;
  attachTitle: string;
  emojiTitle: string;
  sendTitle: string;
  enterMessageTitle: string;
  accessory?: ReactNode;
  showEmoji?: boolean;
  minRows?: number;
  maxRows?: number;
  style?: CSSProperties;
}

export function ChatComposer({
  value,
  onChange,
  onKeyDown,
  onBlur,
  onSend,
  onAttach,
  canSend,
  disabled = false,
  sending = false,
  attachDisabled = false,
  attachLoading = false,
  layout = 'inline',
  placeholder,
  attachTitle,
  emojiTitle,
  sendTitle,
  enterMessageTitle,
  accessory,
  showEmoji = true,
  minRows = 1,
  maxRows = 4,
  style,
}: ChatComposerProps) {
  const { token } = theme.useToken();
  const tools = (
    <Flexbox
      horizontal
      align="center"
      gap={4}
      style={{
        padding: 2,
        borderRadius: 12,
        background: token.colorFillQuaternary,
        flexShrink: 0,
      }}
    >
      <Tooltip title={attachTitle}>
        <Button
          type="text"
          icon={<Paperclip size={18} />}
          aria-label={attachTitle}
          style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0 }}
          onClick={onAttach}
          loading={attachLoading}
          disabled={attachDisabled || disabled}
        />
      </Tooltip>
      {showEmoji && (
        <Tooltip title={emojiTitle}>
          <span style={{ display: 'inline-flex', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <EmojiPicker
              size={36}
              onChange={(emoji) => onChange(value + emoji)}
            />
          </span>
        </Tooltip>
      )}
    </Flexbox>
  );

  const sendButton = (
    <Tooltip title={canSend ? sendTitle : enterMessageTitle}>
      <Button
        type="primary"
        icon={<Send size={16} />}
        aria-label={sendTitle}
        onClick={onSend}
        loading={sending}
        disabled={!canSend}
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          flexShrink: 0,
        }}
      />
    </Tooltip>
  );

  const input = (
    <TextArea
      className="chat-composer-input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      placeholder={placeholder}
      autoSize={{ minRows, maxRows }}
      style={{
        flex: 1,
        minHeight: 38,
        padding: layout === 'inline' ? '8px 2px' : '6px 2px',
        background: 'transparent',
        border: 0,
        boxShadow: 'none',
      }}
      disabled={disabled}
    />
  );

  return (
    <Flexbox gap={10} style={style}>
      {accessory}
      <Flexbox
        gap={layout === 'stacked' ? 8 : 0}
        style={{
          padding: 8,
          borderRadius: 16,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgElevated,
          boxShadow: token.boxShadowTertiary,
        }}
      >
        {layout === 'inline' ? (
          <Flexbox horizontal align="flex-end" gap={10}>
            {tools}
            {input}
            {sendButton}
          </Flexbox>
        ) : (
          <>
            {input}
            <Flexbox horizontal align="center" justify="space-between">
              {tools}
              {sendButton}
            </Flexbox>
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
}

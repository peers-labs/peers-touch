import type { CSSProperties } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ArrowUp, Square } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

const CONTROL_SIZE = 34;

interface SendControlProps {
  isStreaming: boolean;
  disabled: boolean;
  onSend: () => void;
  onStop: () => void;
}

const iconButtonStyle: CSSProperties = {
  width: CONTROL_SIZE,
  height: CONTROL_SIZE,
  borderRadius: 10,
  border: 'none',
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * Send/Stop controls in the composer footer.
 *
 * While a turn is running both controls stay visible as distinct affordances:
 * Stop cancels the running turn, and Send is rendered disabled (single turn
 * owner — a second turn cannot be queued). Keeping separate, labelled
 * controls prevents the previous slot-flip where a second click on the
 * expected send position silently cancelled the running turn.
 */
export function SendControl({ isStreaming, disabled, onSend, onStop }: SendControlProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  if (isStreaming) {
    return (
      <Flexbox horizontal align="center" gap={8} justify="flex-end">
        <button
          type="button"
          aria-label={t('chat.input.stop')}
          title={t('chat.input.stop')}
          data-pt-agent-stop
          onClick={onStop}
          style={{
            ...iconButtonStyle,
            background: token.colorError,
            color: '#ffffff',
            cursor: 'pointer',
          }}
        >
          <Square size={16} />
        </button>
        <button
          type="button"
          aria-label={t('chat.input.send')}
          title={t('chat.input.send')}
          data-pt-agent-composer-send
          disabled
          aria-disabled="true"
          style={{
            ...iconButtonStyle,
            background: token.colorFillTertiary,
            color: token.colorTextQuaternary,
            cursor: 'default',
          }}
        >
          <ArrowUp size={16} />
        </button>
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" gap={8} justify="flex-end">
      <button
        type="button"
        aria-label={t('chat.input.send')}
        title={t('chat.input.send')}
        data-pt-agent-composer-send
        onClick={onSend}
        disabled={disabled}
        aria-disabled={disabled}
        style={{
          ...iconButtonStyle,
          background: disabled ? token.colorFillTertiary : token.colorPrimary,
          color: disabled ? token.colorTextQuaternary : token.colorTextLightSolid,
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <ArrowUp size={16} />
      </button>
    </Flexbox>
  );
}

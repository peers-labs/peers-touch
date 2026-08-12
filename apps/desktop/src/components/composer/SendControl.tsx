import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { ArrowUp, Square } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

const COMPOSER_COLORS = {
  primaryDisabled: '#d8d3fb',
  textTertiary: '#9b9b9b',
} as const;

interface SendControlProps {
  isStreaming: boolean;
  disabled: boolean;
  onSend: () => void;
  onStop: () => void;
}

/**
 * Send/Stop button in the composer footer.
 * Shows a stop icon (red) during streaming, or an arrow-up send icon.
 */
export function SendControl({ isStreaming, disabled, onSend, onStop }: SendControlProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  if (isStreaming) {
    return (
      <Flexbox horizontal align="center" gap={8} justify="flex-end">
        <ActionIcon
          icon={Square}
          onClick={onStop}
          title={t('chat.input.stop')}
          size={{ blockSize: 34, size: 16 }}
          style={{
            borderRadius: 10,
            background: token.colorError,
            color: '#ffffff',
          }}
        />
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" gap={8} justify="flex-end">
      <ActionIcon
        icon={ArrowUp}
        onClick={onSend}
        disabled={disabled}
        title={t('chat.input.send')}
        size={{ blockSize: 34, size: 16 }}
        style={{
          borderRadius: 10,
          background: disabled ? COMPOSER_COLORS.primaryDisabled : token.colorPrimary,
          color: disabled ? COMPOSER_COLORS.textTertiary : '#ffffff',
          cursor: disabled ? 'default' : 'pointer',
        }}
      />
    </Flexbox>
  );
}

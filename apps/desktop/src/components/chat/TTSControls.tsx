/**
 * TTSControls — Inline mini-player that appears when TTS is actively reading a message.
 *
 * Shows pause/resume and stop buttons alongside the message being read aloud.
 * Uses antd design tokens for consistent styling.
 */

import { useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { theme } from 'antd';
import { Pause, Play, Square, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTTSStore } from '../../store/tts';

interface TTSControlsProps {
  messageId: string;
}

export function TTSControls({ messageId }: TTSControlsProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('agent');

  const speaking = useTTSStore((s) => s.speaking);
  const paused = useTTSStore((s) => s.paused);
  const currentMessageId = useTTSStore((s) => s.currentMessageId);
  const pause = useTTSStore((s) => s.pause);
  const resume = useTTSStore((s) => s.resume);
  const stop = useTTSStore((s) => s.stop);

  // Only render if this message is the one currently being read
  if (currentMessageId !== messageId || !speaking) {
    return null;
  }

  const handleTogglePause = useCallback(() => {
    if (paused) {
      resume();
    } else {
      pause();
    }
  }, [paused, pause, resume]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  return (
    <Flexbox
      horizontal
      align="center"
      gap={4}
      style={{
        padding: '4px 8px',
        borderRadius: token.borderRadiusSM,
        background: token.colorFillQuaternary,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Volume2
        size={14}
        style={{
          color: token.colorPrimary,
          animation: paused ? 'none' : 'pulse 1.5s ease-in-out infinite',
        }}
      />
      <span style={{ fontSize: 11, color: token.colorTextSecondary }}>
        {paused ? t('agent.tts.paused') : t('agent.tts.speaking')}
      </span>
      <ActionIcon
        icon={paused ? <Play size={14} /> : <Pause size={14} />}
        size="small"
        title={paused ? t('agent.tts.resume') : t('agent.tts.pause')}
        onClick={handleTogglePause}
      />
      <ActionIcon
        icon={<Square size={14} />}
        size="small"
        title={t('agent.tts.stop')}
        onClick={handleStop}
      />
    </Flexbox>
  );
}

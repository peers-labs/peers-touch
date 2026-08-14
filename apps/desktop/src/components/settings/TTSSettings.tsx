/**
 * TTSSettings — Settings panel for Text-to-Speech preferences.
 *
 * Provides controls for:
 * - Voice selection (from system-available voices)
 * - Speech rate (0.5 - 2.0)
 * - Pitch (0 - 2)
 * - Volume (0 - 1)
 * - Test button to preview current settings
 */

import { useEffect, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { theme, Select, Slider, Button } from 'antd';
import { Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTTSStore } from '../../store/tts';

export function TTSSettings() {
  const { token } = theme.useToken();
  const { t } = useTranslation('agent');

  const voice = useTTSStore((s) => s.voice);
  const rate = useTTSStore((s) => s.rate);
  const pitch = useTTSStore((s) => s.pitch);
  const volume = useTTSStore((s) => s.volume);
  const availableVoices = useTTSStore((s) => s.availableVoices);
  const setVoice = useTTSStore((s) => s.setVoice);
  const setRate = useTTSStore((s) => s.setRate);
  const setPitch = useTTSStore((s) => s.setPitch);
  const setVolume = useTTSStore((s) => s.setVolume);
  const loadVoices = useTTSStore((s) => s.loadVoices);
  const speak = useTTSStore((s) => s.speak);

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  const voiceOptions = availableVoices.map((v) => ({
    label: `${v.name} (${v.lang})`,
    value: v.name,
  }));

  const handleTest = useCallback(() => {
    speak('__tts_test__', t('agent.tts.testSample'));
  }, [speak, t]);

  return (
    <Flexbox gap={16} style={{ padding: 16 }}>
      {/* Title */}
      <Flexbox horizontal align="center" gap={8}>
        <Volume2 size={18} style={{ color: token.colorPrimary }} />
        <span style={{ fontSize: 15, fontWeight: 600, color: token.colorText }}>
          {t('agent.tts.title')}
        </span>
      </Flexbox>

      {/* Voice selection */}
      <Flexbox gap={6}>
        <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
          {t('agent.tts.voice')}
        </span>
        {availableVoices.length > 0 ? (
          <Select
            value={voice || undefined}
            placeholder={t('agent.tts.voice')}
            options={voiceOptions}
            onChange={setVoice}
            showSearch
            style={{ width: '100%' }}
          />
        ) : (
          <span style={{ fontSize: 12, color: token.colorTextQuaternary }}>
            {t('agent.tts.noVoices')}
          </span>
        )}
      </Flexbox>

      {/* Rate */}
      <Flexbox gap={6}>
        <Flexbox horizontal align="center" justify="space-between">
          <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
            {t('agent.tts.rate')}
          </span>
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{rate.toFixed(1)}x</span>
        </Flexbox>
        <Slider
          min={0.5}
          max={2.0}
          step={0.1}
          value={rate}
          onChange={setRate}
        />
      </Flexbox>

      {/* Pitch */}
      <Flexbox gap={6}>
        <Flexbox horizontal align="center" justify="space-between">
          <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
            {t('agent.tts.pitch')}
          </span>
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{pitch.toFixed(1)}</span>
        </Flexbox>
        <Slider
          min={0}
          max={2}
          step={0.1}
          value={pitch}
          onChange={setPitch}
        />
      </Flexbox>

      {/* Volume */}
      <Flexbox gap={6}>
        <Flexbox horizontal align="center" justify="space-between">
          <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
            {t('agent.tts.volume')}
          </span>
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
            {Math.round(volume * 100)}%
          </span>
        </Flexbox>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={setVolume}
        />
      </Flexbox>

      {/* Test */}
      <Button
        type="default"
        icon={<Volume2 size={14} />}
        onClick={handleTest}
        style={{ alignSelf: 'flex-start' }}
      >
        {t('agent.tts.test')}
      </Button>
    </Flexbox>
  );
}

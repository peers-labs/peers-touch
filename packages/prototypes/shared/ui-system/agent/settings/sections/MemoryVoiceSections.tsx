/**
 * Memory + Voice sections.
 *
 * Memory mirrors the production embedding/backend/weight configuration; the
 * weight uses the library Slider primitive (no hand-rolled range). Voice is
 * STT-only parity (TTS playback was removed in production): provider,
 * recognition language and auto-stop.
 */
import { useState } from 'react';
import { Button, Flex, Segmented, Select, Slider, Switch, Text } from '@peers-touch/ui';
import { makeTranslate, usePrefs, type StringKey } from '../../../prefs';
import { SettingsRow, SettingsSection } from '../SettingsPrimitives';
import type { MemoryBackend, SttLanguage, SttProvider } from '../types';

export function MemorySection() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [enabled, setEnabled] = useState(true);
  const [backend, setBackend] = useState<MemoryBackend>('sqlite');
  const [vectorWeight, setVectorWeight] = useState(70);

  return (
    <Flex direction="column" gap={12}>
      <SettingsSection iconId="brain" title={t('agent.ai.memory.title')}
        subtitle={t('agent.ai.memory.subtitle')} testId="memory-core">
        <SettingsRow label={t('agent.ai.memory.enable')} description={t('agent.ai.memory.enableDesc')}>
          <Switch checked={enabled} label={t('agent.ai.memory.enable')}
            data-pt-memory="enabled" onCheckedChange={setEnabled} />
        </SettingsRow>
        <SettingsRow label={t('agent.ai.memory.embedding')} description={t('agent.ai.memory.embeddingDesc')}>
          <Select
            aria-label={t('agent.ai.memory.embedding')}
            defaultValue="text-embedding-3"
            options={[
              { value: 'text-embedding-3', label: 'text-embedding-3' },
              { value: 'nomic-embed-text', label: 'nomic-embed-text' },
            ]}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection iconId="hard-drive" title={t('agent.ai.memory.backend')}
        subtitle={t('agent.ai.memory.backendDesc')} testId="memory-backend">
        <SettingsRow label={t('agent.ai.memory.backend')}>
          <Segmented<MemoryBackend>
            value={backend}
            options={[
              { value: 'sqlite', label: 'SQLite' },
              { value: 'postgres', label: 'PostgreSQL' },
            ]}
            onValueChange={value => setBackend(value ?? 'sqlite')}
          />
        </SettingsRow>
        {backend === 'postgres' && (
          <Flex direction="row" gap={6} className="pa-memory__dsn">
            <Select
              aria-label={t('agent.ai.memory.dsnPreset')}
              defaultValue="local"
              options={[
                { value: 'local', label: 'localhost:5432' },
                { value: 'remote', label: 'remote:5432' },
              ]}
            />
            <Button actionId="ai.memory.dsn-test" emphasis="secondary" density="compact"
              label={t('agent.ai.memory.test')} onActivate={() => undefined} />
          </Flex>
        )}
      </SettingsSection>

      <SettingsSection iconId="sliders-horizontal" title={t('agent.ai.memory.weights')}
        subtitle={t('agent.ai.memory.weightsDesc')} testId="memory-weights">
        <Flex direction="column" gap={8} className="pa-memory__weights" data-pt-weights>
          <Text className="pa-memory__weight-label">
            {t('agent.ai.memory.vector')}
            <em>{vectorWeight}%</em>
          </Text>
          <Slider
            value={vectorWeight}
            label={t('agent.ai.memory.vector')}
            valueLabel={value => `${value}%`}
            data-pt-weight="vector"
            onValueChange={setVectorWeight}
          />
          <Text className="pa-memory__weight-label">
            {t('agent.ai.memory.keyword')}
            <em>{100 - vectorWeight}%</em>
          </Text>
          <Slider
            value={100 - vectorWeight}
            label={t('agent.ai.memory.keyword')}
            valueLabel={value => `${value}%`}
            data-pt-weight="keyword"
            onValueChange={value => setVectorWeight(100 - value)}
          />
        </Flex>
      </SettingsSection>
    </Flex>
  );
}

const LANGUAGE_OPTIONS: { value: SttLanguage; labelKey: StringKey }[] = [
  { value: 'auto', labelKey: 'agent.ai.voice.lang.auto' },
  { value: 'en', labelKey: 'agent.ai.voice.lang.en' },
  { value: 'zh', labelKey: 'agent.ai.voice.lang.zh' },
  { value: 'ja', labelKey: 'agent.ai.voice.lang.ja' },
  { value: 'ko', labelKey: 'agent.ai.voice.lang.ko' },
  { value: 'fr', labelKey: 'agent.ai.voice.lang.fr' },
  { value: 'de', labelKey: 'agent.ai.voice.lang.de' },
  { value: 'es', labelKey: 'agent.ai.voice.lang.es' },
];

export function VoiceSection() {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [provider, setProvider] = useState<SttProvider>('browser');
  const [language, setLanguage] = useState<SttLanguage>('auto');
  const [autoStop, setAutoStop] = useState(true);

  return (
    <SettingsSection iconId="mic" title={t('agent.ai.voice.title')}
      subtitle={t('agent.ai.voice.subtitle')} testId="voice">
      <SettingsRow label={t('agent.ai.voice.provider')} description={t('agent.ai.voice.providerDesc')}>
        <Select<SttProvider>
          aria-label={t('agent.ai.voice.provider')}
          value={provider}
          data-pt-voice-provider
          options={[
            { value: 'browser', label: t('agent.ai.voice.providerBrowser') },
            { value: 'openai', label: t('agent.ai.voice.providerOpenai') },
          ]}
          onValueChange={value => setProvider((Array.isArray(value) ? value[0] : value) ?? 'browser')}
        />
      </SettingsRow>
      <SettingsRow label={t('agent.ai.voice.language')} description={t('agent.ai.voice.languageDesc')}>
        <Select<SttLanguage>
          aria-label={t('agent.ai.voice.language')}
          value={language}
          data-pt-voice-language
          options={LANGUAGE_OPTIONS.map(option => ({ value: option.value, label: t(option.labelKey) }))}
          onValueChange={value => setLanguage((Array.isArray(value) ? value[0] : value) ?? 'auto')}
        />
      </SettingsRow>
      <SettingsRow label={t('agent.ai.voice.autoStop')} description={t('agent.ai.voice.autoStopDesc')}>
        <Switch checked={autoStop} label={t('agent.ai.voice.autoStop')}
          data-pt-voice-auto-stop onCheckedChange={setAutoStop} />
      </SettingsRow>
    </SettingsSection>
  );
}

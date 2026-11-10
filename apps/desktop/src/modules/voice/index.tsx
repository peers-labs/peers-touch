import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, Switch } from '@peers-touch/ui';
import { Mic } from 'lucide-react';
import { registerModule } from '../registry';
import { api, type UserPreferences } from '../../services/desktop_api';
import { SettingsContainer, SettingsSection, SettingsRow } from '../../components/settings/SettingsLayout';

function getSttProviderOptions(t: (key: string) => string) {
  return [
    { value: 'browser' as const, label: t('stt.provider.browser') },
    { value: 'openai' as const, label: t('stt.provider.openaiWhisper') },
  ];
}

function getSttLanguageOptions(t: (key: string) => string) {
  return [
    { value: 'auto', label: t('stt.language.auto') },
    { value: 'en', label: t('stt.language.en') },
    { value: 'zh', label: t('stt.language.zh') },
    { value: 'ja', label: t('stt.language.ja') },
    { value: 'ko', label: t('stt.language.ko') },
    { value: 'fr', label: t('stt.language.fr') },
    { value: 'de', label: t('stt.language.de') },
    { value: 'es', label: t('stt.language.es') },
  ];
}

// Voice settings retain only the speech-to-text preferences. Text-to-speech
// playback was a local fake (empty WAV / static voice list) and was removed;
// synthesized voice has no Station authority in this release.
function VoiceSettings() {
  const { t } = useTranslation('tts');
  const [loading, setLoading] = useState(true);
  const [sttProvider, setSttProvider] = useState<'browser' | 'openai'>('browser');
  const [sttLanguage, setSttLanguage] = useState('auto');
  const [sttAutoStop, setSttAutoStop] = useState(true);

  useEffect(() => {
    let mounted = true;
    api.getPreferences()
      .then((prefs) => {
        if (!mounted) return;
        setSttProvider(prefs.stt_provider ?? 'browser');
        setSttLanguage(prefs.stt_language ?? 'auto');
        setSttAutoStop(prefs.stt_auto_stop ?? true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  const patch = useCallback((payload: Partial<UserPreferences>) => {
    api.setPreferences(payload).catch(() => {});
  }, []);

  return (
    <SettingsContainer>
      <SettingsSection icon={<Mic size={15} />} title={t('stt.title')} subtitle={t('stt.description')}>
        <SettingsRow label={t('stt.provider.label')}>
          <Select<'browser' | 'openai'>
            appearance="ghost"
            data-voice-provider
            aria-label={t('stt.provider.label')}
            disabled={loading}
            options={getSttProviderOptions(t)}
            value={sttProvider}
            onValueChange={(value) => {
              if (value !== 'browser' && value !== 'openai') return;
              setSttProvider(value);
              patch({ stt_provider: value });
            }}
          />
        </SettingsRow>
        <SettingsRow label={t('stt.language.label')}>
          <Select<string>
            appearance="ghost"
            data-voice-language
            aria-label={t('stt.language.label')}
            disabled={loading}
            options={getSttLanguageOptions(t)}
            value={sttLanguage}
            onValueChange={(value) => {
              if (typeof value !== 'string') return;
              setSttLanguage(value);
              patch({ stt_language: value });
            }}
          />
        </SettingsRow>
        <SettingsRow label={t('stt.autoStop.label')}>
          <Switch
            checked={sttAutoStop}
            disabled={loading}
            data-voice-auto-stop
            aria-label={t('stt.autoStop.label')}
            onCheckedChange={(checked) => {
              setSttAutoStop(checked);
              patch({ stt_auto_stop: checked });
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsContainer>
  );
}

registerModule({
  id: 'voice',
  name: 'Voice',
  icon: Mic,
  settingsPanel: VoiceSettings,
  settingsEntry: { order: 35, label: 'Voice' },
});

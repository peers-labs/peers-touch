import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Form, Select, Switch, Typography, theme } from 'antd';
import { Mic } from 'lucide-react';
import { registerModule } from '../registry';
import { api, type UserPreferences } from '../../services/desktop_api';
import { SettingsContainer } from '../../components/settings/SettingsLayout';

const { Title, Text } = Typography;

function getSttProviderOptions(t: (key: string) => string) {
  return [
    { value: 'browser', label: t('stt.provider.browser') },
    { value: 'openai', label: t('stt.provider.openaiWhisper') },
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
  const { token } = theme.useToken();
  const { t } = useTranslation('tts');
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);

  const loadPrefs = useCallback(async () => {
    try {
      const prefs = await api.getPreferences();
      form.setFieldsValue({
        stt_provider: prefs.stt_provider ?? 'browser',
        stt_language: prefs.stt_language ?? 'auto',
        stt_auto_stop: prefs.stt_auto_stop ?? true,
      });
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const handleValuesChange = useCallback(
    (_changed: Partial<UserPreferences>, all: Partial<UserPreferences>) => {
      const payload: Partial<UserPreferences> = {};
      if (all.stt_provider !== undefined) payload.stt_provider = all.stt_provider;
      if (all.stt_language !== undefined) payload.stt_language = all.stt_language;
      if (all.stt_auto_stop !== undefined) payload.stt_auto_stop = all.stt_auto_stop;
      if (Object.keys(payload).length > 0) {
        api.setPreferences(payload).catch(() => {});
      }
    },
    [],
  );

  return (
    <SettingsContainer fullHeight tier="standard">
      <Form form={form} layout="vertical" onValuesChange={handleValuesChange} disabled={loading}>
        <Flexbox gap={4}>
          <Title level={5} style={{ margin: 0 }}>
            <Mic size={16} style={{ marginRight: 8, color: token.colorPrimary }} />
            {t('stt.title')}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('stt.description')}
          </Text>
        </Flexbox>
        <Form.Item name="stt_provider" label={t('stt.provider.label')}>
          <Select options={getSttProviderOptions(t)} />
        </Form.Item>
        <Form.Item name="stt_language" label={t('stt.language.label')}>
          <Select options={getSttLanguageOptions(t)} />
        </Form.Item>
        <Form.Item name="stt_auto_stop" label={t('stt.autoStop.label')} valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
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

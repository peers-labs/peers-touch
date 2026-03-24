import { useEffect, useState, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Form, Select, Slider, Switch, Typography, theme } from 'antd';
import { Volume2 } from 'lucide-react';
import { registerModule } from '../registry';
import { api, type TTSVoice, type UserPreferences } from '../../services/desktop_api';

const { Title, Text } = Typography;

const TTS_PROVIDER_OPTIONS = [
  { value: 'browser', label: 'Browser (free)' },
  { value: 'edge', label: 'Edge (free)' },
  { value: 'openai', label: 'OpenAI' },
];

const STT_PROVIDER_OPTIONS = [
  { value: 'browser', label: 'Browser (free)' },
  { value: 'openai', label: 'OpenAI Whisper' },
];

const STT_LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
];

function TTSSettings() {
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [apiVoices, setApiVoices] = useState<TTSVoice[]>([]);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);

  const loadPrefs = useCallback(async () => {
    try {
      const [prefs, voicesRes] = await Promise.all([
        api.getPreferences(),
        api.ttsVoices(),
      ]);
      setApiVoices(voicesRes.voices || []);
      form.setFieldsValue({
        tts_provider: prefs.tts_provider ?? 'browser',
        tts_voice: prefs.tts_voice ?? '',
        tts_speed: prefs.tts_speed ?? 1,
        tts_auto_read: prefs.tts_auto_read ?? false,
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

  useEffect(() => {
    const list = window.speechSynthesis?.getVoices() ?? [];
    if (list.length > 0) {
      setBrowserVoices(list);
    }
    const onVoicesChanged = () => setBrowserVoices(window.speechSynthesis?.getVoices() ?? []);
    window.speechSynthesis?.addEventListener?.('voiceschanged', onVoicesChanged);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', onVoicesChanged);
  }, []);

  const handleValuesChange = useCallback((_changed: Partial<UserPreferences>, all: Partial<UserPreferences>) => {
    const payload: Partial<UserPreferences> = {};
    if (all.tts_provider !== undefined) payload.tts_provider = all.tts_provider;
    if (all.tts_voice !== undefined) payload.tts_voice = all.tts_voice;
    if (all.tts_speed !== undefined) payload.tts_speed = all.tts_speed;
    if (all.tts_auto_read !== undefined) payload.tts_auto_read = all.tts_auto_read;
    if (all.stt_provider !== undefined) payload.stt_provider = all.stt_provider;
    if (all.stt_language !== undefined) payload.stt_language = all.stt_language;
    if (all.stt_auto_stop !== undefined) payload.stt_auto_stop = all.stt_auto_stop;
    if (Object.keys(payload).length > 0) {
      api.setPreferences(payload).catch(() => {});
    }
  }, []);

  const ttsProvider = Form.useWatch('tts_provider', form);
  const voiceOptions = (() => {
    if (ttsProvider === 'browser') {
      return browserVoices.map((v) => ({
        value: v.voiceURI || v.name,
        label: v.name + (v.lang ? ` (${v.lang})` : ''),
      }));
    }
    return apiVoices
      .filter((v) => v.provider === ttsProvider)
      .map((v) => ({ value: v.id, label: v.name }));
  })();

  return (
    <Flexbox style={{ padding: 24, maxWidth: 560, overflow: 'auto', height: '100%' }} gap={24}>
      <Form
        form={form}
        layout="vertical"
        onValuesChange={handleValuesChange}
        disabled={loading}
      >
        <Flexbox gap={4}>
          <Title level={5} style={{ margin: 0 }}>Text-to-Speech</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Configure how assistant messages are read aloud.
          </Text>
        </Flexbox>
        <Form.Item name="tts_provider" label="Provider">
          <Select options={TTS_PROVIDER_OPTIONS} />
        </Form.Item>
        <Form.Item name="tts_voice" label="Voice">
          <Select
            options={voiceOptions}
            placeholder="Select a voice"
            allowClear
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>
        <Form.Item name="tts_speed" label="Speed">
          <Slider min={0.5} max={2} step={0.1} marks={{ 0.5: '0.5', 1: '1', 1.5: '1.5', 2: '2' }} />
        </Form.Item>
        <Form.Item name="tts_auto_read" label="Auto-read" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Flexbox
          style={{
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            paddingTop: 24,
            marginTop: 8,
          }}
          gap={4}
        >
          <Title level={5} style={{ margin: 0 }}>Speech-to-Text</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Configure voice input and transcription.
          </Text>
        </Flexbox>
        <Form.Item name="stt_provider" label="Provider">
          <Select options={STT_PROVIDER_OPTIONS} />
        </Form.Item>
        <Form.Item name="stt_language" label="Language">
          <Select options={STT_LANGUAGE_OPTIONS} />
        </Form.Item>
        <Form.Item name="stt_auto_stop" label="Auto-stop" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Flexbox>
  );
}

registerModule({
  id: 'tts',
  name: 'Voice',
  icon: Volume2,
  settingsPanel: TTSSettings,
  settingsEntry: { order: 35, label: 'Voice' },
});

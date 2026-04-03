import Doubao from '@lobehub/icons/es/Doubao';
import OpenAI from '@lobehub/icons/es/OpenAI';
import Anthropic from '@lobehub/icons/es/Anthropic';
import Google from '@lobehub/icons/es/Google';
import DeepSeek from '@lobehub/icons/es/DeepSeek';
import Ollama from '@lobehub/icons/es/Ollama';
import OpenRouter from '@lobehub/icons/es/OpenRouter';
import Mistral from '@lobehub/icons/es/Mistral';
import Groq from '@lobehub/icons/es/Groq';
import Together from '@lobehub/icons/es/Together';
import Cohere from '@lobehub/icons/es/Cohere';
import { theme } from 'antd';

type IconComponent = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

const ICON_MAP: Record<string, IconComponent> = {
  ark: Doubao.Color,
  doubao: Doubao.Color,
  openai: OpenAI,
  anthropic: Anthropic,
  google: Google.Color,
  deepseek: DeepSeek.Color,
  ollama: Ollama,
  openrouter: OpenRouter,
  mistral: Mistral.Color,
  groq: Groq,
  together: Together.Color,
  cohere: Cohere.Color,
};

interface Props {
  providerId: string;
  providerName?: string;
  size?: number;
}

export function ProviderIcon({ providerId, providerName, size = 32 }: Props) {
  const { token } = theme.useToken();
  const Icon = ICON_MAP[providerId];

  if (Icon) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: token.colorBgContainer,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <Icon size={size * 0.7} />
      </div>
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        background: token.colorPrimary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: size * 0.44,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {(providerName || providerId).charAt(0).toUpperCase()}
    </div>
  );
}

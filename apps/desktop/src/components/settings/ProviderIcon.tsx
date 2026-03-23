import Doubao from '@lobehub/icons/es/Doubao';
import OpenAI from '@lobehub/icons/es/OpenAI';
import Anthropic from '@lobehub/icons/es/Anthropic';
import Google from '@lobehub/icons/es/Google';
import DeepSeek from '@lobehub/icons/es/DeepSeek';
import Ollama from '@lobehub/icons/es/Ollama';
import { theme } from 'antd';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  ark: Doubao.Avatar,
  openai: OpenAI.Avatar,
  anthropic: Anthropic.Avatar,
  google: Google.Avatar,
  deepseek: DeepSeek.Avatar,
  ollama: Ollama.Avatar,
};

interface Props {
  providerId: string;
  providerName?: string;
  size?: number;
}

export function ProviderIcon({ providerId, providerName, size = 32 }: Props) {
  const { token } = theme.useToken();
  let Icon = ICON_MAP[providerId];
  if (!Icon && providerId.startsWith('doubao-seed')) {
    Icon = Doubao.Avatar;
  }
  if (Icon) {
    return <Icon size={size} />;
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

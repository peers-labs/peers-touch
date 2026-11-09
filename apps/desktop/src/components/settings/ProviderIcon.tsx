import { BrandMark } from '@peers-touch/ui';
import type { BrandId } from '@peers-touch/ui';

/**
 * Provider brand marks render through the peers-ui BrandMark catalog so the
 * AI settings surface uses one monochrome, currentColor brand grammar (the
 * north-star quiet-icon style) instead of full-color third-party logo
 * packages. Unknown providers fall back to an initial-letter ink tile.
 */
const PROVIDER_BRAND_MAP: Record<string, BrandId> = {
  ark: 'doubao',
  doubao: 'doubao',
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  deepseek: 'deepseek',
  ollama: 'ollama',
  openrouter: 'openrouter',
  mistral: 'mistral',
  groq: 'groq',
  together: 'together',
  cohere: 'cohere',
  'codex-cli': 'codex',
  'claude-cli': 'claude',
  'cursor-cli': 'cursor',
  'trae-cli': 'trae',
};

interface Props {
  providerId: string;
  providerName?: string;
  size?: number;
}

export function ProviderIcon({ providerId, providerName, size = 32 }: Props) {
  const brandId = PROVIDER_BRAND_MAP[providerId];

  if (brandId) {
    return (
      <span
        className="sc-provider-icon"
        data-provider-icon={providerId}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'var(--pt-surface)',
          border: '1px solid var(--pt-border)',
          color: 'var(--pt-text)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <BrandMark brandId={brandId} size={size * 0.62} label={providerName ?? providerId} />
      </span>
    );
  }

  return (
    <span
      className="sc-provider-icon sc-provider-icon--fallback"
      data-provider-icon={providerId}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.25,
        background: 'var(--pt-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--pt-onPrimary)',
        fontSize: size * 0.44,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {(providerName || providerId).charAt(0).toUpperCase()}
    </span>
  );
}

import type { ThemeToken } from './shared';

/**
 * Pulsing dot indicator shown while the assistant is thinking
 * (before any content or tool calls appear).
 */
export function ThinkingIndicator({ token }: { token: ThemeToken }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        color: token.colorTextSecondary,
        fontSize: 13,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: token.colorPrimary,
          opacity: 0.6,
          animation: 'ptPulse 1.2s ease-in-out infinite',
        }}
      />
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: token.colorPrimary,
          opacity: 0.6,
          animation: 'ptPulse 1.2s ease-in-out infinite',
          animationDelay: '0.2s',
        }}
      />
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: token.colorPrimary,
          opacity: 0.6,
          animation: 'ptPulse 1.2s ease-in-out infinite',
          animationDelay: '0.4s',
        }}
      />
      <style>{`@keyframes ptPulse { 0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); } 40% { opacity: 0.9; transform: scale(1); } }`}</style>
    </div>
  );
}

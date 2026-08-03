interface ActivityGlyphProps {
  color: string;
  size?: number;
}

export function ActivityGlyph({ color, size = 18 }: ActivityGlyphProps) {
  const core = Math.round(size * 0.44);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        style={{ position: 'absolute', inset: 0, animation: 'ptActivityRing 3s linear infinite' }}
      >
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" strokeDasharray="3 4" strokeLinecap="round" opacity="0.5" />
      </svg>
      <span
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: core,
          height: core,
          marginLeft: -core / 2,
          marginTop: -core / 2,
          borderRadius: '50%',
          background: color,
          animation: 'ptActivityCore 1.4s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes ptActivityRing {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ptActivityCore {
          0%, 100% { opacity: 0.55; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

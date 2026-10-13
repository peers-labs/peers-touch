export type DesignThemeMode = 'light' | 'dark';

export interface SemanticDesignTokens {
  color: {
    brand: string;
    brandHover: string;
    canvas: string;
    surface: string;
    surfaceSubtle: string;
    surfaceRaised: string;
    surfaceOverlay: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textOnBrand: string;
    border: string;
    borderStrong: string;
    success: string;
    warning: string;
    danger: string;
    focus: string;
    bubbleOwn: string;
    bubblePeer: string;
  };
  radius: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
    full: number;
  };
  space: {
    xxs: number;
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  shadow: {
    soft: string;
    float: string;
  };
  motion: {
    fast: number;
    normal: number;
    ease: string;
  };
  font: {
    sans: string;
    mono: string;
  };
}

const sharedGeometry = {
  radius: {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 20,
    full: 999,
  },
  space: {
    xxs: 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
  },
  motion: {
    fast: 140,
    normal: 240,
    ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  font: {
    sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', 'PingFang SC', sans-serif",
    mono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
  },
} as const;

export const designTokens: Record<DesignThemeMode, SemanticDesignTokens> = {
  light: {
    ...sharedGeometry,
    color: {
      brand: '#667eea',
      brandHover: '#5568d6',
      canvas: '#f3f5f8',
      surface: '#ffffff',
      surfaceSubtle: '#f7f8fb',
      surfaceRaised: '#ffffff',
      surfaceOverlay: 'rgba(255, 255, 255, 0.96)',
      textPrimary: '#202431',
      textSecondary: '#626979',
      textMuted: '#9299a8',
      textOnBrand: '#ffffff',
      border: '#e5e8ef',
      borderStrong: '#d2d7e1',
      success: '#25875a',
      warning: '#b66b00',
      danger: '#d64545',
      focus: '#667eea',
      bubbleOwn: '#667eea',
      bubblePeer: '#ffffff',
    },
    shadow: {
      soft: '0 2px 10px rgba(32, 36, 49, 0.08)',
      float: '0 14px 40px rgba(32, 36, 49, 0.18)',
    },
  },
  dark: {
    ...sharedGeometry,
    color: {
      brand: '#7d8cf2',
      brandHover: '#91a0ff',
      canvas: '#111318',
      surface: '#181b22',
      surfaceSubtle: '#1f232c',
      surfaceRaised: '#242832',
      surfaceOverlay: 'rgba(24, 27, 34, 0.96)',
      textPrimary: '#f1f3f8',
      textSecondary: '#b1b7c4',
      textMuted: '#7f8796',
      textOnBrand: '#ffffff',
      border: '#2d323d',
      borderStrong: '#3a414e',
      success: '#63c28f',
      warning: '#e2a54a',
      danger: '#f07b7b',
      focus: '#91a0ff',
      bubbleOwn: '#667eea',
      bubblePeer: '#242832',
    },
    shadow: {
      soft: '0 2px 12px rgba(0, 0, 0, 0.24)',
      float: '0 16px 44px rgba(0, 0, 0, 0.42)',
    },
  },
};

export function getDesignTokens(mode: DesignThemeMode): SemanticDesignTokens {
  return designTokens[mode];
}

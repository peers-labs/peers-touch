/**
 * Legacy call prototype palette.
 *
 * The Call prototype predates the shared token contract. Keep this compatibility
 * surface until that historical prototype is rewritten with antd theme tokens.
 */
export const T = {
  bg: '#ffffff',
  chatBg: '#f7f8fa',
  navBg: '#fafafa',
  fillQuaternary: '#f5f5f5',
  fillTertiary: '#f0f0f0',

  stage: '#10131a',
  stageSoft: '#1b1f29',

  primary: '#6b5bd6',
  primaryWash: '#eceaf6',

  success: '#22c55e',
  danger: '#ef4444',
  dangerWash: '#fee2e2',
  warn: '#f59e0b',

  border: '#e8e8e8',
  borderSoft: '#f0f0f0',

  text: '#262626',
  textSecondary: '#595959',
  textTertiary: '#8c8c8c',
  textQuaternary: '#bfbfbf',

  onStage: '#ffffff',
  onStageSoft: 'rgba(255,255,255,0.65)',

  white: '#ffffff',
} as const;

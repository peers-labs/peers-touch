/**
 * peers-touch Voice / Video Call — palette for the prototype.
 *
 * The real desktop derives all colors from the antd theme token via
 * `theme.useToken()`. The prototype is a standalone web page, so we pin a
 * small token-like palette and apply it as inline styles, mirroring the
 * desktop chat surface chrome used by `CallSurface`.
 */
export const T = {
  // surfaces
  bg: '#ffffff',
  chatBg: '#f7f8fa',
  navBg: '#fafafa',
  fillQuaternary: '#f5f5f5',
  fillTertiary: '#f0f0f0',

  // call stage (dark video stage)
  stage: '#10131a',
  stageSoft: '#1b1f29',

  // active / brand
  primary: '#6b5bd6',
  primaryWash: '#eceaf6',

  // semantic
  success: '#22c55e',
  danger: '#ef4444',
  dangerWash: '#fee2e2',
  warn: '#f59e0b',

  // borders
  border: '#e8e8e8',
  borderSoft: '#f0f0f0',

  // text
  text: '#262626',
  textSecondary: '#595959',
  textTertiary: '#8c8c8c',
  textQuaternary: '#bfbfbf',

  // text on dark stage
  onStage: '#ffffff',
  onStageSoft: 'rgba(255,255,255,0.65)',

  white: '#ffffff',
} as const;

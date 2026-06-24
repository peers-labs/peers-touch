/**
 * peers-touch Desktop — palette for the prototype shell.
 *
 * The real desktop derives all colors from the antd theme token via
 * `theme.useToken()`. The prototype is a standalone web page, so we pin a
 * small token-like palette and use it as inline styles, mirroring the
 * LobeUI `SideNav` chrome (avatar + topActions + bottomActions).
 */
export const T = {
  // surfaces
  bg: '#ffffff',
  navBg: '#fafafa',
  fillQuaternary: '#f5f5f5',
  fillTertiary: '#f0f0f0',

  // active / brand
  primary: '#6b5bd6',
  primaryWash: '#eceaf6',

  // borders
  border: '#e8e8e8',
  borderSoft: '#f0f0f0',

  // text
  text: '#262626',
  textSecondary: '#595959',
  textTertiary: '#8c8c8c',
  textQuaternary: '#bfbfbf',

  white: '#ffffff',
} as const;

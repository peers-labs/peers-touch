import type { ITheme } from '@xterm/xterm';

// Terminal chrome stays dark regardless of the app's light/dark surface: an
// interactive shell is a console surface, and every mainstream host
// (VS Code Dark+, Trae, iTerm, GNOME Terminal) renders it dark by default.
// The palette is the VS Code Dark+ terminal scheme, the most widely recognized
// ANSI mapping, so command output colors read exactly like a normal terminal.
export const DARK_TERMINAL_THEME: ITheme = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#1e1e1e',
  selectionBackground: '#264f78',
  selectionInactiveBackground: '#3a3d41',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#ffffff',
};

// Monospace stack ordered by platform availability; DejaVu Sans Mono covers
// stock Linux, Consolas/macOS faces cover the other desktop targets.
export const TERMINAL_FONT_FAMILY =
  'SFMono-Regular, Consolas, "Liberation Mono", "DejaVu Sans Mono", Menlo, monospace';

/**
 * Structured logger for the dashboard application.
 * All logging MUST go through this module — raw console usage is prohibited.
 *
 * In production builds, debug-level messages are silenced.
 */

const PREFIX = '[dashboard]';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function shouldLog(level: LogLevel): boolean {
  if (import.meta.env.PROD && level === 'debug') return false;
  return true;
}

function formatArgs(module: string, message: string, data?: Record<string, unknown>): string {
  const base = `${PREFIX}[${module}] ${message}`;
  if (data) return `${base} ${JSON.stringify(data)}`;
  return base;
}

export const log = {
  debug: (module: string, message: string, data?: Record<string, unknown>) => {
    if (!shouldLog('debug')) return;
    // eslint-disable-next-line no-console
    console.debug(formatArgs(module, message, data));
  },

  info: (module: string, message: string, data?: Record<string, unknown>) => {
    if (!shouldLog('info')) return;
    // eslint-disable-next-line no-console
    console.info(formatArgs(module, message, data));
  },

  warn: (module: string, message: string, data?: Record<string, unknown>) => {
    if (!shouldLog('warn')) return;
    // eslint-disable-next-line no-console
    console.warn(formatArgs(module, message, data));
  },

  error: (module: string, message: string, data?: Record<string, unknown>) => {
    if (!shouldLog('error')) return;
    // eslint-disable-next-line no-console
    console.error(formatArgs(module, message, data));
  },
};

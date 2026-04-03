import { invoke } from '@tauri-apps/api/core';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function send(level: LogLevel, tag: string, message: string, data?: unknown) {
  console[level](`[${tag}]`, message, ...(data !== undefined ? [data] : []));
  try {
    invoke('frontend_log', {
      input: {
        level,
        tag,
        message,
        data: data !== undefined ? JSON.stringify(data) : undefined,
      },
    }).catch(() => {});
  } catch {
    // noop
  }
}

export const log = {
  debug: (tag: string, msg: string, data?: unknown) => send('debug', tag, msg, data),
  info: (tag: string, msg: string, data?: unknown) => send('info', tag, msg, data),
  warn: (tag: string, msg: string, data?: unknown) => send('warn', tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => send('error', tag, msg, data),
};

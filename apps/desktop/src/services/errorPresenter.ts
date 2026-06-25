import { toast } from '@lobehub/ui';
import i18n from '../i18n';
import { resolveError } from '../i18n/error-resolver';
import { RustCommandException } from './desktop_api';

export type PresentedErrorSeverity = 'info' | 'warning' | 'error';
export type ErrorPresentationMode = 'toast' | 'inline' | 'silent';

export interface PresentedError {
  code: string;
  title: string;
  message: string;
  severity: PresentedErrorSeverity;
  recoverable: boolean;
  debugMessage?: string;
}

export type ErrorMapper<TContext = Record<string, unknown>> = (
  error: unknown,
  context?: TContext,
) => PresentedError | null;

export interface PresentErrorOptions<TContext = Record<string, unknown>> {
  mode?: ErrorPresentationMode;
  fallbackKey?: string;
  mapper?: ErrorMapper<TContext>;
  context?: TContext;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error == null) return '';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function tError(key: string, fallback?: string): string {
  const resolved = i18n.t(key, { ns: 'errors', defaultValue: '' });
  if (resolved && resolved !== key) return resolved;
  if (fallback) return fallback;
  return resolveError('unknown');
}

export function mapErrorToPresentation(error: unknown, fallbackKey?: string): PresentedError {
  const rawMessage = errorMessage(error);
  const code = error instanceof RustCommandException ? error.code : 'unknown';
  const message = fallbackKey
    ? tError(fallbackKey)
    : error instanceof RustCommandException
      ? resolveError(error.code, rawMessage)
      : resolveError('unknown', rawMessage);

  return {
    code,
    title: tError('error.presentation.title'),
    message,
    severity: 'error',
    recoverable: true,
    debugMessage: rawMessage,
  };
}

export function presentError<TContext = Record<string, unknown>>(
  error: unknown,
  options: PresentErrorOptions<TContext> = {},
): PresentedError {
  const presentation = options.mapper?.(error, options.context)
    ?? mapErrorToPresentation(error, options.fallbackKey);

  if (options.mode !== 'silent' && options.mode !== 'inline') {
    toast.error(presentation.message);
  }

  return presentation;
}

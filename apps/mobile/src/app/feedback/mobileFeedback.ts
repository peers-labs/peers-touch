/**
 * Mobile feedback seam.
 *
 * Per the north-star-realignment architecture (ADR-3), mobile does not build a
 * second dialog/toast system. It owns exactly ONE peers-ui application feedback
 * channel for this window and exposes thin, typed wrappers. The channel's
 * FeedbackHost is rendered by UIProvider (see MobileNorthStarProvider), so
 * toasts/dialogs render inside the scoped `.pt-ui` overlay host.
 *
 * This module is presentation-only: it must not import runtimes, services,
 * stores, or read business state. Labels passed in are already localized.
 */
import { createFeedbackChannel, type FeedbackChannel } from '@peers-touch/ui';
import type { ReactNode } from 'react';

export const mobileFeedbackChannel: FeedbackChannel = createFeedbackChannel();

export interface MobileConfirmRequest {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Run on confirm; throwing keeps the dialog open with the error shown. */
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

/** Resolves true when confirmed, false when dismissed/cancelled. */
export function confirm(request: MobileConfirmRequest): Promise<boolean> {
  return mobileFeedbackChannel.requestConfirmation(request);
}

/** Destructive confirmation; rendered with the danger tone. */
export function confirmDestructive(request: MobileConfirmRequest): Promise<boolean> {
  return mobileFeedbackChannel.requestConfirmation({ ...request, tone: 'danger' });
}

type MobileNoticeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface MobileNotice {
  message: ReactNode;
  tone?: MobileNoticeTone;
  /** Auto-dismiss after ms; 0 keeps it until dismissed. Default 4000. */
  duration?: number;
  action?: ReactNode;
}

export function notify(notice: MobileNotice): () => void {
  return mobileFeedbackChannel.notify(notice);
}
export const notifySuccess = (message: ReactNode, duration?: number) =>
  notify({ message, tone: 'success', duration });
export const notifyError = (message: ReactNode, duration?: number) =>
  notify({ message, tone: 'danger', duration });
export const notifyInfo = (message: ReactNode, duration?: number) =>
  notify({ message, tone: 'info', duration });
export const notifyWarning = (message: ReactNode, duration?: number) =>
  notify({ message, tone: 'warning', duration });

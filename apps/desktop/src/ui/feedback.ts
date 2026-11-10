import type { ReactNode } from 'react';
import { createFeedbackChannel, type FeedbackChannel, type Tone } from '@peers-touch/ui';

// One desktop window owns one feedback channel: imperative toast notices and
// promise-based confirmation/choice dialogs rendered by <AppFeedbackHost/>.
export const feedbackChannel: FeedbackChannel = createFeedbackChannel();

export function notifyError(message: string): void {
  feedbackChannel.notify({ message, tone: 'danger' });
}

export function notifySuccess(message: string): void {
  feedbackChannel.notify({ message, tone: 'success' });
}

export function notifyInfo(message: string): void {
  feedbackChannel.notify({ message, tone: 'info' });
}

export function notifyWarning(message: string): void {
  feedbackChannel.notify({ message, tone: 'warning' });
}

interface ConfirmRequest {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: Tone;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

export function confirmRequest(request: ConfirmRequest): Promise<boolean> {
  return feedbackChannel.requestConfirmation(request as Parameters<typeof feedbackChannel.requestConfirmation>[0]);
}

interface AcknowledgeRequest {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: Tone;
  onConfirm?: () => void;
}

export function acknowledgeRequest(request: AcknowledgeRequest): Promise<void> {
  return feedbackChannel.requestAcknowledgement(request);
}

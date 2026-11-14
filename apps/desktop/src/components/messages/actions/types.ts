import type { ComponentType } from 'react';
import type { ChatMessage } from '../../../store/chat';
import type { Operation } from '../../../store/streaming';

export interface MessageActionDef {
  key: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  /** e2e probe attributes rendered as data-* on the resulting control. */
  probe?: Record<string, string | undefined>;
  onClick: () => void;
}

export interface MessageActionContext {
  message: ChatMessage;
  isStreaming: boolean;
  isCurrentSession: boolean;
  operation: Operation | undefined;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onRetryRecovery: () => void;
  onReloadSnapshot: () => void;
  onBranch: () => void;
  onContinue: () => void;
  onDeleteAndRegenerate: () => void;
  onTranslate: () => void;
  onThread: () => void;
  onTurnDetails?: () => void;
  onExport: () => void;
  onForward: () => void;
  /** Artifact claim/open entries spliced into the assistant "more" menu. */
  artifactActions?: MessageActionDef[];
}

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
  onBranch: () => void;
  onContinue: () => void;
  onDeleteAndRegenerate: () => void;
  onTranslate: () => void;
  onThread: () => void;
  onReadAloud: () => void;
  onExport: () => void;
  onForward: () => void;
}

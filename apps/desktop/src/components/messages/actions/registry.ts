import { Copy, Pencil, Trash2, RefreshCw, RotateCcw, GitBranch, ChevronRight, Eraser, Languages, MessageSquareMore, Volume2, Download, Forward } from 'lucide-react';
import type { MessageActionDef, MessageActionContext } from './types';
import { isActiveOperation } from '../../../store/streaming';

export function buildMessageActions(ctx: MessageActionContext): {
  primary: MessageActionDef[];
  menu: MessageActionDef[];
} {
  const { message, operation } = ctx;
  const isActive = isActiveOperation(operation);

  if (isActive || message.loading) {
    return { primary: [], menu: [] };
  }

  if (message.role === 'user') {
    return buildUserActions(ctx);
  }

  if (message.role === 'assistant') {
    if (message.error) {
      return buildAssistantErrorActions(ctx);
    }
    return buildAssistantActions(ctx);
  }

  return {
    primary: [{ key: 'copy', label: 'chat.message.action.copy', icon: Copy, onClick: ctx.onCopy }],
    menu: [],
  };
}

function buildUserActions(ctx: MessageActionContext): { primary: MessageActionDef[]; menu: MessageActionDef[] } {
  return {
    primary: [
      { key: 'copy', label: 'chat.message.action.copy', icon: Copy, onClick: ctx.onCopy },
      { key: 'edit', label: 'chat.message.action.edit', icon: Pencil, onClick: ctx.onEdit },
    ],
    menu: [
      { key: 'regenerate', label: 'chat.message.action.regenerate', icon: RefreshCw, onClick: ctx.onRegenerate },
      { key: 'forward', label: 'chat.message.action.forward', icon: Forward, onClick: ctx.onForward },
      { key: 'delete', label: 'chat.message.action.delete', icon: Trash2, danger: true, onClick: ctx.onDelete },
    ],
  };
}

function buildAssistantActions(ctx: MessageActionContext): { primary: MessageActionDef[]; menu: MessageActionDef[] } {
  return {
    primary: [
      { key: 'copy', label: 'chat.message.action.copy', icon: Copy, onClick: ctx.onCopy },
      { key: 'regenerate', label: 'chat.message.action.regenerate', icon: RefreshCw, onClick: ctx.onRegenerate },
      { key: 'readAloud', label: 'chat.message.action.readAloud', icon: Volume2, onClick: ctx.onReadAloud },
    ],
    menu: [
      { key: 'edit', label: 'chat.message.action.edit', icon: Pencil, onClick: ctx.onEdit },
      { key: 'branch', label: 'chat.message.action.branch', icon: GitBranch, onClick: ctx.onBranch },
      { key: 'thread', label: 'chat.message.action.thread', icon: MessageSquareMore, onClick: ctx.onThread },
      { key: 'continue', label: 'chat.message.action.continue', icon: ChevronRight, onClick: ctx.onContinue },
      { key: 'translate', label: 'chat.message.action.translate', icon: Languages, onClick: ctx.onTranslate },
      { key: 'export', label: 'chat.message.action.export', icon: Download, onClick: ctx.onExport },
      { key: 'forward', label: 'chat.message.action.forward', icon: Forward, onClick: ctx.onForward },
      { key: 'delAndRegenerate', label: 'chat.message.action.delAndRegenerate', icon: Eraser, onClick: ctx.onDeleteAndRegenerate },
      { key: 'delete', label: 'chat.message.action.delete', icon: Trash2, danger: true, onClick: ctx.onDelete },
    ],
  };
}

function buildAssistantErrorActions(ctx: MessageActionContext): { primary: MessageActionDef[]; menu: MessageActionDef[] } {
  return {
    primary: [
      { key: 'retry', label: 'chat.message.action.retry', icon: RotateCcw, onClick: ctx.onRetry },
      { key: 'delete', label: 'chat.message.action.delete', icon: Trash2, danger: true, onClick: ctx.onDelete },
    ],
    menu: [
      { key: 'copy', label: 'chat.message.action.copy', icon: Copy, onClick: ctx.onCopy, hidden: !ctx.message.content },
    ],
  };
}

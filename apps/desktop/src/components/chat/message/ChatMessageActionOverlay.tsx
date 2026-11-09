import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button as PtButton, Tooltip as PtTooltip } from '@peers-touch/ui';
import {
  CornerUpRight,
  MessageSquareReply,
  MessagesSquare,
  Pencil,
  Pin,
  RotateCcw,
  SmilePlus,
  Trash2,
} from 'lucide-react';

import {
  isEncryptedPlaceholder,
  isOwnMessage,
  isRecalledMessage,
  messageThreadRootUlid,
  messageTimestampMs,
  type ChatMessage,
} from './chatMessageModel';
import {
  placeMessageActionSurface,
  type GeometryRect,
  type MessageActionGeometryResult,
} from './messageActionGeometry';

const REACTION_EMOJIS = [
  '👍', '❤️', '😂', '😮', '😢', '🙏', '👏', '🎉',
  '🔥', '💯', '🤔', '👀', '🙌', '✨', '✅', '💪',
  '🤝', '🥳', '😍', '😊', '😅', '🤯', '😎', '💡',
] as const;
const REACTION_PICKER_COLUMNS = 6;

const FRIEND_RECALL_WINDOW_MS = 4 * 60 * 1000 + 30 * 1000;

export interface MessageActionTarget {
  activatedAtMs: number;
  anchorElement: HTMLElement;
  message: ChatMessage;
  requestFocus: boolean;
}

interface ChatMessageActionOverlayProps {
  currentUserPtid: string | null;
  hostElement: HTMLElement | null;
  onDelete: (message: ChatMessage) => void;
  onDismiss: () => void;
  onEdit: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onOpenThread: (rootUlid: string) => void;
  onPin: (message: ChatMessage) => void;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  onRecall: (message: ChatMessage) => void;
  onReply: (messageUlid: string) => void;
  target: MessageActionTarget | null;
  viewportElement: HTMLElement | null;
}

function toGeometryRect(rect: DOMRect): GeometryRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

function isVisibleWithin(rect: DOMRect, viewportRect: DOMRect): boolean {
  return rect.bottom > viewportRect.top
    && rect.top < viewportRect.bottom
    && rect.right > viewportRect.left
    && rect.left < viewportRect.right;
}

export function ChatMessageActionOverlay({
  currentUserPtid,
  hostElement,
  onDelete,
  onDismiss,
  onEdit,
  onForward,
  onOpenThread,
  onPin,
  onHoverEnter,
  onHoverLeave,
  onReact,
  onRecall,
  onReply,
  target,
  viewportElement,
}: ChatMessageActionOverlayProps) {
  const { t } = useTranslation('chat');
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointerInsideRef = useRef(false);
  const restoreReactionFocusRef = useRef(false);
  const focusedActivationRef = useRef<MessageActionTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [geometry, setGeometry] = useState<MessageActionGeometryResult | null>(null);

  const message = target?.message;
  const isOwn = message ? isOwnMessage(message, currentUserPtid) : false;
  const isRecalled = message ? isRecalledMessage(message) : false;
  const sentAtMs = message ? messageTimestampMs(message) : 0;
  const withinMutationWindow = Boolean(
    target && sentAtMs > 0 && (target.activatedAtMs - sentAtMs) < FRIEND_RECALL_WINDOW_MS,
  );
  const canRecall = Boolean(message && isOwn && !isRecalled && withinMutationWindow);
  const canEdit = Boolean(
    message
      && isOwn
      && !isRecalled
      && withinMutationWindow
      && !isEncryptedPlaceholder(message),
  );

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    const anchor = target?.anchorElement;
    if (!surface || !anchor || !hostElement || !viewportElement) {
      setGeometry(null);
      return;
    }

    let frame = 0;
    const updateGeometry = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!anchor.isConnected || !surface.isConnected) {
          onDismiss();
          return;
        }

        const paneRect = hostElement.getBoundingClientRect();
        const viewportRect = viewportElement.getBoundingClientRect();
        // Anchor to the bubble itself rather than the full row column
        // (bubble + thread preview + timestamp + reactions), so the
        // toolbar hugs the message rather than its widest meta row.
        const bubbleElement = anchor.querySelector<HTMLElement>('[data-message-content]');
        const selectedContentRect = (bubbleElement ?? anchor).getBoundingClientRect();
        const adjacentContentRects = Array.from(
          viewportElement.querySelectorAll<HTMLElement>('[data-message-content]'),
        )
          .filter(element => !anchor.contains(element))
          .map(element => element.getBoundingClientRect())
          .filter(rect => isVisibleWithin(rect, viewportRect))
          .map(toGeometryRect);
        const surfaceRect = surface.getBoundingClientRect();

        setGeometry(placeMessageActionSurface({
          surfaceSize: {
            width: surfaceRect.width,
            height: surfaceRect.height,
          },
          paneRect: toGeometryRect(paneRect),
          viewportRect: toGeometryRect(viewportRect),
          selectedContentRect: toGeometryRect(selectedContentRect),
          adjacentContentRects,
          // The toolbar belongs under the hovered message; above/side
          // placements are only collision dodges. It hugs the bubble's
          // inner edge: own (right-side) bubble -> toolbar left edge,
          // incoming (left-side) bubble -> toolbar right edge.
          preferredPlacements: ['below', 'above', 'right', 'left'],
          anchorEdge: isOwn ? 'left' : 'right',
          gap: 8,
          boundaryPadding: 8,
        }));
      });
    };

    const resizeObserver = new ResizeObserver(updateGeometry);
    resizeObserver.observe(hostElement);
    resizeObserver.observe(viewportElement);
    resizeObserver.observe(anchor);
    resizeObserver.observe(surface);
    viewportElement.addEventListener('scroll', updateGeometry, { passive: true });
    updateGeometry();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      viewportElement.removeEventListener('scroll', updateGeometry);
    };
  }, [hostElement, onDismiss, pickerOpen, target, viewportElement]);

  useEffect(() => {
    if (!target?.requestFocus || !geometry || pickerOpen) return;
    if (focusedActivationRef.current === target) return;
    focusedActivationRef.current = target;
    surfaceRef.current?.querySelector<HTMLButtonElement>('[data-message-action]')?.focus();
  }, [geometry, pickerOpen, target]);

  useEffect(() => {
    if (!pickerOpen) return;
    const reactionButton = surfaceRef.current?.querySelector<HTMLButtonElement>(
      '[data-reaction-emoji]',
    );
    reactionButton?.focus();
  }, [pickerOpen]);

  useLayoutEffect(() => {
    if (pickerOpen || !restoreReactionFocusRef.current) return;
    restoreReactionFocusRef.current = false;
    surfaceRef.current?.querySelector<HTMLButtonElement>(
      '[data-message-action="reaction"]',
    )?.focus();
  }, [pickerOpen]);

  useEffect(() => {
    if (!target) return;
    const handlePointerDown = (event: PointerEvent) => {
      const eventTarget = event.target;
      if (!(eventTarget instanceof Node)) return;
      if (
        surfaceRef.current?.contains(eventTarget)
        || target.anchorElement.contains(eventTarget)
      ) {
        return;
      }
      onDismiss();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (pickerOpen) {
        restoreReactionFocusRef.current = true;
        setPickerOpen(false);
        return;
      }
      onDismiss();
      target.anchorElement.closest<HTMLElement>('[data-message-ulid]')?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onDismiss, pickerOpen, target]);

  if (!hostElement || !message) return null;

  // Geometry only; color/border-radius belong to the .sc-actionbar__btn class.
  // Prototype .sk-msg-action: 26px circular glyph targets.
  const actionButtonStyle: CSSProperties = {
    width: 26,
    height: 26,
  };
  const surfacePosition = geometry
    ? {
      left: geometry.rect.left - hostElement.getBoundingClientRect().left,
      top: geometry.rect.top - hostElement.getBoundingClientRect().top,
      visibility: 'visible' as const,
    }
    : {
      left: 0,
      top: 0,
      visibility: 'hidden' as const,
    };
  const runAndDismiss = (action: () => void) => {
    action();
    onDismiss();
  };

  return createPortal(
    <div
      ref={surfaceRef}
      role={pickerOpen ? 'dialog' : 'toolbar'}
      aria-label={pickerOpen
        ? t('chat.social.composer.emojiAll')
        : t('chat.input.moreActions')}
      data-message-action-overlay={pickerOpen ? 'reaction-picker' : 'toolbar'}
      data-message-action-message={message.ulid}
      data-message-action-placement={geometry?.placement ?? 'unplaced'}
      className="sc-actionbar"
      onPointerDownCapture={() => {
        pointerInsideRef.current = true;
        onHoverEnter();
      }}
      onMouseEnter={() => {
        pointerInsideRef.current = true;
        onHoverEnter();
      }}
      onMouseLeave={() => {
        pointerInsideRef.current = false;
        onHoverLeave();
      }}
      onFocusCapture={() => {
        onHoverEnter();
      }}
      onBlurCapture={(event) => {
        const relatedContained = event.relatedTarget instanceof Node
          && event.currentTarget.contains(event.relatedTarget);
        if (relatedContained || pointerInsideRef.current) return;
        onHoverLeave();
      }}
      style={{
        position: 'absolute',
        display: pickerOpen ? 'grid' : 'flex',
        gridTemplateColumns: pickerOpen
          ? `repeat(${REACTION_PICKER_COLUMNS}, 34px)`
          : undefined,
        // Prototype .sk-msg-actions-bar (toolbar: 1px gap / 2px padding) and
        // .sk-react-pop (picker: 2px gap / 5px padding).
        gap: pickerOpen ? 2 : 1,
        padding: pickerOpen ? 5 : 2,
        pointerEvents: 'auto',
        zIndex: 1,
        ...surfacePosition,
      }}
    >
      {pickerOpen ? REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="sc-actionbar__emoji"
          data-reaction-emoji={emoji}
          aria-label={emoji}
          onClick={() => {
            onReact(message, emoji);
            restoreReactionFocusRef.current = true;
            setPickerOpen(false);
          }}
        >
          {emoji}
        </button>
      )) : (
        <>
          <PtTooltip label={t('chat.social.thread.open')}>
            <PtButton
              actionId={`message-action-thread-${message.ulid}`}
              className="sc-actionbar__btn"
              data-message-action="thread"
              emphasis="quiet"
              density="compact"
              leading={<MessagesSquare size={14} />}
              aria-label={t('chat.social.thread.open')}
              onActivate={() => runAndDismiss(() => onOpenThread(
                messageThreadRootUlid(message) || message.ulid,
              ))}
              style={actionButtonStyle}
            />
          </PtTooltip>
          <PtTooltip label={t('chat.social.messageArea.actionReact')}>
            <PtButton
              actionId={`message-action-reaction-${message.ulid}`}
              className="sc-actionbar__btn"
              data-message-action="reaction"
              emphasis="quiet"
              density="compact"
              leading={<SmilePlus size={14} />}
              aria-label={t('chat.social.messageArea.actionReact')}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              onActivate={() => setPickerOpen(true)}
              style={actionButtonStyle}
            />
          </PtTooltip>
          <PtTooltip label={t('chat.social.contextMenu.pin')}>
            <PtButton
              actionId={`message-action-pin-${message.ulid}`}
              className="sc-actionbar__btn"
              data-message-action="pin"
              emphasis="quiet"
              density="compact"
              leading={<Pin size={14} />}
              aria-label={t('chat.social.contextMenu.pin')}
              onActivate={() => runAndDismiss(() => onPin(message))}
              style={actionButtonStyle}
            />
          </PtTooltip>
          {!isRecalled && (
            <PtTooltip label={t('chat.social.messageArea.actionReply')}>
              <PtButton
                actionId={`message-action-reply-${message.ulid}`}
                className="sc-actionbar__btn"
                data-message-action="reply"
                emphasis="quiet"
                density="compact"
                leading={<MessageSquareReply size={14} />}
                aria-label={t('chat.social.messageArea.actionReply')}
                onActivate={() => runAndDismiss(() => onReply(message.ulid))}
                style={actionButtonStyle}
              />
            </PtTooltip>
          )}
          <PtTooltip label={t('chat.social.messageArea.actionForward')}>
            <PtButton
              actionId={`message-action-forward-${message.ulid}`}
              className="sc-actionbar__btn"
              data-message-action="forward"
              emphasis="quiet"
              density="compact"
              leading={<CornerUpRight size={14} />}
              aria-label={t('chat.social.messageArea.actionForward')}
              onActivate={() => runAndDismiss(() => onForward(message))}
              style={actionButtonStyle}
            />
          </PtTooltip>
          {canEdit && (
            <PtTooltip label={t('chat.social.messageArea.actionEdit')}>
              <PtButton
                actionId={`message-action-edit-${message.ulid}`}
                className="sc-actionbar__btn"
                data-message-action="edit"
                emphasis="quiet"
                density="compact"
                leading={<Pencil size={14} />}
                aria-label={t('chat.social.messageArea.actionEdit')}
                onActivate={() => runAndDismiss(() => onEdit(message))}
                style={actionButtonStyle}
              />
            </PtTooltip>
          )}
          {canRecall && (
            <PtTooltip label={t('chat.social.messageArea.actionRecall')}>
              <PtButton
                actionId={`message-action-retract-${message.ulid}`}
                className="sc-actionbar__btn"
                data-message-action="retract"
                emphasis="quiet"
                density="compact"
                leading={<RotateCcw size={14} />}
                aria-label={t('chat.social.messageArea.actionRecall')}
                onActivate={() => runAndDismiss(() => onRecall(message))}
                style={actionButtonStyle}
              />
            </PtTooltip>
          )}
          <PtTooltip label={t('chat.social.messageArea.actionDelete')}>
            <PtButton
              actionId={`message-action-delete-${message.ulid}`}
              className="sc-actionbar__btn sc-actionbar__btn--danger"
              data-message-action="delete"
              emphasis="quiet"
              density="compact"
              leading={<Trash2 size={14} />}
              aria-label={t('chat.social.messageArea.actionDelete')}
              onActivate={() => runAndDismiss(() => onDelete(message))}
              style={actionButtonStyle}
            />
          </PtTooltip>
        </>
      )}
    </div>,
    hostElement,
  );
}

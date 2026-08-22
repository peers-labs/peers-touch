import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@lobehub/ui';
import { theme } from 'antd';
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

const FRIEND_RECALL_WINDOW_MS = 4 * 60 * 1000 + 30 * 1000;

// #region debug-point AG-AH:reaction-picker-press-lifecycle
function reportReactionPickerInput(
  messageId: string,
  pickerOpen: boolean,
  phase: string,
  data: Record<string, unknown> = {},
) {
  fetch('http://127.0.0.1:7785/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'chat-native-input-delivery',
      runId: 'pre-fix-transient-picker',
      hypothesisId: 'AG-AH',
      location: 'ChatMessageActionOverlay:reactionPicker',
      msg: `[DEBUG] Reaction picker ${phase}`,
      data: {
        messageId,
        pickerOpen,
        activeTag: document.activeElement?.tagName || '',
        ...data,
      },
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

export interface MessageActionTarget {
  activatedAtMs: number;
  anchorElement: HTMLElement;
  message: ChatMessage;
  requestFocus: boolean;
}

interface ChatMessageActionOverlayProps {
  currentUserDid: string | null;
  hostElement: HTMLElement | null;
  onDelete: (message: ChatMessage) => void;
  onDismiss: () => void;
  onEdit: (message: ChatMessage) => void;
  onForward: (message: ChatMessage) => void;
  onOpenThread: (rootUlid: string) => void;
  onPin: (message: ChatMessage) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
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
  currentUserDid,
  hostElement,
  onDelete,
  onDismiss,
  onEdit,
  onForward,
  onOpenThread,
  onPin,
  onPointerEnter,
  onPointerLeave,
  onReact,
  onRecall,
  onReply,
  target,
  viewportElement,
}: ChatMessageActionOverlayProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const surfaceRef = useRef<HTMLDivElement>(null);
  const pointerInsideRef = useRef(false);
  const restoreReactionFocusRef = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [geometry, setGeometry] = useState<MessageActionGeometryResult | null>(null);

  const message = target?.message;
  const isOwn = message ? isOwnMessage(message, currentUserDid) : false;
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
    // #region debug-point C:overlay-layout-entry
    fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-hover-overlay', runId: 'post-fix', hypothesisId: 'C', location: 'ChatMessageActionOverlay:layoutEffect', msg: '[DEBUG] overlay layout effect entered', data: { messageId: target?.message.ulid || '', hasSurface: Boolean(surface), hasAnchor: Boolean(anchor), hasHost: Boolean(hostElement), hasViewport: Boolean(viewportElement), anchorConnected: Boolean(anchor?.isConnected), surfaceConnected: Boolean(surface?.isConnected) }, ts: Date.now() }) }).catch(() => {});
    // #endregion
    if (!surface || !anchor || !hostElement || !viewportElement) {
      setGeometry(null);
      return;
    }

    let frame = 0;
    const updateGeometry = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!anchor.isConnected || !surface.isConnected) {
          // #region debug-point C:overlay-disconnected
          fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-hover-overlay', runId: 'post-fix', hypothesisId: 'C', location: 'ChatMessageActionOverlay:updateGeometry', msg: '[DEBUG] overlay dismissed for disconnected node', data: { messageId: target.message.ulid, anchorConnected: anchor.isConnected, surfaceConnected: surface.isConnected }, ts: Date.now() }) }).catch(() => {});
          // #endregion
          onDismiss();
          return;
        }

        const paneRect = hostElement.getBoundingClientRect();
        const viewportRect = viewportElement.getBoundingClientRect();
        const selectedContentRect = anchor.getBoundingClientRect();
        const adjacentContentRects = Array.from(
          viewportElement.querySelectorAll<HTMLElement>('[data-message-content]'),
        )
          .filter(element => element !== anchor)
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
          preferredPlacements: pickerOpen
            ? ['right', 'left', 'above', 'below']
            : ['above', 'below', 'right', 'left'],
          gap: 8,
          boundaryPadding: 8,
        }));
        // #region debug-point E:overlay-geometry-set
        fetch('http://127.0.0.1:7777/event', { method: 'POST', body: JSON.stringify({ sessionId: 'chat-hover-overlay', runId: 'post-fix', hypothesisId: 'E', location: 'ChatMessageActionOverlay:updateGeometry', msg: '[DEBUG] overlay geometry calculated', data: { messageId: target.message.ulid, surfaceWidth: surfaceRect.width, surfaceHeight: surfaceRect.height }, ts: Date.now() }) }).catch(() => {});
        // #endregion
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
    surfaceRef.current?.querySelector<HTMLButtonElement>('[data-message-action]')?.focus();
  }, [geometry, pickerOpen, target]);

  useEffect(() => {
    if (!pickerOpen) return;
    surfaceRef.current?.querySelector<HTMLButtonElement>('[data-reaction-emoji]')?.focus();
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

  const actionButtonStyle: CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 8,
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
      onPointerEnter={() => {
        // #region debug-point AG:pointer-enter
        reportReactionPickerInput(message.ulid, pickerOpen, 'pointer enter');
        // #endregion
        pointerInsideRef.current = true;
        onPointerEnter();
      }}
      onPointerLeave={() => {
        // #region debug-point AG:pointer-leave
        reportReactionPickerInput(message.ulid, pickerOpen, 'pointer leave');
        // #endregion
        pointerInsideRef.current = false;
        onPointerLeave();
      }}
      onFocusCapture={() => {
        // #region debug-point AG:focus
        reportReactionPickerInput(message.ulid, pickerOpen, 'focus');
        // #endregion
        onPointerEnter();
      }}
      onBlurCapture={(event) => {
        const relatedContained = event.relatedTarget instanceof Node
          && event.currentTarget.contains(event.relatedTarget);
        // #region debug-point AG:blur
        reportReactionPickerInput(message.ulid, pickerOpen, 'blur', {
          relatedContained,
          relatedTag: event.relatedTarget instanceof Element
            ? event.relatedTarget.tagName
            : '',
          pointerInside: pointerInsideRef.current,
        });
        // #endregion
        if (relatedContained || pointerInsideRef.current) return;
        onPointerLeave();
      }}
      style={{
        position: 'absolute',
        display: pickerOpen ? 'grid' : 'flex',
        gridTemplateColumns: pickerOpen ? 'repeat(8, 28px)' : undefined,
        gap: pickerOpen ? 4 : 3,
        padding: pickerOpen ? 8 : 3,
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 10,
        boxShadow: token.boxShadowSecondary,
        pointerEvents: 'auto',
        zIndex: 1,
        ...surfacePosition,
      }}
    >
      {pickerOpen ? REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          data-reaction-emoji={emoji}
          aria-label={emoji}
          onPointerDown={() => {
            // #region debug-point AG-AH:emoji-pointer-down
            reportReactionPickerInput(
              message.ulid,
              pickerOpen,
              'emoji pointer down',
              { emoji },
            );
            // #endregion
          }}
          onMouseUp={() => {
            // #region debug-point AG-AH:emoji-mouse-up
            reportReactionPickerInput(
              message.ulid,
              pickerOpen,
              'emoji mouse up',
              { emoji },
            );
            // #endregion
          }}
          onClick={() => {
            // #region debug-point AH:emoji-click
            reportReactionPickerInput(
              message.ulid,
              pickerOpen,
              'emoji click',
              { emoji },
            );
            // #endregion
            onReact(message, emoji);
            restoreReactionFocusRef.current = true;
            setPickerOpen(false);
          }}
          style={{
            width: 28,
            height: 28,
            padding: 0,
            border: 0,
            borderRadius: 8,
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 17,
          }}
        >
          {emoji}
        </button>
      )) : (
        <>
          <Tooltip title={t('chat.social.thread.open')}>
            <Button
              data-message-action="thread"
              type="text"
              size="small"
              icon={<MessagesSquare size={14} />}
              onClick={() => runAndDismiss(() => onOpenThread(
                messageThreadRootUlid(message) || message.ulid,
              ))}
              style={actionButtonStyle}
            />
          </Tooltip>
          <Tooltip title={t('chat.social.messageArea.actionReact')}>
            <Button
              data-message-action="reaction"
              type="text"
              size="small"
              icon={<SmilePlus size={14} />}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen(true)}
              style={actionButtonStyle}
            />
          </Tooltip>
          <Tooltip title={t('chat.social.contextMenu.pin')}>
            <Button
              data-message-action="pin"
              type="text"
              size="small"
              icon={<Pin size={14} />}
              onClick={() => runAndDismiss(() => onPin(message))}
              style={actionButtonStyle}
            />
          </Tooltip>
          {!isRecalled && (
            <Tooltip title={t('chat.social.messageArea.actionReply')}>
              <Button
                data-message-action="reply"
                type="text"
                size="small"
                icon={<MessageSquareReply size={14} />}
                onClick={() => {
                  // #region debug-point V-X:reply-action-click
                  fetch('http://127.0.0.1:7778/event', {
                    method: 'POST',
                    body: JSON.stringify({
                      sessionId: 'thread-summary-projection',
                      runId: 'reply-lifecycle-pre-fix',
                      hypothesisId: 'V-X',
                      location: 'ChatMessageActionOverlay:replyClick',
                      msg: '[DEBUG] reply action click entered',
                      data: {
                        messageId: message.ulid,
                        overlayMessageId: target?.message.ulid || '',
                        anchorConnected: Boolean(target?.anchorElement.isConnected),
                      },
                      ts: Date.now(),
                    }),
                  }).catch(() => {});
                  // #endregion
                  runAndDismiss(() => onReply(message.ulid));
                }}
                style={actionButtonStyle}
              />
            </Tooltip>
          )}
          <Tooltip title={t('chat.social.messageArea.actionForward')}>
            <Button
              data-message-action="forward"
              type="text"
              size="small"
              icon={<CornerUpRight size={14} />}
              onClick={() => runAndDismiss(() => onForward(message))}
              style={actionButtonStyle}
            />
          </Tooltip>
          {canEdit && (
            <Tooltip title={t('chat.social.messageArea.actionEdit')}>
              <Button
                data-message-action="edit"
                type="text"
                size="small"
                icon={<Pencil size={14} />}
                onClick={() => runAndDismiss(() => onEdit(message))}
                style={actionButtonStyle}
              />
            </Tooltip>
          )}
          {canRecall && (
            <Tooltip title={t('chat.social.messageArea.actionRecall')}>
              <Button
                data-message-action="retract"
                type="text"
                size="small"
                icon={<RotateCcw size={14} />}
                onClick={() => runAndDismiss(() => onRecall(message))}
                style={actionButtonStyle}
              />
            </Tooltip>
          )}
          <Tooltip title={t('chat.social.messageArea.actionDelete')}>
            <Button
              data-message-action="delete"
              type="text"
              size="small"
              icon={<Trash2 size={14} />}
              onClick={() => runAndDismiss(() => onDelete(message))}
              style={{ ...actionButtonStyle, color: token.colorError }}
            />
          </Tooltip>
        </>
      )}
    </div>,
    hostElement,
  );
}

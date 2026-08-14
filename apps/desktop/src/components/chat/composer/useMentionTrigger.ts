import { useCallback, useRef } from 'react';
import { useMentionStore } from '../../../store/mentions';

// ──────────────────────────────────────────────────────────────────────────────
// useMentionTrigger — detects "@" input to drive the mention popup lifecycle.
// Wire into the ChatComposer's onChange / onKeyDown for full integration.
// ──────────────────────────────────────────────────────────────────────────────

interface MentionTriggerResult {
  /** Call from the input's onChange handler with the full current value and cursor pos. */
  handleInputChange: (value: string, cursorPos: number) => void;
  /** Call from the input's onKeyDown handler for keyboard navigation passthrough. */
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Ref holding the position of the "@" trigger in the text. */
  triggerIndexRef: React.MutableRefObject<number>;
}

/**
 * Hook that monitors text input for "@" mentions.
 * Returns handlers that the ChatComposer should wire into its textarea.
 */
export function useMentionTrigger(): MentionTriggerResult {
  const triggerIndexRef = useRef<number>(-1);

  const handleInputChange = useCallback((value: string, cursorPos: number) => {
    const { showMentionPopup, openPopup, closePopup, setMentionQuery, setCursorPosition } =
      useMentionStore.getState();

    // Scan backwards from cursor to find an unescaped "@".
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex === -1) {
      if (showMentionPopup) closePopup();
      triggerIndexRef.current = -1;
      return;
    }

    // The "@" must be at the start or preceded by a whitespace/newline.
    const charBefore = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
    const isValidTrigger = charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0;

    if (!isValidTrigger) {
      if (showMentionPopup) closePopup();
      triggerIndexRef.current = -1;
      return;
    }

    // Extract the query between "@" and the cursor.
    const query = textBeforeCursor.slice(lastAtIndex + 1);

    // Close if user typed a space after query (finished typing, no selection made).
    if (query.includes(' ')) {
      if (showMentionPopup) closePopup();
      triggerIndexRef.current = -1;
      return;
    }

    triggerIndexRef.current = lastAtIndex;
    setCursorPosition(cursorPos);
    setMentionQuery(query);

    if (!showMentionPopup) {
      openPopup();
    }
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const { showMentionPopup } = useMentionStore.getState();
      if (!showMentionPopup) return false;

      // When popup is open, arrow keys / enter / escape are consumed by MentionPopup.
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'Enter' ||
        event.key === 'Escape'
      ) {
        return true; // Signal to caller: event was handled by mention system.
      }
      return false;
    },
    [],
  );

  return { handleInputChange, handleKeyDown, triggerIndexRef };
}

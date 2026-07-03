import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { theme } from 'antd';
import { Flexbox } from 'react-layout-kit';

// ─── Public Interface ────────────────────────────────────────────────────────

export interface PinInputProps {
  /** Number of digits (default 6) */
  length?: number;
  /** Called once all digits filled, after submitDelay ms */
  onComplete: (pin: string) => void;
  /** Delay before calling onComplete (default 140ms) */
  submitDelay?: number;
  /** Disable all inputs */
  disabled?: boolean;
  /** Error message (shown below inputs) */
  error?: string;
  /** Clear the inputs (increment to trigger reset) */
  resetKey?: number;
  /** Auto-focus the first input on mount */
  autoFocus?: boolean;
}

export interface PinInputRef {
  focus: () => void;
  clear: () => void;
}

// ─── Individual Digit Box ────────────────────────────────────────────────────

interface PinDigitInputProps {
  value: string;
  disabled: boolean;
  focused: boolean;
  onChange: (index: number, value: string) => void;
  onKeyDown: (index: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: (index: number) => void;
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  index: number;
  inputRef: (el: HTMLInputElement | null) => void;
}

const PinDigitInput = memo(
  ({ value, disabled, focused, onChange, onKeyDown, onFocus, onPaste, index, inputRef }: PinDigitInputProps) => {
    const { token } = theme.useToken();

    const borderColor = value ? token.colorPrimary : token.colorBorderSecondary;
    const boxShadow = focused ? `0 0 0 2px ${token.colorPrimary}20` : 'none';

    return (
      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        maxLength={1}
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(index, e.target.value)}
        onKeyDown={(e) => onKeyDown(index, e)}
        onFocus={() => onFocus(index)}
        onPaste={onPaste}
        style={{
          width: 44,
          height: 52,
          borderRadius: 12,
          border: `2px solid ${borderColor}`,
          background: token.colorBgLayout,
          color: token.colorText,
          fontSize: 22,
          fontWeight: 'bold',
          textAlign: 'center',
          outline: 'none',
          boxShadow,
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          caretColor: 'transparent',
        }}
      />
    );
  },
  (prev, next) =>
    prev.value === next.value &&
    prev.disabled === next.disabled &&
    prev.focused === next.focused,
);

PinDigitInput.displayName = 'PinDigitInput';

// ─── Main PinInput Component ─────────────────────────────────────────────────

export const PinInput = memo(
  forwardRef<PinInputRef, PinInputProps>(
    (
      {
        length = 6,
        onComplete,
        submitDelay = 140,
        disabled = false,
        error,
        resetKey,
        autoFocus = false,
      },
      ref,
    ) => {
      const { token } = theme.useToken();

      const [digits, setDigits] = useState<string[]>(() => Array(length).fill(''));
      const [focusedIndex, setFocusedIndex] = useState<number>(-1);
      const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
      const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

      // Expose imperative methods
      useImperativeHandle(ref, () => ({
        focus: () => {
          inputsRef.current[0]?.focus();
        },
        clear: () => {
          setDigits(Array(length).fill(''));
          inputsRef.current[0]?.focus();
        },
      }));

      // Reset when resetKey changes
      useEffect(() => {
        if (resetKey === undefined) return;
        setDigits(Array(length).fill(''));
        // Defer focus to next frame so DOM is ready after state flush
        requestAnimationFrame(() => {
          inputsRef.current[0]?.focus();
        });
      }, [resetKey, length]);

      // Auto-focus on mount
      useEffect(() => {
        if (autoFocus) {
          inputsRef.current[0]?.focus();
        }
      }, [autoFocus]);

      // Auto-submit when all digits filled
      useEffect(() => {
        if (submitTimerRef.current) {
          clearTimeout(submitTimerRef.current);
          submitTimerRef.current = null;
        }

        const pin = digits.join('');
        if (pin.length === length && digits.every((d) => d !== '')) {
          submitTimerRef.current = setTimeout(() => {
            onComplete(pin);
          }, submitDelay);
        }

        return () => {
          if (submitTimerRef.current) {
            clearTimeout(submitTimerRef.current);
          }
        };
      }, [digits, length, onComplete, submitDelay]);

      // Stable callback: handle digit change
      const handleChange = useCallback(
        (index: number, value: string) => {
          // Only allow single digit
          const digit = value.replace(/\D/g, '').slice(-1);
          if (!digit && value !== '') return;

          setDigits((prev) => {
            const next = [...prev];
            next[index] = digit;
            return next;
          });

          // Auto-advance to next input
          if (digit && index < length - 1) {
            inputsRef.current[index + 1]?.focus();
          }
        },
        [length],
      );

      // Stable callback: handle key down
      const handleKeyDown = useCallback(
        (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Backspace') {
            setDigits((prev) => {
              if (prev[index]) {
                // Clear current digit
                const next = [...prev];
                next[index] = '';
                return next;
              }
              // Move to previous and clear it
              if (index > 0) {
                const next = [...prev];
                next[index - 1] = '';
                requestAnimationFrame(() => {
                  inputsRef.current[index - 1]?.focus();
                });
                return next;
              }
              return prev;
            });
            e.preventDefault();
          } else if (e.key === 'ArrowLeft' && index > 0) {
            inputsRef.current[index - 1]?.focus();
            e.preventDefault();
          } else if (e.key === 'ArrowRight' && index < length - 1) {
            inputsRef.current[index + 1]?.focus();
            e.preventDefault();
          }
        },
        [length],
      );

      // Stable callback: handle focus
      const handleFocus = useCallback((index: number) => {
        setFocusedIndex(index);
      }, []);

      // Stable callback: handle blur (tracked via onBlur on container)
      const handleContainerBlur = useCallback(() => {
        setFocusedIndex(-1);
      }, []);

      // Stable callback: handle paste
      const handlePaste = useCallback(
        (e: React.ClipboardEvent<HTMLInputElement>) => {
          e.preventDefault();
          const pasted = e.clipboardData.getData('text/plain').replace(/\D/g, '').slice(0, length);
          if (!pasted) return;

          setDigits((prev) => {
            const next = [...prev];
            for (let i = 0; i < pasted.length; i++) {
              next[i] = pasted[i];
            }
            return next;
          });

          // Focus the next empty or last input
          const focusTarget = Math.min(pasted.length, length - 1);
          requestAnimationFrame(() => {
            inputsRef.current[focusTarget]?.focus();
          });
        },
        [length],
      );

      // Stable ref callback factory
      const getInputRef = useCallback(
        (index: number) => (el: HTMLInputElement | null) => {
          inputsRef.current[index] = el;
        },
        [],
      );

      return (
        <Flexbox align="center" gap={0}>
          <Flexbox
            horizontal
            gap={8}
            align="center"
            onBlur={handleContainerBlur}
          >
            {Array.from({ length }, (_, i) => (
              <PinDigitInput
                key={i}
                index={i}
                value={digits[i]}
                disabled={disabled}
                focused={focusedIndex === i}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onFocus={handleFocus}
                onPaste={handlePaste}
                inputRef={getInputRef(i)}
              />
            ))}
          </Flexbox>
          {error && (
            <div
              style={{
                marginTop: 8,
                fontSize: 13,
                color: token.colorError,
                textAlign: 'center',
              }}
            >
              {error}
            </div>
          )}
        </Flexbox>
      );
    },
  ),
);

PinInput.displayName = 'PinInput';

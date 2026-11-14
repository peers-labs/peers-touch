import {
  cloneElement, forwardRef, isValidElement, useCallback, useId, useLayoutEffect, useRef, useState,
  type HTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode,
} from 'react';
import type { Availability, Density, FieldValidation } from '@peers-touch/ui-contracts';
import { disabledReason } from '@peers-touch/ui-semantics';
import { IconButton } from './actions';
import { useInputFocusPolicy } from './focus';

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  fieldId?: string; label?: ReactNode; description?: ReactNode; validation?: FieldValidation;
  required?: boolean; children: ReactNode;
}
export function Field({ fieldId, label, description, validation, required, children, className = '', ...props }: FieldProps) {
  const generated = useId(), id = fieldId ?? generated, invalid = validation?.state === 'invalid';
  const describedBy = [description ? `${id}-description` : '', invalid ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return <div {...props} className={`pt-field ${className}`}>
    {label && <label className="pt-field-label" htmlFor={id}>{label}{required && <span aria-hidden="true">*</span>}</label>}
    {isValidElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>(children)
      ? cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': invalid }) : children}
    {description && <div id={`${id}-description`} className="pt-field-description">{description}</div>}
    {invalid && <div id={`${id}-error`} className="pt-field-error" role="alert">{validation.message}</div>}
  </div>;
}
export interface FieldFrameProps extends HTMLAttributes<HTMLDivElement> {
  invalid?: boolean; disabled?: boolean; children: ReactNode;
  /** A single writing dock for input, tools and submit; children use embedded framing. */
  appearance?: 'composer';
}
export function FieldFrame({ invalid, disabled, appearance, className = '', ...props }: FieldFrameProps) {
  return <div {...props} className={`pt-field-frame ${className}`} data-focus-boundary
    {...(appearance ? { 'data-appearance': appearance } : {})}
    data-invalid={invalid || undefined} data-disabled={disabled || undefined} />;
}
export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  leading?: ReactNode; trailing?: ReactNode; density?: Density;
  /** Search owns the shared accent focus and in-place reveal grammar. */
  appearance?: 'field' | 'search';
  reveal?: boolean;
  availability?: Availability; clearable?: boolean; onClear?: () => void;
  clearLabel?: string;
  // Semantic value channel, parallel to NumberField/Select/Slider. FormField
  // binds through it; it is destructured here so it never reaches the DOM
  // (React rejects unknown on* props on native elements).
  onValueChange?: (value: string) => void;
  onEnter?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({
  leading, trailing, density = 'normal', appearance = 'field', reveal = false,
  availability, clearable, clearLabel = 'Clear', onClear, onEnter, onKeyDown,
  onChange, onValueChange, className = '', style, ...props
}, ref) {
  const inputFocus = useInputFocusPolicy();
  const reason = disabledReason(availability), disabled = props.disabled || availability?.kind === 'disabled';
  return <FieldFrame disabled={disabled} invalid={!!props['aria-invalid']} style={style}
    data-appearance={appearance} data-density={density} data-reveal={reveal || undefined}>
    {leading}<input {...props} autoFocus={inputFocus === 'automatic' && props.autoFocus} ref={ref} className={`pt-input ${className}`} disabled={disabled}
      title={reason ?? props.title} data-density={density}
      onChange={event => { onChange?.(event); onValueChange?.(event.target.value); }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === 'Enter' && !event.nativeEvent.isComposing) onEnter?.(event);
      }} />
    {clearable && props.value !== '' && props.value !== undefined && (
      <IconButton actionId="field.clear" iconId="close" label={clearLabel} density="compact" emphasis="quiet"
        onActivate={() => onClear?.()} />)}
    {trailing}
  </FieldFrame>;
});
export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  minimumRows?: number; maximumRows?: number; onEnter?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  characterCount?: boolean; framing?: 'field' | 'embedded';
  /** Own content measurement here; callers choose row limits instead of mutating height. */
  autoGrow?: boolean; density?: Density;
  /** Inline affordance pinned to the field's own bottom-left chrome (e.g. an
      attach-image icon). It shares the counter's inside-frame rail, so a
      single action never becomes a standalone control floating in empty
      space below the field. */
  leadingAccessory?: ReactNode;
  // Semantic value channel; destructured so FormField's binding never leaks
  // onto the native textarea.
  onValueChange?: (value: string) => void;
}
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({
  className = '', style, minimumRows, maximumRows, onEnter, onKeyDown, characterCount, framing = 'field',
  autoGrow = false, density = 'normal',
  leadingAccessory, onChange, onValueChange, ...props
}, ref) {
  const inputFocus = useInputFocusPolicy();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bindRef = useCallback((element: HTMLTextAreaElement | null) => {
    inputRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  }, [ref]);
  const grow = useCallback(() => {
    const element = inputRef.current;
    if (!autoGrow || !element) return;
    const computed = getComputedStyle(element);
    const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.5;
    const padding = Number.parseFloat(computed.paddingTop) + Number.parseFloat(computed.paddingBottom);
    const floor = Math.max(1, minimumRows ?? props.rows ?? 1);
    const ceiling = Math.max(floor, maximumRows ?? floor);
    const minimumHeight = Math.max(
      floor * lineHeight + padding,
      Number.parseFloat(computed.minHeight) || 0,
    );
    const maximumHeight = Math.max(minimumHeight, ceiling * lineHeight + padding);
    element.style.height = 'auto';
    const height = Math.min(Math.max(element.scrollHeight, minimumHeight), maximumHeight);
    element.style.height = `${height}px`;
    element.style.overflowY = element.scrollHeight > height + 1 ? 'auto' : 'hidden';
  }, [autoGrow, maximumRows, minimumRows, props.rows]);
  useLayoutEffect(() => {
    grow();
    const element = inputRef.current;
    if (!autoGrow || !element || typeof ResizeObserver === 'undefined') return;
    let measurementKey = '';
    const observer = new ResizeObserver(() => {
      const computed = getComputedStyle(element);
      const nextKey = `${element.clientWidth}:${computed.lineHeight}:${computed.paddingTop}:${computed.paddingBottom}:${computed.minHeight}`;
      if (nextKey !== measurementKey) { measurementKey = nextKey; grow(); }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [autoGrow, grow, props.value, density]);
  return <FieldFrame invalid={!!props['aria-invalid']} disabled={props.disabled} style={style} data-framing={framing} data-multiline="true" data-density={density}>
    <textarea {...props} autoFocus={inputFocus === 'automatic' && props.autoFocus} ref={bindRef} className={`pt-textarea ${className}`} rows={props.rows ?? minimumRows ?? 3} data-density={density}
      style={!autoGrow && maximumRows ? { maxHeight: `${maximumRows * 1.5 + 1}em` } : undefined}
      onChange={event => { onChange?.(event); onValueChange?.(event.target.value); grow(); }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === 'Enter' && !event.nativeEvent.isComposing) onEnter?.(event);
      }} />
    {(characterCount || leadingAccessory) && (
      <span className="pt-textarea-foot">
        {leadingAccessory && <span className="pt-textarea-accessory">{leadingAccessory}</span>}
        {characterCount && <span className="pt-character-count">{String(props.value ?? props.defaultValue ?? '').length}{props.maxLength ? ` / ${props.maxLength}` : ''}</span>}
      </span>
    )}
  </FieldFrame>;
});
export const PasswordField = forwardRef<HTMLInputElement, TextFieldProps>(function PasswordField(props, ref) {
  const [revealed, setRevealed] = useState(false);
  return <TextField {...props} ref={ref} type={revealed ? 'text' : 'password'}
    trailing={<button type="button" className="pt-link" aria-label={revealed ? 'Hide password' : 'Show password'}
      onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Show'}</button>} />;
});
export interface NumberFieldProps extends Omit<TextFieldProps, 'value' | 'defaultValue' | 'onChange' | 'onValueChange' | 'type'> {
  value?: number | null; defaultValue?: number; onValueChange?: (value: number | null) => void; precision?: number;
}
export function NumberField({ value, defaultValue, onValueChange, precision, className='', ...props }: NumberFieldProps) {
  return <TextField {...props} className={`pt-number-input ${className}`} type="number" value={value ?? (value === null ? '' : undefined)} defaultValue={defaultValue}
    onChange={event => {
      const raw = event.target.value;
      if (raw === '') { onValueChange?.(null); return; }
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) onValueChange?.(precision === undefined ? numeric : Number(numeric.toFixed(precision)));
    }} />;
}
export interface OTPFieldProps {
  label: string; length?: number; value: string; onValueChange: (value: string) => void; disabled?: boolean;
}
export function OTPField({ label, length = 6, value, onValueChange, disabled }: OTPFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  return <Field label={label}><TextField ref={input} value={value} disabled={disabled}
    autoComplete="one-time-code" inputMode="numeric" maxLength={length}
    onChange={event => onValueChange(event.target.value.replace(/\D/g, '').slice(0, length))} /></Field>;
}

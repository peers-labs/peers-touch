import { forwardRef, useEffect, useId, useState, type ButtonHTMLAttributes, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { activationAllowed, disabledReason } from '@peers-touch/ui-semantics';
import type { ActionExecution, Availability, Density, Emphasis, ActionTone, ActionBehavior } from '@peers-touch/ui-contracts';
import type { IconId } from '@peers-touch/ui-assets';
import { Icon } from './icon';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled'> {
  actionId: string;
  label?: string;
  emphasis?: Emphasis;
  tone?: ActionTone;
  density?: Density;
  behavior?: ActionBehavior;
  availability?: Availability;
  execution?: ActionExecution;
  executionLabel?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  fullWidth?: boolean;
  onActivate?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  actionId, label, children, emphasis = 'secondary', tone = 'neutral', density = 'normal',
  behavior = 'action', availability, execution = 'idle', executionLabel,
  leading, trailing, fullWidth, onActivate, onClick, className = '', ...props
}, ref) {
  const reason = disabledReason(availability);
  const allowed = activationAllowed(availability, execution);
  // B19: an unavailable command stays focusable and exposes its reason to AT;
  // activation is intercepted here instead of relying on the native disabled
  // attribute (whose title is unreachable by keyboard/touch and never read).
  const reasonId = useId();
  const busy = execution === 'pending' || execution === 'recovering';
  return (
    <button {...props} ref={ref} type={behavior === 'action' ? 'button' : behavior}
      className={`pt-button ${className}`} data-action-id={actionId} data-emphasis={emphasis}
      data-tone={tone} data-density={density} data-execution={execution}
      data-full-width={fullWidth || undefined}
      aria-disabled={!allowed || undefined} aria-busy={busy || undefined}
      aria-label={props['aria-label'] ?? label}
      aria-describedby={reason ? `${reasonId} ${props['aria-describedby'] ?? ''}`.trim() : props['aria-describedby']}
      title={reason ?? props.title}
      onClick={event => {
        if (!allowed) { event.preventDefault(); return; }
        (onActivate ?? onClick)?.(event);
      }}>
      <span className="pt-button-content">{leading}{label ?? children}{trailing}</span>
      {busy && (
        <span className="pt-button-pending" role="status" aria-label={executionLabel ?? 'Pending'}>
          <span className="pt-spinner" />
        </span>
      )}
      {reason && <span id={reasonId} className="pt-sr-only">{reason}</span>}
    </button>
  );
});
export interface IconButtonProps extends Omit<ButtonProps, 'label' | 'children' | 'leading' | 'trailing'> {
  iconId: IconId;
  iconSize?: number;
  label: string;
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  iconId, iconSize, label, className = '', ...props
}, ref) {
  if (!label.trim()) throw new Error('IconButton requires a visible or accessible action label.');
  return <Button {...props} ref={ref} label={undefined} aria-label={label} title={props.title ?? label}
    className={`pt-icon-button ${className}`}><Icon iconId={iconId} size={iconSize} /></Button>;
});
export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> { emphasis?: 'inline' | 'quiet'; truncate?: boolean }
export function Link({ emphasis = 'inline', truncate, style, className = '', ...props }: LinkProps) {
  return <a {...props} style={{ ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const : {}), ...style }}
    className={`pt-link ${className}`} data-emphasis={emphasis} />;
}
export interface ToggleProps extends Omit<ButtonProps, 'onActivate' | 'aria-pressed'> {
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}
export function Toggle({ selected, onSelectedChange, ...props }: ToggleProps) {
  return <Button {...props} aria-pressed={selected} onActivate={() => onSelectedChange(!selected)} />;
}
export interface CopyButtonProps extends Omit<ButtonProps, 'onActivate'> {
  text: string;
  copiedLabel: string;
  copiedDurationMs?: number;
  clipboardPort?: { writeText: (text: string) => Promise<void> };
  onCopyError?: (error: unknown) => void;
}
export function CopyButton({ text, copiedLabel, copiedDurationMs = 2500, label, onCopyError, clipboardPort, ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  // B07: success is a transient confirmation, not a permanent relabel; the
  // timer is owned by the control and cleared on unmount/re-copy.
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), copiedDurationMs);
    return () => window.clearTimeout(timer);
  }, [copied, copiedDurationMs]);
  return <Button {...props} aria-live="polite" leading={<Icon iconId={copied ? 'check' : 'copy'} />}
    onActivate={async () => {
      try { await (clipboardPort ?? navigator.clipboard).writeText(text); setCopied(true); }
      catch (error) { setCopied(false); onCopyError?.(error); }
    }}>
    <span className="pt-copy-label">
      <span className={copied ? 'pt-copy-permanent pt-is-hidden-visually' : 'pt-copy-permanent'}>{label}</span>
      {copied && <span className="pt-copy-transient" role="status">{copiedLabel}</span>}
    </span>
  </Button>;
}
export interface DownloadButtonProps extends Omit<LinkProps, 'href' | 'download'> {
  source: string; filename: string; label: string;
}
export function DownloadButton({ source, filename, label, ...props }: DownloadButtonProps) {
  return <Link {...props} href={source} download={filename}>{label}</Link>;
}
export interface ActionGroupProps { label: string; children: ReactNode; className?: string }
export function ActionGroup({ label, children, className = '' }: ActionGroupProps) {
  return <div className={`pt-action-group ${className}`} role="group" aria-label={label}>{children}</div>;
}

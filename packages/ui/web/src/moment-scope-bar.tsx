import { useRef } from 'react';
import { IconButton } from './actions';
import { TextField } from './fields';
import { Icon } from './icon';
import { Segmented } from './selection';
import './moments.css';

export interface MomentScopeBarProps<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  query: string;
  onQueryChange: (query: string) => void;
  copy: { scope: string; search: string; action: string };
  actionId: string;
  actionClassName?: string;
  actionAcceptanceId?: string;
  onAction: () => void;
  disabled?: boolean;
}

/** One scope, one nearby search and one fixed action slot. */
export function MomentScopeBar<T extends string>({ value, options, onChange, query, onQueryChange,
  copy, actionId, actionClassName = '', actionAcceptanceId, onAction, disabled }: MomentScopeBarProps<T>) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="sk-moments-subbar">
    <Segmented<T> label={copy.scope} density="compact" options={[...options]} scrollable
      className="sk-scope-island" value={value} disabled={disabled} onValueChange={next => { if (next) onChange(next); }} />
    <div className="sk-scope-wrap" onClick={event => {
      if (!(event.target as HTMLElement).closest('input,button,a')) input.current?.focus();
    }}>
      <TextField ref={input} className="sk-scope-search" aria-label={copy.search}
        data-scope-search={value} placeholder={copy.search} value={query} onValueChange={onQueryChange}
        clearable onClear={() => onQueryChange('')} leading={<Icon iconId="search" size={15} />}
        density="compact" disabled={disabled} />
    </div>
    <IconButton actionId={actionId} iconId="plus" iconSize={18} label={copy.action}
      emphasis="secondary" className={`sk-subbar-add ${actionClassName}`}
      data-acceptance-id={actionAcceptanceId} onActivate={onAction}
      availability={disabled ? { kind: 'disabled', reason: copy.action } : undefined} />
  </div>;
}

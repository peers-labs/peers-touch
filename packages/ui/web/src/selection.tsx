import { Children, isValidElement, forwardRef, useEffect, useId, useRef, useState, type CSSProperties, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import type { Availability, ChoiceOption, Density } from '@peers-touch/ui-contracts';
import { nextEnabledIndex } from '@peers-touch/ui-semantics';
import { Button } from './actions';
import { Icon } from './icon';
import { TextField } from './fields';
import { Popover } from './overlays';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  indeterminate?: boolean; label?: ReactNode;
  // Semantic checked channel used by FormField; destructured so it never
  // leaks as an unknown on* property onto the native input.
  onCheckedChange?: (checked: boolean) => void;
}
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({
  indeterminate, label, children, onChange, onCheckedChange, ...props
}, ref) {
  return <label className="pt-check-label"><input {...props} type="checkbox" ref={node => {
    if (node) node.indeterminate = !!indeterminate;
    if (typeof ref === 'function') ref(node); else if (ref) ref.current = node;
  }} aria-checked={indeterminate ? 'mixed' : props.checked}
    onChange={event => { onChange?.(event); onCheckedChange?.(event.target.checked); }} />{label ?? children}</label>;
});
export interface SelectionOption<T extends string | number = string> extends Omit<ChoiceOption<T>, 'label'> {
  label: ReactNode; searchText?: string; leading?:ReactNode;
  groupLabel?: string; attributes?: HTMLAttributes<HTMLButtonElement>;
}
function readableText(node: ReactNode): string {
  return Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number' ? String(child)
    : isValidElement<{children?:ReactNode}>(child) ? readableText(child.props.children) : '').join(' ');
}
export interface ChoiceGroupProps<T extends string | number> {
  label?: string; options: readonly (SelectionOption<T> | T)[]; value?: readonly T[]; onValueChange?: (value: T[]) => void;
  style?: CSSProperties; className?: string; disabled?: boolean;
}
export function CheckboxGroup<T extends string | number>({ label, options, value = [], onValueChange, style, className = '', disabled }: ChoiceGroupProps<T>) {
  return <div className={`pt-choice-group ${className}`} role="group" aria-label={label} style={style}>
    {options.map(entry => { const option = typeof entry === 'object' ? entry : {value:entry,label:String(entry)};
      return <Checkbox key={option.value} checked={value.includes(option.value)}
      disabled={disabled || option.availability?.kind === 'disabled'} label={<>{option.leading}{option.label}</>}
      onChange={event => onValueChange?.(event.target.checked ? [...value, option.value] : value.filter(v => v !== option.value))} />; })}
  </div>;
}
export interface RadioProps extends Omit<CheckboxProps, 'indeterminate'> { name?: string }
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio({ label, children, ...props }, ref) {
  return <label className="pt-check-label"><input {...props} ref={ref} type="radio" />{label ?? children}</label>;
});
export interface RadioGroupProps<T extends string | number> extends Omit<ChoiceGroupProps<T>, 'value' | 'onValueChange'> {
  value?: T; onValueChange?: (value: T) => void;
}
export function RadioGroup<T extends string | number>({ options, value, onValueChange, label, disabled, style, className = '' }: RadioGroupProps<T>) {
  const name = useId();
  return <div className={`pt-choice-group ${className}`} role="radiogroup" aria-label={label} style={style}>
    {options.map(entry => { const option = typeof entry === 'object' ? entry : {value:entry,label:String(entry)};
      return <Radio key={option.value} name={name} label={<>{option.leading}{option.label}</>} checked={value === option.value}
      disabled={disabled || option.availability?.kind === 'disabled'} onChange={() => onValueChange?.(option.value)} />; })}
  </div>;
}
export interface SwitchProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean; label?: string; checkedLabel?: ReactNode; uncheckedLabel?: ReactNode; availability?: Availability;
}
export function Switch({ checked: controlled, defaultChecked = false, onCheckedChange, disabled, label, checkedLabel, uncheckedLabel,
  availability, className = '', ...props }: SwitchProps) {
  const [local, setLocal] = useState(defaultChecked), checked = controlled ?? local;
  const isDisabled = disabled || availability?.kind === 'disabled';
  // The track is a fixed intrinsic control; its state text belongs beside it,
  // never inside it (an in-track label stretches the track to container width).
  const stateText = checked ? checkedLabel : uncheckedLabel;
  const text = label ?? stateText;
  const accessibleName = label
    ?? (typeof stateText === 'string' ? stateText : undefined)
    ?? props['aria-label'];
  const track = <button {...props} className={`pt-switch ${className}`} type="button" role="switch" aria-checked={checked}
    aria-label={accessibleName} disabled={isDisabled}
    onClick={event => { props.onClick?.(event); if (!event.defaultPrevented) { setLocal(!checked); onCheckedChange?.(!checked); } }}>
    <span className="pt-switch-thumb" />
  </button>;
  if (!text) return track;
  return <span className="pt-switch-row">
    {track}
    <span className="pt-switch-label" aria-hidden="true">{text}</span>
  </span>;
}
export interface SelectProps<T extends string | number = string> extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  options: readonly SelectionOption<T>[]; value?: T | readonly T[]; defaultValue?: T | readonly T[];
  onValueChange?: (value: T | T[] | undefined) => void;
  multiple?: boolean; searchable?: boolean; placeholder?: string; label?: string;
  disabled?: boolean; density?: Density; clearable?: boolean;
  /** field = bordered input box for real forms; ghost = quiet row action
      (transparent at rest, well on hover/open) for flat settings lists. */
  appearance?: 'field' | 'ghost';
  onQueryChange?: (query: string) => void; pending?: boolean; emptyLabel?: string; pendingLabel?: string; createValue?:(query:string)=>T;
}
export function Select<T extends string | number>({
  options, value: controlled, defaultValue, onValueChange, multiple, searchable, placeholder = 'Select',
  label, disabled, density, clearable, appearance = 'field', onQueryChange, pending, createValue, emptyLabel = 'No options', pendingLabel, className = '', style,
  id: controlId, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props
}: SelectProps<T>) {
  const [local, setLocal] = useState<T | readonly T[] | undefined>(defaultValue), value = controlled ?? local;
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0);
  const [menuMinWidth, setMenuMinWidth] = useState<number>();
  const rootRef = useRef<HTMLDivElement>(null);
  const [created,setCreated]=useState<SelectionOption<T>[]>([]);
  // The dropdown hugs its content but never shrinks below the trigger: a
  // fixed arbitrary px floor would leave a sea of dead space next to short
  // options (see components.md §9). Width is therefore max(trigger, widest
  // item), measured at open from the live trigger rect.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      const trigger = rootRef.current?.querySelector<HTMLElement>('.pt-select-trigger');
      if (trigger) setMenuMinWidth(trigger.getBoundingClientRect().width);
    }
    setOpen(next);
  };
  const allOptions=[...options,...created.filter(entry=>!options.some(option=>option.value===entry.value))];
  const list = useRef<HTMLDivElement>(null), id = useId();
  const selected = (v: T) => Array.isArray(value) ? value.includes(v) : value === v;
  const filtered = allOptions.filter(option => !query || (option.searchText ?? readableText(option.label)).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const setValue = (v: T | T[] | undefined) => { setLocal(v); onValueChange?.(v); };
  const captions = allOptions.filter(option => selected(option.value));
  const caption = captions.length ? captions.map((option,index) => <span key={option.value}>{index ? ', ' : ''}{option.label}</span>) : placeholder;
  return <div {...props} ref={rootRef} className={`pt-select ${className}`} data-appearance={appearance} style={style}>
    <Popover open={open} onOpenChange={handleOpenChange} label={label} className="pt-select-popover"
      content={<div className="pt-select-panel" style={menuMinWidth ? { minWidth: menuMinWidth } : undefined} onKeyDown={event => {
        const fromInput = event.target instanceof HTMLInputElement;
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
          || (fromInput && (event.key === 'Home' || event.key === 'End'))) return;
        event.preventDefault();
        const current = fromInput ? event.key === 'ArrowDown' ? -1 : 0 : active;
        const next = event.key === 'Home' ? nextEnabledIndex(-1, 1, filtered.length, i => filtered[i].availability?.kind === 'disabled')
          : event.key === 'End' ? nextEnabledIndex(0, -1, filtered.length, i => filtered[i].availability?.kind === 'disabled')
            : nextEnabledIndex(current, event.key === 'ArrowDown' ? 1 : -1, filtered.length, i => filtered[i].availability?.kind === 'disabled');
        setActive(next); list.current?.querySelectorAll<HTMLButtonElement>('[role=option]')[next]?.focus();
      }}>
        {searchable && <TextField aria-label={label ? `${label}: search` : 'Search options'} value={query} onEnter={event=>{
          if(!createValue||!query.trim())return;event.preventDefault();
          const next=createValue(query.trim());setCreated(old=>old.some(entry=>entry.value===next)?old:[...old,{value:next,label:query.trim()}]);
          const values=Array.isArray(value)?value:[];
          setValue(multiple?(values.includes(next)?[...values]:[...values,next]):next);setQuery('');if(!multiple)setOpen(false);
        }}
          onChange={event => { setQuery(event.target.value); onQueryChange?.(event.target.value); setActive(0); }} />}
        {pending && <div role="status" aria-live="polite">{pendingLabel}</div>}
        <div ref={list} id={id} className="pt-select-options" role="listbox" aria-label={label}
          aria-multiselectable={multiple || undefined}>
          {filtered.map((option, index) => <div key={option.value} role="presentation">
            {option.groupLabel && filtered[index-1]?.groupLabel !== option.groupLabel && <div className="pt-select-group">{option.groupLabel}</div>}
            <button {...option.attributes} type="button" role="option"
            className="pt-select-option" aria-selected={selected(option.value)} tabIndex={index === active ? 0 : -1}
            disabled={option.availability?.kind === 'disabled'} title={option.availability?.kind === 'disabled' ? option.availability.reason : undefined}
            onClick={() => {
              if (multiple) {
                const values = Array.isArray(value) ? value : [];
                setValue(selected(option.value) ? values.filter(v => v !== option.value) : [...values, option.value]);
              } else { setValue(option.value); setOpen(false); }
            }}>{selected(option.value) && <Icon iconId="check" size={14} />}{option.leading}<span>{option.label}</span></button></div>)}
          {!filtered.length && <div className="pt-empty">{emptyLabel}</div>}
        </div>
        {clearable && <Button actionId="select.clear" label="Clear" emphasis="quiet" onActivate={() => setValue(multiple ? [] : undefined)} />}
      </div>}>
      <Button actionId="select.open" className="pt-select-trigger" density={density ?? (appearance === 'ghost' ? 'compact' : undefined)}
        availability={disabled ? { kind: 'disabled', reason: 'Selection is unavailable' } : undefined}
        id={controlId} role="combobox" aria-haspopup="listbox" aria-controls={id} aria-label={label}
        aria-describedby={describedBy} aria-invalid={invalid} trailing={<Icon iconId="chevron-down" />}>
        <span className="pt-select-label">{caption}</span>
      </Button>
    </Popover>
  </div>;
}
/** Stateless cramp criterion: the fully-labelled island collapses to icons
 *  only when its intrinsic width cannot fit the container. Kept separate from
 *  the component so the narrow→collapsed→wide sequence is unit-testable
 *  without a DOM; the 1px epsilon absorbs sub-pixel rounding noise. */
export function shouldCollapseToIcons(requiredWidth: number, containerWidth: number): boolean {
  return requiredWidth > containerWidth + 1;
}
export interface SegmentedProps<T extends string | number> extends RadioGroupProps<T> {
  density?: Density; fullWidth?: boolean; className?: string;
  /** Island mode: the group stays on ONE line and scrolls horizontally
      1 instead of wrapping — used when a narrow container must preserve the
      peer elements' relative positions under spatial squeeze. */
  scrollable?: boolean;
  /** Collapse text labels to the leading icons when the island is too narrow.
      Only takes effect when every option supplies a leading icon, so text-only
      groups are never affected. Defaults to true for unified cramp behavior. */
  autoIconOnly?: boolean;
}
export function Segmented<T extends string | number>({ options, value, onValueChange, disabled, label, style, fullWidth, density, scrollable, autoIconOnly = true, className = '' }: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Off-screen probe that always renders the FULL icon+label content in
  // non-shrinking boxes. Its width is the intrinsic labelled width,
  // independent of the current collapsed state — this is what makes collapse
  // and re-expand share one stable criterion instead of inferring overflow
  // from scrollWidth (which flex:1 + min-width:0 keeps equal to clientWidth).
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [iconOnly, setIconOnly] = useState(false);
  const normalized = options.map(entry => typeof entry === 'object' ? entry : { value: entry, label: String(entry) });
  const allHaveLeading = normalized.every(option => option.leading != null);
  const collapseEligible = autoIconOnly && !scrollable && allHaveLeading;
  const contentKey = normalized
    .map(option => `${String(option.value)}:${readableText(option.label)}`)
    .join('|');

  // Keep the active option revealed when the island is scrolled or the value
  // changes (e.g. restored tab), without moving any sibling outside the group.
  useEffect(() => {
    if (!scrollable || !ref.current) return;
    const host = ref.current;
    const active = host.querySelector<HTMLElement>('.pt-button[aria-pressed="true"]');
    if (!active) return;
    // Reveal the active option WITHOUT scrolling any ancestor: adjust only
    // the island's own scrollLeft by the overflow delta.
    const h = host.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    if (a.left < h.left) host.scrollLeft -= h.left - a.left;
    else if (a.right > h.right) host.scrollLeft += a.right - h.right;
  }, [scrollable, value]);

  // Two-state cramp machine: labels show while the parent's flex budget fits
  // the probe's intrinsic labelled width; otherwise only leading icons show.
  // Both numbers are independent of the host's CURRENT width — a collapsed
  // host shrinks to its icon content, so measuring it would self-trap the
  // group in icon-only forever. The parent's width comes from the page's
  // min-width:0 constraint chain and therefore tracks the window faithfully.
  // Groups without leading icons opt out automatically.
  useEffect(() => {
    if (!collapseEligible) {
      setIconOnly(false);
      return;
    }
    const host = ref.current;
    const parent = host?.parentElement;
    if (!host || !parent) return;

    // Full icon+label width. The probe is non-shrinking and never reflects
    // the collapsed state, so this answer is stable across re-measurements.
    const measureRequiredWidth = () => {
      const probe = measureRef.current;
      if (!probe) return 0;
      const hostStyle = window.getComputedStyle(host);
      return probe.scrollWidth
        + parseFloat(hostStyle.paddingLeft)
        + parseFloat(hostStyle.paddingRight);
    };

    // Width the layout grants this island: parent content box minus the
    // outer footprint of every flex sibling and the flex gaps. The probe
    // lives inside the host, so it never counts as a sibling.
    const measureAvailableWidth = () => {
      const parentStyle = window.getComputedStyle(parent);
      let siblingFootprint = 0;
      for (const child of Array.from(parent.children)) {
        if (child === host) continue;
        const childStyle = window.getComputedStyle(child);
        siblingFootprint += (child as HTMLElement).getBoundingClientRect().width
          + parseFloat(childStyle.marginLeft || '0')
          + parseFloat(childStyle.marginRight || '0');
      }
      const gapTotal = parent.children.length > 1
        ? (parseFloat(parentStyle.gap) || 0) * (parent.children.length - 1)
        : 0;
      return parent.clientWidth
        - parseFloat(parentStyle.paddingLeft || '0')
        - parseFloat(parentStyle.paddingRight || '0')
        - siblingFootprint
        - gapTotal;
    };

    const measure = () => {
      const next = shouldCollapseToIcons(measureRequiredWidth(), measureAvailableWidth());
      setIconOnly(previous => (previous === next ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // Only the parent needs observing: it is the sole budget source and its
    // size moves with window/rail resizes while the host's size may not.
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [collapseEligible, contentKey]);

  const collapsed = collapseEligible && iconOnly;
  return <div ref={ref} className={`pt-segmented ${className}`} role="group" aria-label={label}
    data-full-width={fullWidth || undefined} data-scrollable={scrollable || undefined}
    data-crampable={collapseEligible || undefined}
    data-icon-only={collapsed || undefined}
    style={{ width: fullWidth ? '100%' : undefined, ...style }}>
    {collapseEligible && (
      <div ref={measureRef} className="pt-segmented__measure" aria-hidden="true">
        {normalized.map(option => (
          <span key={option.value} className="pt-segmented__measure-item">
            {option.leading}<span>{option.label}</span>
          </span>
        ))}
      </div>
    )}
    {normalized.map(option => {
      const textLabel = typeof option.label === 'string' ? option.label : undefined;
      return <Button key={option.value} actionId={`segment.${option.value}`} density={density}
      emphasis="quiet" aria-pressed={value === option.value}
      availability={disabled ? { kind: 'disabled', reason: 'Selection is unavailable' } : option.availability}
      {...option.attributes}
      aria-label={collapsed ? textLabel : option.attributes?.['aria-label']}
      title={collapsed ? textLabel : option.attributes?.title}
      onActivate={() => onValueChange?.(option.value)}>{option.leading}<span className="pt-segmented__label">{option.label}</span></Button>; })}
  </div>;
}
export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'size'> {
  value?: number; onValueChange?: (value: number) => void; label?: string;
  ticks?: readonly { value: number; label: string }[]; valueLabel?: (value: number) => string;
}
export function Slider({ value, onValueChange, label, ticks, valueLabel, style, ...props }: SliderProps) {
  const id = useId();
  return <div className="pt-slider" style={style}>
    <input {...props} type="range" value={value} list={ticks ? id : undefined}
      aria-label={label ?? props['aria-label']} aria-valuetext={value !== undefined ? valueLabel?.(value) : undefined}
      title={value !== undefined ? valueLabel?.(value) : undefined}
      onChange={event => onValueChange?.(Number(event.target.value))} />
    {ticks && <><datalist id={id}>{ticks.map(tick=><option key={tick.value} value={tick.value} label={tick.label}/>)}</datalist>
      <div className="pt-slider-ticks" aria-hidden="true">{ticks.map(tick=><span key={tick.value}>{tick.label}</span>)}</div></>}
  </div>;
}

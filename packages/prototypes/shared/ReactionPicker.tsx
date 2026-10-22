import './reaction-picker.css';

export interface ReactionPickerItem<T extends string = string> {
  readonly id: T;
  readonly emoji: string;
  readonly label: string;
  readonly selected: boolean;
}

interface ReactionPickerProps<T extends string> {
  readonly items: ReactionPickerItem<T>[];
  readonly label: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onToggle: (id: T) => void;
}

export function ReactionPicker<T extends string>({
  items,
  label,
  className = '',
  disabled = false,
  onToggle,
}: ReactionPickerProps<T>) {
  return (
    <div
      className={`prototype-reaction-picker ${className}`}
      data-reaction-picker
      role="group"
      aria-label={label}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="prototype-reaction-picker-item"
          data-reaction-picker-item={item.id}
          aria-label={item.label}
          aria-pressed={item.selected}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(item.id);
          }}
        >
          <span aria-hidden="true">{item.emoji}</span>
        </button>
      ))}
    </div>
  );
}

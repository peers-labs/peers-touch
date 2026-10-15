import './reaction-picker.css';

export type ReactionPickerItem<T extends string = string> = {
  id: T;
  emoji: string;
  label: string;
  selected: boolean;
};

export function ReactionPicker<T extends string>({
  items,
  label,
  className = '',
  onToggle,
}: {
  items: ReactionPickerItem<T>[];
  label: string;
  className?: string;
  onToggle: (id: T) => void;
}) {
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

import { X } from 'lucide-react';

export function AccessibleClearIcon({ label }: { label: string }) {
  return <X size={13} aria-label={label} />;
}

import { Globe } from 'lucide-react';

export function LanguageSwitcher() {
  return (
    <button type="button" className="mp-language-switcher" aria-label="Language">
      <Globe size={14} />
      <span>EN</span>
    </button>
  );
}

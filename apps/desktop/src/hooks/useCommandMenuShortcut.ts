import { useEffect } from 'react';
import { useCommandMenuStore } from '../store/commandMenu';

/**
 * Cmd+Shift+K opens the separate command directory. Cmd+K belongs to Search.
 * Should be called once in the application root shell.
 */
export function useCommandMenuShortcut(): void {
  const toggle = useCommandMenuStore((s) => s.toggle);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.shiftKey && e.key.toLowerCase() === 'k' && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        toggle();
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [toggle]);
}

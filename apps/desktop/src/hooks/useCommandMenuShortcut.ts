import { useEffect } from 'react';
import { useCommandMenuStore } from '../store/commandMenu';

/**
 * Registers the global Cmd+K / Ctrl+K keyboard shortcut to toggle the command menu.
 * Should be called once in the application root shell.
 */
export function useCommandMenuShortcut(): void {
  const toggle = useCommandMenuStore((s) => s.toggle);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key === 'k') {
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

import { createContext, useContext } from 'react';

export type InputFocusPolicy = 'automatic' | 'explicit';
export const InputFocusContext = createContext<InputFocusPolicy>('automatic');
export function useInputFocusPolicy(): InputFocusPolicy { return useContext(InputFocusContext); }

/** Editing focus can summon a software keyboard; buttons and reading focus cannot. */
export function isEditableFocusTarget(target: Element): boolean {
  return target.matches('textarea,select,input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="hidden"])')
    || (target as HTMLElement).isContentEditable === true;
}

/** Automatic focus owners use this; direct input activation keeps native focus behavior. */
export function restoreNavigationFocus(target: HTMLElement | null, options: FocusOptions = { preventScroll: true }): boolean {
  if (!target?.isConnected || target.closest('[hidden],[inert]')) return false;
  if (isEditableFocusTarget(target)
    && target.closest('[data-pt-input-focus]')?.getAttribute('data-pt-input-focus') === 'explicit'
    && target.ownerDocument.activeElement !== target) return false;
  target.focus(options);
  return true;
}

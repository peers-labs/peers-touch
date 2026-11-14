import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import { getUITokens, tokenVariables, type UITokens } from '@peers-touch/ui-tokens';
import type { ThemeMode } from '@peers-touch/ui-contracts';
import { FeedbackHost, type FeedbackChannel } from './application-feedback';
import { InputFocusContext, restoreNavigationFocus, type InputFocusPolicy } from './focus';
import './styles.css';

interface OverlayRegistration { id: string; modal: boolean }
interface OverlayHostPort {
  element: HTMLDivElement | null;
  register: (entry: OverlayRegistration) => () => void;
  isTop: (id: string) => boolean;
  restoreFocus: (target: HTMLElement) => void;
  focusOrigin: () => HTMLElement | null;
}
const ThemeContext = createContext<UITokens>(getUITokens('light'));
export const OverlayContext = createContext<OverlayHostPort | null>(null);

export interface UIProviderProps {
  children: ReactNode;
  theme?: ThemeMode;
  className?: string;
  style?: CSSProperties;
  feedback?: FeedbackChannel;
  /** Explicit input activation is required before a software keyboard may open. */
  inputFocus?: InputFocusPolicy;
}
export function UIProvider({ children, theme = 'system', className = '', style, feedback, inputFocus = 'automatic' }: UIProviderProps) {
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);
    change();
    return () => media.removeEventListener('change', change);
  }, []);
  const mode = theme === 'system' ? systemDark ? 'dark' : 'light' : theme;
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const entries = useRef<OverlayRegistration[]>([]);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const focusFrames = useRef(new Map<number, Window>());
  const [hasModal, setHasModal] = useState(false);
  const register = useCallback((entry: OverlayRegistration) => {
    for (const [frame, win] of focusFrames.current) win.cancelAnimationFrame(frame);
    focusFrames.current.clear();
    entries.current = [...entries.current.filter(e => e.id !== entry.id), entry];
    setHasModal(entries.current.some(e => e.modal));
    return () => {
      entries.current = entries.current.filter(e => e.id !== entry.id);
      setHasModal(entries.current.some(e => e.modal));
    };
  }, []);
  const isTop = useCallback((id: string) => entries.current[entries.current.length-1]?.id === id, []);
  const focusOrigin = useCallback(() => lastTrigger.current?.isConnected ? lastTrigger.current : null, []);
  const restoreFocus = useCallback((target: HTMLElement) => {
    const win = target.ownerDocument.defaultView;
    if (!win) return;
    const frame = win.requestAnimationFrame(() => {
      focusFrames.current.delete(frame);
      restoreNavigationFocus(target);
    });
    focusFrames.current.set(frame, win);
  }, []);
  useEffect(() => () => {
    for (const [frame, win] of focusFrames.current) win.cancelAnimationFrame(frame);
    focusFrames.current.clear();
  }, []);
  const host = useMemo(() => ({ element, register, isTop, restoreFocus, focusOrigin }), [element, register, isTop, restoreFocus, focusOrigin]);
  const tokens = useMemo(() => getUITokens(mode), [mode]);
  return (
    <ThemeContext.Provider value={tokens}>
      <InputFocusContext.Provider value={inputFocus}>
      <OverlayContext.Provider value={host}>
        <div className={`pt-ui ${className}`} data-pt-theme={mode} data-pt-input-focus={inputFocus}
          onClickCapture={event => {
            const target = event.target as Element;
            const trigger = target.closest<HTMLElement>('button,a[href],input,textarea,select,[tabindex]');
            if (trigger) lastTrigger.current = trigger;
          }}
          style={{ ...tokenVariables(mode), colorScheme: mode, ...style } as CSSProperties}>
          <div className="pt-ui-content" inert={hasModal || undefined}>{children}</div>
          <div className="pt-overlay-host" ref={setElement} />
          {feedback && <FeedbackHost channel={feedback}/>}
        </div>
      </OverlayContext.Provider>
      </InputFocusContext.Provider>
    </ThemeContext.Provider>
  );
}
export function useUITokens(): UITokens { return useContext(ThemeContext); }
export function useOverlayHost(): OverlayHostPort {
  const host = useContext(OverlayContext);
  if (!host) throw new Error('An overlay must be inside UIProvider.');
  return host;
}

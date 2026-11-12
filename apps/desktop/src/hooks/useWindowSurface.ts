import { useEffect, useRef, useState } from 'react';
import { api } from '../services/desktop_api';
import { log } from '../utils/logger';
import { useMediaQuery } from './useMediaQuery';
import type { AppState } from '../types/navigation';

// Matches the `.pt-surface-veil` opacity fade in northstar.css. Overlays may
// only cross-fade (never translate), per the surface motion contract.
const VEIL_FADE_MS = 160;

// Hard degradation guard: a normal transition finishes in a handful of frames.
// If a native command or frame callback ever stalls, release the veil anyway so
// the user is never trapped behind an opaque surface.
const VEIL_FORCE_RELEASE_MS = 2000;

// Node-based vitest runs have no rAF; fall back to a macrotask so the hook is
// still drivable under fake timers.
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// The window only has two geometries: the compact auth surface (login and the
// resuming splash share it) and the expanded ready shell. Views within the same
// geometry family must not trigger a resize or flash the veil.
type WindowSurface = 'auth' | 'ready';

function surfaceForViewState(viewState: AppState): WindowSurface {
  return viewState === 'ready' ? 'ready' : 'auth';
}

export interface WindowSurfaceTransition {
  /** The boot veil is mounted and covering the window. */
  veilVisible: boolean;
  /** The veil is playing its opacity-only exit fade. */
  veilLeaving: boolean;
  /** Ready-shell geometry is confirmed applied; the heavy shell may mount. */
  readySurfaceSettled: boolean;
}

// Drives native window geometry from the lifecycle surface while hiding the
// auth ↔ ready resize behind a boot veil. A transition runs only when the
// target geometry actually changes:
//   1. veil paints one opaque frame
//   2. native surface command applies the atomic frame
//   3. two frames let the WebView re-lay out at the final bounds
//   4. ready shell mounts behind the veil and commits one paint
//   5. the veil cross-fades out
// An epoch guard makes rapid/interrupted transitions safe, and a force-release
// timer plus per-command catch guarantee the veil can never trap the user.
export function useWindowSurface(viewState: AppState): WindowSurfaceTransition {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [veilVisible, setVeilVisible] = useState(false);
  const [veilLeaving, setVeilLeaving] = useState(false);
  const [readySurfaceSettled, setReadySurfaceSettled] = useState(false);

  const epochRef = useRef(0);
  // The window is created at auth geometry in tauri.conf.json, so the first
  // confirmed surface is auth.
  const appliedSurfaceRef = useRef<WindowSurface>('auth');
  // True while a transition is unfinished. An interrupted effect (StrictMode
  // remount, rapid view flip) leaves this true so the next run re-applies the
  // target geometry instead of assuming the previous frame landed.
  const inFlightRef = useRef(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const targetSurface = surfaceForViewState(viewState);

    // Stable geometry family (e.g. onboarding ↔ resuming) with nothing in
    // flight: no resize, no veil, no native command.
    if (!inFlightRef.current && targetSurface === appliedSurfaceRef.current) {
      return;
    }

    const epoch = ++epochRef.current;
    inFlightRef.current = true;

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setReadySurfaceSettled(false);
    setVeilLeaving(false);
    setVeilVisible(true);

    let cancelled = false;
    const schedule = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        if (!cancelled && epoch === epochRef.current) fn();
      }, ms);
      timersRef.current.push(id);
    };
    const finish = () => {
      inFlightRef.current = false;
      appliedSurfaceRef.current = targetSurface;
    };

    void (async () => {
      // Let the veil paint an opaque frame before any native geometry work.
      await nextFrame();
      try {
        if (targetSurface === 'ready') {
          await api.nativeWindowApplyReadySurface();
        } else {
          await api.nativeWindowApplyAuthSurface();
        }
      } catch (error) {
        log.error('app', 'native window surface apply failed', { error });
      }
      // The native frame commits before the command resolves; two frames give
      // the WebView time to re-lay out at the final bounds so nothing mounts at
      // an intermediate width.
      await nextFrame();
      await nextFrame();
      if (cancelled || epoch !== epochRef.current) return;

      if (targetSurface === 'ready') {
        // Mount the heavy shell behind the opaque veil, then wait for its first
        // commit before fading, so a half-laid-out shell is never revealed.
        setReadySurfaceSettled(true);
        await nextFrame();
        if (cancelled || epoch !== epochRef.current) return;
      } else {
        setReadySurfaceSettled(false);
      }

      finish();
      setVeilLeaving(true);
      const fadeMs = reducedMotion ? 0 : VEIL_FADE_MS;
      schedule(() => {
        setVeilVisible(false);
        setVeilLeaving(false);
      }, fadeMs);
    })();

    // Degradation guard: release the veil even if the async chain stalls.
    schedule(() => {
      finish();
      setReadySurfaceSettled(targetSurface === 'ready');
      setVeilVisible(false);
      setVeilLeaving(false);
    }, VEIL_FORCE_RELEASE_MS);

    return () => {
      cancelled = true;
      // Keep inFlightRef set on interruption so the replacement effect
      // re-applies the target geometry rather than no-opping.
    };
  }, [viewState, reducedMotion]);

  useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
  }, []);

  return { veilVisible, veilLeaving, readySurfaceSettled };
}

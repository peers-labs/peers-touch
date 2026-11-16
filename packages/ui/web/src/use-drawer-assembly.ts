import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { geometry } from '@peers-touch/ui-tokens';
import { useMotionPolicy } from './runtime';
import {
  bounded, catalogPreferenceForBoundary, drawerEase, drawerPolicy, resolveDrawerAssembly, settleCatalog,
  type DrawerLeaf, type ForceDirection,
} from './drawer-assembly';

/** One cancellable scalar. Retargeting starts from the currently drawn pose. */
function useGuide(initial: number) {
  const { preference } = useMotionPolicy();
  const [value, setValue] = useState(initial);
  const live = useRef(initial);
  const destination = useRef(initial);
  const frame = useRef<number | null>(null);
  const stop = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  const draw = (next: number) => { live.current = next; setValue(next); };
  const move = (next: number, direct = false) => {
    stop();
    destination.current = next;
    if (direct || preference === 'reduced' ||
        (preference === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      draw(next);
      return;
    }
    const from = live.current;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / geometry.motion.navigation);
      draw(from + (next - from) * drawerEase(progress));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
      else { draw(next); frame.current = null; }
    };
    frame.current = requestAnimationFrame(tick);
  };
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const settleReduced = () => {
      if (preference === 'reduced' || (preference === 'system' && media.matches)) {
        stop();
        draw(destination.current);
      }
    };
    settleReduced();
    media.addEventListener('change', settleReduced);
    return () => media.removeEventListener('change', settleReduced);
  }, [preference]);
  useLayoutEffect(() => stop, []);
  return { value, live, move, stop };
}

/** Owns frame measurement, intent, preference and all guide poses. */
export function useDrawerAssembly(options: {
  initialPreference?: number;
  onPreferenceCommit?: (width: number) => void;
  focus?: { catalog: string; work: string; parent: string };
} = {}) {
  const initial = settleCatalog(options.initialPreference ?? drawerPolicy.catalog.default);
  const commit = useRef(options.onPreferenceCommit);
  const focus = options.focus ?? {
    catalog: '[data-drawer-catalog] button, [data-drawer-catalog] [tabindex="0"]',
    work: '[data-drawer-work] textarea',
    parent: '[data-action-id="chat.tools"], [data-action-id="chat.open-info"], [data-action-id="chat-open-detail"]',
  };
  useLayoutEffect(() => { commit.current = options.onPreferenceCommit; });
  const surface = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);
  const [preferred, setPreferred] = useState<number>(initial);
  const [open, setOpen] = useState(false);
  const [leaf, setLeaf] = useState<DrawerLeaf | null>(null);
  const [leafContent, setLeafContent] = useState<DrawerLeaf | null>(null);
  const [dragging, setDragging] = useState(false);
  const catalog = useGuide(initial);
  const work = useGuide(0);
  const inner = useGuide(0);
  const drag = useRef<{ restore: number; start: number; x: number; lastX: number; direction: ForceDirection } | null>(null);
  const returnTarget = useRef<HTMLElement | null>(null);
  const leafTarget = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<'work' | 'catalog' | 'parent' | null>(null);

  const cancelDrag = () => {
    if (!drag.current) return;
    catalog.move(drag.current.restore, true);
    drag.current = null;
    setDragging(false);
  };
  useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    let measured = -1;
    const measure = () => {
      const bounds = node.getBoundingClientRect();
      const next = bounds.width;
      if (measured >= 0 && Math.abs(measured - next) > .01) cancelDrag();
      measured = next;
      setStage(old => Math.abs(old - next) < .01 ? old : next);
      setStageHeight(old => Math.abs(old - bounds.height) < .01 ? old : bounds.height);
    };
    measure();
    // ResizeObserver runs before paint. Publish the entire snapshot there,
    // rather than painting new CSS bounds with yesterday's React geometry.
    const observer = new ResizeObserver(() => flushSync(measure));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const setLeafIntent = (next: DrawerLeaf | null) => {
    if (next && (!open || work.live.current < 1)) return;
    if (next?.kind === leaf?.kind && (
      next?.kind !== 'thread' || (leaf?.kind === 'thread' && next.messageId === leaf.messageId)
    )) return;
    if (next) {
      leafTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setLeafContent(next);
    } else if (leaf) pendingFocus.current = 'parent';
    setLeaf(next);
    inner.move(next ? 1 : 0);
  };
  const reveal = () => {
    if (!open) {
      returnTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      pendingFocus.current = 'work';
      setOpen(true);
      work.move(1, stage >= catalog.live.current + drawerPolicy.work.reading);
    }
  };
  const back = () => {
    if (leaf) { setLeafIntent(null); return; }
    // If the inner guide is still returning, finish its stop before moving
    // the parent; do not let a spammed Back leave a child floating behind.
    inner.move(0, true);
    pendingFocus.current = 'catalog';
    setOpen(false);
    work.move(0, stage >= catalog.live.current + drawerPolicy.work.reading);
  };
  const retireTask = () => {
    cancelDrag();
    pendingFocus.current = 'catalog';
    setLeaf(null);
    setLeafContent(null);
    inner.move(0, true);
    setOpen(false);
    work.move(0, true);
  };
  const dismissLeaf = () => {
    setLeaf(null);
    setLeafContent(null);
    inner.move(0, true);
  };
  const setCatalog = (next: number) => {
    cancelDrag();
    const intent = settleCatalog(next);
    setPreferred(intent);
    commit.current?.(intent);
    catalog.move(intent);
  };
  const pose = resolveDrawerAssembly(stage, catalog.value, work.value, inner.value, stageHeight);
  const setCatalogBoundary = (boundary: number, direction: ForceDirection = 0) => {
    setCatalog(settleCatalog(catalogPreferenceForBoundary(stage, boundary, work.live.current), direction));
  };
  useLayoutEffect(() => {
    const root = surface.current;
    if (!root || !pendingFocus.current) return;
    const eligible = (node: HTMLElement | null): boolean => {
      if (!node?.isConnected || node.closest('[inert], [aria-hidden="true"]')) return false;
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.left >= root.getBoundingClientRect().left &&
        r.right <= root.getBoundingClientRect().right &&
        node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    };
    let target: HTMLElement | null = null;
    if (pendingFocus.current === 'work' && open && work.value === 1 && !leaf) {
      target = root.querySelector(focus.work);
    } else if (pendingFocus.current === 'catalog' && !open && work.value === 0) {
      target = eligible(returnTarget.current) ? returnTarget.current :
        root.querySelector(focus.catalog);
    } else if (pendingFocus.current === 'parent' && !leaf && inner.value === 0 && open) {
      target = eligible(leafTarget.current) ? leafTarget.current :
        root.querySelector(focus.parent);
    }
    let frame: number | null = null;
    const restore = (remaining: number) => {
      if (!pendingFocus.current) return;
      if (target && eligible(target)) {
        pendingFocus.current = null;
        target.focus({ preventScroll: true });
      } else if (target?.isConnected && remaining > 0) {
        // A deleting task can unmount its modal in this commit. Let the
        // primitive release the provider's inert boundary before restoring.
        frame = requestAnimationFrame(() => restore(remaining - 1));
      }
    };
    restore(8);
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  }, [open, leaf, work.value, inner.value, stage, catalog.value]);
  return {
    surface, pose, preferred, open, leaf, leafContent, dragging,
    navigation: work.value, leafProgress: inner.value,
    reveal, back, retireTask, dismissLeaf, setLeaf: setLeafIntent, setCatalog, setCatalogBoundary,
    beginDrag: (x: number) => {
      catalog.stop();
      drag.current = { restore: preferred, start: pose.visibleCatalog, x, lastX: x, direction: 0 };
      setDragging(true);
    },
    moveDrag: (x: number) => {
      const state = drag.current;
      if (!state) return;
      if (x !== state.lastX) {
        state.direction = x < state.lastX ? -1 : 1;
        state.lastX = x;
      }
      const boundary = bounded(state.start + x - state.x, pose.catalogResizeMin, pose.catalogResizeMax);
      catalog.move(catalogPreferenceForBoundary(stage, boundary, work.live.current), true);
    },
    finishDrag: () => {
      const state = drag.current;
      if (!state) return;
      if (state.direction === 0) { cancelDrag(); return; }
      const next = settleCatalog(catalog.live.current, state.direction);
      drag.current = null;
      setDragging(false);
      setPreferred(next);
      commit.current?.(next);
      catalog.move(next);
    },
    cancelDrag,
  };
}

export type DrawerAssemblyController = ReturnType<typeof useDrawerAssembly>;

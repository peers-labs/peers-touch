import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { ArrowDown, ArrowUp, ChevronsDown } from 'lucide-react';
import { useMobileI18n } from '../app/mobileI18n';
import {
  findScrollAnchor,
  readListAnchor,
  restoreScrollPosition,
  saveListAnchor,
  saveScrollPosition,
} from '../app/navigation/scrollRestoration';
import { boundedListRange } from './boundedListRange';

export interface BoundedListHandle {
  reveal: (key: string) => boolean;
}

interface BoundedListProps<T> {
  items: readonly T[];
  itemKey: (item: T) => string;
  surfaceKey: string;
  size?: number;
  initial?: 'start' | 'end';
  controllerRef?: Ref<BoundedListHandle>;
  children: (items: T[]) => ReactNode;
}

function scrollOwner(element: HTMLElement): HTMLElement {
  let parent = element.parentElement;
  while (parent) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
    parent = parent.parentElement;
  }
  return element;
}

/** Presentation-only window. Runtime projections and history remain with their owners. */
export function BoundedList<T>(props: BoundedListProps<T>) {
  // A new surface must not reuse another conversation's window or scroll task.
  return <BoundedListSurface key={props.surfaceKey} {...props} />;
}

function BoundedListSurface<T>({
  items, itemKey, surfaceKey, size = 100, initial = 'start', children, controllerRef,
}: BoundedListProps<T>) {
  const { t } = useMobileI18n();
  const root = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => items.map(itemKey), [items, itemKey]);
  const [anchor, setAnchor] = useState(() => readListAnchor(surfaceKey));
  const [revision, setRevision] = useState(0);
  const task = useRef<{ key: string; offset?: number } | null>(null);
  const following = useRef(initial === 'end' && anchor === undefined);
  const range = boundedListRange(keys, following.current ? undefined : anchor, size, initial);
  const firstKey = keys[range.start];
  const lastKey = keys[range.end - 1];
  const positionKey = `list:${surfaceKey}`;
  const firstKeyRef = useRef(firstKey);
  firstKeyRef.current = firstKey;
  const latestWindow = useRef(range.end === keys.length);
  latestWindow.current = range.end === keys.length;

  const reveal = (key: string): boolean => {
    const index = keys.indexOf(key);
    if (index < 0) return false;
    following.current = false;
    const nextAnchor = keys[Math.max(0, index - Math.floor(size / 2))];
    saveListAnchor(surfaceKey, nextAnchor);
    setAnchor(nextAnchor);
    task.current = { key };
    setRevision((value) => value + 1);
    return true;
  };
  useImperativeHandle(controllerRef, () => ({ reveal }));

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const owner = scrollOwner(element);
    const pending = task.current;
    if (pending) {
      const row = findScrollAnchor(element, pending.key) as HTMLElement | undefined;
      if (row) {
        owner.scrollTop += row.getBoundingClientRect().top
          - owner.getBoundingClientRect().top
          - (pending.offset ?? (owner.clientHeight - row.getBoundingClientRect().height) / 2);
        const target = row.matches('button, [tabindex]')
          ? row : row.querySelector<HTMLElement>('button, [tabindex]') ?? row;
        if (target === row && !row.hasAttribute('tabindex')) row.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      task.current = null;
    } else if (initial === 'end' && following.current) {
      owner.scrollTop = owner.scrollHeight;
    } else {
      restoreScrollPosition(positionKey, owner);
    }
    if (firstKey) saveListAnchor(surfaceKey, firstKey);
  }, [firstKey, lastKey, positionKey, surfaceKey, initial, revision, items]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const owner = scrollOwner(element);
    const capture = () => {
      following.current = initial === 'end' && latestWindow.current
        && owner.scrollHeight - owner.scrollTop - owner.clientHeight < 24;
      if (!following.current && firstKeyRef.current) {
        setAnchor(firstKeyRef.current);
      }
      // Store identity as well as pixels so insertions above the reader are stable.
      saveScrollPosition(positionKey, owner);
    };
    owner.addEventListener('scroll', capture, { passive: true });
    return () => {
      owner.removeEventListener('scroll', capture);
    };
  }, [positionKey, initial]);

  const move = (direction: -1 | 1) => {
    following.current = false;
    const nextStart = Math.max(0, Math.min(
      Math.max(0, keys.length - size),
      range.start + direction * Math.max(1, Math.floor(size / 2)),
    ));
    const nextKey = keys[nextStart];
    if (!nextKey) return;
    saveListAnchor(surfaceKey, nextKey);
    setAnchor(nextKey);
    const retainedKey = direction < 0 ? firstKey : lastKey;
    const retainedRow = root.current && findScrollAnchor(root.current, retainedKey);
    const owner = root.current && scrollOwner(root.current);
    // Keep the overlapping row at its exact offset while replacing the window.
    task.current = {
      key: retainedKey,
      offset: retainedRow && owner
        ? retainedRow.getBoundingClientRect().top - owner.getBoundingClientRect().top
        : undefined,
    };
    setRevision((value) => value + 1);
  };

  return (
    <div
      ref={root}
      className="bounded-list"
      data-window-surface={surfaceKey}
      data-window-start={range.start}
      data-window-total={items.length}
    >
      {range.start > 0 ? (
        <button type="button" className="bounded-list-control" onClick={() => move(-1)}>
          <ArrowUp size={16} /><span>{t('mobile.list.previous')}</span>
        </button>
      ) : null}
      {children(items.slice(range.start, range.end))}
      {range.end < items.length ? (
        <div className="bounded-list-controls">
          <button type="button" className="bounded-list-control" onClick={() => move(1)}>
            <ArrowDown size={16} /><span>{t('mobile.list.next')}</span>
          </button>
          {initial === 'end' ? (
            <button type="button" className="bounded-list-control" onClick={() => {
              following.current = true;
              setAnchor(undefined);
              setRevision((value) => value + 1);
            }}>
              <ChevronsDown size={16} /><span>{t('mobile.chat.latestMessage')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

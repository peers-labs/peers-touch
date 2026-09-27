import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { ArrowDown, ArrowUp, ChevronsDown } from 'lucide-react';
import copy from '../../../../../locales/en/common.json';
import { findListRow, listScrollOwner, PrototypeListMemory, readViewport, restoreViewport } from '../listPresentation';

export interface PrototypeListHandle {
  reveal: (key: string) => boolean;
}

interface Props<T> {
  items: readonly T[];
  itemKey: (item: T) => string;
  surfaceKey: string;
  memory: PrototypeListMemory;
  size?: number;
  initial?: 'start' | 'end';
  controllerRef?: Ref<PrototypeListHandle>;
  children: (items: T[]) => ReactNode;
}

/** Mirrors traversal semantics, while rendering only the prototype's own UI. */
export function PrototypeListWindow<T>(props: Props<T>) {
  return <ListWindowSurface key={props.surfaceKey} {...props} />;
}

function ListWindowSurface<T>({
  items, itemKey, surfaceKey, memory, size = 100, initial = 'start', controllerRef, children,
}: Props<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const keys = useMemo(() => items.map(itemKey), [items, itemKey]);
  const [firstAnchor, setFirstAnchor] = useState(() => memory.read(surfaceKey)?.firstKey);
  const [revision, setRevision] = useState(0);
  const following = useRef(memory.read(surfaceKey)?.following ?? initial === 'end');
  const task = useRef<{ key: string; offset?: number } | null>(null);
  const anchorIndex = following.current ? -1 : keys.indexOf(firstAnchor ?? '');
  const maximumStart = Math.max(0, keys.length - size);
  const start = anchorIndex < 0
    ? initial === 'end' ? maximumStart : 0
    : Math.min(anchorIndex, maximumStart);
  const end = Math.min(keys.length, start + size);
  const firstKey = keys[start];
  const lastKey = keys[end - 1];
  const currentWindow = useRef({ firstKey, end, total: keys.length });
  currentWindow.current = { firstKey, end, total: keys.length };

  useImperativeHandle(controllerRef, () => ({
    reveal(key) {
      const index = keys.indexOf(key);
      if (index < 0) return false;
      following.current = false;
      setFirstAnchor(keys[Math.max(0, index - Math.floor(size / 2))]);
      task.current = { key };
      setRevision((value) => value + 1);
      return true;
    },
  }));

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const owner = listScrollOwner(root);
    const pending = task.current;
    if (pending) {
      const row = findListRow(root, pending.key);
      // A replayed mount effect may run before the requested window is committed.
      if (!row) return;
      owner.scrollTop += row.getBoundingClientRect().top - owner.getBoundingClientRect().top
        - (pending.offset ?? (owner.clientHeight - row.getBoundingClientRect().height) / 2);
      if (!row.hasAttribute('tabindex')) row.tabIndex = -1;
      row.focus({ preventScroll: true });
      task.current = null;
    } else if (initial === 'end' && following.current) {
      owner.scrollTop = owner.scrollHeight;
    } else {
      restoreViewport(owner, root, memory.read(surfaceKey));
    }
    memory.save(surfaceKey, { firstKey, following: following.current, ...readViewport(owner, root) });
  }, [firstKey, lastKey, initial, items, memory, revision, surfaceKey]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const owner = listScrollOwner(root);
    const capture = () => {
      const current = currentWindow.current;
      following.current = initial === 'end' && current.end === current.total
        && owner.scrollHeight - owner.scrollTop - owner.clientHeight < 24;
      if (!following.current) setFirstAnchor(current.firstKey);
      memory.save(surfaceKey, {
        firstKey: current.firstKey, following: following.current, ...readViewport(owner, root),
      });
    };
    owner.addEventListener('scroll', capture, { passive: true });
    return () => {
      // Layout cleanup runs before the selected page's DOM is removed.
      memory.save(surfaceKey, {
        firstKey: currentWindow.current.firstKey, following: following.current, ...readViewport(owner, root),
      });
      owner.removeEventListener('scroll', capture);
    };
  }, [initial, memory, surfaceKey]);

  function move(direction: -1 | 1) {
    const root = rootRef.current;
    if (!root) return;
    const nextStart = Math.max(0, Math.min(maximumStart, start + direction * Math.floor(size / 2)));
    const retainedKey = direction < 0 ? firstKey : lastKey;
    const retained = findListRow(root, retainedKey);
    following.current = false;
    task.current = {
      key: retainedKey,
      offset: retained ? retained.getBoundingClientRect().top
        - listScrollOwner(root).getBoundingClientRect().top : undefined,
    };
    setFirstAnchor(keys[nextStart]);
    setRevision((value) => value + 1);
  }

  return (
    <div ref={rootRef} className="mp-list-window" data-window-surface={surfaceKey}
      data-window-start={start} data-window-total={items.length} data-window-size={size}>
      {start > 0 && (
        <button type="button" className="mp-list-control" onClick={() => move(-1)}>
          <ArrowUp size={16} /><span>{copy['mobile.list.previous']}</span>
        </button>
      )}
      <div className="mp-list-window-content">{children(items.slice(start, end))}</div>
      {end < items.length && (
        <div className="mp-list-controls">
          <button type="button" className="mp-list-control" onClick={() => move(1)}>
            <ArrowDown size={16} /><span>{copy['mobile.list.next']}</span>
          </button>
          {initial === 'end' && (
            <button type="button" className="mp-list-control" onClick={() => {
              following.current = true;
              setFirstAnchor(undefined);
              setRevision((value) => value + 1);
            }}>
              <ChevronsDown size={16} /><span>{copy['mobile.chat.latestMessage']}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

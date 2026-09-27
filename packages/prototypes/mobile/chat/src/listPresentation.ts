interface ListSnapshot {
  firstKey?: string;
  scrollTop?: number;
  anchor?: { id: string; offset: number };
  following?: boolean;
  query?: string;
  submittedQuery?: string;
}

/** Shell-owned presentation metadata survives selected-only pages, not scenario resets. */
export class PrototypeListMemory {
  private locations = new Map<string, { timestamp: number; snapshot: ListSnapshot }>();

  read(key: string): ListSnapshot | undefined {
    const saved = this.locations.get(key);
    if (!saved) return undefined;
    if (Date.now() - saved.timestamp > 30 * 60 * 1000) {
      this.locations.delete(key);
      return undefined;
    }
    return saved.snapshot;
  }

  save(key: string, snapshot: ListSnapshot): void {
    this.locations.delete(key);
    this.locations.set(key, { timestamp: Date.now(), snapshot });
    if (this.locations.size > 100) this.locations.delete(this.locations.keys().next().value!);
  }
}

export function findListRow(root: HTMLElement, key: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-anchor-id]'))
    .find((row) => row.dataset.scrollAnchorId === key);
}

export function listScrollOwner(root: HTMLElement): HTMLElement {
  let parent = root.parentElement;
  while (parent) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
    parent = parent.parentElement;
  }
  return root;
}

export function readViewport(owner: HTMLElement, root: HTMLElement): Pick<ListSnapshot, 'scrollTop' | 'anchor'> {
  const top = owner.getBoundingClientRect().top;
  const row = Array.from(root.querySelectorAll<HTMLElement>('[data-scroll-anchor-id]'))
    .find((element) => element.getBoundingClientRect().bottom > top);
  return {
    scrollTop: owner.scrollTop,
    anchor: row ? {
      id: row.dataset.scrollAnchorId!,
      offset: row.getBoundingClientRect().top - top,
    } : undefined,
  };
}

export function restoreViewport(owner: HTMLElement, root: HTMLElement, saved?: ListSnapshot): void {
  if (!saved) return;
  owner.scrollTop = saved.scrollTop ?? 0;
  const row = saved.anchor && findListRow(root, saved.anchor.id);
  if (row && saved.anchor) {
    owner.scrollTop += row.getBoundingClientRect().top
      - owner.getBoundingClientRect().top - saved.anchor.offset;
  }
}

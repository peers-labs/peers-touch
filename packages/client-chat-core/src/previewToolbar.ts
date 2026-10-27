/**
 * One quiet document toolbar, Quick Look style.
 *
 * The bar is a single 40px row: an optional leading control (workbook
 * sheet selector), pagination in the centre, zoom on the trailing edge.
 * Workbooks add a compact column pager in the centre group. It carries no
 * file actions (open/save live in the host detail header) and no second
 * row. Icons are inline SVG so this package keeps zero icon/runtime
 * dependencies on either client.
 */

const icon = (path: string): string =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;

const CHEVRON_LEFT = icon('<path d="M15 6l-6 6 6 6"/>');
const CHEVRON_RIGHT = icon('<path d="M9 6l6 6-6 6"/>');
const ZOOM_WIDTH = icon('<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><path d="M9 12h6"/>');
const ZOOM_PAGE = icon('<rect x="6" y="4" width="12" height="16" rx="1"/><path d="M9 8h6M9 12h6"/>');
const ZOOM_ACTUAL = icon('<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>');

export interface PreviewToolbarOptions {
  labels: {
    previousPage: string;
    nextPage: string;
    page: (page: number, total: number) => string;
    zoom: string;
    fitPage: string;
    fitWidth: string;
    actualSize: string;
  };
  signal: AbortSignal;
  onPrevious: () => void;
  onNext: () => void;
  onZoom?: (zoom: 'width' | 'page' | 'actual') => void;
  initialZoom?: 'width' | 'page' | 'actual';
  /** Hide zoom group (workbooks and presentations manage their own fit). */
  showZoom?: boolean;
  /** Optional leading control, e.g. the workbook sheet selector. */
  leading?: HTMLElement;
  /** Compact secondary pager, e.g. workbook column viewport. */
  secondary?: {
    status: string;
    labelPrevious: string;
    labelNext: string;
    onPrevious: () => void;
    onNext: () => void;
  };
}

export interface PreviewToolbar {
  element: HTMLElement;
  setPagination: (page: number, total: number, busy?: boolean) => void;
  setSecondaryStatus: (status: string) => void;
  setSecondaryPagination: (page: number, total: number, busy?: boolean) => void;
  setZoom: (zoom: 'width' | 'page' | 'actual') => void;
}

function iconButton(label: string, graphic: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chat-preview-icon';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = graphic;
  return button;
}

export function previewToolbar(options: PreviewToolbarOptions): PreviewToolbar {
  const { labels, signal, onPrevious, onNext, onZoom } = options;
  const bar = document.createElement('div');
  bar.className = 'chat-preview-toolbar';

  const leading = document.createElement('div');
  leading.className = 'chat-preview-toolbar-leading';
  if (options.leading) leading.append(options.leading);

  const pager = document.createElement('div');
  pager.className = 'chat-preview-pager';
  const previous = iconButton(labels.previousPage, CHEVRON_LEFT);
  previous.dataset.previewPager = 'previous';
  const pageStatus = document.createElement('span');
  pageStatus.className = 'chat-preview-page-status';
  pageStatus.dataset.previewPager = 'status';
  const next = iconButton(labels.nextPage, CHEVRON_RIGHT);
  next.dataset.previewPager = 'next';
  pager.append(previous, pageStatus, next);

  let secondaryPrevious: HTMLButtonElement | null = null;
  let secondaryNext: HTMLButtonElement | null = null;
  let secondaryStatus: HTMLSpanElement | null = null;
  if (options.secondary) {
    const config = options.secondary;
    const divider = document.createElement('span');
    divider.className = 'chat-preview-pager-divider';
    secondaryPrevious = iconButton(config.labelPrevious, CHEVRON_LEFT);
    secondaryPrevious.dataset.previewColumn = 'previous';
    secondaryStatus = document.createElement('span');
    secondaryStatus.className = 'chat-preview-page-status chat-preview-column-status';
    secondaryStatus.dataset.previewColumn = 'status';
    secondaryStatus.textContent = config.status;
    secondaryNext = iconButton(config.labelNext, CHEVRON_RIGHT);
    secondaryNext.dataset.previewColumn = 'next';
    pager.append(divider, secondaryPrevious, secondaryStatus, secondaryNext);
    secondaryPrevious.addEventListener('click', config.onPrevious, { signal });
    secondaryNext.addEventListener('click', config.onNext, { signal });
  }

  const trailing = document.createElement('div');
  trailing.className = 'chat-preview-toolbar-trailing';

  let zoomGroup: HTMLElement | null = null;
  let zoomValue = options.initialZoom ?? 'width';
  if (options.showZoom !== false && onZoom) {
    zoomGroup = document.createElement('div');
    zoomGroup.className = 'chat-preview-zoom';
    zoomGroup.setAttribute('role', 'group');
    zoomGroup.setAttribute('aria-label', labels.zoom);
    const modes: Array<['width' | 'page' | 'actual', string, string]> = [
      ['width', labels.fitWidth, ZOOM_WIDTH],
      ['page', labels.fitPage, ZOOM_PAGE],
      ['actual', labels.actualSize, ZOOM_ACTUAL],
    ];
    for (const [value, label, graphic] of modes) {
      const button = iconButton(label, graphic);
      button.classList.add('chat-preview-zoom-button');
      button.dataset.zoom = value;
      button.setAttribute('aria-pressed', String(value === zoomValue));
      button.addEventListener(
        'click',
        () => {
          zoomValue = value;
          zoomGroup?.querySelectorAll('[data-zoom]').forEach((node) => {
            node.setAttribute('aria-pressed', String(node === button));
          });
          onZoom(value);
        },
        { signal },
      );
      zoomGroup.append(button);
    }
    trailing.append(zoomGroup);
  }

  bar.append(leading, pager);
  // Keep the zoom cluster adjacent to pagination (one centered group);
  // an empty trailing box would offset the centering on workbooks.
  if (zoomGroup) bar.append(trailing);

  previous.addEventListener('click', onPrevious, { signal });
  next.addEventListener('click', onNext, { signal });
  signal.addEventListener('abort', () => bar.remove(), { once: true });

  return {
    element: bar,
    setPagination(page, total, busy = false) {
      bar.setAttribute('aria-busy', String(busy));
      pageStatus.textContent = labels.page(page, total);
      pageStatus.title = labels.page(page, total);
      previous.disabled = busy || page <= 1;
      next.disabled = busy || page >= total;
    },
    setSecondaryStatus(status) {
      if (secondaryStatus) secondaryStatus.textContent = status;
    },
    setSecondaryPagination(page, total, busy = false) {
      if (!secondaryStatus || !secondaryPrevious || !secondaryNext) return;
      secondaryPrevious.disabled = busy || page <= 1;
      secondaryNext.disabled = busy || page >= total;
    },
    setZoom(zoom) {
      zoomValue = zoom;
      zoomGroup?.querySelectorAll<HTMLElement>('[data-zoom]').forEach((node) => {
        node.setAttribute('aria-pressed', String(node.dataset.zoom === zoom));
      });
    },
  };
}

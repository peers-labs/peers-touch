export interface ChatFilePreviewLabels {
  preparing: string;
  unavailable: string;
  previousPage: string;
  nextPage: string;
  page: (page: number, total: number) => string;
  sheet: string;
  previousColumns: string;
  nextColumns: string;
  columns: (page: number, total: number) => string;
  resourceUnavailable: string;
  zoom: string;
  fitPage: string;
  fitWidth: string;
  actualSize: string;
  cellRange: (range: string) => string;
}

export function setChatFilePreviewState(container: HTMLElement, state: 'loading' | 'ready' | 'unavailable'): void {
  container.dataset.chatPreviewState = state;
  container.setAttribute('aria-busy', String(state === 'loading'));
}

export function setChatFilePreviewUnavailable(container: HTMLElement, label: string): void {
  setChatFilePreviewState(container, 'unavailable');
  container.textContent = label;
  container.setAttribute('data-chat-file-preview-unavailable', 'true');
}

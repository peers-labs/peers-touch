import type { ChatFilePreviewLabels } from './previewSurface.js';

export interface WorkbookViewport {
  sheet: string;
  range: string;
  columns: string[];
  columnWidths: number[];
  rows: Array<{ number: number; cells: Array<{
    text: string; address: string; rowSpan: number; colSpan: number; numeric: boolean;
  }> }>;
}

/** Read-only viewport retains source cell addresses and merged-cell geometry. */
export function workbookTable(viewport: WorkbookViewport, labels: ChatFilePreviewLabels): HTMLTableElement {
  const table = document.createElement('table');
  table.setAttribute('aria-label', viewport.sheet);
  table.dataset.chatWorkbookRange = viewport.range;
  const columns = document.createElement('colgroup');
  for (const width of [44, ...viewport.columnWidths]) {
    const column = document.createElement('col');
    column.style.width = `${width}px`;
    columns.append(column);
  }
  table.style.width = `${44 + viewport.columnWidths.reduce((sum, width) => sum + width, 0)}px`;
  const caption = document.createElement('caption');
  caption.textContent = labels.cellRange(viewport.range);
  const head = document.createElement('thead');
  const headings = document.createElement('tr');
  headings.append(document.createElement('th'));
  for (const column of viewport.columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column;
    headings.append(th);
  }
  head.append(headings);
  const body = document.createElement('tbody');
  for (const row of viewport.rows) {
    const tr = document.createElement('tr');
    const number = document.createElement('th');
    number.scope = 'row';
    number.textContent = String(row.number);
    tr.append(number);
    for (const value of row.cells) {
      const cell = document.createElement('td');
      cell.textContent = value.text;
      cell.title = value.address;
      cell.dataset.chatCell = value.address;
      cell.rowSpan = value.rowSpan;
      cell.colSpan = value.colSpan;
      if (value.numeric) cell.className = 'chat-workbook-number';
      tr.append(cell);
    }
    body.append(tr);
  }
  table.append(caption, columns, head, body);
  return table;
}

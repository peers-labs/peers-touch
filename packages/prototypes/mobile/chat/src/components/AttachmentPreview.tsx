import { useState } from 'react';
import { Button, Heading, Paragraph, Select } from '@peers-touch/ui';
import copy from '../../../../../locales/en/chat.json';

/** Executable design sample; it never decodes or proves real document bytes. */
export function AttachmentPreview({ filename }: { filename: string }) {
  const [page, setPage] = useState(1);
  const [column, setColumn] = useState(1);
  const [sheet, setSheet] = useState('Report');
  const [zoom, setZoom] = useState('width');
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const workbook = /^(xlsx?|csv)$/.test(extension);
  const supported = workbook || /^(docx|pptx?|pdf|txt|md)$/.test(extension);
  if (!supported) return <span>{copy['chat.attachment.previewUnavailable']}</span>;
  const navigation = (value: number, change: (page: number) => void, columns = false) => (
    <div className="mp-file-preview-nav">
      <Button actionId="preview.previous" density="compact"
        availability={value === 1 ? { kind: 'disabled', reason: 'First page' } : undefined}
        onActivate={() => change(value - 1)}>
        {copy[columns ? 'chat.attachment.previousColumns' : 'chat.attachment.previousPage']}
      </Button>
      <span role="status">{copy[columns ? 'chat.attachment.columns' : 'chat.attachment.page']
        .replace('{{page}}', String(value)).replace('{{total}}', '2')}</span>
      <Button actionId="preview.next" density="compact"
        availability={value === 2 ? { kind: 'disabled', reason: 'Last page' } : undefined}
        onActivate={() => change(value + 1)}>
        {copy[columns ? 'chat.attachment.nextColumns' : 'chat.attachment.nextPage']}
      </Button>
    </div>
  );
  return (
    <div data-prototype-document-preview={extension} className="mp-file-preview">
      {/^(pdf|docx)$/.test(extension) ? <Select aria-label={copy['chat.attachment.zoom']} label={copy['chat.attachment.zoom']}
        density="compact" value={zoom}
        options={['width', 'page', 'actual'].map(value => ({ value,
          label: copy[value === 'width' ? 'chat.attachment.fitWidth' : value === 'page' ? 'chat.attachment.fitPage' : 'chat.attachment.actualSize'] }))}
        onValueChange={(value) => setZoom(String(value))} /> : null}
      {workbook ? <Select aria-label={copy['chat.attachment.sheet']} label={copy['chat.attachment.sheet']}
        density="compact" value={sheet}
        options={['Report', 'Summary'].map(value => ({ value, label: value }))}
        onValueChange={(value) => { setSheet(String(value)); setPage(1); setColumn(1); }} /> : null}
      {navigation(page, setPage)}
      {workbook ? navigation(column, setColumn, true) : null}
      <div data-prototype-zoom={zoom} className="mp-file-preview-canvas" style={{ fontSize: zoom === 'page' ? 11 : zoom === 'actual' ? 16 : 14 }}>
        {workbook ? (
          <table aria-label={sheet}>
            <caption>{copy['chat.attachment.cellRange'].replace('{{range}}', `${column === 1 ? 'A' : 'U'}${page === 1 ? '1' : '101'}:${column === 1 ? 'B' : 'V'}${page === 1 ? '2' : '102'}`)}</caption>
            <thead>
              <tr><th /><th scope="col">{column === 1 ? 'A' : 'U'}</th><th scope="col">{column === 1 ? 'B' : 'V'}</th></tr>
            </thead>
            <tbody>
              <tr><th scope="row">{page === 1 ? '1' : '101'}</th><td>{sheet}</td><td>{page === 1 ? 'Status' : 'Alice'}</td></tr>
              <tr><th scope="row">{page === 1 ? '2' : '102'}</th><td>{page === 1 ? 'Design review' : 'Release review'}</td><td>{page === 1 ? 'Ready' : 'Alice'}</td></tr>
            </tbody>
          </table>
        ) : (
          <>
            <Heading level={4}>{filename}</Heading>
            <Paragraph>{page === 1 ? 'Design review' : 'Release review'}</Paragraph>
            <Paragraph>This sample shows page navigation in the selected file detail.</Paragraph>
          </>
        )}
      </div>
    </div>
  );
}

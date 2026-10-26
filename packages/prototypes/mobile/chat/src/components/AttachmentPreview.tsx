import { useState } from 'react';
import { Button, Select, Typography } from 'antd';
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
  const navigation = (value: number, change: (page: number) => void, columns = false) => <div
    style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
    <Button disabled={value === 1} onClick={() => change(value - 1)} style={{ minHeight: 44 }}>
      {copy[columns ? 'chat.attachment.previousColumns' : 'chat.attachment.previousPage']}
    </Button>
    <span role="status">{copy[columns ? 'chat.attachment.columns' : 'chat.attachment.page']
      .replace('{{page}}', String(value)).replace('{{total}}', '2')}</span>
    <Button disabled={value === 2} onClick={() => change(value + 1)} style={{ minHeight: 44 }}>
      {copy[columns ? 'chat.attachment.nextColumns' : 'chat.attachment.nextPage']}
    </Button>
  </div>;
  return <div data-prototype-document-preview={extension} style={{ width: '100%', minWidth: 0, display: 'grid', gap: 8 }}>
    {/^(pdf|docx)$/.test(extension) ? <Select aria-label={copy['chat.attachment.zoom']} value={zoom}
      options={['width', 'page', 'actual'].map(value => ({ value,
        label: copy[value === 'width' ? 'chat.attachment.fitWidth' : value === 'page' ? 'chat.attachment.fitPage' : 'chat.attachment.actualSize'] }))}
      onChange={setZoom} /> : null}
    {workbook ? <Select aria-label={copy['chat.attachment.sheet']} value={sheet}
      options={['Report', 'Summary'].map(value => ({ value, label: value }))}
      onChange={value => { setSheet(value); setPage(1); setColumn(1); }} /> : null}
    {navigation(page, setPage)}
    {workbook ? navigation(column, setColumn, true) : null}
    <div data-prototype-zoom={zoom} style={{ minHeight: 240, maxHeight: 320, overflow: 'auto', padding: 16,
      fontSize: zoom === 'page' ? 11 : zoom === 'actual' ? 16 : 14 }}>
      {workbook ? <table aria-label={sheet}><caption>{copy['chat.attachment.cellRange'].replace('{{range}}', `${column === 1 ? 'A' : 'U'}${page === 1 ? '1' : '101'}:${column === 1 ? 'B' : 'V'}${page === 1 ? '2' : '102'}`)}</caption><thead>
        <tr><th /><th scope="col">{column === 1 ? 'A' : 'U'}</th><th scope="col">{column === 1 ? 'B' : 'V'}</th></tr></thead><tbody>
        <tr><th scope="row">{page === 1 ? '1' : '101'}</th><td>{sheet}</td><td>{column === 1 ? 'Status' : 'Owner'}</td></tr>
        <tr><th scope="row">{page === 1 ? '2' : '102'}</th><td>{page === 1 ? 'Design review' : 'Release review'}</td><td>{column === 1 ? 'Ready' : 'Alice'}</td></tr>
      </tbody></table> : <>
        <Typography.Title level={4}>{filename}</Typography.Title>
        <Typography.Paragraph>{page === 1 ? 'Design review' : 'Release review'}</Typography.Paragraph>
        <Typography.Paragraph>This sample shows page navigation in the selected file detail.</Typography.Paragraph>
      </>}
    </div>
  </div>;
}

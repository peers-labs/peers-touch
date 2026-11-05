import { Fragment, forwardRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { visibleRange } from '@peers-touch/ui-semantics';
import { Empty, Spin } from './feedback';
import { Button, CopyButton } from './actions';
import type { Tone } from '@peers-touch/ui-contracts';

export interface TextProps extends HTMLAttributes<HTMLSpanElement> {
  strong?: boolean; tone?: Tone | 'primary' | 'secondary' | 'muted'; truncate?: boolean; as?:'span'|'code'; copyValue?:string;
}
export function Text({ strong, tone = 'primary', truncate, style, as:Tag='span', copyValue, children, className='', ...props }: TextProps) {
  return <Tag {...props} className={`pt-text ${className}`} data-tone={tone} style={{ fontWeight: strong ? 600 : undefined,
    color: `var(--pt-${tone === 'primary'||tone==='neutral' ? 'text' : tone})`,
    ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as CSSProperties : {}),
    ...style }}>{children}{copyValue!==undefined&&<CopyButton actionId="text.copy" text={copyValue} label="Copy" copiedLabel="Copied" emphasis="quiet" density="compact"/>}</Tag>;
}
export interface ParagraphProps extends HTMLAttributes<HTMLParagraphElement> {
  tone?: TextProps['tone']; maximumLines?: number;
}
export function Paragraph({ tone, maximumLines, style, className='', ...props }: ParagraphProps) {
  return <p {...props} className={`pt-paragraph ${className}`} style={{
    color: tone ? `var(--pt-${tone === 'primary' || tone === 'neutral' ? 'text' : tone})` : undefined,
    ...(maximumLines ? { display: '-webkit-box', WebkitLineClamp: maximumLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as CSSProperties : {}),
    ...style,
  }} />;
}
export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> { level?: 1 | 2 | 3 | 4 | 5 | 6; truncate?: boolean }
export function Heading({ level = 2, truncate, style, className='', ...props }: HeadingProps) {
  const Tag = `h${level}` as 'h2';
  return <Tag {...props} className={`pt-heading ${className}`} style={{ ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as CSSProperties : {}), ...style }} />;
}
/**
 * Pick a glyph color that clears the avatar tile fill. The primitive accepts
 * arbitrary caller-owned backgrounds (identity tiles, generated avatars), so
 * the fixed ink glyph cannot work on dark fills. Returns undefined when the
 * background is unresolved, leaving the token-driven CSS default in place.
 */
function glyphColorFor(background?: string): string | undefined {
  if (!background) return undefined;
  const hex = background.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  const rgb = background.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  let channels: number[] | null = null;
  if (hex) {
    const digits = hex[1];
    const full = digits.length === 3 ? [...digits].map(c => c + c).join('') : digits;
    channels = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
  } else if (rgb) {
    channels = rgb.slice(1, 4).map(Number);
  }
  if (!channels || channels.some(Number.isNaN)) return undefined;
  const linear = channels.map(c => {
    const srgb = c / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance < 0.2 ? 'var(--pt-white)' : 'var(--pt-primary)';
}

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  source?: string; name?: string; size?: number; fallback?: ReactNode; background?: string;
  onImageFailure?: () => void;
}
export function Avatar({ source, name = '', size = 36, fallback, children, background, onImageFailure, style, className = '', ...props }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span {...props} className={`pt-avatar ${className}`} role={source && failed !== source ? undefined : 'img'}
    aria-label={source && failed !== source ? undefined : name}
    style={{ width: size, height: size, borderRadius: Math.max(8, Math.floor(size * .25)), background, color: glyphColorFor(background), ...style }}>
    {source && failed !== source ? <img src={source} alt={name} onError={() => {setFailed(source);onImageFailure?.();}} />
      : fallback ?? children ?? [...name.trim()][0]?.toLocaleUpperCase() ?? '?'}
  </span>;
}
export function AvatarGroup({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} style={{ display: 'flex', gap: 'var(--pt-space-xxs)', ...props.style }}>{children}</div>;
}
export interface ListProps<T> extends Omit<HTMLAttributes<HTMLUListElement>, 'children'> {
  items: readonly T[]; itemKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode; emptyLabel?: ReactNode;
}
export function List<T>({ items, itemKey, renderItem, emptyLabel, className = '', ...props }: ListProps<T>) {
  if (!items.length) return <Empty description={emptyLabel} />;
  return <ul {...props} className={`pt-list ${className}`}>{items.map((item, i) => <li key={itemKey(item, i)}>{renderItem(item, i)}</li>)}</ul>;
}
export const ListItem = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { actions?: ReactNode }>(
  function ListItem({ actions, children, className = '', ...props }, ref) {
    return <div {...props} ref={ref} className={`pt-list-item ${className}`}>{children}{actions && <div className="pt-action-group">{actions}</div>}</div>;
  });
export interface ListItemMetaProps { avatar?: ReactNode; title?: ReactNode; description?: ReactNode }
export function ListItemMeta({ avatar, title, description }: ListItemMetaProps) {
  return <div className="pt-list-meta">{avatar}<div style={{ minWidth: 0 }}><div className="pt-list-title">{title}</div>
    <div className="pt-list-description">{description}</div></div></div>;
}
export interface DescriptionItem { id: string; label: ReactNode; content: ReactNode }
export interface DescriptionsProps extends HTMLAttributes<HTMLDListElement> { items?: readonly DescriptionItem[]; columns?: number }
export function Descriptions({ items, children, columns = 1, className = '', style, ...props }: DescriptionsProps) {
  return <dl {...props} className={`pt-descriptions ${className}`} style={{gridTemplateColumns:`repeat(${columns},max-content minmax(0,1fr))`,...style}}>
    {items?.map(item => <div key={item.id} style={{ display: 'contents' }}><dt>{item.label}</dt><dd>{item.content}</dd></div>)}
    {children}
  </dl>;
}
export function Description({label,children,span=1}:{label:ReactNode;children:ReactNode;span?:number}) {
  return <><dt>{label}</dt><dd style={{gridColumn:`span ${span*2-1}`}}>{children}</dd></>;
}
export interface TableColumn<T> {
  id: string; label: ReactNode; value?: keyof T | ((row: T) => ReactNode);
  renderCell?: (row: T, index: number) => ReactNode; width?: number | string; align?: 'left' | 'right' | 'center';
  compare?: (a: T, b: T) => number;
}
export interface DataTableProps<T> extends HTMLAttributes<HTMLDivElement> {
  rows: readonly T[]; columns: readonly TableColumn<T>[]; rowKey: keyof T | ((row: T) => string | number);
  loading?: boolean; emptyLabel?: ReactNode; pageSize?: number;
  initialSort?: {columnId:string;direction:'ascending'|'descending'};
  rowAttributes?: (row: T, index: number) => HTMLAttributes<HTMLTableRowElement>;
  renderExpanded?: (row: T) => ReactNode;
}
export function DataTable<T>({ rows, columns, rowKey, loading, emptyLabel, pageSize, initialSort,
  rowAttributes, renderExpanded, className = '', ...props }: DataTableProps<T>) {
  const [page, setPage] = useState(1), [sort, setSort] = useState<{ column: string; reverse: boolean } | null>(
    initialSort ? {column:initialSort.columnId,reverse:initialSort.direction==='descending'} : null);
  const [expanded, setExpanded] = useState(new Set<string | number>());
  const comparator = columns.find(c => c.id === sort?.column)?.compare;
  const sorted = comparator ? [...rows].sort((a,b) => comparator(a,b) * (sort?.reverse ? -1 : 1)) : rows;
  const activePage = pageSize ? Math.min(page,Math.max(1,Math.ceil(rows.length/pageSize))) : page;
  const visible = pageSize ? sorted.slice((activePage-1)*pageSize, activePage*pageSize) : sorted;
  const keyFor = (row: T) => typeof rowKey === 'function' ? rowKey(row) : String(row[rowKey]);
  return <div {...props} className={className}>
    {loading && <Spin label="Loading" />}
    <div className="pt-table-container"><table className="pt-table">
      <thead><tr>{renderExpanded && <th scope="col" aria-label="Details" />}
        {columns.map(column => <th key={column.id} scope="col" style={{ width: column.width, textAlign: column.align }}
          aria-sort={sort?.column === column.id ? sort.reverse ? 'descending' : 'ascending' : undefined}>
          {column.compare ? <Button actionId={`table.sort.${column.id}`} emphasis="quiet"
            onActivate={() => setSort({ column: column.id, reverse: sort?.column === column.id ? !sort.reverse : false })}>{column.label}</Button> : column.label}
        </th>)}</tr></thead>
      <tbody>{visible.length ? visible.map((row, index) => {
        const key = keyFor(row), cell = (column: TableColumn<T>) => column.renderCell ? column.renderCell(row,index)
          : typeof column.value === 'function' ? column.value(row) : column.value ? String(row[column.value] ?? '') : '';
        return <Fragment key={key}>
          <tr {...rowAttributes?.(row,index)}>{renderExpanded && <td><Button actionId={`table.expand.${key}`} label={expanded.has(key) ? 'Collapse' : 'Details'}
            aria-expanded={expanded.has(key)} emphasis="quiet" onActivate={() => setExpanded(old => {
              const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next;
            })} /></td>}
            {columns.map(column => <td key={column.id} style={{ textAlign: column.align }}>{cell(column)}</td>)}</tr>
          {renderExpanded && expanded.has(key) && <tr><td colSpan={columns.length+1}>{renderExpanded(row)}</td></tr>}
        </Fragment>;
      }) : <tr><td colSpan={columns.length+(renderExpanded ? 1 : 0)}><Empty description={emptyLabel} /></td></tr>}</tbody>
    </table></div>
    {pageSize && rows.length > pageSize && <Pagination page={activePage} total={rows.length} pageSize={pageSize} onPageChange={setPage} />}
  </div>;
}
export interface PaginationProps {
  page: number; total: number; pageSize?: number; onPageChange: (page: number) => void;
  previousLabel?: string; nextLabel?: string;
}
export function Pagination({ page, total, pageSize = 20, onPageChange, previousLabel = 'Previous', nextLabel = 'Next' }: PaginationProps) {
  const count = Math.max(1, Math.ceil(total/pageSize));
  return <nav className="pt-action-group" aria-label="Pagination">
    <Button actionId="pagination.previous" label={previousLabel} availability={page <= 1 ? { kind: 'disabled', reason: 'First page' } : undefined} onActivate={() => onPageChange(page-1)} />
    <span aria-live="polite">{page} / {count}</span>
    <Button actionId="pagination.next" label={nextLabel} availability={page >= count ? { kind: 'disabled', reason: 'Last page' } : undefined} onActivate={() => onPageChange(page+1)} />
  </nav>;
}
export interface VirtualListProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  items: readonly T[]; itemKey: (item: T, index: number) => string | number; renderItem: (item: T, index: number) => ReactNode;
  rowHeight: number; height: number; overscan?: number; emptyLabel?: ReactNode;
}
export function VirtualList<T>({ items, itemKey, renderItem, rowHeight, height, overscan, emptyLabel, style, ...props }: VirtualListProps<T>) {
  if (!items.length) return <Empty description={emptyLabel}/>;
  return <VirtualListWindow items={items} itemKey={itemKey} renderItem={renderItem} rowHeight={rowHeight} height={height} overscan={overscan} style={style} {...props}/>;
}
function VirtualListWindow<T>({ items, itemKey, renderItem, rowHeight, height, overscan, style, ...props }: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const range = visibleRange(scrollTop, height, rowHeight, items.length, overscan);
  return <div {...props} role="list" style={{ height, overflow: 'auto', ...style }} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
    <div style={{ height: items.length * rowHeight, position: 'relative' }}>
      {items.slice(range.start, range.end).map((item,i) => <div role="listitem" key={itemKey(item,range.start+i)}
        aria-setsize={items.length} aria-posinset={range.start+i+1}
        style={{ position: 'absolute', top: (range.start+i)*rowHeight, height: rowHeight, left: 0, right: 0 }}>
        {renderItem(item,range.start+i)}</div>)}
    </div>
  </div>;
}

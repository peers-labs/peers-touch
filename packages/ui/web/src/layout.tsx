import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';

export interface FlexProps extends HTMLAttributes<HTMLDivElement> {
  direction?: 'row' | 'column'; align?: CSSProperties['alignItems']; justify?: CSSProperties['justifyContent'];
  gap?: number | string; wrap?: CSSProperties['flexWrap']; flex?: CSSProperties['flex'];
  width?: CSSProperties['width']; height?: CSSProperties['height'];
}
export const Flex = forwardRef<HTMLDivElement, FlexProps>(function Flex({
  direction = 'column', align, justify, gap, wrap, flex, width, height, style, className='', ...props
}, ref) {
  return <div {...props} className={`pt-flex ${className}`} ref={ref} style={{ display: 'flex', flexDirection: direction, alignItems: align,
    justifyContent: justify, gap, flexWrap: wrap, flex, width, height, minWidth: 0, ...style }} />;
});
export function Center(props: FlexProps) { return <Flex align="center" justify="center" {...props} />; }
export interface GridProps extends HTMLAttributes<HTMLDivElement> { columns?: number | string; gap?: number | string }
export function Grid({ columns = 2, gap = 'var(--pt-space-md)', style, className='', ...props }: GridProps) {
  return <div {...props} className={`pt-grid ${className}`} style={{ display: 'grid', gridTemplateColumns: typeof columns === 'number' ? `repeat(${columns},minmax(0,1fr))` : columns, gap, ...style }} />;
}
export function Block(props: HTMLAttributes<HTMLDivElement>) { return <div {...props} />; }
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  heading?: ReactNode; actions?: ReactNode; footer?: ReactNode;
  contentStyle?: CSSProperties; pending?: boolean;
  /** Drop the resting shadow for a card nested in an already-raised region. */
  flat?: boolean;
  /** App-owned class merged onto the card header (layout). */
  headerClassName?: string;
}
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ heading, actions, footer, children, contentStyle, pending, flat = false, className = '', headerClassName = '', ...props }, ref) {
  return <section {...props} ref={ref} className={`pt-card ${className}`} data-flat={flat || undefined}>
    {(heading || actions) && <header className={`pt-card-header ${headerClassName}`}><div className="pt-card-title">{heading}</div>{actions}</header>}
    <div className="pt-card-body" style={contentStyle} aria-busy={pending || undefined}>{pending ? <div role="status" aria-label="Loading" className="pt-skeleton" style={{height:64}} /> : children}</div>
    {footer && <footer>{footer}</footer>}
  </section>;
});
export function Divider({ className = '', ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={`pt-divider ${className}`} />;
}
export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> { maxHeight?: number | string }
export const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea({ maxHeight, style, ...props }, ref) {
  return <div {...props} ref={ref} style={{ overflow: 'auto', minHeight: 0, maxHeight, ...style }} />;
});
export interface LayoutProps { header?: ReactNode; sidebar?: ReactNode; children: ReactNode; footer?: ReactNode; style?: CSSProperties }
export function Layout({ header, sidebar, children, footer, style }: LayoutProps) {
  return <div style={{ display: 'grid', gridTemplateRows: 'auto minmax(0,1fr) auto', minHeight: 0, height: '100%', ...style }}>
    {header && <header>{header}</header>}<div style={{ display: 'flex', minHeight: 0 }}>
      {sidebar && <aside>{sidebar}</aside>}<main style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{children}</main>
    </div>{footer && <footer>{footer}</footer>}
  </div>;
}
export function Header(props: HTMLAttributes<HTMLElement>) { return <header {...props} />; }

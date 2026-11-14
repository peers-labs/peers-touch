import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResourceView } from '@peers-touch/ui-contracts';
import { Button } from './actions';
import { Dialog } from './overlays';
import { Image } from './media';
import './image-grid.css';

export interface ImageGridCopy {
  title: string;
  close: string;
  previous: string;
  next: string;
  singleImage: string;
  openImage: (index: number, total: number) => string;
}

export type ImageRenderer = (resource: ResourceView, mode: 'thumbnail' | 'full') => ReactNode;

export interface LightboxProps {
  images: readonly ResourceView[];
  index: number | null;
  copy: ImageGridCopy;
  onIndexChange: (index: number) => void;
  onDismiss: () => void;
  renderImage?: ImageRenderer;
}

const renderResource: ImageRenderer = resource => <Image resource={resource} alt={resource.name} />;

/** No resolution, fetch, or authorization occurs in the presentation owner. */
export function Lightbox({ images, index, copy, onIndexChange, onDismiss,
  renderImage = renderResource }: LightboxProps) {
  const root = useRef<HTMLDivElement>(null);
  const total = images.length;
  const active = index === null || total === 0 ? null : Math.max(0, Math.min(index, total - 1));
  const shift = (delta: number) => {
    if (active !== null && total > 1) onIndexChange((active + delta + total) % total);
  };
  useEffect(() => {
    if (active === null) return;
    const onKey = (event: KeyboardEvent) => {
      const dialog = root.current?.closest('[role="dialog"]');
      if (!(event.target instanceof Node) || !dialog?.contains(event.target)) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      if (total > 1) onIndexChange((active + (event.key === 'ArrowLeft' ? -1 : 1) + total) % total);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, total, onIndexChange]);
  return <Dialog open={active !== null} onDismiss={onDismiss} title={copy.title}
    width={620} closeLabel={copy.close}
    footer={<>
      <Button actionId="lightbox.prev" emphasis="secondary" label={copy.previous}
        availability={total <= 1 ? { kind: 'disabled', reason: copy.singleImage } : undefined}
        onActivate={() => shift(-1)} />
      <Button actionId="lightbox.next" emphasis="secondary" label={copy.next}
        availability={total <= 1 ? { kind: 'disabled', reason: copy.singleImage } : undefined}
        onActivate={() => shift(1)} />
    </>}>
    {active !== null && <div className="pt-lightbox" ref={root}>
      <div key={images[active].resourceId} className="pt-lightbox-image">
        {renderImage(images[active], 'full')}
      </div>
      <span className="pt-lightbox-count" aria-live="polite">{active + 1} / {total}</span>
    </div>}
  </Dialog>;
}

export interface ImageGridProps {
  images: readonly ResourceView[];
  copy: ImageGridCopy;
  renderImage?: ImageRenderer;
}

/** One/nine images, stable source-keyed cells, one library-owned modal. */
export function ImageGrid({ images, copy, renderImage = renderResource }: ImageGridProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const visible = images.slice(0, 9);
  const count = visible.length;
  const selectedIndex = visible.findIndex(resource => resource.resourceId === selected);
  const index = selectedIndex < 0 ? null : selectedIndex;
  useEffect(() => {
    if (selected !== null && selectedIndex < 0) setSelected(null);
  }, [selected, selectedIndex]);
  if (!count) return null;
  const columns = count === 1 ? 1 : count === 2 || count === 4 ? 2 : 3;
  return <>
    <div className="pt-image-grid" data-count={count} data-columns={columns}>
      {visible.map((resource, at) => <Button key={resource.resourceId}
        actionId={`image.open.${resource.resourceId}`} emphasis="quiet"
        className="pt-image-grid-tile" aria-label={copy.openImage(at + 1, count)}
        onActivate={() => setSelected(resource.resourceId)}>
        {renderImage(resource, 'thumbnail')}
      </Button>)}
    </div>
    <Lightbox images={visible} index={index} copy={copy}
      onIndexChange={at => setSelected(visible[at].resourceId)}
      onDismiss={() => setSelected(null)} renderImage={renderImage} />
  </>;
}

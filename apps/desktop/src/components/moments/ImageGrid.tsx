import { useState } from 'react';
import { theme } from 'antd';
import { ImageThumbnail } from './ImageThumbnail';
import { ImageLightbox } from './ImageLightbox';
import type { Audience, ImageAttachment } from '../../gen/proto/domain/social/post_pb';

// ImageGrid — renders 1-9 image attachments in WeChat-style layout:
//
//   1     -> single image, 60% width, native aspect via cover
//   2     -> 1x2 squares
//   3     -> 1x3 squares
//   4     -> 2x2 squares
//   5..9  -> 3x3 squares (extra slots stay empty)
//
// Click any thumbnail to open the lightbox carousel starting at that
// index. The grid itself is layout-only; per-image fetch happens
// inside ImageThumbnail via useOssAttachmentUrl.

interface ImageGridProps {
  cids: string[];
  images?: ImageAttachment[];
  audience?: Audience | null;
  authorPtid?: string | null;
  /** Optional alt text per image. */
  alts?: string[];
}

interface GridLayout {
  columns: number;
  /** Whether to constrain the single image to a fixed max width. */
  singleWide: boolean;
}

function pickLayout(n: number): GridLayout {
  if (n <= 1) return { columns: 1, singleWide: true };
  if (n === 2) return { columns: 2, singleWide: false };
  if (n === 3) return { columns: 3, singleWide: false };
  if (n === 4) return { columns: 2, singleWide: false };
  return { columns: 3, singleWide: false };
}

export function ImageGrid({ cids, images, audience, authorPtid, alts }: ImageGridProps) {
  const { token } = theme.useToken();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!cids.length) return null;

  const layout = pickLayout(cids.length);

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${layout.columns}, 1fr)`,
    gap: 3,
    marginTop: 10,
    maxWidth: layout.singleWide ? 300 : 340,
  };

  return (
    <>
      <div style={gridStyle}>
        {cids.map((cid, idx) => (
          <div
            key={`${cid}-${idx}`}
            style={{
              borderRadius: token.borderRadius,
              overflow: 'hidden',
              background: token.colorBgLayout,
            }}
          >
            <ImageThumbnail
              cid={cid}
              attachment={images?.[idx]}
              audience={audience}
              authorPtid={authorPtid}
              alt={alts?.[idx]}
              disablePreview
              onClick={() => setLightboxIndex(idx)}
              aspectRatio={layout.singleWide ? 'auto' : '1 / 1'}
            />
          </div>
        ))}
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          cids={cids}
          images={images}
          audience={audience}
          authorPtid={authorPtid}
          alts={alts}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

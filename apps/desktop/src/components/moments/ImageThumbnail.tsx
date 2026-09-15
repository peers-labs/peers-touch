import { useState } from 'react';
import { Image, theme } from 'antd';
import { ImageIcon } from 'lucide-react';
import { useOssAttachmentUrl } from '../shared/oss/useOssAttachmentUrl';

// ImageThumbnail — displays a Moments image attachment.
//
// Resolution strategy (P3, 2026-04-29):
//   1. http(s) URLs render directly so reposts / external link
//      previews keep working without a Tauri round-trip.
//   2. `oss://origin/key` (and bare keys) go through
//      `useOssAttachmentUrl` which calls oss_resolve_url and prefers
//      the local-cached file:// path when available.
//   3. Anything that fails resolution falls back to the placeholder
//      icon so the feed never shows a broken-image glyph.
//
// Lightbox behaviour is owned by AntD's Image component; pass
// `preview={false}` from the parent grid when rendering inside a
// custom lightbox container.

interface ImageThumbnailProps {
  cid: string;
  /** Optional fallback alt text for accessibility. */
  alt?: string;
  /** Disable AntD's built-in preview (parent owns lightbox). */
  disablePreview?: boolean;
  /** Optional click handler — used by ImageGrid to open lightbox. */
  onClick?: () => void;
  /** Optional aspect ratio override (default 1/1). */
  aspectRatio?: string;
}

export function ImageThumbnail({
  cid,
  alt,
  disablePreview = false,
  onClick,
  aspectRatio = '1 / 1',
}: ImageThumbnailProps) {
  const { token } = theme.useToken();
  const [err, setErr] = useState<boolean>(false);

  const isHttp = cid.startsWith('http://') || cid.startsWith('https://');
  const resolved = useOssAttachmentUrl(isHttp ? null : cid);
  const src = isHttp ? cid : resolved;

  if (!src || err) {
    return (
      <div
        style={{
          aspectRatio,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: token.colorFillSecondary,
          borderRadius: token.borderRadiusSM,
          color: token.colorTextTertiary,
        }}
      >
        <ImageIcon size={28} />
      </div>
    );
  }

  if (onClick || disablePreview) {
    // Custom click target / no built-in preview — render a plain
    // <img> so the parent (e.g. lightbox grid) owns the interaction.
    return (
      <img
        src={src}
        alt={alt || cid}
        onClick={onClick}
        onError={() => setErr(true)}
        style={{
          objectFit: 'cover',
          aspectRatio,
          width: '100%',
          height: '100%',
          borderRadius: token.borderRadiusSM,
          cursor: onClick ? 'pointer' : 'default',
          display: 'block',
        }}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt || cid}
      style={{
        objectFit: 'cover',
        aspectRatio,
        width: '100%',
        borderRadius: token.borderRadiusSM,
      }}
      onError={() => setErr(true)}
      preview={{ mask: false }}
    />
  );
}

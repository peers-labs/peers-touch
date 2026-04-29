import { useEffect, useState } from 'react';
import { Image, theme } from 'antd';
import { ImageIcon } from 'lucide-react';

// ImageThumbnail — displays a Moments image attachment.
//
// What's special:
//   - The CID convention is `oss://origin/key`. In P2 we don't have
//     OSS upload wired into the composer (deferred), but the
//     backend Mirror'd the CID into `ImageAttachment.url` during
//     P1 closure so reposts / pre-existing images can still render.
//   - The desktop already has an OSS resolver (`resolveOssCid`) that
//     turns `oss://...` into either a local file URL (when cached)
//     or a fetch URL. We call it lazily so the thumbnail doesn't
//     block the feed render.

interface ImageThumbnailProps {
  cid: string;
  /** Optional fallback alt text for accessibility. */
  alt?: string;
}

export function ImageThumbnail({ cid, alt }: ImageThumbnailProps) {
  const { token } = theme.useToken();
  const [src, setSrc] = useState<string | undefined>(undefined);
  const [err, setErr] = useState<boolean>(false);

  useEffect(() => {
    if (!cid) {
      setSrc(undefined);
      return;
    }
    // For P2 we render the CID directly; if it's already a fetchable
    // http(s) URL the <Image> tag will load it. The OSS resolver
    // hookup lands when the upload path lands — at that point we
    // swap this for an `await resolveOssCid(cid)` call.
    if (cid.startsWith('http://') || cid.startsWith('https://')) {
      setSrc(cid);
      return;
    }
    // `oss://` and other custom-scheme CIDs render as a placeholder
    // until the OSS resolver hookup lands.
    setSrc(undefined);
  }, [cid]);

  if (!src || err) {
    return (
      <div
        style={{
          aspectRatio: '1 / 1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: token.colorFillSecondary,
          borderRadius: 6,
          color: token.colorTextTertiary,
        }}
      >
        <ImageIcon size={28} />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt || cid}
      style={{
        objectFit: 'cover',
        aspectRatio: '1 / 1',
        width: '100%',
        borderRadius: 6,
      }}
      onError={() => setErr(true)}
      preview={{ mask: false }}
    />
  );
}

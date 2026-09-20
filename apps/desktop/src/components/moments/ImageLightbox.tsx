import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, theme } from 'antd';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useOssAttachmentUrl } from '../shared/oss/useOssAttachmentUrl';

// ImageLightbox — full-screen modal viewer for one or more attached
// images. Keyboard controls:
//
//   Esc   -> close
//   <-    -> previous
//   ->    -> next
//
// Backdrop click also closes. The viewer keeps its own index state so
// the caller only needs to supply `startIndex`.

interface ImageLightboxProps {
  cids: string[];
  alts?: string[];
  startIndex: number;
  onClose: () => void;
}

export function ImageLightbox({
  cids,
  alts,
  startIndex,
  onClose,
}: ImageLightboxProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('moments');
  const [index, setIndex] = useState(startIndex);

  const total = cids.length;
  const cid = cids[index];
  const isHttp = cid.startsWith('http://') || cid.startsWith('https://');
  const resolved = useOssAttachmentUrl(isHttp ? null : cid);
  const src = isHttp ? cid : resolved;

  const prev = useCallback(
    () => setIndex((i) => (i - 1 + total) % total),
    [total],
  );
  const next = useCallback(() => setIndex((i) => (i + 1) % total), [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && total > 1) prev();
      else if (e.key === 'ArrowRight' && total > 1) next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, prev, next, total]);

  return (
    <Modal
      open
      footer={null}
      closable={false}
      maskClosable
      onCancel={onClose}
      width="auto"
      centered
      styles={{
        body: { background: 'transparent', padding: 0 },
        mask: { background: 'rgba(0,0,0,0.85)' },
      }}
      style={{ background: 'transparent', boxShadow: 'none' }}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 360,
          minHeight: 360,
          maxWidth: '90vw',
          maxHeight: '90vh',
        }}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('moments.lightbox.close')}
          style={{
            position: 'absolute',
            top: -36,
            right: -4,
            background: 'rgba(255,255,255,0.15)',
            color: token.colorWhite,
            border: 'none',
            borderRadius: '50%',
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <X size={16} />
        </button>

        {/* Previous arrow */}
        {total > 1 && (
          <button
            type="button"
            onClick={prev}
            aria-label={t('moments.lightbox.previous')}
            style={navBtnStyle('left', token)}
          >
            <ChevronLeft size={22} />
          </button>
        )}

        {/* Image */}
        {src ? (
          <img
            src={src}
            alt={alts?.[index] || cid}
            style={{
              maxWidth: '90vw',
              maxHeight: '90vh',
              borderRadius: token.borderRadius,
              objectFit: 'contain',
              background: '#000',
            }}
          />
        ) : (
          <div
            style={{
              width: 360,
              height: 360,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: token.colorTextTertiary,
            }}
          >
            {t('moments.lightbox.loading')}
          </div>
        )}

        {/* Next arrow */}
        {total > 1 && (
          <button
            type="button"
            onClick={next}
            aria-label={t('moments.lightbox.next')}
            style={navBtnStyle('right', token)}
          >
            <ChevronRight size={22} />
          </button>
        )}

        {/* Index pill */}
        {total > 1 && (
          <div
            style={{
              position: 'absolute',
              bottom: -28,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '2px 10px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.15)',
              color: token.colorWhite,
              fontSize: 12,
            }}
          >
            {index + 1} / {total}
          </div>
        )}
      </div>
    </Modal>
  );
}

function navBtnStyle(
  side: 'left' | 'right',
  token: ReturnType<typeof theme.useToken>['token'],
): React.CSSProperties {
  return {
    position: 'absolute',
    [side]: -48,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'rgba(255,255,255,0.15)',
    color: token.colorWhite,
    border: 'none',
    borderRadius: '50%',
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  };
}

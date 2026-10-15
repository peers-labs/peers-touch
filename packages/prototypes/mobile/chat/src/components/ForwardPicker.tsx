import { useCallback, useEffect, useRef } from 'react';
import { demoConversations } from '../data';
import { IdentityAvatar } from './IdentityAvatar';
import { useDismissableLayer } from './useDismissableLayer';

export function ForwardPicker({ sourceName, preview, onSelect, onClose }: {
  sourceName: string;
  preview: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const close = useCallback(onClose, [onClose]);
  useDismissableLayer({
    open: true,
    containerRef: sheetRef,
    onDismiss: close,
    dismissOnWindowBlur: true,
  });
  useEffect(() => {
    const previousFocus = document.activeElement;
    sheetRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <div className="mp-action-sheet-backdrop" onClick={onClose}>
      <div ref={sheetRef} className="mp-action-sheet" role="dialog" aria-modal="true"
        aria-label="Forward message" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="mp-action-sheet-handle" />
        <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 15 }}>Forward to...</div>
        <div style={{ padding: '0 16px 12px', color: 'var(--pt-text-secondary)', fontSize: 12 }}>
          <strong data-chat-forward-sender>{sourceName}</strong>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 }}>{preview}</div>
        </div>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {demoConversations.map((conv) => (
            <button
              key={conv.key}
              type="button"
              className="mp-action-item"
              onClick={() => onSelect(conv.name)}
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
            >
              <IdentityAvatar name={conv.name} initials={conv.avatar} src={conv.avatarUrl}
                kind={conv.isGroup ? 'group' : 'person'} size={32} />
              <span>{conv.name}</span>
            </button>
          ))}
        </div>
        <div style={{ padding: '8px 16px' }}>
          <button type="button" className="mp-action-item mp-action-cancel" onClick={onClose}>
            <span>Cancel</span>
          </button>
        </div>
      </div>
    </div>
  );
}

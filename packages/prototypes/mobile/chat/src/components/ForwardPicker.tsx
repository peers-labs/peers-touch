import { demoConversations } from '../data';
import { IdentityAvatar } from './IdentityAvatar';

export function ForwardPicker({ onSelect, onClose }: { onSelect: (name: string) => void; onClose: () => void }) {
  return (
    <div className="mp-action-sheet-backdrop" onClick={onClose}>
      <div className="mp-action-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mp-action-sheet-handle" />
        <div style={{ padding: '12px 16px', fontWeight: 600, fontSize: 15 }}>Forward to...</div>
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

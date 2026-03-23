/**
 * Agent Pilot — Command bar (⌘K)
 */
import { useState, useEffect } from 'react';
import { Modal, Input } from 'antd';
import { Command } from 'lucide-react';

interface Action {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  actions: Action[];
}

export function CommandBar({ open, onClose, actions }: Props) {
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (open) setSearch('');
  }, [open]);

  const filtered = search.trim()
    ? actions.filter((a) => a.label.toLowerCase().includes(search.toLowerCase()))
    : actions;

  const handleSelect = (a: Action) => {
    a.run();
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={400}
      styles={{ body: { padding: 0 } }}
      style={{ top: 100 }}
    >
      <Input
        autoFocus
        prefix={<Command size={16} />}
        placeholder="Run command..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        size="large"
        bordered={false}
        style={{ padding: '12px 16px' }}
      />
      <div style={{ maxHeight: 320, overflow: 'auto' }}>
        {filtered.map((a) => (
          <div
            key={a.id}
            role="button"
            tabIndex={0}
            onClick={() => handleSelect(a)}
            onKeyDown={(e) => e.key === 'Enter' && handleSelect(a)}
            style={{
              padding: '12px 16px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(0,0,0,0.04)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <span>{a.label}</span>
            {a.shortcut && (
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{a.shortcut}</span>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

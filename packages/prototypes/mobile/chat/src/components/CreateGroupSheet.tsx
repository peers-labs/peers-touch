import { useMemo, useState, type KeyboardEvent } from 'react';
import { Button, Checkbox, Input, Typography } from 'antd';
import { X } from 'lucide-react';

import copy from '../../../../../locales/en/common.json';
import type { Contact } from '../types';

export function CreateGroupSheet({
  contacts,
  onClose,
  onCreate,
}: {
  contacts: readonly Contact[];
  onClose: () => void;
  onCreate: (name: string, memberKeys: readonly string[]) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') onClose();
  }

  return (
    <div className="mp-action-sheet-backdrop" onClick={onClose}>
      <section
        className="mp-action-sheet mp-create-group-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mp-action-sheet-handle" />
        <header className="mp-detail-header">
          <h2 className="mp-detail-header-title" id="create-group-title">
            {copy['mobile.group.create']}
          </h2>
          <Button
            type="text"
            icon={<X size={20} />}
            onClick={onClose}
            aria-label={copy['common.action.close']}
          />
        </header>
        <div className="mp-create-group-content">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={copy['mobile.group.namePlaceholder']}
          />
          <Input.TextArea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={copy['mobile.group.descriptionPlaceholder']}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
          <div className="mp-section-header">
            <span>{copy['mobile.group.initialMembers']}</span>
            <span>{selected.length}</span>
          </div>
          <div className="mp-create-group-members">
            {contacts.map((contact) => (
              <label className="mp-request-item" key={contact.key}>
                <span
                  className="mp-create-group-avatar"
                  style={{ background: contact.avatarGradient }}
                >
                  {contact.avatar}
                </span>
                <span className="mp-request-info">
                  <Typography.Text strong>{contact.name}</Typography.Text>
                  <Typography.Text type="secondary">{contact.note}</Typography.Text>
                </span>
                <Checkbox
                  checked={selectedSet.has(contact.key)}
                  aria-label={contact.name}
                  onChange={(event) => setSelected((current) => (
                    event.target.checked
                      ? [...new Set([...current, contact.key])]
                      : current.filter((key) => key !== contact.key)
                  ))}
                />
              </label>
            ))}
          </div>
          <div className="mp-create-group-actions">
            <Button onClick={onClose}>{copy['common.action.cancel']}</Button>
            <Button
              type="primary"
              disabled={!name.trim() || selected.length === 0}
              onClick={() => onCreate(name.trim(), selected)}
            >
              {copy['mobile.group.create']}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

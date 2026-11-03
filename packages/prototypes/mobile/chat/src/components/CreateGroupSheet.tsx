import { useMemo, useState, type KeyboardEvent } from 'react';
import { useT } from '../i18n';
import { Button, Checkbox, Icon, Text, TextArea, TextField } from '@peers-touch/ui';
import type { Contact } from '../types';
import { IdentityAvatar } from './IdentityAvatar';

export function CreateGroupSheet({
  contacts,
  onClose,
  onCreate,
}: {
  contacts: readonly Contact[];
  onClose: () => void;
  onClose2?: never;
  onCreate: (name: string, memberKeys: readonly string[]) => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') onClose();
  }

  return (
    <div className="mp-action-sheet-backdrop" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="mp-action-sheet mp-create-group-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="mp-action-sheet-handle" />
        <header className="mp-social-sheet-header">
          <span className="mp-social-sheet-spacer" />
          <h2 id="create-group-title">{t('mobile.group.create')}</h2>
          <Button actionId="create-group.close" emphasis="quiet" leading={<Icon iconId="close" size={18} />}
            aria-label={t('common.action.close')} onActivate={onClose} />
        </header>
        <div className="mp-create-group-content">
          <TextField
            value={name}
            placeholder={t('mobile.group.namePlaceholder')}
            onValueChange={setName}
          />
          <TextArea
            value={description}
            placeholder={t('mobile.group.descriptionPlaceholder')}
            minimumRows={2}
            maximumRows={4}
            framing="embedded"
            onValueChange={setDescription}
          />
          <div className="mp-section-header">
            <span>{t('mobile.group.initialMembers')}</span>
            <Text tone="secondary">{selected.length}</Text>
          </div>
          <div className="mp-create-group-members">
            {contacts.map((contact) => (
              <label className="mp-request-item" key={contact.key}>
                <IdentityAvatar name={contact.name} initials={contact.avatar}
                  src={contact.avatarUrl} size={40} />
                <span className="mp-request-info">
                  <Text strong>{contact.name}</Text>
                  <Text tone="secondary">{contact.note}</Text>
                </span>
                <Checkbox
                  checked={selectedSet.has(contact.key)}
                  aria-label={contact.name}
                  onCheckedChange={(checked) => setSelected((current) => (
                    checked
                      ? [...new Set([...current, contact.key])]
                      : current.filter((key) => key !== contact.key)
                  ))}
                />
              </label>
            ))}
          </div>
          <div className="mp-create-group-actions">
            <Button actionId="create-group.cancel" onActivate={onClose}>
              {t('common.action.cancel')}
            </Button>
            <Button actionId="create-group.submit" emphasis="primary"
              availability={!name.trim() || selected.length === 0
                ? { kind: 'disabled', reason: 'Name and members required' }
                : undefined}
              onActivate={() => onCreate(name.trim(), selected)}>
              {t('mobile.group.create')}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * AvatarPickerDialog — the three persisted identity modes in one picker.
 *
 * Parity with production AvatarPicker plus the full AvatarMode union:
 *  - initial: the name's first letter (the default fallback tile);
 *  - emoji:   a curated, searchable emoji grid;
 *  - image:   an uploaded image validated by type and a 2 MB ceiling, with a
 *             preview before Save and Cancel preserving the old value.
 * Every control is a peers-ui primitive; upload goes through FilePickButton.
 */
import { useState } from 'react';
import {
  AgentAvatar, Alert, Button, Dialog, EmojiArtwork, FilePickButton, Flex,
  Icon, ScrollArea, Tabs, Text, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../prefs';
import type { AgentRecord } from '../types';
import {
  ACCEPTED_AVATAR_TYPES, AVATAR_EMOJIS, MAX_AVATAR_BYTES, type AvatarChoice,
} from './types';

interface AvatarPickerDialogProps {
  agent: AgentRecord;
  onClose: () => void;
  onChange: (choice: AvatarChoice) => void;
}

type PickerTab = 'initial' | 'emoji' | 'image';

export function AvatarPickerDialog({ agent, onClose, onChange }: AvatarPickerDialogProps) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [tab, setTab] = useState<PickerTab>(agent.avatarMode === 'image' ? 'image' : agent.avatarMode);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState(agent.avatarMode === 'image' ? agent.avatarValue : '');
  const [error, setError] = useState('');

  const emojis = AVATAR_EMOJIS.filter(emoji =>
    !query.trim() || emoji.includes(query.trim()));

  const chooseFile = (files: readonly File[]) => {
    const file = files[0];
    if (!file) return;
    setError('');
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setError(t('agent.profile.avatar.invalidType'));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError(t('agent.profile.avatar.tooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPreview(reader.result);
    };
    reader.onerror = () => setError(t('agent.profile.avatar.readFailed'));
    reader.readAsDataURL(file);
  };

  const items = [
    {
      id: 'initial',
      label: t('agent.profile.avatar.initial'),
      content: (
        <Flex direction="column" align="center" gap={12} className="pa-avatar-picker__pane">
          <AgentAvatar name={agent.name} size={72} />
          <Text tone="secondary">{t('agent.profile.avatar.initialHint', { name: agent.name })}</Text>
          <Button actionId="avatar.use-initial" emphasis="primary"
            label={t('agent.profile.avatar.save')}
            onActivate={() => { onChange({ mode: 'initial', value: '' }); onClose(); }} />
        </Flex>
      ),
    },
    {
      id: 'emoji',
      label: t('agent.profile.avatar.emoji'),
      content: (
        <Flex direction="column" gap={10} className="pa-avatar-picker__pane">
          <TextField
            value={query}
            clearable
            aria-label={t('agent.profile.avatar.search')}
            placeholder={t('agent.profile.avatar.search')}
            onClear={() => setQuery('')}
            onValueChange={setQuery}
          />
          <ScrollArea className="pa-avatar-picker__grid" maxHeight={240}>
            <div className="pa-avatar-picker__emojis">
              {emojis.map(emoji => (
                <Button
                  key={emoji}
                  actionId={`avatar.emoji.${emoji}`}
                  emphasis="quiet"
                  className="pa-avatar-picker__emoji"
                  aria-label={t('agent.profile.avatar.useEmoji', { emoji })}
                  aria-pressed={agent.avatarMode === 'emoji' && agent.avatarValue === emoji}
                  onActivate={() => { onChange({ mode: 'emoji', value: emoji }); onClose(); }}
                >
                  <EmojiArtwork emoji={emoji} label={emoji} />
                </Button>
              ))}
            </div>
          </ScrollArea>
        </Flex>
      ),
    },
    {
      id: 'image',
      label: t('agent.profile.avatar.upload'),
      content: (
        <Flex direction="column" align="center" gap={10} className="pa-avatar-picker__pane">
          <div className="pa-avatar-picker__preview">
            {preview
              ? <AgentAvatar name={agent.name} source={preview} size={96} />
              : <Text tone="muted">{t('agent.profile.avatar.choose')}</Text>}
          </div>
          <FilePickButton
            actionId="avatar.upload"
            accept={ACCEPTED_AVATAR_TYPES.join(',')}
            emphasis="secondary"
            leading={<Icon iconId="upload" size={14} />}
            label={t('agent.profile.avatar.choose')}
            onFiles={chooseFile}
          />
          <Text tone="muted" className="pa-avatar-picker__requirements">
            {t('agent.profile.avatar.requirements')}
          </Text>
          {error && <Alert tone="danger" title={error} />}
          <Button actionId="avatar.save-image" emphasis="primary"
            label={t('agent.profile.avatar.save')}
            availability={preview ? undefined : { kind: 'disabled', reason: t('agent.profile.avatar.choose') }}
            onActivate={() => { onChange({ mode: 'image', value: preview }); onClose(); }} />
        </Flex>
      ),
    },
  ];

  return (
    <Dialog open title={t('agent.profile.changeAvatar')} width={440}
      closeLabel={t('agent.common.cancel')} onDismiss={onClose}>
      <Tabs items={items} value={tab} onValueChange={value => setTab(value as PickerTab)} />
    </Dialog>
  );
}

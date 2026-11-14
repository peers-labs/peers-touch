/**
 * AgentProfile — the embedded Profile builder, peers-ui only.
 *
 * Parity with production AgentProfilePage › ProfileEditor:
 *  - measured identity grid: a 64px left track shared by the Back control and
 *    the square avatar tile; name and description share the right content
 *    track;
 *  - one persisted identity value projected as initial | emoji | image;
 *  - two sections: Identity (SOUL.md / AGENTS.md) and Extensions (bound
 *    Skills/MCP). Profile owns no model configuration and no task surface.
 * The roster stays mounted by the parent; this surface never mounts Topic
 * history.
 */
import { useState } from 'react';
import {
  AgentAvatar, Button, EmojiArtwork, Flex, Heading, IconButton, ScrollArea,
  Tabs, TextArea, TextField,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../prefs';
import type { AgentRecord, AvatarMode } from '../types';
import { documentsForAgent, extensionsForAgent } from './profile-data';
import type { AvatarChoice, ExtensionRecord, ProfileDocuments } from './types';
import { AvatarPickerDialog } from './AvatarPickerDialog';
import { IdentitySection } from './IdentitySection';
import { ExtensionsSection } from './ExtensionsSection';

type ProfileSection = 'identity' | 'extensions';

interface AgentProfileProps {
  agent: AgentRecord;
  onBack: () => void;
  onIdentityChange: (patch: Partial<Pick<AgentRecord, 'name' | 'description' | 'avatarMode' | 'avatarValue'>>) => void;
}

export function AgentProfile({ agent, onBack, onIdentityChange }: AgentProfileProps) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [section, setSection] = useState<ProfileSection>('identity');
  const [title, setTitle] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [documents, setDocuments] = useState<ProfileDocuments>(() => documentsForAgent(agent.id));
  const [extensions, setExtensions] = useState<ExtensionRecord[]>(() => extensionsForAgent(agent.id));

  const commitTitle = () => {
    const value = title.trim();
    if (value && value !== agent.name) onIdentityChange({ name: value });
    else setTitle(agent.name);
  };

  const commitDescription = () => {
    if (description.trim() !== agent.description) {
      onIdentityChange({ description: description.trim() });
    }
  };

  const changeAvatar = (choice: AvatarChoice) => {
    onIdentityChange({ avatarMode: choice.mode, avatarValue: choice.value });
  };

  const items = [
    {
      id: 'identity',
      label: t('agent.profile.section.identity'),
      content: (
        <IdentitySection documents={documents} onSave={setDocuments} />
      ),
    },
    {
      id: 'extensions',
      label: t('agent.profile.tab.extensions'),
      content: (
        <ExtensionsSection
          extensions={extensions}
          onChanges={setExtensions}
        />
      ),
    },
  ];

  return (
    <ScrollArea className="pa-profile" data-pt-agent-profile={agent.id}>
      <Flex direction="column" gap={12} className="pa-profile__content">
        <Flex direction="row" align="center" gap={12} className="pa-profile__title-row">
          <IconButton actionId="profile.back" iconId="arrow-left" iconSize={16}
            label={t('agent.profile.backToAgent')} emphasis="quiet"
            data-pt-agent-profile-back onActivate={onBack} />
          <TextField
            frameClassName="pa-profile__title-frame"
            value={title}
            aria-label={t('agent.profile.identityTitlePlaceholder')}
            placeholder={t('agent.profile.identityTitlePlaceholder')}
            data-pt-agent-profile-title={agent.id}
            className="pa-profile__title-input"
            onValueChange={setTitle}
            onBlur={commitTitle}
          />
        </Flex>

        <Flex direction="row" gap={12} align="flex-start" className="pa-profile__identity-row">
          <Button
            actionId="profile.change-avatar"
            emphasis="quiet"
            className="pa-profile__avatar-button"
            aria-label={t('agent.profile.changeAvatar')}
            data-pt-avatar-mode={agent.avatarMode}
            onActivate={() => setAvatarPickerOpen(true)}
          >
            <IdentityAvatar agent={agent} />
          </Button>
          <TextArea
            frameClassName="pa-profile__identity-frame"
            value={description}
            framing="embedded"
            minimumRows={3}
            maximumRows={5}
            aria-label={t('agent.profile.identityDescriptionPlaceholder')}
            placeholder={t('agent.profile.identityDescriptionPlaceholder')}
            className="pa-profile__description"
            onValueChange={setDescription}
            onBlur={commitDescription}
          />
        </Flex>

        <Heading level={5} className="pa-profile__agent-id">
          {agent.id}
        </Heading>

        <Tabs
          className="pa-profile__tabs"
          panelClassName="pa-profile__tab-panel"
          items={items}
          value={section}
          onValueChange={value => setSection(value as ProfileSection)}
          aria-label={t('agent.profile.sections')}
        />
      </Flex>

      {avatarPickerOpen && (
        <AvatarPickerDialog
          agent={agent}
          onClose={() => setAvatarPickerOpen(false)}
          onChange={changeAvatar}
        />
      )}
    </ScrollArea>
  );
}

function IdentityAvatar({ agent }: { agent: AgentRecord }) {
  const mode: AvatarMode = agent.avatarMode;
  if (mode === 'image') {
    return <AgentAvatar className="pa-profile__avatar" name={agent.name} source={agent.avatarValue} size={64} />;
  }
  if (mode === 'emoji') {
    return (
      <AgentAvatar className="pa-profile__avatar" name={agent.name} size={64}>
        <EmojiArtwork emoji={agent.avatarValue} label={agent.name} />
      </AgentAvatar>
    );
  }
  return <AgentAvatar className="pa-profile__avatar" name={agent.name} size={64} />;
}

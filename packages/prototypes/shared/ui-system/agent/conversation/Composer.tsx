import { useMemo, useState } from 'react';
import {
  Button, FilePickButton, Flex, Icon, IconButton, Markdown, Popover, Tag, Text,
  TextArea,
} from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../../prefs';
import { SLASH_COMMANDS, SAMPLE_ATTACHMENTS } from './conversation-data';
import {
  DEFAULT_MODEL_ID, FULL_ACCESS_CAPABILITIES, PROVIDER_GROUPS, WORKSPACE_CHOICES,
} from './composer-data';
import type { AttachmentView } from './types';

interface ComposerProps {
  /** A turn is running: Stop stays reachable and sends explain the queue. */
  streaming: boolean;
  blockedReason?: string;
  onSend: (draft: ComposerDraft) => void;
  onStop: () => void;
}

export interface ComposerDraft {
  text: string;
  workspaceId: string;
  fullAccess: boolean;
  modelId: string;
  attachments: AttachmentView[];
}

/**
 * The fixed-bottom composer. Every grant is an explicit local decision:
 * workspace placement and Full Access are per-session chips, the model
 * override is a session-scoped provider tree, attachments flow through the
 * library FilePickButton, and "/" opens the command surface. While a turn
 * runs, Stop remains reachable and the blocked state explains why.
 */
export function Composer({ streaming, blockedReason, onSend, onStop }: ComposerProps) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);

  const [text, setText] = useState('');
  const [workspaceId, setWorkspaceId] = useState(WORKSPACE_CHOICES[0].id);
  const [fullAccess, setFullAccess] = useState(false);
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [attachments, setAttachments] = useState<AttachmentView[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);

  const workspace = WORKSPACE_CHOICES.find(choice => choice.id === workspaceId) ?? WORKSPACE_CHOICES[0];
  const model = useMemo(
    () => PROVIDER_GROUPS.flatMap(group => group.models).find(item => item.id === modelId),
    [modelId],
  );
  // A running turn explains the FIFO queue but never hard-blocks input:
  // sends while streaming are admitted as queued legs instead of dropped.
  const canSend = text.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    onSend({ text: text.trim(), workspaceId, fullAccess, modelId, attachments });
    setText('');
    setAttachments([]);
    setSlashOpen(false);
  };

  return (
    <div className="pa-composer" data-pt-agent-composer data-pt-agent-full-access={fullAccess || undefined}>
      <Flex direction="row" gap={6} className="pa-composer__chips">
        <Popover
          label={t('agent.composer.workspace')}
          placement="top"
          content={(
            <div className="pa-pop-panel">
              {WORKSPACE_CHOICES.map((choice) => (
                <Button
                  key={choice.id}
                  actionId={`workspace.choice.${choice.id}`}
                  emphasis={choice.id === workspaceId ? 'primary' : 'quiet'}
                  fullWidth
                  label={choice.label}
                  onActivate={() => setWorkspaceId(choice.id)}
                />
              ))}
            </div>
          )}
        >
          <Button
            actionId="composer.workspace"
            emphasis="quiet"
            density="compact"
            leading={<Icon iconId={workspace.kind === 'local' ? 'folder' : 'globe'} size={14} />}
            label={workspace.label}
            data-pt-agent-workspace-selector
          />
        </Popover>

        <Popover
          label={t('agent.composer.fullAccess')}
          placement="top"
          content={(
            <div className="pa-pop-panel pa-pop-panel--wide">
              <Text strong>{t('agent.composer.fullAccessTitle')}</Text>
              <Text tone="secondary" className="pa-pop-panel__desc">
                {t('agent.composer.fullAccessDesc')}
              </Text>
              <div className="pa-capability-list">
                {FULL_ACCESS_CAPABILITIES.map((capability) => (
                  <Tag key={capability} tone={fullAccess ? 'warning' : 'neutral'}>
                    {capability}
                  </Tag>
                ))}
              </div>
              <Button
                actionId="composer.full-access-toggle"
                emphasis={fullAccess ? 'primary' : 'secondary'}
                tone={fullAccess ? 'danger' : 'neutral'}
                leading={<Icon iconId={fullAccess ? 'shield-alert' : 'shield-check'} size={14} />}
                label={fullAccess
                  ? t('agent.composer.revokeFullAccess')
                  : t('agent.composer.grantFullAccess')}
                onActivate={() => setFullAccess(value => !value)}
              />
            </div>
          )}
        >
          <Button
            actionId="composer.full-access-chip"
            emphasis="quiet"
            density="compact"
            tone={fullAccess ? 'danger' : 'neutral'}
            leading={<Icon iconId={fullAccess ? 'shield-alert' : 'shield-check'} size={14} />}
            label={fullAccess ? t('agent.composer.fullAccessOn') : t('agent.composer.fullAccess')}
          />
        </Popover>

        <Popover
          label={t('agent.composer.model')}
          placement="top"
          content={(
            <div className="pa-pop-panel pa-pop-panel--wide">
              {PROVIDER_GROUPS.map((group) => (
                <div key={group.id} className="pa-provider-group">
                  <Text tone="muted" className="pa-provider-group__title">{group.label}</Text>
                  {group.models.map((item) => (
                    <Button
                      key={item.id}
                      actionId={`model.choice.${item.id}`}
                      emphasis={item.id === modelId ? 'primary' : 'quiet'}
                      fullWidth
                      availability={item.usable
                        ? undefined
                        : { kind: 'disabled', reason: t('agent.composer.modelUnusable') }}
                      label={`${item.label} · ${item.provider}`}
                      onActivate={() => item.usable && setModelId(item.id)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        >
          <Button
            actionId="composer.model"
            emphasis="quiet"
            density="compact"
            leading={<Icon iconId="bot" size={14} />}
            label={model?.label ?? DEFAULT_MODEL_ID}
            data-pt-agent-model-picker
          />
        </Popover>
      </Flex>

      {attachments.length > 0 && (
        <div className="pa-composer__attachments">
          {attachments.map((attachment) => (
            <Tag key={attachment.id} tone="neutral" className="pa-attachment-chip">
              {attachment.name}
              <IconButton
                actionId={`attachment.remove.${attachment.id}`}
                iconId="close"
                iconSize={12}
                label={t('agent.common.cancel')}
                emphasis="quiet"
                density="compact"
                onActivate={() => setAttachments(previous =>
                  previous.filter(item => item.id !== attachment.id))}
              />
            </Tag>
          ))}
        </div>
      )}

      {slashOpen && (
        <div className="pa-slash-panel" role="group" aria-label={t('agent.composer.slash')}>
          {SLASH_COMMANDS.map((command) => (
            <Button
              key={command.id}
              actionId={`slash.${command.id}`}
              emphasis="quiet"
              fullWidth
              label={`${command.label} — ${command.hint}`}
              onActivate={() => {
                setText(command.label);
                setSlashOpen(false);
              }}
            />
          ))}
        </div>
      )}
      <div className="pa-composer__input">
        <TextArea
          value={text}
          minimumRows={2}
          maximumRows={8}
          framing="embedded"
          placeholder={t('agent.composer.placeholder')}
          data-pt-agent-composer-input
          onValueChange={(value) => {
            setText(value);
            setSlashOpen(value.startsWith('/'));
          }}
          onEnter={(event) => {
            if (event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
        />
      </div>

      {blockedReason && (
        <div className="pa-composer__blocked" role="alert">
          <Markdown content={blockedReason} />
        </div>
      )}

      <Flex direction="row" align="center" className="pa-composer__footer">
        <FilePickButton
          actionId="composer.attach"
          emphasis="quiet"
          density="compact"
          label={t('agent.composer.attach')}
          leading={<Icon iconId="paperclip" size={15} />}
          multiple
          onFiles={(files) => {
            const next = files.map((file, index) => ({
              id: `pick-${Date.now()}-${index}`,
              name: file.name,
              kind: file.type.startsWith('image/') ? 'image' as const : 'file' as const,
              sizeLabel: `${Math.max(1, Math.round(file.size / 1024))} KB`,
            }));
            setAttachments(previous => [...previous, ...next]);
          }}
        />
        <span className="pa-composer__footer-spacer" />
        {streaming && (
          <Button
            actionId="agent.stop"
            emphasis="primary"
            tone="danger"
            leading={<Icon iconId="square" size={15} />}
            label={t('agent.composer.stop')}
            data-pt-agent-stop
            onActivate={onStop}
          />
        )}
        <Button
          actionId="agent.composer-send"
          emphasis="primary"
          leading={<Icon iconId="arrow-up" size={15} />}
          label={t('agent.composer.send')}
          data-pt-agent-composer-send
          availability={canSend
            ? undefined
            : { kind: 'disabled', reason: t('agent.composer.empty') }}
          onActivate={submit}
        />
      </Flex>
    </div>
  );
}

/** Test/demo helper: deterministic sample attachments for screenshot runs. */
export function sampleAttachments(): AttachmentView[] {
  return SAMPLE_ATTACHMENTS.map((item, index) => ({
    id: `sample-${index}`,
    name: item.name,
    kind: item.kind,
    sizeLabel: item.sizeLabel,
  }));
}

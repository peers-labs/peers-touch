/**
 * CreateAgentDialog — the working target of the roster `+` control.
 *
 * It collects only the identity fields a new Agent needs up front (name,
 * description, default model). The avatar starts as an initial derived from
 * the name; the full three-state avatar picker stays in Agent Profile, so the
 * creation flow does not duplicate that editor.
 */
import { useEffect, useState } from 'react';
import { Button, Dialog, Flex, Select, TextArea, TextField } from '@peers-touch/ui';
import { makeTranslate, usePrefs } from '../prefs';
import { DEFAULT_MODEL_ID, PROVIDER_GROUPS } from './conversation/composer-data';

export interface CreateAgentInput {
  name: string;
  description: string;
  defaultModel: string;
}

interface CreateAgentDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateAgentInput) => void;
}

const MODEL_OPTIONS = PROVIDER_GROUPS
  .flatMap(group => group.models)
  .filter(model => model.usable)
  .map(model => ({ value: model.id, label: model.label }));

export function CreateAgentDialog({ open, onClose, onCreate }: CreateAgentDialogProps) {
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);

  // Re-arm a clean form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setModelId(DEFAULT_MODEL_ID);
    }
  }, [open]);

  const canCreate = name.trim().length > 0;
  const modelLabel = PROVIDER_GROUPS.flatMap(group => group.models)
    .find(model => model.id === modelId)?.label ?? modelId;

  const submit = () => {
    if (!canCreate) return;
    onCreate({ name: name.trim(), description: description.trim(), defaultModel: modelLabel });
    onClose();
  };

  return (
    <Dialog
      open={open}
      title={t('agent.roster.create.title')}
      onDismiss={onClose}
      closeLabel={t('agent.common.cancel')}
      data-pt-create-agent
      footer={(
        <Flex direction="row" gap={8} justify="flex-end">
          <Button
            actionId="agent.create.cancel"
            emphasis="quiet"
            label={t('agent.common.cancel')}
            onActivate={onClose}
          />
          <Button
            actionId="agent.create.confirm"
            emphasis="primary"
            label={t('agent.roster.create.confirm')}
            data-pt-create-agent-confirm
            availability={canCreate
              ? undefined
              : { kind: 'disabled', reason: t('agent.roster.create.nameRequired') }}
            onActivate={submit}
          />
        </Flex>
      )}
    >
      <Flex direction="column" gap={12} className="pa-create-agent">
        <TextField
          value={name}
          clearable
          autoFocus
          aria-label={t('agent.roster.create.name')}
          placeholder={t('agent.roster.create.namePlaceholder')}
          data-pt-create-agent-name
          onClear={() => setName('')}
          onValueChange={setName}
          onEnter={submit}
        />
        <TextArea
          value={description}
          minimumRows={3}
          maximumRows={6}
          aria-label={t('agent.roster.create.description')}
          placeholder={t('agent.roster.create.description')}
          data-pt-create-agent-desc
          onValueChange={setDescription}
        />
        <Select
          label={t('agent.roster.create.model')}
          value={modelId}
          onValueChange={value => setModelId(String(value))}
          options={MODEL_OPTIONS}
        />
      </Flex>
    </Dialog>
  );
}

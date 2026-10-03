import { Form, Input, Select, Switch, theme } from 'antd';
import { useTranslation } from 'react-i18next';

import type { Agent } from '../../../services/desktop_api';
import {
  AGENT_AVATAR_OPTIONS,
  AGENT_NAME_PATTERN,
} from './agentCreateModel';

interface AgentCreateIdentityFieldsProps {
  agents: Agent[];
  disabled: boolean;
}

export function AgentCreateIdentityFields({
  agents,
  disabled,
}: AgentCreateIdentityFieldsProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  return (
    <>
      <div
        style={{
          display: 'grid',
          gap: `0 ${token.marginMD}px`,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <Form.Item
          label={t('agent.drawer.nameSlug')}
          name="name"
          extra={t('agent.drawer.nameExtra')}
          rules={[
            {
              required: true,
              whitespace: true,
              message: t('agent.drawer.nameRequired'),
            },
            {
              pattern: AGENT_NAME_PATTERN,
              message: t('agent.drawer.namePattern'),
            },
            {
              validator: (_, value?: string) => {
                const name = value?.trim();
                if (
                  !name
                  || !AGENT_NAME_PATTERN.test(name)
                  || !agents.some((agent) => agent.name === name)
                ) {
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(t('agent.errors.nameConflict')),
                );
              },
            },
          ]}
        >
          <Input
            autoComplete="off"
            autoFocus
            data-pt-agent-create-name
            disabled={disabled}
            placeholder={t('agent.drawer.namePlaceholder')}
          />
        </Form.Item>

        <Form.Item
          label={t('agent.drawer.displayName')}
          name="title"
        >
          <Input
            data-pt-agent-create-title
            disabled={disabled}
            placeholder={t('agent.drawer.displayNamePlaceholder')}
          />
        </Form.Item>
      </div>

      <Form.Item
        label={t('agent.drawer.description')}
        name="description"
      >
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 4 }}
          data-pt-agent-create-description
          disabled={disabled}
          placeholder={t('agent.drawer.descriptionPlaceholder')}
        />
      </Form.Item>

      <Form.Item
        extra={t('agent.drawer.systemPromptExtra')}
        label={t('agent.drawer.systemPrompt')}
        name="systemPrompt"
      >
        <Input.TextArea
          autoSize={{ minRows: 4, maxRows: 8 }}
          data-pt-agent-create-system-prompt
          disabled={disabled}
          placeholder={t('agent.drawer.systemPromptPlaceholder')}
        />
      </Form.Item>

      <div
        style={{
          display: 'grid',
          gap: `0 ${token.marginMD}px`,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <Form.Item label={t('agent.drawer.avatar')} name="avatar">
          <Select
            disabled={disabled}
            options={AGENT_AVATAR_OPTIONS}
          />
        </Form.Item>

        <Form.Item
          extra={t('agent.drawer.pinToSidebarDesc')}
          label={t('agent.drawer.pinToSidebar')}
          name="pinned"
          valuePropName="checked"
        >
          <Switch disabled={disabled} />
        </Form.Item>
      </div>

      <Form.Item
        label={t('agent.drawer.welcomeMessage')}
        name="openingMessage"
      >
        <Input
          disabled={disabled}
          placeholder={t('agent.drawer.welcomeMessagePlaceholder')}
        />
      </Form.Item>

      <Form.Item
        extra={t('agent.drawer.suggestedQuestionsExtra')}
        label={t('agent.drawer.suggestedQuestions')}
        name="openingQuestions"
        style={{ marginBottom: 0 }}
      >
        <Input.TextArea
          autoSize={{ minRows: 2, maxRows: 5 }}
          disabled={disabled}
          placeholder={t('agent.drawer.suggestedQuestionsPlaceholder')}
        />
      </Form.Item>
    </>
  );
}

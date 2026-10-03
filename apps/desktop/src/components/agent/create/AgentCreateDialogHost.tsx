import {
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { toast } from '@lobehub/ui';
import { Alert, Form, Modal, theme } from 'antd';
import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useAgentStore } from '../../../store/agent';
import { AgentCreateIdentityFields } from './AgentCreateIdentityFields';
import { AgentCreateRuntimeFields } from './AgentCreateRuntimeFields';
import {
  buildAgentCreateInput,
  DEFAULT_AGENT_CREATE_VALUES,
  type AgentCreateFormValues,
} from './agentCreateModel';
import {
  closeAgentCreateFlow,
  getAgentCreateRequest,
  subscribeAgentCreateFlow,
  type AgentCreateRequest,
} from './agentCreateFlow';

export function AgentCreateDialogHost() {
  const request = useSyncExternalStore(
    subscribeAgentCreateFlow,
    getAgentCreateRequest,
    getAgentCreateRequest,
  );
  if (!request) return null;
  return <AgentCreateDialog key={request.id} request={request} />;
}

function AgentCreateDialog({ request }: { request: AgentCreateRequest }) {
  const { t } = useTranslation(['agent', 'common']);
  const { token } = theme.useToken();
  const agents = useAgentStore((state) => state.agents);
  const availableModels = useAgentStore((state) => state.availableModels);
  const createAgent = useAgentStore((state) => state.createAgent);
  const [form] = Form.useForm<AgentCreateFormValues>();
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const handleCancel = () => {
    if (submittingRef.current) return;
    closeAgentCreateFlow(request.id);
  };

  const handleSubmit = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;

    let values: AgentCreateFormValues;
    try {
      values = await form.validateFields();
    } catch {
      submittingRef.current = false;
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    try {
      const created = await createAgent(
        buildAgentCreateInput(values, availableModels),
      );
      closeAgentCreateFlow(request.id);
      toast.success(t('agent.drawer.toast.created'));
      request.openProfile(created.name);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : t('agent.profile.failedToSave'),
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal
      cancelButtonProps={{
        'data-pt-agent-create-cancel': 'true',
        disabled: submitting,
      }}
      cancelText={t('common.action.cancel', { ns: 'common' })}
      centered
      closable={!submitting}
      confirmLoading={submitting}
      destroyOnHidden
      keyboard={!submitting}
      maskClosable={!submitting}
      okButtonProps={{ 'data-pt-agent-create-submit': 'true' }}
      okText={t('agent.drawer.create')}
      open
      title={t('agent.drawer.titleCreate')}
      width={720}
      onCancel={handleCancel}
      onOk={() => void handleSubmit()}
      styles={{
        body: {
          maxHeight: 'min(680px, 72vh)',
          overflowY: 'auto',
          paddingTop: token.paddingSM,
        },
      }}
    >
      <Flexbox data-pt-agent-create-dialog gap={16}>
        <Flexbox
          horizontal
          align="center"
          gap={12}
          style={{
            padding: 14,
            borderRadius: token.borderRadiusLG,
            background: token.colorFillQuaternary,
          }}
        >
          <Flexbox
            align="center"
            justify="center"
            style={{
              width: 40,
              height: 40,
              borderRadius: token.borderRadiusLG,
              background: token.colorPrimaryBg,
              color: token.colorPrimary,
              flexShrink: 0,
            }}
          >
            <Bot size={20} />
          </Flexbox>
          <Flexbox gap={2}>
            <span
              style={{
                color: token.colorText,
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {t('agent.drawer.previewTitle')}
            </span>
            <span
              style={{
                color: token.colorTextSecondary,
                fontSize: 12,
              }}
            >
              {t('agent.drawer.previewDescription')}
            </span>
          </Flexbox>
        </Flexbox>

        {submitError ? (
          <Alert
            closable
            data-pt-agent-lifecycle-error
            message={submitError}
            showIcon
            type="error"
            onClose={() => setSubmitError('')}
          />
        ) : null}

        <Form
          form={form}
          initialValues={DEFAULT_AGENT_CREATE_VALUES}
          layout="vertical"
          requiredMark={false}
        >
          <AgentCreateIdentityFields
            agents={agents}
            disabled={submitting}
          />
          <AgentCreateRuntimeFields
            availableModels={availableModels}
            disabled={submitting}
            form={form}
          />
        </Form>

        <span
          style={{
            color: token.colorTextTertiary,
            fontSize: 12,
          }}
        >
          {t('agent.drawer.workbenchFooter')}
        </span>
      </Flexbox>
    </Modal>
  );
}

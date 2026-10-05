import { Alert, Button, Modal, Typography, theme } from 'antd';
import { CircleX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import {
  AgentGoalStatus,
  type AgentGoal,
} from '../../gen/proto/domain/agent/goal_pb';
import { refreshHomeProjection } from '../../runtimes/homeRuntime';
import { cancelActiveGoal } from '../../services/goal-service';
import { useGoalDraftStore } from '../../store/goalDraft';
import { useHomeStore } from '../../store/home';

const { useToken } = theme;

const cancellableStatuses = new Set<AgentGoalStatus>([
  AgentGoalStatus.RUNNING,
  AgentGoalStatus.NEEDS_USER,
  AgentGoalStatus.REPLANNING,
  AgentGoalStatus.RECOVERING,
]);

function activeCancellationKey(): string {
  const id = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `home-goal-active-cancel-${id}`;
}

export function GoalActiveCancelControl({ goal }: { goal: AgentGoal }) {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const [open, setOpen] = useState(false);
  const mutationState = useGoalDraftStore((state) => state.mutationState);
  const mutationError = useGoalDraftStore((state) => state.mutationError);
  const connectionState = useHomeStore((state) => state.connectionState);
  const cancelling = mutationState === 'cancelling';
  const failed = mutationState === 'cancel-failed';
  const cancelled = goal.status === AgentGoalStatus.CANCELLED;
  const cancellable = cancellableStatuses.has(goal.status);

  if (cancelled) {
    return (
      <Alert
        data-pt-home-goal-active-cancellation-state="CANCELLED"
        message={t('agent.home.goalActiveCancelled', { title: goal.title })}
        showIcon
        type="info"
      />
    );
  }
  if (!cancellable) return null;

  const confirmCancellation = async () => {
    const draft = useGoalDraftStore.getState();
    const idempotencyKey =
      draft.cancelIdempotencyKey || activeCancellationKey();
    draft.beginMutation('cancel', idempotencyKey);
    try {
      const readback = await cancelActiveGoal(goal, idempotencyKey);
      useHomeStore.getState().applyGoalDraft(readback, 'readback');
      useGoalDraftStore.getState().applyMutation(readback);
      setOpen(false);
      void refreshHomeProjection('goal-active-cancelled').catch(
        () => undefined,
      );
    } catch (error) {
      useGoalDraftStore.getState().markCancelFailure(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  return (
    <Flexbox
      data-pt-home-goal-active-cancellation-state={
        cancelling ? 'CANCELLING' : failed ? 'FAILED' : 'READY'
      }
      gap={token.marginSM}
    >
      <Button
        aria-label={t('agent.home.goalActiveCancelAccessible', {
          title: goal.title,
        })}
        danger
        data-pt-home-goal-active-cancel=""
        disabled={connectionState !== 'fresh'}
        icon={<CircleX size={15} />}
        loading={cancelling}
        onClick={() => setOpen(true)}
        size="small"
      >
        {cancelling
          ? t('agent.home.goalActiveCancelling')
          : t('agent.home.goalCancel')}
      </Button>
      <Modal
        centered
        cancelButtonProps={{
          'data-pt-home-goal-active-cancel-dismiss': goal.goalId,
        }}
        cancelText={t('agent.home.goalCancelKeep')}
        closable={!cancelling}
        confirmLoading={cancelling}
        keyboard={!cancelling}
        maskClosable={!cancelling}
        okButtonProps={{
          danger: true,
          disabled: connectionState !== 'fresh',
          'data-pt-home-goal-active-cancel-confirm': goal.goalId,
        }}
        okText={t('agent.home.goalCancelConfirm')}
        onCancel={() => {
          if (!cancelling) setOpen(false);
        }}
        onOk={confirmCancellation}
        open={open}
        title={t('agent.home.goalActiveCancelConfirmTitle', {
          title: goal.title,
        })}
      >
        <Flexbox gap={token.marginSM}>
          <Typography.Paragraph style={{ margin: 0 }}>
            {t('agent.home.goalActiveCancelConfirmDescription')}
          </Typography.Paragraph>
          {cancelling ? (
            <Alert
              data-pt-home-goal-active-cancelling=""
              message={t('agent.home.goalActiveCancelling')}
              showIcon
              type="warning"
            />
          ) : null}
          {failed ? (
            <Alert
              data-pt-home-goal-active-cancel-error=""
              description={mutationError || undefined}
              message={t('agent.home.goalActiveCancelFailed', {
                title: goal.title,
              })}
              showIcon
              type="error"
            />
          ) : null}
        </Flexbox>
      </Modal>
    </Flexbox>
  );
}

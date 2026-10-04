import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Typography, theme } from 'antd';
import { CircleX, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import {
  AgentGoalStatus,
  type AgentGoal,
} from '../../gen/proto/domain/agent/goal_pb';
import {
  cancelHomeGoal,
  reloadHomeGoalContract,
} from '../../runtimes/homeRuntime';
import { useGoalDraftStore } from '../../store/goalDraft';

const { useToken } = theme;

export function GoalCancelControl({ goal }: { goal: AgentGoal }) {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const [open, setOpen] = useState(false);
  const cancelledRef = useRef<HTMLDivElement>(null);
  const mutationState = useGoalDraftStore((state) => state.mutationState);
  const conflictRevision = useGoalDraftStore(
    (state) => state.conflictRevision,
  );
  const cancelling = mutationState === 'cancelling';
  const cancelFailed = mutationState === 'cancel-failed';
  const conflict = mutationState === 'conflict';
  const forbidden = mutationState === 'forbidden';
  const mutationBlocked = conflict || forbidden;
  const cancelled = goal.status === AgentGoalStatus.CANCELLED;
  const cancellable =
    goal.status === AgentGoalStatus.DRAFT
    || goal.status === AgentGoalStatus.REVIEWING
    || goal.status === AgentGoalStatus.READY;

  useEffect(() => {
    if (cancelled) {
      cancelledRef.current?.focus();
    }
  }, [cancelled]);

  if (cancelled) {
    return (
      <div
        data-pt-home-goal-cancelled=""
        ref={cancelledRef}
        tabIndex={-1}
      >
        <Alert
          message={t('agent.home.goalCancelled', { title: goal.title })}
          showIcon
          type="info"
        />
      </div>
    );
  }
  if (!cancellable) return null;

  const confirmCancellation = async () => {
    try {
      await cancelHomeGoal();
      setOpen(false);
    } catch {
      // The store keeps the prior Goal and retry key; the dialog stays open.
    }
  };

  return (
    <Flexbox
      align="flex-end"
      gap={token.marginSM}
      style={{ marginTop: token.marginMD }}
    >
      <Button
        aria-label={t('agent.home.goalCancelAccessible', {
          title: goal.title,
        })}
        danger
        data-pt-home-goal-cancel=""
        disabled={mutationBlocked}
        icon={<CircleX size={15} />}
        loading={cancelling}
        onClick={() => setOpen(true)}
      >
        {t('agent.home.goalCancel')}
      </Button>
      <Modal
        centered
        cancelButtonProps={{
          'data-pt-home-goal-cancel-dismiss': goal.goalId,
        }}
        cancelText={t('agent.home.goalCancelKeep')}
        closable={!cancelling}
        confirmLoading={cancelling}
        focusTriggerAfterClose
        keyboard={!cancelling}
        maskClosable={!cancelling}
        okButtonProps={{
          danger: true,
          disabled: mutationBlocked,
          'data-pt-home-goal-cancel-confirm': goal.goalId,
        }}
        okText={t('agent.home.goalCancelConfirm')}
        onCancel={() => {
          if (!cancelling) setOpen(false);
        }}
        onOk={confirmCancellation}
        open={open}
        title={t('agent.home.goalCancelConfirmTitle', {
          title: goal.title,
        })}
      >
        <Flexbox gap={token.marginSM}>
          <Typography.Paragraph style={{ margin: 0 }}>
            {t('agent.home.goalCancelConfirmDescription')}
          </Typography.Paragraph>
          {cancelFailed || conflict || forbidden ? (
            <Alert
              action={conflict ? (
                <Button
                  aria-label={t('agent.home.goalReloadLatest')}
                  data-pt-home-goal-cancel-reload=""
                  icon={<RefreshCw size={14} />}
                  onClick={() => {
                    void reloadHomeGoalContract()
                      .then(() => setOpen(false))
                      .catch(() => undefined);
                  }}
                  size="small"
                />
              ) : undefined}
              data-pt-home-goal-cancel-error=""
              description={conflict
                ? t('agent.home.goalConflictDescription', {
                  revision: conflictRevision?.toString() ?? '',
                })
                : undefined}
              message={forbidden
                ? t('agent.home.goalForbidden')
                : conflict
                  ? t('agent.home.goalConflict')
                  : t('agent.home.goalCancelFailed', {
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

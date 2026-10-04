import { Alert, Button, Tag, Typography, theme } from 'antd';
import { CheckCircle2, Play, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import {
  AgentGoalStatus,
  type AgentGoal,
} from '../../gen/proto/domain/agent/goal_pb';
import {
  reloadHomeGoalContract,
  startHomeGoal,
} from '../../runtimes/homeRuntime';
import { useGoalDraftStore } from '../../store/goalDraft';
import { useHomeStore } from '../../store/home';
import { goalAdmissionReasonKeys } from './goalAdmissionPresentation';

const { useToken } = theme;

export function GoalReviewPanel({ goal }: { goal: AgentGoal }) {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const mutationState = useGoalDraftStore((state) => state.mutationState);
  const mutationError = useGoalDraftStore((state) => state.mutationError);
  const admissionReasonCode = useGoalDraftStore(
    (state) => state.admissionReasonCode,
  );
  const conflictRevision = useGoalDraftStore(
    (state) => state.conflictRevision,
  );
  const reloadLoading = useGoalDraftStore((state) => state.reloadLoading);
  const connectionState = useHomeStore((state) => state.connectionState);
  const admitting = mutationState === 'admitting';
  const starting = mutationState === 'starting';
  const cancelling = mutationState === 'cancelling';
  const running = goal.status === AgentGoalStatus.RUNNING;
  const ready = goal.status === AgentGoalStatus.READY;
  const reviewing = goal.status === AgentGoalStatus.REVIEWING;
  const cancelled = goal.status === AgentGoalStatus.CANCELLED;
  const canStart = reviewing || ready;
  const startBlocked =
    admitting
    || starting
    || cancelling
    || connectionState !== 'fresh'
    || mutationState === 'conflict'
    || mutationState === 'forbidden';

  return (
    <Flexbox
      data-pt-home-goal-review-panel=""
      data-pt-home-goal-id={goal.goalId}
      data-pt-home-goal-mutation-state={mutationState}
      data-pt-home-goal-revision={goal.revision.toString()}
      data-pt-home-goal-status={AgentGoalStatus[goal.status]}
      gap={token.marginMD}
    >
      <Flexbox horizontal align="center" gap={token.marginSM} wrap="wrap">
        <Tag
          color={
            running ? 'success' : ready ? 'cyan' : cancelled ? 'default' : 'processing'
          }
        >
          {running
            ? t('agent.home.goalStatusRunning')
            : ready
              ? t('agent.home.goalStatusReady')
              : cancelled
                ? t('agent.home.goalStatusCancelled')
                : t('agent.home.goalStatusReviewing')}
        </Tag>
        <Typography.Text data-pt-home-goal-title-readback="" strong>
          {goal.title}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('agent.home.goalSavedIdentity', {
            id: goal.goalId,
            revision: goal.revision.toString(),
          })}
        </Typography.Text>
      </Flexbox>

      {mutationState === 'admission-rejected' ? (
        <Alert
          data-pt-home-goal-admission-error={admissionReasonCode}
          description={t(
            goalAdmissionReasonKeys[admissionReasonCode]
              ?? 'agent.home.goalAdmissionRejectedDescription',
          )}
          message={mutationError ? t(mutationError) : t('agent.home.goalAdmissionRejected')}
          showIcon
          type="error"
        />
      ) : null}
      {mutationState === 'conflict' ? (
        <Alert
          action={(
            <Button
              aria-label={t('agent.home.goalReloadLatest')}
              data-pt-home-goal-conflict-reload=""
              icon={<RefreshCw size={14} />}
              loading={reloadLoading}
              onClick={() => void reloadHomeGoalContract().catch(() => undefined)}
              size="small"
            />
          )}
          data-pt-home-goal-conflict=""
          description={t('agent.home.goalConflictDescription', {
            revision: conflictRevision?.toString() ?? '',
          })}
          message={t('agent.home.goalConflict')}
          showIcon
          type="warning"
        />
      ) : null}
      {mutationState === 'forbidden' ? (
        <Alert
          data-pt-home-goal-forbidden=""
          description={mutationError ? t(mutationError) : undefined}
          message={t('agent.home.goalForbidden')}
          showIcon
          type="error"
        />
      ) : null}
      {mutationState === 'failed' ? (
        <Alert
          data-pt-home-goal-start-error=""
          message={t('agent.home.goalStartFailed')}
          showIcon
          type="error"
        />
      ) : null}
      {running ? (
        <Alert
          data-pt-home-goal-running=""
          message={t('agent.home.goalRunningRevision', {
            revision: goal.revision.toString(),
          })}
          showIcon
          type="success"
        />
      ) : cancelled ? null : (
        <Alert
          data-pt-home-goal-review-ready=""
          message={t('agent.home.goalReviewRevision', {
            revision: goal.revision.toString(),
          })}
          showIcon
          type={ready ? 'success' : 'info'}
        />
      )}

      <ReviewSection
        label={t('agent.home.goalOutcome')}
        selector="outcome"
        value={goal.outcome}
      />
      <div
        style={{
          display: 'grid',
          gap: token.marginMD,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
        }}
      >
        <ReviewList
          empty={t('agent.home.goalNone')}
          items={goal.nonGoals}
          label={t('agent.home.goalNonGoals')}
          selector="non-goals"
        />
        <ReviewList
          empty={t('agent.home.goalNone')}
          items={goal.constraints}
          label={t('agent.home.goalConstraints')}
          selector="constraints"
        />
      </div>

      <ReviewSection
        label={t('agent.home.goalBudget')}
        selector="budget"
        value={t('agent.home.goalBudgetSummary', {
          tokens: goal.budget?.maxTokens.toString() ?? '0',
          cost: goal.budget?.maxCost ?? t('agent.home.goalNone'),
          minutes: ((goal.budget?.wallTimeMs ?? 0n) / 60_000n).toString(),
          parallel: goal.budget?.maxParallelTasks ?? 0,
        })}
      />
      <Flexbox data-pt-home-goal-assumption="acceptance" gap={token.marginXS}>
        <Typography.Text strong>
          {t('agent.home.goalAcceptanceCriteria')}
        </Typography.Text>
        {goal.acceptanceCriteria.length === 0 ? (
          <Typography.Text type="secondary">
            {t('agent.home.goalNone')}
          </Typography.Text>
        ) : (
          goal.acceptanceCriteria.map((criterion) => (
            <Flexbox
              horizontal
              align="flex-start"
              gap={token.marginXS}
              key={criterion.criterionId}
            >
              <CheckCircle2
                aria-hidden
                color={token.colorSuccess}
                size={15}
                style={{ flex: '0 0 auto', marginTop: 3 }}
              />
              <Typography.Text>
                {criterion.description}
                {' '}
                <Typography.Text type="secondary">
                  ({criterion.evaluator}
                  {criterion.required
                    ? `, ${t('agent.home.goalCriterionRequired')}`
                    : ''})
                </Typography.Text>
              </Typography.Text>
            </Flexbox>
          ))
        )}
      </Flexbox>

      {canStart ? (
        <Flexbox horizontal justify="flex-end">
          <Button
            data-pt-home-goal-start=""
            disabled={startBlocked}
            icon={<Play size={15} />}
            loading={admitting || starting}
            onClick={() => void startHomeGoal().catch(() => undefined)}
            type="primary"
          >
            {ready
              ? t('agent.home.goalRetryStart')
              : t('agent.home.goalStart')}
          </Button>
        </Flexbox>
      ) : null}
    </Flexbox>
  );
}

function ReviewSection({
  label,
  selector,
  value,
}: {
  label: string;
  selector: string;
  value: string;
}) {
  return (
    <Flexbox data-pt-home-goal-assumption={selector} gap={4}>
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Paragraph style={{ margin: 0 }}>
        {value}
      </Typography.Paragraph>
    </Flexbox>
  );
}

function ReviewList({
  empty,
  items,
  label,
  selector,
}: {
  empty: string;
  items: string[];
  label: string;
  selector: string;
}) {
  return (
    <Flexbox data-pt-home-goal-assumption={selector} gap={4}>
      <Typography.Text strong>{label}</Typography.Text>
      <Typography.Text type={items.length === 0 ? 'secondary' : undefined}>
        {items.length > 0 ? items.join(' · ') : empty}
      </Typography.Text>
    </Flexbox>
  );
}

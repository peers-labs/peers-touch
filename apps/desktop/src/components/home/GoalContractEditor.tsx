import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Input,
  InputNumber,
  Select,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  ClipboardCheck,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import {
  AgentGoalStatus,
  type AgentGoal,
} from '../../gen/proto/domain/agent/goal_pb';
import {
  reloadHomeGoalContract,
  reviewHomeGoalContract,
  updateHomeGoalContract,
} from '../../runtimes/homeRuntime';
import { useGoalDraftStore } from '../../store/goalDraft';

const { useToken } = theme;

function lines(value: string): string[] {
  return value.split('\n');
}

function safeInteger(value: number | null): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

export function GoalContractEditor({ goal }: { goal: AgentGoal }) {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const outcome = useGoalDraftStore((state) => state.outcome);
  const nonGoals = useGoalDraftStore((state) => state.nonGoals);
  const constraints = useGoalDraftStore((state) => state.constraints);
  const budget = useGoalDraftStore((state) => state.budget);
  const criteria = useGoalDraftStore((state) => state.acceptanceCriteria);
  const dirty = useGoalDraftStore((state) => state.dirty);
  const mutationState = useGoalDraftStore((state) => state.mutationState);
  const mutationError = useGoalDraftStore((state) => state.mutationError);
  const conflictRevision = useGoalDraftStore((state) => state.conflictRevision);
  const reloadLoading = useGoalDraftStore((state) => state.reloadLoading);
  const setOutcome = useGoalDraftStore((state) => state.setOutcome);
  const setNonGoals = useGoalDraftStore((state) => state.setNonGoals);
  const setConstraints = useGoalDraftStore((state) => state.setConstraints);
  const setBudget = useGoalDraftStore((state) => state.setBudget);
  const addCriterion = useGoalDraftStore(
    (state) => state.addAcceptanceCriterion,
  );
  const updateCriterion = useGoalDraftStore(
    (state) => state.updateAcceptanceCriterion,
  );
  const removeCriterion = useGoalDraftStore(
    (state) => state.removeAcceptanceCriterion,
  );

  const reviewing = goal.status === AgentGoalStatus.REVIEWING;
  const saving = mutationState === 'saving';
  const conflict = mutationState === 'conflict';
  const forbidden = mutationState === 'forbidden';
  const invalid =
    !outcome.trim()
    || criteria.some(
      (criterion) =>
        !criterion.description.trim() || !criterion.evaluator.trim(),
    );
  const disabled = reviewing || saving || conflict || forbidden;

  return (
    <Flexbox
      data-pt-home-goal-contract=""
      data-pt-home-goal-id={goal.goalId}
      data-pt-home-goal-mutation-state={mutationState}
      data-pt-home-goal-owner={goal.ownerPtid}
      data-pt-home-goal-readback-revision={goal.revision.toString()}
      data-pt-home-goal-revision={goal.revision.toString()}
      data-pt-home-goal-review-revision={
        reviewing ? goal.revision.toString() : ''
      }
      data-pt-home-goal-status={AgentGoalStatus[goal.status]}
      gap={token.marginMD}
    >
      <Flexbox horizontal align="center" gap={token.marginSM} wrap="wrap">
        <Tag color={reviewing ? 'processing' : undefined}>
          {reviewing
            ? t('agent.home.goalStatusReviewing')
            : t('agent.home.goalStatusDraft')}
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

      {mutationState === 'conflict' ? (
        <Alert
          action={(
            <Button
              data-pt-home-goal-conflict-reload=""
              icon={<RefreshCw size={14} />}
              loading={reloadLoading}
              onClick={() => void reloadHomeGoalContract().catch(() => undefined)}
              size="small"
            >
              {t('agent.home.goalReloadLatest')}
            </Button>
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
      {forbidden ? (
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
          data-pt-home-goal-mutation-error=""
          message={t('agent.home.goalUpdateFailed')}
          showIcon
          type="error"
        />
      ) : null}
      {reviewing ? (
        <Alert
          data-pt-home-goal-review-ready=""
          message={t('agent.home.goalReviewRevision', {
            revision: goal.revision.toString(),
          })}
          showIcon
          type="info"
        />
      ) : null}

      <label htmlFor="home-goal-contract-outcome">
        <Typography.Text strong>{t('agent.home.goalOutcome')}</Typography.Text>
      </label>
      <Input.TextArea
        data-pt-home-goal-outcome-readback=""
        disabled={disabled}
        id="home-goal-contract-outcome"
        maxLength={16_384}
        onChange={(event) => setOutcome(event.target.value)}
        rows={4}
        value={outcome}
      />

      <div
        style={{
          display: 'grid',
          gap: token.marginMD,
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
        }}
      >
        <Flexbox gap={token.marginXS}>
          <label htmlFor="home-goal-non-goals">
            <Typography.Text strong>
              {t('agent.home.goalNonGoals')}
            </Typography.Text>
          </label>
          <Input.TextArea
            data-pt-home-goal-non-goals=""
            disabled={disabled}
            id="home-goal-non-goals"
            onChange={(event) => setNonGoals(lines(event.target.value))}
            rows={4}
            value={nonGoals.join('\n')}
          />
        </Flexbox>
        <Flexbox gap={token.marginXS}>
          <label htmlFor="home-goal-constraints">
            <Typography.Text strong>
              {t('agent.home.goalConstraints')}
            </Typography.Text>
          </label>
          <Input.TextArea
            data-pt-home-goal-constraints=""
            disabled={disabled}
            id="home-goal-constraints"
            onChange={(event) => setConstraints(lines(event.target.value))}
            rows={4}
            value={constraints.join('\n')}
          />
        </Flexbox>
      </div>

      <Divider style={{ margin: 0 }}>
        {t('agent.home.goalBudget')}
      </Divider>
      <div
        style={{
          display: 'grid',
          gap: token.marginSM,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}
      >
        <BudgetField
          disabled={disabled}
          label={t('agent.home.goalMaxTokens')}
          selector="data-pt-home-goal-max-tokens"
          value={Number(budget.maxTokens)}
          onChange={(value) => setBudget({
            maxTokens: BigInt(safeInteger(value)),
          })}
        />
        <BudgetField
          disabled={disabled}
          label={t('agent.home.goalMaxCost')}
          precision={2}
          selector="data-pt-home-goal-max-cost"
          value={budget.maxCost}
          onChange={(value) => setBudget({
            maxCost: value === null ? undefined : Math.max(0, Number(value)),
          })}
        />
        <BudgetField
          disabled={disabled}
          label={t('agent.home.goalWallTimeMinutes')}
          selector="data-pt-home-goal-wall-time"
          value={Number(budget.wallTimeMs / 60_000n)}
          onChange={(value) => setBudget({
            wallTimeMs: BigInt(safeInteger(value)) * 60_000n,
          })}
        />
        <BudgetField
          disabled={disabled}
          label={t('agent.home.goalMaxParallelTasks')}
          max={64}
          selector="data-pt-home-goal-max-parallel"
          value={budget.maxParallelTasks}
          onChange={(value) => setBudget({
            maxParallelTasks: safeInteger(value),
          })}
        />
      </div>

      <Divider style={{ margin: 0 }}>
        {t('agent.home.goalAcceptanceCriteria')}
      </Divider>
      <Flexbox gap={token.marginSM}>
        {criteria.map((criterion, index) => (
          <div
            data-pt-home-goal-criterion={criterion.criterionId}
            key={criterion.criterionId}
            style={{
              alignItems: 'center',
              display: 'grid',
              gap: token.marginSM,
              gridTemplateColumns: 'minmax(180px, 1fr) 150px auto auto',
            }}
          >
            <Input
              aria-label={t('agent.home.goalCriterion', { index: index + 1 })}
              data-pt-home-goal-criterion-description=""
              disabled={disabled}
              onChange={(event) => updateCriterion(
                criterion.criterionId,
                { description: event.target.value },
              )}
              value={criterion.description}
            />
            <Select
              aria-label={t('agent.home.goalEvaluator')}
              disabled={disabled}
              options={[
                {
                  label: t('agent.home.goalEvaluatorDeterministic'),
                  value: 'deterministic',
                },
                {
                  label: t('agent.home.goalEvaluatorHuman'),
                  value: 'human',
                },
              ]}
              onChange={(evaluator) => updateCriterion(
                criterion.criterionId,
                { evaluator },
              )}
              value={criterion.evaluator}
            />
            <Checkbox
              checked={criterion.required}
              disabled={disabled}
              onChange={(event) => updateCriterion(
                criterion.criterionId,
                { required: event.target.checked },
              )}
            >
              {t('agent.home.goalCriterionRequired')}
            </Checkbox>
            <Tooltip title={t('agent.home.goalCriterionRemove')}>
              <Button
                aria-label={t('agent.home.goalCriterionRemove')}
                disabled={disabled}
                icon={<Trash2 size={14} />}
                onClick={() => removeCriterion(criterion.criterionId)}
                size="small"
                type="text"
              />
            </Tooltip>
          </div>
        ))}
        {!reviewing ? (
          <Button
            data-pt-home-goal-criterion-add=""
            disabled={disabled}
            icon={<Plus size={14} />}
            onClick={addCriterion}
            size="small"
          >
            {t('agent.home.goalCriterionAdd')}
          </Button>
        ) : null}
      </Flexbox>

      <Flexbox horizontal align="center" justify="flex-end" gap={token.marginSM}>
        {!reviewing ? (
          <>
            <Button
              data-pt-home-goal-update=""
              disabled={!dirty || invalid || disabled}
              icon={<Save size={15} />}
              loading={saving}
              onClick={() => void updateHomeGoalContract().catch(() => undefined)}
            >
              {t('agent.home.goalSaveChanges')}
            </Button>
            <Button
              data-pt-home-goal-review=""
              disabled={invalid || disabled}
              icon={<ClipboardCheck size={15} />}
              loading={saving}
              onClick={() => void reviewHomeGoalContract().catch(() => undefined)}
              type="primary"
            >
              {t('agent.home.goalReview')}
            </Button>
          </>
        ) : null}
      </Flexbox>
    </Flexbox>
  );
}

function BudgetField({
  disabled,
  label,
  max,
  onChange,
  precision,
  selector,
  value,
}: {
  disabled: boolean;
  label: string;
  max?: number;
  onChange: (value: number | null) => void;
  precision?: number;
  selector: string;
  value?: number;
}) {
  return (
    <Flexbox gap={4}>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <InputNumber
        aria-label={label}
        {...{ [selector]: '' }}
        disabled={disabled}
        max={max ?? Number.MAX_SAFE_INTEGER}
        min={0}
        onChange={onChange}
        precision={precision ?? 0}
        style={{ width: '100%' }}
        value={value}
      />
    </Flexbox>
  );
}

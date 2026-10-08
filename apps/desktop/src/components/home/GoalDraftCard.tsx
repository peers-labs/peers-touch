import { Alert, Button, Card, Input, Typography, theme } from 'antd';
import { RefreshCw, Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { AgentGoalStatus } from '../../gen/proto/domain/agent/goal_pb';
import {
  createHomeGoalDraft,
  reopenHomeGoalDraft,
  validateHomeGoalDraftBytes,
} from '../../runtimes/homeRuntime';
import { useHomeStore } from '../../store/home';
import { GoalContractEditor } from './GoalContractEditor';
import { GoalCancelControl } from './GoalCancelControl';
import { GoalReviewPanel } from './GoalReviewPanel';

const { useToken } = theme;

export function GoalDraftCard() {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const title = useHomeStore((state) => state.goalDraftTitle);
  const outcome = useHomeStore((state) => state.goalDraftOutcome);
  const savedGoal = useHomeStore((state) => state.savedGoal);
  const creating = useHomeStore((state) => state.goalCreating);
  const readbackLoading = useHomeStore((state) => state.goalReadbackLoading);
  const readbackRevision = useHomeStore((state) => state.goalReadbackRevision);
  const createError = useHomeStore((state) => state.goalCreateError);
  const readbackError = useHomeStore((state) => state.goalReadbackError);
  const connectionState = useHomeStore((state) => state.connectionState);
  const setTitle = useHomeStore((state) => state.setGoalDraftTitle);
  const setOutcome = useHomeStore((state) => state.setGoalDraftOutcome);

  if (savedGoal) {
    return (
      <Card
        data-pt-home-goal=""
        data-pt-home-goal-id={savedGoal.goalId}
        data-pt-home-goal-owner={savedGoal.ownerPtid}
        data-pt-home-goal-readback={
          readbackLoading
            ? 'loading'
            : readbackError
              ? 'error'
              : readbackRevision === null
                ? 'pending'
                : 'ready'
        }
        data-pt-home-goal-readback-revision={readbackRevision?.toString() ?? ''}
        data-pt-home-goal-revision={savedGoal.revision.toString()}
        data-pt-home-goal-status={AgentGoalStatus[savedGoal.status]}
        extra={(
          <Button
            aria-label={t('agent.home.goalReload')}
            icon={<RefreshCw size={15} />}
            loading={readbackLoading}
            onClick={() => void reopenHomeGoalDraft().catch(() => undefined)}
            size="small"
            type="text"
          />
        )}
        size="small"
        title={t('agent.home.goalContract')}
      >
        {readbackError ? (
          <Alert
            message={t('agent.home.goalReadbackFailed')}
            showIcon
            style={{ marginBottom: token.marginSM }}
            type="warning"
          />
        ) : null}
        {savedGoal.status === AgentGoalStatus.DRAFT ? (
          <GoalContractEditor goal={savedGoal} />
        ) : (
          <GoalReviewPanel goal={savedGoal} />
        )}
        <GoalCancelControl goal={savedGoal} />
      </Card>
    );
  }

  const { titleTooLong, outcomeTooLong } = validateHomeGoalDraftBytes(
    title,
    outcome,
  );
  const submitDisabled =
    !title.trim()
    || !outcome.trim()
    || titleTooLong
    || outcomeTooLong
    || connectionState !== 'fresh'
    || creating;

  return (
    <Card
      data-pt-home-goal=""
      data-pt-home-goal-status="EMPTY"
      size="small"
      title={t('agent.home.goalCreateTitle')}
    >
      <Flexbox gap={token.marginSM}>
        <Typography.Text type="secondary">
          {t('agent.home.goalCreateDescription')}
        </Typography.Text>
        {createError ? (
          <Alert
            data-pt-home-goal-create-error=""
            message={t('agent.home.goalCreateFailed')}
            showIcon
            type="error"
          />
        ) : null}
        <label htmlFor="home-goal-title">
          <Typography.Text strong>{t('agent.home.goalTitle')}</Typography.Text>
        </label>
        <Input
          aria-label={t('agent.home.goalTitle')}
          aria-invalid={titleTooLong}
          data-pt-home-goal-title=""
          disabled={creating}
          id="home-goal-title"
          maxLength={256}
          placeholder={t('agent.home.goalTitlePlaceholder')}
          status={titleTooLong ? 'error' : undefined}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {titleTooLong ? (
          <Typography.Text data-pt-home-goal-title-limit="" type="danger">
            {t('agent.home.goalTitleTooLong')}
          </Typography.Text>
        ) : null}
        <label htmlFor="home-goal-outcome">
          <Typography.Text strong>{t('agent.home.goalOutcome')}</Typography.Text>
        </label>
        <Input.TextArea
          aria-label={t('agent.home.goalOutcome')}
          aria-invalid={outcomeTooLong}
          autoSize={{ minRows: 3, maxRows: 7 }}
          data-pt-home-goal-outcome=""
          disabled={creating}
          id="home-goal-outcome"
          maxLength={16_384}
          placeholder={t('agent.home.goalOutcomePlaceholder')}
          status={outcomeTooLong ? 'error' : undefined}
          style={{ resize: 'none' }}
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
        />
        {outcomeTooLong ? (
          <Typography.Text data-pt-home-goal-outcome-limit="" type="danger">
            {t('agent.home.goalOutcomeTooLong')}
          </Typography.Text>
        ) : null}
        <Flexbox horizontal align="center" justify="space-between" gap={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('agent.home.goalDraftHint')}
          </Typography.Text>
          <Button
            data-pt-home-goal-create=""
            disabled={submitDisabled}
            icon={<Save size={15} />}
            loading={creating}
            onClick={() => void createHomeGoalDraft().catch(() => undefined)}
            type="primary"
          >
            {t('agent.home.goalSave')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Card>
  );
}

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Empty,
  Input,
  Progress,
  Segmented,
  Select,
  Skeleton,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  ArrowUp,
  CheckCircle2,
  Clock,
  ListTodo,
  RefreshCw,
} from 'lucide-react';

import {
  HomeProjectionFreshness,
  HomeTaskStatus,
  HomeWorkKind,
} from '../gen/proto/domain/agent/home_pb';
import { usePageContext } from '../kernel/usePageContext';
import {
  openHomeConversation,
  openHomeTask,
  refreshHomeProjection,
  submitHomeChat,
  submitHomeTask,
} from '../runtimes/homeRuntime';
import { useHomeStore } from '../store/home';

const { useToken } = theme;

type HomeMode = 'chat' | 'task';

function nextHomeCommandKey(mode: HomeMode): string {
  const id = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `home-${mode}-${id}`;
}

export function HomePage() {
  const { t } = useTranslation('agent');
  const { token } = useToken();
  const { navigation } = usePageContext();
  const projection = useHomeStore((state) => state.projection);
  const loading = useHomeStore((state) => state.loading);
  const error = useHomeStore((state) => state.error);
  const [mode, setMode] = useState<HomeMode>('chat');
  const [draft, setDraft] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const commandKeyRef = useRef('');

  const pinnedAgents = useMemo(
    () => projection?.pinnedAgents ?? [],
    [projection?.pinnedAgents],
  );
  const recentWork = projection?.recentWork ?? [];
  const firstReadyAgent = useMemo(
    () => pinnedAgents.find((agent) => {
      const readiness = projection?.readiness.find(
        (item) => item.agentId === agent.agentId,
      );
      return Boolean(
        agent.readinessSnapshotId
        && readiness
        && !['blocked', 'unavailable', 'unknown'].includes(readiness.state),
      );
    }),
    [pinnedAgents, projection?.readiness],
  );
  const selectedAgent = useMemo(
    () => pinnedAgents.find((agent) => agent.agentId === selectedAgentId)
      ?? firstReadyAgent
      ?? pinnedAgents[0],
    [firstReadyAgent, pinnedAgents, selectedAgentId],
  );
  const selectedReadiness = projection?.readiness.find(
    (item) => item.agentId === selectedAgent?.agentId,
  );
  const degraded =
    projection?.freshness === HomeProjectionFreshness.PARTIAL
    || projection?.freshness === HomeProjectionFreshness.STALE;
  const readinessBlocksSubmit = !selectedReadiness
    || ['blocked', 'unavailable', 'unknown'].includes(selectedReadiness.state);
  const submissionBlocked =
    !projection
    || projection.freshness !== HomeProjectionFreshness.FRESH
    || !selectedAgent?.readinessSnapshotId
    || readinessBlocksSubmit;

  const resetCommandKey = (nextMode = mode) => {
    commandKeyRef.current = nextHomeCommandKey(nextMode);
  };

  const submit = async () => {
    const input = draft.trim();
    if (!selectedAgent || !input || submissionBlocked || submitting) return;
    if (!commandKeyRef.current) resetCommandKey();
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === 'chat') {
        const work = await submitHomeChat(
          selectedAgent,
          input,
          commandKeyRef.current,
        );
        setDraft('');
        resetCommandKey();
        const open = openHomeConversation(work);
        navigation.navigateTo('agent');
        await open;
      } else {
        const taskId = await submitHomeTask(
          selectedAgent,
          input,
          commandKeyRef.current,
        );
        setDraft('');
        resetCommandKey();
        openHomeTask(taskId);
        navigation.navigateTo('tasks');
      }
    } catch {
      setSubmitError(t('agent.home.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const retryAction = (
    <Button
      aria-label={t('agent.home.retry')}
      icon={<RefreshCw size={14} />}
      loading={loading}
      onClick={() => void refreshHomeProjection()}
      size="small"
      type="text"
    />
  );

  const openRecentWork = (work: (typeof recentWork)[number]) => {
    if (work.kind === HomeWorkKind.TASK) {
      openHomeTask(work.workId);
      navigation.navigateTo('tasks');
      return;
    }
    const open = openHomeConversation(work);
    navigation.navigateTo('agent');
    void open.catch(() => refreshHomeProjection('conversation-open-failed'));
  };

  return (
    <Flexbox
      gap={token.marginLG}
      padding={token.paddingLG}
      style={{ height: '100%', overflow: 'auto' }}
    >
      <Flexbox horizontal align="center" justify="space-between" gap={12}>
        <Flexbox gap={2}>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {t('agent.home.title')}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t('agent.home.subtitle')}
          </Typography.Text>
        </Flexbox>
        <Button
          aria-label={t('agent.home.retry')}
          icon={<RefreshCw size={15} />}
          loading={loading}
          onClick={() => void refreshHomeProjection()}
        />
      </Flexbox>

      {error ? (
        <Alert
          action={retryAction}
          description={projection ? t('agent.home.lastAcceptedPreserved') : undefined}
          message={t('agent.home.loadFailed')}
          showIcon
          type="error"
        />
      ) : null}
      {degraded ? (
        <Alert
          action={retryAction}
          description={t('agent.home.commitBlockedUntilFresh')}
          message={t('agent.home.partial')}
          showIcon
          type="warning"
        />
      ) : null}
      {submitError ? (
        <Alert
          closable
          message={submitError}
          onClose={() => setSubmitError(null)}
          showIcon
          type="error"
        />
      ) : null}

      {!projection && loading ? (
        <HomeLoading />
      ) : pinnedAgents.length === 0 ? (
        <Card size="small">
          <Empty description={t('agent.home.noPinnedAgents')}>
            <Button
              type="primary"
              onClick={() => navigation.navigateToSettings('agents')}
            >
              {t('agent.home.createAgent')}
            </Button>
          </Empty>
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: token.marginLG,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          }}
        >
          <Flexbox gap={token.marginMD} style={{ minWidth: 0 }}>
            <Card size="small">
              <Flexbox horizontal align="center" gap={10} wrap="wrap">
                <Avatar
                  shape="square"
                  size={40}
                  src={selectedAgent?.avatarRef || undefined}
                  style={{ backgroundColor: token.colorPrimary }}
                >
                  {selectedAgent?.displayName[0]}
                </Avatar>
                <Select
                  aria-label={t('agent.home.selectAgent')}
                  options={pinnedAgents.map((agent) => ({
                    label: `${agent.displayName} · ${agent.providerId || t('agent.home.unknownProvider')} / ${agent.modelId || t('agent.home.unknownModel')}`,
                    value: agent.agentId,
                  }))}
                  style={{ minWidth: 280, maxWidth: '100%' }}
                  value={selectedAgent?.agentId}
                  onChange={(value) => {
                    setSelectedAgentId(value);
                    resetCommandKey();
                  }}
                />
                <Flexbox flex={1} />
                <ReadinessTag state={selectedReadiness?.state} />
              </Flexbox>
              {projection?.capabilitySummaries.length ? (
                <Flexbox horizontal gap={6} wrap="wrap" style={{ marginTop: 12 }}>
                  {projection.capabilitySummaries.slice(0, 6).map((capability) => (
                    <Tag
                      color={capability.readinessState === 'ready' ? 'success' : 'warning'}
                      key={`${capability.capabilityId}:${capability.capabilityVersion}`}
                    >
                      {capability.displayName}
                    </Tag>
                  ))}
                </Flexbox>
              ) : null}
            </Card>

            <Card size="small">
              <Flexbox horizontal align="center" justify="space-between" gap={12}>
                <Typography.Text strong>{t('agent.home.startWork')}</Typography.Text>
                <Segmented
                  options={[
                    { label: t('agent.home.chatMode'), value: 'chat' },
                    { label: t('agent.home.taskMode'), value: 'task' },
                  ]}
                  size="small"
                  value={mode}
                  onChange={(value) => {
                    const nextMode = value as HomeMode;
                    setMode(nextMode);
                    resetCommandKey(nextMode);
                    setSubmitError(null);
                  }}
                />
              </Flexbox>
              <Input.TextArea
                aria-label={t('agent.home.workInput')}
                autoSize={{ minRows: 3, maxRows: 7 }}
                data-testid="home-work-composer"
                disabled={submitting}
                placeholder={
                  mode === 'chat'
                    ? t('agent.home.chatPlaceholder', {
                      agent: selectedAgent?.displayName,
                    })
                    : t('agent.home.taskPlaceholder')
                }
                style={{ marginTop: 12, resize: 'none' }}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  commandKeyRef.current = '';
                  setSubmitError(null);
                }}
                onPressEnter={(event) => {
                  if (event.shiftKey) return;
                  event.preventDefault();
                  void submit();
                }}
              />
              <Flexbox horizontal align="center" justify="space-between" gap={12} style={{ marginTop: 10 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {submissionBlocked
                    ? t('agent.home.waitForReadiness')
                    : mode === 'chat'
                      ? t('agent.home.chatCommitHint')
                      : t('agent.home.taskCommitHint')}
                </Typography.Text>
                <Button
                  aria-label={
                    mode === 'chat'
                      ? t('agent.home.sendChat')
                      : t('agent.home.createTask')
                  }
                  disabled={!draft.trim() || submissionBlocked}
                  data-testid="home-work-submit"
                  icon={<ArrowUp size={15} />}
                  loading={submitting}
                  onClick={() => void submit()}
                  type="primary"
                />
              </Flexbox>
            </Card>

            <Card size="small" title={t('agent.home.recentWork')}>
              {recentWork.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('agent.home.noRecentTopics')}
                />
              ) : (
                <Flexbox>
                  {recentWork.map((work) => (
                    <button
                      key={`${work.kind}:${work.workId}`}
                      onClick={() => openRecentWork(work)}
                      style={{
                        alignItems: 'center',
                        background: 'transparent',
                        border: 0,
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        color: token.colorText,
                        cursor: 'pointer',
                        display: 'grid',
                        gap: 10,
                        gridTemplateColumns: '20px minmax(0, 1fr) auto',
                        padding: '10px 0',
                        textAlign: 'left',
                        width: '100%',
                      }}
                      type="button"
                    >
                      {work.kind === HomeWorkKind.TASK
                        ? <ListTodo size={15} />
                        : <Clock size={15} />}
                      <span style={{ minWidth: 0 }}>
                        <Typography.Text ellipsis strong style={{ display: 'block' }}>
                          {work.title || t('agent.home.untitledTopic')}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {work.agentName}
                        </Typography.Text>
                      </span>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatRelativeTime(work.updatedAt)}
                      </Typography.Text>
                    </button>
                  ))}
                </Flexbox>
              )}
            </Card>
          </Flexbox>

          <Flexbox gap={token.marginMD} style={{ minWidth: 0 }}>
            <Card size="small" title={t('agent.home.needsYou')}>
              {projection?.needsUserItems.length ? (
                <Flexbox gap={10}>
                  {projection.needsUserItems.map((item) => (
                    <Button
                      key={item.itemId}
                      onClick={() => {
                        openHomeTask(item.actionRef);
                        navigation.navigateTo('tasks');
                      }}
                      style={{ height: 'auto', textAlign: 'left', whiteSpace: 'normal' }}
                    >
                      {item.title}
                    </Button>
                  ))}
                </Flexbox>
              ) : (
                <Typography.Text type="secondary">
                  {t('agent.home.noNeedsYou')}
                </Typography.Text>
              )}
            </Card>

            <Card size="small" title={t('agent.home.activeTasks')}>
              {projection?.activeTasks.length ? (
                <Flexbox gap={12}>
                  {projection.activeTasks.map((task) => (
                    <Flexbox key={task.taskId} gap={5}>
                      <Flexbox horizontal align="center" justify="space-between" gap={8}>
                        <Button
                          onClick={() => {
                            openHomeTask(task.taskId);
                            navigation.navigateTo('tasks');
                          }}
                          style={{ height: 'auto', padding: 0, textAlign: 'left' }}
                          type="link"
                        >
                          {task.title}
                        </Button>
                        <Tag>{homeTaskStatusLabel(task.status, t)}</Tag>
                      </Flexbox>
                      <Progress percent={task.progressPercent} size="small" />
                    </Flexbox>
                  ))}
                </Flexbox>
              ) : (
                <Typography.Text type="secondary">
                  {t('agent.home.noActiveTasks')}
                </Typography.Text>
              )}
            </Card>

            <Card size="small" title={t('agent.home.brief')}>
              {projection?.briefItems.length ? (
                <Flexbox gap={10}>
                  {projection.briefItems.slice(0, 4).map((item) => (
                    <Flexbox horizontal gap={8} key={item.briefId}>
                      <CheckCircle2 color={token.colorSuccess} size={15} />
                      <Flexbox style={{ minWidth: 0 }}>
                        <Typography.Text ellipsis strong>{item.title}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {item.summary}
                        </Typography.Text>
                      </Flexbox>
                    </Flexbox>
                  ))}
                </Flexbox>
              ) : (
                <Typography.Text type="secondary">
                  {t('agent.home.noBrief')}
                </Typography.Text>
              )}
            </Card>
          </Flexbox>
        </div>
      )}
    </Flexbox>
  );
}

function HomeLoading() {
  return (
    <Flexbox gap={16}>
      <Card size="small"><Skeleton active paragraph={{ rows: 2 }} /></Card>
      <Card size="small"><Skeleton active paragraph={{ rows: 4 }} /></Card>
    </Flexbox>
  );
}

function ReadinessTag({ state }: { state?: string }) {
  const { t } = useTranslation('agent');
  switch (state) {
    case 'ready':
      return <Tag color="success">{t('agent.home.ready')}</Tag>;
    case 'degraded':
      return <Tag color="warning">{t('agent.home.degraded')}</Tag>;
    case 'blocked':
      return <Tag color="error">{t('agent.home.blocked')}</Tag>;
    default:
      return <Tag>{t('agent.home.checking')}</Tag>;
  }
}

function homeTaskStatusLabel(
  status: HomeTaskStatus,
  t: (key: string) => string,
): string {
  switch (status) {
    case HomeTaskStatus.RUNNING:
      return t('agent.home.taskRunning');
    case HomeTaskStatus.NEEDS_USER:
      return t('agent.home.taskNeedsUser');
    default:
      return t('agent.home.taskPending');
  }
}

function formatRelativeTime(isoString: string): string {
  const timestamp = new Date(isoString).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const diffMin = Math.floor((Date.now() - timestamp) / 60_000);
  if (diffMin < 1) return '<1m';
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d`;
  return new Date(timestamp).toLocaleDateString();
}

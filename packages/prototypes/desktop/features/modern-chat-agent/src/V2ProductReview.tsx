import { ActionIcon } from '@lobehub/ui';
import {
  Alert,
  Button,
  ConfigProvider,
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
  FlaskConical,
  Moon,
  RefreshCw,
  Sun,
  Wrench,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Flexbox } from 'react-layout-kit';

type ReviewArea = 'home' | 'capability' | 'evaluation';
type HomeState = 'default' | 'loading' | 'empty' | 'error' | 'stale';
type HomeMode = 'chat' | 'task';
type ToolState =
  | 'checking'
  | 'binding'
  | 'bound'
  | 'ready'
  | 'approval'
  | 'running'
  | 'denied'
  | 'expired'
  | 'timed-out'
  | 'cancelled'
  | 'disconnected'
  | 'incompatible'
  | 'reconnecting'
  | 'failed'
  | 'succeeded';
type EvalState =
  | 'draft'
  | 'pending'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'retrying'
  | 'restoring';

const areaOptions = [
  { label: 'Home', value: 'home' },
  { label: 'Capabilities', value: 'capability' },
  { label: 'Evaluation', value: 'evaluation' },
];

const homeStateOptions: HomeState[] = ['default', 'loading', 'empty', 'error', 'stale'];
const toolStateOptions: ToolState[] = [
  'checking',
  'binding',
  'bound',
  'ready',
  'approval',
  'running',
  'denied',
  'expired',
  'timed-out',
  'cancelled',
  'disconnected',
  'incompatible',
  'reconnecting',
  'failed',
  'succeeded',
];
const evalStateOptions: EvalState[] = [
  'draft',
  'pending',
  'running',
  'cancelling',
  'cancelled',
  'completed',
  'partial',
  'failed',
  'retrying',
  'restoring',
];

function areaFromInitialState(initialState: string): ReviewArea {
  if (initialState.includes('capability')) return 'capability';
  if (initialState.includes('evaluation')) return 'evaluation';
  return 'home';
}

function homeStateFromInitialState(initialState: string): HomeState {
  const normalized = initialState.replace(/-dark$/, '');
  return homeStateOptions.find((state) => normalized.endsWith(state)) ?? 'default';
}

function toolStateFromInitialState(initialState: string): ToolState {
  const normalized = initialState.replace(/-dark$/, '');
  return toolStateOptions.find((state) => normalized.endsWith(state)) ?? 'ready';
}

function evalStateFromInitialState(initialState: string): EvalState {
  const normalized = initialState.replace(/-dark$/, '');
  return evalStateOptions.find((state) => normalized.endsWith(state)) ?? 'draft';
}

function useNarrowContainer(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 980);

  useEffect(() => {
    const update = () => setNarrow(window.innerWidth < 980);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return narrow;
}

export function V2ProductReview({ initialState }: { initialState: string }) {
  const [dark, setDark] = useState(initialState.includes('dark'));

  return (
    <ConfigProvider
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: { borderRadius: 8, colorPrimary: '#6b5bd6' },
      }}
    >
      <V2ProductReviewBody
        dark={dark}
        initialState={initialState}
        onToggleTheme={() => setDark((value) => !value)}
      />
    </ConfigProvider>
  );
}

function V2ProductReviewBody({
  dark,
  initialState,
  onToggleTheme,
}: {
  dark: boolean;
  initialState: string;
  onToggleTheme: () => void;
}) {
  const { token } = theme.useToken();
  const [area, setArea] = useState<ReviewArea>(() => areaFromInitialState(initialState));
  const narrow = useNarrowContainer();

  return (
    <Flexbox
      data-v2-product-review
      style={{
        background: token.colorBgLayout,
        color: token.colorText,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <Flexbox
        horizontal
        align="center"
        gap={12}
        style={{
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          minHeight: 58,
          padding: '0 18px',
        }}
      >
        <Flexbox flex={1} gap={2}>
          <Typography.Text strong style={{ fontSize: 15 }}>
            Modern Chat Agent
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            V2 product review · Station authoritative · prototype behavior only
          </Typography.Text>
        </Flexbox>
        <Tag color="purple">PRODUCT review</Tag>
        <ActionIcon
          aria-label={dark ? 'Use light theme' : 'Use dark theme'}
          icon={dark ? Sun : Moon}
          size={{ blockSize: 34, size: 15 }}
          style={{ borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}` }}
          title={dark ? 'Use light theme' : 'Use dark theme'}
          onClick={onToggleTheme}
        />
      </Flexbox>

      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        gap={12}
        style={{
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          padding: '10px 18px',
        }}
      >
        <Segmented
          options={areaOptions}
          value={area}
          onChange={(value) => setArea(value as ReviewArea)}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {area === 'home' && 'MCA-V2-H01 · P3 · V2-J01 · Phase 2'}
          {area === 'capability' &&
            'MCA-V2-T01 / MCA-V2-T02 / MCA-V2-T03 / MCA-V2-T04 / MCA-V2-M01 / MCA-V2-C01 / MCA-V2-O01'}
          {area === 'evaluation' && 'MCA-V2-E01 · E1 · V2-J06 · Phase 7'}
        </Typography.Text>
      </Flexbox>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: narrow ? 14 : 22 }}>
        {area === 'home' && <HomeReview initialState={homeStateFromInitialState(initialState)} narrow={narrow} />}
        {area === 'capability' && <CapabilityReview initialState={toolStateFromInitialState(initialState)} narrow={narrow} />}
        {area === 'evaluation' && <EvaluationReview initialState={evalStateFromInitialState(initialState)} narrow={narrow} />}
      </div>
    </Flexbox>
  );
}

function HomeReview({ initialState, narrow }: { initialState: HomeState; narrow: boolean }) {
  const { token } = theme.useToken();
  const [state, setState] = useState<HomeState>(initialState);
  const [mode, setMode] = useState<HomeMode>('chat');
  const [draft, setDraft] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('research');
  const [selectedModel, setSelectedModel] = useState('gpt-4.1');
  const submissionBlocked = state === 'error' || state === 'stale';

  const submit = () => {
    if (!draft.trim()) return;
    setSubmitted(mode === 'chat' ? 'Station accepted topic topic-1042' : 'Station created task TASK-208');
    setDraft('');
  };

  return (
    <Flexbox gap={18} style={{ margin: '0 auto', maxWidth: 1180 }}>
      <ReviewHeading
        description="Resume accepted work or start a Station-backed Chat or Task without reconstructing context."
        title="Home Command Center"
        trailing={
          <Segmented
            options={homeStateOptions}
            size="small"
            value={state}
            onChange={(value) => setState(value as HomeState)}
          />
        }
      />

      {state === 'loading' && (
        <div
          style={{
            display: 'grid',
            gap: 18,
            gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 320px',
          }}
        >
          <Flexbox gap={16}>
            <Surface>
              <Flexbox horizontal align="center" gap={10} wrap="wrap">
                <Skeleton.Avatar active shape="square" />
                <Select aria-label="Loading Home Agent" disabled options={[]} placeholder="Loading Agent…" style={{ minWidth: 160 }} />
                <Select aria-label="Loading Home model" disabled options={[]} placeholder="Loading model…" style={{ minWidth: 190 }} />
                <Flexbox flex={1} />
                <Tag>Checking</Tag>
              </Flexbox>
            </Surface>
            <Surface>
              <Flexbox horizontal align="center" justify="space-between" gap={12}>
                <Typography.Text strong>Start work</Typography.Text>
                <Segmented disabled options={['Chat', 'Task']} size="small" value="Chat" />
              </Flexbox>
              <Input.TextArea aria-label="Loading Home work input" disabled autoSize={{ minRows: 3, maxRows: 3 }} placeholder="Waiting for readiness…" style={{ marginTop: 12 }} />
              <Flexbox horizontal align="center" justify="space-between" style={{ marginTop: 10 }}>
                <Typography.Text type="secondary">Draft remains local while readiness loads</Typography.Text>
                <ActionIcon aria-label="Loading send" disabled icon={ArrowUp} size={{ blockSize: 34, size: 16 }} style={{ borderRadius: 10 }} title="Send unavailable" />
              </Flexbox>
            </Surface>
            <Surface><Skeleton active paragraph={{ rows: 4 }} /></Surface>
          </Flexbox>
          <Flexbox gap={16}>
            <Surface><Skeleton active paragraph={{ rows: 2 }} /></Surface>
            <Surface><Skeleton active paragraph={{ rows: 2 }} /></Surface>
          </Flexbox>
        </div>
      )}
      {state === 'empty' && (
        <Surface>
          <Empty description="No accepted topics or tasks yet">
            <Button type="primary" onClick={() => setState('default')}>
              Start first Chat
            </Button>
          </Empty>
        </Surface>
      )}
      {state === 'error' && (
        <Alert
          action={<Button onClick={() => setState('loading')}>Retry</Button>}
          description="The last accepted topics remain available. New work is blocked until readiness refresh succeeds."
          title="Station readiness could not be refreshed"
          showIcon
          type="error"
        />
      )}
      {state === 'stale' && (
        <Alert
          action={<Button icon={<RefreshCw size={14} />} onClick={() => setState('default')}>Reconcile</Button>}
          description="Showing the last Station snapshot. Chat and Task submission remain disabled until reconciliation."
          title="Home projection is stale"
          showIcon
          type="warning"
        />
      )}

      {(state === 'default' || state === 'error' || state === 'stale') && (
        <div
          style={{
            display: 'grid',
            gap: 18,
            gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 320px',
          }}
        >
          <Flexbox gap={16} style={{ minWidth: 0 }}>
            <Surface>
              <Flexbox horizontal align="center" gap={10} wrap="wrap">
                <SquareAgentTile label={selectedAgent === 'research' ? 'R' : selectedAgent === 'writing' ? 'W' : 'C'} />
                <Select
                  aria-label="Select Home Agent"
                  options={[
                    { label: 'Research Agent', value: 'research' },
                    { label: 'Writing Agent', value: 'writing' },
                    { label: 'Code Agent', value: 'code' },
                  ]}
                  style={{ minWidth: 160 }}
                  value={selectedAgent}
                  onChange={setSelectedAgent}
                />
                <Select
                  aria-label="Select Home model"
                  options={[
                    { label: 'OpenAI / gpt-4.1', value: 'gpt-4.1' },
                    { label: 'Anthropic / claude-sonnet', value: 'claude-sonnet' },
                  ]}
                  style={{ minWidth: 190 }}
                  value={selectedModel}
                  onChange={setSelectedModel}
                />
                <Flexbox flex={1} />
                <Tag color="success">Ready</Tag>
              </Flexbox>
              <Flexbox horizontal gap={6} wrap="wrap" style={{ marginTop: 12 }}>
                <Tag>3 Tools</Tag>
                <Tag color="success">GitHub connected</Tag>
                <Tag color="warning">Local MCP unavailable in Browser</Tag>
              </Flexbox>
            </Surface>

            <Surface>
              <Flexbox horizontal align="center" justify="space-between" gap={12}>
                <Typography.Text strong>Start work</Typography.Text>
                <Segmented
                  options={[
                    { label: 'Chat', value: 'chat' },
                    { label: 'Task', value: 'task' },
                  ]}
                  size="small"
                  value={mode}
                  onChange={(value) => setMode(value as HomeMode)}
                />
              </Flexbox>
              <Input.TextArea
                aria-label="Home work input"
                autoSize={{ minRows: 3, maxRows: 6 }}
                disabled={submissionBlocked}
                placeholder={mode === 'chat' ? 'Ask Research Agent…' : 'Describe the task and expected outcome…'}
                style={{ marginTop: 12, resize: 'none' }}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Flexbox horizontal align="center" justify="space-between" gap={12} style={{ marginTop: 10 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {submitted || (mode === 'chat' ? 'Creates a Station topic after acceptance' : 'Creates and runs a Station Agent Task')}
                </Typography.Text>
                <ActionIcon
                  aria-label={mode === 'chat' ? 'Send Chat' : 'Create Task'}
                  disabled={!draft.trim() || submissionBlocked}
                  icon={ArrowUp}
                  size={{ blockSize: 34, size: 16 }}
                  style={{
                    background: draft.trim() && !submissionBlocked ? token.colorPrimary : token.colorFillSecondary,
                    borderRadius: 10,
                    color: draft.trim() && !submissionBlocked ? token.colorWhite : token.colorTextDisabled,
                  }}
                  title={mode === 'chat' ? 'Send Chat' : 'Create Task'}
                  onClick={submit}
                />
              </Flexbox>
            </Surface>

            <Surface>
              <Typography.Text strong>Recent accepted work</Typography.Text>
              <WorkRow meta="Research Agent · 8 minutes ago" status="running" title="Compare federation recovery models" onOpen={() => setSubmitted('Opened Station topic topic-1039')} />
              <WorkRow meta="Research Agent · Yesterday" status="completed" title="Agent capability contract review" onOpen={() => setSubmitted('Opened Station topic topic-1034')} />
              <WorkRow meta="Writing Agent · Yesterday" status="failed" title="Prepare launch brief" onOpen={() => setSubmitted('Opened Station task TASK-201')} />
            </Surface>
          </Flexbox>

          <Flexbox gap={16} style={{ minWidth: 0 }}>
            <Surface>
              <Typography.Text strong>Needs You</Typography.Text>
              <Typography.Paragraph style={{ margin: '10px 0 6px' }}>
                Approve GitHub issue read access for task TASK-208.
              </Typography.Paragraph>
              <Flexbox horizontal gap={8}>
                <Button onClick={() => setSubmitted('Opened TASK-208 approval detail')}>Review</Button>
                <Button type="primary" onClick={() => setSubmitted('Approval decision pending Station readback')}>Approve once</Button>
              </Flexbox>
            </Surface>
            <Surface>
              <Typography.Text strong>Brief</Typography.Text>
              <Typography.Paragraph style={{ margin: '10px 0 4px' }}>
                Two tasks completed. One connector requires attention.
              </Typography.Paragraph>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Source: Station Agent Tasks · updated 2 minutes ago
              </Typography.Text>
            </Surface>
            <Surface>
              <Typography.Text strong>Pinned Agents</Typography.Text>
              <Flexbox horizontal gap={8} style={{ marginTop: 10 }}>
                <Button aria-label="Select Research Agent" type="text" onClick={() => setSelectedAgent('research')}><SquareAgentTile label="R" /></Button>
                <Button aria-label="Select Writing Agent" type="text" onClick={() => setSelectedAgent('writing')}><SquareAgentTile label="W" /></Button>
                <Button aria-label="Select Code Agent" type="text" onClick={() => setSelectedAgent('code')}><SquareAgentTile label="C" /></Button>
              </Flexbox>
            </Surface>
          </Flexbox>
        </div>
      )}
    </Flexbox>
  );
}

interface CapabilityItem {
  id: string;
  kind: 'Tool' | 'MCP' | 'Connector';
  name: string;
  source: string;
  status: 'ready' | 'disconnected' | 'incompatible';
}

const capabilityItems: CapabilityItem[] = [
  { id: 'search', kind: 'Tool', name: 'Station Search', source: 'builtin@1.4', status: 'ready' },
  { id: 'filesystem', kind: 'MCP', name: 'Workspace Files', source: 'local-mcp@2.1', status: 'incompatible' },
  { id: 'github', kind: 'Connector', name: 'GitHub Issues', source: 'oauth/github@1.2', status: 'ready' },
  { id: 'calendar', kind: 'Connector', name: 'Calendar', source: 'oauth/calendar@1.0', status: 'disconnected' },
];

function CapabilityReview({ initialState, narrow }: { initialState: ToolState; narrow: boolean }) {
  const { token } = theme.useToken();
  const [selectedId, setSelectedId] = useState(
    initialState === 'incompatible'
      ? 'filesystem'
      : initialState === 'disconnected' || initialState === 'reconnecting'
        ? 'calendar'
        : 'github',
  );
  const [state, setState] = useState<ToolState>(initialState);
  const selected = capabilityItems.find((item) => item.id === selectedId) ?? capabilityItems[0];
  const effectiveStatus =
    state === 'incompatible'
      ? 'incompatible'
      : state === 'disconnected' || state === 'reconnecting'
        ? 'disconnected'
        : selected.status;
  const canOperate = effectiveStatus === 'ready';

  const selectCapability = (item: CapabilityItem) => {
    setSelectedId(item.id);
    setState(item.status === 'ready' ? 'ready' : item.status);
  };

  return (
    <Flexbox gap={18} style={{ margin: '0 auto', maxWidth: 1180 }}>
      <ReviewHeading
        description="One inventory, one binding policy, and one durable proposal→decision→execution→result lineage."
        title="Unified Capability Plane"
        trailing={
          <Select
            aria-label="Capability lifecycle state"
            options={toolStateOptions.map((value) => ({ label: value, value }))}
            size="small"
            style={{ minWidth: 150 }}
            value={state}
            onChange={(value) => setState(value as ToolState)}
          />
        }
      />
      <div
        style={{
          display: 'grid',
          gap: 18,
          gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(320px, 0.8fr) minmax(0, 1.2fr)',
        }}
      >
        <Surface>
          <Typography.Text strong>Research Agent capabilities</Typography.Text>
          <Flexbox gap={2} style={{ marginTop: 10 }}>
            {capabilityItems.map((item) => (
              <Button
                key={item.id}
                block
                type={selectedId === item.id ? 'primary' : 'text'}
                style={{ height: 48, textAlign: 'left' }}
                onClick={() => selectCapability(item)}
              >
                <Flexbox horizontal align="center" gap={8}>
                  <Tag>{item.kind}</Tag>
                  <span style={{ flex: 1 }}>{item.name}</span>
                  <StatusTag status={item.status} />
                </Flexbox>
              </Button>
            ))}
          </Flexbox>
        </Surface>

        <Flexbox gap={16}>
          <Surface>
            <Flexbox horizontal align="center" gap={10}>
              <Wrench size={18} color={token.colorPrimary} />
              <Flexbox flex={1} gap={2}>
                <Typography.Text strong>{selected.name}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {selected.source} · Agent binding policy: manual approval
                </Typography.Text>
              </Flexbox>
              <StatusTag status={effectiveStatus} />
            </Flexbox>
            <Flexbox horizontal gap={8} style={{ marginTop: 12 }}>
              <Button disabled={!canOperate} onClick={() => setState('binding')}>Bind to Agent</Button>
              <Button onClick={() => setState('checking')}>Test connection</Button>
              <Button disabled={!canOperate || !['ready', 'bound'].includes(state)} type="primary" onClick={() => setState('approval')}>Review invocation</Button>
            </Flexbox>
          </Surface>
          <CapabilityStatePanel capability={selected} state={state} onStateChange={setState} />
        </Flexbox>
      </div>
    </Flexbox>
  );
}

function CapabilityStatePanel({
  capability,
  onStateChange,
  state,
}: {
  capability: CapabilityItem;
  onStateChange: (state: ToolState) => void;
  state: ToolState;
}) {
  if (state === 'checking') {
    return <Alert action={<Button onClick={() => onStateChange(capability.status === 'ready' ? 'ready' : capability.status)}>Project check result</Button>} title={`Checking ${capability.name} compatibility and connection…`} showIcon type="info" />;
  }
  if (state === 'binding') {
    return <Alert action={<Button type="primary" onClick={() => onStateChange('bound')}>Project Station readback</Button>} description="The UI remains pending until the Agent binding version is read back." title={`Binding ${capability.name} to Research Agent`} showIcon type="info" />;
  }
  if (state === 'bound') {
    return <Alert action={<Button type="primary" onClick={() => onStateChange('approval')}>Review invocation</Button>} description="Binding version 18 and manual approval policy were read back from Station." title={`${capability.name} is bound`} showIcon type="success" />;
  }
  if (state === 'ready') {
    return <Alert title={`${capability.name} is ready for a governed invocation`} showIcon type="success" />;
  }
  if (state === 'approval') {
    return (
      <Alert
        action={
          <Flexbox gap={6}>
            <Button onClick={() => onStateChange('denied')}>Deny</Button>
            <Button onClick={() => onStateChange('expired')}>Expire</Button>
            <Button type="primary" onClick={() => onStateChange('running')}>Approve once</Button>
          </Flexbox>
        }
        description={`Target: ${capability.name}. Read-only request. Expires in 2 minutes.`}
        title={`${capability.name} requests approval`}
        showIcon
        type="warning"
      />
    );
  }
  if (state === 'running') {
    return (
      <Surface>
        <Typography.Text strong>Execution tool-call-204 · {capability.name}</Typography.Text>
        <Progress percent={58} status="active" />
        <Flexbox horizontal gap={8}>
          <Button danger onClick={() => onStateChange('cancelled')}>Cancel</Button>
          <Button onClick={() => onStateChange('timed-out')}>Simulate timeout</Button>
          <Button type="primary" onClick={() => onStateChange('succeeded')}>Project result</Button>
        </Flexbox>
      </Surface>
    );
  }
  if (state === 'disconnected') {
    return <Alert action={<Button onClick={() => onStateChange('reconnecting')}>Reconnect</Button>} description="No invocation is admitted while the capability owner is disconnected." title={`${capability.name} is disconnected`} showIcon type="warning" />;
  }
  if (state === 'incompatible') {
    return <Alert action={<Button onClick={() => onStateChange('checking')}>Check another runtime</Button>} description="The selected model/runtime cannot execute this capability. Binding and invocation remain blocked." title={`${capability.name} is incompatible`} showIcon type="error" />;
  }
  if (state === 'reconnecting') {
    return <Alert action={<Button onClick={() => onStateChange('ready')}>Project authoritative readiness</Button>} title={`Reconnecting ${capability.name}…`} showIcon type="info" />;
  }
  if (state === 'succeeded') {
    return <Alert description="One authoritative result was persisted and returned to the model. Duplicate delivery is ignored." title={`${capability.name} execution completed`} showIcon type="success" />;
  }

  const reason: Record<'cancelled' | 'denied' | 'expired' | 'failed' | 'timed-out', string> = {
    cancelled: 'The user cancelled the running call. No result was returned to the model.',
    denied: 'The durable policy decision denied execution.',
    expired: 'Approval expired before execution; no tool call started.',
    failed: 'The executor returned a typed failure. The call remains retryable.',
    'timed-out': 'The execution exceeded its deadline and was terminated.',
  };
  const terminalState = state in reason ? state as keyof typeof reason : 'failed';
  return (
    <Alert
      action={<Button onClick={() => onStateChange(terminalState === 'expired' || terminalState === 'denied' ? 'approval' : 'ready')}>Recover</Button>}
      description={`${reason[terminalState]} Decision and attempt remain in TurnTrace.`}
      title={`${capability.name}: ${terminalState}`}
      showIcon
      type="error"
    />
  );
}

interface EvalCase {
  id: string;
  input: string;
  result: 'passed' | 'failed' | 'pending';
}

function EvaluationReview({ initialState, narrow }: { initialState: EvalState; narrow: boolean }) {
  const { token } = theme.useToken();
  const [state, setState] = useState<EvalState>(initialState);
  const [benchmark, setBenchmark] = useState('reliability');
  const [dataset, setDataset] = useState('v2-cases');
  const [agent, setAgent] = useState('research');
  const [runId, setRunId] = useState('eval-304');
  const [caseInputs, setCaseInputs] = useState([
    'Explain Station authority',
    'Reject an unsupported tool',
    'Recover after reconnect',
  ]);
  const progress =
    state === 'completed'
      ? 100
      : state === 'partial' || state === 'cancelled'
        ? 67
        : ['running', 'cancelling', 'retrying', 'restoring'].includes(state)
          ? 42
          : 0;
  const cases: EvalCase[] = useMemo(
    () => caseInputs.map((input, index) => ({
      id: `case-${index + 1}`,
      input,
      result:
        state === 'failed' && index === 0
          ? 'passed'
          : state === 'failed' && index === 1
            ? 'failed'
            : index === 0 && progress >= 34
          ? 'passed'
          : index === 1 && progress >= 67
            ? 'failed'
            : index === 2 && progress === 100
              ? 'passed'
              : 'pending',
    })),
    [caseInputs, progress, state],
  );

  const configurationLocked = state !== 'draft';

  return (
    <Flexbox gap={18} style={{ margin: '0 auto', maxWidth: 1180 }}>
      <ReviewHeading
        description="Durable benchmark cases execute through the real Agent runtime and recover from cancel, retry, and restart."
        title="Evaluation Lab"
        trailing={
          <Select
            aria-label="Evaluation lifecycle state"
            options={evalStateOptions.map((value) => ({ label: value, value }))}
            size="small"
            style={{ minWidth: 150 }}
            value={state}
            onChange={(value) => setState(value as EvalState)}
          />
        }
      />
      <div
        style={{
          display: 'grid',
          gap: 18,
          gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : '300px minmax(0, 1fr)',
        }}
      >
        <Surface>
          <Typography.Text strong>Evaluation configuration</Typography.Text>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 12 }}>Benchmark</Typography.Text>
          <Select
            disabled={configurationLocked}
            options={[
              { label: 'Agent reliability', value: 'reliability' },
              { label: 'Tool governance', value: 'tool-governance' },
            ]}
            style={{ width: '100%' }}
            value={benchmark}
            onChange={setBenchmark}
          />
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 12 }}>Dataset</Typography.Text>
          <Select
            disabled={configurationLocked}
            options={[
              { label: 'V2 product cases · 3', value: 'v2-cases' },
              { label: 'Recovery cases · 3', value: 'recovery-cases' },
            ]}
            style={{ width: '100%' }}
            value={dataset}
            onChange={setDataset}
          />
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 12 }}>Target Agent</Typography.Text>
          <Select
            disabled={configurationLocked}
            options={[
              { label: 'Research Agent · gpt-4.1', value: 'research' },
              { label: 'Writing Agent · claude-sonnet', value: 'writing' },
            ]}
            style={{ width: '100%' }}
            value={agent}
            onChange={setAgent}
          />
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 12 }}>Test cases</Typography.Text>
          <Flexbox gap={6}>
            {caseInputs.map((input, index) => (
              <Input
                key={`draft-case-${index + 1}`}
                aria-label={`Evaluation case ${index + 1}`}
                disabled={configurationLocked}
                value={input}
                onChange={(event) => setCaseInputs((current) => current.map((entry, entryIndex) => entryIndex === index ? event.target.value : entry))}
              />
            ))}
          </Flexbox>
          <Button
            block
            disabled={configurationLocked || caseInputs.some((input) => !input.trim())}
            icon={<FlaskConical size={14} />}
            style={{ marginTop: 16 }}
            type="primary"
            onClick={() => { setRunId('eval-304'); setState('pending'); }}
          >
            Start evaluation
          </Button>
        </Surface>

        <Flexbox gap={16}>
          {state === 'draft' && (
            <Surface>
              <Empty description="No durable evaluation run exists yet">
                <Typography.Text type="secondary">
                  Configure benchmark, dataset, target Agent, and test cases before creating a run.
                </Typography.Text>
              </Empty>
            </Surface>
          )}
          {state === 'pending' && (
            <Alert action={<Button type="primary" onClick={() => setState('running')}>Project run start</Button>} description={`Station assigned run ID ${runId}. No case execution has been inferred yet.`} title="Evaluation pending" showIcon type="info" />
          )}
          {state === 'restoring' && (
            <Alert action={<Button onClick={() => setState('running')}>Apply Station readback</Button>} description="Local terminal inference is disabled while run and case results are fetched." title={`Restoring run ${runId} from Station…`} showIcon type="info" />
          )}
          {state === 'failed' && (
            <Alert
              action={<Button onClick={() => { setRunId('eval-305'); setState('retrying'); }}>Retry failed case</Button>}
              description="PROVIDER_RATE_LIMIT: case-2 exhausted its retry budget. Completed case results remain durable."
              title="Evaluation failed with a typed cause"
              showIcon
              type="error"
            />
          )}
          {state === 'partial' && (
            <Alert
              action={<Button onClick={() => { setRunId('eval-305'); setState('retrying'); }}>Retry incomplete cases</Button>}
              description="Two results are authoritative; one case has no terminal result."
              title="Evaluation partially completed"
              showIcon
              type="warning"
            />
          )}
          {state === 'cancelled' && (
            <Alert action={<Button onClick={() => setState('draft')}>Create follow-up run</Button>} description="Cancellation was confirmed by Station. Two completed case results remain inspectable; this terminal run will not transition." title="Evaluation cancelled" showIcon type="warning" />
          )}
          {state === 'retrying' && (
            <Alert action={<Button onClick={() => setState('pending')}>Project child run</Button>} description="Terminal parent eval-304 remains immutable. Only failed or incomplete cases seed child run eval-305." title="Creating linked child retry run" showIcon type="info" />
          )}
          {state !== 'draft' && (
          <Surface>
            <Flexbox horizontal align="center" justify="space-between" gap={12}>
              <Flexbox gap={2}>
                <Typography.Text strong>Run {runId}</Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Research Agent · config snapshot cfg-18 · Station authoritative
                </Typography.Text>
              </Flexbox>
              <Tag color={state === 'completed' ? 'success' : state === 'failed' ? 'error' : ['partial', 'cancelled'].includes(state) ? 'warning' : 'processing'}>{state}</Tag>
            </Flexbox>
            <Progress percent={progress} status={state === 'failed' ? 'exception' : state === 'completed' ? 'success' : 'active'} />
            {state === 'completed' && (
              <Flexbox horizontal gap={8} wrap="wrap" style={{ marginBottom: 10 }}>
                <Tag color="success">Accuracy 67%</Tag>
                <Tag>Average latency 1.8s</Tag>
                <Tag>3 terminal cases</Tag>
              </Flexbox>
            )}
            <Flexbox gap={0}>
              {cases.map((item) => (
                <Flexbox
                  key={item.id}
                  horizontal
                  align="center"
                  gap={10}
                  style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, padding: '10px 0' }}
                >
                  <CheckCircle2 size={15} />
                  <Flexbox flex={1} gap={2}>
                    <Typography.Text>{item.input}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>{item.id}</Typography.Text>
                  </Flexbox>
                  <StatusTag status={item.result} />
                </Flexbox>
              ))}
            </Flexbox>
            <Flexbox horizontal gap={8} style={{ marginTop: 10 }}>
              {(state === 'running' || state === 'pending') && (
                <Button danger onClick={() => setState('cancelling')}>Cancel run</Button>
              )}
              {state === 'cancelling' && (
                <Button onClick={() => setState('cancelled')}>Project authoritative cancellation</Button>
              )}
              {state === 'running' && (
                <Button type="primary" onClick={() => setState('completed')}>Project terminal results</Button>
              )}
              <Button onClick={() => setState('restoring')}>Simulate restart</Button>
            </Flexbox>
          </Surface>
          )}
        </Flexbox>
      </div>
    </Flexbox>
  );
}

function ReviewHeading({
  description,
  title,
  trailing,
}: {
  description: string;
  title: string;
  trailing: ReactNode;
}) {
  return (
    <Flexbox horizontal align="center" justify="space-between" gap={16} wrap="wrap">
      <Flexbox gap={3}>
        <Typography.Title level={4} style={{ margin: 0 }}>{title}</Typography.Title>
        <Typography.Text type="secondary">{description}</Typography.Text>
      </Flexbox>
      {trailing}
    </Flexbox>
  );
}

function Surface({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <section
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        padding: 16,
      }}
    >
      {children}
    </section>
  );
}

function SquareAgentTile({ label }: { label: string }) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      align="center"
      justify="center"
      style={{
        background: token.colorPrimaryBg,
        borderRadius: 8,
        color: token.colorPrimary,
        flex: '0 0 36px',
        fontWeight: 700,
        height: 36,
        width: 36,
      }}
    >
      {label}
    </Flexbox>
  );
}

function WorkRow({
  meta,
  onOpen,
  status,
  title,
}: {
  meta: string;
  onOpen: () => void;
  status: string;
  title: string;
}) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      horizontal
      align="center"
      gap={10}
      style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, marginTop: 10, paddingTop: 10 }}
    >
      <Flexbox flex={1} gap={2}>
        <Button style={{ height: 'auto', padding: 0, textAlign: 'left' }} type="link" onClick={onOpen}>{title}</Button>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>{meta}</Typography.Text>
      </Flexbox>
      <StatusTag status={status} />
    </Flexbox>
  );
}

function StatusTag({ status }: { status: string }) {
  const color =
    status === 'ready' || status === 'passed' || status === 'completed' || status === 'succeeded'
      ? 'success'
      : status === 'failed' || status === 'incompatible'
        ? 'error'
        : status === 'disconnected' || status === 'pending'
          ? 'warning'
          : 'processing';

  return <Tag color={color}>{status}</Tag>;
}

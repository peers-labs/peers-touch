// Agent Prototype — Mock Runtime
// Simulates the dual-surface agent runtime:
// - "Agents" surface: agent list, selection, profile access
// - "Atelier" surface: task execution, message stream, context management

import type { Agent, AgentSnapshot, Block, Task, TaskContext, TodoItem } from './types';

type Subscriber = (snapshot: AgentSnapshot) => void;

export interface AgentRuntime {
  getSnapshot(): AgentSnapshot;
  subscribe(fn: Subscriber): () => void;

  // Agent surface operations
  selectAgent(id: string): void;
  getAgentProfile(id: string): Agent | undefined;

  // Atelier surface operations
  sendMessage(taskId: string, text: string): void;
  selectTask(taskId: string): void;
  addTask(title: string, project: string): void;
}

// -- Seed data: Agents --

const SEED_AGENTS: Agent[] = [
  {
    id: 'agent-1',
    name: 'DevOps Agent',
    avatar: '#6b5bd6',
    description: 'Handles CI/CD pipelines, infrastructure as code, container orchestration, and deployment automation. Specializes in GitHub Actions, Docker, and Kubernetes.',
    model: 'Claude Sonnet 4',
    provider: 'Anthropic',
    pinned: true,
    workspacePath: '~/Projects/peers-touch',
    temperature: 0.4,
  },
  {
    id: 'agent-2',
    name: 'Writing Assistant',
    avatar: '#52c41a',
    description: 'Helps with documentation, technical writing, blog posts, and content creation. Focuses on clarity, structure, and audience-appropriate tone.',
    model: 'GPT-5.5',
    provider: 'OpenAI',
    pinned: false,
    workspacePath: '~/Documents/writing',
    temperature: 0.7,
  },
  {
    id: 'agent-3',
    name: 'Code Review',
    avatar: '#faad14',
    description: 'Reviews code for correctness, performance, security vulnerabilities, and adherence to best practices. Provides actionable feedback with examples.',
    model: 'Claude Opus 4',
    provider: 'Anthropic',
    pinned: true,
    workspacePath: '~/Projects/peers-touch',
    temperature: 0.2,
  },
  {
    id: 'agent-4',
    name: 'Data Analyst',
    avatar: '#ff4d4f',
    description: 'Analyzes datasets, creates visualizations, runs statistical tests, and builds dashboards. Proficient in Python, SQL, and data storytelling.',
    model: 'Gemini 2.5 Pro',
    provider: 'Google',
    pinned: false,
    workspacePath: '~/Projects/analytics',
    temperature: 0.3,
  },
];

// -- Seed data: Tasks (Atelier) --

const SEED_TASKS: Task[] = [
  { id: 't1', project: 'peers-touch', title: 'Implement federation relay', status: 'active', running: true, branch: 'feat/relay-v2' },
  { id: 't2', project: 'peers-touch', title: 'Fix auth token refresh', status: 'active', running: false },
  { id: 't3', project: 'peers-touch', title: 'Refactor runtime projections', status: 'active', running: false, branch: 'refactor/projections' },
  { id: 't4', project: 'applets', title: 'Note applet CRUD', status: 'active', running: false },
  { id: 't5', project: 'applets', title: 'Calendar skill integration', status: 'active', running: false, branch: 'feat/calendar-skill' },
];

const SEED_STREAM: Record<string, Block[]> = {
  t1: [
    { kind: 'user', id: 'b1', text: 'Implement the federation relay with QUIC transport support.', at: '14:02' },
    { kind: 'agent', id: 'b2', text: 'I will implement the federation relay module with QUIC transport.', bullets: ['Create relay server struct', 'Add QUIC listener', 'Implement peer discovery', 'Add connection pooling'], at: '14:02', done: false },
    { kind: 'tool-call', id: 'b3', tool: 'Read relay/config.rs', status: 'done', duration: '0.3s' },
    { kind: 'nego', id: 'b4', summary: 'Transport protocol selection', agentCount: 3, converged: true, voices: [
      { role: 'Architect', stance: 'proposal', text: 'Use QUIC for its multiplexing and 0-RTT capabilities.' },
      { role: 'Risk', stance: 'objection', text: 'QUIC adds complexity; consider fallback to TCP for constrained environments.' },
      { role: 'Architect', stance: 'counter', text: 'We can implement TCP fallback as a secondary transport without changing the relay interface.' },
    ], consensus: 'QUIC primary with TCP fallback' },
    { kind: 'diff', id: 'b5', files: 3, added: 142, removed: 12, paths: ['relay/src/transport.rs', 'relay/src/config.rs', 'relay/src/lib.rs'] },
  ],
  t2: [
    { kind: 'user', id: 'b10', text: 'The auth token refresh is failing silently when the refresh token expires.', at: '10:15' },
    { kind: 'agent', id: 'b11', text: 'Analyzing the token refresh flow to identify the silent failure point.', at: '10:15', done: true },
    { kind: 'tool-call', id: 'b12', tool: 'Grep "refreshToken"', status: 'done', duration: '1.2s', output: '12 matches in 4 files' },
  ],
};

const SEED_CONTEXT: Record<string, TaskContext> = {
  t1: { usedPct: 34, files: [
    { name: 'relay/src/transport.rs', group: 'files' },
    { name: 'relay/src/config.rs', group: 'files' },
    { name: 'relay/src/lib.rs', group: 'files' },
    { name: 'docs/architecture/relay.md', group: 'other' },
  ]},
  t2: { usedPct: 12, files: [
    { name: 'auth/token_manager.ts', group: 'files' },
    { name: 'auth/refresh.ts', group: 'files' },
  ]},
};

const SEED_TODOS: Record<string, TodoItem[]> = {
  t1: [
    { id: 'td1', text: 'Define QUIC transport interface', done: true },
    { id: 'td2', text: 'Implement connection pooling', done: false },
    { id: 'td3', text: 'Add peer discovery protocol', done: false },
    { id: 'td4', text: 'Write integration tests', done: false },
  ],
  t2: [
    { id: 'td5', text: 'Locate silent error swallowing', done: true },
    { id: 'td6', text: 'Add proper error propagation', done: false },
  ],
};

// -- Runtime factory --

export function createMockRuntime(): AgentRuntime {
  let snapshot: AgentSnapshot = {
    agents: [...SEED_AGENTS],
    selectedAgentId: 'agent-1',
    tasks: [...SEED_TASKS],
    selectedTaskId: 't1',
    stream: { ...SEED_STREAM },
    context: { ...SEED_CONTEXT },
    todos: { ...SEED_TODOS },
    model: 'Claude Sonnet 4',
  };

  const subscribers = new Set<Subscriber>();

  function notify() {
    snapshot = { ...snapshot };
    subscribers.forEach((fn) => fn(snapshot));
  }

  return {
    getSnapshot() {
      return snapshot;
    },

    subscribe(fn: Subscriber) {
      subscribers.add(fn);
      return () => { subscribers.delete(fn); };
    },

    // -- Agent surface --

    selectAgent(id: string) {
      if (snapshot.agents.some((a) => a.id === id)) {
        snapshot.selectedAgentId = id;
        // When switching agents, update model to match the agent's configured model
        const agent = snapshot.agents.find((a) => a.id === id);
        if (agent) {
          snapshot.model = agent.model;
        }
        notify();
      }
    },

    getAgentProfile(id: string) {
      return snapshot.agents.find((a) => a.id === id);
    },

    // -- Atelier surface --

    sendMessage(taskId: string, text: string) {
      const taskStream = snapshot.stream[taskId] ?? [];
      const userBlock: Block = {
        kind: 'user',
        id: `b${Date.now()}`,
        text,
        at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      snapshot.stream = { ...snapshot.stream, [taskId]: [...taskStream, userBlock] };
      notify();

      // Simulate agent response after a brief delay
      setTimeout(() => {
        const agentBlock: Block = {
          kind: 'agent',
          id: `b${Date.now() + 1}`,
          text: `Processing: "${text}"`,
          at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          done: false,
        };
        const currentStream = snapshot.stream[taskId] ?? [];
        snapshot.stream = { ...snapshot.stream, [taskId]: [...currentStream, agentBlock] };
        notify();
      }, 600);
    },

    selectTask(taskId: string) {
      snapshot.selectedTaskId = taskId;
      notify();
    },

    addTask(title: string, project: string) {
      const newTask: Task = {
        id: `t${Date.now()}`,
        project,
        title,
        status: 'active',
        running: false,
      };
      snapshot.tasks = [...snapshot.tasks, newTask];
      snapshot.stream = { ...snapshot.stream, [newTask.id]: [] };
      snapshot.context = { ...snapshot.context, [newTask.id]: { usedPct: 0, files: [] } };
      snapshot.todos = { ...snapshot.todos, [newTask.id]: [] };
      snapshot.selectedTaskId = newTask.id;
      notify();
    },
  };
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpenText,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  HelpCircle,
  Link2,
  List,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Send,
  Settings,
  Share2,
  Square,
  Sparkles,
  TerminalSquare,
  Trash2,
  TriangleAlert,
  UserPlus,
  X,
  type LucideIcon,
} from 'lucide-react';
import { T } from './theme';
import { PanelToggleDock } from '../../shared/PanelToggleButton';
import { AgentProfile, listAgentSlashCommands } from '../../features/agent/src/panels/AgentProfile';
import type { Agent as ProfileAgent } from '../../features/agent/src/types';
import {
  INITIAL_AGENT_AVATAR,
  normalizePrototypeAgentAvatar,
  PrototypeAgentAvatarView,
  type PrototypeAgentAvatar,
} from '../../shared/PrototypeAgentAvatar';
import {
  getEnabledPrototypeChatModelProviders,
  loadPrototypeDefaultModel,
  normalizePrototypeChatModelId,
  PROTOTYPE_CHAT_MODELS,
  subscribePrototypeChatModelAvailability,
  subscribePrototypeDefaultModel,
  type PrototypeChatModelProvider,
  type PrototypeChatModelId,
} from '../../shared/prototypeAgentModels';

// ─────────────────────────────────────────────────────────────────────────
// Ordinary-Agent chat workbench — prototype only.
//
// Product thesis: a persistent roster makes ordinary workspace Agents direct
// to find and operate; topics stay contextual to the selected Agent while the
// grounded composer owns the primary action. Information density comes from
// hierarchy, not decoration (Quiet Protocol Minimalism).
// ─────────────────────────────────────────────────────────────────────────

interface Thread {
  id: string;
  agentId: string;
  title: string;
  titleState?: 'generating' | 'ready';
  createdAt: number;
  pinned?: boolean;
  messages: ChatMessage[];
  model: ModelId;
}

// An ordinary Agent the user can chat with. Threads, drafts and the selected
// model are owned per agent. Creation is instant (reference-client Create Local
// parity): the entity exists immediately and lands in its Profile Builder;
// identity and extensions persist on change, with no blocking form.
interface ChatAgent {
  id: string;
  name: string;
  description: string;
  avatar: PrototypeAgentAvatar;
  createdAt: number;
}

const BUILTIN_AGENT_ID = 'assistant';

const DEFAULT_AGENT_DESCRIPTION = 'Your ordinary workspace Agent for questions, planning, writing, and getting work done.';

// One-time normalization of the built-in seed rename ("Assistant" -> "Agent").
// Only the untouched default matches; a user-renamed built-in keeps its name.
function normalizeBuiltInName(id: string, name: string): string {
  return id === BUILTIN_AGENT_ID && name === 'Assistant' ? 'Agent' : name;
}

function agentStoreKey(id: string) { return `agent-chat-agent-${id}`; }
// Draft key for an Agent's not-yet-sent composer text on its "new topic" slot.
function newTopicDraftKey(agentId: string) { return `__new:${agentId}`; }
function loadStoredAgents(): ChatAgent[] {
  try {
    const ids = JSON.parse(localStorage.getItem('agent-chat-agent-order') ?? '[]') as unknown;
    if (!Array.isArray(ids)) return [];
    const out: ChatAgent[] = [];
    for (const id of ids) {
      if (typeof id !== 'string' || !id || out.some((agent) => agent.id === id)) continue;
      try {
        const raw = localStorage.getItem(agentStoreKey(id));
        if (!raw) continue;
        const a = JSON.parse(raw) as unknown;
        if (a && typeof a === 'object') {
          const v = a as Record<string, unknown>;
          if (v.id === id && typeof v.name === 'string') {
            out.push({
              id: v.id,
              name: normalizeBuiltInName(v.id, v.name),
              description: typeof v.description === 'string' ? v.description : DEFAULT_AGENT_DESCRIPTION,
              avatar: normalizePrototypeAgentAvatar(v.avatar),
              createdAt: typeof v.createdAt === 'number' ? v.createdAt : Date.now(),
            });
          }
        }
      } catch { /* skip one corrupt record */ }
    }
    return out;
  } catch {
    return [];
  }
}
function persistAgents(agents: ChatAgent[]) {
  try {
    for (const a of agents) localStorage.setItem(agentStoreKey(a.id), JSON.stringify(a));
    localStorage.setItem('agent-chat-agent-order', JSON.stringify(agents.map((a) => a.id)));
  } catch { /* storage unavailable: in-memory only */ }
}

type ModelId = PrototypeChatModelId;
const MODELS = PROTOTYPE_CHAT_MODELS;

type StepKind = 'thought' | 'command';
interface ActivityStep { id: string; kind: StepKind; label: string; command?: string }

interface ArtifactRef { id: string; kind: 'doc' | 'link'; title: string; meta: string; content?: string }

// Turn pause points. An ask card needs an answer before the turn can finish;
// an approval card gates one consequential command. Both resolve inline and
// leave a compact, non-interactive record afterwards.
interface AskCard {
  question: string;
  options: string[];
  status: 'pending' | 'answered' | 'cancelled';
  answer?: string;
}

interface ApprovalCard {
  toolName: string;
  toolCategory: string;
  command: string;
  summary: string;
  argumentsPreview: string;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
}

// Typed turn failures (fp-05 §4). Each kind owns its own copy, tone, and
// recovery action — never a raw browser string or a half-failed "success".
type ErrorKind = 'not-configured' | 'auth' | 'rate-limit' | 'network' | 'interrupted' | 'cancelled';
interface TurnError {
  kind: ErrorKind;
  retryAfterMs?: number;
}

const ERROR_COPY: Record<ErrorKind, { title: string; body: string; tone: 'neutral' | 'danger' | 'warning' }> = {
  'not-configured': {
    title: 'Agent isn’t connected to a model',
    body: 'Pick a working model in settings before the Agent can reply. Your draft has been kept.',
    tone: 'neutral',
  },
  auth: {
    title: 'Sign-in rejected',
    body: 'The saved model key is invalid or has expired. Reconnect the provider, then send again. Your draft has been kept.',
    tone: 'danger',
  },
  'rate-limit': {
    title: 'Model is rate-limited',
    body: 'The provider is temporarily rejecting too many requests. Wait a moment and retry — your draft is kept.',
    tone: 'warning',
  },
  network: {
    title: 'Can’t reach the model service',
    body: 'The connection failed before an answer arrived. Check your network and retry; your draft has been kept.',
    tone: 'warning',
  },
  interrupted: {
    title: 'Interrupted',
    body: 'The response was cut off before it finished. Retry to continue this turn.',
    tone: 'warning',
  },
  cancelled: {
    title: 'Agent execution cancelled',
    body: 'The active Agent run was stopped before completion.',
    tone: 'warning',
  },
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  attachments?: Array<{ name: string; size: number; type: string }>;
  ts: number;
  steps?: ActivityStep[];
  ask?: AskCard;
  approval?: ApprovalCard;
  turnError?: TurnError;
  artifact?: ArtifactRef;
  followUps?: string[];
  tokens?: number;
  // Continuation answers (ask replies) run as their own assistant message.
  fromAsk?: boolean;
  phase: 'thinking' | 'waiting' | 'streaming' | 'done' | 'error';
}

// Static shape of a scripted prototype turn. Gate branches ignore `text`
// until the card resolves; `deniedText` is the honest note for a refused gate.
interface TurnSpec {
  steps: ActivityStep[];
  ask?: { question: string; options: string[] };
  approval?: {
    toolName: string;
    toolCategory: string;
    command: string;
    summary: string;
    argumentsPreview: string;
  };
  text: string;
  deniedText?: string;
  artifact?: ArtifactRef;
  followUps: string[];
  tokens: number;
}

interface Starter { prompt: string; icon: LucideIcon }
const STARTERS: Starter[] = [
  { prompt: 'Draft a short project update from this week’s work', icon: FileText },
  { prompt: 'Summarize my day and suggest tomorrow’s priorities', icon: Sparkles },
  { prompt: 'Explain a concept simply, with an example', icon: BookOpenText },
  { prompt: 'Plan a focused two-hour work session', icon: Clock3 },
];

const DAY = 86_400_000;

function answerFor(prompt: string, model: ModelId): TurnSpec {
  // Review-only long-content stress (?state=agent-chat&review=1&agentStress=1).
  // Exercises every wrapping/ellipsis contract in one turn; remove together
  // with the other review injection surfaces when porting to production.
  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('agentStress') === '1') {
    const longCommand = 'pnpm --filter @peers-touch/prototype-portal exec jest --ci --runInBand --updateSnapshot packages/prototypes/desktop/shell/src/__tests__/agent-chat-long-content-stress-case-with-a-very-long-flag-list-and-path/';
    const longUrl = 'https://example.internal.example.com/a/very/deeply/nested/path/with/query?one=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    return {
      steps: [
        { id: 'th', kind: 'thought', label: `Reviewed the request and considered every implication of choosing option ${'x'.repeat(120)} before acting` },
        { id: 'cmd', kind: 'command', label: 'Prepared a bounded command for the long-content stress case', command: longCommand },
      ],
      approval: {
        toolName: 'workspace_snapshot_update',
        toolCategory: 'workspace',
        command: longCommand,
        summary: `Stress summary: ${'word '.repeat(120)} ends with a long token ${'y'.repeat(160)}.`,
        argumentsPreview: JSON.stringify({ command: longCommand, scope: 'workspace snapshots' }),
      },
      text:
        `**${'Long bold heading that should wrap across multiple lines '.repeat(4)}**\n`
        + `- A bullet containing a long unbroken URL: ${longUrl}\n`
        + `- A bullet with inline code \`${'z'.repeat(220)}\` inside running text.\n`
        + `1. A numbered list item with a normal sentence and then ${'w'.repeat(200)} to force an internal break.\n`
        + `Normal paragraph with spaces wraps by default; this one also has a long token attached${'q'.repeat(300)}.`,
      artifact: { id: 'ar-stress', kind: 'doc', title: `${'Very long artifact title without spaces'.repeat(3)}.md`, meta: `Draft · ${'l'.repeat(120)}` },
      followUps: [`${'Continue with '.repeat(20)} more detail please`],
      tokens: model === 'gpt-5.4' || model === 'claude-sonnet' ? 2200 : 1100,
    };
  }
  const p = prompt.toLowerCase();
  const reasoning = model === 'gpt-5.4' || model === 'claude-sonnet';
  if (/project update|status update|周报|进展/.test(p)) {
    return {
      steps: [{ id: 'th', kind: 'thought', label: 'Drafted a concise status update' }],
      text:
        'Here is a short project update you can send as-is.\n\n**This week**\n- Shipped the channel connection contract and the persistent list/detail admin prototype.\n- Realigned the Agent workbench to a single plain Agent.\n- Closed the stop/retry gaps found during live review.\n\n**Risks**\n- Feishu credentials and a real environment are still needed before the Lark turn can be proven end to end.\n\n**Next**\n- Freeze the interaction contract, then prove one inbound message to one Agent reply.',
      artifact: { id: 'ar-update', kind: 'doc', title: 'Project update.md', meta: 'Draft · 4 lines' },
      followUps: ['Make it more formal', 'Turn it into an email', 'Add a metrics section'],
      tokens: reasoning ? 1680 : 980,
    };
  }
  if (/summar|priorit|今天|安排/.test(p)) {
    return {
      steps: [{ id: 'th', kind: 'thought', label: 'Grouped loose ends into a short list' }],
      text:
        '**Suggested priorities**\n- Finish the single-Agent prototype review and lock the interaction contract.\n- Prepare the Feishu credentials needed for the first real connection.\n- Keep the Lark backend branch separate until the design is confirmed.\n\n**First session tomorrow**\nStart with the contract review while context is fresh; defer anything that needs credentials.',
      followUps: ['Turn this into a checklist', 'Estimate the review', 'What can I delegate?'],
      tokens: reasoning ? 1420 : 860,
    };
  }
  if (/plan|session|focus|计划/.test(p)) {
    return {
      steps: [{ id: 'th', kind: 'thought', label: 'Built a time-boxed plan with one goal' }],
      text:
        '**Two-hour focused session**\n1. First 10 min — write the one outcome the session must produce.\n2. 70 min — deep work on that outcome; silence notifications.\n3. 10 min — break.\n4. 30 min — finish and note the next physical action.\n\nKeep one tab, one document, and a visible timer. Stop when the outcome exists, not when the timer ends.',
      followUps: ['Add a 25/5 version', 'What if I get blocked?'],
      tokens: reasoning ? 1310 : 740,
    };
  }
  // Gate: the Agent needs one decision before it can finish the draft.
  if (/email|邮件|写信/.test(p)) {
    return {
      steps: [{ id: 'th', kind: 'thought', label: 'Noted who the email is for and the goal' }],
      ask: { question: 'What tone should this email take?', options: ['Concise', 'Friendly', 'Formal'] },
      text: '',
      followUps: ['Make it shorter', 'Add a clear next step', 'Soften the opening'],
      tokens: reasoning ? 1240 : 720,
    };
  }
  // Gate: a command that rewrites files waits for explicit approval.
  if (/test suite|run the tests|run tests|测试|跑/.test(p)) {
    const command = 'pnpm --filter @peers-touch/prototype-portal test -- -u';
    return {
      steps: [
        { id: 'th', kind: 'thought', label: 'Checked which packages have tests' },
        { id: 'cmd', kind: 'command', label: 'Refresh outdated snapshots', command },
      ],
      approval: {
        toolName: 'workspace_snapshot_update',
        toolCategory: 'workspace',
        command,
        summary: 'This rewrites outdated snapshot files in your workspace. It installs nothing and touches no source files.',
        argumentsPreview: JSON.stringify({ command, scope: 'workspace snapshots' }),
      },
      text:
        '**Done — all checks pass**\n- 42 tests passed; 2 snapshots were refreshed to match the current shell.\n- Only snapshot files changed; no source code was modified.\n- The prototype portal build still passes.',
      deniedText: 'I did not run the command, so nothing in your workspace changed. Ask me for a read-only test run instead if you want one.',
      followUps: ['Show the snapshot diff', 'Run the full suite', 'Open the build log'],
      tokens: reasoning ? 1180 : 640,
    };
  }
  // Default: a simple explanation, occasionally showing a command-style step
  // so the activity language is demonstrable without fake specialists.
  const explain = /explain|concept|what is|为什么|什么是/.test(p);
  return {
    steps: explain
      ? [{ id: 'th', kind: 'thought', label: reasoning ? 'Compared two framings before answering' : 'Picked the simplest framing' }]
      : [
          { id: 'th', kind: 'thought', label: 'Understood the request' },
          { id: 'cmd', kind: 'command', label: 'Checked available context', command: 'read workspace notes' },
        ],
    text: explain
      ? `Here is the simple version.\n\n**The core idea** — keep one thing responsible for the outcome and show its state honestly.\n\n**An everyday analogy** — think of a front desk: one person receives, decides who acts, and tells you what is happening. You never need to know the internal routing.\n\nWant a concrete example from your own workspace?`
      : `Done. I kept this focused and honest about what I can and cannot verify.\n\n**What I did**\n- Treated “${trimPrompt(prompt)}” as the single goal.\n- Avoided inventing results I cannot prove.\n\nTell me the outcome you want next and I will take it one step further.`,
    followUps: ['Give an example', 'Go deeper', 'Make it shorter'],
    tokens: reasoning ? 1540 : 900,
  };
}

// Continuation text once an ask card has been answered.
function continuationText(prompt: string, choice: string): string {
  const p = prompt.toLowerCase();
  const tone = choice.toLowerCase();
  if (/email|邮件|写信/.test(p)) {
    const opener = tone === 'formal'
      ? 'I am writing to share this week’s progress and the one decision we need next.'
      : tone === 'friendly'
        ? 'Hope your week is going well — here is a quick update and one thing to decide next.'
        : 'Quick update on this week and the one decision we need next.';
    return `Here is a **${tone}** email you can send as-is.\n\n**Subject** — Project update and next step\n\nHi team,\n\n${opener}\nThe channel connection contract landed, and the Agent workbench is now a single plain Agent. The only open item is the Feishu credentials needed for the first real connection.\n\nReply with the credentials or a time to pair on them.\n\nThanks`;
  }
  return `Done — I went with **${choice}**. Tell me what to adjust next.`;
}

function trimPrompt(p: string) {
  const clean = p.replace(/[?？.。!！]/g, '').trim();
  return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean || 'the idea';
}

function groupKey(ts: number): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (ts >= start.getTime()) return 'Today';
  if (ts >= start.getTime() - DAY) return 'Yesterday';
  return 'Previous';
}

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// Continuity-only motion for this surface. The former shared scrollbar.css
// was removed from the shell; these three classes are local to the chat page
// so its spinner, waiting dots, and streaming caret stay self-contained.
const AGENT_CHAT_CSS = `
@keyframes pt-spin { to { transform: rotate(360deg); } }
.pt-spin { animation: pt-spin 1s linear infinite; }
.pt-stream-caret {
  display: inline-block; width: 7px; height: 15px; margin-left: 3px;
  border-radius: 1px; background: #6b5bd6; vertical-align: -2px;
  animation: pt-caret-blink 1s steps(1) infinite;
}
@keyframes pt-caret-blink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0; } }
.pt-typing-dot {
  width: 6px; height: 6px; border-radius: 50%; background: #8c8c8c;
  animation: pt-typing 1.1s ease-in-out infinite;
}
@keyframes pt-typing {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
  30% { transform: translateY(-3px); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .pt-spin, .pt-stream-caret, .pt-typing-dot { animation: none; }
  .pt-topic-action-pane, .pt-topic-search-pane { transition: none !important; }
}
.pt-row-actions { display: inline-flex; align-items: center; gap: 1px; flex-shrink: 0; opacity: 0; transition: opacity .12s; }
.pt-thread-row:hover > .pt-row-actions,
.pt-thread-row:focus-within > .pt-row-actions,
.pt-row-actions-open { opacity: 1; }
/* Message meta actions: reveal for keyboard focus too, never tab onto invisible controls */
.pt-msg-meta { opacity: 0; transition: opacity .12s; }
.pt-user-row:hover .pt-msg-meta,
.pt-user-row:focus-within .pt-msg-meta,
.pt-assistant-row:hover .pt-msg-meta,
.pt-assistant-row:focus-within .pt-msg-meta { opacity: 1; }
/* Visible brand focus ring for custom buttons and the role=button rows */
[data-testid="desktop-shell-agent-chat"] button:focus-visible,
[data-testid="desktop-shell-agent-chat"] [role="button"]:focus-visible,
.pt-delete-dialog button:focus-visible {
  outline: 2px solid rgba(107,91,214,.55);
  outline-offset: 1px;
}
`;

export function AgentChatPage({
  onOpenOrchestration,
  profileOpen,
  onOpenProfile,
  onCloseProfile,
}: {
  onOpenOrchestration: () => void;
  profileOpen: boolean;
  onOpenProfile: () => void;
  onCloseProfile: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const narrowRef = useRef(false);
  const timers = useRef<Set<number>>(new Set());
  const stopFlags = useRef<Set<string>>(new Set());
  // Reading-position contract: stay pinned to the bottom while content streams
  // or a gate resolves, but never yank the view when the user scrolls up.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const [ultraNarrow, setUltraNarrow] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  // Roster. Seed with the built-in Agent; created Agents join instantly and
  // are configured afterwards in the Profile Builder (reference-client parity).
  const [agents, setAgents] = useState<ChatAgent[]>(() => {
    const stored = loadStoredAgents();
    return stored.some((agent) => agent.id === BUILTIN_AGENT_ID)
      ? stored
      : [{
          id: BUILTIN_AGENT_ID,
          name: 'Agent',
          description: DEFAULT_AGENT_DESCRIPTION,
          avatar: INITIAL_AGENT_AVATAR,
          createdAt: Date.now(),
        }, ...stored];
  });
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const [activeAgentId, setActiveAgentId] = useState<string>(BUILTIN_AGENT_ID);
  const [profileTargetId, setProfileTargetId] = useState<string | null>(null); // which agent the profile surface edits
  const [profileSection, setProfileSection] = useState<'identity' | 'extensions'>('identity');
  // Reference-client parity: the expanded rail is always the Agent roster. Topics are
  // contextual to the selected Agent and keep their own sibling rail.
  const [agentQuery, setAgentQuery] = useState('');
  const [agentDeleteTarget, setAgentDeleteTarget] = useState<ChatAgent | null>(null);
  const agentSearchRef = useRef<HTMLInputElement>(null);
  const onOpenProfileRef = useRef(onOpenProfile);
  onOpenProfileRef.current = onOpenProfile;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const selectedTopicsRef = useRef<Record<string, string | null>>({});
  useLayoutEffect(() => {
    selectedTopicsRef.current[activeAgentId] = activeId;
  }, [activeAgentId, activeId]);
  const [query, setQuery] = useState('');
  const [defaultModel, setDefaultModel] = useState<ModelId>(loadPrototypeDefaultModel);
  const [modelProviders, setModelProviders] = useState<PrototypeChatModelProvider[]>(
    getEnabledPrototypeChatModelProviders,
  );
  const [newTopicModels, setNewTopicModels] = useState<Record<string, ModelId>>({});
  const [topicsOpen, setTopicsOpen] = useState(true);
  const topicsOpenRef = useRef(true);
  const topicsCompactRef = useRef(false);
  const desktopTopicsOpenRef = useRef(true);
  const topicsRailRef = useRef<HTMLElement>(null);
  const topicsSearchRef = useRef<HTMLInputElement>(null);
  const topicSearchButtonRef = useRef<HTMLButtonElement>(null);
  const topicsOpenerRef = useRef<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [topicSearchOpen, setTopicSearchOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [attachmentDrafts, setAttachmentDrafts] = useState<Record<string, File[]>>({});
  const [activityOpen, setActivityOpen] = useState<Set<string>>(new Set());
  const [conversationSearchOpen, setConversationSearchOpen] = useState(false);
  const [conversationSearchQuery, setConversationSearchQuery] = useState('');
  const [conversationSearchIndex, setConversationSearchIndex] = useState(0);
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  const [artifactToOpen, setArtifactToOpen] = useState<ArtifactRef | null>(null);
  const artifactsBtnRef = useRef<HTMLButtonElement>(null);
  const artifactOpenerRef = useRef<HTMLElement | null>(null);
  const [mobileTopicListOpen, setMobileTopicListOpen] = useState(false);
  const [mobileAgentPickerOpen, setMobileAgentPickerOpen] = useState(false);
  const mobileAgentPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileAgentDrawerRef = useRef<HTMLElement>(null);
  const mobileAgentCloseRef = useRef<HTMLButtonElement>(null);
  const [busyId, setBusyIdState] = useState<string | null>(null);
  // Synchronous mirror of busyId: state updates are batched, so a state-only
  // guard lets two Enter presses in the same tick both pass (double submit).
  // This ref is the idempotency lock, updated before scheduling a render.
  const busyIdRef = useRef<string | null>(null);
  const setBusyId = useCallback((v: string | null | ((b: string | null) => string | null)) => {
    // Admission and release happen synchronously; React only renders the projection.
    const next = typeof v === 'function' ? v(busyIdRef.current) : v;
    busyIdRef.current = next;
    setBusyIdState(next);
  }, []);
  // Idempotency for gate decisions: two clicks on Approve/Deny/ask options in
  // the same tick both read the old "pending" state, so the pending flag alone
  // cannot guard them. Resolved gate message ids live here synchronously;
  // the set is cleared whenever a new turn acquires the busy lock.
  const resolvedGateRef = useRef<Set<string>>(new Set());
  // Row management: inline rename and the two-step delete confirmation.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [topicSelectionMode, setTopicSelectionMode] = useState(false);
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<string>>(new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  // Review-only fault injection (?review=1 & agentError=<kind>). The selector
  // chooses what the NEXT turn fails as; it auto-clears after firing so Retry
  // demonstrates real recovery. Never rendered outside review mode.
  const reviewMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('review') === '1';
  const initialInjected = () => {
    if (!reviewMode) return null;
    const v = new URLSearchParams(window.location.search).get('agentError');
    return v && v in ERROR_COPY ? (v as ErrorKind) : null;
  };
  const [injectedError, setInjectedError] = useState<ErrorKind | null>(initialInjected);
  const setTopicsExpanded = useCallback((open: boolean) => {
    topicsOpenRef.current = open;
    setTopicsOpen(open);
    if (!topicsCompactRef.current) desktopTopicsOpenRef.current = open;
  }, []);

  useLayoutEffect(() => () => {
    timers.current.forEach((handle) => window.clearTimeout(handle));
    timers.current.clear();
  }, []);

  useEffect(() => subscribePrototypeDefaultModel(setDefaultModel), []);
  useEffect(() => subscribePrototypeChatModelAvailability((availability) => {
    setModelProviders(getEnabledPrototypeChatModelProviders(availability));
  }), []);

  // Each overlay owns its Escape handling at the layer that can also restore
  // focus (rename input, row menu, delete dialog, artifacts drawer, model
  // listbox). While the delete modal is portalled on top, the chat subtree is
  // inert so Tab/click cannot reach the layers beneath it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (deleteTargetId || batchDeleteOpen || agentDeleteTarget) root.setAttribute('inert', '');
    else root.removeAttribute('inert');
    return () => root.removeAttribute('inert');
  }, [deleteTargetId, batchDeleteOpen, agentDeleteTarget]);

  // Escape collapses the focused Topic rail, but never intercepts unrelated
  // work in the conversation or Profile surface.
  useLayoutEffect(() => {
    if (!topicsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteTargetId || batchDeleteOpen || agentDeleteTarget || rowMenuId || renamingId) return;
      if (!topicsRailRef.current?.contains(document.activeElement)) return;
      e.stopPropagation();
      setTopicsExpanded(false);
      setTimeout(() => {
        const opener = topicsOpenerRef.current;
        if (opener?.isConnected) opener.focus();
        else rootRef.current?.querySelector<HTMLElement>('[aria-label^="Expand Topics"]')?.focus();
        topicsOpenerRef.current = null;
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [topicsOpen, deleteTargetId, batchDeleteOpen, agentDeleteTarget, rowMenuId, renamingId, setTopicsExpanded]);

  // Opening the compact Topic rail hands focus to its title query.
  useLayoutEffect(() => {
    if (!topicsOpen || !topicsOpenerRef.current) return;
    (topicSearchOpen ? topicsSearchRef.current : topicSearchButtonRef.current)?.focus();
  }, [topicSearchOpen, topicsOpen]);

  const closeMobileAgentPicker = useCallback(() => {
    setMobileAgentPickerOpen(false);
    requestAnimationFrame(() => mobileAgentPickerTriggerRef.current?.focus());
  }, []);

  useLayoutEffect(() => {
    if (!mobileAgentPickerOpen) return;
    mobileAgentCloseRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeMobileAgentPicker();
        return;
      }
      if (event.key !== 'Tab' || !mobileAgentDrawerRef.current?.contains(document.activeElement)) return;
      const nodes = [...mobileAgentDrawerRef.current.querySelectorAll<HTMLElement>(
        'button, input, [href], [tabindex]:not([tabindex="-1"])',
      )].filter((node) => !node.hasAttribute('disabled') && node.getClientRects().length > 0);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeMobileAgentPicker, mobileAgentPickerOpen]);

  const activeAgent = agents.find((a) => a.id === activeAgentId) ?? agents[0];
  const active = threads.find((t) => t.id === activeId && t.agentId === activeAgent.id) ?? null;
  const newDraftKey = newTopicDraftKey(activeAgent.id);
  const composerValue = activeId ? drafts[activeId] ?? '' : drafts[newDraftKey] ?? '';
  const configuredModel = active?.model ?? newTopicModels[activeAgent.id] ?? defaultModel;
  const firstAvailableModel = modelProviders[0]?.models[0]?.id;
  const model = modelProviders.some((provider) =>
    provider.models.some((candidate) => candidate.id === configuredModel))
    ? configuredModel
    : firstAvailableModel ?? defaultModel;
  const conversationSearchResults = useMemo(() => {
    const normalized = conversationSearchQuery.trim().toLowerCase();
    if (!active || !normalized) return [];
    return active.messages.filter((message) => [
      message.text,
      ...(message.attachments?.map((attachment) => attachment.name) ?? []),
      message.artifact?.title ?? '',
      message.ask?.question ?? '',
      message.approval?.summary ?? '',
    ].join(' ').toLowerCase().includes(normalized));
  }, [active, conversationSearchQuery]);
  const conversationSearchTargetId = conversationSearchResults[conversationSearchIndex]?.id ?? null;

  useEffect(() => {
    setConversationSearchOpen(false);
    setConversationSearchQuery('');
    setConversationSearchIndex(0);
  }, [activeAgentId, activeId]);

  useEffect(() => {
    setConversationSearchIndex((current) =>
      conversationSearchResults.length === 0
        ? 0
        : Math.min(current, conversationSearchResults.length - 1));
  }, [conversationSearchResults.length]);

  useLayoutEffect(() => {
    if (!conversationSearchTargetId) return;
    stickToBottomRef.current = false;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-message-id="${conversationSearchTargetId}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [conversationSearchTargetId]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = (w: number) => {
      if (w <= 0) return;
      const next = w < 880;
      const was = narrowRef.current;
      narrowRef.current = next;
      setUltraNarrow(w < 560);
      if (next && was !== true) setRailOpen(false);
      const nextTopicsCompact = w < 1040;
      if (nextTopicsCompact !== topicsCompactRef.current) {
        if (nextTopicsCompact) {
          desktopTopicsOpenRef.current = topicsOpenRef.current;
          topicsOpenRef.current = false;
          setTopicsOpen(false);
        } else {
          topicsOpenRef.current = desktopTopicsOpenRef.current;
          setTopicsOpen(desktopTopicsOpenRef.current);
        }
        topicsCompactRef.current = nextTopicsCompact;
      }
    };
    sync(root.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => sync(e.contentRect.width));
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const onThreadScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // Opening or switching a conversation always starts pinned at the bottom.
  useLayoutEffect(() => {
    stickToBottomRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId]);

  // Follow streaming text, gate cards, and continuations only while pinned.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [active?.messages]);

  const patchThread = (id: string, fn: (t: Thread) => Thread) =>
    setThreads((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));

  const patchMessage = (tid: string, mid: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => ChatMessage)) =>
    patchThread(tid, (t) => ({
      ...t,
      messages: t.messages.map((m) => (m.id === mid ? (typeof patch === 'function' ? patch(m) : { ...m, ...patch }) : m)),
    }));

  const newChat = () => {
    setActiveId(null);
    setQuery('');
    setTopicSearchOpen(false);
    setTopicSelectionMode(false);
    setSelectedTopicIds(new Set());
    setMobileTopicListOpen(false);
    setNewTopicModels((previous) => {
      if (!(activeAgent.id in previous)) return previous;
      const next = { ...previous };
      delete next[activeAgent.id];
      return next;
    });
    setDrafts((d) => {
      if (!(newDraftKey in d)) return d;
      const n = { ...d };
      delete n[newDraftKey];
      return n;
    });
    setAttachmentDrafts((previous) => ({ ...previous, [newDraftKey]: [] }));
    setTimeout(() => {
      rootRef.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label^="Message "]')?.focus();
    }, 0);
  };

  const activateAgent = useCallback((id: string) => {
    if (id !== activeAgentId) {
      setActiveAgentId(id);
      const previousTopic = selectedTopicsRef.current[id];
      setActiveId(threads.some((thread) => thread.id === previousTopic && thread.agentId === id) ? previousTopic : null);
      setQuery('');
      setTopicSelectionMode(false);
      setSelectedTopicIds(new Set());
      setArtifactsOpen(false);
      setArtifactToOpen(null);
    }
  }, [activeAgentId, threads]);

  // A roster-row selection always opens that Agent's Chat. Profile is an
  // explicit row-menu action, matching the reference client instead of changing meaning
  // based on the surface that happened to be open.
  const pickAgent = (id: string) => {
    activateAgent(id);
    setProfileTargetId(null);
    if (profileOpen) onCloseProfile();
  };
  const returnToRunningTopic = () => {
    const running = threads.find((thread) => thread.id === busyId);
    if (!running) return;
    activateAgent(running.agentId);
    setActiveId(running.id);
  };

  const closeTopics = (restoreFocus = true) => {
    setTopicsExpanded(false);
    setRowMenuId(null);
    setRenamingId(null);
    if (!restoreFocus) {
      topicsOpenerRef.current = null;
      return;
    }
    setTimeout(() => {
      const opener = topicsOpenerRef.current;
      if (opener?.isConnected) opener.focus();
      else rootRef.current?.querySelector<HTMLElement>('[aria-label^="Expand Topics"]')?.focus();
      topicsOpenerRef.current = null;
    }, 0);
  };

  const openTopics = (opener: HTMLElement | null) => {
    topicsOpenerRef.current = opener;
    setQuery('');
    if (topicsCompactRef.current) setRailOpen(false);
    setTopicsExpanded(true);
    setTimeout(() => topicSearchButtonRef.current?.focus(), 0);
  };
  const openAgentRoster = () => {
    if (topicsCompactRef.current) setTopicsExpanded(false);
    setAgentQuery('');
    setRailOpen(true);
    setTimeout(() => agentSearchRef.current?.focus(), 0);
  };
  const toggleAgentRoster = () => {
    if (!railOpen && topicsCompactRef.current) setTopicsExpanded(false);
    setRailOpen((open) => !open);
  };

  // Create Local parity (reference client): the Agent is created INSTANTLY with an
  // auto-generated unique name, joins the roster, becomes active, and lands in
  // its Profile Builder workspace — no blocking "name it first" form. The
  // builder auto-saves; Back returns straight to the new Agent's chat.
  const createLocalAgent = () => {
    setProfileSection('identity');
    const id = uid('ag');
    const used = new Set(agents.map((a) => a.name));
    let name = 'New Agent';
    if (used.has(name)) {
      for (let n = 2; ; n += 1) {
        if (!used.has(`New Agent ${n}`)) { name = `New Agent ${n}`; break; }
      }
    }
    const agent: ChatAgent = {
      id,
      name,
      description: DEFAULT_AGENT_DESCRIPTION,
      avatar: INITIAL_AGENT_AVATAR,
      createdAt: Date.now(),
    };
    setAgents((prev) => {
      const next = [...prev, agent];
      persistAgents(next);
      return next;
    });
    setActiveAgentId(id);
    setActiveId(null);
    setQuery('');
    setDrafts((d) => {
      if (!(newTopicDraftKey(id) in d)) return d;
      const next = { ...d };
      delete next[newTopicDraftKey(id)];
      return next;
    });
    setProfileTargetId(id);
    topicsOpenerRef.current = null;
    setMobileAgentPickerOpen(false);
    setMobileTopicListOpen(false);
    // Route toggle opens the Builder on the same keep-alive mount.
    onOpenProfileRef.current();
  };

  const openOrchestration = () => {
    topicsOpenerRef.current = null;
    setMobileAgentPickerOpen(false);
    onOpenOrchestration();
  };

  const openAgentProfile = (id: string) => {
    // The reference client opens the builder with the Agent as context, and Back returns
    // to that Agent's chat — activate it here so the two surfaces agree.
    setProfileTargetId(id);
    setProfileSection('identity');
    activateAgent(id);
    setQuery('');
    topicsOpenerRef.current = null;
    setMobileAgentPickerOpen(false);
    setMobileTopicListOpen(false);
    onOpenProfile();
  };

  // Builder identity autosave sink. An empty name is a transient edit state —
  // keep the roster name; description mirrors the field verbatim. The update
  // bails out when nothing changed so the debounced autosave cannot loop.
  const saveAgentProfile = (id: string, patch: { name: string; description: string }) => {
    setAgents((prev) => {
      let changed = false;
      const next = prev.map((a) => {
        if (a.id !== id) return a;
        const name = patch.name.length > 0 ? patch.name : a.name;
        if (name === a.name && patch.description === a.description) return a;
        changed = true;
        return { ...a, name, description: patch.description };
      });
      if (!changed) return prev;
      persistAgents(next);
      return next;
    });
  };

  const saveAgentAvatar = (id: string, avatar: PrototypeAgentAvatar) => {
    setAgents((previous) => {
      const next = previous.map((agent) => agent.id === id ? { ...agent, avatar } : agent);
      persistAgents(next);
      return next;
    });
  };

  // Reference-client parity: non-default agents are deletable. Removal is a full
  // closed loop — roster record + order + per-agent profile/extension keys +
  // in-memory threads/drafts/timers all go away; the active surface falls
  // back to the built-in Agent. The built-in Agent has no delete affordance.
  const requestAgentDelete = (agent: ChatAgent) => {
    if (agent.id === BUILTIN_AGENT_ID) return;
    setAgentDeleteTarget(agent);
  };
  const cancelAgentDelete = () => {
    const id = agentDeleteTarget?.id;
    setAgentDeleteTarget(null);
    // Restore focus to the row's persistent "⋯" trigger after React commits
    // the dialog/inert teardown (a plain setTimeout races that commit).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      rootRef.current?.querySelector<HTMLElement>(`[data-agent-actions-for="${id}"]`)?.focus();
    }));
  };
  const confirmAgentDelete = () => {
    const target = agentDeleteTarget;
    if (!target || target.id === BUILTIN_AGENT_ID) return;
    delete selectedTopicsRef.current[target.id];
    setAttachmentDrafts((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) =>
      key !== newTopicDraftKey(target.id) && !threads.some((thread) => thread.id === key && thread.agentId === target.id),
    )));
    for (const t of threads.filter((x) => x.agentId === target.id)) {
      stopFlags.current.add(t.id);
      setBusyId((runningId) => runningId === t.id ? null : runningId);
    }
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[newTopicDraftKey(target.id)];
      for (const key of Object.keys(next)) {
        const thread = threads.find((x) => x.id === key);
        if (thread?.agentId === target.id) delete next[key];
      }
      return next;
    });
    setThreads((prev) => {
      const next = prev.filter((t) => t.agentId !== target.id);
      return next;
    });
    setAgents((prev) => {
      const next = prev.filter((a) => a.id !== target.id);
      persistAgents(next);
      return next;
    });
    try {
      localStorage.removeItem(agentStoreKey(target.id));
      localStorage.removeItem(`agent-profile-${target.id}`);
      localStorage.removeItem(`agent-profile-${target.id}-extensions`);
    } catch { /* storage unavailable */ }
    if (activeAgentId === target.id) {
      setActiveAgentId(BUILTIN_AGENT_ID);
      setActiveId(null);
    }
    if (profileTargetId === target.id) setProfileTargetId(null);
    setAgentDeleteTarget(null);
    setRowMenuId(null);
    setTimeout(() => agentSearchRef.current?.focus(), 0);
  };

  const openThread = (id: string) => {
    setActiveId(id);
    setRowMenuId(null);
    setRenamingId(null);
    setMobileTopicListOpen(false);
  };

  // Settings owns the global default. The composer owns only a Topic-local
  // override; a not-yet-created Topic keeps that override in its new slot.
  const setActiveModel = (nextValue: ModelId) => {
    const next = normalizePrototypeChatModelId(nextValue);
    if (active) {
      patchThread(active.id, (thread) => ({ ...thread, model: next }));
      return;
    }
    setNewTopicModels((previous) => ({ ...previous, [activeAgent.id]: next }));
  };

  const startTurn = (
    raw: string,
    useModel: ModelId,
    existingThreadId?: string,
    options?: {
      attachments?: Array<{ name: string; size: number; type: string }>;
      preserveDraft?: boolean;
    },
  ) => {
    const text = raw.trim();
    if (!text) return;
    let tid = existingThreadId ?? activeId;
    const attachmentKey = tid ?? newDraftKey;
    const submittedAttachments = options?.attachments
      ?? (attachmentDrafts[attachmentKey] ?? []).map(({ name, size, type }) => ({ name, size, type }));

    // Queue is outside the approved prototype scope. Keep the draft intact
    // while another turn owns execution instead of fabricating parallel work.
    if (busyIdRef.current) return;
    const nowTs = Date.now();
    const userMsg: ChatMessage = {
      id: uid('u'), role: 'user', text, ts: nowTs, phase: 'done',
      attachments: submittedAttachments,
    };
    if (!options?.preserveDraft) {
      setAttachmentDrafts((previous) => ({ ...previous, [attachmentKey]: [] }));
    }
    const assistantId = uid('a');
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', text: '', ts: nowTs, phase: 'thinking', steps: [] };

    if (!tid) {
      tid = uid('th');
      const t: Thread = {
        id: tid,
        agentId: activeAgent.id,
        title: 'Generating title…',
        titleState: 'generating',
        createdAt: nowTs,
        model: useModel,
        messages: [userMsg, assistantMsg],
      };
      setThreads((prev) => [t, ...prev]);
      setNewTopicModels((previous) => {
        if (!(activeAgent.id in previous)) return previous;
        const next = { ...previous };
        delete next[activeAgent.id];
        return next;
      });
      setDrafts((d) => {
        const n = { ...d, [tid!]: options?.preserveDraft ? raw : '' };
        delete n[newDraftKey];
        return n;
      });
      const createdThreadId = tid;
      window.setTimeout(() => {
        setThreads((previous) => previous.map((thread) => (
          thread.id === createdThreadId
            ? { ...thread, title: autoTitle(text), titleState: 'ready' }
            : thread
        )));
      }, 850);
    } else {
      patchThread(tid, (t) => ({
        ...t,
        title: t.messages.length === 0 ? 'Generating title…' : t.title,
        titleState: t.messages.length === 0 ? 'generating' : t.titleState,
        model: useModel,
        messages: [...t.messages, userMsg, assistantMsg],
      }));
      if (!options?.preserveDraft) setDrafts((d) => ({ ...d, [tid!]: '' }));
    }
    setActiveId(tid);
    setMobileTopicListOpen(false);
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root?.querySelector('[role="dialog"]')) {
        root?.querySelector<HTMLTextAreaElement>('textarea[aria-label^="Message "]')?.focus({ preventScroll: true });
      }
    });
    busyIdRef.current = tid; // acquire before batched state flushes, so the next keypress sees it
    resolvedGateRef.current.clear(); // new turn: its gate message ids are fresh
    setBusyId(tid);
    setActivityOpen((s) => new Set(s).add(assistantId));
    stopFlags.current.delete(tid);
    runTurn(tid, assistantId, text, useModel);
  };

  // Mark a failed turn: one typed error, busy cleared. Pre-acceptance failures
  // (config/auth/rate/network) give the draft back; an interruption happens
  // after partial content already streamed, so the draft stays sent.
  const failTurn = (tid: string, mid: string, kind: ErrorKind, steps: ActivityStep[], restoreDraft?: string) => {
    patchMessage(tid, mid, (m) => ({
      ...m,
      steps,
      turnError: { kind, retryAfterMs: kind === 'rate-limit' ? 20_000 : undefined },
      phase: 'error',
    }));
    if (restoreDraft) setDrafts((d) => ({ ...d, [tid]: restoreDraft }));
    setBusyId((b) => (b === tid ? null : b));
    setActivityOpen((s) => {
      const n = new Set(s);
      n.delete(mid);
      return n;
    });
  };

  const scheduleTurn = (tid: string, ms: number, fn: () => void) => {
    const handle = window.setTimeout(() => {
      timers.current.delete(handle);
      if (!stopFlags.current.has(tid)) fn();
    }, ms);
    timers.current.add(handle);
  };

  const runTurn = (tid: string, mid: string, prompt: string, useModel: ModelId) => {
    const spec = answerFor(prompt, useModel);
    const injected = injectedError;
    // Thinking phase, then gate / injected fault / normal stream.
    scheduleTurn(tid, 520, () => {
      const waiting = Boolean(spec.ask || spec.approval);
      patchMessage(tid, mid, (m) => ({
        ...m,
        steps: spec.steps,
        ...(spec.ask ? { ask: { ...spec.ask, status: 'pending' as const } } : {}),
        ...(spec.approval ? { approval: { ...spec.approval, status: 'pending' as const } } : {}),
        phase: waiting ? 'waiting' : 'streaming',
      }));
      if (waiting || !injected) {
        if (!waiting) streamSpec(tid, mid, spec, spec.text);
        return;
      }
      // One-shot review fault: consume the injection so Retry can recover.
      setInjectedError(null);
      if (injected === 'interrupted') {
        const partial = spec.text.slice(0, Math.min(150, Math.floor(spec.text.length * 0.45)));
        streamAnswer(tid, mid, partial, () => failTurn(tid, mid, 'interrupted', spec.steps));
        return;
      }
      const delay = injected === 'rate-limit' ? 400 : 700;
      scheduleTurn(tid, delay, () => {
        failTurn(tid, mid, injected, spec.steps, prompt);
      });
    });
  };

  // Stream a finished body of text and close the turn per the spec.
  const streamSpec = (tid: string, mid: string, spec: TurnSpec, full: string) => {
    streamAnswer(tid, mid, full, () => {
      patchMessage(tid, mid, {
        phase: 'done',
        tokens: spec.tokens,
        ...(spec.artifact ? { artifact: { ...spec.artifact, content: full } } : {}),
        followUps: spec.followUps,
      });
      setBusyId((b) => (b === tid ? null : b));
      setActivityOpen((s) => {
        const n = new Set(s);
        n.delete(mid); // collapse activity once the answer is complete
        return n;
      });
    });
  };

  // Resolve an ask card, echo the choice as a user turn, and stream the
  // continuation as its own assistant message.
  const resolveAsk = (askMid: string, choice: string) => {
    const tid = activeId;
    if (!tid || busyId !== tid) return;
    const t = threads.find((x) => x.id === tid);
    if (!t) return;
    const idx = t.messages.findIndex((m) => m.id === askMid);
    const askMsg = idx >= 0 ? t.messages[idx] : null;
    if (!askMsg?.ask || askMsg.ask.status !== 'pending') return;
    if (resolvedGateRef.current.has(askMid)) return;
    resolvedGateRef.current.add(askMid);
    const origin = [...t.messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
    const prompt = origin?.text ?? '';
    const spec = answerFor(prompt, t.model);
    patchMessage(tid, askMid, (m) => ({
      ...m,
      ask: { ...m.ask!, status: 'answered', answer: choice },
      phase: 'done',
      tokens: 24,
    }));
    setActivityOpen((s) => {
      const n = new Set(s);
      n.delete(askMid); // the resolved gate card is the record; collapse its activity
      return n;
    });
    launchAskContinuation(tid, prompt, choice, spec, true);
  };

  const launchAskContinuation = (tid: string, prompt: string, choice: string, spec: TurnSpec, appendBubble: boolean) => {
    const nowTs = Date.now();
    const newId = uid('a');
    const contMsg: ChatMessage = { id: newId, role: 'assistant', text: '', ts: nowTs, phase: 'thinking', steps: [], fromAsk: true };
    const extra: ChatMessage[] = appendBubble
      ? [{ id: uid('u'), role: 'user', text: choice, ts: nowTs, phase: 'done' }, contMsg]
      : [contMsg];
    patchThread(tid, (x) => ({ ...x, messages: [...x.messages, ...extra] }));
    setDrafts((d) => ({ ...d, [tid]: '' }));
    busyIdRef.current = tid;
    setBusyId(tid);
    setActivityOpen((s) => new Set(s).add(newId));
    stopFlags.current.delete(tid);
    scheduleTurn(tid, 460, () => {
      const steps: ActivityStep[] = [{ id: 'th', kind: 'thought', label: `Used your answer: ${choice}` }];
      const contSpec: TurnSpec = { ...spec, artifact: undefined, text: continuationText(prompt, choice) };
      patchMessage(tid, newId, { steps, phase: 'streaming' });
      streamSpec(tid, newId, contSpec, contSpec.text);
    });
  };

  // Approval is the user's explicit decision for one gated command.
  const resolveApproval = (mid: string, approved: boolean) => {
    const tid = activeId;
    if (!tid || busyId !== tid) return;
    const t = threads.find((x) => x.id === tid);
    if (!t) return;
    const idx = t.messages.findIndex((m) => m.id === mid);
    const msg = idx >= 0 ? t.messages[idx] : null;
    if (!msg?.approval || msg.approval.status !== 'pending') return;
    if (resolvedGateRef.current.has(mid)) return;
    resolvedGateRef.current.add(mid);
    const origin = [...t.messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
    const spec = answerFor(origin?.text ?? '', t.model);
    stopFlags.current.delete(tid);
    patchMessage(tid, mid, (m) => ({
      ...m,
      approval: { ...m.approval!, status: approved ? 'approved' : 'denied' },
      phase: 'done',
    }));
    setActivityOpen((current) => {
      const next = new Set(current);
      next.delete(mid);
      return next;
    });

    const systemMessage: ChatMessage = {
      id: uid('s'),
      role: 'system',
      text: `${approved ? 'Approved' : 'Rejected'} the execution request for tool ${msg.approval.toolName}. The Agent will continue.`,
      ts: Date.now(),
      phase: 'done',
    };
    const continuationId = uid('a');
    const continuation: ChatMessage = {
      id: continuationId,
      role: 'assistant',
      text: '',
      ts: Date.now(),
      phase: 'thinking',
      steps: [],
    };
    patchThread(tid, (thread) => ({
      ...thread,
      messages: [...thread.messages, systemMessage, continuation],
    }));
    setActivityOpen((current) => new Set(current).add(continuationId));
    scheduleTurn(tid, 460, () => {
      const continuationSpec: TurnSpec = {
        ...spec,
        approval: undefined,
        artifact: approved ? spec.artifact : undefined,
        followUps: approved ? spec.followUps : [],
        text: approved ? spec.text : (spec.deniedText ?? 'The tool was not executed and no workspace state changed.'),
      };
      patchMessage(tid, continuationId, {
        steps: [{
          id: uid('approval'),
          kind: 'thought',
          label: approved ? 'Continued after host approval' : 'Continued after the request was rejected',
        }],
        phase: 'streaming',
      });
      streamSpec(tid, continuationId, continuationSpec, continuationSpec.text);
    });
  };

  const streamAnswer = (tid: string, mid: string, full: string, done: () => void) => {
    let i = 0;
    const tick = () => {
      if (stopFlags.current.has(tid)) return;
      i = Math.min(full.length, i + Math.max(3, Math.round(Math.random() * 8)));
      patchMessage(tid, mid, { text: full.slice(0, i) });
      if (i < full.length) {
        scheduleTurn(tid, 16, tick);
      } else {
        done();
      }
    };
    tick();
  };

  const stop = () => {
    const tid = activeId;
    if (!tid || busyId !== tid) return;
    stopFlags.current.add(tid);
    timers.current.forEach((h) => window.clearTimeout(h));
    timers.current.clear();
    const current = threads.find((t) => t.id === tid);
    const live = current
      ? [...current.messages].reverse().find((m) => m.role === 'assistant' && (m.phase === 'thinking' || m.phase === 'streaming' || m.phase === 'waiting'))
      : null;
    if (live) {
      patchMessage(tid, live.id, (m) => ({
        ...m,
        phase: 'error',
        turnError: { kind: 'cancelled' },
        ...(m.ask?.status === 'pending' ? { ask: { ...m.ask, status: 'cancelled' } } : {}),
        ...(m.approval?.status === 'pending' ? { approval: { ...m.approval, status: 'cancelled' } } : {}),
      }));
      setActivityOpen((s) => {
        const n = new Set(s);
        n.delete(live.id);
        return n;
      });
    }
    setBusyId(null);
  };

  const regenerate = (mid: string) => {
    if (!active || busyIdRef.current) return;
    const idx = active.messages.findIndex((m) => m.id === mid);
    if (idx < 0) return;
    const target = active.messages[idx];
    const lastUser = [...active.messages.slice(0, idx)].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    // Acquire only once a replay is certain: same-tick double click cannot run twice.
    busyIdRef.current = active.id;
    resolvedGateRef.current.clear();
    // Continuation answers replay the same choice against the original ask.
    if (target.fromAsk) {
      const askMsg = [...active.messages.slice(0, idx)].reverse().find((m) => m.role === 'assistant' && m.ask);
      const askIdx = askMsg ? active.messages.indexOf(askMsg) : -1;
      const origin = askIdx >= 0 ? [...active.messages.slice(0, askIdx)].reverse().find((m) => m.role === 'user') : null;
      const prompt = origin?.text ?? '';
      patchThread(active.id, (t) => ({ ...t, messages: t.messages.filter((m) => m.id !== mid) }));
      stopFlags.current.delete(active.id);
      launchAskContinuation(active.id, prompt, lastUser.text, answerFor(prompt, active.model), false);
      return;
    }
    const useModel = active.model;
    // Remove the old assistant answer and replay the same prompt.
    patchThread(active.id, (t) => ({ ...t, messages: t.messages.filter((m) => m.id !== mid) }));
    // A draft restored by a failed turn is consumed by the explicit Retry;
    // an unrelated draft typed later must survive regenerating an old turn.
    setDrafts((d) => (d[active.id] === lastUser.text ? { ...d, [active.id]: '' } : d));
    const nowTs = Date.now();
    const assistantId = uid('a');
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', text: '', ts: nowTs, phase: 'thinking', steps: [] };
    patchThread(active.id, (t) => ({ ...t, messages: [...t.messages, assistantMsg] }));
    setBusyId(active.id);
    setActivityOpen((s) => new Set(s).add(assistantId));
    stopFlags.current.delete(active.id);
    runTurn(active.id, assistantId, lastUser.text, useModel);
  };

  // Edit-and-resend: keep the messages before the edited prompt, replace the
  // prompt, drop everything after it, and run a fresh turn. Mirrors the
  // del-and-regenerate semantics rather than appending a parallel answer.
  const editPrompt = (mid: string, next: string) => {
    if (!active || busyIdRef.current) return;
    const idx = active.messages.findIndex((m) => m.id === mid);
    if (idx < 0 || active.messages[idx].role !== 'user') return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === active.messages[idx].text) return;
    const nowTs = Date.now();
    const assistantId = uid('a');
    const userMsg: ChatMessage = { id: uid('u'), role: 'user', text: trimmed, ts: nowTs, phase: 'done' };
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', text: '', ts: nowTs, phase: 'thinking', steps: [] };
    patchThread(active.id, (t) => ({
      ...t,
      messages: [...t.messages.slice(0, idx), userMsg, assistantMsg],
    }));
    busyIdRef.current = active.id;
    resolvedGateRef.current.clear();
    setBusyId(active.id);
    setActivityOpen((s) => new Set(s).add(assistantId));
    stopFlags.current.delete(active.id);
    runTurn(active.id, assistantId, trimmed, active.model);
  };

  const togglePin = (id: string) =>
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)));

  const startRename = (t: Thread) => {
    setRowMenuId(null);
    setRenameValue(t.title);
    setRenamingId(t.id);
  };

  const commitRename = () => {
    const id = renamingId;
    const title = renameValue.trim();
    if (id && title) {
      setThreads((prev) => prev.map((t) => (t.id === id && t.title !== title ? { ...t, title } : t)));
    }
    setRenamingId(null);
  };

  const addQuickReplyToInput = (text: string) => {
    if (!activeId) return;
    setDrafts((previous) => {
      const current = previous[activeId] ?? '';
      const separator = current && !/\s$/.test(current) ? ' ' : '';
      return { ...previous, [activeId]: `${current}${separator}${text}` };
    });
  };

  const sendQuickReply = (text: string) => {
    if (!activeId || !active) return;
    startTurn(text, active.model, activeId, { attachments: [], preserveDraft: true });
  };

  // Cancel/esc returns focus to the row actions trigger that opened the modal;
  // confirm deletes the row, so there is nothing to restore to.
  const cancelDelete = () => {
    const id = deleteTargetId;
    setDeleteTargetId(null);
    // Task, not animation frame: React commits the close (removing the inert
    // root + portal) before this runs, so the trigger is focusable again.
    if (id) setTimeout(() => document.querySelector<HTMLElement>(`[data-menu-for="${id}"]`)?.focus(), 0);
  };

  const confirmDelete = () => {
    const id = deleteTargetId;
    if (!id) return;
    setAttachmentDrafts((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    stopFlags.current.add(id);
    setBusyId((runningId) => runningId === id ? null : runningId);
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (activeId === id) setActiveId(null);
    setSelectedTopicIds((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    setDeleteTargetId(null);
    setRowMenuId(null);
  };

  const toggleTopicSelectionMode = () => {
    setTopicSelectionMode((current) => {
      if (current) setSelectedTopicIds(new Set());
      return !current;
    });
    setRowMenuId(null);
    setRenamingId(null);
  };

  const toggleTopicSelected = (id: string) => {
    setSelectedTopicIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const cancelBatchDelete = () => {
    setBatchDeleteOpen(false);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      topicsRailRef.current?.querySelector<HTMLElement>('[aria-label="Delete selected topics"]')?.focus();
    }));
  };

  const confirmBatchDelete = () => {
    const ids = new Set(selectedTopicIds);
    if (ids.size === 0) return;
    setAttachmentDrafts((previous) => Object.fromEntries(
      Object.entries(previous).filter(([id]) => !ids.has(id)),
    ));
    setDrafts((previous) => Object.fromEntries(
      Object.entries(previous).filter(([id]) => !ids.has(id)),
    ));
    ids.forEach((id) => stopFlags.current.add(id));
    setBusyId((runningId) => runningId && ids.has(runningId) ? null : runningId);
    setThreads((previous) => previous.filter((thread) => !ids.has(thread.id)));
    if (activeId && ids.has(activeId)) setActiveId(null);
    setBatchDeleteOpen(false);
    setSelectedTopicIds(new Set());
    setTopicSelectionMode(false);
    setRowMenuId(null);
    setRenamingId(null);
    requestAnimationFrame(() => {
      topicsRailRef.current?.querySelector<HTMLElement>('[aria-label="Select topics"]')?.focus();
    });
  };

  const toggleActivity = (mid: string) =>
    setActivityOpen((s) => {
      const n = new Set(s);
      if (n.has(mid)) n.delete(mid); else n.add(mid);
      return n;
    });

  const slashCommands = listAgentSlashCommands(activeAgent.id);
  const agentThreads = threads.filter((t) => t.agentId === activeAgent.id);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return agentThreads;
    return agentThreads.filter((thread) => thread.title.toLowerCase().includes(normalizedQuery));
  }, [agentThreads, query]);
  const groups = buildGroups(filtered);
  const artifacts = active ? collectArtifacts(active) : [];
  // While the Agent waits on a clarification, the composer answers the
  // card instead of opening a parallel turn; Stop moves to the card itself.
  const liveMessage = active
    ? [...active.messages].reverse().find((m) => m.role === 'assistant' && m.phase === 'waiting')
    : null;
  const waitingAsk = liveMessage?.ask?.status === 'pending';
  // The profile surface edits whichever Agent was opened. Model ownership is
  // intentionally absent here: Settings owns the default and Topic owns any
  // composer override.
  const profileSource = agents.find((a) => a.id === (profileTargetId ?? activeAgent.id)) ?? activeAgent;
  const profileAgent: ProfileAgent = {
    id: profileSource.id,
    name: profileSource.name || '',
    avatar: T.primary,
    description: profileSource.description,
    model: '',
    provider: 'Station',
    pinned: true,
    workspacePath: '/Workspace',
    temperature: 0.7,
  };
  const handleProfileBack = () => {
    // Creation already happened; Back simply returns to the Agent's chat.
    setProfileTargetId(null);
    onCloseProfile();
  };
  // Debounced autosave sink from the Builder (see AgentProfile).
  const handleProfileIdentity = (name: string, description: string) => {
    saveAgentProfile(profileSource.id, { name, description });
  };

  return (
    <div ref={rootRef} data-testid="desktop-shell-agent-chat" style={S.root}>
      <style>{AGENT_CHAT_CSS}</style>
      {/* Reference-client topology, Peers visual identity: the Agent roster remains
          module-owned; Chat adds a sibling Topic rail, while Profile does not. */}
      <aside
        data-expanded={railOpen}
        style={{
          ...S.rail,
          display: ultraNarrow ? 'none' : 'flex',
          width: railOpen ? 230 : 48,
          padding: '12px 0 54px',
          transition: 'width .16s ease',
        }}
        aria-label="My Agents"
      >
        <AgentRosterRail
          expanded={railOpen}
          agents={agents}
          activeAgentId={activeAgent.id}
          query={agentQuery}
          onQuery={setAgentQuery}
          searchRef={agentSearchRef}
          onExpandSearch={openAgentRoster}
          onCreateLocal={createLocalAgent}
          onCreateOrchestrator={openOrchestration}
          onPick={pickAgent}
          onEdit={openAgentProfile}
          onDelete={requestAgentDelete}
        />
        <PanelToggleDock
          side="left"
          open={railOpen}
          title={railOpen ? 'Collapse My Agents' : 'Expand My Agents'}
          onClick={toggleAgentRoster}
        />
      </aside>

      {!profileOpen && (
        <aside
          ref={topicsRailRef}
          data-expanded={topicsOpen}
          style={{
            ...S.topicsRail(topicsOpen, ultraNarrow),
            ...(ultraNarrow
              ? {
                  display: mobileTopicListOpen ? 'flex' : 'none',
                  width: '100%',
                  paddingBottom: 52,
                }
              : {}),
          }}
          aria-label={`${activeAgent.name} topics`}
        >
          {topicsOpen || ultraNarrow ? (
            <>
              <div style={ultraNarrow ? S.mobileTopicsHead : S.topicsHead}>
                {ultraNarrow ? (
                  <>
                    <button
                      ref={mobileAgentPickerTriggerRef}
                      type="button"
                      style={S.mobileTopicSwitch}
                      aria-label="Switch Agent"
                      onClick={() => setMobileAgentPickerOpen(true)}
                    >
                      <List size={16} />
                    </button>
                    <strong style={S.mobileTopicAgent}>
                      <span style={S.topicAgentName}>{activeAgent.name}</span>
                    </strong>
                    <span aria-hidden style={{ width: 40, flexShrink: 0 }} />
                  </>
                ) : (
                  <strong style={S.topicAgentName}>{activeAgent.name}</strong>
                )}
              </div>
              <div style={S.topicRailActions}>
                <div
                  className="pt-topic-action-pane"
                  aria-hidden={topicSearchOpen}
                  style={S.topicActionPane(topicSearchOpen)}
                >
                  <button type="button" tabIndex={topicSearchOpen ? -1 : 0} style={S.topicRailAction} onClick={newChat} aria-label="Start new topic" title="Start new topic">
                    <MessageSquarePlus size={15} />
                  </button>
                  <button type="button" tabIndex={topicSearchOpen ? -1 : 0} style={S.topicRailAction} onClick={() => openAgentProfile(activeAgent.id)} aria-label="Agent Profile" title="Agent Profile">
                    <Settings size={15} />
                  </button>
                  <button
                    ref={topicSearchButtonRef}
                    type="button"
                    tabIndex={topicSearchOpen ? -1 : 0}
                    style={S.topicRailAction}
                    aria-label="Search"
                    title="Search"
                    aria-expanded={topicSearchOpen}
                    onClick={() => {
                      setTopicSearchOpen(true);
                      requestAnimationFrame(() => topicsSearchRef.current?.focus());
                    }}
                  >
                    <Search size={15} />
                  </button>
                </div>
                <div
                  className="pt-topic-search-pane"
                  aria-hidden={!topicSearchOpen}
                  style={S.topicSearchPane(topicSearchOpen)}
                >
                  <div style={S.topicInlineSearch}>
                    <Search size={13} color={T.textQuaternary} />
                    <input
                      ref={topicsSearchRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search topic titles"
                      style={S.searchInput}
                      aria-label="Search topic titles"
                      tabIndex={topicSearchOpen ? 0 : -1}
                      onKeyDown={(event) => {
                        if (event.key !== 'Escape') return;
                        event.stopPropagation();
                        setQuery('');
                        setTopicSearchOpen(false);
                        requestAnimationFrame(() => topicSearchButtonRef.current?.focus());
                      }}
                    />
                    <button
                      type="button"
                      tabIndex={topicSearchOpen ? 0 : -1}
                      style={S.topicSearchCancel}
                      aria-label="Cancel topic search"
                      title="Cancel search"
                      onClick={() => {
                        setQuery('');
                        setTopicSearchOpen(false);
                        requestAnimationFrame(() => topicSearchButtonRef.current?.focus());
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </div>
              <div style={S.topicListToolbar}>
                <strong style={S.topicsTitle}>
                  Topics <span style={S.topicCountInline}>{agentThreads.length}</span>
                </strong>
                <span style={S.topicListTools}>
                  {topicSelectionMode && selectedTopicIds.size > 0 ? (
                    <span aria-live="polite" style={S.topicSelectedCount}>{selectedTopicIds.size}</span>
                  ) : null}
                  <button
                    type="button"
                    style={S.topicListTool(topicSelectionMode)}
                    aria-label={topicSelectionMode ? 'Cancel topic selection' : 'Select topics'}
                    title={topicSelectionMode ? 'Cancel selection' : 'Select topics'}
                    aria-pressed={topicSelectionMode}
                    onClick={toggleTopicSelectionMode}
                  >
                    {topicSelectionMode ? <X size={14} /> : <ListChecks size={14} />}
                  </button>
                  <button
                    type="button"
                    style={S.topicListTool(false, selectedTopicIds.size === 0)}
                    aria-label="Delete selected topics"
                    title="Delete selected topics"
                    disabled={selectedTopicIds.size === 0}
                    onClick={() => setBatchDeleteOpen(true)}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
              <div style={S.topicsScroll}>
                {groups.length === 0 && (
                  <div style={S.railEmpty}>{query ? 'No matching topics.' : 'No topics yet.'}</div>
                )}
                {groups.map((g) => (
                  <div key={g.key}>
                    <button type="button" style={S.groupHeader} onClick={() => setCollapsed((p) => {
                      const n = new Set(p);
                      if (n.has(g.key)) n.delete(g.key); else n.add(g.key);
                      return n;
                    })}>
                      {collapsed.has(g.key) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      {g.label}
                    </button>
                    {!collapsed.has(g.key) && g.threads.map((t) => (
                      <ThreadRow
                        key={t.id}
                        t={t}
                        active={t.id === activeId}
                        status={topicStatus(t, busyId)}
                        renaming={renamingId === t.id}
                        renameValue={renameValue}
                        menuOpen={rowMenuId === t.id}
                        selectionMode={topicSelectionMode}
                        selected={selectedTopicIds.has(t.id)}
                        onOpen={() => openThread(t.id)}
                        onToggleSelected={() => toggleTopicSelected(t.id)}
                        onTogglePin={() => {
                          togglePin(t.id);
                          setRowMenuId(null);
                        }}
                        onStartRename={() => startRename(t)}
                        onRenameChange={setRenameValue}
                        onCommitRename={commitRename}
                        onCancelRename={() => setRenamingId(null)}
                        onToggleMenu={() => setRowMenuId((cur) => (cur === t.id ? null : t.id))}
                        onRequestDelete={() => { setRowMenuId(null); setDeleteTargetId(t.id); }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={S.topicsCollapsed}>
              <button type="button" style={S.collapsedTopicAction} onClick={newChat} aria-label="Start new topic" title="Start new topic">
                <MessageSquarePlus size={16} />
              </button>
              <button
                type="button"
                style={S.collapsedTopicAction}
                onClick={(event) => openTopics(event.currentTarget)}
                aria-label={`Expand Topics, ${agentThreads.length} topics`}
                title={`Topics · ${agentThreads.length}`}
              >
                <List size={16} />
                <span style={S.collapsedTopicCount}>{agentThreads.length}</span>
              </button>
            </div>
          )}
          {!ultraNarrow && (
            <PanelToggleDock
              side="left"
              open={topicsOpen}
              title={topicsOpen ? 'Collapse Topics' : 'Expand Topics'}
              onClick={() => {
                if (topicsOpen) closeTopics(false);
                else openTopics(null);
              }}
            />
          )}
        </aside>
      )}

      {/* Main */}
      {profileOpen ? (
        <section aria-label="Agent profile" style={{ ...S.main, display: ultraNarrow && mobileAgentPickerOpen ? 'none' : 'flex' }}>
          <AgentProfile
            key={profileAgent.id}
            agent={profileAgent}
            onBack={handleProfileBack}
            onIdentityChange={handleProfileIdentity}
            canPersist={() => agentsRef.current.some((agent) => agent.id === profileAgent.id)}
            initialSection={profileSection}
            avatar={profileSource.avatar}
            onAvatarChange={(avatar) => saveAgentAvatar(profileSource.id, avatar)}
          />
        </section>
      ) : (
        <section aria-label="Agent conversation" style={{ ...S.main, display: ultraNarrow && mobileTopicListOpen ? 'none' : 'flex' }}>
          <header style={S.threadHeader}>
            {ultraNarrow ? (
              <button
                type="button"
                style={S.headerGhost}
                title="Topics"
                onClick={() => setMobileTopicListOpen(true)}
                aria-label="Back to topics"
              >
                <ChevronRight size={17} style={{ transform: 'rotate(180deg)' }} />
              </button>
            ) : null}
            <strong style={S.threadTopicTitle}>{active?.title ?? 'New topic'}</strong>
            <ConversationSearchControl
              open={conversationSearchOpen}
              query={conversationSearchQuery}
              resultCount={conversationSearchResults.length}
              resultIndex={conversationSearchIndex}
              onOpen={() => setConversationSearchOpen(true)}
              onClose={() => {
                setConversationSearchOpen(false);
                setConversationSearchQuery('');
                setConversationSearchIndex(0);
              }}
              onQuery={(value) => {
                setConversationSearchQuery(value);
                setConversationSearchIndex(0);
              }}
              onMove={(delta) => {
                if (conversationSearchResults.length === 0) return;
                setConversationSearchIndex((current) =>
                  (current + delta + conversationSearchResults.length) % conversationSearchResults.length);
              }}
            />
            {active && (
              <button
                ref={artifactsBtnRef}
                type="button"
                style={S.headerGhost}
                title="Artifacts and references"
                aria-label="Artifacts and references"
                aria-haspopup="dialog"
                aria-expanded={artifactsOpen}
                onClick={() => setArtifactsOpen(true)}
              >
                <FileText size={15} />
                {artifacts.length > 0 && <span style={S.countBadge}>{artifacts.length}</span>}
              </button>
            )}
          </header>

          {reviewMode && !profileOpen && (
            <ReviewFaultBar value={injectedError} onChange={setInjectedError} />
          )}
          {!active ? (
            <Welcome agent={activeAgent} onStart={(p) => startTurn(p, model)} />
          ) : (
            <>
              <div ref={scrollRef} onScroll={onThreadScroll} style={S.scroll} className="pt-agent-scroll">
                <div style={S.railContent}>
                  {active.messages.map((m, i) => (
                    <MessageRow
                      key={m.id}
                      message={m}
                      searchMatch={m.id === conversationSearchTargetId}
                      expanded={activityOpen.has(m.id)}
                      isLast={i === active.messages.length - 1}
                      busy={busyId === active.id}
                      onToggleActivity={() => toggleActivity(m.id)}
                      onRegenerate={() => regenerate(m.id)}
                      onFollowUp={sendQuickReply}
                      onInsertFollowUp={addQuickReplyToInput}
                      onAskAnswer={(choice) => resolveAsk(m.id, choice)}
                      onApprovalDecision={(approved) => resolveApproval(m.id, approved)}
                      onCancelAsk={stop}
                      onOpenSettings={onOpenProfile}
                      onEditPrompt={editPrompt}
                      onOpenArtifact={(artifact, opener) => {
                        artifactOpenerRef.current = opener;
                        setArtifactToOpen(artifact);
                        setArtifactsOpen(true);
                      }}
                    />
                  ))}
                </div>
              </div>

              <Composer
                key={active.id}
                onReturnToRunningTopic={busyId && busyId !== active.id ? returnToRunningTopic : undefined}
                onOpenExtensions={() => { openAgentProfile(activeAgent.id); setProfileSection('extensions'); }}
                attachments={attachmentDrafts[active.id] ?? []}
                onAttachmentsChange={(files) => setAttachmentDrafts((previous) => ({ ...previous, [active.id]: files }))}
                value={composerValue}
                model={model}
                modelProviders={modelProviders}
                onModel={(id) => setActiveModel(id)}
                busy={busyId === active.id}
                askActive={waitingAsk}
                agentName={activeAgent.name}
                slashItems={slashCommands}
                usedTokens={active.messages.reduce((sum, m) => sum + (m.tokens ?? 0), 0)}
                onChange={(v) => activeId && setDrafts((d) => ({ ...d, [activeId]: v }))}
                onSend={() => startTurn(composerValue, model, active.id)}
                onStop={stop}
              />
            </>
          )}

          {!active && (
            <Composer
              key={newDraftKey}
              onReturnToRunningTopic={busyId ? returnToRunningTopic : undefined}
              onOpenExtensions={() => { openAgentProfile(activeAgent.id); setProfileSection('extensions'); }}
              attachments={attachmentDrafts[newDraftKey] ?? []}
              onAttachmentsChange={(files) => setAttachmentDrafts((previous) => ({ ...previous, [newDraftKey]: files }))}
              value={drafts[newDraftKey] ?? ''}
              model={model}
              modelProviders={modelProviders}
              onModel={(id) => setActiveModel(id)}
              busy={false}
              agentName={activeAgent.name}
              slashItems={slashCommands}
              usedTokens={0}
              onChange={(v) => setDrafts((d) => ({ ...d, [newDraftKey]: v }))}
              onSend={() => startTurn(drafts[newDraftKey] ?? '', model)}
              onStop={() => undefined}
            />
          )}

          {artifactsOpen && (
            <ArtifactsDrawer
              artifacts={artifacts}
              initialArtifact={artifactToOpen}
              onClose={() => { setArtifactsOpen(false); setArtifactToOpen(null); }}
              restoreFocus={() => {
                const opener = artifactOpenerRef.current;
                if (opener?.isConnected) opener.focus();
                else artifactsBtnRef.current?.focus();
                artifactOpenerRef.current = null;
              }}
            />
          )}
        </section>
      )}

      {deleteTargetId && (
        <DeleteChatDialog
          title={threads.find((t) => t.id === deleteTargetId)?.title ?? ''}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        />
      )}
      {batchDeleteOpen && (
        <DeleteChatDialog
          count={selectedTopicIds.size}
          onCancel={cancelBatchDelete}
          onConfirm={confirmBatchDelete}
        />
      )}
      {agentDeleteTarget && (
        <DeleteAgentDialog
          name={agentDeleteTarget.name}
          onCancel={cancelAgentDelete}
          onConfirm={confirmAgentDelete}
        />
      )}
      {ultraNarrow && mobileAgentPickerOpen && (
        <div style={S.mobileDrawerLayer}>
          <button
            type="button"
            aria-label="Close Agent picker"
            tabIndex={-1}
            style={S.mobileDrawerScrim}
            onClick={closeMobileAgentPicker}
          />
          <aside
            ref={mobileAgentDrawerRef}
            style={S.mobileAgentDrawer}
            role="dialog"
            aria-modal="true"
            aria-label="Switch Agent"
          >
            <div style={S.mobileDrawerHeader}>
              <button
                ref={mobileAgentCloseRef}
                type="button"
                style={S.mobileDrawerClose}
                aria-label="Close Agent picker"
                onClick={closeMobileAgentPicker}
              >
                <X size={16} />
              </button>
              <strong>Switch Agent</strong>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <AgentRosterRail
                expanded
                agents={agents}
                activeAgentId={activeAgent.id}
                query={agentQuery}
                onQuery={setAgentQuery}
                searchRef={agentSearchRef}
                onExpandSearch={() => undefined}
                onCreateLocal={createLocalAgent}
                onCreateOrchestrator={openOrchestration}
                onPick={(id) => {
                  pickAgent(id);
                  setMobileAgentPickerOpen(false);
                  setMobileTopicListOpen(true);
                }}
                onEdit={openAgentProfile}
                onDelete={requestAgentDelete}
              />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// AgentCreateMenu — roster header "+" (reference-client My Agents parity).
// Create Local: instant create + Profile Builder; Create Orchestrator: the
// orchestration canvas. Import / From Hub are cut — no contract behind them.
// ─────────────────────────────────────────────────────────────────────────
function useMenuPosition(
  open: boolean,
  trigger: React.RefObject<HTMLButtonElement | null>,
  menu: React.RefObject<HTMLDivElement | null>,
  onDismiss: () => void,
) {
  const [position, setPosition] = useState({ top: 0, left: 0, fontFamily: 'inherit' });
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const popup = menu.current.getBoundingClientRect();
    const below = anchor.bottom + 4;
    setPosition({
      top: Math.max(8, below + popup.height <= window.innerHeight - 8 ? below : anchor.top - popup.height - 4),
      left: Math.max(8, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 8)),
      fontFamily: getComputedStyle(trigger.current).fontFamily,
    });
    menu.current.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const dismiss = () => dismissRef.current();
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      const current = trigger.current?.getBoundingClientRect();
      // scrollIntoView may dispatch after a click has already opened the
      // menu. Only a moved source invalidates the captured anchor.
      if (!current || Math.abs(current.top - anchor.top) > 1 || Math.abs(current.left - anchor.left) > 1) dismiss();
    };
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, trigger, menu]);
  return { ...position, position: 'fixed' as const, right: 'auto', maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' as const };
}

function AgentCreateMenu({ triggerStyle, triggerIcon, onLocal, onOrchestrator, onOpenChange }: {
  triggerStyle: React.CSSProperties;
  triggerIcon: React.ReactNode;
  onLocal: () => void;
  onOrchestrator: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const setOpenBoth = useCallback((v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  }, [onOpenChange]);

  const closeMenu = () => {
    setOpenBoth(false);
    triggerRef.current?.focus({ preventScroll: true });
  };
  const menuPosition = useMenuPosition(open, triggerRef, menuRef, closeMenu);

  useLayoutEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenBoth(false);
        triggerRef.current?.focus();
        return;
      }
      const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      const idx = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[idx <= 0 ? items.length - 1 : idx - 1]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); setOpenBoth(false); triggerRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setOpenBoth]);

  // Actions navigate/unmount the trigger surface, so do not hand focus back
  // here — the destination surface owns focus next.
  const run = (fn: () => void) => () => { setOpenBoth(false); fn(); };

  return (
    <span style={S.createMenuWrap}>
      <button
        ref={triggerRef}
        type="button"
        style={triggerStyle}
        title="Create Agent"
        aria-label="Create Agent"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenBoth(!open)}
      >
        {triggerIcon}
      </button>
      {open && createPortal(
        <>
          <div aria-hidden style={S.pickerMenuScrim} onClick={closeMenu} />
          <div ref={menuRef} role="menu" aria-label="Create Agent" style={{ ...S.createMenu, ...menuPosition }}>
            <button type="button" role="menuitem" className="pt-picker-menu-item" style={S.pickerMenuItem} onClick={run(onLocal)}>
              <UserPlus size={14} />
              <span>Create Local</span>
            </button>
            <button type="button" role="menuitem" className="pt-picker-menu-item" style={S.pickerMenuItem} onClick={run(onOrchestrator)}>
              <Share2 size={14} />
              <span>Create Orchestrator</span>
            </button>
          </div>
        </>, document.body,
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Agent roster — the expanded rail's permanent information architecture.
// Rows are a list, never chips: initial tile + name + description; the trailing
// "⋯" opens an anchored reference-client-style action menu. Start New Topic and Search
// stay in the selected Agent's Topic rail, so row actions never cause hidden
// cross-surface jumps. The built-in Agent is pinned and cannot be deleted.
// ─────────────────────────────────────────────────────────────────────────

function AgentRosterRail({
  expanded,
  agents,
  activeAgentId,
  query,
  onQuery,
  searchRef,
  onExpandSearch,
  onCreateLocal,
  onCreateOrchestrator,
  onPick,
  onEdit,
  onDelete,
}: {
  expanded: boolean;
  agents: ChatAgent[];
  activeAgentId: string;
  query: string;
  onQuery: (v: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onExpandSearch: () => void;
  onCreateLocal: () => void;
  onCreateOrchestrator: () => void;
  onPick: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (agent: ChatAgent) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? agents.filter((a) => (a.name || '').toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
    : agents;
  const sections = [
    { key: 'pinned', label: 'Pinned', agents: filtered.filter((a) => a.id === BUILTIN_AGENT_ID) },
    { key: 'all', label: 'All Agents', agents: filtered.filter((a) => a.id !== BUILTIN_AGENT_ID) },
  ].filter((section) => !q || section.agents.length > 0);

  return (
    <div style={{ ...S.pickerShell, padding: expanded ? '0 8px' : 0 }}>
      <style>{`
        .pt-picker-row:focus-visible { outline: 2px solid ${T.primary}; outline-offset: -2px; }
        .pt-picker-more:hover, .pt-picker-more:focus-visible { background: ${T.fillTertiary} !important; }
        .pt-picker-menu-item:hover, .pt-picker-menu-item:focus-visible { background: ${T.fillTertiary}; outline: none; }
        .pt-picker-menu-item-danger:hover, .pt-picker-menu-item-danger:focus-visible { background: rgba(207,19,34,0.08); outline: none; }
      `}</style>
      <div style={{ ...S.pickerHead, justifyContent: expanded ? 'space-between' : 'center' }}>
        {expanded && <strong style={S.pickerTitle}>My Agents</strong>}
        <AgentCreateMenu
          triggerStyle={S.pickerCreate}
          triggerIcon={<Plus size={15} />}
          onLocal={onCreateLocal}
          onOrchestrator={onCreateOrchestrator}
          onOpenChange={(open) => { if (open) setOpenMenuId(null); }}
        />
      </div>
      <div style={{ height: 40, minHeight: 40, padding: '0 2px 8px', boxSizing: 'border-box', display: 'flex', justifyContent: 'center' }}>
        {expanded ? <div style={{ ...S.searchBox, width: '100%', boxSizing: 'border-box' }}>
          <Search size={13} color={T.textQuaternary} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search agents"
            style={S.searchInput}
            aria-label="Search agents"
          />
        </div> : (
          <button type="button" style={{ ...S.iconBtn, height: 32 }} aria-label="Search Agents" title="Search Agents" onClick={onExpandSearch}>
            <Search size={16} />
          </button>
        )}
      </div>
      <div style={S.pickerScroll} role="group" aria-label="My Agents">
        {filtered.length === 0 && (
          <div style={S.railEmpty}>{q ? 'No matching Agents.' : 'No Agents yet. Create one to get started.'}</div>
        )}
        {sections.map((section) => (
          <div key={section.key}>
            <div style={{ ...S.rosterGroupLabel, visibility: expanded ? 'visible' : 'hidden' }} aria-hidden={!expanded}>{section.label}</div>
            {section.agents.map((a) => (
              <AgentPickerRow
                key={a.id}
                expanded={expanded}
                agent={a}
                selected={a.id === activeAgentId}
                menuOpen={openMenuId === a.id}
                onToggleMenu={(open) => setOpenMenuId(open ? a.id : null)}
                onPick={() => { setOpenMenuId(null); onPick(a.id); }}
                onEdit={() => onEdit(a.id)}
                onDelete={() => onDelete(a)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// One Agent row: body click switches to Chat; the trailing "⋯" owns only
// Agent-level actions. Delete exists only for non-built-in Agents.
function AgentPickerRow({
  expanded,
  agent,
  selected,
  menuOpen,
  onToggleMenu,
  onPick,
  onEdit,
  onDelete,
}: {
  expanded: boolean;
  agent: ChatAgent;
  selected: boolean;
  menuOpen: boolean;
  onToggleMenu: (open: boolean) => void;
  onPick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const builtIn = agent.id === BUILTIN_AGENT_ID;
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => {
    onToggleMenu(false);
    moreRef.current?.focus({ preventScroll: true });
  }, [onToggleMenu]);
  const menuPosition = useMenuPosition(menuOpen, moreRef, menuRef, closeMenu);

  const menuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); return; }
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[idx <= 0 ? items.length - 1 : idx - 1]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); closeMenu(); }
  };

  const run = (action: (e: React.MouseEvent) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleMenu(false);
    action(e);
  };

  return (
    <div
      className="pt-picker-row"
      title={!expanded ? agent.name || 'Unnamed Agent' : undefined}
      style={{ ...S.pickerRow(selected), ...(expanded ? {} : { padding: '7px 0', justifyContent: 'center' }) }}
    >
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        aria-label={agent.name || 'Unnamed Agent'}
        style={{ ...S.pickerRowMain, ...(expanded ? {} : { flex: 'none' }) }}
        onClick={onPick}
      >
        <PrototypeAgentAvatarView
          avatar={agent.avatar}
          name={agent.name}
          size={34}
          radius={9}
          selected={selected}
        />
        <span style={{ ...S.pickerRowText, display: expanded ? 'flex' : 'none' }}>
          <span style={S.pickerName}>{agent.name || 'Unnamed Agent'}</span>
          <span style={S.pickerDesc}>{agent.description}</span>
        </span>
      </button>
      <span style={{ ...S.pickerActionWrap, display: expanded ? 'inline-flex' : 'none' }}>
        <button
          ref={moreRef}
          type="button"
          className="pt-picker-more"
          style={S.pickerMoreBtn(menuOpen)}
          title="More actions"
          aria-label={`More actions for ${agent.name || 'Agent'}`}
          data-agent-actions-for={agent.id}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => { e.stopPropagation(); onToggleMenu(!menuOpen); }}
        >
          <MoreHorizontal size={15} />
        </button>
        {menuOpen && createPortal(
          <>
            <div
              aria-hidden
              style={S.pickerMenuScrim}
              onClick={(e) => { e.stopPropagation(); closeMenu(); }}
            />
            <div
              ref={menuRef}
              role="menu"
              aria-label={`${agent.name || 'Agent'} actions`}
              style={{ ...S.pickerMenu, ...menuPosition }}
              onKeyDown={menuKeyDown}
            >
              <button type="button" role="menuitem" className="pt-picker-menu-item" style={S.pickerMenuItem} onClick={run(() => onEdit())}>
                <Settings size={14} />
                <span>Agent Profile</span>
              </button>
              {!builtIn && (
                <button
                  type="button"
                  role="menuitem"
                  className="pt-picker-menu-item pt-picker-menu-item-danger"
                  data-agent-menu-for={agent.id}
                  style={S.pickerMenuItemDanger}
                  onClick={run(() => onDelete())}
                >
                  <Trash2 size={14} />
                  <span>Delete</span>
                </button>
              )}
            </div>
          </>, document.body,
        )}
      </span>
    </div>
  );
}

// Centered destructive confirmation for agent removal (same portal/focus
// contract as DeleteChatDialog): the built-in Agent never reaches this dialog.
function DeleteAgentDialog({ name, onCancel, onConfirm }: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!nodes || nodes.length === 0) return;
      const list = [...nodes].filter((n) => !n.hasAttribute('disabled'));
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return createPortal(
    <div className="pt-delete-dialog" style={S.dialogScrim} onClick={onCancel}>
      <div
        ref={dialogRef}
        style={S.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pt-delete-agent-title"
        aria-describedby="pt-delete-agent-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={S.dialogHead}>
          <span style={S.dialogIcon}><Trash2 size={16} color="#cf1322" /></span>
          <strong id="pt-delete-agent-title" style={S.dialogTitle}>Delete this Agent?</strong>
        </div>
        <p id="pt-delete-agent-desc" style={S.dialogBody}>
          “{name}” and its chats will be permanently deleted.
        </p>
        <div style={S.dialogActions}>
          <button ref={cancelRef} type="button" style={S.dialogCancel} onClick={onCancel}>Cancel</button>
          <button type="button" style={S.dialogConfirm} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Centered destructive confirmation (benchmark: reference-client topic delete modal).
// Portalled to body; the chat subtree is inert while it is open. Focus starts
// on the safe action, Tab cycles inside, Esc/scrim cancels and returns focus
// to the opener (handled by onCancel).
function DeleteChatDialog({ title, count, onCancel, onConfirm }: {
  title?: string;
  count?: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const batch = typeof count === 'number';
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return; }
      if (e.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!nodes || nodes.length === 0) return;
      const list = [...nodes].filter((n) => !n.hasAttribute('disabled'));
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return createPortal(
    <div className="pt-delete-dialog" style={S.dialogScrim} onClick={onCancel}>
      <div
        ref={dialogRef}
        style={S.dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pt-delete-chat-title"
        aria-describedby="pt-delete-chat-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={S.dialogHead}>
          <span style={S.dialogIcon}><Trash2 size={16} color="#cf1322" /></span>
          <strong id="pt-delete-chat-title" style={S.dialogTitle}>
            {batch ? `Delete ${count} topics?` : 'Delete this chat?'}
          </strong>
        </div>
        <p id="pt-delete-chat-desc" style={S.dialogBody}>
          {batch
            ? 'The selected topics and all their messages will be permanently deleted.'
            : `“${title ?? ''}” and all its messages will be permanently deleted.`}
        </p>
        <div style={S.dialogActions}>
          <button ref={cancelRef} type="button" style={S.dialogCancel} onClick={onCancel}>Cancel</button>
          <button type="button" style={S.dialogConfirm} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Welcome (no active thread)
// ─────────────────────────────────────────────────────────────────────────

type TopicStatus = 'running' | 'error' | null;

function topicStatus(thread: Thread, busyId: string | null): TopicStatus {
  if (busyId === thread.id) return 'running';
  const latest = [...thread.messages].reverse().find((message) => message.role === 'assistant');
  if (latest?.phase === 'error') return 'error';
  return null;
}

function ThreadRow({ t, active, status, renaming, renameValue, menuOpen, selectionMode, selected, onOpen, onToggleSelected, onTogglePin,
  onStartRename, onRenameChange, onCommitRename, onCancelRename,
  onToggleMenu, onRequestDelete,
}: {
  t: Thread;
  active: boolean;
  status: TopicStatus;
  renaming: boolean;
  renameValue: string;
  menuOpen: boolean;
  selectionMode: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelected: () => void;
  onTogglePin: () => void;
  onStartRename: () => void;
  onRenameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onToggleMenu: () => void;
  onRequestDelete: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Esc must discard, but unmounting the input fires blur first — without this
  // guard the blur-commit would persist the title the user cancelled.
  const discardBlurRef = useRef(false);
  const closeMenu = () => {
    onToggleMenu();
    menuBtnRef.current?.focus({ preventScroll: true });
  };
  const menuPosition = useMenuPosition(menuOpen, menuBtnRef, menuRef, closeMenu);
  useLayoutEffect(() => {
    if (renaming) {
      discardBlurRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(inputRef.current.value.length, inputRef.current.value.length);
    }
  }, [renaming]);
  // Menu keyboard model: Arrow keys/Home/End move a one-deep roving cursor;
  // Esc closes and restores the trigger. Tab is not trapped — one Tab leaves
  // the menu in DOM order.
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const list = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
      if (list.length === 0) return;
      const idx = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeMenu();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        closeMenu();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'Home') {
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : (idx + 1) % list.length;
        list[next]?.focus();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'End') {
        e.preventDefault();
        const next = e.key === 'End' ? list.length - 1 : (idx <= 0 ? list.length - 1 : idx - 1);
        list[next]?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen, onToggleMenu]);

  if (renaming) {
    return (
      <div style={{ ...S.threadRow(true), background: T.white, padding: '0 8px' }}>
        {t.pinned ? <Pin size={11} style={{ flexShrink: 0 }} fill={T.primary} color={T.primary} /> : <span style={{ width: 11, flexShrink: 0 }} />}
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={() => { if (!discardBlurRef.current) onCommitRename(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommitRename();
              setTimeout(() => menuBtnRef.current?.focus(), 0);
            }
            if (e.key === 'Escape') {
              e.stopPropagation();
              discardBlurRef.current = true;
              onCancelRename();
              setTimeout(() => menuBtnRef.current?.focus(), 0);
            }
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label="Chat title"
          style={S.renameInput}
          maxLength={120}
        />
      </div>
    );
  }

  return (
    <div className="pt-thread-row" style={S.threadRow(active)}>
      <button
        type="button"
        style={S.threadRowMain}
        onClick={selectionMode ? onToggleSelected : onOpen}
        role={selectionMode ? 'checkbox' : undefined}
        aria-checked={selectionMode ? selected : undefined}
        aria-current={!selectionMode && active ? 'true' : undefined}
        aria-label={selectionMode ? `Select ${t.title}` : t.title}
      >
        {selectionMode ? (
          <span style={S.topicCheckbox(selected)} aria-hidden>
            {selected ? <Check size={11} /> : null}
          </span>
        ) : (
          <span style={S.topicStatusSlot}>
            {status === 'running' && <Loader2 className="pt-spin" size={12} aria-label="Topic running" />}
            {status === 'error' && <TriangleAlert size={12} color={T.danger} aria-label="Topic error" />}
          </span>
        )}
        <span style={S.threadTitle}>{t.title}</span>
        {t.pinned && <Pin size={11} style={{ flexShrink: 0 }} fill={T.textQuaternary} color={T.textQuaternary} aria-label="Pinned topic" />}
      </button>
      {!selectionMode && <span className={menuOpen ? 'pt-row-actions pt-row-actions-open' : 'pt-row-actions'} style={S.rowActions}>
        <button
          ref={menuBtnRef}
          type="button"
          style={S.rowActionBtn}
          title="Chat actions"
          aria-label="Chat actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-menu-for={t.id}
          onClick={(e) => { e.stopPropagation(); onToggleMenu(); }}
        >
          <MoreHorizontal size={14} color={T.textSecondary} />
        </button>
      </span>}
      {!selectionMode && menuOpen && createPortal(
        <>
          <button type="button" aria-hidden tabIndex={-1} style={S.menuScrim} onClick={(e) => { e.stopPropagation(); closeMenu(); }} />
          <div ref={menuRef} role="menu" aria-label="Chat actions" style={{ ...S.rowMenu, ...menuPosition }} onClick={(e) => e.stopPropagation()}>
            <button type="button" role="menuitem" style={S.rowMenuItem} onClick={onTogglePin}>
              <Pin size={13} color={T.textSecondary} /> {t.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button type="button" role="menuitem" style={S.rowMenuItem} onClick={onStartRename}>
              <Pencil size={13} color={T.textSecondary} /> Edit
            </button>
            <button type="button" role="menuitem" style={S.rowMenuItemDanger} onClick={onRequestDelete}>
              <Trash2 size={13} color={T.danger} /> Delete
            </button>
          </div>
        </>, document.body,
      )}
    </div>
  );
}

function ConversationSearchControl({
  open,
  query,
  resultCount,
  resultIndex,
  onOpen,
  onClose,
  onQuery,
  onMove,
}: {
  open: boolean;
  query: string;
  resultCount: number;
  resultIndex: number;
  onOpen: () => void;
  onClose: () => void;
  onQuery: (value: string) => void;
  onMove: (delta: number) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  const close = () => {
    onClose();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        style={S.headerGhost}
        aria-label="Search conversation"
        title="Search conversation"
        onClick={onOpen}
      >
        <Search size={15} />
      </button>
    );
  }

  return (
    <div role="search" aria-label="Search conversation" style={S.conversationSearch}>
      <Search size={13} color={T.textQuaternary} />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            onMove(event.shiftKey ? -1 : 1);
          }
        }}
        placeholder="Search this conversation"
        aria-label="Search this conversation"
        style={S.conversationSearchInput}
      />
      <span role="status" aria-label="Conversation search results" style={S.conversationSearchCount}>
        {resultCount === 0 ? '0 / 0' : `${resultIndex + 1} / ${resultCount}`}
      </span>
      <button
        type="button"
        style={S.conversationSearchAction}
        aria-label="Previous match"
        title="Previous match"
        disabled={resultCount === 0}
        onClick={() => onMove(-1)}
      >
        <ChevronDown size={13} style={{ transform: 'rotate(180deg)' }} />
      </button>
      <button
        type="button"
        style={S.conversationSearchAction}
        aria-label="Next match"
        title="Next match"
        disabled={resultCount === 0}
        onClick={() => onMove(1)}
      >
        <ChevronDown size={13} />
      </button>
      <button
        type="button"
        style={S.conversationSearchAction}
        aria-label="Close conversation search"
        title="Close search"
        onClick={close}
      >
        <X size={14} />
      </button>
    </div>
  );
}

function Welcome({ agent, onStart }: { agent: ChatAgent; onStart: (p: string) => void }) {
  return (
    <div style={S.welcomeWrap}>
      <div style={S.welcome}>
        <h1 style={S.welcomeTitle}>{agent.name}</h1>
        <p style={S.welcomeSubtitle}>
          {agent.description}
        </p>
        <div style={S.starterGrid}>
          {STARTERS.map((s) => {
            const Icon = s.icon;
            return (
              <button key={s.prompt} type="button" style={S.starter} onClick={() => onStart(s.prompt)}>
                <Icon size={15} color={T.textTertiary} />
                <span>{s.prompt}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────────

function MessageRow({
  message, searchMatch, expanded, isLast, busy, onToggleActivity, onRegenerate, onFollowUp, onInsertFollowUp, onAskAnswer, onApprovalDecision, onCancelAsk, onOpenSettings, onEditPrompt, onOpenArtifact,
}: {
  message: ChatMessage;
  searchMatch: boolean;
  expanded: boolean;
  isLast: boolean;
  busy: boolean;
  onToggleActivity: () => void;
  onRegenerate: () => void;
  onFollowUp: (text: string) => void;
  onInsertFollowUp: (text: string) => void;
  onAskAnswer: (choice: string) => void;
  onApprovalDecision: (approved: boolean) => void;
  onCancelAsk: () => void;
  onOpenSettings: () => void;
  onEditPrompt: (mid: string, next: string) => void;
  onOpenArtifact: (artifact: ArtifactRef, opener: HTMLElement) => void;
}) {
  // Inline edit-and-resend (reference-client-aligned): replacing a sent prompt
  // truncates the thread there and re-runs from the edited message.
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.text);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const userRowRef = useRef<HTMLDivElement>(null);
  const cancelEdit = () => {
    setEditing(false);
    requestAnimationFrame(() => userRowRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Edit and resend"]')?.focus());
  };
  useLayoutEffect(() => {
    if (editing) {
      setEditValue(message.text);
      editRef.current?.focus();
      editRef.current?.setSelectionRange(editRef.current.value.length, editRef.current.value.length);
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const commitEdit = () => {
    const next = editValue.trim();
    if (next && next !== message.text && !busy) onEditPrompt(message.id, next);
    setEditing(false);
  };

  if (message.role === 'system') {
    return (
      <div
        data-message-id={message.id}
        data-conversation-search-match={searchMatch ? 'true' : undefined}
        style={{ ...S.systemRow, ...(searchMatch ? S.conversationSearchMatch : {}) }}
        role="status"
      >
        <span style={S.systemLabel}>Agent</span>
        <span>{message.text}</span>
        <span style={S.systemTime}>{formatTime(message.ts)}</span>
      </div>
    );
  }

  if (message.role === 'user') {
    if (editing) {
      return (
        <div
          ref={userRowRef}
          data-message-id={message.id}
          data-conversation-search-match={searchMatch ? 'true' : undefined}
          style={{ ...S.userRow, ...(searchMatch ? S.conversationSearchMatch : {}) }}
          className="pt-user-row"
        >
          <div style={S.userEdit}>
            <textarea
              ref={editRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              rows={Math.min(10, Math.max(2, editValue.split('\n').length))}
              style={S.userEditTextarea}
              aria-label="Edit message"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitEdit(); }
              }}
            />
            <div style={S.userEditActions}>
              <button type="button" style={S.editCancel} onClick={cancelEdit}>Cancel</button>
              {(() => {
                const disabled = busy || !editValue.trim() || editValue.trim() === message.text;
                return (
                  <button
                    type="button"
                    style={{ ...S.editSave, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}
                    onClick={commitEdit}
                    disabled={disabled}
                  >
                    Save &amp; resend
                  </button>
                );
              })()}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div
        ref={userRowRef}
        data-message-id={message.id}
        data-conversation-search-match={searchMatch ? 'true' : undefined}
        style={{ ...S.userRow, ...(searchMatch ? S.conversationSearchMatch : {}) }}
        className="pt-user-row"
      >
        <div style={S.userBubble}>
          {message.text}
          {Boolean(message.attachments?.length) && (
            <div aria-label="Message attachments" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {message.attachments?.map((file, index) => (
                <span key={`${file.name}-${index}`} style={S.attachChip}>
                  <Paperclip size={12} /><span>{file.name}</span>
                  <span style={{ color: T.textTertiary }}>{Math.ceil(file.size / 1024)} KB</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div style={S.userMeta} className="pt-msg-meta">
          <span>{formatTime(message.ts)}</span>
          <RowIcon title="Copy" onClick={() => navigator.clipboard?.writeText(message.text)}><Copy size={12} /></RowIcon>
          {!busy && <RowIcon title="Edit and resend" onClick={() => setEditing(true)}><Pencil size={12} /></RowIcon>}
        </div>
      </div>
    );
  }

  const stepCount = message.steps?.length ?? 0;
  const thoughts = (message.steps ?? []).filter((s) => s.kind === 'thought').length;
  const commands = (message.steps ?? []).filter((s) => s.kind === 'command');
  const thinking = message.phase === 'thinking';
  const streaming = message.phase === 'streaming';
  const errored = message.phase === 'error';
  const done = message.phase === 'done';
  const showSummary = stepCount > 0 && (done || streaming || errored);

  return (
    <div
      data-message-id={message.id}
      data-conversation-search-match={searchMatch ? 'true' : undefined}
      style={{ ...S.assistantRow, ...(searchMatch ? S.conversationSearchMatch : {}) }}
      className="pt-assistant-row"
    >
      {showSummary ? (
        <button type="button" style={S.activityToggle} onClick={onToggleActivity} aria-expanded={expanded}>
          {streaming ? <Loader2 size={12} className="pt-spin" color={T.primary} /> : <ChevronRight size={12} color={T.textTertiary} style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }} />}
          <span>
            {thoughts > 0 ? `${thoughts} thought${thoughts > 1 ? 's' : ''}` : ''}
            {thoughts > 0 && commands.length > 0 ? ' · ' : ''}
            {commands.length > 0 ? `${commands.length} command${commands.length > 1 ? 's' : ''}` : ''}
          </span>
        </button>
      ) : null}

      {expanded && message.phase !== 'waiting' && message.steps && message.steps.length > 0 && (
        <div style={S.activityList}>
          {message.steps.map((s) => (
            <div key={s.id} style={S.activityItem}>
              {s.kind === 'command'
                ? <TerminalSquare size={13} color={T.textTertiary} style={{ flexShrink: 0, marginTop: 2 }} />
                : <Sparkles size={13} color={T.textTertiary} style={{ flexShrink: 0, marginTop: 2 }} />}
              <span style={S.activityLabel}>{s.label}</span>
              {s.command && <code style={S.mono}>{s.command}</code>}
            </div>
          ))}
        </div>
      )}

      {message.ask && <AskCardView card={message.ask} onAnswer={onAskAnswer} onCancel={onCancelAsk} />}
      {message.approval && <ApprovalCardView card={message.approval} onDecision={onApprovalDecision} />}

      {thinking && (
        <div style={S.typing} aria-label="Agent is thinking">
          {[0, 0.16, 0.32].map((d) => <span key={d} className="pt-typing-dot" style={{ animationDelay: `${d}s` }} />)}
        </div>
      )}

      {message.text && (
        <div style={S.answer}>
          {renderRich(message.text)}
          {streaming && <span className="pt-stream-caret" aria-hidden />}
        </div>
      )}

      {errored && message.turnError && (
        <TurnErrorView error={message.turnError} onRetry={onRegenerate} onOpenSettings={onOpenSettings} />
      )}
      {message.artifact && <ArtifactCard artifact={message.artifact} onOpen={onOpenArtifact} />}

      {done && message.followUps && message.followUps.length > 0 && (
        <div style={S.followWrap}>
          <span style={S.followLabel}>You may also ask</span>
          <div style={S.followRow}>
            {message.followUps.map((f) => (
              <QuickReplyItem
                key={f}
                text={f}
                onInsert={() => onInsertFollowUp(f)}
                onSend={() => onFollowUp(f)}
              />
            ))}
          </div>
        </div>
      )}

      {done && (
        <div style={S.assistantMeta} className="pt-msg-meta">
          <span>{formatTime(message.ts)}{message.tokens ? ` · ${formatTokens(message.tokens)} tokens` : ''}</span>
          <RowIcon title="Copy" onClick={() => navigator.clipboard?.writeText(message.text)}><Copy size={12} /></RowIcon>
          {isLast && !busy && <RowIcon title="Regenerate" onClick={onRegenerate}><RotateCcw size={12} /></RowIcon>}
        </div>
      )}
    </div>
  );
}

function QuickReplyItem({ text, onInsert, onSend }: {
  text: string;
  onInsert: () => void;
  onSend: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="pt-follow-pill" style={S.quickReply(expanded)}>
      <button
        type="button"
        style={S.quickReplyText}
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        {text}
      </button>
      {expanded && (
        <span style={S.quickReplyActions}>
          <button type="button" style={S.quickReplyAction} aria-label={`Add "${text}" to input`} title="Add to input" onClick={onInsert}>
            <Pencil size={13} />
          </button>
          <button type="button" style={S.quickReplyAction} aria-label={`Reply now with "${text}"`} title="Reply now" onClick={onSend}>
            <Send size={13} />
          </button>
        </span>
      )}
    </div>
  );
}

function RowIcon({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick} style={S.metaIcon} aria-label={title}>{children}</button>
  );
}

function ArtifactCard({ artifact, onOpen }: { artifact: ArtifactRef; onOpen: (artifact: ArtifactRef, opener: HTMLElement) => void }) {
  return (
    <button type="button" style={S.artifactCard} onClick={(event) => onOpen(artifact, event.currentTarget)} aria-label={artifact.title}>
      <span style={S.artifactIcon}>{artifact.kind === 'doc' ? <FileText size={14} /> : <Link2 size={14} />}</span>
      <div style={{ minWidth: 0 }}>
        <div style={S.artifactTitle}>{artifact.title}</div>
        <div style={S.artifactMeta}>{artifact.meta}</div>
      </div>
      <ChevronRight size={14} color={T.textQuaternary} style={{ marginLeft: 'auto' }} />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Turn gates: clarification ask + command approval. Pending cards own the
// turn; resolved cards collapse to a quiet, non-interactive record.
// ─────────────────────────────────────────────────────────────────────────

function TurnErrorView({ error, onRetry, onOpenSettings }: {
  error: TurnError;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const copy = ERROR_COPY[error.kind];
  const needsSettings = error.kind === 'not-configured' || error.kind === 'auth';
  const [remaining, setRemaining] = useState(error.retryAfterMs ? Math.ceil(error.retryAfterMs / 1000) : 0);
  // Rate-limit: hold Retry until the cooldown elapses so the action cannot
  // encourage hammering a throttled provider.
  useLayoutEffect(() => {
    if (error.kind !== 'rate-limit' || !error.retryAfterMs) return;
    setRemaining(Math.ceil(error.retryAfterMs / 1000));
    const t = window.setInterval(() => setRemaining((r) => {
      if (r <= 1) { window.clearInterval(t); return 0; }
      return r - 1;
    }), 1000);
    return () => window.clearInterval(t);
  }, [error.kind, error.retryAfterMs]);
  const retryDisabled = error.kind === 'rate-limit' && remaining > 0;
  const tone: 'neutral' | 'danger' | 'warning' = copy.tone;
  return (
    <div role="alert" style={S.turnError(tone)}>
      <div style={S.turnErrorHead(tone)}>
        <TriangleAlert size={15} />
        <strong>{copy.title}</strong>
      </div>
      <p style={S.turnErrorBody}>{copy.body}</p>
      <div style={S.turnErrorActions}>
        {needsSettings && (
          <button type="button" style={S.errorSettingsBtn} onClick={onOpenSettings}>
            <Settings size={13} /> Open settings
          </button>
        )}
        {error.kind !== 'not-configured' && error.kind !== 'cancelled' && (
          <button
            type="button"
            style={retryDisabled ? S.errorRetryDisabled : S.errorRetryBtn(tone)}
            disabled={retryDisabled}
            onClick={onRetry}
          >
            <RotateCcw size={13} />
            {retryDisabled ? `Retry in ${remaining}s` : 'Retry'}
          </button>
        )}
      </div>
    </div>
  );
}

// Review-only injection strip. Lives under the thread header, clearly marked,
// and is never mounted unless ?review=1 is present.
function ReviewFaultBar({ value, onChange }: { value: ErrorKind | null; onChange: (k: ErrorKind | null) => void }) {
  const kinds: Array<[ErrorKind | null, string]> = [
    [null, 'No fault'],
    ['not-configured', 'Not configured'],
    ['auth', 'Auth (401)'],
    ['rate-limit', 'Rate limit (429)'],
    ['network', 'Network (502)'],
    ['interrupted', 'Stream interrupted'],
  ];
  return (
    <div style={S.reviewBar} aria-label="Prototype review fault injection">
      <span style={S.reviewMark}>Prototype review only</span>
      <span style={S.reviewLabel}>Next turn fails as:</span>
      <div style={S.reviewSeg}>
        {kinds.map(([k, label]) => (
          <button
            key={label}
            type="button"
            style={value === k ? S.reviewSegBtnActive : S.reviewSegBtn}
            onClick={() => onChange(k)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AskCardView({ card, onAnswer }: { card: AskCard; onAnswer: (choice: string) => void; onCancel: () => void }) {
  const [selection, setSelection] = useState('');
  const [other, setOther] = useState('');
  if (card.status === 'answered') {
    return (
      <div style={S.gateResolved('neutral')}>
        <Check size={13} color={T.textTertiary} />
        <span>Answered · {card.answer}</span>
      </div>
    );
  }
  if (card.status === 'cancelled') {
    return null;
  }
  return (
    <div style={S.askCard} role="group" aria-label="Agent needs an answer">
      <div style={S.askToolMeta}>
        <span>Ask User</span>
        <span style={S.pendingTag}>Pending response</span>
        <span>requestUserInput</span>
      </div>
      <div style={S.askNotice}>
        <HelpCircle size={14} />
        <span>The Agent is paused until you answer this question.</span>
      </div>
      <div style={S.askQuestionPanel}>
        <strong>Choose one option</strong>
        <div style={S.askQuestion}>{card.question}</div>
        <div style={S.askOptions}>
          {card.options.map((option, index) => (
            <label key={option} style={S.askRadioRow}>
              <input
                type="radio"
                name={`ask-${card.question}`}
                value={option}
                checked={selection === option}
                onChange={() => setSelection(option)}
              />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <strong>{option}{index === 0 ? ' (Recommended)' : ''}</strong>
                <small style={{ color: T.textSecondary, lineHeight: 1.4 }}>{`Proceed using ${option.toLowerCase()} for the next step.`}</small>
              </span>
            </label>
          ))}
          <label style={S.askRadioRow}>
            <input
              type="radio"
              name={`ask-${card.question}`}
              value="Other"
              checked={selection === 'Other'}
              onChange={() => setSelection('Other')}
            />
            <span><strong>Other</strong></span>
          </label>
          {selection === 'Other' && (
            <input
              value={other}
              onChange={(event) => setOther(event.target.value)}
              aria-label="Other"
              placeholder="Type another answer"
              style={S.askOtherInput}
            />
          )}
        </div>
      </div>
      <div style={S.askSubmitRow}>
        <button
          type="button"
          style={S.approveBtn}
          disabled={!selection || (selection === 'Other' && !other.trim())}
          onClick={() => onAnswer(selection === 'Other' ? other.trim() : selection)}
        >
          Submit
        </button>
      </div>
    </div>
  );
}

function ApprovalCardView({ card, onDecision }: { card: ApprovalCard; onDecision: (approved: boolean) => void }) {
  // Safe default: when the gate appears, focus lands on Cancel so an accidental
  // Enter cannot approve a consequential command.
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (card.status === 'pending') cancelRef.current?.focus(); }, [card.status]);
  const executed = card.status === 'approved';
  const cancelled = card.status === 'denied' || card.status === 'cancelled';
  return (
    <div style={S.approvalCard} role="group" aria-label="Tool approval">
      <div style={S.approvalTags}>
        <span style={S.warningTag}>Tool approval</span>
        <span style={S.infoTag}>{card.toolName}</span>
        <span style={S.neutralTag}>{card.toolCategory}</span>
        <span style={executed ? S.successTag : cancelled ? S.neutralTag : S.warningTag}>
          {executed ? 'Executed' : cancelled ? 'Cancelled' : 'Pending confirmation'}
        </span>
      </div>
      <strong>Run this host tool?</strong>
      <div style={S.approvalSummary}>{card.summary}</div>
      <div style={S.approvalCmd}>
        <span style={S.approvalCmdText}>{card.argumentsPreview}</span>
      </div>
      {card.status === 'pending' ? (
        <div style={S.approvalActions}>
          <button ref={cancelRef} type="button" style={S.denyBtn} onClick={() => onDecision(false)}>Cancel</button>
          <button type="button" style={S.approveBtn} onClick={() => onDecision(true)}>Run tool</button>
        </div>
      ) : (
        <div style={S.approvalResult}>
          {executed ? 'Executed after your confirmation.' : 'Cancelled. This tool was not executed.'}
        </div>
      )}
    </div>
  );
}

function renderRich(text: string): React.ReactNode {
  return text.split('\n').map((line, i) => {
    if (!line.trim()) return <div key={i} style={{ height: 7 }} />;
    const bold = /^\*\*(.+?)\*\*$/.exec(line);
    if (bold) return <div key={i} style={S.richBold}>{renderInline(bold[1])}</div>;
    const bullet = /^[-•]\s+(.+)$/.exec(line);
    if (bullet) return <div key={i} style={S.richBullet}><span style={S.bulletDot} /><span style={S.richText}>{renderInline(bullet[1])}</span></div>;
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (numbered) {
      const n = (line.match(/^(\d+)\./) || [, ''])[1];
      return <div key={i} style={S.richNumbered}><span style={S.numberDot}>{n}</span><span style={S.richText}>{renderInline(numbered[1])}</span></div>;
    }
    return <div key={i}>{renderInline(line)}</div>;
  });
}

function renderInline(line: string): React.ReactNode {
  return line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} style={S.monoInline}>{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Grounded composer (per docs/client/common/ui-identity/patterns/composer.md)
// ─────────────────────────────────────────────────────────────────────────

interface ComposerSlashItem {
  id: string;
  kind: 'skill' | 'mcp';
  name: string;
  token: string;
  description: string;
}

function Composer({
  attachments, onAttachmentsChange,
  onOpenExtensions,
  onReturnToRunningTopic,
  value, model, modelProviders, busy, askActive, agentName, slashItems, usedTokens = 0,
  onChange, onSend, onStop, onModel, floatingDraft,
}: {
  attachments: File[];
  onAttachmentsChange: (files: File[]) => void;
  onOpenExtensions: () => void;
  onReturnToRunningTopic?: () => void;
  value: string;
  model: ModelId;
  modelProviders: PrototypeChatModelProvider[];
  busy: boolean;
  askActive?: boolean;
  agentName: string;
  slashItems: ComposerSlashItem[];
  usedTokens?: number;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onModel: (id: ModelId) => void;
  floatingDraft?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  const slashBtnRef = useRef<HTMLButtonElement>(null);
  const modelListRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const canSend = (value ?? floatingDraft ?? '').trim().length > 0 && !onReturnToRunningTopic && !busy && !askActive;
  const current = MODELS.find((m) => m.id === model)!;
  const [modelQuery, setModelQuery] = useState('');
  const [expandedModelProviders, setExpandedModelProviders] = useState<Set<string>>(
    () => new Set([current.providerId]),
  );
  const normalizedModelQuery = modelQuery.trim().toLowerCase();
  const visibleModelProviders = modelProviders
    .map((provider) => ({
      ...provider,
      models: provider.models.filter((candidate) =>
        !normalizedModelQuery
        || provider.label.toLowerCase().includes(normalizedModelQuery)
        || candidate.label.toLowerCase().includes(normalizedModelQuery)
        || candidate.description.toLowerCase().includes(normalizedModelQuery)),
    }))
    .filter((provider) => provider.models.length > 0);

  useEffect(() => {
    setExpandedModelProviders((previous) => new Set(previous).add(current.providerId));
  }, [current.providerId]);

  // Close both popovers on Escape (restore focus to their triggers).
  useLayoutEffect(() => {
    if (!modelOpen && !slashOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (modelOpen) { setModelOpen(false); modelBtnRef.current?.focus(); }
      else { setSlashOpen(false); slashBtnRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [modelOpen, slashOpen]);
  useLayoutEffect(() => {
    if (modelOpen) modelListRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    if (slashOpen) slashListRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [modelOpen, slashOpen]);

  const closePopovers = () => {
    setModelOpen(false);
    setModelQuery('');
    setSlashOpen(false);
  };

  const listboxKeys = (e: React.KeyboardEvent, scope: React.RefObject<HTMLDivElement | null>) => {
    const list = [...(scope.current?.querySelectorAll<HTMLElement>('[role="option"],[role="treeitem"],[role="menuitem"]') ?? [])];
    const idx = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(idx + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[idx <= 0 ? list.length - 1 : idx - 1]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      closePopovers();
      (scope === slashListRef ? slashBtnRef : modelBtnRef).current?.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const next = `${value.slice(0, start)}\n${value.slice(end)}`;
      onChange(next);
      requestAnimationFrame(() => taRef.current?.setSelectionRange(start + 1, start + 1));
      return;
    }
    if (e.shiftKey) return;
    e.preventDefault();
    if (canSend && !askActive) send();
  };

  const send = () => {
    if (!canSend || askActive) return;
    onSend();
  };

  const insertSlash = (token: string) => {
    const needsSpace = value.length > 0 && value[value.length - 1] !== ' ' && value[value.length - 1] !== '\n';
    onChange(`${value}${needsSpace ? ' ' : ''}/${token} `);
    setSlashOpen(false);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const onFiles = (files: FileList | null) => {
    if (files && files.length) onAttachmentsChange([...attachments, ...Array.from(files)].slice(0, 6));
    if (fileRef.current) fileRef.current.value = '';
  };

  // Context-window remaining ring: derived from tokens already produced in
  // the active thread against a nominal Station window (prototype constant).
  const NOMINAL_WINDOW = 128_000;
  const remaining = Math.max(0, Math.min(1, 1 - usedTokens / NOMINAL_WINDOW));
  const ringPct = Math.round(remaining * 100);
  const R = 8; const C = 2 * Math.PI * R;

  return (
    <div style={S.composerBar}>
      <div style={{ width: S_composerWidth, margin: '0 auto', position: 'relative' }}>
        {onReturnToRunningTopic && (
          <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 12px', color: T.textSecondary, fontSize: 12 }}>
            Another topic is running.
            <button type="button" style={S.followPill} onClick={onReturnToRunningTopic}>Return to running topic</button>
          </div>
        )}
        <div style={{ ...S.composerDock, borderColor: focused ? 'rgba(107,91,214,0.45)' : T.borderSoft, boxShadow: focused ? '0 0 0 3px rgba(107,91,214,0.10)' : 'none' }}>
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            rows={1}
            placeholder={askActive ? 'Type your answer…' : 'Ask, create, or start a task…  Press ⌘ ↵ to insert a line break'}
            style={S.composerInput}
            aria-label={`Message ${agentName}`}
          />

          {attachments.length > 0 && (
            <div style={S.attachRow}>
              {attachments.map((f, i) => (
                <span key={`${f.name}-${i}`} style={S.attachChip}>
                  <Paperclip size={11} />
                  <span style={S.attachName}>{f.name}</span>
                  <button
                    type="button"
                    style={S.attachRemove}
                    aria-label={`Remove ${f.name}`}
                    onClick={() => onAttachmentsChange(attachments.filter((_, j) => j !== i))}
                  ><X size={11} /></button>
                </span>
              ))}
            </div>
          )}

          <div style={S.composerToolbar}>
            {/* Left: slash commands + upload (reference-client DEFAULT_LEFT_ACTIONS) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ position: 'relative' }}>
                <button
                  ref={slashBtnRef}
                  type="button"
                  style={S.composerIconBtn(slashOpen)}
                  title="Commands &amp; Skills"
                  aria-label="Commands and Skills"
                  aria-haspopup="menu"
                  aria-expanded={slashOpen}
                  onClick={() => { closePopovers(); setSlashOpen(!slashOpen); }}
                >
                  <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1 }}>/</span>
                </button>
                {slashOpen && (
                  <>
                    <button type="button" aria-hidden tabIndex={-1} style={S.popScrim} onClick={() => { setSlashOpen(false); slashBtnRef.current?.focus(); }} />
                    <div ref={slashListRef} role="menu" aria-label="Commands and Skills" style={S.slashMenu} onKeyDown={(e) => listboxKeys(e, slashListRef)}>
                      <div style={S.slashHead}>Commands &amp; Skills</div>
                      {slashItems.length === 0 ? (
                        <div style={S.slashEmpty}>
                          No tools enabled for {agentName}.
                          <button type="button" role="menuitem" style={S.slashItem} onClick={() => { closePopovers(); onOpenExtensions(); }}>
                            Enable extensions
                          </button>
                        </div>
                      ) : slashItems.map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          role="menuitem"
                          style={S.slashItem}
                          onClick={() => insertSlash(it.token)}
                        >
                          {it.kind === 'skill' ? <Sparkles size={13} color={T.textTertiary} /> : <PlugIcon />}
                          <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.text }}>{it.name}</span>
                            <span style={S.slashItemDesc}>{it.description}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => onFiles(e.target.files)} />
              <button
                type="button"
                style={S.composerIconBtn(false)}
                title="Upload file"
                aria-label="Upload file"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip size={17} />
              </button>
            </div>

            {/* Right: context ring + Topic model + send/stop */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span role="img" title={`Context remaining ${ringPct}%`} aria-label={`Context remaining ${ringPct}%`} style={S.ctxRing}>
                <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                  <circle cx="10" cy="10" r={R} fill="none" stroke={T.fillTertiary} strokeWidth="2.5" />
                  <circle
                    cx="10" cy="10" r={R} fill="none"
                    stroke={remaining < 0.15 ? T.danger : T.textQuaternary}
                    strokeWidth="2.5" strokeLinecap="round"
                    strokeDasharray={C}
                    strokeDashoffset={C * (1 - remaining)}
                    transform="rotate(-90 10 10)"
                  />
                </svg>
              </span>

              <div style={{ position: 'relative' }}>
                <button
                  ref={modelBtnRef}
                  type="button"
                  style={S.modelPill}
                  onClick={() => { closePopovers(); setModelOpen(!modelOpen); }}
                  onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); if (!modelOpen) setModelOpen(true); } }}
                  aria-haspopup="tree"
                  aria-expanded={modelOpen}
                  aria-label="Topic model"
                  title={`Model · ${current.label}`}
                >
                  <TerminalSquare size={14} color={T.primary} />
                  <span style={S.modelName}>{current.label}</span>
                  <ChevronDown size={12} color={T.textQuaternary} />
                </button>
                {modelOpen && (
                  <>
                    <button type="button" aria-hidden tabIndex={-1} style={S.popScrim} onClick={() => { setModelOpen(false); setModelQuery(''); modelBtnRef.current?.focus(); }} />
                    <div ref={modelListRef} role="dialog" aria-label="Choose Topic model" style={S.modelMenu}>
                      <label style={S.modelSearch}>
                        <Search size={13} color={T.textQuaternary} />
                        <input
                          value={modelQuery}
                          onChange={(event) => setModelQuery(event.target.value)}
                          placeholder="Search providers and models"
                          aria-label="Search providers and models"
                          style={S.searchInput}
                        />
                      </label>
                      <div role="tree" aria-label="Provider model tree" style={S.modelTree} onKeyDown={(event) => listboxKeys(event, modelListRef)}>
                        {visibleModelProviders.map((provider) => {
                          const expanded = normalizedModelQuery.length > 0 || expandedModelProviders.has(provider.id);
                          return (
                            <div key={provider.id} role="group" aria-label={provider.label}>
                              <button
                                type="button"
                                role="treeitem"
                                aria-expanded={expanded}
                                style={S.modelProvider}
                                onClick={() => setExpandedModelProviders((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(provider.id)) next.delete(provider.id);
                                  else next.add(provider.id);
                                  return next;
                                })}
                              >
                                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                <span style={S.modelProviderName}>{provider.label}</span>
                                <span style={S.modelProviderCount}>{provider.models.length}</span>
                              </button>
                              {expanded ? provider.models.map((candidate) => (
                                <button
                                  key={candidate.id}
                                  type="button"
                                  role="treeitem"
                                  aria-selected={candidate.id === model}
                                  style={S.modelOption(candidate.id === model)}
                                  onClick={() => {
                                    onModel(candidate.id);
                                    setExpandedModelProviders((previous) => new Set(previous).add(provider.id));
                                    setModelOpen(false);
                                    setModelQuery('');
                                    modelBtnRef.current?.focus();
                                  }}
                                >
                                  <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                    <span style={{ fontWeight: 600, fontSize: 12.5, color: T.text }}>{candidate.label}</span>
                                    <span style={{ fontSize: 11, color: T.textTertiary }}>{candidate.description}</span>
                                  </span>
                                  {candidate.id === model && <Check size={13} color={T.primary} style={{ marginLeft: 'auto' }} />}
                                </button>
                              )) : null}
                            </div>
                          );
                        })}
                        {visibleModelProviders.length === 0 ? (
                          <div style={S.modelEmpty}>No matching providers or models.</div>
                        ) : null}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {busy ? (
                <button type="button" style={S.stopPlane} onClick={onStop} aria-label="Stop generating" title="Stop">
                  <Square size={14} fill="#fff" color="#fff" />
                </button>
              ) : (
                <button
                  type="button"
                  style={{ ...S.sendPlane, background: canSend ? T.primary : T.fillTertiary, color: canSend ? '#fff' : T.textQuaternary, cursor: canSend ? 'pointer' : 'default' }}
                  disabled={!canSend}
                  onClick={send}
                  aria-label="Send message"
                  title="Send"
                >
                  <Send size={17} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Small plug glyph for MCP tools (avoids pulling another lucide symbol).
function PlugIcon() {
  return <TerminalSquare size={13} color={T.textTertiary} />;
}

// ─────────────────────────────────────────────────────────────────────────
// Artifacts & references drawer
// ─────────────────────────────────────────────────────────────────────────

function ArtifactsDrawer({ artifacts, initialArtifact, onClose, restoreFocus }: {
  artifacts: ArtifactRef[];
  initialArtifact: ArtifactRef | null;
  onClose: () => void;
  restoreFocus: () => void;
}) {
  const [selectedArtifact, setSelectedArtifact] = useState(initialArtifact);
  const overlayRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeCallbackRef = useRef(onClose);
  const restoreCallbackRef = useRef(restoreFocus);
  closeCallbackRef.current = onClose;
  restoreCallbackRef.current = restoreFocus;

  // Modal keyboard model: focus the close button on open, Tab cycles inside,
  // Esc/scrim closes and returns focus to the header opener.
  useLayoutEffect(() => {
    // Keep the modal operable while isolating every background branch.
    const overlay = overlayRef.current;
    const backgrounds: Array<{ element: HTMLElement; inert: boolean }> = [];
    let branch: HTMLElement | null = overlayRef.current;
    while (branch?.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        backgrounds.push({ element: sibling, inert: sibling.inert });
        sibling.inert = true;
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeCallbackRef.current(); return; }
      if (e.key !== 'Tab') return;
      const nodes = drawerRef.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!nodes || nodes.length === 0) return;
      const list = [...nodes].filter((n) => n.tabIndex >= 0 && !n.hasAttribute('disabled') && n.getClientRects().length > 0);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      backgrounds.forEach(({ element, inert }) => { element.inert = inert; });
      // StrictMode's effect probe is not a user close; preserve its opener.
      setTimeout(() => {
        if (!overlay?.isConnected) restoreCallbackRef.current();
      }, 0);
    };
  }, []);

  return (
    <div ref={overlayRef} style={{ display: 'contents' }}>
      <div style={S.drawerScrim} onClick={onClose} />
      <aside ref={drawerRef} style={S.drawer} role="dialog" aria-modal="true" aria-label="Artifacts and references">
        <div style={S.drawerHeader}>
          <strong style={{ fontSize: 14 }}>Artifacts &amp; references</strong>
          <button ref={closeRef} type="button" style={S.headerGhost} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {selectedArtifact ? (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 16px' }}>
            <button type="button" style={S.followPill} onClick={() => setSelectedArtifact(null)}>All artifacts</button>
            <strong style={{ display: 'block', margin: '16px 0', overflowWrap: 'anywhere' }}>{selectedArtifact.title}</strong>
            <div style={S.answer}>{renderRich(selectedArtifact.content ?? '')}</div>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 16px' }}>
          {artifacts.length === 0 ? (
            <div style={S.drawerEmpty}>
              <FileText size={28} color={T.textQuaternary} />
              <span>No artifacts or references in this chat yet.</span>
            </div>
          ) : artifacts.map((artifact) => (
            <ArtifactCard key={artifact.id} artifact={artifact} onOpen={setSelectedArtifact} />
          ))}
          </div>
        )}
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers / data shaping
// ─────────────────────────────────────────────────────────────────────────

function buildGroups(threads: Thread[]) {
  const pinned = threads.filter((t) => t.pinned);
  const compare = (a: Thread, b: Thread) => b.createdAt - a.createdAt;
  const rest = threads.filter((t) => !t.pinned).sort(compare);
  const out: { key: string; label: string; threads: Thread[] }[] = [];
  if (pinned.length) out.push({ key: 'pinned', label: 'Pinned', threads: [...pinned].sort(compare) });
  for (const key of ['Today', 'Yesterday', 'Previous']) {
    const list = rest.filter((t) => groupKey(t.createdAt) === key);
    if (list.length) out.push({ key, label: key, threads: list });
  }
  return out;
}

function collectArtifacts(thread: Thread): ArtifactRef[] {
  return thread.messages.filter((m) => m.artifact).map((m) => m.artifact!) as ArtifactRef[];
}

function autoTitle(prompt: string) {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  return clean.length > 42 ? `${clean.slice(0, 42)}…` : clean;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Styles (semantic roles from the shell token set; no raw decorative system)
// ─────────────────────────────────────────────────────────────────────────

const S_contentWidth = 'min(760px, calc(100% - 40px))';
// Grounded composer (composer.md §5.1): the dock fills the bar with an equal
// 6px frame on every side; the bar owns the hairline and zero shadow.
const S_composerWidth = 'calc(100% - 12px)';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  root: { width: '100%', height: '100%', minHeight: 0, display: 'flex', background: T.bg, color: T.text, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', position: 'relative', overflow: 'hidden' },

  // Rail
  rail: { flexShrink: 0, height: '100%', borderRight: `1px solid ${T.border}`, background: T.navBg, display: 'flex', flexDirection: 'column', position: 'relative', boxSizing: 'border-box', zIndex: 4 },
  iconBtn: { width: 30, height: 30, borderRadius: 8, border: 0, background: 'transparent', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },

  // Persistent Agent roster
  pickerShell: { display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' },
  pickerHead: { display: 'flex', alignItems: 'center', gap: 8, height: 38, minHeight: 38, flexShrink: 0, marginBottom: 8, padding: '0 2px' },
  pickerTitle: { flex: 1, fontSize: 13.5, fontWeight: 700, color: T.text },
  pickerCreate: { width: 30, height: 30, borderRadius: 8, border: 0, background: 'transparent', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  // Header "+" create dropdown (Create Local / Create Orchestrator)
  createMenuWrap: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
  createMenu: { position: 'absolute', top: 34, right: 0, zIndex: 41, minWidth: 190, padding: 4, borderRadius: 10, border: `1px solid ${T.border}`, background: T.white, boxShadow: '0 12px 32px rgba(15,23,42,0.16)', display: 'flex', flexDirection: 'column', gap: 1 },
  pickerScroll: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 2px', display: 'flex', flexDirection: 'column', gap: 2 },
  rosterGroupLabel: { height: 29, minHeight: 29, boxSizing: 'border-box', padding: '10px 7px 4px', color: T.textSecondary, fontSize: 11, fontWeight: 650, lineHeight: 1.3 },
  pickerRow: (selected: boolean) => ({ height: 48, minHeight: 48, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 8, background: selected ? T.primaryWash2 : 'transparent', cursor: 'pointer' }),
  pickerRowMain: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, border: 0, background: 'transparent', color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer' },
  pickerTile: (selected: boolean) => ({ width: 34, height: 34, borderRadius: 9, background: selected ? T.primary : T.fillTertiary, color: selected ? '#fff' : T.textSecondary, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  pickerRowText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 },
  pickerName: { fontSize: 13, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 },
  pickerDesc: { fontSize: 11.5, color: T.textSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 },
  // Row overflow menu (Agent Profile / Delete)
  pickerActionWrap: { position: 'relative', display: 'inline-flex', alignItems: 'center', flexShrink: 0 },
  pickerMoreBtn: (menuOpen: boolean) => ({ width: 26, height: 26, borderRadius: 6, border: 0, background: menuOpen ? T.fillTertiary : 'transparent', color: T.textTertiary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }),
  pickerMenuScrim: { position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' },
  pickerMenu: { position: 'absolute', top: 28, right: 0, zIndex: 41, minWidth: 178, padding: 4, borderRadius: 10, border: `1px solid ${T.border}`, background: T.white, boxShadow: '0 12px 32px rgba(15,23,42,0.16)', display: 'flex', flexDirection: 'column', gap: 1 },
  pickerMenuItem: { display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px', border: 0, borderRadius: 6, background: 'transparent', color: T.text, fontSize: 12.5, fontWeight: 500, textAlign: 'left', cursor: 'pointer' },
  pickerMenuItemDanger: { display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px 10px', border: 0, borderRadius: 6, background: 'transparent', color: T.danger, fontSize: 12.5, fontWeight: 500, textAlign: 'left', cursor: 'pointer' },

  searchBox: { display: 'flex', alignItems: 'center', gap: 7, height: 32, padding: '0 9px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.white },
  searchInput: { flex: 1, border: 0, outline: 'none', fontSize: 12.5, color: T.text, background: 'transparent', minWidth: 0 },
  railEmpty: { padding: '14px 10px', fontSize: 12, lineHeight: 1.6, color: T.textSecondary },
  groupHeader: { display: 'flex', alignItems: 'center', gap: 4, border: 0, background: 'transparent', color: T.textSecondary, fontSize: 12, fontWeight: 600, padding: '10px 6px 4px', cursor: 'pointer', width: '100%' },
  threadRow: (active: boolean) => ({ position: 'relative', width: '100%', height: 32, display: 'flex', alignItems: 'center', gap: 7, border: 0, borderRadius: T.radiusMd, padding: '0 6px 0 8px', cursor: 'pointer', textAlign: 'left', background: active ? T.primaryWash2 : 'transparent', color: active ? T.primary : T.textSecondary, fontSize: 12.5, fontWeight: active ? 650 : 450 }),
  threadRowMain: { flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'center', gap: 7, border: 0, background: 'transparent', color: 'inherit', padding: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer' },
  threadTitle: { flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  renameInput: { flex: 1, minWidth: 0, height: 24, border: `1px solid ${T.primary}`, borderRadius: T.radiusSm, padding: '0 6px', fontSize: 12.5, color: T.text, background: T.white, outline: 'none', boxShadow: '0 0 0 2px rgba(107,91,214,0.10)' },
  rowActions: { display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0 },
  rowActionBtn: { width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: T.radiusSm, background: 'transparent', cursor: 'pointer', padding: 0 },
  menuScrim: { position: 'fixed', inset: 0, zIndex: 29, border: 0, background: 'transparent', padding: 0, cursor: 'default' },
  rowMenu: { position: 'absolute', right: 6, top: 30, zIndex: 30, minWidth: 132, background: T.white, border: `1px solid ${T.borderSoft}`, borderRadius: T.radiusMd, boxShadow: T.shadowMd, padding: 4, display: 'flex', flexDirection: 'column', gap: 1 },
  rowMenuItem: { display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'transparent', borderRadius: 6, padding: '7px 9px', fontSize: 12.5, color: T.text, cursor: 'pointer', textAlign: 'left' },
  rowMenuItemDanger: { display: 'flex', alignItems: 'center', gap: 8, border: 0, background: 'transparent', borderRadius: 6, padding: '7px 9px', fontSize: 12.5, fontWeight: 600, color: T.danger, cursor: 'pointer', textAlign: 'left' },
  topicCheckbox: (selected: boolean) => ({
    width: 14,
    height: 14,
    flexShrink: 0,
    borderRadius: 4,
    border: `1px solid ${selected ? T.primary : T.border}`,
    background: selected ? T.primary : T.white,
    color: '#fff',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),

  // Chat-only Topic rail. It remains a sibling layout column instead of
  // obscuring the conversation as a popover.
  topicsRail: (open: boolean, fillNarrow: boolean) => ({ flexShrink: 0, width: open ? (fillNarrow ? 'calc(100% - 48px)' : 238) : 48, height: '100%', minHeight: 0, paddingBottom: 54, boxSizing: 'border-box', borderRight: `1px solid ${T.border}`, background: T.white, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', transition: 'width .16s ease' }),
  topicRailActions: { position: 'relative', flexShrink: 0, height: 42, overflow: 'hidden' },
  topicActionPane: (searchOpen: boolean) => ({ position: 'absolute', inset: '2px 8px 6px', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4, transform: `translateX(${searchOpen ? '-110%' : '0'})`, opacity: searchOpen ? 0 : 1, pointerEvents: searchOpen ? 'none' : 'auto', transition: 'transform .16s ease, opacity .12s ease' }),
  topicSearchPane: (searchOpen: boolean) => ({ position: 'absolute', inset: '2px 8px 6px', transform: `translateX(${searchOpen ? '0' : '110%'})`, opacity: searchOpen ? 1 : 0, pointerEvents: searchOpen ? 'auto' : 'none', transition: 'transform .16s ease, opacity .12s ease' }),
  topicRailAction: { width: '100%', height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: 0, borderRadius: T.radiusMd, background: 'transparent', color: T.textSecondary, cursor: 'pointer' },
  topicInlineSearch: { width: '100%', height: 34, boxSizing: 'border-box', padding: '0 4px 0 9px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.white, display: 'flex', alignItems: 'center', gap: 7 },
  topicSearchCancel: { width: 26, height: 26, padding: 0, border: 0, borderRadius: 7, background: 'transparent', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
  topicListToolbar: { height: 34, minHeight: 34, padding: '0 8px 0 12px', display: 'flex', alignItems: 'center', gap: 6, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` },
  topicCountInline: { marginLeft: 3, color: T.textTertiary, fontSize: 12, fontWeight: 600 },
  topicListTools: { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2 },
  topicListTool: (active: boolean, disabled = false) => ({ width: 28, height: 28, padding: 0, border: 0, borderRadius: 7, background: active ? T.primaryWash2 : 'transparent', color: disabled ? T.textQuaternary : active ? T.primary : T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer' }),
  topicSelectedCount: { minWidth: 16, color: T.textSecondary, fontSize: 11.5, textAlign: 'center' },
  topicsCollapsed: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, paddingTop: 12 },
  collapsedTopicAction: { position: 'relative', width: 36, height: 36, border: 0, borderRadius: 9, background: 'transparent', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
  collapsedTopicCount: { position: 'absolute', right: 2, top: 2, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 7, background: T.primaryWash2, color: T.primary, fontSize: 9, fontWeight: 700, lineHeight: '14px', boxSizing: 'border-box' },
  topicStatusSlot: { width: 12, height: 14, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: T.primary },

  // Destructive confirmation dialog
  dialogScrim: { position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.32)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: 420, maxWidth: '100%', background: T.white, borderRadius: 12, border: `1px solid ${T.borderSoft}`, boxShadow: T.shadowMd, padding: '20px 22px 18px' },
  dialogHead: { display: 'flex', alignItems: 'center', gap: 10 },
  dialogIcon: { width: 30, height: 30, borderRadius: 8, background: 'rgba(255,77,79,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dialogTitle: { fontSize: 15, color: T.text },
  dialogBody: { margin: '10px 0 18px', paddingLeft: 40, fontSize: 13, lineHeight: 1.55, color: T.textSecondary, overflowWrap: 'anywhere' },
  dialogActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  dialogCancel: { height: 32, padding: '0 16px', borderRadius: 8, border: `1px solid ${T.borderSoft}`, background: T.white, color: T.textSecondary, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  dialogConfirm: { height: 32, padding: '0 16px', borderRadius: 8, border: 0, background: T.danger, color: '#fff', fontSize: 13, fontWeight: 650, cursor: 'pointer' },

  // Main
  main: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: T.bg, position: 'relative' },
  threadHeader: { flexShrink: 0, height: 52, display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px', borderBottom: `1px solid ${T.border}`, background: T.bg },
  threadTopicTitle: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  headerGhost: { position: 'relative', width: 32, height: 32, borderRadius: 8, border: 0, background: 'transparent', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  conversationSearch: { width: 'min(360px, 58%)', minWidth: 220, height: 34, boxSizing: 'border-box', padding: '0 4px 0 9px', border: `1px solid ${T.border}`, borderRadius: 8, background: T.white, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 1 },
  conversationSearchInput: { flex: 1, minWidth: 0, border: 0, outline: 'none', background: 'transparent', color: T.text, fontFamily: 'inherit', fontSize: 12.5 },
  conversationSearchCount: { minWidth: 32, color: T.textTertiary, fontSize: 10.5, textAlign: 'center', whiteSpace: 'nowrap' },
  conversationSearchAction: { width: 24, height: 24, padding: 0, border: 0, borderRadius: 6, background: 'transparent', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
  countBadge: { position: 'absolute', top: 2, right: 2, minWidth: 15, height: 15, padding: '0 4px', borderRadius: 999, background: T.primary, color: '#fff', fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' },
  topicsHead: { height: 44, minHeight: 44, flexShrink: 0, padding: '0 12px', display: 'flex', alignItems: 'center' },
  topicsTitle: { display: 'block', color: T.text, fontSize: 13.5, fontWeight: 700, lineHeight: 1.25 },
  topicAgentName: { minWidth: 0, color: T.text, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  mobileTopicsHead: { height: 56, minHeight: 56, flexShrink: 0, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 8 },
  mobileTopicSwitch: { width: 40, height: 40, flexShrink: 0, border: 0, borderRadius: 8, background: T.white, color: T.textSecondary, boxShadow: T.shadowSm, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  mobileTopicAgent: { flex: 1, minWidth: 0, height: 40, padding: '0 12px', borderRadius: 8, background: T.white, boxShadow: T.shadowSm, display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.text, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  topicsScroll: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 8px 10px' },

  scroll: { flex: 1, minHeight: 0, overflowY: 'auto' },
  railContent: { width: S_contentWidth, margin: '0 auto', padding: '22px 0 18px' },
  conversationSearchMatch: { outline: `2px solid ${T.primarySoft}`, outlineOffset: 3, borderRadius: 8 },

  // Welcome
  welcomeWrap: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  welcome: { width: S_contentWidth, margin: '0 auto', padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  welcomeTitle: { margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: 0 },
  welcomeSubtitle: { margin: '8px 0 22px', fontSize: 13.5, color: T.textSecondary, lineHeight: 1.6, maxWidth: 540 },
  starterGrid: { display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 8, maxWidth: 680 },
  starter: { display: 'inline-flex', alignItems: 'center', gap: 7, textAlign: 'left', border: `1px solid ${T.border}`, background: T.white, borderRadius: 999, padding: '7px 11px', fontSize: 12.5, color: T.textSecondary, cursor: 'pointer', lineHeight: 1.4, overflowWrap: 'anywhere' },

  // Messages
  userRow: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, padding: '10px 0' },
  userBubble: { maxWidth: '82%', background: T.primaryWash2, color: T.text, borderRadius: `${T.radiusLg}px ${T.radiusLg}px ${T.radiusSm}px ${T.radiusLg}px`, padding: '10px 14px', fontSize: 13.5, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  userEdit: { width: '82%', maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 8, background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 12, padding: 10, boxShadow: '0 0 0 3px rgba(107,91,214,0.08)' },
  userEditTextarea: { width: '100%', border: 0, outline: 'none', resize: 'vertical' as const, background: 'transparent', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.6, color: T.text, boxSizing: 'border-box' as const, overflowWrap: 'anywhere' },
  userEditActions: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  editCancel: { height: 28, padding: '0 13px', borderRadius: 8, border: `1px solid ${T.borderSoft}`, background: T.white, color: T.textSecondary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  editSave: { height: 28, padding: '0 13px', borderRadius: 8, border: 0, background: T.primary, color: '#fff', fontSize: 12.5, fontWeight: 650, cursor: 'pointer' },
  userMeta: { display: 'flex', alignItems: 'center', gap: 2, paddingRight: 4, fontSize: 12, color: T.textSecondary, transition: 'opacity .15s' },
  assistantRow: { padding: '12px 0' },
  systemRow: { margin: '12px 0', padding: '10px 12px', borderRadius: 8, background: T.surface, color: T.textSecondary, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'start', gap: 8, fontSize: 12.5, lineHeight: 1.55 },
  systemLabel: { color: T.text, fontWeight: 650 },
  systemTime: { color: T.textTertiary, fontSize: 11.5 },
  assistantMeta: { display: 'flex', alignItems: 'center', gap: 2, marginTop: 6, fontSize: 12, color: T.textSecondary, transition: 'opacity .15s' },
  metaIcon: { border: 0, background: 'transparent', width: 24, height: 24, borderRadius: T.radiusSm, color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },

  activityToggle: { display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, background: 'transparent', padding: 0, marginBottom: 8, cursor: 'pointer', color: T.textSecondary, fontSize: 12, fontWeight: 600 },
  activityList: { display: 'flex', flexDirection: 'column', gap: 4, margin: '0 0 10px' },
  activityItem: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px', borderRadius: 8, background: T.surface, fontSize: 12, color: T.textSecondary },
  activityLabel: { fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' },
  // Commands always wrap (reference client: pre-wrap + break-all); never clipped, since
  // the row is the audit record of what was actually considered.
  mono: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: T.textSecondary, background: T.white, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: '1px 6px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', minWidth: 0 },

  typing: { display: 'flex', gap: 5, padding: '6px 0 10px' },

  answer: { fontSize: 14, lineHeight: 1.75, color: T.text, whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  richText: { minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' },
  richBold: { fontWeight: 700, marginTop: 12, marginBottom: 2 },
  richBullet: { display: 'flex', gap: 9, marginTop: 4 },
  bulletDot: { width: 5, height: 5, borderRadius: 999, background: T.textQuaternary, marginTop: 9, flexShrink: 0 },
  richNumbered: { display: 'flex', gap: 9, marginTop: 5 },
  numberDot: { width: 17, height: 17, borderRadius: 999, background: T.primaryWash2, color: T.primary, fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  monoInline: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.92em', background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radiusSm, padding: '0 5px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' },

  // Typed turn failures (fp-05 §4): one block, one tone, inline recovery.
  turnError: (tone: 'neutral' | 'danger' | 'warning') => ({
    marginTop: 12, maxWidth: 560, borderRadius: 10, padding: '12px 14px', fontSize: 13, lineHeight: 1.55,
    ...(tone === 'danger'
      ? { background: 'rgba(255,77,79,0.06)', border: '1px solid rgba(255,77,79,0.32)', color: T.text }
      : tone === 'warning'
        ? { background: 'rgba(250,173,20,0.08)', border: '1px solid rgba(250,173,20,0.40)', color: T.text }
        : { background: T.surface, border: `1px solid ${T.borderSoft}`, color: T.text }),
  }),
  turnErrorHead: (tone: 'neutral' | 'danger' | 'warning') => ({
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 650, marginBottom: 6,
    color: tone === 'danger' ? '#cf1322' : tone === 'warning' ? '#ad6800' : T.text,
  }),
  turnErrorBody: { margin: 0, color: T.textSecondary },
  turnErrorActions: { display: 'flex', gap: 8, marginTop: 12 },
  errorSettingsBtn: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 13px', borderRadius: 8, border: `1px solid ${T.borderSoft}`, background: T.white, color: T.textSecondary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  errorRetryBtn: (tone: 'neutral' | 'danger' | 'warning') => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 15px', borderRadius: 8, border: 0,
    background: tone === 'danger' ? T.danger : tone === 'warning' ? '#d48806' : T.primary,
    color: '#fff', fontSize: 12.5, fontWeight: 650, cursor: 'pointer',
  }),
  errorRetryDisabled: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 15px', borderRadius: 8, border: 0, background: T.fillTertiary, color: T.textTertiary, fontSize: 12.5, fontWeight: 650, cursor: 'not-allowed' },

  // Review-only fault injection strip
  reviewBar: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '8px 20px 0', padding: '7px 12px', borderRadius: 8, border: '1px dashed #d3adf7', background: '#faf7ff' },
  reviewMark: { fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4, color: '#722ed1', textTransform: 'uppercase' as const },
  reviewLabel: { fontSize: 11.5, color: T.textTertiary },
  reviewSeg: { display: 'flex', gap: 4, flexWrap: 'wrap' },
  reviewSegBtn: { border: `1px solid ${T.borderSoft}`, background: T.white, color: T.textSecondary, borderRadius: 999, padding: '3px 10px', fontSize: 11.5, cursor: 'pointer' },
  reviewSegBtnActive: { border: '1px solid #722ed1', background: '#f9f0ff', color: '#531dab', borderRadius: 999, padding: '3px 10px', fontSize: 11.5, fontWeight: 650, cursor: 'pointer' },

  artifactCard: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, padding: '12px 14px', borderRadius: 10, border: `1px solid ${T.border}`, background: T.white, cursor: 'pointer', width: '100%', textAlign: 'left' },
  artifactIcon: { width: 30, height: 30, borderRadius: 8, background: T.primaryWash2, color: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  artifactTitle: { fontSize: 13, fontWeight: 650, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  artifactMeta: { fontSize: 12, color: T.textSecondary, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },

  followWrap: { marginTop: 14 },
  followLabel: { display: 'block', fontSize: 12, color: T.textSecondary, marginBottom: 8 },
  followRow: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  followPill: { border: `1px solid ${T.borderSoft}`, background: T.white, borderRadius: 999, padding: '6px 13px', fontSize: 12.5, color: T.textSecondary, cursor: 'pointer' },
  quickReply: (expanded: boolean) => ({ display: 'inline-flex', alignItems: 'center', gap: 2, minHeight: 34, border: `1px solid ${T.borderSoft}`, borderRadius: 999, background: expanded ? T.surface : T.white, overflow: 'hidden' }),
  quickReplyText: { minHeight: 32, border: 0, background: 'transparent', color: T.textSecondary, padding: '0 12px', fontSize: 12.5, cursor: 'pointer' },
  quickReplyActions: { display: 'inline-flex', alignItems: 'center', gap: 1, paddingRight: 3 },
  quickReplyAction: { width: 28, height: 28, border: 0, borderRadius: 8, background: 'transparent', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },

  // Turn gates (clarification ask + command approval)
  askCard: { marginTop: 12, border: `1px solid ${T.border}`, background: T.surface, borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 },
  askToolMeta: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', color: T.textSecondary, fontSize: 11.5 },
  pendingTag: { padding: '2px 7px', borderRadius: 6, background: T.primaryWash2, color: T.primary },
  askNotice: { display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', border: `1px solid ${T.primarySoft}`, borderRadius: 8, background: T.primaryWash, color: T.textSecondary, fontSize: 12.5 },
  askQuestionPanel: { padding: 12, border: `1px solid ${T.border}`, borderRadius: 8, background: T.white },
  askQuestion: { margin: '8px 0 12px', fontSize: 13.5, lineHeight: 1.6, color: T.text, overflowWrap: 'anywhere' },
  askOptions: { display: 'flex', flexDirection: 'column', gap: 6 },
  askRadioRow: { display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', gap: 8, alignItems: 'start', padding: '7px 8px', borderRadius: 8, cursor: 'pointer', color: T.text, fontSize: 12.5 },
  askOtherInput: { height: 32, marginLeft: 26, border: `1px solid ${T.border}`, borderRadius: 8, padding: '0 10px', color: T.text, background: T.white },
  askSubmitRow: { display: 'flex', justifyContent: 'flex-end' },
  approvalCard: { marginTop: 12, border: '1px solid rgba(250,173,20,0.40)', background: T.white, borderRadius: 8, padding: '13px 15px' },
  approvalTags: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, fontSize: 11.5 },
  warningTag: { padding: '2px 7px', borderRadius: 6, background: 'rgba(250,173,20,0.12)', color: '#ad6800' },
  infoTag: { padding: '2px 7px', borderRadius: 6, background: T.primaryWash2, color: T.primary },
  neutralTag: { padding: '2px 7px', borderRadius: 6, background: T.surface, color: T.textSecondary },
  successTag: { padding: '2px 7px', borderRadius: 6, background: 'rgba(82,196,26,0.10)', color: '#389e0d' },
  approvalSummary: { margin: '8px 0 10px', fontSize: 12.5, lineHeight: 1.6, color: T.textSecondary, overflowWrap: 'anywhere' },
  approvalCmd: { display: 'flex', alignItems: 'flex-start', gap: 8, background: T.white, border: `1px solid ${T.borderSoft}`, borderRadius: 8, padding: '8px 10px' },
  approvalCmdText: { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: T.text, flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' },
  approvalActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  approvalResult: { marginTop: 10, color: T.textSecondary, fontSize: 12.5 },
  denyBtn: { height: 30, padding: '0 14px', borderRadius: 8, border: `1px solid ${T.borderSoft}`, background: T.white, color: T.textSecondary, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  approveBtn: { height: 30, padding: '0 16px', borderRadius: 8, border: 0, background: T.primary, color: '#fff', fontSize: 12.5, fontWeight: 650, cursor: 'pointer' },
  gateResolved: (tone: 'success' | 'danger' | 'neutral') => ({
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12,
    padding: '7px 11px', borderRadius: 8, fontSize: 12.5, fontWeight: 550, alignSelf: 'flex-start',
    maxWidth: '100%',
    ...(tone === 'success'
      ? { background: 'rgba(82,196,26,0.08)', color: '#389e0d', border: '1px solid rgba(82,196,26,0.35)' }
      : tone === 'danger'
        ? { background: 'rgba(255,77,79,0.06)', color: '#cf1322', border: '1px solid rgba(255,77,79,0.30)' }
        : { background: T.surface, color: T.textTertiary, border: `1px solid ${T.border}` }),
  }),
  // Grounded composer
  composerBar: { flexShrink: 0, borderTop: `1px solid ${T.border}`, background: T.bg, padding: '6px 0' },
  composerDock: { background: T.surface, border: `1px solid ${T.borderSoft}`, borderRadius: 12, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, transition: 'border-color .12s, box-shadow .12s' },
  composerInput: { width: '100%', border: 0, outline: 'none', resize: 'none', background: 'transparent', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5, color: T.text, minHeight: 24, maxHeight: 160, padding: 0, boxSizing: 'border-box' },
  composerToolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  composerIconBtn: (active: boolean) => ({ width: 32, height: 32, borderRadius: 8, border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: active ? T.fillTertiary : 'transparent', color: active ? T.primary : T.textSecondary, cursor: 'pointer', flexShrink: 0 }),
  popScrim: { position: 'fixed', inset: 0, zIndex: 19, border: 0, background: 'transparent', padding: 0, cursor: 'default' },
  // Slash commands & skills
  slashMenu: { position: 'absolute', bottom: 38, left: 0, width: 264, maxHeight: 280, overflowY: 'auto', background: T.white, border: `1px solid ${T.borderSoft}`, borderRadius: 10, boxShadow: T.shadowMd, padding: 4, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 1 },
  slashHead: { fontSize: 11, fontWeight: 700, color: T.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4, padding: '6px 8px 4px' },
  slashItem: { display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 0, borderRadius: 8, background: 'transparent', padding: '8px 8px', cursor: 'pointer', textAlign: 'left' },
  slashItemDesc: { fontSize: 11, color: T.textTertiary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  slashEmpty: { fontSize: 11.5, color: T.textTertiary, lineHeight: 1.5, padding: '6px 8px 8px' },

  // Attachments
  attachRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  attachChip: { display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 220, padding: '4px 6px 4px 8px', borderRadius: 8, border: `1px solid ${T.borderSoft}`, background: T.white, color: T.textSecondary },
  attachName: { fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  attachRemove: { display: 'inline-flex', border: 0, background: 'transparent', color: T.textTertiary, cursor: 'pointer', padding: 0, alignItems: 'center' },

  // Runtime pill + send
  ctxRing: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, flexShrink: 0 },
  modelPill: { display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, border: 0, background: 'transparent', borderRadius: 8, padding: '0 6px', color: T.textSecondary, cursor: 'pointer' },
  modelName: { fontSize: 12.5, fontWeight: 600, color: T.text },
  modelMenu: { position: 'absolute', bottom: 38, right: 0, width: 300, maxWidth: 'calc(100vw - 24px)', background: T.white, border: `1px solid ${T.borderSoft}`, borderRadius: 10, boxShadow: T.shadowMd, padding: 6, zIndex: 20, display: 'flex', flexDirection: 'column', gap: 6 },
  modelSearch: { height: 32, boxSizing: 'border-box', padding: '0 9px', border: `1px solid ${T.border}`, borderRadius: 8, background: T.white, display: 'flex', alignItems: 'center', gap: 7 },
  modelTree: { maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 },
  modelProvider: { width: '100%', height: 32, padding: '0 8px', border: 0, borderRadius: 7, background: 'transparent', color: T.textSecondary, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', textAlign: 'left' },
  modelProviderName: { flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  modelProviderCount: { color: T.textTertiary, fontSize: 11, fontWeight: 600 },
  modelOption: (selected: boolean) => ({ width: 'calc(100% - 20px)', marginLeft: 20, display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 8, padding: '7px 9px', cursor: 'pointer', background: selected ? T.primaryWash : T.white, textAlign: 'left' }),
  modelEmpty: { minHeight: 56, padding: '18px 10px', color: T.textTertiary, fontSize: 12, textAlign: 'center' },
  sendPlane: { width: 36, height: 36, borderRadius: 12, border: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stopPlane: { width: 36, height: 36, borderRadius: 12, border: 0, background: T.danger, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },

  // Drawer
  drawerScrim: { position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.28)', zIndex: 30 },
  drawer: { position: 'absolute', top: 0, right: 0, bottom: 0, width: 340, maxWidth: '88%', background: T.white, borderLeft: `1px solid ${T.borderSoft}`, boxShadow: T.shadowMd, zIndex: 31, display: 'flex', flexDirection: 'column' },
  drawerHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px' },
  drawerEmpty: { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: T.textTertiary, fontSize: 12.5, textAlign: 'center' },
  mobileDrawerLayer: { position: 'absolute', inset: 0, zIndex: 55 },
  mobileDrawerScrim: { position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, background: 'rgba(15,23,42,0.32)', padding: 0, cursor: 'default' },
  mobileAgentDrawer: { position: 'absolute', inset: '0 auto 0 0', width: 'min(406px, calc(100% - 24px))', padding: '0 8px 16px', boxSizing: 'border-box', borderRight: `1px solid ${T.borderSoft}`, background: T.white, boxShadow: T.shadowMd, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  mobileDrawerHeader: { height: 56, minHeight: 56, margin: '0 -8px 8px', padding: '0 12px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 8 },
  mobileDrawerClose: { width: 40, height: 40, border: 0, borderRadius: 8, background: 'transparent', color: T.textSecondary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
};

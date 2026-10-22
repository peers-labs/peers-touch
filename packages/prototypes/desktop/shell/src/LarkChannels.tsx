import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Button, Modal } from '@lobehub/ui';
import { Tabs } from 'antd';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  FileKey,
  HeartPulse,
  MessageSquareText,
  Pause,
  Pencil,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Route,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import './LarkChannels.css';

type ConnectionState = 'connecting' | 'connected' | 'attention' | 'disabled';
type Intent =
  | 'agent'
  | 'routing'
  | 'automation'
  | 'account'
  | 'app'
  | 'health'
  | 'conversations'
  | 'activity'
  | null;
type AccountState = 'disconnected' | 'authorizing' | 'connected' | 'expired';
type DeliveryState = 'idle' | 'sending' | 'delivered' | 'failed';
type AutomationRunState = 'never' | 'running' | 'delivered' | 'failed';
type TriggerType = 'schedule' | 'message' | 'document';

type RoutePreference = {
  id: string;
  conversation: string;
  agent: string;
  enabled: boolean;
};

type RouteDraft = {
  editingId: string | null;
  conversation: string;
  agent: string;
};

type Automation = {
  id: string;
  trigger: TriggerType;
  triggerValue: string;
  action: string;
  agent: string;
  destination: string;
  enabled: boolean;
  lastRun: AutomationRunState;
  lastRunAt: string | null;
};

type AutomationDraft = Omit<Automation, 'id' | 'enabled' | 'lastRun' | 'lastRunAt'> & {
  editingId: string | null;
};

type LarkConnection = {
  id: string;
  name: string;
  isDefault: boolean;
  state: ConnectionState;
  agent: string;
  ownerName: string;
  routes: RoutePreference[];
  automations: Automation[];
  account: {
    state: AccountState;
    name: string;
    email: string;
  };
  app: {
    mode: 'managed' | 'custom';
    name: string;
    appId: string | null;
    state: 'ready' | 'needs_repair';
    issues: string[];
  };
  testDelivery: {
    state: DeliveryState;
    recipient: string;
    message: string;
    messageId: string | null;
    deliveredAt: string | null;
  };
  drafts: {
    route: RouteDraft | null;
    automation: AutomationDraft | null;
    appId: string;
  };
};

type LarkWorkspace = {
  schemaVersion: 7;
  connections: LarkConnection[];
  selectedConnectionId: string | null;
  creation: {
    state: 'idle' | 'scan' | 'connecting';
    returnToId: string | null;
  };
};

type AppCheck = {
  state: 'idle' | 'checking' | 'needs_repair' | 'ready';
  issues: string[];
  repairing: boolean;
};

type ConfirmAction =
  | { kind: 'route'; id: string }
  | { kind: 'automation'; id: string }
  | { kind: 'account' }
  | { kind: 'connection' };

const storageKey = 'peers.prototype.lark-workspace.v7';
const legacyStorageKeys = [
  'peers.prototype.lark-workspace.v6',
  'peers.prototype.lark-workspace.v5',
  'peers.prototype.lark-connection.v4',
];

const agentNames: Record<string, string> = {
  alice: 'Alice',
  research: 'Research Partner',
  maker: 'Maker',
};

function agentLabel(agent: string): string {
  return agentNames[agent] ?? 'Not configured';
}

const conversationNames: Record<string, string> = {
  design: 'Design discussion',
  notes: 'Personal notes',
  family: 'Family group',
};

const destinationNames: Record<string, string> = {
  me: 'Me in Lark',
  design: 'Design discussion',
  notes: 'Personal notes',
};

function createConnection(
  agent: string,
  index: number,
  app?: LarkConnection['app'],
): LarkConnection {
  const baseName = app?.name || 'Lark connection';
  return {
    id: createId('lark'),
    name: index > 1 ? `${baseName} ${index}` : baseName,
    isDefault: index === 1,
    state: 'connected',
    agent,
    ownerName: 'Shuxian',
    routes: [],
    automations: [],
    account: {
      state: 'disconnected',
      name: '',
      email: '',
    },
    app: app ?? {
      mode: 'managed',
      name: 'Peers managed Lark app',
      appId: null,
      state: 'ready',
      issues: [],
    },
    testDelivery: {
      state: 'idle',
      recipient: 'Shuxian',
      message: 'Hello from Peers. This Lark connection is ready.',
      messageId: null,
      deliveredAt: null,
    },
    drafts: {
      route: null,
      automation: null,
      appId: '',
    },
  };
}

function createNextConnection(
  connections: LarkConnection[],
  app?: LarkConnection['app'],
) {
  const baseName = app?.name || 'Lark connection';
  let index = 1;
  while (connections.some((item) => item.name === (index === 1 ? baseName : `${baseName} ${index}`))) {
    index += 1;
  }
  const connection = createConnection('', index, app);
  return {
    ...connection,
    isDefault: connections.length === 0,
  };
}

function createInitialWorkspace(): LarkWorkspace {
  return {
    schemaVersion: 7,
    connections: [],
    selectedConnectionId: null,
    creation: {
      state: 'idle',
      returnToId: null,
    },
  };
}

function loadWorkspace(): LarkWorkspace {
  const fallback = createInitialWorkspace();
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (!value || typeof value !== 'object') return fallback;
    const candidate = value as Partial<LarkWorkspace>;
    if (candidate.schemaVersion !== 7 || !Array.isArray(candidate.connections)) return fallback;
    const connections = candidate.connections.flatMap((item, index) => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.name !== 'string' ||
        !['connected', 'attention', 'disabled', 'connecting'].includes(item.state) ||
        !(item.agent === '' || item.agent in agentNames)
      ) {
        return [];
      }
      const base = createConnection(item.agent, index + 1);
      return [{
        ...base,
        ...item,
        routes: Array.isArray(item.routes) ? item.routes : [],
        automations: Array.isArray(item.automations) ? item.automations : [],
        account: { ...base.account, ...(item.account ?? {}) },
        app: { ...base.app, ...(item.app ?? {}) },
        testDelivery: { ...base.testDelivery, ...(item.testDelivery ?? {}) },
        drafts: {
          ...base.drafts,
          ...(item.drafts ?? {}),
        },
      }];
    });
    if (connections.length > 0 && !connections.some((item) => item.isDefault)) {
      connections[0] = { ...connections[0], isDefault: true };
    }
    const selectedConnectionId = typeof candidate.selectedConnectionId === 'string' &&
      connections.some((item) => item.id === candidate.selectedConnectionId)
      ? candidate.selectedConnectionId
      : null;
    return {
      schemaVersion: 7,
      connections,
      selectedConnectionId,
      creation: fallback.creation,
    };
  } catch {
    return fallback;
  }
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultRouteDraft(): RouteDraft {
  return {
    editingId: null,
    conversation: 'design',
    agent: 'research',
  };
}

function defaultAutomationDraft(): AutomationDraft {
  return {
    editingId: null,
    trigger: 'schedule',
    triggerValue: 'Every Friday at 5 PM',
    action: 'Summarize my open tasks and send the result to me.',
    agent: 'alice',
    destination: 'me',
  };
}

function triggerLabel(trigger: TriggerType, value: string) {
  if (trigger === 'schedule') return value;
  if (trigger === 'message') return `Message contains "${value}"`;
  return `Document "${value}" changes`;
}

function Status({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'positive' | 'warning';
  children: ReactNode;
}) {
  return (
    <span className={`pt-lark-status pt-lark-status--${tone}`} role="status">
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

function AgentMark({ agent, size = 'normal' }: { agent: string; size?: 'normal' | 'large' }) {
  const initials = agent
    ? agentLabel(agent)
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
    : '--';
  return (
    <span className={`pt-lark-agentmark pt-lark-agentmark--${size}`} aria-hidden="true">
      {initials}
    </span>
  );
}

function IntentRow({
  icon: Icon,
  title,
  description,
  value,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="pt-lark-intent-row" data-ui-row onClick={onClick}>
      <span className="pt-lark-intent-row__icon" data-ui-column="icon" data-ui-column-align="center" data-ui-row-center><Icon size={17} /></span>
      <span className="pt-lark-intent-row__copy" data-ui-column="content" data-ui-column-align="start">
        <b>{title}</b>
        <small>{description}</small>
      </span>
      {value ? <span className="pt-lark-intent-row__value">{value}</span> : null}
      <ChevronRight data-ui-column="actions" data-ui-column-align="end" data-ui-row-center size={17} aria-hidden="true" />
    </button>
  );
}

export function LarkChannels() {
  const [workspace, setWorkspace] = useState(loadWorkspace);
  const [intent, setIntent] = useState<Intent>(null);
  const [notice, setNotice] = useState('');
  const [intentNotice, setIntentNotice] = useState('');
  const [routeEditor, setRouteEditor] = useState<string | 'new' | null>(null);
  const [automationEditor, setAutomationEditor] = useState<string | 'new' | null>(null);
  const [routeError, setRouteError] = useState('');
  const [automationError, setAutomationError] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [appErrors, setAppErrors] = useState<{ appId?: string; secret?: string }>({});
  const [appCheck, setAppCheck] = useState<AppCheck>({ state: 'idle', issues: [], repairing: false });
  const [appMode, setAppMode] = useState<'create' | 'replace'>('replace');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createMethod, setCreateMethod] = useState<'managed' | 'custom'>('managed');
  const [createPlatform, setCreatePlatform] = useState<'feishu' | 'lark'>('feishu');
  const [managedAppName, setManagedAppName] = useState('');
  const [createAppId, setCreateAppId] = useState('');
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null);
  const intentHeading = useRef<HTMLHeadingElement>(null);
  const appIdInput = useRef<HTMLInputElement>(null);
  const appSecretInput = useRef<HTMLInputElement>(null);
  const confirmDialog = useRef<HTMLDivElement>(null);
  const confirmCancelButton = useRef<HTMLButtonElement>(null);
  const confirmSource = useRef<HTMLElement | null>(null);
  const createSource = useRef<HTMLElement | null>(null);
  const confirmWasOpen = useRef(false);

  const selectedConnection = workspace.connections.find((item) => item.id === workspace.selectedConnectionId) ?? null;
  const fallbackConnection = useRef(createConnection('', 1)).current;
  const connection = selectedConnection ?? fallbackConnection;
  const drafts = selectedConnection?.drafts ?? {
    route: null,
    automation: null,
    appId: '',
  };
  const activeAppId = appMode === 'create'
    ? createAppId
    : drafts.appId;
  const activeAutomations = connection.automations.filter((item) => item.enabled).length;

  useEffect(() => {
    legacyStorageKeys.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(storageKey, JSON.stringify({
      ...workspace,
      creation: createInitialWorkspace().creation,
    }));
  }, [workspace]);

  useEffect(() => {
    if (workspace.creation.state !== 'connecting') return;
    const nextApp: LarkConnection['app'] = {
      mode: 'managed',
      name: managedAppName.trim(),
      appId: null,
      state: 'ready',
      issues: [],
    };
    const nextConnection = createNextConnection(workspace.connections, nextApp);
    const timer = window.setTimeout(() => {
      setWorkspace((current) => ({
        ...current,
        connections: [...current.connections, nextConnection],
        selectedConnectionId: nextConnection.id,
        creation: {
          state: 'idle',
          returnToId: null,
        },
      }));
      setNotice(`${nextConnection.name} is connected.`);
      setCreateDialogOpen(false);
      setCreateMethod('managed');
      setManagedAppName('');
    }, 900);
    return () => window.clearTimeout(timer);
  }, [managedAppName, workspace.connections, workspace.creation.state]);

  useEffect(() => {
    if (!selectedConnection) return;
    if (selectedConnection.state !== 'connecting') return;
    const connectionId = selectedConnection.id;
    const timer = window.setTimeout(() => {
      updateConnectionById(connectionId, (current) => ({ ...current, state: 'connected' }));
      setNotice(`${selectedConnection.name} is connected.`);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [selectedConnection?.id, selectedConnection?.name, selectedConnection?.state]);

  useEffect(() => {
    if (!selectedConnection) return;
    if (connection.account.state !== 'authorizing') return;
    const connectionId = selectedConnection.id;
    const timer = window.setTimeout(() => {
      updateConnectionById(connectionId, (current) => ({
        ...current,
        account: {
          state: 'connected',
          name: current.ownerName,
          email: 'shuxian@lark.example',
        },
      }));
      setIntentNotice('Your personal Lark account is connected.');
    }, 900);
    return () => window.clearTimeout(timer);
  }, [connection.account.state, selectedConnection?.id]);

  useEffect(() => {
    if (!selectedConnection || connection.account.state !== 'expired') return;
    const connectionId = selectedConnection.id;
    setWorkspace((current) => ({
      ...current,
      connections: current.connections.map((item) => {
        if (item.id !== connectionId) return item;
        const automations = item.automations.map((automation) => (
          automation.trigger === 'document' && automation.enabled
            ? { ...automation, enabled: false }
            : automation
        ));
        return {
          ...item,
          automations,
        };
      }),
    }));
  }, [connection.account.state, selectedConnection?.id]);

  useEffect(() => {
    if (!selectedConnection || connection.testDelivery.state !== 'sending') return;
    const connectionId = selectedConnection.id;
    const timer = window.setTimeout(() => {
      updateConnectionById(connectionId, (current) => ({
        ...current,
        testDelivery: {
          ...current.testDelivery,
          state: 'delivered',
          messageId: createId('msg'),
          deliveredAt: 'Just now',
        },
      }));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [connection.testDelivery.state, selectedConnection?.id]);

  useEffect(() => {
    if (!selectedConnection || !connection.automations.some((item) => item.lastRun === 'running')) return;
    const connectionId = selectedConnection.id;
    const timer = window.setTimeout(() => {
      updateConnectionById(connectionId, (current) => ({
        ...current,
        automations: current.automations.map((item) => (
          item.lastRun === 'running'
            ? { ...item, lastRun: 'delivered', lastRunAt: 'Just now' }
            : item
        )),
      }));
      setIntentNotice('The result was delivered in Lark.');
    }, 800);
    return () => window.clearTimeout(timer);
  }, [connection.automations, selectedConnection?.id]);

  useEffect(() => {
    if (appCheck.state !== 'checking') return;
    const timer = window.setTimeout(() => {
      const needsRepair = !appCheck.repairing && activeAppId.toLowerCase().includes('repair');
      setAppCheck(needsRepair
        ? {
            state: 'needs_repair',
            issues: ['Event delivery is not enabled', 'Message permission is missing'],
            repairing: false,
          }
        : { state: 'ready', issues: [], repairing: false });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [activeAppId, appCheck.repairing, appCheck.state]);

  useEffect(() => {
    if (!intent) return;
    window.requestAnimationFrame(() => intentHeading.current?.focus());
  }, [intent, routeEditor, automationEditor]);

  useEffect(() => {
    if (confirming) {
      confirmWasOpen.current = true;
      window.requestAnimationFrame(() => confirmCancelButton.current?.focus());
      return;
    }
    if (!confirmWasOpen.current) return;
    confirmWasOpen.current = false;
    window.requestAnimationFrame(() => confirmSource.current?.focus());
  }, [confirming]);

  useEffect(() => {
    if (!confirming) return;
    const handleConfirmKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfirming(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(confirmDialog.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleConfirmKeyboard);
    return () => window.removeEventListener('keydown', handleConfirmKeyboard);
  }, [confirming]);

  function updateConnection(
    update: Partial<LarkConnection> | ((current: LarkConnection) => LarkConnection),
  ) {
    if (!selectedConnection) return;
    updateConnectionById(selectedConnection.id, update);
  }

  function updateConnectionById(
    connectionId: string,
    update: Partial<LarkConnection> | ((current: LarkConnection) => LarkConnection),
  ) {
    setWorkspace((current) => ({
      ...current,
      connections: current.connections.map((item) => {
        if (item.id !== connectionId) return item;
        return typeof update === 'function' ? update(item) : { ...item, ...update };
      }),
    }));
  }

  function updateDrafts(update: Partial<LarkConnection['drafts']>) {
    setWorkspace((current) => {
      if (!current.selectedConnectionId) return current;
      return {
        ...current,
        connections: current.connections.map((item) => (
          item.id === current.selectedConnectionId
            ? { ...item, drafts: { ...item.drafts, ...update } }
            : item
        )),
      };
    });
  }

  function updateActiveAppId(appId: string) {
    if (appMode === 'create') {
      setCreateAppId(appId);
    } else {
      updateDrafts({ appId });
    }
  }

  function startConnection(event?: ReactMouseEvent<HTMLElement>) {
    if (event) createSource.current = event.currentTarget;
    setIntent(null);
    setNotice('');
    setAppSecret('');
    setAppMode('create');
    setAppCheck({ state: 'idle', issues: [], repairing: false });
    setAppErrors({});
    setCreateMethod('managed');
    setCreatePlatform('feishu');
    setManagedAppName('');
    setCreateAppId('');
    setCreateDialogOpen(true);
    setWorkspace((current) => ({
      ...current,
      creation: {
        state: 'idle',
        returnToId: selectedConnection?.id ?? null,
      },
    }));
  }

  function cancelConnectionCreation() {
    setWorkspace((current) => ({
      ...current,
      creation: {
        ...current.creation,
        state: 'idle',
        returnToId: null,
      },
    }));
    setIntent(null);
    setIntentNotice('');
    setAppSecret('');
    setAppCheck({ state: 'idle', issues: [], repairing: false });
    setCreateMethod('managed');
    setManagedAppName('');
    setCreateAppId('');
    setCreateDialogOpen(false);
    window.requestAnimationFrame(() => createSource.current?.focus());
  }

  function openIntent(next: Exclude<Intent, null>) {
    setIntent(next);
    setIntentNotice('');
    if (next === 'routing') {
      setRouteEditor(null);
      if (connection.routes.length === 0) beginNewRoute();
    }
    if (next === 'automation') {
      setAutomationEditor(null);
      if (connection.automations.length === 0) beginNewAutomation();
    }
    if (next === 'app') {
      setAppMode('replace');
      setAppSecret('');
      setAppCheck({ state: 'idle', issues: [], repairing: false });
      setAppErrors({});
    }
  }

  function openCreateWithExistingApp() {
    setAppMode('create');
    setAppCheck({ state: 'idle', issues: [], repairing: false });
    setAppErrors({});
    setAppSecret('');
    setCreateMethod('custom');
  }

  function beginManagedConnection() {
    if (!managedAppName.trim()) return;
    setWorkspace((current) => ({
      ...current,
      creation: {
        ...current.creation,
        state: 'scan',
      },
    }));
  }

  function beginNewRoute() {
    if (!drafts.route || drafts.route.editingId) {
      updateDrafts({ route: defaultRouteDraft() });
    }
    setRouteEditor('new');
    setRouteError('');
  }

  function editRoute(route: RoutePreference) {
    updateDrafts({
      route: {
        editingId: route.id,
        conversation: route.conversation,
        agent: route.agent,
      },
    });
    setRouteEditor(route.id);
    setRouteError('');
  }

  function saveRoute() {
    const draft = drafts.route;
    if (!draft) return;
    const duplicate = connection.routes.some((item) => (
      item.conversation === draft.conversation && item.id !== draft.editingId
    ));
    if (duplicate) {
      setRouteError('This conversation already has an Agent preference.');
      return;
    }
    setWorkspace((current) => {
      if (!current.selectedConnectionId) return current;
      return {
        ...current,
        connections: current.connections.map((item) => {
          if (item.id !== current.selectedConnectionId || !item.drafts.route) return item;
          const currentDraft = item.drafts.route;
          const nextRoute: RoutePreference = {
            id: currentDraft.editingId ?? createId('route'),
            conversation: currentDraft.conversation,
            agent: currentDraft.agent,
            enabled: item.routes.find((route) => route.id === currentDraft.editingId)?.enabled ?? true,
          };
          const exists = item.routes.some((route) => route.id === nextRoute.id);
          return {
            ...item,
            routes: exists
              ? item.routes.map((route) => route.id === nextRoute.id ? { ...route, ...nextRoute } : route)
              : [...item.routes, nextRoute],
            drafts: { ...item.drafts, route: null },
          };
        }),
      };
    });
    setRouteEditor(null);
    setRouteError('');
    setIntentNotice('Conversation preference saved.');
  }

  function beginNewAutomation() {
    if (!drafts.automation || drafts.automation.editingId) {
      updateDrafts({
        automation: {
          ...defaultAutomationDraft(),
          agent: connection.agent || 'alice',
        },
      });
    }
    setAutomationEditor('new');
    setAutomationError('');
  }

  function editAutomation(automation: Automation) {
    updateDrafts({
      automation: {
        editingId: automation.id,
        trigger: automation.trigger,
        triggerValue: automation.triggerValue,
        action: automation.action,
        agent: automation.agent,
        destination: automation.destination,
      },
    });
    setAutomationEditor(automation.id);
    setAutomationError('');
  }

  function saveAutomation() {
    const draft = drafts.automation;
    if (!draft) return;
    if (!draft.triggerValue.trim() || !draft.action.trim()) {
      setAutomationError('Add both a trigger and the result you want.');
      return;
    }
    setWorkspace((current) => {
      if (!current.selectedConnectionId) return current;
      return {
        ...current,
        connections: current.connections.map((item) => {
          if (item.id !== current.selectedConnectionId || !item.drafts.automation) return item;
          const currentDraft = item.drafts.automation;
          const existing = item.automations.find((automation) => automation.id === currentDraft.editingId);
          const nextAutomation: Automation = {
            id: currentDraft.editingId ?? createId('automation'),
            trigger: currentDraft.trigger,
            triggerValue: currentDraft.triggerValue.trim(),
            action: currentDraft.action.trim(),
            agent: currentDraft.agent,
            destination: currentDraft.destination,
            enabled: existing?.enabled ?? true,
            lastRun: existing?.lastRun ?? 'never',
            lastRunAt: existing?.lastRunAt ?? null,
          };
          return {
            ...item,
            automations: existing
              ? item.automations.map((automation) => automation.id === nextAutomation.id ? nextAutomation : automation)
              : [...item.automations, nextAutomation],
            drafts: { ...item.drafts, automation: null },
          };
        }),
      };
    });
    setAutomationEditor(null);
    setAutomationError('');
    setIntentNotice('Automation saved and active.');
  }

  function runAutomation(id: string) {
    updateConnection((current) => ({
      ...current,
      automations: current.automations.map((item) => (
        item.id === id ? { ...item, lastRun: 'running', lastRunAt: null } : item
      )),
    }));
    setIntentNotice('Running the automation now...');
  }

  function startAppCheck() {
    const nextErrors: { appId?: string; secret?: string } = {};
    if (!/^cli_[a-zA-Z0-9_-]{4,}$/.test(activeAppId.trim())) {
      nextErrors.appId = 'Enter a valid App ID beginning with cli_.';
    }
    if (appSecret.length < 6) {
      nextErrors['secret'] = 'Enter the App Secret from Lark Developer Console.';
    }
    setAppErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      window.requestAnimationFrame(() => (
        nextErrors.appId ? appIdInput.current?.focus() : appSecretInput.current?.focus()
      ));
      return;
    }
    setAppCheck({ state: 'checking', issues: [], repairing: false });
  }

  function connectCustomApp() {
    const appId = activeAppId.trim();
    const nextApp: LarkConnection['app'] = {
      mode: 'custom',
      name: 'My Lark app',
      appId,
      state: 'ready',
      issues: [],
    };
    if (appMode === 'create') {
      const nextConnection = createNextConnection(
        workspace.connections,
        nextApp,
      );
      setWorkspace((current) => ({
        ...current,
        connections: [...current.connections, nextConnection],
        selectedConnectionId: nextConnection.id,
        creation: {
          state: 'idle',
          returnToId: null,
        },
      }));
      setNotice(`${nextConnection.name} is connected with your app.`);
      setCreateDialogOpen(false);
      setCreateMethod('managed');
      setCreateAppId('');
    } else {
      updateConnection((current) => ({
        ...current,
        state: 'connected',
        app: nextApp,
        drafts: { ...current.drafts, appId: '' },
      }));
      setNotice('Your existing Lark app is now handling this connection.');
    }
    setAppSecret('');
    setAppCheck({ state: 'idle', issues: [], repairing: false });
    setIntent(null);
  }

  function makeDefault(connectionId: string) {
    setWorkspace((current) => ({
      ...current,
      connections: current.connections.map((item) => ({
        ...item,
        isDefault: item.id === connectionId,
      })),
    }));
    setNotice('Default Lark connection updated.');
  }

  function toggleConnection(connectionId: string) {
    updateConnectionById(connectionId, (current) => ({
      ...current,
      state: current.state === 'disabled' ? 'connected' : 'disabled',
    }));
    setNotice(connection.state === 'disabled' ? 'Connection resumed.' : 'Connection paused.');
  }

  function deleteConnection(connectionId: string) {
    setWorkspace((current) => {
      const removed = current.connections.find((item) => item.id === connectionId);
      const remaining = current.connections.filter((item) => item.id !== connectionId);
      const nextDefaultId = removed?.isDefault
        ? (remaining.find((item) => item.state !== 'disabled') ?? remaining[0])?.id
        : null;
      return {
        ...current,
        connections: remaining.map((item) => (
          nextDefaultId ? { ...item, isDefault: item.id === nextDefaultId } : item
        )),
        selectedConnectionId: current.selectedConnectionId === connectionId
          ? null
          : current.selectedConnectionId,
      };
    });
    setIntent(null);
    setNotice('');
  }

  function selectConnection(connectionId: string) {
    setIntent(null);
    setNotice('');
    setIntentNotice('');
    setRouteEditor(null);
    setAutomationEditor(null);
    setAppSecret('');
    setWorkspace((current) => ({
      ...current,
      selectedConnectionId: connectionId,
      creation: {
        ...current.creation,
        state: 'idle',
        returnToId: null,
      },
    }));
  }

  function returnToConnections() {
    setIntent(null);
    setNotice('');
    setAppSecret('');
    setWorkspace((current) => ({
      ...current,
      selectedConnectionId: null,
    }));
  }

  function requestConfirmation(action: ConfirmAction, source: HTMLElement) {
    confirmSource.current = source;
    setConfirming(action);
  }

  function completeConfirmation() {
    if (!confirming) return;
    if (confirming.kind === 'route') {
      updateConnection((current) => ({
        ...current,
        routes: current.routes.filter((item) => item.id !== confirming.id),
        drafts: {
          ...current.drafts,
          route: current.drafts.route?.editingId === confirming.id ? null : current.drafts.route,
        },
      }));
      setIntentNotice('Conversation preference removed.');
    }
    if (confirming.kind === 'automation') {
      updateConnection((current) => ({
        ...current,
        automations: current.automations.filter((item) => item.id !== confirming.id),
        drafts: {
          ...current.drafts,
          automation: current.drafts.automation?.editingId === confirming.id ? null : current.drafts.automation,
        },
      }));
      setIntentNotice('Automation deleted.');
    }
    if (confirming.kind === 'account') {
      updateConnection((current) => ({
        ...current,
        account: { state: 'disconnected', name: '', email: '' },
        automations: current.automations.map((item) => (
          item.trigger === 'document' ? { ...item, enabled: false } : item
        )),
      }));
      setIntentNotice('Personal Lark access removed.');
    }
    if (confirming.kind === 'connection') {
      const connectionId = selectedConnection?.id;
      if (connectionId) deleteConnection(connectionId);
    }
    confirmSource.current = intentHeading.current;
    setConfirming(null);
  }

  function renderCollection() {
    return (
      <main className="pt-lark-main pt-lark-main--collection">
        {workspace.connections.length === 0 ? (
          <div className="pt-lark-empty">
            <span className="pt-lark-larkmark pt-lark-larkmark--large"><MessageSquareText size={28} /></span>
            <h2>Connect Lark to Peers</h2>
            <p>Connect a managed or existing Lark app. Message routing is configured after the connection is ready.</p>
            <Button type="primary" onClick={startConnection}>
              Add Lark connection
              <ArrowRight size={16} />
            </Button>
          </div>
        ) : (
          <>
            <header className="pt-lark-collection-title">
              <div>
                <span className="pt-lark-kicker">Connected identities</span>
                <h2>{workspace.connections.length} Lark {workspace.connections.length === 1 ? 'connection' : 'connections'}</h2>
                <p>Each app connection is independent. Open one to configure message handling, access, and delivery.</p>
              </div>
            </header>
            {notice ? (
              <div className="pt-lark-notice" role="status">
                <Check size={16} />
                <span>{notice}</span>
                <button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={15} /></button>
              </div>
            ) : null}
            <div className="pt-lark-connections" data-ui-rows="lark-connections">
              {workspace.connections.map((item) => (
                <button
                  type="button"
                  className="pt-lark-connection-row"
                  data-ui-row
                  key={item.id}
                  onClick={() => selectConnection(item.id)}
                >
                  <span className="pt-lark-connection-row__mark" data-ui-column="icon" data-ui-column-align="center" data-ui-row-center>
                    <span className="pt-lark-larkmark"><MessageSquareText size={18} /></span>
                  </span>
                  <span className="pt-lark-connection-row__copy" data-ui-column="content" data-ui-column-align="start">
                    <span>
                      <b>{item.name}</b>
                      {item.isDefault ? <em>Default</em> : null}
                    </span>
                    <small>{item.app.name} · {item.agent ? `Responder: ${agentLabel(item.agent)}` : 'No responder configured'}</small>
                  </span>
                  <Status
                    tone={item.state === 'attention' ? 'warning' : item.state === 'disabled' ? 'neutral' : 'positive'}
                  >
                    {item.state === 'attention' ? 'Needs attention' : item.state === 'disabled' ? 'Paused' : 'Connected'}
                  </Status>
                  <ChevronRight data-ui-column="actions" data-ui-column-align="end" data-ui-row-center size={17} aria-hidden="true" />
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    );
  }

  function renderConnectionProgress() {
    const scanning = workspace.creation.state === 'scan';
    return (
      <div className="pt-lark-create-progress">
          {scanning ? (
            <>
              <div className="pt-lark-qr" aria-label="QR code preview">
                <QrCode size={96} strokeWidth={1.15} />
              </div>
              <h2>Scan with Lark</h2>
              <p>Open Lark on your phone and scan this code to create the app connection.</p>
              <Button
                type="primary"
                onClick={() => setWorkspace((current) => ({
                  ...current,
                  creation: { ...current.creation, state: 'connecting' },
                }))}
              >
                Demo: I scanned it
              </Button>
            </>
          ) : (
            <>
              <span className="pt-lark-progressmark" aria-hidden="true"><span /></span>
              <h2>Finishing the connection</h2>
              <p>Peers is creating the Lark identity and enabling its messaging connection.</p>
              <div className="pt-lark-connect__checks" role="status">
                <span><Check size={15} /> Identity confirmed</span>
                <span><Check size={15} /> Messaging ready</span>
                <span className="is-current"><RefreshCw size={15} /> Saving connection</span>
              </div>
            </>
          )}
        <div className="pt-lark-create-dialog__actions">
          {scanning ? (
            <Button
              onClick={() => {
                setWorkspace((current) => ({
                  ...current,
                  creation: { ...current.creation, state: 'idle' },
                }));
                setCreateMethod('managed');
              }}
            >
              <ArrowLeft size={15} />
              Back
            </Button>
          ) : <span />}
          <span />
          {scanning ? <Button onClick={cancelConnectionCreation}>Cancel</Button> : null}
        </div>
      </div>
    );
  }

  function renderCreateDialog() {
    if (!createDialogOpen) return null;
    const provisioning = workspace.creation.state === 'scan'
      || workspace.creation.state === 'connecting';
    const platformField = (
      <label>
        <span>Platform</span>
        <select
          value={createPlatform}
          onChange={(event) => setCreatePlatform(event.target.value as 'feishu' | 'lark')}
        >
          <option value="feishu">Feishu (China)</option>
          <option value="lark">Lark (International)</option>
        </select>
      </label>
    );
    const managedPane = (
      <div className="pt-lark-create-tab-pane">
        <div className="pt-lark-create-grid">
          <label>
            <span>App name</span>
            <input
              autoComplete="off"
              value={managedAppName}
              onChange={(event) => setManagedAppName(event.target.value)}
            />
          </label>
          {platformField}
          <div className="pt-lark-create-dialog__notice">
            <QrCode size={17} />
            <span><b>Continue with QR code</b><small>A Lark QR code opens after these connection settings are confirmed.</small></span>
          </div>
        </div>
        <div className="pt-lark-create-summary">
          <span><Check size={14} /> Identity, events, and messaging configured together</span>
          <span><Check size={14} /> Routing and access remain editable after connection</span>
        </div>
        <div className="pt-lark-create-dialog__actions">
          <span />
          <Button onClick={cancelConnectionCreation}>Cancel</Button>
          <Button type="primary" disabled={!managedAppName.trim()} onClick={beginManagedConnection}>Continue</Button>
        </div>
      </div>
    );
    const customPane = (
      <div className="pt-lark-create-tab-pane">
        {renderAppForm(false, false, platformField)}
        <div className="pt-lark-create-dialog__actions">
          <span />
          <Button onClick={cancelConnectionCreation}>Cancel</Button>
          {appCheck.state === 'idle' ? (
            <Button
              type="primary"
              disabled={!activeAppId.trim() || !appSecret}
              onClick={startAppCheck}
            >
              Check app
            </Button>
          ) : null}
          {appCheck.state === 'needs_repair' ? (
            <Button
              type="primary"
              onClick={() => setAppCheck({ state: 'checking', issues: [], repairing: true })}
            >
              Repair automatically
            </Button>
          ) : null}
          {appCheck.state === 'ready' ? (
            <Button type="primary" onClick={connectCustomApp}>Connect this app</Button>
          ) : null}
        </div>
      </div>
    );
    return (
      <Modal
        centered
        destroyOnHidden
        enableResponsive={false}
        footer={null}
        open
        rootClassName="pt-lark-create-modal"
        title="Add Lark connection"
        width={560}
        onCancel={cancelConnectionCreation}
        styles={{
          container: { borderRadius: 12, padding: 20 },
          body: {
            maxHeight: 'calc(100vh - 160px)',
            overflowY: 'auto',
            padding: 0,
          },
        }}
      >
        {provisioning ? renderConnectionProgress() : null}
        {!provisioning ? (
          <Tabs
            activeKey={createMethod}
            destroyOnHidden
            items={[
              { key: 'managed', label: 'Create managed app', children: managedPane },
              { key: 'custom', label: 'Use existing app', children: customPane },
            ]}
            size="small"
            onChange={(key) => {
              if (key === 'custom') openCreateWithExistingApp();
              else {
                setCreateMethod('managed');
                setAppCheck({ state: 'idle', issues: [], repairing: false });
              }
            }}
          />
        ) : null}
      </Modal>
    );
  }

  function renderIntentHeader(title: string, description: string, onBack?: () => void) {
    return (
      <header className="pt-lark-intent__header">
        <button
          type="button"
          aria-label={onBack ? `Back from ${title}` : 'Back to Lark connection'}
          onClick={onBack ?? (() => setIntent(null))}
        >
          <ArrowLeft size={17} />
        </button>
        <div>
          <h3 ref={intentHeading} tabIndex={-1}>{title}</h3>
          <p>{description}</p>
        </div>
      </header>
    );
  }

  function renderIntentNotice() {
    if (!intentNotice) return null;
    return (
      <div className="pt-lark-inline-notice" role="status">
        <Check size={15} />
        <span>{intentNotice}</span>
        <button type="button" aria-label="Dismiss" onClick={() => setIntentNotice('')}><X size={14} /></button>
      </div>
    );
  }

  function renderRouteIntent() {
    const draft = drafts.route;
    if (routeEditor && draft) {
      return (
        <section className="pt-lark-intent">
          {renderIntentHeader(
            draft.editingId ? 'Edit conversation Agent' : 'Use another Agent here',
            'This preference affects one Lark conversation and leaves the rest of the connection unchanged.',
            () => setRouteEditor(null),
          )}
          <div className="pt-lark-focused-form">
            <label>
              <span>Conversation</span>
              <select
                value={draft.conversation}
                onChange={(event) => updateDrafts({ route: { ...draft, conversation: event.target.value } })}
              >
                {Object.entries(conversationNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>
              <span>Agent</span>
              <select
                value={draft.agent}
                onChange={(event) => updateDrafts({ route: { ...draft, agent: event.target.value } })}
              >
                {Object.entries(agentNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <div className="pt-lark-focused-form__preview" aria-live="polite">
              <Route size={17} />
              <span>Messages in <b>{conversationNames[draft.conversation]}</b> will go to <b>{agentLabel(draft.agent)}</b>.</span>
            </div>
            {routeError ? <p className="pt-lark-field-error" role="alert">{routeError}</p> : null}
            <Button type="primary" onClick={saveRoute}>Save preference</Button>
          </div>
        </section>
      );
    }

    return (
      <section className="pt-lark-intent">
        {renderIntentHeader('Conversation Agents', 'Use a different Agent only where it produces a better result.')}
        {renderIntentNotice()}
        <div className="pt-lark-collection-header">
          <div>
            <b>{connection.routes.length ? 'Saved preferences' : 'No conversation preferences yet'}</b>
            <small>Every other conversation uses {agentLabel(connection.agent)}.</small>
          </div>
          <Button icon={Plus} type="primary" onClick={beginNewRoute}>Add preference</Button>
        </div>
        {draft ? (
          <div className="pt-lark-draft-row">
            <span><b>Unsaved preference</b><small>{conversationNames[draft.conversation]} · {agentLabel(draft.agent)}</small></span>
            <button type="button" onClick={() => setRouteEditor(draft.editingId ?? 'new')}>Resume</button>
            <button type="button" onClick={() => updateDrafts({ route: null })}>Discard</button>
          </div>
        ) : null}
        <div className="pt-lark-managed-list" data-ui-rows="conversation-preferences">
          {connection.routes.map((route) => (
            <div className="pt-lark-managed-row" data-ui-row key={route.id}>
              <span className="pt-lark-managed-row__icon" data-ui-column="icon" data-ui-column-align="center" data-ui-row-center><Route size={16} /></span>
              <span className="pt-lark-managed-row__copy" data-ui-column="content" data-ui-column-align="start">
                <b>{conversationNames[route.conversation]}</b>
                <small>{agentLabel(route.agent)} · {route.enabled ? 'Active' : 'Paused'}</small>
              </span>
              <span className="pt-lark-managed-row__actions" data-ui-column="actions" data-ui-column-align="end" data-ui-controls-align="end" data-ui-row-center>
                <button
                  type="button"
                  role="switch"
                  title={`${route.enabled ? 'Pause' : 'Resume'} ${conversationNames[route.conversation]}`}
                  aria-checked={route.enabled}
                  aria-label={`${route.enabled ? 'Pause' : 'Resume'} ${conversationNames[route.conversation]}`}
                  className={`pt-lark-switch${route.enabled ? ' is-on' : ''}`}
                  onClick={() => updateConnection((current) => ({
                    ...current,
                    routes: current.routes.map((item) => item.id === route.id ? { ...item, enabled: !item.enabled } : item),
                  }))}
                ><span /></button>
                <button type="button" title={`Edit ${conversationNames[route.conversation]}`} className="pt-lark-icon-action" aria-label={`Edit ${conversationNames[route.conversation]}`} onClick={() => editRoute(route)}><Pencil size={15} /></button>
                <button
                  type="button"
                  title={`Remove ${conversationNames[route.conversation]}`}
                  className="pt-lark-icon-action pt-lark-icon-action--danger"
                  aria-label={`Remove ${conversationNames[route.conversation]}`}
                  onClick={(event) => requestConfirmation({ kind: 'route', id: route.id }, event.currentTarget)}
                ><Trash2 size={15} /></button>
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderAutomationIntent() {
    const draft = drafts.automation;
    if (automationEditor && draft) {
      return (
        <section className="pt-lark-intent">
          {renderIntentHeader(
            draft.editingId ? 'Edit automation' : 'Create an automation',
            'Describe the result. Peers handles the event, execution, and delivery details.',
            () => setAutomationEditor(null),
          )}
          <div className="pt-lark-focused-form">
            <label>
              <span>When</span>
              <select
                value={draft.trigger}
                onChange={(event) => {
                  const trigger = event.target.value as TriggerType;
                  const triggerValue = trigger === 'schedule'
                    ? 'Every Friday at 5 PM'
                    : trigger === 'message' ? 'launch' : 'Project brief';
                  updateDrafts({ automation: { ...draft, trigger, triggerValue } });
                }}
              >
                <option value="schedule">On a schedule</option>
                <option value="message">I receive a specific message</option>
                <option value="document">A document changes</option>
              </select>
            </label>
            <label>
              <span>{draft.trigger === 'schedule' ? 'Schedule' : draft.trigger === 'message' ? 'Message contains' : 'Document name contains'}</span>
              <input
                value={draft.triggerValue}
                onChange={(event) => updateDrafts({ automation: { ...draft, triggerValue: event.target.value } })}
              />
            </label>
            <label>
              <span>Do this</span>
              <textarea
                value={draft.action}
                rows={3}
                onChange={(event) => updateDrafts({ automation: { ...draft, action: event.target.value } })}
              />
            </label>
            <div className="pt-lark-form-grid">
              <label>
                <span>Agent</span>
                <select
                  value={draft.agent}
                  onChange={(event) => updateDrafts({ automation: { ...draft, agent: event.target.value } })}
                >
                  {Object.entries(agentNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <label>
                <span>Send result to</span>
                <select
                  value={draft.destination}
                  onChange={(event) => updateDrafts({ automation: { ...draft, destination: event.target.value } })}
                >
                  {Object.entries(destinationNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            </div>
            <div className="pt-lark-focused-form__preview" aria-live="polite">
              <CalendarClock size={17} />
              <span><b>{triggerLabel(draft.trigger, draft.triggerValue || '...')}</b>. {agentLabel(draft.agent)} will {draft.action || 'perform the requested action'} and send the result to <b>{destinationNames[draft.destination]}</b>.</span>
            </div>
            {automationError ? <p className="pt-lark-field-error" role="alert">{automationError}</p> : null}
            <Button type="primary" onClick={saveAutomation}>Save automation</Button>
          </div>
        </section>
      );
    }

    return (
      <section className="pt-lark-intent">
        {renderIntentHeader('Automations', 'Review what runs, where results go, and what happened last time.')}
        {renderIntentNotice()}
        <div className="pt-lark-collection-header">
          <div>
            <b>{connection.automations.length ? 'Your automations' : 'No automations yet'}</b>
            <small>Each automation keeps its trigger, Agent, destination, and delivery result together.</small>
          </div>
          <Button icon={Plus} type="primary" onClick={beginNewAutomation}>New automation</Button>
        </div>
        {draft ? (
          <div className="pt-lark-draft-row">
            <span><b>Unsaved automation</b><small>{triggerLabel(draft.trigger, draft.triggerValue)}</small></span>
            <button type="button" onClick={() => setAutomationEditor(draft.editingId ?? 'new')}>Resume</button>
            <button type="button" onClick={() => updateDrafts({ automation: null })}>Discard</button>
          </div>
        ) : null}
        <div className="pt-lark-managed-list" data-ui-rows="automations">
          {connection.automations.map((automation) => (
            <div className="pt-lark-managed-row pt-lark-managed-row--automation" data-ui-row key={automation.id}>
              <span className="pt-lark-managed-row__icon" data-ui-column="icon" data-ui-column-align="center" data-ui-row-center><Zap size={16} /></span>
              <span className="pt-lark-managed-row__copy" data-ui-column="content" data-ui-column-align="start">
                <b>{triggerLabel(automation.trigger, automation.triggerValue)}</b>
                <small>{automation.action}</small>
                <em>{agentLabel(automation.agent)} → {destinationNames[automation.destination]} · {automation.enabled ? 'Active' : 'Paused'} · {automation.lastRun === 'never' ? 'Never run' : automation.lastRun === 'running' ? 'Running now' : `${automation.lastRun === 'delivered' ? 'Delivered' : 'Failed'} ${automation.lastRunAt ?? ''}`}</em>
              </span>
              <span className="pt-lark-managed-row__actions" data-ui-column="actions" data-ui-column-align="end" data-ui-controls-align="end" data-ui-row-center>
                <button
                  type="button"
                  title="Run now"
                  className="pt-lark-icon-action"
                  aria-label={`Run ${triggerLabel(automation.trigger, automation.triggerValue)} now`}
                  disabled={automation.lastRun === 'running'}
                  onClick={() => runAutomation(automation.id)}
                >{automation.lastRun === 'running' ? <RefreshCw className="is-spinning" size={15} /> : <Play size={15} />}</button>
                <button
                  type="button"
                  title={automation.enabled ? 'Pause automation' : 'Resume automation'}
                  className="pt-lark-icon-action"
                  aria-label={`${automation.enabled ? 'Pause' : 'Resume'} automation`}
                  onClick={() => updateConnection((current) => ({
                    ...current,
                    automations: current.automations.map((item) => item.id === automation.id ? { ...item, enabled: !item.enabled } : item),
                  }))}
                >{automation.enabled ? <Pause size={15} /> : <Play size={15} />}</button>
                <button type="button" title="Edit automation" className="pt-lark-icon-action" aria-label="Edit automation" onClick={() => editAutomation(automation)}><Pencil size={15} /></button>
                <button
                  type="button"
                  title="Delete automation"
                  className="pt-lark-icon-action pt-lark-icon-action--danger"
                  aria-label="Delete automation"
                  onClick={(event) => requestConfirmation({ kind: 'automation', id: automation.id }, event.currentTarget)}
                ><Trash2 size={15} /></button>
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  function renderAccountIntent() {
    const account = connection.account;
    return (
      <section className="pt-lark-intent">
        {renderIntentHeader('Use my Lark work', 'Personal access is separate from the Bot connection and is requested only when needed.')}
        {renderIntentNotice()}
        <div className="pt-lark-permission">
          <span className={`pt-lark-permission__mark${account.state === 'expired' ? ' is-warning' : ''}`}>
            {account.state === 'expired' ? <CircleAlert size={24} /> : <ShieldCheck size={24} />}
          </span>
          {account.state === 'authorizing' ? (
            <>
              <h4>Waiting for Lark authorization</h4>
              <p>Confirm the account on the Lark page. The Bot connection remains available while you decide.</p>
              <div className="pt-lark-account-progress" role="status"><RefreshCw className="is-spinning" size={16} /> Opening secure authorization</div>
              <Button onClick={() => updateConnection((current) => ({
                ...current,
                account: { state: 'disconnected', name: '', email: '' },
              }))}>Cancel</Button>
            </>
          ) : account.state === 'connected' ? (
            <>
              <h4>{account.name}</h4>
              <p>{account.email}</p>
              <div className="pt-lark-permission-list">
                <span><Check size={15} /> Read items you can access</span>
                <span><Check size={15} /> Create drafts for your approval</span>
                <span><Check size={15} /> Ask again before sensitive writes</span>
              </div>
              <Button
                danger
                onClick={(event) => requestConfirmation({ kind: 'account' }, event.currentTarget)}
              >Remove access</Button>
            </>
          ) : account.state === 'expired' ? (
            <>
              <h4>Your personal access expired</h4>
              <p>Automations that need your documents or calendar are paused. The Bot connection is unaffected.</p>
              <div className="pt-lark-permission-list">
                <span><CircleAlert size={15} /> Existing permissions need confirmation</span>
                <span><Check size={15} /> Your connection and drafts are preserved</span>
              </div>
              <div className="pt-lark-button-row">
                <Button type="primary" onClick={() => updateConnection((current) => ({
                  ...current,
                  account: { ...current.account, state: 'authorizing' },
                }))}>Reconnect</Button>
                <Button
                  danger
                  onClick={(event) => requestConfirmation({ kind: 'account' }, event.currentTarget)}
                >Remove access</Button>
              </div>
            </>
          ) : (
            <>
              <h4>Connect your personal Lark account</h4>
              <p>Your Agent can work with documents, calendar, and contacts you can access. Bot access never becomes personal access.</p>
              <div className="pt-lark-permission-list">
                <span><Check size={15} /> Read items you can access</span>
                <span><Check size={15} /> Create drafts for your approval</span>
                <span><Check size={15} /> Revoke access at any time</span>
              </div>
              <Button type="primary" onClick={() => updateConnection((current) => ({
                ...current,
                account: { ...current.account, state: 'authorizing' },
              }))}>Connect my Lark</Button>
            </>
          )}
        </div>
      </section>
    );
  }

  function renderAppForm(
    replacing: boolean,
    actionsInline = true,
    leadingField?: ReactNode,
  ) {
    return (
      <div className={`pt-lark-focused-form${leadingField ? ' is-three-columns' : ''}`}>
          {leadingField}
          <label>
            <span>App ID</span>
            <input
              ref={appIdInput}
              value={activeAppId}
              aria-invalid={Boolean(appErrors.appId)}
              placeholder="cli_a1b2c3..."
              onChange={(event) => {
                updateActiveAppId(event.target.value);
                setAppErrors((current) => ({ ...current, appId: undefined }));
                setAppCheck({ state: 'idle', issues: [], repairing: false });
              }}
            />
            {appErrors.appId ? <small className="pt-lark-field-error" role="alert">{appErrors.appId}</small> : null}
          </label>
          <label>
            <span>App Secret</span>
            <input
              ref={appSecretInput}
              type="password"
              value={appSecret}
              aria-invalid={Boolean(appErrors.secret)}
              onChange={(event) => {
                setAppSecret(event.target.value);
                setAppErrors((current) => ({ ...current, secret: undefined }));
                setAppCheck({ state: 'idle', issues: [], repairing: false });
              }}
            />
            {appErrors.secret ? <small className="pt-lark-field-error" role="alert">{appErrors.secret}</small> : null}
          </label>
          <p className="pt-lark-form-note">Sent to your Station, encrypted at rest, and never returned to this client.</p>
          {actionsInline && appCheck.state === 'idle'
            ? <Button type="primary" onClick={startAppCheck}>Check app</Button>
            : null}
          {appCheck.state === 'checking' ? (
            <div className="pt-lark-app-check" role="status">
              <RefreshCw className="is-spinning" size={17} />
              <span><b>{appCheck.repairing ? 'Repairing the app' : 'Checking the app'}</b><small>Identity, messages, events, and access</small></span>
            </div>
          ) : null}
          {appCheck.state === 'needs_repair' ? (
            <div className="pt-lark-app-result pt-lark-app-result--warning">
              <CircleAlert size={18} />
              <span>
                <b>The app needs two fixes</b>
                {appCheck.issues.map((issue) => <small key={issue}>{issue}</small>)}
              </span>
              {actionsInline ? (
                <Button type="primary" onClick={() => setAppCheck({ state: 'checking', issues: [], repairing: true })}>Repair automatically</Button>
              ) : null}
            </div>
          ) : null}
          {appCheck.state === 'ready' ? (
            <div className="pt-lark-app-result">
              <Check size={18} />
              <span><b>The app is ready</b><small>Identity confirmed · Messages verified · Events available</small></span>
              <p>{replacing ? 'This replaces the app behind the connection. Agent choices, preferences, automations, and history stay intact.' : 'This app will become the Lark identity for this connection.'}</p>
              {actionsInline ? (
                <Button type="primary" onClick={connectCustomApp}>{replacing ? 'Replace current app' : 'Connect this app'}</Button>
              ) : null}
            </div>
          ) : null}
      </div>
    );
  }

  function renderAppIntent() {
    const replacing = appMode === 'replace' && Boolean(selectedConnection);
    return (
      <section className="pt-lark-intent">
        {renderIntentHeader(
          'Use an existing Lark app',
          'Peers checks the app first and changes this connection only after you confirm.',
        )}
        <div className="pt-lark-current-app">
          <FileKey size={17} />
          <span><small>Current connection</small><b>{connection.app.name}</b></span>
          <Status tone={connection.app.state === 'ready' ? 'positive' : 'warning'}>{connection.app.state === 'ready' ? 'Ready' : 'Needs repair'}</Status>
        </div>
        {renderAppForm(replacing)}
      </section>
    );
  }

  function renderHealthIntent() {
    const appReady = connection.app.state === 'ready';
    const connectionReady = connection.state !== 'attention';
    const responderReady = Boolean(connection.agent);
    return (
      <section className="pt-lark-intent">
        {renderIntentHeader('Check the connection', 'One check covers the Lark identity, message path, and message handling.')}
        <div className="pt-lark-health">
          <div className={appReady ? '' : 'is-warning'}>
            {appReady ? <Check size={16} /> : <CircleAlert size={16} />}
            <span><b>{connection.app.name}</b><small>{appReady ? 'Identity and access available' : connection.app.issues.join(' · ')}</small></span>
          </div>
          <div className={connectionReady ? '' : 'is-warning'}>
            {connectionReady ? <Check size={16} /> : <CircleAlert size={16} />}
            <span><b>Messages</b><small>{connectionReady ? 'Receiving and sending' : 'Delivery path is interrupted'}</small></span>
          </div>
          <div className={responderReady ? '' : 'is-warning'}>
            {responderReady ? <Check size={16} /> : <CircleAlert size={16} />}
            <span><b>Default responder</b><small>{responderReady ? `${agentLabel(connection.agent)} handles new messages` : 'Choose an Agent after connecting the app'}</small></span>
          </div>
          {!appReady ? (
            <Button type="primary" onClick={() => openIntent('app')}>Repair app</Button>
          ) : !connectionReady ? (
            <Button type="primary" onClick={() => {
              updateConnection({ state: 'connecting' });
              setIntent(null);
            }}><RefreshCw size={15} /> Repair connection</Button>
          ) : !responderReady ? (
            <Button type="primary" onClick={() => openIntent('agent')}>Choose Agent</Button>
          ) : (
            <Button onClick={() => setIntent(null)}>Done</Button>
          )}
        </div>
      </section>
    );
  }

  function renderIntent() {
    if (!intent) return null;
    if (intent === 'agent') {
      return (
        <section className="pt-lark-intent">
          {renderIntentHeader('Choose the Agent', 'The connection stays the same. New messages go to the Agent you choose.')}
          <div className="pt-lark-agent-list" role="radiogroup" aria-label="Agent">
            {Object.entries(agentNames).map(([id, name]) => (
              <button
                type="button"
                role="radio"
                aria-checked={connection.agent === id}
                className={connection.agent === id ? 'is-selected' : ''}
                key={id}
                onClick={() => {
                  updateConnection({ agent: id });
                  setIntent(null);
                  setNotice(`${name} will handle new Lark messages.`);
                }}
              >
                <AgentMark agent={id} />
                <span><b>{name}</b><small>{id === 'alice' ? 'Everyday assistant' : id === 'research' ? 'Research and synthesis' : 'Build and create'}</small></span>
                {connection.agent === id ? <Check size={17} /> : null}
              </button>
            ))}
          </div>
        </section>
      );
    }
    if (intent === 'routing') return renderRouteIntent();
    if (intent === 'automation') return renderAutomationIntent();
    if (intent === 'account') return renderAccountIntent();
    if (intent === 'app') return renderAppIntent();
    if (intent === 'conversations') {
      return (
        <section className="pt-lark-intent">
          {renderIntentHeader('Lark conversations', 'Open a conversation or choose a different Agent for it.')}
          <div className="pt-lark-conversation-list" data-ui-rows="lark-conversations">
            {Object.entries(conversationNames).map(([id, name], index) => {
              const route = connection.routes.find((item) => item.conversation === id && item.enabled);
              return (
                <button
                  type="button"
                  data-ui-row
                  key={id}
                  onClick={() => setIntentNotice(`${name} opened in the conversation workspace.`)}
                >
                  <span data-ui-column="icon" data-ui-column-align="center" data-ui-row-center><MessageSquareText size={16} /></span>
                  <span data-ui-column="content" data-ui-column-align="start">
                    <b>{name}</b>
                    <small>{route ? agentLabel(route.agent) : agentLabel(connection.agent)} · {index === 0 ? 'Active just now' : `${index + 1}h ago`}</small>
                  </span>
                  <ChevronRight data-ui-column="actions" data-ui-column-align="end" data-ui-row-center size={16} />
                </button>
              );
            })}
          </div>
          {renderIntentNotice()}
          <Button onClick={() => openIntent('routing')}>Manage conversation Agents</Button>
        </section>
      );
    }
    if (intent === 'activity') {
      return (
        <section className="pt-lark-intent">
          {renderIntentHeader('Connection activity', 'Recent delivery and connection events for this Lark identity.')}
          <div className="pt-lark-activity">
            <div><Check size={16} /><span><b>Connection checked</b><small>Identity, messages, and Agent available · Just now</small></span></div>
            <div><MessageSquareText size={16} /><span><b>Inbound message received</b><small>Design discussion · 4 min ago</small></span></div>
            <div><ArrowRight size={16} /><span><b>Agent reply delivered</b><small>{agentLabel(connection.agent)} · 4 min ago</small></span></div>
            {connection.testDelivery.deliveredAt ? (
              <div><Check size={16} /><span><b>Test message delivered</b><small>{connection.testDelivery.recipient} · {connection.testDelivery.deliveredAt}</small></span></div>
            ) : null}
          </div>
          <Button onClick={() => openIntent('health')}>Run connection check</Button>
        </section>
      );
    }
    return renderHealthIntent();
  }

  function sendTestMessage() {
    if (!connection.testDelivery.recipient.trim() || !connection.testDelivery.message.trim()) return;
    updateConnection((current) => ({
      ...current,
      testDelivery: {
        ...current.testDelivery,
        state: 'sending',
        messageId: null,
        deliveredAt: null,
      },
    }));
  }

  function renderTestDelivery() {
    const delivery = connection.testDelivery;
    if (delivery.state === 'delivered') {
      return (
        <div className="pt-lark-test-result pt-lark-test-result--positive" role="status">
          <Check size={17} />
          <span><b>Delivered to {delivery.recipient}</b><small>{delivery.deliveredAt} · Message {delivery.messageId?.slice(-5)}</small></span>
          <Button onClick={sendTestMessage}>Send again</Button>
        </div>
      );
    }
    if (delivery.state === 'failed') {
      return (
        <div className="pt-lark-test-result pt-lark-test-result--warning" role="alert">
          <CircleAlert size={17} />
          <span><b>Test message was not delivered</b><small>Your connection is preserved. Retry the delivery without reconnecting.</small></span>
          <Button type="primary" onClick={sendTestMessage}>Retry</Button>
        </div>
      );
    }
    return (
      <Button
        type="primary"
        disabled={
          delivery.state === 'sending' ||
          connection.state === 'disabled' ||
          !delivery.recipient.trim() ||
          !delivery.message.trim()
        }
        onClick={sendTestMessage}
      >
        {connection.state === 'disabled'
          ? 'Resume connection to test'
          : delivery.state === 'sending' ? 'Sending to Lark...' : `Send to ${delivery.recipient}`}
        {delivery.state === 'sending' ? <RefreshCw className="is-spinning" size={15} /> : <ArrowRight size={15} />}
      </Button>
    );
  }

  function renderConnected() {
    return (
      <main className="pt-lark-main">
        <div className="pt-lark-detail-nav">
          <button type="button" onClick={returnToConnections}><ArrowLeft size={16} /> All Lark connections</button>
          <div>
            {!connection.isDefault ? <button type="button" onClick={() => makeDefault(connection.id)}>Make default</button> : <span>Default connection</span>}
            <button type="button" onClick={() => toggleConnection(connection.id)}>
              {connection.state === 'disabled' ? <Play size={15} /> : <Pause size={15} />}
              {connection.state === 'disabled' ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
        <section className="pt-lark-workspace">
          <header className="pt-lark-workspace__header">
            <div className="pt-lark-workspace__identity">
              <div className="pt-lark-workspace__marks">
                <span className="pt-lark-larkmark"><MessageSquareText size={18} /></span>
              </div>
              <div>
                <span className="pt-lark-kicker">Lark connection</span>
                <h2>{connection.name}</h2>
                <p>Message naturally in Lark. Peers handles conversations, files, and context without another setup screen.</p>
              </div>
            </div>
            <div className="pt-lark-workspace__status">
              <Status tone={connection.state === 'attention' ? 'warning' : connection.state === 'connected' ? 'positive' : 'neutral'}>
                {connection.state === 'attention'
                  ? 'Needs attention'
                  : connection.state === 'disabled' ? 'Paused' : connection.state === 'connecting' ? 'Repairing' : 'Connected'}
              </Status>
              <Button onClick={() => openIntent('activity')}><HeartPulse size={14} /> Activity</Button>
              <Button onClick={() => openIntent('health')}><ShieldCheck size={14} /> Check</Button>
            </div>
          </header>

          {notice ? (
            <div className="pt-lark-notice" role="status">
              <Check size={16} />
              <span>{notice}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={15} /></button>
            </div>
          ) : null}

          {connection.state === 'attention' || !connection.agent ? (
            <div className="pt-lark-recovery">
              <CircleAlert size={20} />
              <div>
                <b>{connection.agent ? 'Lark cannot reach your Agent' : 'Choose how messages are handled'}</b>
                <p>{connection.agent ? 'Your connection and settings are preserved.' : 'The Lark app is connected. Choose a default Agent before Peers handles new messages.'}</p>
              </div>
              <Button type="primary" onClick={() => openIntent(connection.agent ? 'health' : 'agent')}>
                {connection.agent ? 'Repair' : 'Choose Agent'}
              </Button>
            </div>
          ) : null}

          <div className="pt-lark-workspace__grid">
            <div className="pt-lark-config-panel">
              <div className="pt-lark-config-row">
                <div className="pt-lark-config-row__label">
                  <AgentMark agent={connection.agent} />
                  <span><small>Default responder</small><b>{agentLabel(connection.agent)}</b></span>
                </div>
                <Button onClick={() => openIntent('agent')}>
                  {connection.agent ? 'Change Agent' : 'Choose Agent'}
                  <ChevronRight size={16} />
                </Button>
              </div>

              <div className="pt-lark-facts">
                <span><small>Lark app</small><b>{connection.app.mode === 'custom' ? 'Custom app' : 'Managed app'}</b></span>
                <span><small>Routes</small><b>{connection.routes.length}</b></span>
                <span><small>Automations</small><b>{activeAutomations}</b></span>
                <span><small>Personal access</small><b>{connection.account.state}</b></span>
              </div>

              <div className="pt-lark-workspace__intents">
                <IntentRow
                  icon={MessageSquareText}
                  title="Conversations"
                  description="Review recent Lark conversations and their Agent."
                  onClick={() => openIntent('conversations')}
                />
                <IntentRow
                  icon={Route}
                  title="Conversation Agents"
                  description="Use a different Agent in selected conversations."
                  value={drafts.route ? 'Draft' : connection.routes.length ? `${connection.routes.length} saved` : undefined}
                  onClick={() => openIntent('routing')}
                />
                <IntentRow
                  icon={Zap}
                  title="Automations"
                  description="Act on a message, schedule, or document change."
                  value={drafts.automation ? 'Draft' : activeAutomations ? `${activeAutomations} active` : undefined}
                  onClick={() => openIntent('automation')}
                />
                <IntentRow
                  icon={UserRound}
                  title="Use my Lark work"
                  description="Let your Agent work with your documents and calendar."
                  value={connection.account.state === 'connected' ? connection.account.name : connection.account.state === 'expired' ? 'Reconnect' : undefined}
                  onClick={() => openIntent('account')}
                />
              </div>
            </div>

            <aside className="pt-lark-test-panel">
              <div>
                <span className="pt-lark-kicker">Ready to use</span>
                <h3>Send a test message</h3>
                <p>Choose a target and verify the exact outbound message path.</p>
              </div>
              <div className="pt-lark-test-form">
                <label>
                  <span>Send to</span>
                  <input
                    value={connection.testDelivery.recipient}
                    onChange={(event) => updateConnection((current) => ({
                      ...current,
                      testDelivery: {
                        ...current.testDelivery,
                        state: 'idle',
                        recipient: event.target.value,
                        messageId: null,
                        deliveredAt: null,
                      },
                    }))}
                  />
                </label>
                <label>
                  <span>Message</span>
                  <textarea
                    rows={3}
                    value={connection.testDelivery.message}
                    onChange={(event) => updateConnection((current) => ({
                      ...current,
                      testDelivery: {
                        ...current.testDelivery,
                        state: 'idle',
                        message: event.target.value,
                        messageId: null,
                        deliveredAt: null,
                      },
                    }))}
                  />
                </label>
                {renderTestDelivery()}
              </div>
            </aside>
          </div>

          <details className="pt-lark-more">
            <summary>Connection options</summary>
            <div>
              <IntentRow
                icon={FileKey}
                title="Use an existing Lark app"
                description={connection.app.mode === 'custom' ? connection.app.name : 'Bring an app you already manage.'}
                value={connection.app.mode === 'custom' ? 'In use' : undefined}
                onClick={() => openIntent('app')}
              />
              <button
                type="button"
                className="pt-lark-disconnect"
                onClick={(event) => requestConfirmation({ kind: 'connection' }, event.currentTarget)}
              >
                <Trash2 size={16} />
                Delete this connection
              </button>
            </div>
          </details>
        </section>
      </main>
    );
  }

  function renderConfirmation() {
    if (!confirming) return null;
    const copy = confirming.kind === 'route'
      ? {
          title: 'Remove this preference?',
          description: `This conversation will return to ${agentLabel(connection.agent)}.`,
          action: 'Remove preference',
        }
      : confirming.kind === 'automation'
        ? {
            title: 'Delete this automation?',
            description: 'It will stop running. Existing delivered results remain in Lark.',
            action: 'Delete automation',
          }
        : confirming.kind === 'account'
          ? {
              title: 'Remove personal Lark access?',
              description: 'The Bot remains connected. Automations that need your documents or calendar will pause.',
              action: 'Remove access',
            }
          : {
              title: 'Delete this Lark connection?',
              description: 'Its Agent preferences, automations, and connection history will be removed. Lark conversation content is not deleted.',
              action: 'Delete connection',
            };
    return (
      <div className="pt-lark-dialog-backdrop" role="presentation">
        <div ref={confirmDialog} className="pt-lark-dialog" role="dialog" aria-modal="true" aria-labelledby="lark-confirm-title">
          <span className="pt-lark-dialog__mark"><Trash2 size={22} /></span>
          <h3 id="lark-confirm-title">{copy.title}</h3>
          <p>{copy.description}</p>
          <div>
            <Button ref={confirmCancelButton} onClick={() => setConfirming(null)}>Cancel</Button>
            <Button danger onClick={completeConfirmation}>{copy.action}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="pt-lark" data-testid="lark-product">
      <header className="pt-lark-page-header">
        <div>
          <span className="pt-lark-kicker">Channels</span>
          <h1>Lark</h1>
        </div>
        {workspace.creation.state === 'idle' && workspace.connections.length > 0 ? (
          <Button type="primary" icon={Plus} onClick={startConnection}>Add Lark</Button>
        ) : null}
      </header>

      {intent
        ? <main className="pt-lark-main">{renderIntent()}</main>
        : selectedConnection
          ? renderConnected()
          : renderCollection()}
      {renderCreateDialog()}
      {renderConfirmation()}
    </section>
  );
}

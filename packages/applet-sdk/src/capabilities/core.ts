import type {
  AgentMessageInput,
  AgentMessageResult,
  AgentSession,
  AgentSessionInput,
  AgentStreamEvent,
  ActionSheetOptions,
  ActionSheetResult,
  AppRuntimeContext,
  AppletLaunchOptions,
  ChatInput,
  ChatResult,
  DiagnosticError,
  GenerateInput,
  GenerateResult,
  LoadingOptions,
  ModalOptions,
  ModalResult,
  NavigateToInput,
  NavigationBarOptions,
  OpenAppletInput,
  PerformanceMark,
  RedirectToInput,
  SkillDescriptor,
  SkillInvokeOptions,
  SkillInvokeResult,
  SkillSpec,
  SkillStreamEvent,
  TaskEvent,
  TaskHandle,
  TaskSnapshot,
  TaskStartInput,
  TelemetryEvent,
  ToastOptions,
} from '@peers-touch/applet-contract';
import type { BridgeAdapter, RuntimeContextProvider } from '../adapter.js';

export type Unsubscribe = () => void;

export interface AppRuntimeAPI {
  getContext(): Promise<AppRuntimeContext>;
  getLaunchOptions(): Promise<AppletLaunchOptions>;
}

export interface LifecycleAPI {
  onReady(handler: () => void): Unsubscribe;
  reportReady(): Promise<void>;
  onShow(handler: () => void): Unsubscribe;
  onHide(handler: () => void): Unsubscribe;
  onPause(handler: () => void): Unsubscribe;
  onResume(handler: () => void): Unsubscribe;
  onDestroy(handler: () => void): Unsubscribe;
}

export interface NavigationAPI {
  openApplet(input: OpenAppletInput): Promise<void>;
  closeApplet(reason?: string): Promise<void>;
  navigateTo(input: NavigateToInput): Promise<void>;
  redirectTo(input: RedirectToInput): Promise<void>;
  back(delta?: number): Promise<void>;
}

export interface UIAPI {
  showToast(input: ToastOptions): Promise<void>;
  showLoading(input?: LoadingOptions): Promise<void>;
  hideLoading(): Promise<void>;
  showModal(input: ModalOptions): Promise<ModalResult>;
  showActionSheet(input: ActionSheetOptions): Promise<ActionSheetResult>;
  setNavigationBar(input: NavigationBarOptions): Promise<void>;
}

export interface EventAPI {
  on<T = unknown>(topic: string, handler: (payload: T) => void): Unsubscribe;
  subscribe(topic: string): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  emit<T = unknown>(topic: string, payload?: T): Promise<void>;
}

export interface SkillAPI {
  register(spec: SkillSpec): Promise<void>;
  list(): Promise<SkillDescriptor[]>;
  invoke<TInput = unknown, TOutput = unknown>(
    skillId: string,
    input: TInput,
    options?: SkillInvokeOptions,
  ): Promise<SkillInvokeResult<TOutput>>;
  onStream(skillId: string, handler: (event: SkillStreamEvent) => void): Unsubscribe;
}

export interface TaskAPI {
  start<TInput = unknown>(input: TaskStartInput<TInput>): Promise<TaskHandle>;
  get<TOutput = unknown>(taskId: string): Promise<TaskSnapshot<TOutput>>;
  cancel(taskId: string): Promise<void>;
  onEvent(taskId: string, handler: (event: TaskEvent) => void): Unsubscribe;
}

export interface AgentAPI {
  startSession(input: AgentSessionInput): Promise<AgentSession>;
  send(input: AgentMessageInput): Promise<AgentMessageResult>;
  stream(input: AgentMessageInput, handler: (event: AgentStreamEvent) => void): Promise<AgentMessageResult>;
}

export interface AIAPI {
  generate(input: GenerateInput): Promise<GenerateResult>;
  chat(input: ChatInput): Promise<ChatResult>;
}

export interface TelemetryAPI {
  track(event: TelemetryEvent): Promise<void>;
  reportError(error: DiagnosticError): Promise<void>;
  mark(input: PerformanceMark): Promise<void>;
}

export interface TopicSubscriptionManager {
  retain(topic: string): Promise<void>;
  release(topic: string): Promise<void>;
}

export function createTopicSubscriptionManager(adapter: BridgeAdapter): TopicSubscriptionManager {
  const counts = new Map<string, number>();

  return {
    async retain(topic: string): Promise<void> {
      const count = counts.get(topic) ?? 0;
      counts.set(topic, count + 1);
      if (count === 0) {
        await adapter.invoke('events.subscribe', { topic });
      }
    },
    async release(topic: string): Promise<void> {
      const count = counts.get(topic) ?? 0;
      if (count <= 1) {
        counts.delete(topic);
        if (count === 1) {
          await adapter.invoke('events.unsubscribe', { topic });
        }
        return;
      }
      counts.set(topic, count - 1);
    },
  };
}

export function createAppRuntimeAPI(adapter: BridgeAdapter): AppRuntimeAPI {
  return {
    async getContext(): Promise<AppRuntimeContext> {
      const context = (adapter as BridgeAdapter & RuntimeContextProvider).getContext?.();
      if (context) {
        return context as unknown as AppRuntimeContext;
      }
      return adapter.invoke('app.getContext') as Promise<AppRuntimeContext>;
    },
    async getLaunchOptions(): Promise<AppletLaunchOptions> {
      const context = (adapter as BridgeAdapter & RuntimeContextProvider).getContext?.();
      if (context && typeof context === 'object' && 'launchParams' in context) {
        return (context as { launchParams?: AppletLaunchOptions }).launchParams ?? {};
      }
      return adapter.invoke('app.getLaunchOptions') as Promise<AppletLaunchOptions>;
    },
  };
}

export function createLifecycleAPI(adapter: BridgeAdapter, onEvent: EventAPI['on']): LifecycleAPI {
  return {
    onReady(handler: () => void): Unsubscribe {
      return onEvent('ready', handler);
    },
    reportReady(): Promise<void> {
      return adapter.invoke('lifecycle.reportReady') as Promise<void>;
    },
    onShow(handler: () => void): Unsubscribe {
      return onEvent('show', handler);
    },
    onHide(handler: () => void): Unsubscribe {
      return onEvent('hide', handler);
    },
    onPause(handler: () => void): Unsubscribe {
      return onEvent('pause', handler);
    },
    onResume(handler: () => void): Unsubscribe {
      return onEvent('resume', handler);
    },
    onDestroy(handler: () => void): Unsubscribe {
      return onEvent('destroy', handler);
    },
  };
}

export function createNavigationAPI(adapter: BridgeAdapter): NavigationAPI {
  return {
    openApplet: (input) => adapter.invoke('navigation.openApplet', input as unknown as Record<string, unknown>) as Promise<void>,
    closeApplet: (reason) => adapter.invoke('navigation.closeApplet', { reason }) as Promise<void>,
    navigateTo: (input) => adapter.invoke('navigation.navigateTo', input as unknown as Record<string, unknown>) as Promise<void>,
    redirectTo: (input) => adapter.invoke('navigation.redirectTo', input as unknown as Record<string, unknown>) as Promise<void>,
    back: (delta) => adapter.invoke('navigation.back', { delta }) as Promise<void>,
  };
}

export function createUIAPI(adapter: BridgeAdapter): UIAPI {
  return {
    showToast: (input) => adapter.invoke('ui.showToast', input as unknown as Record<string, unknown>) as Promise<void>,
    showLoading: (input = {}) => adapter.invoke('ui.showLoading', input as unknown as Record<string, unknown>) as Promise<void>,
    hideLoading: () => adapter.invoke('ui.hideLoading') as Promise<void>,
    showModal: (input) => adapter.invoke('ui.showModal', input as unknown as Record<string, unknown>) as Promise<ModalResult>,
    showActionSheet: (input) => adapter.invoke('ui.showActionSheet', input as unknown as Record<string, unknown>) as Promise<ActionSheetResult>,
    setNavigationBar: (input) => adapter.invoke('ui.setNavigationBar', input as unknown as Record<string, unknown>) as Promise<void>,
  };
}

export function createEventAPI(
  adapter: BridgeAdapter,
  subscriptions: TopicSubscriptionManager,
  addLocalHandler: <T>(topic: string, handler: (payload: T) => void) => Unsubscribe,
): EventAPI {
  return {
    on: addLocalHandler,
    subscribe: (topic) => subscriptions.retain(topic),
    unsubscribe: (topic) => subscriptions.release(topic),
    emit: (topic, payload) => adapter.invoke('events.emit', { topic, payload }) as Promise<void>,
  };
}

export function createSkillAPI(
  adapter: BridgeAdapter,
  subscriptions: TopicSubscriptionManager,
  onEvent: EventAPI['on'],
): SkillAPI {
  return {
    register: (spec) => adapter.invoke('skills.register', { spec }) as Promise<void>,
    list: () => adapter.invoke('skills.list') as Promise<SkillDescriptor[]>,
    invoke: async (skillId, input, options) => {
      if (options?.stream === true) {
        await subscriptions.retain('skill.stream');
        try {
          return await adapter.invoke('skills.invoke', { skillId, input, options }) as SkillInvokeResult<never>;
        } finally {
          await subscriptions.release('skill.stream');
        }
      }
      return adapter.invoke('skills.invoke', { skillId, input, options }) as Promise<SkillInvokeResult<never>>;
    },
    onStream: (skillId, handler) => onEvent<SkillStreamEvent>('skill.stream', (event) => {
      if (event.skillId === skillId) handler(event);
    }),
  };
}

export function createTaskAPI(adapter: BridgeAdapter, onEvent: EventAPI['on']): TaskAPI {
  return {
    start: (input) => adapter.invoke('tasks.start', input as unknown as Record<string, unknown>) as Promise<TaskHandle>,
    get: (taskId) => adapter.invoke('tasks.get', { taskId }) as Promise<TaskSnapshot<never>>,
    cancel: (taskId) => adapter.invoke('tasks.cancel', { taskId }) as Promise<void>,
    onEvent: (taskId, handler) => onEvent<TaskEvent>('task.event', (event) => {
      if (event.taskId === taskId) handler(event);
    }),
  };
}

export function createAgentAPI(
  adapter: BridgeAdapter,
  subscriptions: TopicSubscriptionManager,
  onEvent: EventAPI['on'],
): AgentAPI {
  return {
    startSession: (input) => adapter.invoke('agent.startSession', input as Record<string, unknown>) as Promise<AgentSession>,
    send: (input) => adapter.invoke('agent.send', input as unknown as Record<string, unknown>) as Promise<AgentMessageResult>,
    stream: async (input, handler) => {
      await subscriptions.retain('agent.stream');
      const unsubscribe = onEvent<AgentStreamEvent>('agent.stream', handler);
      try {
        return await adapter.invoke('agent.stream', input as unknown as Record<string, unknown>) as AgentMessageResult;
      } finally {
        unsubscribe();
        await subscriptions.release('agent.stream');
      }
    },
  };
}

export function createAIAPI(adapter: BridgeAdapter): AIAPI {
  return {
    generate: (input) => adapter.invoke('ai.generate', input as unknown as Record<string, unknown>) as Promise<GenerateResult>,
    chat: (input) => adapter.invoke('ai.chat', input as unknown as Record<string, unknown>) as Promise<ChatResult>,
  };
}

export function createTelemetryAPI(adapter: BridgeAdapter): TelemetryAPI {
  return {
    track: (event) => adapter.invoke('telemetry.track', { event }) as Promise<void>,
    reportError: (error) => adapter.invoke('telemetry.reportError', { error }) as Promise<void>,
    mark: (input) => adapter.invoke('telemetry.mark', input as unknown as Record<string, unknown>) as Promise<void>,
  };
}

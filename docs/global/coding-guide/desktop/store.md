# Desktop 状态管理指南

本文档基于 Desktop 应用实际代码，系统性介绍 Zustand Store 的设计模式、API 集成方式、EventBus 联动、去重加载、以及 GlobalContext 编排层。

> **真源边界**：Store 是数据的 *容器*。"谁有权写它、何时刷新、如何 reconcile" 由 **Runtime 契约**决定，不在本文定义；单点真源 [`client/desktop/runtime-projections.md`](../../../client/desktop/runtime-projections.md)。
>
> - Runtime 拥有的 Store（如 `socialChat`、`useSettingsStore.activeAccount`、`useSearchStore.sources`）：Store 内只暴露纯写入 action，外部不应跨页面手动调度它们的 `load*`；这部分调度由 `runtimes/*Runtime.ts` 负责。
> - 页面局部、一次性的预热数据：用 `kernel/usePrefetch.ts`，不要硬塞进 Store。
> - 真正的全局 Store（OAuth 连接、accountIdentity、globalContext）保留 `loadPromise` 去重模式。

---

## 目录

- [Zustand 基础模式](#zustand-基础模式)
- [Store 命名规范](#store-命名规范)
- [核心 Store 概览](#核心-store-概览)
  - [useChatStore](#usechatstore)
  - [useSettingsStore](#usesettingsstore)
  - [useAccountIdentityStore](#useaccountidentitystore)
  - [useGlobalContextStore](#useglobalcontextstore)
- [API 集成模式](#api-集成模式)
- [EventBus 集成模式](#eventbus-集成模式)
- [去重加载模式 (loadPromise)](#去重加载模式-loadpromise)
- [GlobalContext 编排层](#globalcontext-编排层)
- [最佳实践](#最佳实践)

---

## Zustand 基础模式

Desktop 使用 [Zustand](https://github.com/pmndrs/zustand) 作为唯一的状态管理库。基本范式如下:

1. 定义一个 interface，包含 **状态字段** 和 **操作方法**；
2. 使用 `create<Interface>((set, get) => ({...}))` 创建 store；
3. 组件中直接 `const value = useXxxStore(selector)` 获取状态。

```typescript
import { create } from 'zustand';

interface CounterState {
  count: number;
  increment: () => void;
  reset: () => void;
}

export const useCounterStore = create<CounterState>((set, get) => ({
  count: 0,
  increment: () => set({ count: get().count + 1 }),
  reset: () => set({ count: 0 }),
}));
```

组件中使用:

```tsx
function Counter() {
  const count = useCounterStore((s) => s.count);
  const increment = useCounterStore((s) => s.increment);
  return <button onClick={increment}>{count}</button>;
}
```

关键点:
- `set` 用于更新状态，支持对象合并和函数形式 `set((state) => ({ ... }))`
- `get` 用于在 action 内部读取最新状态
- Store 对外导出的是一个 hook，组件通过 selector 订阅最小范围的状态切片

---

## Store 命名规范

所有 Store 遵循 `use<Feature>Store` 命名约定:

| Store | 文件 | 职责 |
|-------|------|------|
| `useChatStore` | `store/chat.ts` | 会话管理、消息流式传输、CRUD |
| `useSettingsStore` | `store/settings.ts` | Agent 和工具管理 |
| `useAccountIdentityStore` | `store/accountIdentity.ts` | 账号列表、切换、EventBus 发布 |
| `useOAuth2Store` | `store/oauth2.ts` | OAuth 认证、连接管理 |
| `useGlobalContextStore` | `kernel/global-context/store.ts` | 全局上下文快照、管线编排 |

---

## 核心 Store 概览

### useChatStore

`store/chat.ts` 是最大的 Store（约 909 行），管理聊天的完整生命周期。

**状态定义模式** -- 接口中同时声明数据和方法:

```typescript
interface ChatState {
  // --- 数据字段 ---
  sessions: Session[];
  currentSessionKey: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  abortController: AbortController | null;
  pendingImages: PendingImage[];
  selectedModel: string;
  selectedAgent: string;
  availableModels: AvailableModel[];
  // ...

  // --- 操作方法 ---
  loadSessions: () => Promise<void>;
  selectSession: (key: string) => Promise<void>;
  newSession: () => void;
  deleteSession: (key: string) => Promise<void>;
  sendMessage: (content: string) => void;
  stopStreaming: () => void;
  // ...
}
```

**会话加载**:

```typescript
loadSessions: async () => {
  try {
    const sessions = await api.listSessions();
    set({ sessions });
    const { currentSessionKey, selectedModel, defaultModel } = get();
    if (!selectedModel || selectedModel === defaultModel) {
      const current = sessions.find((s) => s.key === currentSessionKey);
      if (current?.model_override) {
        set({ selectedModel: current.model_override });
      }
    }
  } catch (e) {
    log.error('chat', 'Failed to load sessions', e);
  }
},
```

**流式消息发送** -- 先乐观更新 UI，再处理流事件:

```typescript
sendMessage: (content: string) => {
  // 1. 构建用户消息和占位助手消息（临时 ID）
  const userMsg: ChatMessage = {
    id: tempId(),
    role: 'user',
    content,
    timestamp: Date.now(),
  };
  const assistantMsg: ChatMessage = {
    id: tempId(),
    role: 'assistant',
    content: '',
    loading: true,
    timestamp: Date.now(),
  };

  // 2. 乐观更新：立即将消息追加到列表
  set((state) => ({
    messages: [...state.messages, userMsg, assistantMsg],
    isStreaming: true,
  }));

  // 3. 启动流式传输，通过回调逐步更新助手消息
  const controller = streamChat(
    content,
    currentSessionKey,
    selectedAgent || 'assistant',
    (event: StreamEvent) => {
      set((state) => {
        const msgs = [...state.messages];
        const idx = msgs.findIndex((m) => m.id === assistantId);
        if (idx === -1) return state;

        switch (event.event) {
          case 'text':
            msgs[idx] = {
              ...msgs[idx],
              content: msgs[idx].content + (event.data.content || ''),
              loading: true,
            };
            break;
          case 'tool_call':
            // 追加工具调用信息
            break;
          case 'tool_result':
            // 更新工具结果
            break;
          case 'done':
            // 标记完成
            break;
        }
        return { messages: msgs };
      });
    },
    () => {
      // 4. 流完成后同步并刷新会话列表
      set({ isStreaming: false, abortController: null });
      get().syncMessages();
      get().loadSessions();
    },
    (err: Error) => {
      // 5. 错误处理
    },
  );

  set({ abortController: controller });
},
```

**合并更新模式** -- 用于增量合并后端推送的数据:

```typescript
mergeSessions: (sessions: Session[]) => {
  set((state) => {
    const byKey = new Map(state.sessions.map((s) => [s.key, s]));
    for (const s of sessions) {
      byKey.set(s.key, s);
    }
    return { sessions: Array.from(byKey.values()) };
  });
},
```

**停止流** -- 通过 AbortController 中止请求:

```typescript
stopStreaming: () => {
  const { abortController, currentSessionKey } = get();
  if (abortController) {
    abortController.abort();
    api.stopChat(currentSessionKey).catch(() => {});
    set((state) => ({
      messages: state.messages.map((m) =>
        m.loading ? { ...m, loading: false } : m
      ),
      isStreaming: false,
      abortController: null,
    }));
  }
},
```

### useSettingsStore

`store/settings.ts` 是一个精简的 Store，管理 Agent 和工具配置。

```typescript
interface SettingsState {
  agents: Agent[];
  tools: ToolInfo[];
  currentAgent: string;

  loadAgents: () => Promise<void>;
  loadTools: () => Promise<void>;
  setCurrentAgent: (name: string) => void;
  updateAgent: (name: string, data: Partial<Agent>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  agents: [],
  tools: [],
  currentAgent: 'assistant',

  loadAgents: async () => {
    try {
      const agents = await api.listAgents();
      set({ agents });
      // 从 Rust 端读取持久化的 currentAgent 配置
      const rustResult = await api.settingsGet({ key: 'settings.currentAgent' });
      if (rustResult.ok) {
        const value = (rustResult.data as { value?: string } | undefined)?.value;
        if (value) set({ currentAgent: value });
      }
    } catch (e) {
      console.error('Failed to load agents:', e);
    }
  },

  setCurrentAgent: (name: string) => {
    set({ currentAgent: name });
    // 同时写入 Rust 端持久化
    api.settingsSet({ key: 'settings.currentAgent', value: name }).catch(() => {});
  },

  updateAgent: async (name: string, data: Partial<Agent>) => {
    try {
      const agents = await api.listAgents();
      const agent = agents.find((a) => a.name === name);
      if (agent) await api.updateAgent(agent.id, data);
      const updated = await api.listAgents();
      set({ agents: updated });
    } catch (e) {
      console.error('Failed to update agent:', e);
    }
  },
}));
```

特点:
- `setCurrentAgent` 采用 **写前更新 + 异步持久化** 模式
- `updateAgent` 采用 **先写后读** 模式，确保 UI 展示的是服务端最新状态

### useAccountIdentityStore

`store/accountIdentity.ts` 展示了两个重要模式: **loadPromise 去重** 和 **EventBus 联动**。

```typescript
interface AccountIdentityStore {
  accounts: AccountIdentity[];
  activeAccountId?: string;
  loading: boolean;
  error?: string;
  load: () => Promise<void>;
  switchAccount: (id: string) => Promise<void>;
}

let loadPromise: Promise<void> | null = null;

export const useAccountIdentityStore = create<AccountIdentityStore>((set, get) => ({
  accounts: [],
  activeAccountId: undefined,
  loading: false,
  error: undefined,

  load: async () => {
    // 去重：如果已有加载请求在进行中，直接复用
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      set({ loading: true, error: undefined });
      try {
        const [list, active] = await Promise.all([
          api.accountList(),
          api.accountGetActive(),
        ]);
        const newAccounts = list.accounts || [];
        const newActiveId = active?.id || list.active_account_id;

        // 变更检测：只有数据真正变化时才发布事件
        const prev = get();
        const changed = !accountsEqual(prev.accounts, newAccounts)
          || prev.activeAccountId !== newActiveId;

        set({ accounts: newAccounts, activeAccountId: newActiveId, loading: false });

        if (changed) {
          eventBus.publish(EVENT.AUTH_IDENTITY_CHANGED, undefined);
        }
      } catch (error: any) {
        set({
          loading: false,
          error: error?.message || 'failed to load account identity',
        });
      } finally {
        loadPromise = null;
      }
    })();
    return loadPromise;
  },

  switchAccount: async (id: string) => {
    await api.accountSwitch(id);
    await get().load();
  },
}));
```

### useGlobalContextStore

`kernel/global-context/store.ts` 是全局上下文编排层，维护一个巨大的 `GlobalContextSnapshot` 对象，整合来自多个 Store 和 Rust 后端的数据。

```typescript
interface GlobalContextState {
  snapshot: GlobalContextSnapshot;
  runtimeUnsubscribe: (() => void) | null;
  getSnapshot: () => GlobalContextSnapshot;
  setRuntimeAppState: (state: RuntimeAppState) => void;
  setWorkspace: (input: { id?: string | null; name?: string | null }) => void;
  setTaskStatus: (key: string, status: 'idle' | 'running' | 'failed' | 'completed') => void;
  pushNotification: (item: Omit<NotificationItem, 'createdAt'>) => void;
  refreshFromSources: () => Promise<void>;
  startRuntimeBindings: () => void;
  runPipeline: (name: PipelineName, payload?: PipelinePayload) => Promise<void>;
}
```

`GlobalContextSnapshot` 由 9 个切片组成:

```typescript
interface GlobalContextSnapshot {
  identity: IdentitySlice;
  session: SessionSlice;
  oauth: OAuthSlice;
  runtime: RuntimeSlice;
  network: NetworkSlice;
  capability: CapabilitySlice;
  workspace: WorkspaceSlice;
  task: TaskSlice;
  notification: NotificationSlice;
  meta: MetaSlice;
}
```

---

## API 集成模式

所有 Store 通过 `services/desktop_api.ts` 导出的 `api` 对象与后端通信。

```typescript
import { api } from '../services/desktop_api';
```

核心模式:

**1. 加载并设置 (Load-and-Set)**

```typescript
loadSessions: async () => {
  try {
    const sessions = await api.listSessions();
    set({ sessions });
  } catch (e) {
    log.error('chat', 'Failed to load sessions', e);
  }
},
```

**2. 乐观更新 + 异步持久化 (Optimistic Update)**

```typescript
setSelectedModel: (model: string) => {
  set({ selectedModel: model });
  api.setSessionModel(currentSessionKey, model)
    .then(() => { /* 更新会话元数据 */ })
    .catch(() => {});
},
```

**3. 并行加载 (Parallel Load)**

```typescript
loadApplets: async () => {
  const [applets, prefs] = await Promise.all([
    api.listApplets(),
    api.getPreferences(),
  ]);
  // 合并处理结果
  set({ applets, enabledAppletIds: activeIds });
},
```

**4. 先写后读 (Write-then-Read)**

```typescript
updateAgent: async (name: string, data: Partial<Agent>) => {
  const agents = await api.listAgents();
  const agent = agents.find((a) => a.name === name);
  if (agent) await api.updateAgent(agent.id, data);
  const updated = await api.listAgents();
  set({ agents: updated });
},
```

---

## EventBus 集成模式

Store 可以通过 `eventBus` 发布事件，通知其他子系统数据变化。

```typescript
import { EVENT, eventBus } from '../kernel/events';

// 在 store action 中发布事件
if (changed) {
  eventBus.publish(EVENT.AUTH_IDENTITY_CHANGED, undefined);
}
```

GlobalContext Store 中更常见地使用 EventBus:

```typescript
function publishUpdate(slice: string) {
  eventBus.publish(EVENT.GLOBAL_CONTEXT_UPDATED, {
    slice,
    timestamp_ms: Date.now(),
  });
}

// 每次状态变更后调用
setRuntimeAppState: (state) => {
  set((prev) => ({ snapshot: { ...prev.snapshot, runtime: { ...prev.snapshot.runtime, appState: state } } }));
  publishUpdate('runtime');
},
```

Pipeline 生命周期事件:

```typescript
runPipeline: async (name, payload) => {
  eventBus.publish(EVENT.GLOBAL_CONTEXT_PIPELINE_STARTED, { name, timestamp_ms: Date.now() });
  try {
    // ... 执行管线逻辑 ...
    eventBus.publish(EVENT.GLOBAL_CONTEXT_PIPELINE_FINISHED, { name, timestamp_ms: Date.now() });
  } catch (error: any) {
    eventBus.publish(EVENT.GLOBAL_CONTEXT_PIPELINE_FAILED, {
      name,
      error: error?.message || 'pipeline_failed',
      timestamp_ms: Date.now(),
    });
    throw error;
  }
},
```

---

## 去重加载模式 (loadPromise)

当多个组件或逻辑同时触发同一个 `load()` 调用时，需要防止并发重复请求。`accountIdentity.ts` 展示了标准做法:

```typescript
let loadPromise: Promise<void> | null = null;

// 在 store 内部
load: async () => {
  // 如果已有加载请求在飞行中，直接返回同一个 Promise
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    set({ loading: true, error: undefined });
    try {
      const data = await api.someEndpoint();
      set({ data, loading: false });
    } catch (error: any) {
      set({ loading: false, error: error?.message });
    } finally {
      // 加载完成后清空，允许下次触发
      loadPromise = null;
    }
  })();

  return loadPromise;
},
```

核心要点:
- `loadPromise` 定义在 store 外部（模块级），因为 Zustand 的 `set`/`get` 闭包无法存储 Promise
- `finally` 中必须清空，否则后续加载永远被跳过
- 所有调用方拿到的是同一个 Promise，天然支持 `await`

---

## GlobalContext 编排层

GlobalContext 是一个更高层次的抽象，它:

1. 维护一个综合快照（`GlobalContextSnapshot`），汇聚多个 Store 的数据
2. 提供管线（Pipeline）机制来编排复杂的初始化和状态转换流程
3. 对外提供简洁的 Facade API

### Snapshot 刷新

`refreshFromSources` 先从 Rust 后端获取权威数据，再从前端 Store 中补充:

```typescript
refreshFromSources: async () => {
  // 第一阶段：从 Rust 后端获取权威快照
  try {
    const rustSnapshot = await api.contextSnapshotGet();
    set((prev) => ({
      snapshot: mapSnapshotFromRust(prev.snapshot, rustSnapshot),
    }));
    publishUpdate('authoritative');
  } catch {}

  // 第二阶段：触发前端 Store 加载
  await Promise.all([
    useAccountIdentityStore.getState().load(),
    useOAuth2Store.getState().loadAll(),
  ]);

  // 第三阶段：从前端 Store 映射到快照
  set((prev) => ({
    snapshot: mapSnapshotFromStores(prev.snapshot),
  }));
  publishUpdate('identity/session/oauth');
},
```

### Pipeline 机制

Pipeline 是预定义的状态转换序列，通过 `runPipeline` 执行:

```typescript
type PipelineName =
  | 'bootstrap'
  | 'session_login'
  | 'session_logout'
  | 'identity_switch'
  | 'network_recovery'
  | 'capability_refresh';
```

Bootstrap 管线示例:

```typescript
if (name === 'bootstrap') {
  get().setTaskStatus('global_context.bootstrap', 'running');
  get().setRuntimeAppState('booting');
  await get().refreshFromSources();
  get().startRuntimeBindings();
  get().setRuntimeAppState('ready');
  get().setTaskStatus('global_context.bootstrap', 'completed');
}
```

### Facade API

`kernel/global-context/index.ts` 导出 `globalContext` 对象，为外部提供简洁接口:

```typescript
export const globalContext = {
  getSnapshot(): GlobalContextSnapshot {
    return useGlobalContextStore.getState().getSnapshot();
  },

  subscribe(listener: (snapshot: GlobalContextSnapshot) => void) {
    return useGlobalContextStore.subscribe((state) => listener(state.snapshot));
  },

  subscribeSlice<TKey extends keyof GlobalContextSnapshot>(
    key: TKey,
    listener: (slice: GlobalContextSnapshot[TKey]) => void,
  ) {
    return useGlobalContextStore.subscribe((state) => listener(state.snapshot[key]));
  },

  runPipeline(name: PipelineName, payload?: PipelinePayload) {
    return useGlobalContextStore.getState().runPipeline(name, payload);
  },

  bootstrap() {
    return useGlobalContextStore.getState().runPipeline('bootstrap');
  },
};
```

外部使用:

```typescript
// 获取当前快照
const snapshot = globalContext.getSnapshot();

// 订阅某个切片的变化
const unsub = globalContext.subscribeSlice('identity', (identity) => {
  console.log('Identity changed:', identity.displayName);
});

// 执行管线
await globalContext.bootstrap();
await globalContext.runPipeline('session_login');
```

---

## 最佳实践

### 1. 接口定义先行

始终先定义完整的 state interface，将数据和操作方法一起声明:

```typescript
interface MyFeatureState {
  items: Item[];
  loading: boolean;
  error?: string;

  load: () => Promise<void>;
  add: (item: Item) => void;
  remove: (id: string) => void;
}
```

### 2. 错误处理统一模式

```typescript
someAction: async () => {
  try {
    const data = await api.someEndpoint();
    set({ data });
  } catch (e) {
    log.error('feature', 'Failed to do something', e);
  }
},
```

### 3. 在 action 中用 `get()` 读取最新状态

```typescript
someAction: () => {
  const { currentKey, items } = get();
  // 使用最新状态进行计算
},
```

### 4. 使用函数式 `set` 进行复杂更新

```typescript
addItem: (item: Item) => {
  set((state) => ({
    items: [...state.items, item],
  }));
},
```

### 5. 临时 ID 策略

对于需要乐观插入但尚未持久化的实体，使用临时 ID 前缀:

```typescript
let counter = 0;
function tempId() {
  return `temp-${Date.now()}-${counter++}`;
}

// 后续通过 syncMessages() 将临时 ID 替换为后端返回的真实 ID
```

### 6. Store 间互调

GlobalContext Store 可以直接调用其他 Store 的方法:

```typescript
await useAccountIdentityStore.getState().load();
await useOAuth2Store.getState().loadAll();
```

这种模式用于编排层，普通 Store 之间应尽量避免直接互调，而是通过 EventBus 解耦。

### 7. 长生命周期投影：用 Runtime，不要在 Store 自己 setInterval

```typescript
// ❌ 在 Store 内部启 setInterval / EventBus 订阅
export const useFooStore = create<FooState>((set) => ({
  // ...
  startPolling: () => {
    setInterval(() => useFooStore.getState().load(), 30_000);
  },
}));

// ✅ Store 只暴露 load / set；长生命周期由 RuntimeDescriptor 拥有
//    apps/desktop/src/runtimes/fooRuntime.ts
export const fooRuntime: RuntimeDescriptor = {
  id: 'foo',
  scope: 'session',
  install() { this._timer = setInterval(reconcile, 30_000); },
  teardown() { clearInterval(this._timer); },
  async bootstrap() { await useFooStore.getState().load(); },
  async reconcile() { await useFooStore.getState().load(); },
};
```

完整契约（`install`/`teardown`/`bootstrap`/`reconcile` 语义、`scope` 取值、注册方式）见 [`runtime-projections.md` §6.1](../../../client/desktop/runtime-projections.md)。

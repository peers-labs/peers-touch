# Desktop 内核事件系统指南

本文档基于 Desktop 应用实际代码，系统性介绍 AppEventBus 的实现原理、事件目录、类型安全机制、浏览器事件封装、调试支持，以及在 Store 和 Hook 中的集成模式。

---

## 目录

- [架构概览](#架构概览)
- [事件目录 (catalog.ts)](#事件目录-catalogts)
- [类型安全 (types.ts)](#类型安全-typests)
- [AppEventBus 核心实现 (bus.ts)](#appeventbus-核心实现-busts)
  - [publish](#publish)
  - [subscribe](#subscribe)
  - [once](#once)
  - [subscribeMany](#subscribemany)
- [调试缓冲区 (debug.ts)](#调试缓冲区-debugts)
- [浏览器事件封装 (browser.ts)](#浏览器事件封装-browserts)
- [全局错误处理 (global-error.ts)](#全局错误处理-global-errorts)
- [统一导出 (index.ts)](#统一导出-indexts)
- [集成模式](#集成模式)
  - [Store 中发布事件](#store-中发布事件)
  - [Hook 中订阅事件](#hook-中订阅事件)
  - [GlobalContext Pipeline 事件](#globalcontext-pipeline-事件)
- [添加新事件的流程](#添加新事件的流程)

---

## 架构概览

Desktop 事件系统由以下文件组成:

```
kernel/events/
  catalog.ts      — 事件常量目录
  types.ts        — 事件载荷类型映射
  bus.ts          — AppEventBus 类（核心）
  debug.ts        — 调试缓冲区
  browser.ts      — 浏览器原生事件封装
  global-error.ts — 全局错误/未处理 rejection 监听
  index.ts        — 统一导出
```

核心设计决策:
- 基于浏览器 `CustomEvent` + `window.dispatchEvent`/`addEventListener` 实现
- 事件类型必须在 catalog 中注册，运行时校验防止拼写错误
- TypeScript 泛型保证编译时的载荷类型安全
- 全部事件自动记录到调试缓冲区

---

## 事件目录 (catalog.ts)

`catalog.ts` 定义了所有合法的事件类型:

```typescript
export const EVENT = {
  AUTH_IDENTITY_CHANGED: 'auth.identity_changed',
  OAUTH_CONNECTIONS_CHANGED: 'oauth.connections_changed',
  NAVIGATION_REQUESTED: 'navigation.requested',
  AGENT_BUILDER_STREAM_ENDED: 'agent.builder.stream_ended',
  GLOBAL_CONTEXT_UPDATED: 'global_context.updated',
  GLOBAL_CONTEXT_PIPELINE_STARTED: 'global_context.pipeline_started',
  GLOBAL_CONTEXT_PIPELINE_FINISHED: 'global_context.pipeline_finished',
  GLOBAL_CONTEXT_PIPELINE_FAILED: 'global_context.pipeline_failed',
} as const;

export type EventType = (typeof EVENT)[keyof typeof EVENT];
export const EVENT_NAMES: EventType[] = Object.values(EVENT);
```

当前 8 种事件:

| 常量 | 字符串值 | 用途 |
|------|----------|------|
| `AUTH_IDENTITY_CHANGED` | `auth.identity_changed` | 账号身份变更（登录、切换、数据刷新） |
| `OAUTH_CONNECTIONS_CHANGED` | `oauth.connections_changed` | OAuth 连接列表变更 |
| `NAVIGATION_REQUESTED` | `navigation.requested` | 导航请求（深链接、程序化导航） |
| `AGENT_BUILDER_STREAM_ENDED` | `agent.builder.stream_ended` | Agent Builder 流式构建结束 |
| `GLOBAL_CONTEXT_UPDATED` | `global_context.updated` | 全局上下文快照更新 |
| `GLOBAL_CONTEXT_PIPELINE_STARTED` | `global_context.pipeline_started` | 管线开始执行 |
| `GLOBAL_CONTEXT_PIPELINE_FINISHED` | `global_context.pipeline_finished` | 管线执行完成 |
| `GLOBAL_CONTEXT_PIPELINE_FAILED` | `global_context.pipeline_failed` | 管线执行失败 |

`as const` 确保 EVENT 对象的值为字面量类型，而非宽泛的 `string`。

---

## 类型安全 (types.ts)

`types.ts` 定义了每种事件对应的载荷类型:

```typescript
import type { ParsedDeepLink } from '../../utils/deeplink';
import { EVENT } from './catalog';

export interface EventPayloadMap {
  [EVENT.AUTH_IDENTITY_CHANGED]: void;
  [EVENT.OAUTH_CONNECTIONS_CHANGED]: void;
  [EVENT.NAVIGATION_REQUESTED]: ParsedDeepLink | { resource: 'settings'; id?: string };
  [EVENT.AGENT_BUILDER_STREAM_ENDED]: void;
  [EVENT.GLOBAL_CONTEXT_UPDATED]: { slice: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_STARTED]: { name: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_FINISHED]: { name: string; timestamp_ms: number };
  [EVENT.GLOBAL_CONTEXT_PIPELINE_FAILED]: { name: string; error: string; timestamp_ms: number };
}

export interface AppEvent<TType extends keyof EventPayloadMap> {
  type: TType;
  payload: EventPayloadMap[TType];
}
```

载荷类型说明:

| 事件 | 载荷类型 | 说明 |
|------|----------|------|
| `AUTH_IDENTITY_CHANGED` | `void` | 无载荷，订阅方自行拉取最新数据 |
| `OAUTH_CONNECTIONS_CHANGED` | `void` | 无载荷 |
| `NAVIGATION_REQUESTED` | `ParsedDeepLink \| { resource; id? }` | 导航目标信息 |
| `AGENT_BUILDER_STREAM_ENDED` | `void` | 无载荷 |
| `GLOBAL_CONTEXT_UPDATED` | `{ slice; timestamp_ms }` | 哪个切片更新了 |
| `GLOBAL_CONTEXT_PIPELINE_STARTED` | `{ name; timestamp_ms }` | 管线名称和时间戳 |
| `GLOBAL_CONTEXT_PIPELINE_FINISHED` | `{ name; timestamp_ms }` | 管线名称和时间戳 |
| `GLOBAL_CONTEXT_PIPELINE_FAILED` | `{ name; error; timestamp_ms }` | 管线名称、错误信息、时间戳 |

设计原则:
- 无数据需要传递时，载荷类型为 `void`，发布时可省略第二个参数
- 有数据时，载荷是结构化对象，包含必要的上下文信息
- `timestamp_ms` 统一使用毫秒级 Unix 时间戳

---

## AppEventBus 核心实现 (bus.ts)

`bus.ts` 是事件系统的核心，实现了类型安全的发布-订阅:

```typescript
import type { EventPayloadMap } from './types';
import { EVENT_NAMES } from './catalog';
import { eventDebugBuffer } from './debug';

class AppEventBus {
  private readonly catalog = new Set<string>(EVENT_NAMES);

  private ensureKnownType(type: string) {
    if (this.catalog.has(type)) return;
    throw new Error(`Unknown event type: ${type}`);
  }

  // ... 方法定义 ...
}

export const eventBus = new AppEventBus();
```

`eventBus` 是全局单例，所有代码通过 `import { eventBus } from '../kernel/events'` 使用。

### publish

发布事件，将载荷包装为 `CustomEvent` 分发到 `window`:

```typescript
publish<TType extends keyof EventPayloadMap>(
  type: TType,
  ...args: EventPayloadMap[TType] extends void
    ? [payload?: EventPayloadMap[TType]]
    : [payload: EventPayloadMap[TType]]
) {
  this.ensureKnownType(type);
  const payload = (args[0] as EventPayloadMap[TType]) ?? undefined;
  eventDebugBuffer.push({
    type,
    payload,
    timestamp_ms: Date.now(),
  });
  window.dispatchEvent(new CustomEvent(type, { detail: payload }));
}
```

类型签名巧妙地利用了条件类型:
- 载荷为 `void` 时，`payload` 参数可省略: `eventBus.publish(EVENT.AUTH_IDENTITY_CHANGED)`
- 载荷非 `void` 时，`payload` 参数必须提供: `eventBus.publish(EVENT.GLOBAL_CONTEXT_UPDATED, { slice: 'runtime', timestamp_ms: Date.now() })`

使用示例:

```typescript
// 无载荷事件
eventBus.publish(EVENT.AUTH_IDENTITY_CHANGED);

// 有载荷事件
eventBus.publish(EVENT.GLOBAL_CONTEXT_UPDATED, {
  slice: 'identity',
  timestamp_ms: Date.now(),
});

// 导航事件
eventBus.publish(EVENT.NAVIGATION_REQUESTED, {
  resource: 'settings',
  id: 'account',
});
```

### subscribe

订阅事件，返回一个取消订阅函数:

```typescript
subscribe<TType extends keyof EventPayloadMap>(
  type: TType,
  handler: (payload: EventPayloadMap[TType]) => void,
) {
  this.ensureKnownType(type);
  const listener = (event: Event) => {
    const payload = (event as CustomEvent<EventPayloadMap[TType]>).detail;
    handler(payload);
  };
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}
```

使用示例:

```typescript
// 订阅并在组件卸载时取消
const unsubscribe = eventBus.subscribe(
  EVENT.GLOBAL_CONTEXT_UPDATED,
  (payload) => {
    console.log(`Slice ${payload.slice} updated at ${payload.timestamp_ms}`);
  },
);

// 取消订阅
unsubscribe();
```

在 React Hook 中使用:

```typescript
useEffect(() => {
  return eventBus.subscribe(EVENT.AUTH_IDENTITY_CHANGED, () => {
    refreshData();
  });
}, []);
```

返回值直接作为 `useEffect` 的清理函数，模式简洁。

### once

一次性订阅，触发后自动取消:

```typescript
once<TType extends keyof EventPayloadMap>(
  type: TType,
  handler: (payload: EventPayloadMap[TType]) => void,
) {
  const off = this.subscribe(type, (payload) => {
    off();
    handler(payload);
  });
  return off;
}
```

使用示例:

```typescript
// 只等待管线完成一次
eventBus.once(EVENT.GLOBAL_CONTEXT_PIPELINE_FINISHED, (payload) => {
  console.log(`Pipeline ${payload.name} finished`);
});
```

### subscribeMany

同时订阅多种事件，统一处理:

```typescript
subscribeMany<TType extends keyof EventPayloadMap>(
  types: TType[],
  handler: (event: { type: TType; payload: EventPayloadMap[TType] }) => void,
) {
  const offs = types.map((type) =>
    this.subscribe(type, (payload) => handler({ type, payload })),
  );
  return () => {
    offs.forEach((off) => off());
  };
}
```

使用示例:

```typescript
const unsubscribe = eventBus.subscribeMany(
  [EVENT.AUTH_IDENTITY_CHANGED, EVENT.OAUTH_CONNECTIONS_CHANGED],
  (event) => {
    console.log(`Event: ${event.type}`);
    refreshUserData();
  },
);

// 一次性取消所有订阅
unsubscribe();
```

---

## 调试缓冲区 (debug.ts)

`debug.ts` 提供环形缓冲区，自动记录所有事件:

```typescript
import { EVENT_NAMES } from './catalog';

interface EventDebugRecord {
  type: string;
  timestamp_ms: number;
  payload: unknown;
}

class EventDebugBuffer {
  private readonly catalog = new Set<string>(EVENT_NAMES);
  private readonly capacity: number;
  private readonly records: EventDebugRecord[] = [];

  constructor(capacity = 200) {
    this.capacity = capacity;
  }

  push(record: EventDebugRecord) {
    if (!this.catalog.has(record.type)) return;
    this.records.push(record);
    if (this.records.length > this.capacity) {
      this.records.splice(0, this.records.length - this.capacity);
    }
  }

  list(): EventDebugRecord[] {
    return this.records.slice();
  }

  clear() {
    this.records.splice(0, this.records.length);
  }
}

export const eventDebugBuffer = new EventDebugBuffer();
```

特性:
- 默认容量 200 条，超出后自动淘汰最老的记录
- 只记录 catalog 中已注册的事件类型
- `list()` 返回副本，不影响原始数据
- `clear()` 清空所有记录

在开发工具或控制台中使用:

```typescript
import { eventDebugBuffer } from './kernel/events';

// 查看最近的事件记录
const records = eventDebugBuffer.list();
records.forEach((r) => {
  console.log(`[${new Date(r.timestamp_ms).toISOString()}] ${r.type}`, r.payload);
});

// 清空调试缓冲区
eventDebugBuffer.clear();
```

---

## 浏览器事件封装 (browser.ts)

`browser.ts` 对常用的浏览器原生事件提供了统一的封装，返回取消监听函数:

```typescript
export function onWindowPopState(handler: () => void) {
  window.addEventListener('popstate', handler);
  return () => window.removeEventListener('popstate', handler);
}

export function onWindowKeydown(handler: (event: KeyboardEvent) => void) {
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

export function onWindowOnline(handler: () => void) {
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}

export function onWindowOffline(handler: () => void) {
  window.addEventListener('offline', handler);
  return () => window.removeEventListener('offline', handler);
}
```

设计模式与 `eventBus.subscribe` 保持一致 -- 返回取消函数，可直接用于 `useEffect` 清理:

```typescript
// 在 Hook 中监听键盘事件
useEffect(() => {
  return onWindowKeydown((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openSearch();
    }
  });
}, []);

// 在 Store 中监听网络状态
const offOnline = onWindowOnline(() => {
  set((prev) => ({
    snapshot: {
      ...prev.snapshot,
      runtime: { ...prev.snapshot.runtime, online: true, networkMode: 'online' },
    },
  }));
});
const offOffline = onWindowOffline(() => {
  set((prev) => ({
    snapshot: {
      ...prev.snapshot,
      runtime: { ...prev.snapshot.runtime, online: false, networkMode: 'offline' },
    },
  }));
});

// 统一清理
function cleanup() {
  offOnline();
  offOffline();
}
```

---

## 全局错误处理 (global-error.ts)

`global-error.ts` 在 `main.tsx` 中通过副作用导入，全局注册错误监听:

```typescript
import { log } from '../../utils/logger';

window.addEventListener('error', (e) => {
  log.error('app', 'Uncaught error', {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
  });
});

window.addEventListener('unhandledrejection', (e) => {
  log.error('app', 'Unhandled rejection', {
    reason: String(e.reason),
  });
});
```

捕获两类全局异常:
- **error** — 未捕获的同步错误和资源加载错误
- **unhandledrejection** — 未处理的 Promise rejection

这些错误通过 `log.error` 记录，不中断应用运行。

---

## 统一导出 (index.ts)

`index.ts` 汇总所有公共 API:

```typescript
export { EVENT, EVENT_NAMES } from './catalog';
export type { EventType } from './catalog';
export { eventBus } from './bus';
export type { EventPayloadMap, AppEvent } from './types';
export { onWindowPopState, onWindowKeydown, onWindowOnline, onWindowOffline } from './browser';
export { eventDebugBuffer } from './debug';
export type { EventDebugRecord } from './debug';
```

外部代码统一从 `kernel/events` 导入:

```typescript
import { EVENT, eventBus, onWindowKeydown } from '../kernel/events';
import type { EventPayloadMap, AppEvent } from '../kernel/events';
```

---

## 集成模式

### Store 中发布事件

Store 在数据变更后发布事件，通知其他子系统:

```typescript
// store/accountIdentity.ts
import { EVENT, eventBus } from '../kernel/events';

export const useAccountIdentityStore = create<AccountIdentityStore>((set, get) => ({
  load: async () => {
    // ... 加载数据 ...
    const prev = get();
    const changed = !accountsEqual(prev.accounts, newAccounts)
      || prev.activeAccountId !== newActiveId;

    set({ accounts: newAccounts, activeAccountId: newActiveId, loading: false });

    // 只在数据真正变化时才发布事件
    if (changed) {
      eventBus.publish(EVENT.AUTH_IDENTITY_CHANGED, undefined);
    }
  },
}));
```

GlobalContext Store 中的模式 -- 封装 `publishUpdate` 辅助函数:

```typescript
// kernel/global-context/store.ts
function publishUpdate(slice: string) {
  eventBus.publish(EVENT.GLOBAL_CONTEXT_UPDATED, {
    slice,
    timestamp_ms: Date.now(),
  });
}

// 每个状态变更方法末尾调用
setRuntimeAppState: (state) => {
  api.contextActionDispatch({ action: 'set_runtime_state', payload: { appState: state } }).catch(() => {});
  set((prev) => ({
    snapshot: {
      ...prev.snapshot,
      runtime: { ...prev.snapshot.runtime, appState: state },
      meta: { ...prev.snapshot.meta, updatedAt: Date.now() },
    },
  }));
  publishUpdate('runtime');
},

setWorkspace: (input) => {
  set((prev) => ({ /* ... */ }));
  publishUpdate('workspace');
},

setTaskStatus: (key, status) => {
  set((prev) => ({ /* ... */ }));
  publishUpdate('task');
},

pushNotification: (item) => {
  set((prev) => ({ /* ... */ }));
  publishUpdate('notification');
},
```

### Hook 中订阅事件

Hook 通过 `useEffect` 订阅事件，返回值直接作为清理函数:

```typescript
// hooks/useNavigation.ts
import { EVENT, eventBus, onWindowKeydown } from '../kernel/events';

export function useNavigation(router: HashRouter): Navigation {
  // 订阅 EventBus 事件
  useEffect(() => {
    return eventBus.subscribe(EVENT.NAVIGATION_REQUESTED, (parsed) => {
      const nav = parsed as ParsedDeepLink;
      if (!nav?.resource) return;
      switch (nav.resource) {
        case 'cron':
          router.setPage('cron');
          break;
        case 'sessions':
          if (nav.id) useChatStore.getState().selectSession(nav.id);
          router.setPage('agent');
          break;
        case 'settings':
          if (nav.id) setSettingsNav({ tab: nav.id });
          router.setPage('settings');
          break;
        // ...
      }
    });
  }, [router.setPage]);

  // 订阅浏览器键盘事件
  useEffect(() => {
    return onWindowKeydown((e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        router.setPage('search');
      }
    });
  }, [router.setPage]);
}
```

### GlobalContext Pipeline 事件

Pipeline 的完整生命周期通过三个事件追踪:

```typescript
runPipeline: async (name, payload) => {
  // 管线开始
  eventBus.publish(EVENT.GLOBAL_CONTEXT_PIPELINE_STARTED, {
    name,
    timestamp_ms: Date.now(),
  });

  try {
    // ... 执行具体管线逻辑 ...

    // 管线完成
    eventBus.publish(EVENT.GLOBAL_CONTEXT_PIPELINE_FINISHED, {
      name,
      timestamp_ms: Date.now(),
    });
  } catch (error: any) {
    // 管线失败
    eventBus.publish(EVENT.GLOBAL_CONTEXT_PIPELINE_FAILED, {
      name,
      error: error?.message || 'pipeline_failed',
      timestamp_ms: Date.now(),
    });
    throw error;
  }
},
```

外部监听管线事件:

```typescript
// 监听所有管线状态变化
eventBus.subscribeMany(
  [
    EVENT.GLOBAL_CONTEXT_PIPELINE_STARTED,
    EVENT.GLOBAL_CONTEXT_PIPELINE_FINISHED,
    EVENT.GLOBAL_CONTEXT_PIPELINE_FAILED,
  ],
  (event) => {
    switch (event.type) {
      case EVENT.GLOBAL_CONTEXT_PIPELINE_STARTED:
        console.log(`Pipeline ${event.payload.name} started`);
        break;
      case EVENT.GLOBAL_CONTEXT_PIPELINE_FINISHED:
        console.log(`Pipeline ${event.payload.name} finished`);
        break;
      case EVENT.GLOBAL_CONTEXT_PIPELINE_FAILED:
        console.error(`Pipeline ${event.payload.name} failed: ${event.payload.error}`);
        break;
    }
  },
);
```

---

## 添加新事件的流程

当需要新增一种事件类型时，按以下三步操作:

**步骤 1**: 在 `catalog.ts` 中添加常量:

```typescript
export const EVENT = {
  // ... 已有事件 ...
  MY_FEATURE_COMPLETED: 'my_feature.completed',
} as const;
```

**步骤 2**: 在 `types.ts` 中定义载荷类型:

```typescript
export interface EventPayloadMap {
  // ... 已有事件 ...
  [EVENT.MY_FEATURE_COMPLETED]: { featureId: string; result: string; timestamp_ms: number };
}
```

**步骤 3**: 在业务代码中使用:

```typescript
import { EVENT, eventBus } from '../kernel/events';

// 发布
eventBus.publish(EVENT.MY_FEATURE_COMPLETED, {
  featureId: 'abc',
  result: 'success',
  timestamp_ms: Date.now(),
});

// 订阅
eventBus.subscribe(EVENT.MY_FEATURE_COMPLETED, (payload) => {
  console.log(`Feature ${payload.featureId} completed: ${payload.result}`);
});
```

无需修改 `bus.ts`、`debug.ts` 或 `index.ts`。`EVENT_NAMES` 从 `Object.values(EVENT)` 自动生成，`eventDebugBuffer` 的 catalog 也会自动包含新事件。TypeScript 编译器会自动校验所有 `publish` 和 `subscribe` 调用的载荷类型是否匹配。

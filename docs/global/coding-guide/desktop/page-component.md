# Desktop 页面与组件编写指南

本文档基于 Desktop 应用实际代码，系统性介绍应用入口、状态机驱动的视图切换、模块注册系统、以及页面和组件的编写规范。

> **真源边界 (2026-05)**：本文是规范层，**只规定如何写**。
>
> - 页面如何挂载、何时预热、谁拥有运行时投影、Boot 阶段如何编排，单点真源在 [`client/desktop/runtime-projections.md`](../../../client/desktop/runtime-projections.md)。
> - 模块注册（侧边栏入口、设置 Tab 入口）≠ 页面注册（PageDescriptor）。前者是导航装配，后者是渲染契约。两者并存，互不替代。
> - 凡涉及 `useEffect(load, [load])` 这种页面内首次挂载拉数据，**必须**先回到 `runtime-projections.md` 看是否应该改用 Runtime 或 `usePrefetch`。

---

## 目录

- [应用入口 (main.tsx)](#应用入口-maintsx)
- [状态机驱动的应用架构 (App.tsx)](#状态机驱动的应用架构-apptsx)
- [视图层 (Views)](#视图层-views)
- [应用生命周期 Hook (useAppLifecycle)](#应用生命周期-hook-useapplifecycle)
- [模块注册系统](#模块注册系统)
  - [ModuleFrontend 接口](#modulefrontend-接口)
  - [注册流程](#注册流程)
  - [查询接口](#查询接口)
  - [实际模块示例](#实际模块示例)
- [导航系统 (useNavigation)](#导航系统-usenavigation)
- [页面编写规范](#页面编写规范)
- [组件库选择规范](#组件库选择规范)

---

## 应用入口 (main.tsx)

`main.tsx` 是 Desktop 前端的唯一入口，负责挂载 React 根节点并配置全局 Provider:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, ToastHost } from '@lobehub/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App';
import SharePage from './pages/SharePage';
import './kernel/events/global-error';
import './modules';
import './index.css';

function Root() {
  const path = window.location.pathname;
  const shareMatch = path.match(/^\/share\/s\/([A-Za-z0-9]+)$/);
  if (shareMatch) {
    return <SharePage token={shareMatch[1]} />;
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <Root />
        <ToastHost />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);
```

关键层次（从外到内）:

| 层级 | 职责 |
|------|------|
| `StrictMode` | React 开发模式严格检查 |
| `ErrorBoundary` | 全局错误边界，捕获渲染异常 |
| `ThemeProvider` | LobeUI 主题 Provider，提供暗色/亮色主题 |
| `Root` | 路由分流：分享页 vs 主应用 |
| `ToastHost` | LobeUI 全局 Toast 容器 |

副作用导入:
- `import './kernel/events/global-error'` — 注册全局 `error` 和 `unhandledrejection` 监听
- `import './modules'` — 触发所有模块的自注册

> `main.tsx` 同时是 Boot Pipeline 的 `shell` 阶段起点，会调用 `markPhaseStart/End('shell')`。其它阶段（`identity` / `runtime:critical` / `firstPaint` / `runtime:idle` / `pages:prewarm` / `steady`）的归属与可观测性详见 [`runtime-projections.md` §6.3](../../../client/desktop/runtime-projections.md)。

---

## 状态机驱动的应用架构 (App.tsx)

`App.tsx` 采用状态机模式，根据应用当前状态渲染不同视图。它同时承担 BootPipeline 中 `runtime:critical` 与 `runtime:idle` 阶段的安装责任（详见 [`runtime-projections.md` §6.3](../../../client/desktop/runtime-projections.md)）。

```tsx
import type { ComponentType } from 'react';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { OnboardingView } from './views/OnboardingView';
import { ResumingView } from './views/ResumingView';
import { ReadyView } from './views/ReadyView';
import type { AppState, AppLifecycle } from './types/navigation';

interface ViewProps {
  lifecycle: AppLifecycle;
}

const APP_VIEWS: Record<AppState, ComponentType<ViewProps>> = {
  onboarding: OnboardingView,
  resuming: ResumingView,
  ready: ReadyView,
};

function App() {
  const lifecycle = useAppLifecycle();
  const View = APP_VIEWS[lifecycle.state];
  return <View lifecycle={lifecycle} />;
}

export default App;
```

三个状态及其对应视图:

```
onboarding ──(restore session 成功)──> resuming ──(completeLogin)──> ready
        └──(无可恢复会话 → 用户登录)──> ready
```

| 状态 | 视图 | 说明 |
|------|------|------|
| `onboarding` | `OnboardingView` | 账号选择 / 登录 / OAuth 流程；首启动也走这里 |
| `resuming` | `ResumingView` | 已选定账号、正在恢复加密会话与首屏数据 |
| `ready` | `ReadyView` | 主应用界面，承载 `<PageHost />` 与 `<PageRouter />` 兜底 |

每个视图都接收 `lifecycle: AppLifecycle` prop（最小契约见 `apps/desktop/src/types/navigation.ts`，以代码为准）：

```typescript
type AppState = 'onboarding' | 'resuming' | 'ready';

interface AppLifecycle {
  state: AppState;
  restoredUser: SessionUser | null;
  knownAccounts: SessionUser[];
  dataReady: boolean;
  completeLogin: () => void;
}
```

> **不要在本文重新定义 `AppLifecycle` 字段**。字段集合随 onboarding / 多账号能力演进，单点真源是 `apps/desktop/src/types/navigation.ts`。

---

## 视图层 (Views)

Views 是 App 直接渲染的顶层组件，位于 `views/` 目录:

- `OnboardingView` — 账号选择 / 登录 / OAuth；登录成功后过渡到 `resuming`
- `ResumingView` — 已选账号，正在恢复加密会话、加载关键数据；完成后调用 `lifecycle.completeLogin()`
- `ReadyView` — 主应用框架，承载侧边栏、`<PageHost />`（kernel 注册的页面）与 `<PageRouter fallback />`（未迁移的页面），并标记 `firstPaint` boot 阶段

视图组件签名统一为:

```tsx
interface ViewProps {
  lifecycle: AppLifecycle;
}

export function OnboardingView({ lifecycle }: ViewProps) {
  // 登录 / 账号选择 / OAuth；不在此挂载业务运行时
}

export function ResumingView({ lifecycle }: ViewProps) {
  // 恢复会话与解密；完成时 lifecycle.completeLogin()
}

export function ReadyView({ lifecycle }: ViewProps) {
  // markPhaseEnd('firstPaint'); 内部走 PageHost + PageRouter 兜底
}
```

> 视图不直接拉业务投影。业务投影由 Runtime 拥有，详见 [`runtime-projections.md` §2/§4](../../../client/desktop/runtime-projections.md)。

---

## 应用生命周期 Hook (useAppLifecycle)

`hooks/useAppLifecycle.ts` 管理整个应用的启动流程：恢复账号、解密 session、维护 `restoredUser` / `knownAccounts` / `dataReady`，并在登录完成时切换到 `ready`。

> **本文不再贴完整实现**。它会随多账号 / OAuth / PIN / 远端 station session 演进；以代码为准。本文只规定接口与边界：
>
> - 输入边界：登录视图通过 `lifecycle.completeLogin()` 通知 lifecycle 进入 `ready`。
> - 输出边界：`AppLifecycle.state ∈ { 'onboarding', 'resuming', 'ready' }`，`AppState` 定义在 `apps/desktop/src/types/navigation.ts`。
> - 责任边界：`useAppLifecycle` 不安装业务运行时（Social / Search / Settings 等）。运行时由 `App.tsx` 在 `runtime:critical` / `runtime:idle` 阶段安装，详见 [`runtime-projections.md` §6.3](../../../client/desktop/runtime-projections.md)。
> - 同步 GlobalContext appState 是它的副作用职责（`onboarding | resuming → 'booting'`，`ready → 'ready'`）。

---

## 模块注册系统

Desktop 使用一套去中心化的模块注册系统，每个功能模块自行注册，宿主 UI 通过 registry 动态读取并渲染。

### ModuleFrontend 接口

`modules/registry.ts` 定义了模块的完整接口:

```typescript
import type React from 'react';
import type { LucideIcon } from 'lucide-react';

interface SidebarEntry {
  position: 'top' | 'bottom';
  order: number;
  title?: string;
}

interface SettingsEntry {
  order: number;
  label?: string;
  tooltip?: string;
}

interface ModuleFrontend {
  id: string;           // 唯一标识符
  name: string;         // 显示名称
  icon: LucideIcon;     // 图标（来自 lucide-react）

  page?: React.ComponentType<any>;           // 独立页面组件
  settingsPanel?: React.ComponentType<any>;  // 设置面板组件
  sidebarEntry?: SidebarEntry;               // 侧边栏入口配置
  settingsEntry?: SettingsEntry;             // 设置 Tab 入口配置
}
```

各字段的作用:

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 模块唯一标识，用于路由和查询 |
| `name` | 是 | 人类可读名称 |
| `icon` | 是 | Lucide 图标组件 |
| `page` | 否 | 提供后，模块拥有独立的全页面视图 |
| `settingsPanel` | 否 | 提供后，模块在设置页面拥有一个 Tab |
| `sidebarEntry` | 否 | 提供后，模块在主侧边栏显示图标入口 |
| `settingsEntry` | 否 | 控制设置 Tab 的排序和标签 |

### 注册流程

**步骤 1**: 在 `modules/` 目录下创建模块文件，调用 `registerModule()`:

```typescript
// modules/memory.ts
import { Brain } from 'lucide-react';
import { registerModule } from './registry';
import { MemoryPage } from '../pages/MemoryPage';
import { MemorySettingsTab } from '../components/settings/MemorySettingsTab';

registerModule({
  id: 'memory',
  name: 'Memory',
  icon: Brain,
  page: MemoryPage,
  settingsPanel: MemorySettingsTab,
  sidebarEntry: { position: 'top', order: 35, title: 'Memory' },
  settingsEntry: { order: 25, label: 'Memory' },
});
```

**步骤 2**: 在 `modules/index.ts` 中导入该文件，触发自注册:

```typescript
// modules/index.ts
import './providers';
import './model-service';
import './tts';
import './account';
import './skills';
import './mcp';
import './channels';
import './cron';
import './memory';       // <-- 新增导入
import './applets';
import './logs';
import './connections';
```

**步骤 3**: 完成。宿主 UI 会自动发现并渲染该模块。无需修改 App.tsx 或 ReadyView。

### 查询接口

Registry 提供以下查询方法:

```typescript
// 获取所有已注册模块
getAllModules(): ModuleFrontend[]

// 获取有独立页面的模块
getModulesWithPages(): ModuleFrontend[]

// 获取有侧边栏入口的模块（按 order 排序）
getModulesWithSidebar(): ModuleFrontend[]

// 获取有设置面板的模块（按 order 排序）
getModulesWithSettings(): ModuleFrontend[]

// 按 id 获取单个模块
getModule(id: string): ModuleFrontend | undefined
```

宿主 UI 中的使用示例:

```tsx
import { getModulesWithSidebar, getModulesWithSettings } from './modules/registry';

// 渲染侧边栏图标
function Sidebar() {
  const modules = getModulesWithSidebar();
  return (
    <nav>
      {modules.map((mod) => (
        <SidebarIcon
          key={mod.id}
          icon={mod.icon}
          title={mod.sidebarEntry?.title || mod.name}
          onClick={() => navigateTo(mod.id)}
        />
      ))}
    </nav>
  );
}

// 渲染设置页 Tab
function SettingsPage() {
  const modules = getModulesWithSettings();
  return (
    <Tabs>
      {modules.map((mod) => (
        <Tab
          key={mod.id}
          label={mod.settingsEntry?.label || mod.name}
        >
          <mod.settingsPanel />
        </Tab>
      ))}
    </Tabs>
  );
}
```

### 实际模块示例

**完整模块（页面 + 侧边栏 + 设置面板）**:

```typescript
// modules/channels.ts
import { Send } from 'lucide-react';
import { registerModule } from './registry';
import { ChannelsTab } from '../components/ChannelsTab';
import { ChannelsPage } from '../pages/ChannelsPage';

registerModule({
  id: 'channels',
  name: 'Channels',
  icon: Send,
  page: ChannelsPage,
  settingsPanel: ChannelsTab,
  sidebarEntry: { position: 'top', order: 50, title: 'Channels' },
  settingsEntry: { order: 40 },
});
```

**纯设置模块（仅设置面板）**:

```typescript
// modules/account.ts
import { User } from 'lucide-react';
import { registerModule } from './registry';
import { AccountTab } from '../components/settings/OAuth2Tab';

registerModule({
  id: 'account',
  name: 'OAuth Sign-In',
  icon: User,
  settingsPanel: AccountTab,
  settingsEntry: { order: 20, label: 'OAuth Sign-In' },
});
```

**条件注册模块**:

```typescript
// modules/connections.ts
import { KeyRound } from 'lucide-react';
import { registerModule } from './registry';
import { ConnectionsTab } from '../components/settings/OAuth2Tab';

const isAdvancedConnectionsEnabled = (() => {
  const envEnabled = import.meta.env.VITE_ENABLE_ADVANCED_OAUTH_CONNECTIONS === 'true';
  const runtimeEnabled = (() => {
    try {
      return window.localStorage.getItem('pt.settings.advanced_oauth_connections') === '1';
    } catch {
      return false;
    }
  })();
  return envEnabled || runtimeEnabled;
})();

if (isAdvancedConnectionsEnabled) {
  registerModule({
    id: 'connections',
    name: 'OAuth Client Connections',
    icon: KeyRound,
    settingsPanel: ConnectionsTab,
    settingsEntry: {
      order: 26,
      label: 'Advanced Connections',
      tooltip: 'Platform OAuth client configuration, not account sign-in.',
    },
  });
}
```

---

## 导航系统 (useNavigation)

`hooks/useNavigation.ts` 提供统一的页面导航能力，集成了 EventBus 订阅和快捷键监听:

```typescript
export function useNavigation(router: HashRouter): Navigation {
  const [settingsNav, setSettingsNav] = useState<SettingsNavState>({});

  const navigateTo = useCallback((page: Page) => {
    router.setPage(page);
  }, [router.setPage]);

  const navigateToSettings = useCallback((tab: string, highlightId?: string) => {
    setSettingsNav({ tab, highlightId });
    router.setPage('settings');
  }, [router.setPage]);

  // 订阅 NAVIGATION_REQUESTED 事件，响应深链接导航
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
        case 'channels':
          router.setPage('channels');
          break;
        case 'documents':
          router.setPage('notes');
          break;
      }
    });
  }, [router.setPage]);

  // Cmd+K 快捷键打开搜索
  useEffect(() => {
    return onWindowKeydown((e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        router.setPage('search');
      }
    });
  }, [router.setPage]);

  return { settingsNav, navigateTo, navigateToSettings, handleSearchNavigate };
}
```

页面类型定义:

```typescript
const CORE_PAGES = ['chat', 'agent', 'settings', 'search', 'notes', 'agent-profile'] as const;
type CorePage = (typeof CORE_PAGES)[number];
type Page = CorePage | `applet:${string}` | (string & {});
```

`Navigation` 接口:

```typescript
interface Navigation {
  settingsNav: SettingsNavState;
  navigateTo: (page: Page) => void;
  navigateToSettings: (tab: string, highlightId?: string) => void;
  handleSearchNavigate: (url: string) => void;
}
```

HashRouter 接口:

```typescript
interface HashRouter {
  page: Page;
  setPage: (page: Page) => void;
  profileAgentName: string;
  setProfileAgentName: (name: string) => void;
  getDocIdFromHash: () => string | undefined;
}
```

---

## 页面编写规范

> **核心规则**：页面是渲染器，不是数据所有者。
> 数据由 Runtime 投影 / `usePrefetch` / Store 拥有，单点真源 [`runtime-projections.md`](../../../client/desktop/runtime-projections.md)。

### 页面存放位置

独立页面组件放在 `pages/` 目录；如果该页面接入 kernel，则同时存在描述符：

```
src/
  pages/
    SocialChatPage.tsx                # 渲染体
    SocialChatPage.descriptor.tsx     # PageDescriptor 注册（可选 Container）
    SettingsPage.tsx
    SettingsPage.descriptor.tsx
    SettingsPageContainer.tsx
    SearchPage.tsx
    SearchPage.descriptor.tsx
    SearchPageContainer.tsx
    registry.ts                       # registerKernelPages()
    ...
```

### 页面组件签名（kernel 注册的高频页面）

```tsx
// 1. 渲染体只读 Store / Runtime；不在 mount 触发首次加载
export function MemoryPage() {
  const items = useMemoryStore((s) => s.items);
  const loading = useMemoryStore((s) => s.loading);
  return (
    <Flexbox style={{ height: '100%', padding: 16 }}>
      {/* 内容 */}
    </Flexbox>
  );
}
```

```tsx
// 2. 描述符申报 preload / keepAlive / runtimes
import { registerPage } from '../kernel/page';
import { MemoryPage } from './MemoryPage';
registerPage({
  id: 'memory',
  factory: () => <MemoryPage />,
  preload: 'idle',
  keepAlive: 'forever',
  runtimes: ['memory'],
});
```

```tsx
// 3. 真正"长生命周期、跨页面有效"的数据由 Runtime 拥有
//    apps/desktop/src/runtimes/memoryRuntime.ts
export const memoryRuntime: RuntimeDescriptor = {
  id: 'memory',
  scope: 'session',
  install() { /* subscribe events / timers */ },
  teardown() { /* reverse install */ },
  async bootstrap() { await useMemoryStore.getState().load(); },
  async reconcile() { await useMemoryStore.getState().load(); },
};
```

### 反模式（必须改写）

```tsx
// ❌ 在页面 mount 时拉数据：每次进入都跑一遍，且无人负责事件 / 重连刷新
export function MemoryPage() {
  const load = useMemoryStore((s) => s.load);
  useEffect(() => { load(); }, [load]);
  return /* ... */;
}

// ✅ 改写一：迁移成 PageDescriptor + Runtime（高频 / 长生命周期）
// ✅ 改写二：使用 usePrefetch（一次性、页面局部、不需事件驱动失效）
import { usePrefetch } from '../kernel/usePrefetch';
const items = usePrefetch('memory.list', () => api.listMemory()).data;
```

### 未接入 kernel 的低频页面

如果页面是低频、一次性、且没有 reconcile 需求，仍可保留传统写法，但需在 PR 中给出"为什么不进 kernel"的明确理由（参考 [`runtime-projections.md` §7](../../../client/desktop/runtime-projections.md)）。

### 设置面板组件签名

设置面板组件通常铺满分配给它的容器，**也不应在 mount 时直接拉数据**——若需要预热数据，使用 `usePrefetch`，详见 [`runtime-projections.md` §6.4](../../../client/desktop/runtime-projections.md)：

```tsx
export function MemorySettingsTab() {
  return (
    <Flexbox style={{ padding: 24, maxWidth: 560, overflow: 'auto', height: '100%' }} gap={24}>
      {/* 设置内容 */}
    </Flexbox>
  );
}
```

---

## 组件库选择规范

Desktop 前端的组件库选择遵循明确的优先级:

### 优先级 1: LobeUI (@lobehub/ui)

LobeUI 是 Desktop 的首选组件库，已在 `main.tsx` 中全局配置:

```tsx
import { ThemeProvider, ToastHost } from '@lobehub/ui';

<ThemeProvider>
  <App />
  <ToastHost />
</ThemeProvider>
```

新组件应优先使用 LobeUI 提供的组件和样式工具。

### 优先级 2: Ant Design (antd)

仅在 LobeUI 没有对应组件时，才考虑使用 antd。使用前需确认。

项目中已有的 antd 使用场景（参考 `modules/tts/index.tsx`）:

```tsx
import { Form, Select, Slider, Switch, Typography, theme } from 'antd';

function TTSSettings() {
  const { token } = theme.useToken();
  const [form] = Form.useForm();

  return (
    <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
      <Form.Item name="tts_provider" label="Provider">
        <Select options={TTS_PROVIDER_OPTIONS} />
      </Form.Item>
      <Form.Item name="tts_speed" label="Speed">
        <Slider min={0.5} max={2} step={0.1} />
      </Form.Item>
    </Form>
  );
}
```

### 布局工具: react-layout-kit

项目使用 `react-layout-kit` 的 `Flexbox` 组件进行布局:

```tsx
import { Flexbox } from 'react-layout-kit';

<Flexbox style={{ height: '100%' }} gap={16}>
  <Header />
  <Content />
</Flexbox>
```

### 图标: lucide-react

所有图标统一使用 `lucide-react`:

```tsx
import { Brain, Send, User, KeyRound, Volume2 } from 'lucide-react';
```

---

## 新模块开发完整流程

以创建一个名为 "Analytics" 的新模块为例:

**1. 创建页面组件**:

```tsx
// src/pages/AnalyticsPage.tsx
import { useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';

export function AnalyticsPage() {
  return (
    <Flexbox style={{ height: '100%', padding: 16 }}>
      {/* 分析页面内容 */}
    </Flexbox>
  );
}
```

**2. 创建设置面板（如需要）**:

```tsx
// src/components/settings/AnalyticsSettingsTab.tsx
import { Flexbox } from 'react-layout-kit';

export function AnalyticsSettingsTab() {
  return (
    <Flexbox style={{ padding: 24, maxWidth: 560, overflow: 'auto', height: '100%' }} gap={24}>
      {/* 设置项 */}
    </Flexbox>
  );
}
```

**3. 注册模块**:

```typescript
// src/modules/analytics.ts
import { BarChart3 } from 'lucide-react';
import { registerModule } from './registry';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { AnalyticsSettingsTab } from '../components/settings/AnalyticsSettingsTab';

registerModule({
  id: 'analytics',
  name: 'Analytics',
  icon: BarChart3,
  page: AnalyticsPage,
  settingsPanel: AnalyticsSettingsTab,
  sidebarEntry: { position: 'top', order: 60, title: 'Analytics' },
  settingsEntry: { order: 50, label: 'Analytics' },
});
```

**4. 导入触发注册**:

```typescript
// src/modules/index.ts
import './providers';
// ... 其他模块 ...
import './analytics';   // <-- 新增
```

完成上述四步后，Analytics 模块会自动出现在侧边栏和设置页面中，无需修改任何宿主代码。

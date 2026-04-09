# Desktop 页面与组件编写指南

本文档基于 Desktop 应用实际代码，系统性介绍应用入口、状态机驱动的视图切换、模块注册系统、以及页面和组件的编写规范。

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

---

## 状态机驱动的应用架构 (App.tsx)

`App.tsx` 采用状态机模式，根据应用当前状态渲染不同视图:

```tsx
import type { ComponentType } from 'react';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { LoadingView } from './views/LoadingView';
import { LoginView } from './views/LoginView';
import { ReadyView } from './views/ReadyView';
import type { AppState, AppLifecycle } from './types/navigation';

interface ViewProps {
  lifecycle: AppLifecycle;
}

const APP_VIEWS: Record<AppState, ComponentType<ViewProps>> = {
  loading: LoadingView,
  login: LoginView,
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
loading ──(数据就绪 + 开屏动画完成)──> login ──(completeLogin)──> ready
```

| 状态 | 视图 | 说明 |
|------|------|------|
| `loading` | `LoadingView` | 初始化阶段，执行 bootstrap、加载数据、播放开屏动画 |
| `login` | `LoginView` | 展示登录界面或恢复会话 |
| `ready` | `ReadyView` | 主应用界面，包含侧边栏、页面路由等 |

每个视图都接收 `lifecycle: AppLifecycle` prop:

```typescript
type AppState = 'loading' | 'login' | 'ready';

interface AppLifecycle {
  state: AppState;
  restoredUser: SessionUser | null;
  completeLogin: () => void;
  onSplashFinished: () => void;
}

interface SessionUser {
  name: string;
  email: string;
  avatar?: string;
}
```

---

## 视图层 (Views)

Views 是 App 直接渲染的顶层组件，位于 `views/` 目录:

- `LoadingView` — 开屏动画，动画结束后调用 `lifecycle.onSplashFinished()`
- `LoginView` — 登录界面，登录成功后调用 `lifecycle.completeLogin()`
- `ReadyView` — 主应用框架，包含侧边栏导航和页面内容区

视图组件签名统一为:

```tsx
interface ViewProps {
  lifecycle: AppLifecycle;
}

export function LoadingView({ lifecycle }: ViewProps) {
  // 开屏动画逻辑
  // 动画结束时调用 lifecycle.onSplashFinished()
}

export function LoginView({ lifecycle }: ViewProps) {
  // 登录流程
  // 成功后调用 lifecycle.completeLogin()
}

export function ReadyView({ lifecycle }: ViewProps) {
  // 主应用 UI，包含路由、侧边栏、页面内容等
}
```

---

## 应用生命周期 Hook (useAppLifecycle)

`hooks/useAppLifecycle.ts` 管理整个应用的启动流程:

```typescript
export function useAppLifecycle(): AppLifecycle {
  const [state, setState] = useState<AppState>('loading');
  const [restoredUser, setRestoredUser] = useState<SessionUser | null>(null);

  const dataReady = useRef(false);
  const splashDone = useRef(false);

  const tryTransition = useCallback(() => {
    if (dataReady.current && splashDone.current) {
      setState('login');
    }
  }, []);

  // 启动 GlobalContext bootstrap
  useEffect(() => {
    globalContext.bootstrap().catch(() => {});
  }, []);

  // 同步运行时状态到 GlobalContext
  useEffect(() => {
    if (state === 'loading') globalContext.setRuntimeAppState('booting');
    else if (state === 'ready') globalContext.setRuntimeAppState('ready');
    else globalContext.setRuntimeAppState('degraded');
  }, [state]);

  // 并行加载数据
  useEffect(() => {
    const store = useOAuth2Store.getState();
    Promise.all([
      store.restoreSession().catch(() => {}),
      store.loadAll().catch(() => {}),
    ]).then(() => {
      // 尝试恢复已有用户
      const { authenticated, connections } = useOAuth2Store.getState();
      if (authenticated) {
        const active = connections.find(
          (c) => c.status === 'active' && c.user_id && c.user_id !== 'unknown',
        );
        if (active) {
          restoredUserRef.current = {
            name: active.user_name || active.user_id || 'User',
            email: active.email || '',
            avatar: active.avatar_url,
          };
        }
      }
      dataReady.current = true;
      tryTransition();
    });
  }, [tryTransition]);

  // 开屏动画完成回调
  const onSplashFinished = useCallback(() => {
    splashDone.current = true;
    tryTransition();
  }, [tryTransition]);

  // 登录完成回调
  const completeLogin = useCallback(() => {
    useOAuth2Store.getState().loadAll();
    setState('ready');
  }, []);

  return { state, restoredUser, completeLogin, onSplashFinished };
}
```

状态转换的双条件门控:

```
              ┌─────────────┐
              │   loading    │
              └──────┬───────┘
                     │
         ┌───────────┼───────────┐
         │                       │
   dataReady=true         splashDone=true
         │                       │
         └───────────┬───────────┘
                     │
              tryTransition()
                     │
              ┌──────▼───────┐
              │    login     │
              └──────┬───────┘
                     │
              completeLogin()
                     │
              ┌──────▼───────┐
              │    ready     │
              └──────────────┘
```

`loading` -> `login` 需要两个条件同时满足:
1. 数据加载完毕（`dataReady`）
2. 开屏动画播放完毕（`splashDone`）

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

### 页面存放位置

独立页面组件放在 `pages/` 目录:

```
src/
  pages/
    ChannelsPage.tsx
    MemoryPage.tsx
    SettingsPage.tsx
    ...
```

### 页面组件签名

页面组件是无 prop 或接收最少 prop 的 React 组件:

```tsx
export function MemoryPage() {
  // 从 store 获取数据
  const items = useMemoryStore((s) => s.items);
  const loading = useMemoryStore((s) => s.loading);
  const load = useMemoryStore((s) => s.load);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Flexbox style={{ height: '100%', padding: 16 }}>
      {/* 页面内容 */}
    </Flexbox>
  );
}
```

### 设置面板组件签名

设置面板组件通常铺满分配给它的容器:

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

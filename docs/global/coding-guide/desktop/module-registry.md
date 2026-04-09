# Desktop 模块注册表指南

## 架构总览

Desktop 采用**自注册模块架构**。每个功能模块以独立文件存在于 `apps/desktop/src/modules/` 目录下，通过调用 `registerModule()` 将自身注入全局注册表。宿主 UI（App.tsx、SettingsPage.tsx 等）从注册表读取模块列表来动态渲染侧边栏图标、页面路由和设置面板。

核心原则：**新增模块 = 编写模块文件 + 在 index.ts 添加一行 import，零宿主代码改动。**

```
modules/
  registry.ts       ← 注册表核心：接口定义 + Map 存储 + 查询函数
  index.ts           ← 聚合入口：逐行 import 触发所有模块的自注册
  providers.ts       ← 模块示例：import → registerModule({...})
  model-service.ts
  tts/index.tsx
  account.ts
  skills.ts
  mcp.ts
  channels.ts
  cron.ts
  memory.ts
  applets.ts
  logs.ts
  connections.ts
```

`main.tsx` 中只需一行：

```typescript
import './modules';
```

该 import 会执行 `modules/index.ts`，其中的每一行 import 又触发对应模块文件的顶层 `registerModule()` 调用。整个流程完全在应用启动时同步完成。


## ModuleFrontend 接口

```typescript
export interface SidebarEntry {
  position: 'top' | 'bottom';   // 侧边栏区域：top 为主功能区，bottom 为辅助区
  order: number;                 // 同区域内的排序权重，越小越靠前
  title?: string;                // 鼠标悬浮时显示的提示文字
}

export interface SettingsEntry {
  order: number;                 // 设置页 Tab 的排序权重
  label?: string;                // Tab 显示文字，缺省取 name
  tooltip?: string;              // 额外提示信息
}

export interface ModuleFrontend {
  id: string;                    // 唯一标识，如 'providers'、'memory'
  name: string;                  // 人类可读名称
  icon: LucideIcon;              // lucide-react 图标组件

  page?: React.ComponentType<any>;           // 独立页面组件
  settingsPanel?: React.ComponentType<any>;  // 设置面板组件

  sidebarEntry?: SidebarEntry;   // 需要侧边栏图标时提供
  settingsEntry?: SettingsEntry; // 需要出现在设置页时提供
}
```

字段组合关系：

| 场景 | 需要的字段 |
|------|-----------|
| 仅出现在设置页 | `settingsPanel` + `settingsEntry` |
| 仅出现在侧边栏（独立页面） | `page` + `sidebarEntry` |
| 同时有独立页面和设置面板 | `page` + `sidebarEntry` + `settingsPanel` + `settingsEntry` |
| 条件注册（功能开关） | 包裹在 `if` 中按需调用 `registerModule()` |


## registerModule 注册函数

```typescript
const registry = new Map<string, ModuleFrontend>();

export function registerModule(def: ModuleFrontend) {
  registry.set(def.id, def);
}
```

- 以 `id` 为键存入 Map，后注册会覆盖先注册。
- 必须在应用渲染之前完成所有注册（即在 `main.tsx` 的 import 链中执行）。
- 注册是同步的，不涉及异步加载。


## 查询函数

```typescript
// 获取单个模块
export function getModule(id: string): ModuleFrontend | undefined {
  return registry.get(id);
}

// 获取全部模块
export function getAllModules(): ModuleFrontend[] {
  return Array.from(registry.values());
}

// 获取所有有独立页面的模块
export function getModulesWithPages(): ModuleFrontend[] {
  return getAllModules().filter((m) => m.page);
}

// 获取所有有设置面板的模块，按 order 升序排列
export function getModulesWithSettings(): ModuleFrontend[] {
  return getAllModules()
    .filter((m) => m.settingsPanel && m.settingsEntry)
    .sort((a, b) => a.settingsEntry!.order - b.settingsEntry!.order);
}

// 获取所有有侧边栏入口的模块，按 order 升序排列
export function getModulesWithSidebar(): ModuleFrontend[] {
  return getAllModules()
    .filter((m) => m.sidebarEntry)
    .sort((a, b) => a.sidebarEntry!.order - b.sidebarEntry!.order);
}
```

宿主 UI 的典型用法：

```typescript
// 侧边栏渲染
const sidebarModules = getModulesWithSidebar();
const topItems = sidebarModules.filter((m) => m.sidebarEntry!.position === 'top');
const bottomItems = sidebarModules.filter((m) => m.sidebarEntry!.position === 'bottom');

// 设置页 Tab 渲染
const settingsTabs = getModulesWithSettings();

// 路由渲染
const pageModules = getModulesWithPages();
```


## 现有 12 个模块

| id | 文件 | name | icon | page | settings | sidebar |
|----|------|------|------|------|----------|---------|
| `providers` | providers.ts | Providers | Server | - | order: 10 | - |
| `models` | model-service.ts | Model Service | Cpu | - | order: 15 | - |
| `account` | account.ts | OAuth Sign-In | User | - | order: 20 | - |
| `memory` | memory.ts | Memory | Brain | MemoryPage | order: 25 | top, order: 35 |
| `connections` | connections.ts | OAuth Client Connections | KeyRound | - | order: 26 (条件注册) | - |
| `skills` | skills.ts | Skills | BookMarked | - | order: 30 | - |
| `tts` | tts/index.tsx | Voice | Volume2 | - | order: 35 | - |
| `mcp` | mcp.ts | MCP | Cable | - | order: 35 | - |
| `applets` | applets.ts | Applets | Blocks | AppletsPage | - | top, order: 30 |
| `channels` | channels.ts | Channels | Send | ChannelsPage | order: 40 | top, order: 50 |
| `cron` | cron.ts | Cron Jobs | Clock | CronPage | - | top, order: 40 |
| `logs` | logs.ts | Logs | FileText | - | order: 80 | - |

`connections` 模块是条件注册的示例：

```typescript
const isAdvancedConnectionsEnabled = (() => {
  const envEnabled = import.meta.env.VITE_ENABLE_ADVANCED_OAUTH_CONNECTIONS === 'true';
  const runtimeEnabled = (() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem('pt.settings.advanced_oauth_connections') === '1';
    } catch {
      return false;
    }
  })();
  return envEnabled || runtimeEnabled;
})();

if (isAdvancedConnectionsEnabled) {
  registerModule({ ... });
}
```


## 如何新增一个模块

### 第一步：创建模块文件

在 `modules/` 下创建新文件，例如 `modules/analytics.ts`：

```typescript
import { BarChart2 } from 'lucide-react';
import { registerModule } from './registry';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { AnalyticsSettingsTab } from '../components/settings/AnalyticsSettingsTab';

registerModule({
  id: 'analytics',
  name: 'Analytics',
  icon: BarChart2,
  page: AnalyticsPage,
  settingsPanel: AnalyticsSettingsTab,
  sidebarEntry: { position: 'top', order: 45, title: 'Analytics' },
  settingsEntry: { order: 50 },
});
```

### 第二步：在 index.ts 中添加 import

```typescript
import './providers';
import './model-service';
// ... 其他已有 import ...
import './connections';
import './analytics';   // ← 新增这一行
```

### 完成

不需要修改 App.tsx、侧边栏组件、设置页组件或任何路由配置。宿主 UI 通过 `getModulesWithSidebar()`、`getModulesWithPages()`、`getModulesWithSettings()` 自动发现新模块。

这就是**零宿主代码改动**原则的含义：模块的存在性完全由注册表决定，宿主代码是声明式的消费者，不感知具体模块。


## 设计要点

1. **排序由 order 字段控制**：侧边栏和设置页 Tab 的顺序通过 `sidebarEntry.order` 和 `settingsEntry.order` 决定。建议以 5 或 10 为间距，留出插入空间。

2. **id 全局唯一**：同一 id 的后注册会覆盖先注册。生产中避免重复 id。

3. **图标统一使用 lucide-react**：所有模块的 icon 字段类型为 `LucideIcon`，确保视觉一致性。

4. **组件通过 React.ComponentType 引用**：`page` 和 `settingsPanel` 都是 React 组件类型，渲染时由宿主动态创建。如果模块包含复杂 UI（如 TTS），可以使用子目录组织（参考 `modules/tts/index.tsx`）。

5. **条件注册**：需要功能开关的模块，在调用 `registerModule()` 前加入条件判断即可，参考 `connections.ts` 的实现。

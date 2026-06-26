# Prototype Portal — 统一原型入口执行计划

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-22 | **Updated**: 2026-06-24
> **Owner**: Architecture Team

---

## 1. 背景与目标

当前原型体系已经有统一总账和 `packages/prototypes/` 源码工作区，但入口仍偏文档化：

- 原型工程由各模块独立维护，缺少一个随时可运行的统一入口。
- `docs/architecture/prototypes/README.md` 更像总账，不像原型工作台。
- 多个 worktree/分支上的原型无法在同一个入口中横向对比。
- Agent 创建或查找原型时，需要反复理解目录、运行方式、确认门和模块入口。

本计划把原型体系升级为 **Prototype Portal**：一个长期可运行的前端服务，统一聚合 desktop、mobile、dashboard（Station Dashboard）三类原型站点，并支持在不同 worktree/branch 之间切换预览。

---

## 2. 用户级需求

1. 原型模块各自维护自己的代码，并通过标准 manifest 注入统一入口。
2. 统一入口随时可运行，本身是一个前端服务。
3. Peers Touch 原型分为三个独立站点：
   - `mobile`
   - `desktop`
   - `dashboard`（Station Dashboard）
4. 统一入口可以切换分支版本。不同分支版本（worktree 本质也是分支）可以在同一个统一入口中展示该分支当前的需求原型。

---

## 3. 非目标

- 不把原型变成产品代码。
- 不要求原型直接复用最终运行时（例如 Lynx / applet SDK）。
- 不在同一个 Vite bundle 中直接 import 其他 worktree 的源码。
- 不把 git 历史、tag 或复制目录当作原型版本管理方式。
- 不用 Portal 替代模块级 `prototype/README.md`，模块入口仍保留作为局部说明。

---

## 4. 目标架构

### 4.1 三层结构

```text
docs/architecture/prototypes/README.md
  全局原型入口文档：Portal、总账、确认门、执行计划导航

packages/prototypes/portal/
  可运行的统一 Prototype Portal 前端服务

packages/prototypes/<site>/<area>/<id>/
  各模块自维护的原型工程与 manifest；物理目录必须跟随 desktop / mobile / dashboard 站点层级
```

模块级文档仍保留：

```text
docs/architecture/<module>/prototype/README.md
```

它只回答该模块的原型在哪里、对应哪份设计、当前差异是什么，不再承担全局入口职责。

### 4.2 源码目录建议

```text
packages/prototypes/
├── README.md
├── portal/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── registry/
│   │   │   ├── localManifests.ts
│   │   │   ├── worktrees.ts
│   │   │   └── types.ts
│   │   ├── sites/
│   │   │   ├── DesktopSite.tsx
│   │   │   ├── MobileSite.tsx
│   │   │   └── DashboardSite.tsx
│   │   └── preview/
│   │       ├── LocalPreview.tsx
│   │       └── RemoteWorktreePreview.tsx
│   ├── package.json
│   └── vite.config.ts
├── desktop/
│   ├── shell/
│   │   ├── prototype.manifest.ts
│   │   └── src/
│   ├── applets/
│   │   └── atelier/
│   │       ├── prototype.manifest.ts
│   │       └── src/
│   └── features/
│       ├── call/
│       │   ├── prototype.manifest.ts
│       │   └── src/
│       └── social-chat/
│           ├── prototype.manifest.ts
│           └── src/
├── mobile/
│   └── chat/
│       ├── prototype.manifest.ts
│       └── src/
└── dashboard/
    └── station-dashboard/
        ├── prototype.manifest.ts
        └── src/
```

---

## 5. 核心机制

### 5.1 模块注入：Prototype Manifest

每个原型模块提供 `prototype.manifest.ts`：

```ts
export default {
  id: 'atelier',
  title: 'Atelier',
  site: 'desktop',
  status: 'drafting',
  host: 'desktop',
  kind: 'applet',
  module: 'atelier',
  docs: 'docs/architecture/atelier/prototype/README.md',
  entry: () => import('./src/Page'),
};
```

Portal 通过 `import.meta.glob('../*/prototype.manifest.ts')` 扫描当前 worktree 中的 manifest，构建本地原型列表。

### 5.2 三站点分类

`site` 取值固定为：

```ts
type PrototypeSite = 'desktop' | 'mobile' | 'dashboard';
```

分类规则：

| Site | 说明 | 示例 |
|------|------|------|
| `desktop` | Desktop App / desktop-web / applet 容器内体验 | atelier、desktop shell、social-chat |
| `mobile` | Mobile 端交互、页面、组件、跨端移动体验 | mobile chat、mobile form |
| `dashboard` | Station Dashboard / 管理台 / 运维台 / 控制台体验 | station admin dashboard |

登记表与 manifest 必须区分 **站点/宿主** 和 **原型 ID**：

- `desktop` 是一级站点。
- `atelier` 是运行在 desktop 站点内的 applet 原型，不是一级站点。
- `call` / `social-chat` 是 desktop 站点内的能力原型，不是和 `desktop` 并级的一级模块。

### 5.3 当前 worktree 预览

当前 worktree 内的原型有两种预览模式：

| 模式 | 优点 | 缺点 |
|------|------|------|
| 直接 render React component | 快、无需启动多个端口 | Portal 和原型共享 bundle，隔离较弱 |
| iframe 预览 | 与跨 worktree 模型一致、隔离强 | 需要每个原型有独立 dev server |

阶段 1-2 先允许直接 render，阶段 5 统一收敛到 iframe preview，以便与 worktree 切换能力一致。

### 5.4 跨 worktree / 分支预览

跨 worktree 的核心原则：

> Portal 不直接 import 其他 worktree 的源码。每个 worktree 自己运行原型服务，Portal 只保存 registry，并用 iframe 展示。

当前 registry 结构：

```ts
type PrototypeWorktreeTarget = {
  id: string;
  label: string;
  branch: string;
  worktreePath: string;
  portalUrl?: string;
  sites: Partial<Record<PrototypeSite, string>>;
};
```

示例：

```json
{
  "id": "peers-ai-agent",
  "label": "peers-ai-agent",
  "branch": "peers-ai-agent",
  "worktreePath": "/Users/bytedance/Documents/Projects/peers-touch/peers-ai-agent",
  "portalUrl": "http://localhost:3201",
  "sites": {
    "desktop": "http://localhost:3201/desktop"
  }
}
```

配置方式：

- 当前 worktree 由 `make run-prototype <site>` 自动注入 `VITE_PROTOTYPE_BRANCH` 与 `VITE_PROTOTYPE_WORKTREE_PATH`。
- 外部 worktree 通过 `VITE_PROTOTYPE_WORKTREES` 注入 JSON 数组。
- Portal 顶栏提供 Worktree/Branch selector；选择 `current` 时使用当前 worktree 的 manifest 直接 render，选择外部 target 时使用对应 `sites[site]` URL 的 iframe。

### 5.5 统一入口 UI

Portal 首屏结构：

```text
Top Bar
  Worktree/Branch selector
  Current URL / running status

Left Nav
  Desktop
  Mobile
  Dashboard

Main
  Prototype cards/list
  Status / docs / module / branch metadata

Preview
  Local render 或 iframe preview
```

---

## 6. 命令设计

### 6.1 Makefile

新增或调整：

```bash
make run-prototype desktop
make run-prototype mobile
make run-prototype dashboard
```

只通过 Makefile 启动原型服务。用户和 Agent 不直接运行原型工程的原生命令。

可选命令：

```bash
make prototypes-scan
make prototypes-worktree
```

### 6.2 原生命令约束

`pnpm dev`、Vite dev server 等原生命令只允许作为 Makefile 内部实现细节。正式入口统一是 `make run-prototype <desktop|mobile|dashboard>`，避免不同 Agent/开发者绕开统一端口、registry、worktree 检测和启动约束。

---

## 7. 文档与 Skill 更新

### 7.1 文档

需要更新：

| 文件 | 变更 |
|------|------|
| `docs/architecture/prototypes/README.md` | 从“总账”升级为“Prototype Portal + 总账 + 确认门”入口 |
| `packages/prototypes/README.md` | 新增源码工作区说明、运行方式、manifest 规范 |
| `docs/architecture/<module>/prototype/README.md` | 保留为模块说明，增加 Portal 反链 |

### 7.2 Skill

更新：

| Skill | 变更 |
|-------|------|
| `prototype-design` | 先找 Prototype Portal 和 `packages/prototypes/README.md`，再找模块入口；新原型必须提供 manifest |
| `plan-and-document` | 无需改主流程，但示例可补充 prototype portal 场景 |

---

## 8. 实施阶段

### Phase 1: 文档定稿

目标：

- 本执行计划经 Owner 确认。
- `docs/architecture/prototypes/README.md` 明确 Portal 是统一入口。
- `packages/prototypes/README.md` 明确源码工作区和 manifest 规范。

验收：

- 新会话中的 Agent 能根据文档找到统一入口、总账、模块入口和源码目录。

### Phase 2: Portal 最小可运行版本

目标：

- 新增 `packages/prototypes/portal/`。
- 能展示 `desktop` 站点。
- 能扫描当前 worktree 的 manifest。
- 能预览至少一个已有原型。

验收：

- `make run-prototype desktop` 可启动 desktop 原型站点。
- `make run-prototype mobile` 可启动 mobile 原型站点（可为空态）。
- `make run-prototype dashboard` 可启动 dashboard 原型站点（可为空态）。
- 浏览器可看到站点导航和原型列表。

### Phase 3: 现有原型接入 manifest

目标：

- 为现有原型补 `prototype.manifest.ts`：
  - `atelier`
  - `desktop`
  - `call`
  - `social-chat`

验收：

- Portal 自动发现以上原型。
- 每个原型卡片能显示状态、docs、模块、site。

### Phase 4: 三站点形态补齐

目标：

- Portal UI 明确区分 `desktop`、`mobile`、`dashboard`。
- 即使某站点暂时没有原型，也显示空状态和创建指引。

验收：

- 用户能在 Portal 中切换三类站点。
- 新原型接入时必须填 manifest 的 `site` 字段，并正确声明宿主/归属，不能把 applet 或局部能力登记成一级站点。

### Phase 5: Worktree / Branch 版本切换

目标：

- 增加 worktree registry。
- Portal 可选择不同 worktree target。
- 跨 worktree preview 走 iframe。

验收：

- 主 worktree 的 Portal 可以展示另一个 worktree 中正在运行的原型服务。
- worktree 切换不要求复制源码、不要求切 git 分支。

### Phase 6: 规范收敛

目标：

- 更新 `prototype-design` skill。
- 更新 `make skills` 后确保 IDE 能加载新版 skill。
- 更新原型总账和模块入口的反链。

验收：

- 新会话中，Agent 能自动按 Portal 规范创建原型。
- 未提供 manifest 的新原型不能视为完整接入。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 直接 render 与 iframe 两套预览模型造成复杂度 | 阶段性允许直接 render，最终统一到 iframe |
| worktree 服务端口冲突 | worktree registry 显式记录端口；Makefile 启动时提示冲突 |
| manifest 字段随意扩散 | 先固定最小字段，新增字段必须更新 `packages/prototypes/README.md` |
| Portal 变成产品工程 | 文档明确 Portal 只服务原型确认，不进入正式产品代码路径 |
| 三站点命名不稳定 | `site` 枚举固定为 `desktop` / `mobile` / `dashboard` |

---

## 10. 验证方式

- `make run-prototype desktop` 可启动 desktop 原型站点。
- `make run-prototype mobile` 可启动 mobile 原型站点。
- `make run-prototype dashboard` 可启动 dashboard 原型站点。
- Portal 能列出当前 worktree 的 manifest 原型。
- 三站点切换正常。
- 至少一个原型可以预览。
- worktree registry 中登记另一个 worktree 后，Portal 可通过 iframe 展示其原型服务。
- `docs/architecture/prototypes/README.md` 和 `packages/prototypes/README.md` 能说明全部入口和接入规则。

---

## 11. 当前状态

| Phase | 状态 | 备注 |
|-------|------|------|
| Phase 1 | done | 执行计划、总账入口、工作区 README 已补齐 |
| Phase 2 | done | 最小 Portal 已可通过 `make run-prototype desktop/mobile/dashboard` 运行 |
| Phase 3 | done | `desktop`、`atelier`、`call`、`social-chat` 已接入 manifest，Portal 已自动发现 |
| Phase 4 | done | `mobile-chat` 与 `station-dashboard` 已补齐，Portal Live Preview 已基于 manifest 渲染当前站点默认原型 |
| Phase 5 | done | 已支持 worktree registry、Worktree/Branch selector、远端 iframe preview；外部 target 通过 `VITE_PROTOTYPE_WORKTREES` 注入 |
| Phase 6 | done | prototype-design skill 已同步 worktree registry 规则，各入口文档已更新 |

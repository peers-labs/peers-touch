# Prototypes Workspace

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-22 | **Updated**: 2026-06-24
> **Owner**: Architecture Team

---

## 1. 定位

`packages/prototypes/` 是 Peers Touch 的统一原型源码工作区。

这里的原型是 UI/UX 与交互设计的可执行表达，用于 Owner 确认体验方向，不是最终产品代码，也不直接绑定 Desktop / Mobile / Station 的真实运行时。

正式入口文档见：[`docs/architecture/prototypes/README.md`](../../docs/architecture/prototypes/README.md)。

---

## 2. 一级原型站点

原型按站点归属组织，而不是按每个原型工程目录并列成一级模块。

| 站点 | 含义 | 示例 |
|------|------|------|
| `desktop` | Desktop App / desktop-web / applet 容器内体验 | desktop shell、atelier applet、social chat、call |
| `mobile` | Mobile 端页面、组件与交互体验 | mobile shell、chat、contacts |
| `dashboard` | Station Dashboard / 管理台 / 运维台体验 | station admin dashboard |

注意：

- `atelier` 是 desktop 站点内的 applet 原型，不是一级站点。
- `call` / `social-chat` 是 desktop 站点内的能力原型，不是和 `desktop` 并级的一级模块。

物理目录也必须表达同样的层级：

```text
packages/prototypes/
├── portal/
├── desktop/
│   ├── shell/
│   ├── applets/
│   │   └── atelier/
│   └── features/
│       ├── call/
│       └── social-chat/
├── mobile/
│   └── chat/
└── dashboard/
    └── station-dashboard/
```

---

## 3. 运行方式

统一入口：

```bash
make run-prototype
```

并行开发 / 多 worktree 预览时使用：

```bash
make -w run-prototype
```

Prototype Portal 内部提供 `desktop` / `mobile` / `dashboard` 站点切换。禁止把 `pnpm dev` / Vite 原生命令作为对用户或 Agent 的正式运行方式。原生命令只允许作为 Makefile 内部实现细节。

The Portal stacks its navigation and wraps worktree controls on narrow screens
so Mobile previews keep their usable width. The Mobile render regression is
`mobile/chat/scripts/check-layout.mjs`; run it against the Make-started Portal
with `PROTOTYPE_URL`. See the Mobile prototype README for evidence and limits.

跨 worktree / branch 预览：

- 当前 worktree 信息由 `make run-prototype` 自动注入 Portal。
- `make run-prototype` 默认同一 worktree 排它；`make -w run-prototype` 跳过排它锁并自动递增到下一个空闲端口。
- 外部 worktree 需要自行启动自己的 Prototype Portal，然后通过 `VITE_PROTOTYPE_WORKTREES` 注入 registry。
- Portal 选择外部 worktree 时只使用 iframe 展示对应 URL，不直接 import 其他 worktree 的源码。

`VITE_PROTOTYPE_WORKTREES` 示例：

```json
[
  {
    "id": "peers-ai-agent",
    "label": "peers-ai-agent",
    "branch": "peers-ai-agent",
    "worktreePath": "<repo-root>",
    "sites": {
      "desktop": "http://localhost:3200/",
      "mobile": "http://localhost:3201/",
      "dashboard": "http://localhost:3202/"
    }
  }
]
```

---

## 4. 当前原型工程

| 站点 | 原型 ID | 路径 | 说明 |
|------|---------|------|------|
| all | `portal` | `packages/prototypes/portal/` | 统一 Prototype Portal，按 `desktop` / `mobile` / `dashboard` 切换站点 |
| desktop | `desktop-shell` | `packages/prototypes/desktop/shell/` | Desktop 容器外壳原型 |
| desktop | `atelier` | `packages/prototypes/desktop/applets/atelier/` | Desktop 内的 applet 原型 |
| desktop | `applet-lifecycle` | `packages/prototypes/desktop/features/applet-lifecycle/` | Applet Box 极简 launcher 与安装包导入生命周期原型 |
| desktop | `call` | `packages/prototypes/desktop/features/call/` | Desktop Chat/通话能力原型 |
| desktop | `social-chat` | `packages/prototypes/desktop/features/social-chat/` | Desktop Chat 能力原型 |
| mobile | `mobile-chat` | `packages/prototypes/mobile/chat/` | Mobile Shell 产品原型：Station trust、OAuth、Chat、Moments、Contacts、Me 与恢复状态 |
| dashboard | `station-dashboard` | `packages/prototypes/dashboard/station-dashboard/` | Station Dashboard 运维台体验基准原型 |

---

## 5. Manifest 接入要求

每个原型工程必须提供 `prototype.manifest.ts`。Portal 会通过 `import.meta.glob` 自动发现当前 worktree 下的 manifest，并注入统一入口。

- `id`：原型 ID，例如 `atelier`
- `title`：Portal 卡片展示标题
- `site`：一级站点，只能是 `desktop` / `mobile` / `dashboard`
- `host`：宿主，例如 `desktop`
- `kind`：原型类型，例如 `shell` / `applet` / `feature`
- `status`：确认门状态
- `module`：所属模块或能力名
- `path`：原型源码路径
- `docs`：模块级 prototype README 或总账入口
- `description`：Portal 卡片说明
- `order`：同一站点内的展示排序
- `previewExport`：Portal Live Preview 使用的组件导出名
- `entry`：懒加载入口，例如 `() => import('./src/Page')`

未提供 manifest 的新原型不能视为完整接入。

# Composite Promotion Pilot — Module Layout

> **Status**: draft · **Owner**: Client Platform / UI System
> 本文件修订父模块 [../module-layout.md](../module-layout.md) 的分层口径；
> 评审通过后父文件加反向链接，原「业务 Pattern 留宿主」表述保留并增加复合层例外。

## 1. 目标目录树

```text
packages/ui/
  contracts/          # 既有：语义类型与能力目录（新增复合能力登记）
  tokens/             # 既有：数值与 CSS 变量（复合件只消费，不新增私有 token）
  assets/             # 既有：图标/品牌（复合件经 ui Icon 间接消费）
  semantics/          # 既有：纯解析
  web/                # 既有：@peers-touch/ui 原语 renderer（复合件的唯一 UI 依赖）
  desktop/            # 既有：占位，本试点不使用
  composite/          # 新增：@peers-touch/ui-composite
    package.json
    tsconfig.json
    vitest.config.ts
    src/
      index.ts                    # 唯一公共入口；禁止深路径 import
      i18n.ts                    # CompositeTranslate 类型
      hooks.ts                   # SurfaceHooks / RegionKey 通用类型
      test-utils/               # 包内测试挂载工具（不导出到包外）
      search/
        GlobalSearchSurface.tsx
        search.types.ts          # 视图模型/回调/区域键
        search.css               # ptc-* 规则，只引用 --pt-*
        GlobalSearchSurface.test.tsx
      identity/
        IdentityProfileCard.tsx
        identity.types.ts
        identity.css
        IdentityProfileCard.test.tsx
      conversation-rail/
        ConversationRail.tsx
        ConversationRow.tsx      # 行单元可单独导出（试点第三组件内部使用）
        conversation-rail.types.ts
        conversation-rail.css
        ConversationRail.test.tsx
```

## 2. 包合同（package.json 要点）

```json
{
  "name": "@peers-touch/ui-composite",
  "private": true,
  "type": "module",
  "sideEffects": ["**/*.css"],
  "exports": { ".": "./src/index.ts" },
  "scripts": { "check": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@peers-touch/ui": "workspace:*" },
  "peerDependencies": { "react": "^19.2.0", "react-dom": "^19.2.0" },
  "devDependencies": { "vitest": "^4.1.8", "jsdom": "^26.1.0" }
}
```

- 不直接依赖 tokens/assets：经 `@peers-touch/ui` 的公共导出消费，保证原语
  升级时复合件只面对稳定入口。
- `sideEffects` 声明与 ui 包一致，CSS 可被宿主打包器正确合并。
- pnpm-workspace.yaml 已含 `packages/ui/*` glob，无需改工作区配置。

## 3. 导出边界

- 只有 `src/index.ts` 对外；禁止宿主深路径 import 内部文件（tsc 不强制时由
  review + 后续 ESLint 规则补；登记为技术债）。
- 导出内容：三个组件、各自 `.types.ts` 的类型、`CompositeTranslate`、
  `SurfaceHooks` 类型。不导出 CSS 模块对象、不导出测试工具。
- 组件命名（规范名）与宿主文件名解耦：

| 规范导出 | 原型宿主文件（改造后） | 生产宿主文件（改造后） |
|---|---|---|
| `GlobalSearchSurface` | `prototypes/shared/ui-system/search/GlobalSearchOverlay.tsx`（瘦身为适配层） | `apps/desktop/src/components/search/SearchOverlay.tsx`（瘦身为适配层） |
| `IdentityProfileCard` | `prototypes/shared/ui-system/identity/IdentityCard.tsx`（适配层 + Trigger 留原型） | `apps/desktop/src/components/profile/PublicProfileCard.tsx`（适配层） |
| `ConversationRail`（含 `ConversationRow`） | `prototypes/shared/ui-system/chat/ChatRail.tsx`（适配层） | `apps/desktop/src/components/chat/ChatSessionList.tsx`（适配层） |

## 4. 与现有分层的关系

| 层 | 职责 | 本试点后的变化 |
|---|---|---|
| ui/web 原语 | 单控件定义、状态机、可访问性 | 不变；复合件成为其消费者 |
| ui/composite（新） | 多槽位产品级组合体、纯展示、内部 UI 瞬时态 | 新增；不拥有业务真源 |
| 原型宿主 | seed、标本框架、本地仿真、prefs 词典 | 删除私写组合体，保留数据装配 |
| Desktop 宿主 | store/runtime/native 能力、路由、feedback | 删除重复组件，保留数据装配 |
| 业务 Pattern/Page | 面级布局与跨组件编排 | 仍留原业务 Owner，本试点不吞并 |

禁止关系（机械阻断）：

- composite 包的 import 图中出现 `apps/`、`packages/prototypes/`、
  `zustand`、`react-i18next`、`antd`、`@lobehub`、`lucide-react` 即 CI 失败
  （check 脚本 + 评审；后续沉淀为 devctl 检查项）。
- 宿主 CSS 不得出现 `.ptc-*` 选择器（沿用 primitive-layer-guard 模式，
  新增 composite-layer-guard 或扩展现有 guard）。

## 5. 样式归属

- 复合包 CSS 与组件同目录，类名前缀 `ptc-`（peers-touch composite）。
- 仅允许 `var(--pt-*)` 与布局常量；几何/动效常量优先引用
  `@peers-touch/ui` 导出的 `geometry`。
- 原型 pine-glass 皮肤继续由 `DesignDirections.tsx` 的 PT_BRIDGE 注入，
  复合包不感知 `--sk-*` 变量存在。

## 6. 测试归属

- 行为/契约测试与组件同目录 colocate，属复合包 vitest 单元。
- 宿主侧只保留接线测试（props/hooks/插槽映射）与既有 native gate；
- `north-star.suite.json` 与 `boards.suite.json` 仍跑真实原型页面，
  是复合件在标本宿主中的端到端证据。

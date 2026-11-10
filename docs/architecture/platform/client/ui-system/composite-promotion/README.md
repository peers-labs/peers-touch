# UI Composite Promotion Pilot（原型-生产同源复合组件试点）

> **Status**: draft（等待架构评审；评审通过前不授权任何实现代码）
> **Created**: 2026-11-10
> **Owner**: Client Platform / UI System
> **Branch**: `feat/ui-composite-promotion-pilot`（基于 `origin/master` 88fee1eec）
> **Parent module**: [../README.md](../README.md)（ui-system）

## 1. 这是什么

把北极星原型中已验证的**复合组件**（multi-slot、带内部 UI 状态的产品级组合体）
从 `packages/prototypes` 晋升进 `packages/ui` 的新复合层，使原型与 Desktop
生产侧 import 同一份组件代码；业务数据通过**注入端口（props/渲染插槽）**接入，
组件本身不接触 seed、store、runtime 与任何请求。

本模块是 ui-system 父模块的**细化与局部修订**：父模块
[UI-D06](../decisions.md)（proposed）提出 Composite 拥有具名槽位与 plane
声明，本试点是其第一次工程落地，并据此把父模块 module-layout 中
「新 Pattern 留在原业务 Owner」的口径修订为「原语留 web 层、同源复合件留
composite 层、业务 Pattern 仍留宿主层」。

## 2. 试点范围（三个组件，不可扩张）

| # | 复合组件 | 原型源 | 生产源 |
|---|---|---|---|
| 1 | `GlobalSearchSurface` | `packages/prototypes/shared/ui-system/search/GlobalSearchOverlay.tsx` | `apps/desktop/src/components/search/SearchOverlay.tsx` |
| 2 | `IdentityProfileCard`（self/author/sheet 三态） | `packages/prototypes/shared/ui-system/identity/IdentityCard.tsx` | `apps/desktop/src/components/profile/PublicProfileCard.tsx` |
| 3 | `ConversationRail`（轨壳 + 会话行单元） | `packages/prototypes/shared/ui-system/chat/ChatRail.tsx`（ChatFeature rail 段） | `apps/desktop/src/components/chat/ChatSessionList.tsx` |

每个组件独立交付、独立可回滚；一个组件跑通全链路后才开始下一个。

## 3. 文档导航

- [design.md](./design.md) — 证据台账、范围/非范围、运行单元与边界、端口契约总览、视觉对账、质量门禁
- [decisions.md](./decisions.md) — CMP-D01…D08 决策记录（含备选方案与负面后果）
- [module-layout.md](./module-layout.md) — `packages/ui/composite` 目录树、导出边界、与 web/desktop 分层关系
- [data-model.md](./data-model.md) — 三个组件的视图模型/回调/`t` 函数/宿主 DOM hook 契约与全量选择器清单
- [integration.md](./integration.md) — 双宿主适配模式、迁移映射、测试改造、guard/registry 联动、回滚策略
- [../composite-promotion-reuse-topology.svg](../composite-promotion-reuse-topology.svg) — 复用拓扑图（renderer 生成，spec 同级 `composite-promotion-reuse-topology.diagram.json`）
- [execution-plans/20261110-ui-composite-promotion-pilot/plan.md](./execution-plans/20261110-ui-composite-promotion-pilot/plan.md) — 分组件执行计划（评审通过后由执行方法论冻结）

## 4. 硬边界（一页速览）

1. 复合包只依赖 `@peers-touch/ui` 与 react 对等依赖；禁止 antd、@lobehub、
   react-i18next、lucide-react、zustand、任何 `apps/*` 与原型 seed 的 import。
2. 组件只持有内部 UI 状态（roving focus、展开折叠、进出相位）；所有业务数据
   与副作用经端口注入。
3. 被 `tooling/acceptance/gates` 与 `north-star.suite.json` 锁定的 DOM 选择器
   一个不丢；不靠修改/跳过 gate 变绿。
4. 样式只允许 `--pt-*` token；暗色经 token 自动成立；禁止硬编码色值。
5. 文案全部走 i18n key，组件接收 `t` 函数，包内不存在自然语言字符串与词典。
6. 不做窄屏响应式、不做视觉重设计、不碰 mobile、不改 store/runtime；
   端口不适配即记录阻塞，不顺手改架构。

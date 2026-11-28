# UI Composite Promotion Pilot — 实施计划

> **Plan ID**: UICOMP-20261110
> **Status**: draft — 设计评审通过后由 `pt-architecture-execution-methodology`
> 冻结为 Plan North Star；冻结前不授权实现代码。
> **Created**: 2026-11-10
> **Owner**: Client Platform / UI System
> **Worktree**: `peers-android` · branch `feat/ui-composite-promotion-pilot`

## 1. 目标与完成口径

试点完成后必须同时成立：

1. `@peers-touch/ui-composite` 包存在，依赖白名单闭合，三个复合组件经同一
   公共入口导出，包内零 seed/store/runtime/框架级依赖。
2. 原型与 Desktop 生产对每个组件 import 同一份实现；六份旧文件全部瘦身为
   宿主适配层，旧私写 DOM/CSS 删除，无双实现残留。
3. data-model.md 登记的全部 gate/suite 选择器在改造后 DOM 中静态可命中；
   native gate 与 north-star suite 选择器零改动。
4. 复合包行为测试覆盖键盘/回调/插槽/双 hook；Desktop 旧字符串断言测试转为
   接线测试且断言覆盖面不缩减。
5. `pnpm run check` / vitest / build / evaluate-specimens / 两个 layer guard
   全绿；specimen 0 console error。
6. registry、catalogue、baseline、架构模块登记与本计划任务同步更新。

## 2. Plan Version（冻结时补 digest）

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "UICOMP-20261110",
  "versionId": "20261110-ui-composite-promotion-pilot-draft",
  "workClass": "frontend-architecture",
  "architecture": {
    "sources": [
      "docs/architecture/platform/client/ui-system/composite-promotion/README.md",
      "docs/architecture/platform/client/ui-system/composite-promotion/design.md",
      "docs/architecture/platform/client/ui-system/composite-promotion/decisions.md",
      "docs/architecture/platform/client/ui-system/composite-promotion/module-layout.md",
      "docs/architecture/platform/client/ui-system/composite-promotion/data-model.md",
      "docs/architecture/platform/client/ui-system/composite-promotion/integration.md"
    ],
    "decisions": ["CMP-D01", "CMP-D02", "CMP-D03", "CMP-D04", "CMP-D05", "CMP-D06", "CMP-D07", "CMP-D08"]
  },
  "scope": {
    "sourceClaims": [
      { "pathPrefix": "packages/ui/composite", "mode": "exclusive-write" },
      { "pathPrefix": "packages/prototypes/shared/ui-system/search", "mode": "exclusive-write" },
      { "pathPrefix": "packages/prototypes/shared/ui-system/identity", "mode": "exclusive-write" },
      { "pathPrefix": "packages/prototypes/shared/ui-system/chat/ChatRail.tsx", "mode": "exclusive-write" },
      { "pathPrefix": "packages/prototypes/shared/ui-system/chat/ChatFeature.tsx", "mode": "exclusive-write" },
      { "pathPrefix": "apps/desktop/src/components/search/SearchOverlay.tsx", "mode": "exclusive-write" },
      { "pathPrefix": "apps/desktop/src/components/profile/PublicProfileCard.tsx", "mode": "exclusive-write" },
      { "pathPrefix": "apps/desktop/src/components/chat/ChatSessionList.tsx", "mode": "exclusive-write" },
      { "pathPrefix": "tooling/scripts/ui-system", "mode": "exclusive-write" },
      { "pathPrefix": "docs/architecture/platform/client/ui-system", "mode": "exclusive-write" },
      { "pathPrefix": "apps/desktop/src", "mode": "shared-read" },
      { "pathPrefix": "apps/mobile", "mode": "shared-read" },
      { "pathPrefix": "apps/desktop/src-tauri", "mode": "shared-read" },
      { "pathPrefix": "tooling/acceptance", "mode": "shared-read" }
    ],
    "nonGoals": [
      "窄屏/响应式与 tauri.conf.json、SocialChatPage 布局改造（并行工作流）",
      "视觉重设计与新像素创新",
      "store/runtime/search-core/proto 改造",
      "mobile 代码变更",
      "ContactsPane、ChatSearchDropdown、CreateGroup/FindPeople 弹窗晋升",
      "native acceptance gate 的修改或跳过",
      "push、PR、发布与远程部署"
    ]
  }
}
```

## 3. 任务分解（严格串行；一个组件闭合后才开下一个）

### 阶段 0 — 基础设施（无消费者，可独立回滚）

| Task | 内容 | doneWhen |
|---|---|---|
| P0-1 | 建 `packages/ui/composite` 包骨架（package.json/tsconfig/vitest.config、i18n.ts、hooks.ts、index.ts），加入 pnpm workspace（glob 已覆盖，仅验证） | `pnpm --filter @peers-touch/ui-composite run check` 通过；空 test 绿灯 |
| P0-2 | 依赖阻断验证：在包内试 import zustand/seed 确认 tsc 失败后移除；记录白名单合同 | check 通过且无非法依赖 |

### 阶段 1 — GlobalSearchSurface（组件一，验证端口方法论）

| Task | 内容 | doneWhen |
|---|---|---|
| P1-1 | 固化 search.types.ts（data-model §2），先做端口试写：把生产 `searchPresentation` 输出映射成 model，验证 progressive/coverage 可闭合 | 若不可闭合 → 停写阻塞，回设计评审；不泄漏 runtime |
| P1-2 | 实现 GlobalSearchSurface + ptc CSS（token-only）+ roving/IME/相位/空态/错误态 | 复合包测试全绿 |
| P1-3 | locale key 清点与补录（packages/locales + 原型 STRINGS） | check:locales 过 |
| P1-4 | 原型适配层改造（seed 下沉保留、DesignDirections 接线、sk CSS 删除/桥接） | north-star `global-search-*` 7 场景 OBSERVED、0 console error |
| P1-5 | 生产适配层改造（store/runtime 零改、hooks 常量集中、coverage Popover 插槽化） | 选择器静态 grep 全命中；desktop check/test/build 过 |
| P1-6 | 测试改造（复合包行为测试 + Desktop 接线测试替换 searchOverlayAlignment） | 断言覆盖清单不缩减 |
| P1-7 | 视觉对账：660/r18/200ms 规格收敛项形成评审确认材料 | CMP-D04 确认或回退决议落档 |
| P1-8 | registry/catalogue/guard/baseline/suite refs 联动 | 各 guard 绿灯 |

**阶段门**：P1 全绿且评审通过前，不开始阶段 2。

### 阶段 2 — IdentityProfileCard（组件二）

| Task | 内容 | doneWhen |
|---|---|---|
| P2-1 | identity.types.ts 固化；硬编码中文 key 化（locale + STRINGS） | check:locales 过 |
| P2-2 | 实现三态组件 + avatarSlot/actionsSlot/技术详情回调 + ptc CSS | 复合包测试（三态/插槽/hooks）绿 |
| P2-3 | 原型适配（IdentityCard 瘦身、IdentityTrigger 留宿主、AuthorCard/ChatIdentity 接线） | suite 相关场景 OBSERVED |
| P2-4 | 生产适配（PublicProfileCard 瘦身、三消费方只改装配、profileCard.css 搬迁） | data-chat-profile-* 全命中；desktop 全绿 |
| P2-5 | 测试与登记联动 | 同 P1-6/P1-8 |

### 阶段 3 — ConversationRail + ConversationRow（组件三）

| Task | 内容 | doneWhen |
|---|---|---|
| P3-1 | conversation-rail.types.ts 固化；明确 contactsSlot/railExtraSlot 边界 | 类型评审自洽 |
| P3-2 | 实现轨壳 + 行单元（含右键菜单、hover 快捷动作、角标/presence）+ ptc CSS | 复合包测试绿 |
| P3-3 | 原型适配（ChatRail 瘦身、ChatFeature 只改装配、ContactsPane 留宿主） | suite conversation-* 场景 OBSERVED |
| P3-4 | 生产适配（ChatSessionList 瘦身；宽度/Profiler/弹窗留宿主；不碰 SocialChatPage 布局与 tauri.conf） | 40 处 pane 钩子等全命中；desktop 全绿 |
| P3-5 | 测试与登记联动；chatRail/chatContacts 对齐测试改造 | guard 绿灯、债基线只减不增 |

### 阶段 4 — 收尾

| Task | 内容 | doneWhen |
|---|---|---|
| P4-1 | 架构模块转正：文档 Status draft→active、architecture-modules.json 登记（requiredDocuments 推导：protocol=false/stateMachine=false/persistence=false/ownership=true/moduleLayout=true/crossRuntime=true/integration=true → README/design/decisions/module-layout/integration；data-model 因无 protocol 特征不进强制集，但文件保留） | module-governance validate 过；docs/README 索引引用存在 |
| P4-2 | 父 ui-system README/module-layout 反向链接更新；原型组件规格文档状态更新 | document-index 过 |
| P4-3 | 全量验证矩阵复跑 + 残留清单/推广建议/宿主装配示例产出（任务交付物 §4） | 交付清单齐全 |

## 4. 验证矩阵（每阶段门必跑）

```text
pnpm --filter @peers-touch/ui-composite run check && pnpm --filter @peers-touch/ui-composite run test
pnpm --filter @peers-touch/prototype-ui-system run check
node tooling/scripts/ui-system/evaluate-specimens.mjs --suite tooling/scripts/ui-system/suites/north-star.suite.json
node tooling/scripts/ui-system/evaluate-specimens.mjs --suite tooling/scripts/ui-system/suites/boards.suite.json
cd apps/desktop && pnpm run check && pnpm run test && pnpm run build
node tooling/scripts/review/primitive-layer-guard.mjs
node tooling/scripts/ui-system/prototype-import-guard.mjs
node tooling/scripts/architecture/diagram-render.mjs --check
```

## 5. 提交与回滚策略

- 每个阶段一组内聚提交（包实现 → 原型切换 → 生产切换 → 测试/登记），
  组内可多 commit，组间不交叉；每阶段可整体 revert。
- 不 push、不 PR（用户另行授权）；本地 checkpoint commit 允许。
- 任一 doneWhen 失败即停在当前阶段，不带病进入下一组件。

## 6. 开放风险（评审时确认）

1. CMP-D04 搜索浮层规格级像素变更是否接受（660/r18/200ms 收敛）。
2. P1-1 端口表达力验证结果（progressive frame 是否可纯 model 化）。
3. 复合包测试不引 @testing-library、仅用 react-dom 原语的可维护性。
4. 模块登记时机：draft 期不注册，P4-1 随状态转正一次登记。

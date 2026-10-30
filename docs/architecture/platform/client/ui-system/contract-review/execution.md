# 后续执行依赖提案

> PROPOSED；PLAN_BLOCKED_BY_DESIGN。不是冻结的 Plan，没有执行工作区或 Task 进度。当前授权仅完成本审阅包。

依赖为：合同选型闭环 → 逐能力真实参考闭环 → Settings / Messaging / 决策 / 其它消费者各自闭环 → 全消费者原子切换 → 独立有效性比较。每个闭环包含合同、实现、消费者、原型、证据与清理，不能再拆成孤立的“前端/后端/测试/文档阶段”。

逐能力 reference、多个业务 Journey 和其它应用是聚合节点。正式 Plan 前必须按真实依赖和单个有界 Progress Slice 拆开，不能把 130 能力或所有 Messaging 当成一次任务。本提案没有假称已满足任务尺寸与执行准备要求。

[execution-proposal.json](./execution-proposal.json)逐项给出参与 owner、交付、依赖、Gate、原子切换、五类结果标准与剩余冻结前条件。它可用于审阅依赖关系，不能被当作自动实现许可。

## 四项接受边界

- Peers 公共语义/API 与基础 renderer 的实际所有权，禁止 supplier props/type/re-export 外泄。
- 实际支持 Web/Desktop/Mobile/Lynx 的哪些 cell，以及未支持时怎样可读退化；不从 Web Gallery 推断 native。
- 危险动作采用具名文本、默认保留 active motion token；新曲线另作 amendment。审阅稿不能覆写 active 语义。
- 绑定既有模块 owner/projection、逐场景 operations/oracles/finalizers，以及独立任务/证据/reviewer 身份。

这些是公共语义与平台范围取舍，须接受后实现。日常工程选择、模型修正与授权内验证不逐条升级用户。

## 全消费者切换

历史 source-audit 是发现输入。正式实施前需对当前 execution source 再扫全语言、dynamic import/re-export、member、原生 button/input/select/textarea/SVG、workspace/export/build 路径；Astro 与实际未扫描源不得算已闭合。

所有 scoped consumers 完成后一次切换 active 入口、主题、资产、同实体组件、Skills/知识与文档；删除空 ui/desktop、高层 UI supplier 和双路径。不保留兼容 wrapper、旧主题或隐藏 fallback。内部低层 parser/editor/geometry/QR/media engine 以 Peers port 单独登记 license、资源/替换证据，不冒充完全无依赖。

受影响 UI Identity 文档按主线 cadence/frontmatter 更新；现有 component-spec-map 已是主线 draft 入口，应整合并派生，不能另造平行 active map。rollback 是以后授权的完整 source cut commit 的整体 revert，不为回滚留下 live 双实现。

## 有界验证与归因

每次 model 60s、specimen 90s、consumer/build 240s、单 Journey 900s、单 selection/review arm 180s，另保留 cleanup。这些是启动前 Gate 预算提案，不是实现工时。首个超预算停止下游，保留部分结果和 UNPROVEN，区分工具开销、合同必须时长和 UNKNOWN，不在失败后自动延长。

清理归任务拥有的资源，不能删除其它工作树数据或当前证据。真实资源/凭据、Profile 和大型动态证据留仓库外。源码、合同、probe、平台、token/asset 或 Oracle 改变均使对应 proof 失效。

本轮没有运行这些未来 Gate。当前通过的只是本包结构、来源摘要及作者公开校准检查。

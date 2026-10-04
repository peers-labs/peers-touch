# Peers Dev 产品验收矩阵

> **Status**: active
> **Created**: 2026-09-26 | **Updated**: 2026-10-04
> **Owner**: Platform Team
> **Module**: `apps/dev/`

---

## 1. Decision Status

DWF-D24..DWF-D37 已由 `decisions.md` 接受。决策接受只定义目标合同；在当前
源码和对应 Gate 完成验证前，相关 Acceptance cell 的最高合法结果仍是
`UNPROVEN`。

## 2. Matrix

| ID | Capability / Journey | Decision | User action | Observable result | Required evidence |
|---|---|---|---|---|---|
| DEV-A01 | DEV-C01 / DEV-J01 | DWF-D33/DWF-D35/DWF-D36 | 在无既有 Hook grant 时运行 `make skills IDE=trae` | Installer 将同一 canonical Hook 投影到 source、bootstrap 和既有 TRAE roots，保留 untouched roots，并从 source root 完成 callback proof | ungranted multi-root install audit 加 synthetic callback test |
| DEV-A02 | DEV-C01 / DEV-J01 | DWF-D33 | 一个 OWNER 创建两个 assigned child 并跨 root 调用工具 | 三者共享 immutable execution root，lineage 精确，跨 root read 允许而 write 拒绝 | binding projection/store 与 Kernel integration test |
| DEV-A03 | DEV-C01 / DEV-J01 | DWF-D33 | 缺少 host-specific root-chat ID、blocking hook 或 child assignment 时请求独立 mutation/review claim | 以 typed fail-closed reason 拒绝 claim | host-adapter negative test |
| DEV-A04 | DEV-C02 / DEV-J03 | DWF-D28 | 无 review 时尝试完成 Task | Plan transition 无 mutation 地被拒绝 | Plan CLI regression test |
| DEV-A05 | DEV-C02 / DEV-J03 | DWF-D28/DWF-D24 | Review 通过后改变 source 或 obligations | Receipt 变为 `STALE`，completion 保持 incomplete；source invalidation 时才由 DWF-D24 owner 重开 | review invalidation 与 source reopen test |
| DEV-A06 | DEV-C02 / DEV-J03 | DWF-D28 | Review 含已声明 forbidden legacy path 的 source tree | Review 返回 `FAIL` 并标识残留项 | 通用 forbidden-path fixture |
| DEV-A07 | DEV-C03 / DEV-J02 | DWF-D27/DWF-D29 | Active Plan 期间打开 Peers Dev | Worktree、Plan、Task progress 和 Agent activity 分层展示 | API contract test 加 browser dynamic proof |
| DEV-A08 | DEV-C03 / DEV-J02 | DWF-D29 | 重复产生相同 no-progress action | UI 标记 `looping`，Plan percentage 不变化 | reducer test 加 browser DOM assertion |
| DEV-A09 | DEV-C03 / DEV-J02 | DWF-D29 | 停止产生 receipt | UI 标记 `stalled` 并保留最后活动时间 | injected-clock test |
| DEV-A10 | DEV-C03 / DEV-J02 | DWF-D27 | 在 desktop 与 narrow viewport 查看 | 无重叠、裁字、嵌套卡片和布局跳变 | current-source screenshot 加人工视觉检查 |
| DEV-A11 | DEV-C04 / DEV-J04 | DWF-D30 | 从干净 worktree 按操作指南执行 | 每个声明命令存在并返回文档描述的 typed state | README truth audit |
| DEV-A12 | DEV-C05 / DEV-J04 | DWF-D30 | 在 Hook 损坏或 review 陈旧时运行 Doctor | 命令非零退出并指出失败承诺 | Doctor contract test |
| DEV-A13 | DEV-C05 / DEV-J04 | DWF-D30 | 对当前源码和 live Dev server 运行 Doctor | 所有 required surface 为 healthy，并返回经过验证的 server locator | end-to-end Doctor run |
| DEV-A14 | DEV-C01 / DEV-J01 | DWF-D33 | Callback 提供非法 JSON、不支持事件、跨 host identity alias 或超限 payload | Hook 以 typed error 拒绝可阻断操作 | host-adapter negative test |
| DEV-A15 | DEV-C02 / DEV-J03 | DWF-D28/DWF-D37 | Dev Workflow 准备 review handoff | 独立 reviewer 收到 immutable request 和 review-scoped capability；机器 receipt 证明 delegated assessment provenance，但不宣称证明认知独立性 | reviewer launch contract 加 capability/proof regression |
| DEV-A16 | DEV-C02 / DEV-J03 | DWF-D28 | Required review check 被取消或超时 | Review 返回 `FAIL`，Task 保持 open | timeout/cancel test |
| DEV-A17 | DEV-C03 / DEV-J02 | DWF-D27 | 一个 Snapshot owner 不可用 | 其余 owner state 仍可见，并附 typed partial failure | Snapshot contract 加 browser test |
| DEV-A18 | DEV-C03 / DEV-J02 | DWF-D27 | Refresh 期间 Dev server 断开 | 保留最后有效 Snapshot，显示 stale age 和 retry | browser E2E |
| DEV-A19 | DEV-C03 / DEV-J02 | DWF-D27 | 固定 endpoint 已运行兼容服务 | 任意 worktree 复用 machine-wide singleton，并显示 serving-source freshness | server identity test |
| DEV-A20 | DEV-C05 / DEV-J04 | DWF-D30 | 成功运行后重启 Doctor | 从 machine state 读取 binding 和 review durability | Doctor restart test |
| DEV-A21 | DEV-C03 / DEV-J02 | DWF-D27 | Snapshot 评估 active、terminal 和 exhausted Plan | 只从 owner state 返回 `CONTINUE`、`COMPLETE`、`HARD_BLOCK` | continuation reducer test |
| DEV-A22 | DEV-C02 / DEV-J03 | DWF-D24/DWF-D28 | Completed Task receipt 变为 stale | DWF-D24 owner 重开最早失效 Task，并将传递依赖重置为 pending | Plan reopen regression test |
| DEV-A23 | DEV-C01 / DEV-J01 | DWF-D25/DWF-D33 | User Overlay 试图扩大 scope、lineage 或 authorization | Kernel 忽略 Overlay 的政策影响并拒绝动作 | overlay-isolation hook test |
| DEV-A24 | DEV-C08 / DEV-J05 | DWF-D31 | completed 且 quiescent 的 canonical owner workspace 接收下一 Plan | expected generation CAS 成功并保留不可变历史；active 或持有资源时拒绝 | workspace binding generation and concurrency tests |
| DEV-A25 | DEV-C09 / DEV-J06 | DWF-D32 | Agent、Station、Desktop 等模块同时返回影响 | 一个 `PlanResourcePlan` 解析完整 target 依赖闭包，并聚合 checks、Journeys 与 Gates | multi-module resource-plan contract test |
| DEV-A26 | DEV-C09 / DEV-J06 | DWF-D32 | 两个 target 请求同一兼容账号或服务 | Suite/task 生命周期内只选取一次，幂等键和 peak capacity 可见 | account/service reuse test |
| DEV-A27 | DEV-C09 / DEV-J06 | DWF-D32 | 并行 target 竞争不足的独占资源 | 仅冲突 target 与依赖项进入 `PARKED`，其他 target 保持可执行 | parallel-capacity test |
| DEV-A28 | DEV-C09 / DEV-J06 | DWF-D32 | 一个 target 的多资源集合存在缺项或另一 Plan 已占用 | 不发布部分 claims；声明更新原子失败且不存在 hold-and-wait | all-or-none and cross-Plan conflict tests |
| DEV-A29 | DEV-C09 / DEV-J06 | DWF-D32 | 资源失效、quarantine 或 owner 回报旧 fencing token | 选择健康 replacement，或拒绝旧/错 owner/错 digest 结果 | replacement and fencing tests |
| DEV-A30 | DEV-C09 / DEV-J06 | DWF-D32 | 执行业务 Acceptance Gate | Gate 仅附着到 SuiteRuntime manifest，不触发 build/deploy/account/login/cleanup | attach-only contract check |
| DEV-A31 | DEV-C01 / DEV-J01 | DWF-D37 | 无已加载 Hook 且 worktree 留有过期 child binding 时执行 Completion Review | repository-native prepare/submit 只接受 exact reviewer capability，且不读取历史 binding 或 Action Receipt | host-neutral completion-review capability regression |
| DEV-A32 | DEV-C01 / DEV-J01 | DWF-D33 | compaction、task switch 或 retry 后继续同一可见 chat | OWNER digest 与 execution root 不变，workflow Session projection按 owner state 更新 | compaction/task-switch regression |
| DEV-A33 | DEV-C01 / DEV-J01 | DWF-D33 | 从 sibling subjectRoot 读取并随后尝试写入 | 注入 projection 同时展示 owner/tool/target roots；read 允许且 write 返回 `CROSS_WORKTREE_WRITE_DENIED` | cross-root projection regression |
| DEV-A34 | DEV-C02 / DEV-J03 | DWF-D33 | 使用错误 role、parent、assignment 或已 terminal child 提交 status/final claim | claim 无 mutation 地 fail closed | binding claim-gate regression |

## 3. Acceptance Rules

- Screenshot 只证明渲染，不能替代 binding、transition、review 或 owner receipt。
- Completion proof 只对当前 source、obligation 和 evidence digest 有效。
- Browser 检查必须覆盖 desktop 和 narrow viewport；具体像素宽度由 Acceptance
  环境声明，不写死为历史运行结论。
- Acceptance 输出不得包含凭据、原始 conversation identifier 或用户主目录绝对
  路径。
- 旧 Hook、guard、acknowledgement 或 completion bypass 路径必须在当前目标树中
  零 live reference；历史材料只能作为显式 archive evidence。
- 来源 worktree 的测试计数、端口健康、截图、branch、commit 或 Plan 状态不得
  迁移为本仓库当前证明。

# AUD-03：CLIENT 写/编辑/受控命令执行面

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AUD-20261025",
  "taskId": "AUD-03",
  "workstreamId": "AUD-EXEC",
  "title": "filesystem.write/edit 与受控 shell allowlist 经围栏能力桥真实执行，逐次审批与变更摘要闭环",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "aud-j03-write-command-approval",
  "closureId": "aud-v02-client-execution",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent/capability.proto",
    "apps/station/app/subserver/agent/service/tool_registry_service.go",
    "apps/station/app/subserver/agent/service/tool_dispatch_service.go",
    "apps/station/app/subserver/agent/service/turn_service.go",
    "apps/desktop/src-tauri/src/application/desktop_executor_worker/local_executor.rs",
    "apps/desktop/src-tauri/src/application/tools/mod.rs",
    "apps/desktop/src/components/messages/ToolCallCard.tsx",
    "packages/locales"
  ],
  "readSet": [
    "apps/desktop/src-tauri/src/application/desktop_executor_worker/fenced_executor.rs",
    "apps/desktop/src-tauri/src/application/desktop_executor_worker/receipt_ledger.rs",
    "apps/desktop/src-tauri/src/application/desktop_executor_worker/resource_registry.rs",
    "docs/architecture/domains/agent/agent-usability-depth/design.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "aud-03-proto-build",
      "command": "./model/build.sh",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-03-station-tests",
      "command": "cd apps/station && go test ./app/subserver/agent/...",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "aud-03-rust-tests",
      "command": "cd apps/desktop/src-tauri && cargo test desktop_executor_worker",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "aud-03-desktop-check",
      "command": "cd apps/desktop && pnpm run check",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "capability.proto 增 filesystem.write/edit 参数契约（workspace 相对路径、文本内容/补丁、大小上限）与 shell 操作 allowlist 描述；生成经 ./model/build.sh，禁止手改生成文件",
    "Station 注册三个新工具为 CLIENT owner，经既有 lease/pull/receipt 通道下发；ToolCall 风险分级 L1（写/编辑）、L2（命令），approval_policy 默认逐次审批；snapshot 随执行器租约在线状态降级",
    "prompt assembly 环境段声明 workspace 根、可用工具与阻塞条件；模型不能发现未授权能力",
    "Rust local_executor 白名单增 filesystem.write/edit；shell.execute 只执行 Station 下发 allowlist 中命令的只读子命令（find/grep/rg/cat/ls 与 make/pnpm/npm/go/cargo/git 只读形态），拒绝任意参数逃逸、shell 拼接、出根路径；复用 resolve_guarded_path 与 canonicalize 沙箱",
    "写/编辑回执含 path、before/after hash、size；PREPARED 先落账后副作用、fencing exactly-once、幂等重放语义不回退；超 64KB 内容在本任务内 fail-closed 并返回明确错误（分块协议是后续计划，不临时放宽）",
    "ToolCallCard 对写/编辑显示 diff 预览、命令显示命令+工作目录+参数；approve/deny/过期/执行器离线/unknown_side_effect 状态与三恢复动作齐全；全部文案进 i18n",
    "TD-J02 同类 Journey（读材料→改文件→真实检查失败→修正→再验证，无关文件不动）在 make desktop 普通账号路径 FUNCTIONAL_PASS；Rust 单测覆盖出根、命令注入、重复信封幂等"
  ],
  "failureBehavior": [
    "不开放任意外壳、不出 workspace/allowed_roots、不新增非围栏执行通道；不提供持久化自动批准",
    "审批拒绝/过期必须零本地副作用且 Station 可见；执行器离线时能力不广告，普通文本对话不被阻断",
    "Station 占位字符串工具与 CLIENT 真实执行不得出现同名两实现；注册表单一 owner",
    "若 allowlist 命令在沙箱无法安全约束（如 git 任意参数写操作），该命令不进入清单并在 Plan 记录，不降级为黑箱执行"
  ],
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

## 完整闭环

这是“真正能干活”的分水岭：同一任务中模型可读取、修改 workspace 文件并运行受控检查命令，每次副作用都有用户审批、围栏收据、变更摘要与恢复动作。Station 决定做什么与是否允许，Desktop Rust 在本地执行并保证 exactly-once，React 只呈现可审计过程；无第二执行器、无静默成功。

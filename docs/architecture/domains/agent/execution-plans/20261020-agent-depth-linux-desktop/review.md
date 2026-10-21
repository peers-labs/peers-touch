# Linux Desktop 与 Agent 深度闭环评审

## Package

`docs/architecture/domains/agent/execution-plans/20261020-agent-depth-linux-desktop/plan.md`

## Review Sources

- `docs/architecture/domains/agent/modern-chat-agent/`
- `docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md`
- `docs/architecture/engineering/local-dev/`
- `docs/global/local-dev-environment.md`
- `docs/client/desktop/runtime-projections.md`

## Findings-First Review

请按以下顺序审查并返回 `通过`、`有条件通过` 或 `需要修改`：

1. ADL-01 是否把公共安装生命周期与平台 adapter 彻底分离，同时保留 macOS
   现有行为和 Windows Native 开发行为。
2. ADL-02 是否完成 AgentDefinition 与 Skill Binding 单一真相 hard cut，且没有
   `config_json`、legacy alias 或双 enablement 兼容路径。
3. ADL-03 的 `/help`、`/tools`、`/skills`、`/clear` 是否遵守 Station
   authority、不可变历史和已确认 CUT。
4. ADL-04 是否只投影实际 ContextLedger/ToolCall 事实，并保持内容、凭据和本地
   路径的 redaction。
5. 五个 closure 是否纵向完整、Task 大小有界、依赖 DAG 与 producer/consumer
   次序一致。
6. 每个 atomic cutover 是否列出旧 owner 删除、零残留搜索和 VCS revert 回滚。
7. Linux Native Gate 是否独立证明安装、启动、默认账号 Journey、重启读回和
   资源清理，而不冒充 Desktop 全量 Acceptance。
8. 授权是否仅允许当前分支 squash 和本地 Git server push，明确禁止新分支、
   新 worktree、origin push 和 PR。

## Required Validator

```bash
make plan-validate \
  PLAN=docs/architecture/domains/agent/execution-plans/20261020-agent-depth-linux-desktop/plan.md
node tooling/scripts/architecture/module-governance.mjs validate
```

任何弱化 Prompt provenance、Capability authority、历史不可变性或平台隔离的
方案均应返回 `需要修改`。

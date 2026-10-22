# Linux Desktop 与 Agent 深度闭环 V2 评审

## Package

`docs/architecture/domains/agent/execution-plans/20261020-agent-depth-linux-desktop-v2/plan.md`

## Resolved V1 Findings

- ADL-02 已拆为 AgentDefinition roundtrip 与 Prompt/Skill authority 两个纵向闭环。
- `/help`、`/tools`、`/skills`、`/clear` authority 已写入正式产品与体验合同。
- 新增 ADL-00，Commands 与 Attribution 必须先完成原型更新和 Owner 确认。
- Linux XDG 路径、运行中替换、回滚和旧进程语义已冻结。
- North Star 已转为二元 `Installed Linux Agent Depth Journey = PROVEN`，
  并定义四个必须为零的 authority/evidence 指标。

## Findings-First Review

审查并返回 `通过`、`有条件通过` 或 `需要修改`：

1. 七个 Task 是否都是一次 bounded execution 可关闭的纵向结果。
2. ADL-00 是否在 production write 前强制 prototype confirmation。
3. ADL-02A/02B 是否完成 AgentDefinition、Prompt 和 Skill Binding 单一真相，
   且没有 config_json、legacy Skill.enabled 或 alias fallback。
4. ADL-03 是否严格执行 Desktop static `/help`、Station `/tools`/`/skills`、
   Station Topic `/clear`，并保持 stale 不阻断普通 Chat。
5. ADL-04 是否只投影历史 ContextLedger/ToolCall 事实并满足 redaction。
6. ADL-01 是否在 frozen XDG 路径完成无 root 原子安装、回滚和 source identity。
7. ADL-05 是否以默认账号真实证明 North Star，且不冒充 Desktop 全量 Acceptance。
8. 授权是否继续禁止 origin push、PR、新 branch 和新 worktree。

## Validators

```bash
make plan-validate \
  PLAN=docs/architecture/domains/agent/execution-plans/20261020-agent-depth-linux-desktop-v2/plan.md
node tooling/scripts/architecture/module-governance.mjs validate
```

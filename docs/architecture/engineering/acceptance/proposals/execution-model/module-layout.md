# 唯一注册与模块职责

> **Status**: draft
> **Authority**: non-normative
> **Created**: 2026-10-22 | **Updated**: 2026-10-22
> **Owner**: Acceptance

## 目标职责布局

这是现有 Acceptance 的拟议增量，不是当前文件 inventory。
新增文件名在确认后的执行设计中收敛；以下先确定唯一 owner。

```text
tooling/acceptance/
  capabilities/          # 能力/Feature 关系；引用稳定业务 ID
  features/              # 断言语义和 authored Step 唯一源
  suites/                # 拟议：producer/case 引用、依赖、资源策略
  gates.yaml             # Gate 判定集合和执行要求；不复制业务动作
  registry.yaml          # paths -> impacted features/Gates
  core/
    execution graph      # 拟议：纯图编译、拓扑、identity/复用校验
    execution cost       # 拟议：阶段成本、资源关键路径、按类 profile
    execution policy     # 拟议：有约束策略选择、有限调优和回退
    stage telemetry      # 拟议：OTel span/event/link 的调用边界集成
    suite_runtime.py     # 既有生命周期账本和 budget 检查
    provisioning/driver  # 既有资源接口；具体资源仍由 provider 提供
    evidence_store.py    # 既有 evidence 唯一 owner
  gates/<domain>/        # 业务 producer、Steps、fault、oracle、只读判定
  provisioners/          # 具体资源准备；不承载业务断言

tooling/scripts/
  acceptance-plan.py             # impact/显式选择投影
  acceptance-run.py              # 实际选择和 execution graph 唯一执行 owner
  acceptance-pipeline-audit.py   # 声明/编译图/实际报告一致性
  acceptance-gap-detect.py       # 选定要求的当前源证明闭包
  existing structure validators # 注册引用、ownership 和完整覆盖
```

## 允许的依赖

Core 读取通用注册/接口，调用注入的 producer 与 resource provider。
业务 producer 使用既有 Driver/RuntimeBinding，执行所属域的 Step，
形成断言结果。判定器只读不可变 refs。

Graph、pipeline auditor 和 Runner 使用同一个纯编译入口，
不各自重写 Gate 闭包、producer 去重和 resource grouping。
Feature 唯一维护断言语义；Suite 和 Catalog 只维护引用/组合。
新的业务能力接入现有模板和检查，不新增专门“Gate 架构 Skill”。

## 禁止的依赖

- Core import Chat/Social/Access 的具体实现或 selector。
- 普通 Scenario 自行 build/deploy/account-provision/launch/login-setup/cleanup。
- Gate verdict 调用 producer 之外的隐式完整 Journey。
- 不同 Gate 内复制同一 authored Step 或同一完整 Runner。
- Consumer 从 latest 猜证据，复制或修改 producer artifact 后冒充自有 proof。
- 因缺少基础 provider 在 Core 里嵌入临时登录/发送逻辑。
- 新增独立 Admission、OWNER receipt、PlanMount 或 schema 版本来选范围。

## 注册与治理

确认后更新既有 Acceptance 的 `architecture-modules.json` 正向投影：
owner 仍为 Acceptance，governed paths 延续现有边界，
声明 graph compile、suite execution、assertion judgment、reuse audit、
execution efficiency、cost profiling 和 bounded policy optimization 等允许能力。
业务模块声明各自 producer/Step/oracle，消费 Core 的现有接口。

未知注册、重复语义 owner、无法解析的入口、循环、缺 assertion producer、
缺平台或 negative case 均 fail closed。命令字符串碰撞只作为审查提示；
RAL/Relay 等消费者按其 assertion/case 引用判断。

本提案目录是 draft 修订材料，不登记为重叠的 active 架构模块，
也不把本提案 ID 当成已接受决策或正式证据 Gate。

效率检查复用现有 Infra validation/pipeline audit，单次消费执行图与 span 摘要。
策略控制器不能改 selected requirements、业务阈值、故障条件或证明强度，
也不能直接编辑生产代码、建立新审批 authority 或递归执行效率 Gate。
成本 profile 只拥有统计和策略，不拥有业务状态或可继承的证明。

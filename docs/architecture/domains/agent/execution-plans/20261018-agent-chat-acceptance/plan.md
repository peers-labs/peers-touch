# Agent Chat Production Acceptance

> **Plan ID**: agent-chat-acceptance-20261018
> **Version ID**: agent-chat-acceptance-20261018-approved
> **Created**: 2026-10-18T00:00:00.000Z
> **Owner**: Peers-Touch Agent Team

## North Star

用户能在已确认的连续 Agent 工作面完成 Profile 编辑、Topic 管理、模型选择、
对话、人工门控与失败恢复。每个承诺必须由当前源码的真实 Native 用户操作、
权威回读和资源清理证据证明。用户已确认本方案并要求完成全部工作。

## Source Contract

产品边界来自 `docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md`
及其 11 条 Journey、121 个操作合同。121 是覆盖基线，不是证据上限：
SOUL.md、AGENTS.md 的保存、回读、重启与 Provider 消费，以及删除、
焦点和模型隔离的遗漏断言必须补齐。

Settings 拥有全局默认模型；Topic 拥有复合 Provider/Model 覆盖；
Agent 拥有身份、文档和扩展。Station 拥有业务持久化、执行、目录与原子删除。
Desktop Rust 保持通信桥；Renderer 仅投影并提交用户意图。

## Plan

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "agent-chat-acceptance-20261018",
  "versionId": "agent-chat-acceptance-20261018-approved",
  "createdAt": "2026-10-18T00:00:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md",
      "docs/architecture/domains/agent/design.md",
      "docs/architecture/domains/agent/data-model.md",
      "docs/architecture/domains/agent/provider-runtime-strategy.md",
      "docs/client/common/ui-identity/modules/agent/README.md",
      "docs/client/desktop/runtime-projections.md",
      "docs/architecture/engineering/acceptance/design.md"
    ],
    "decisions": ["MCA-D14", "MCA-D15", "MCA-D16A", "MCA-D17", "MCA-D18", "MCA-D20", "MCA-D22", "MCA-D23"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "apps/desktop", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/app/subserver/agent", "mode": "exclusive-write"},
      {"pathPrefix": "model/domain/agent", "mode": "exclusive-write"},
      {"pathPrefix": "packages/locales", "mode": "exclusive-write"},
      {"pathPrefix": "packages/prototypes/desktop", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/domains/agent", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/prototypes/desktop-shell", "mode": "exclusive-write"},
      {"pathPrefix": "docs/client", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "Add CUT capabilities to the ordinary Agent Chat surface",
      "Change unrelated Agent orchestration, Evaluation or Mobile product scope",
      "Replace native proof with a browser shell, mock or API-only assertion",
      "Push, create a PR, merge or publish before user testing",
      "Delete existing historical evidence or change proof authority"
    ]
  },
  "tasks": [
    {"id": "ACA-01", "workstreamId": "ACA", "path": "tasks/ACA-01.md", "dependsOn": []},
    {"id": "ACA-02", "workstreamId": "ACA", "path": "tasks/ACA-02.md", "dependsOn": ["ACA-01"]},
    {"id": "ACA-03", "workstreamId": "ACA", "path": "tasks/ACA-03.md", "dependsOn": ["ACA-02"]},
    {"id": "ACA-04", "workstreamId": "ACA", "path": "tasks/ACA-04.md", "dependsOn": ["ACA-03"]},
    {"id": "ACA-05", "workstreamId": "ACA", "path": "tasks/ACA-05.md", "dependsOn": ["ACA-04"]}
  ],
  "authorization": {
    "checkpoint": {"localCommit": "allowed", "amend": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": ["two"], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## Acceptance Execution

```json
{
  "closures": {
    "ACA-profile": ["agent-chat-profile-native"],
    "ACA-models": ["agent-chat-models-native"],
    "ACA-topics": ["agent-chat-topics-native"],
    "ACA-conversation": ["agent-chat-conversation-native"],
    "ACA-layout": ["agent-chat-layout-native", "agent-chat-workspace-native"]
  },
  "completion": [
    "agent-chat-profile-native",
    "agent-chat-models-native",
    "agent-chat-topics-native",
    "agent-chat-conversation-native",
    "agent-chat-layout-native",
    "agent-chat-workspace-native"
  ],
  "full": []
}
```

## Atomic Cutovers

模型选择必须同时迁移 composer、Topic 持久化、实际 turn 输入、恢复与
错误恢复入口；不得保留 Agent 模型配置作为普通 Chat 的第二真源。
创建入口统一到立即进入 Profile 的真实 mutation。
删除必须同时覆盖 Station 事务和客户端草稿、附件、消息、运行投影。
原型明确 CUT 的普通用户入口及其失效调用必须删除。

Acceptance 业务合同按 operation ID 映射到 Feature、Capability、Gate 和证据。
历史广度合同不代替本工作面完成口径；不能通过删断言来让旧 Gate 变绿。
通用 Acceptance validator 的结构与 proof 标记缺陷属于独立 Infra 修正，
不得在 Agent Gate 中绕过；未完成时禁止整体 PROVEN 声明。

## Runtime And Verification

采用现有 reviewed Profile 和 canonical Make/Acceptance 入口。
每个 Native suite 只构建、启动和登录一次，随后所有场景 attach-only；
重启恢复使用显式 replacement 事件，场景只隔离自己的业务数据。
先完成聚焦源码检查与真实功能 Journey，再进行正式覆盖判定。
证据保存到仓库外 Evidence Store，绑定组件 digest、合同 digest、
Gate digest、Profile digest、actor、client、Station 和 cleanup。

最终证据必须覆盖 11 Journeys 和新增遗漏合同；旧 selector、无实现 journey、
过期 evidence 或只含结构通过的 manifest 均不能满足产品证明。
恢复和删除不会修改不属于本请求的数据。失败按产品、Harness、环境、
证据或 Infra owner 分类，修正后只重跑受影响闭环。

## Review Contract

审查所有权唯一性、全调用点迁移、CUT 清理、121 基线及新增合同完整性、
实际 UI 动作与权威回读、Suite 生命周期和当前源码证据。
任何缺失断言或不可执行 Gate 都阻止完成；源码检查数量不构成完成标准。
回滚使用版本控制恢复原子变更，不保留运行时兼容分支。

Native Suite 的身份夹具通过 `PT_AGENT_CHAT_IDENTITY_SEED_FILE` 显式提供。
业务夹具必须从种子派生 Ed25519 公钥，与当前受控 Station 的
`actor_identity_keys` 公钥和 fingerprint 同时匹配，随后使用通用
`NativeStorageFixture` 在首次启动前导入当前 Actor 的 canonical key path。
重启使用已保留存储，禁止重复注入、生成替代身份或修改 Station 信任记录。
证据可包含 PTID、公钥、fingerprint 和摘要，不得包含私钥种子。

# Linux Desktop 与 Agent 深度闭环

> **Plan ID**: agent-depth-linux-desktop-20261020
> **Version ID**: agent-depth-linux-desktop-20261020-approved
> **Created**: 2026-10-20T03:15:00.000Z
> **Owner**: Peers-Touch Agent Team

## North Star

用户可以在 Linux 上通过 `make desktop-install` 获得当前源码的 Native
Desktop，并在同一个真实 Agent 工作面查看权威 Agent 元数据、Skill/Tool
命令、实际 Turn 注入来源和执行归因。macOS 安装行为与 Windows Native
开发行为不得回退。

## Source Contract

产品范围来自：

- `docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md`
  中已确认的 slash command/skill、Profile Extensions、人工门控和
  attribution 范围；
- `docs/architecture/domains/agent/modern-chat-agent/` 的 MCA-P01、P04、
  P05、P10 与 ContextLedger/CapabilityManifest/AgentDefinition 所有权；
- `docs/architecture/engineering/local-dev/` 与
  `docs/global/local-dev-environment.md` 的单一 Native Desktop 入口；
- Owner 于 2026-10-20 接受的平台 adapter、Linux 安装和 Agent 投影闭环。

已接受语义：

- Agent 名称、描述和头像是展示元数据；SOUL/AGENTS 是类型化 Prompt 层。
- `/help`、`/tools`、`/skills` 读取本地或 Station 权威投影，不创建模型 Turn。
- `/clear` 创建新的空 Topic，保留旧 Topic 和不可变执行证据。
- Skill 首轮只注入授权索引；完整正文继续通过 `skill_view` 渐进加载。
- 普通消息 Attribution 显示实际参与 Turn 的 Skill、Memory、Knowledge、
  Attachment 和 Tool，绝不从当前配置倒推历史执行。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "agent-depth-linux-desktop-20261020",
  "versionId": "agent-depth-linux-desktop-20261020-approved",
  "createdAt": "2026-10-20T03:15:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/domains/agent/modern-chat-agent/product-definition.md",
      "docs/architecture/domains/agent/modern-chat-agent/design.md",
      "docs/architecture/domains/agent/modern-chat-agent/data-model.md",
      "docs/architecture/domains/agent/modern-chat-agent/integration.md",
      "docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md",
      "docs/architecture/engineering/local-dev/design.md",
      "docs/architecture/engineering/local-dev/decisions.md",
      "docs/global/local-dev-environment.md"
    ],
    "decisions": [
      "MCA-D14",
      "MCA-D16A",
      "MCA-D17",
      "MCA-D22",
      "MCA-D23",
      "LDCP-D16",
      "LDCP-D17",
      "LDCP-D21"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "tooling/devctl", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/local-dev", "mode": "exclusive-write"},
      {"pathPrefix": "docs/global/local-dev-environment.md", "mode": "exclusive-write"},
      {"pathPrefix": "model/domain/agent", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/app/subserver/agent", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop", "mode": "exclusive-write"},
      {"pathPrefix": "packages/locales", "mode": "exclusive-write"},
      {"pathPrefix": "packages/prototypes/desktop", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/domains/agent", "mode": "exclusive-write"},
      {"pathPrefix": "docs/client/desktop", "mode": "exclusive-write"},
      {"pathPrefix": "pnpm-lock.yaml", "mode": "shared-read"}
    ],
    "nonGoals": [
      "Add reference-product Project, Hub, Share, Duplicate, Export, Notebook or Debug surfaces",
      "Inject Agent display metadata into the Provider prompt",
      "Delete immutable Topic or Turn evidence through /clear",
      "Auto-install Linux system packages or require root",
      "Publish to origin/GitHub or create a pull request",
      "Replace focused Native proof with browser-only evidence"
    ]
  },
  "tasks": [
    {"id": "ADL-01", "workstreamId": "ADL", "path": "tasks/ADL-01.md", "dependsOn": []},
    {"id": "ADL-02", "workstreamId": "ADL", "path": "tasks/ADL-02.md", "dependsOn": []},
    {"id": "ADL-03", "workstreamId": "ADL", "path": "tasks/ADL-03.md", "dependsOn": ["ADL-02"]},
    {"id": "ADL-04", "workstreamId": "ADL", "path": "tasks/ADL-04.md", "dependsOn": ["ADL-02"]},
    {"id": "ADL-05", "workstreamId": "ADL", "path": "tasks/ADL-05.md", "dependsOn": ["ADL-01", "ADL-03", "ADL-04"]}
  ],
  "authorization": {
    "checkpoint": {"localCommit": "allowed", "amend": "allowed"},
    "delivery": {"push": "allowed", "pullRequest": "denied"},
    "runtime": {"deployProfiles": ["two"], "destructiveResetScopes": []},
    "history": {"rewrite": "allowed"}
  }
}
```

Delivery 仅授权当前分支 squash 后推送到本机登记的
`administrator`/`station-one` Git server；不授权 origin push、PR、新分支或
新 worktree。

## Dependency DAG

```text
ADL-01 Linux install adapter ─────────────────────────────┐
                                                         ├─> ADL-05 Native closure
ADL-02 typed Agent truth ─> ADL-03 command projection ───┤
                         └> ADL-04 attribution projection ┘
```

## Atomic Cutovers

1. `desktop-install` 由一个公共 orchestrator 和平台 adapter registry
   唯一拥有；旧的 macOS 专属 orchestration 删除。
2. SOUL/AGENTS 从 `config_json` 迁移到类型化 AgentDefinition 字段；所有
   CRUD、Prompt assembly、package import/export 和客户端 projection 同步切换，
   历史 alias fallback 删除。
3. Slash UI 从 insert-only 和原型 localStorage 切到 Station-backed command
   projection；生产和原型消费同一语义。
4. 普通聊天 attribution 从 Knowledge/Attachment 特例切到类型化
   Turn attribution；不得保留第二套基于当前配置推断的来源列表。

回滚只允许 VCS revert 对应原子 cutover，不保留 feature flag、兼容分支或
双写路径。

## Acceptance Execution

```json
{
  "closures": {
    "ADL-linux-install": ["desktop-linux-install-native-e2e"],
    "ADL-agent-definition": ["agent-chat-profile-native"],
    "ADL-command-projection": ["agent-slash-command-native-e2e"],
    "ADL-turn-attribution": ["agent-context-projection-native-e2e"],
    "ADL-native-closure": ["agent-depth-linux-native-e2e"]
  },
  "completion": [
    "desktop-linux-install-native-e2e",
    "agent-chat-profile-native",
    "agent-slash-command-native-e2e",
    "agent-context-projection-native-e2e",
    "agent-depth-linux-native-e2e"
  ],
  "full": []
}
```

## Completion

- Linux 用户态安装、启动、deep link 和当前源码身份均通过真实 Native 验证。
- macOS 安装 contract 回归通过；Windows Native 开发入口没有行为变化。
- AgentDefinition、Skill 启用权威、Slash command 和 Attribution 各自只有一个
  source of truth。
- 默认账号完成创建 Agent、编辑 SOUL/AGENTS、绑定 Skill、使用 `/skills`、
  触发 Skill、查看 attribution、重启读回的完整 Journey。
- 所有 task-owned runtime、临时安装和测试资源完成清理。

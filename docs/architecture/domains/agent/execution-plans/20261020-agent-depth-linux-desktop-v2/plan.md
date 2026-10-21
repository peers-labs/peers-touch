# Linux Desktop 与 Agent 深度闭环 V2

> **Plan ID**: agent-depth-linux-desktop-20261020
> **Version ID**: agent-depth-linux-desktop-20261020-v2-approved
> **Created**: 2026-10-20T04:10:00.000Z
> **Owner**: Peers-Touch Agent Team

## North Star

用户通过 `make desktop-install` 获得绑定当前源码的 Linux Native Desktop，
并在同一个真实 Agent 工作面完成类型化 Agent 配置、Commands & Skills、
真实 Skill 激活和历史 Turn Attribution 的闭环。macOS 安装行为与 Windows
Native 开发行为不得回退。

## North Star Metric

唯一主指标为：

```text
Installed Linux Agent Depth Journey = PROVEN
```

必须同时满足：

1. 安装 artifact 的 source commit 等于冻结 HEAD，启动和 deep link 成功。
2. 默认账号创建 Agent，保存并在重启后读回 SOUL/AGENTS。
3. `/skills` 显示当前 Station Binding；`skill_view` 使用同一 Skill 版本。
4. 最终消息显示实际参与的 Skill/Memory/Knowledge/Attachment/Tool attribution。
5. 当前 Binding 变化不会改写历史 Turn attribution。
6. 重启恢复 Agent、Topic、command projection 和 attribution。
7. macOS install contract 与 Windows Native development contract 无回退。
8. task-owned runtime、安装临时文件和业务夹具全部清理。

硬性辅助指标：Authority 双真相、生产 localStorage authority、从当前配置反推
历史 attribution、无 source identity 的 Native 证据均为 `0`。

## Source Contract

产品与架构来源：

- `docs/architecture/domains/agent/modern-chat-agent/`
- `docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md`
- `docs/architecture/engineering/local-dev/`
- `docs/global/local-dev-environment.md`
- `docs/architecture/engineering/prototypes/README.md`

命令 authority：

- `/help` 由 Desktop 静态 command registry 投影。
- `/tools`、`/skills` 只读取选中 Agent 的版本化 Station capability snapshot。
- `/clear` 通过 Station 创建空 Topic，保留旧 Topic 和不可变证据。
- stale snapshot 显式标记且禁用 capability action；普通文本对话不被阻断。

Linux 安装 contract：

- artifact：Tauri AppImage；
- 默认 artifact 目录：
  `${XDG_DATA_HOME:-$HOME/.local/share}/peers-touch/apps/`；
- desktop entry：
  `${XDG_DATA_HOME:-$HOME/.local/share}/applications/com.peers.touch.desktop.dev.desktop`；
- icon 安装到 XDG hicolor icon tree；
- launcher：`${PT_DESKTOP_INSTALL_BIN_DIR:-$HOME/.local/bin}/peers-dev`；
- 安装通过同目录 staging、fsync、chmod 和 rename 原子替换；
- 正在运行的旧进程继续使用旧 inode，下一次启动读取新 artifact；
- 替换或 desktop-entry 更新失败时恢复上一版本和上一入口。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "agent-depth-linux-desktop-20261020",
  "versionId": "agent-depth-linux-desktop-20261020-v2-approved",
  "createdAt": "2026-10-20T04:10:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/domains/agent/modern-chat-agent/product-definition.md",
      "docs/architecture/domains/agent/modern-chat-agent/experience-contract.md",
      "docs/architecture/domains/agent/modern-chat-agent/design.md",
      "docs/architecture/domains/agent/modern-chat-agent/data-model.md",
      "docs/architecture/domains/agent/modern-chat-agent/integration.md",
      "docs/architecture/engineering/prototypes/desktop-shell/agent-chat-coverage.md",
      "docs/architecture/engineering/prototypes/README.md",
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
      "LDCP-D21",
      "LDCP-D22"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "tooling/devctl", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/local-dev", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/prototypes", "mode": "exclusive-write"},
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
      "Add a Windows persistent installer",
      "Publish to origin/GitHub or create a pull request",
      "Replace focused Native proof with browser-only evidence"
    ]
  },
  "tasks": [
    {"id": "ADL-00", "workstreamId": "ADL", "path": "tasks/ADL-00.md", "dependsOn": []},
    {"id": "ADL-01", "workstreamId": "ADL", "path": "tasks/ADL-01.md", "dependsOn": []},
    {"id": "ADL-02A", "workstreamId": "ADL", "path": "tasks/ADL-02A.md", "dependsOn": []},
    {"id": "ADL-02B", "workstreamId": "ADL", "path": "tasks/ADL-02B.md", "dependsOn": ["ADL-02A"]},
    {"id": "ADL-03", "workstreamId": "ADL", "path": "tasks/ADL-03.md", "dependsOn": ["ADL-00", "ADL-02B"]},
    {"id": "ADL-04", "workstreamId": "ADL", "path": "tasks/ADL-04.md", "dependsOn": ["ADL-00", "ADL-02B"]},
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

Delivery 仅授权当前分支 squash 后推送到
`administrator`/`station-one`；不授权 origin push、PR、新分支或新 worktree。

## Dependency DAG

```text
ADL-00 product/prototype contract ───────────────┐
                                                ├─> ADL-03 commands ──┐
ADL-02A definition roundtrip ─> ADL-02B prompt ─┤                    ├─> ADL-05
                                                └─> ADL-04 sources ───┤
ADL-01 Linux install adapter ─────────────────────────────────────────┘
```

## Atomic Cutovers

1. `desktop-install` 由公共 orchestrator 与 platform adapter registry 唯一拥有；
   删除 macOS 专属 orchestration。
2. SOUL/AGENTS 从 `config_json` 切到类型化 AgentDefinition；CRUD、迁移、
   import/export、Prompt 与 Desktop projection 同步切换，删除 alias fallback。
3. `AgentCapabilityBinding` 成为 Skill enablement/policy 唯一真相。
4. Slash UI 从 insert-only/localStorage 切到 command registry + Station snapshot。
5. Chat attribution 从 Knowledge/Attachment 特例切到历史固定的 typed Turn
   attribution，删除基于当前配置推断的第二 owner。

回滚只允许 VCS revert 对应 cutover，不保留 flag、双写或兼容分支。

## Acceptance Execution

```json
{
  "closures": {
    "ADL-product-contract": [],
    "ADL-linux-install": ["desktop-linux-install-native-e2e"],
    "ADL-agent-definition": ["agent-definition-roundtrip-native-e2e"],
    "ADL-prompt-authority": ["agent-chat-profile-native"],
    "ADL-command-projection": ["agent-slash-command-native-e2e"],
    "ADL-turn-attribution": ["agent-context-projection-native-e2e"],
    "ADL-native-closure": ["agent-depth-linux-native-e2e"]
  },
  "completion": [
    "desktop-linux-install-native-e2e",
    "agent-definition-roundtrip-native-e2e",
    "agent-chat-profile-native",
    "agent-slash-command-native-e2e",
    "agent-context-projection-native-e2e",
    "agent-depth-linux-native-e2e"
  ],
  "full": []
}
```

## Completion

- North Star Journey 为 `PROVEN`，全部硬性辅助指标为 `0`。
- Commands 与 Attribution 原型先恢复为 `pending-review`，经 Owner 确认后再
  进入 production implementation，并最终回到 `confirmed/landed`。
- macOS install contract 回归通过；Windows Native development 无行为变化。
- AgentDefinition、Skill authority、Commands、Attribution 各有且仅有一个真相。
- task-owned runtime、安装临时文件与业务夹具全部清理。

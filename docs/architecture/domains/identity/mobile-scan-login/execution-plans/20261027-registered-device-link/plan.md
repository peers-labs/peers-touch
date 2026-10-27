# Mobile 扫码登录实施计划

> **Plan ID**: MSL-20261027
> **Version ID**: 20261027-registered-device-link
> **Created**: 2026-10-27T01:00:00.000Z
> **Owner**: Identity and Access

用户授权“review下，没有问题就实现吧”。源码审查已纠正身份传递、
HPKE 来源认证、事务参与和多手机会话合同，执行这些已接受的目标。
本计划不授权提交、推送、PR、合并或发布。源码基线为
`b6e481c69b718c40644fe3c922a1a73daa38ca16`。本候选机械补齐已接受的
Schema 与 Device Link 决策注册引用，不改变 Journey、协议、任务、证明强度
或授权。原冻结包保持不变。

目标是手机通过原生相机扫描 Desktop 屏幕码，无需输入站点信息，
验证同一逻辑 Station，核对并获得单设备授权，经安全存储与 ack 进入同一账号。
两台手机与 Desktop 必须同时可用；原生相机、Direct/Circuit、消息接收各需
实际证据。无法执行的格保持 UNPROVEN，禁止使用网页扫码替代真机扫码。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "MSL-20261027",
  "versionId": "20261027-registered-device-link",
  "createdAt": "2026-10-27T01:00:00.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/domains/identity/mobile-scan-login/design.md",
      "docs/architecture/domains/identity/mobile-scan-login/decisions.md",
      "docs/architecture/domains/identity/mobile-scan-login/data-model.md",
      "docs/architecture/domains/identity/mobile-scan-login/experience-contract.md",
      "docs/architecture/domains/identity/mobile-scan-login/acceptance-matrix.md",
      "docs/architecture/shared/schema/design.md",
      "docs/architecture/shared/schema/decisions.md",
      "docs/architecture/platform/station/access/design.md",
      "docs/architecture/platform/runtime/node-connectivity/design.md",
      "docs/architecture/domains/identity/unified-actor-system.md"
    ],
    "decisions": ["MSL-D01", "MSL-D02", "MSL-D03", "MSL-D04", "MSL-D05", "MSL-D06", "MSL-D07", "SCH-D01", "SCH-D02", "SCH-D03", "SCH-D04", "SAL-D12", "NCP-D01", "NCP-D02", "NCP-D03", "NCP-D04", "NCP-D05", "NCP-D06", "NCP-D07", "NCP-D08", "NCP-D09", "NCP-D10", "NCP-D11", "NCP-D12", "NCP-D13", "NCP-D14", "NCP-D15", "NCP-D16", "NCP-D17", "NCP-D18", "NCP-D19", "NCP-D20", "NCP-D21"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "apps", "mode": "exclusive-write"},
      {"pathPrefix": "model", "mode": "exclusive-write"},
      {"pathPrefix": "packages", "mode": "exclusive-write"},
      {"pathPrefix": "docs", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/proto-gen-mobile.sh", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/node-connectivity-journey.py", "mode": "exclusive-write"},
      {"pathPrefix": "pnpm-lock.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "pnpm-workspace.yaml", "mode": "exclusive-write"},
      {"pathPrefix": "package.json", "mode": "exclusive-write"},
      {"pathPrefix": "Makefile", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "历史消息、ratchet、MLS 或 Recovery master 迁移",
      "重新设计 Actor PKI 或共享 Desktop 设备私钥",
      "中心短链、云登录代理和任意网络穿透承诺",
      "修改 Acceptance Core 或工作流框架",
      "提交、推送、PR、合并、发布和其他工作区写入"
    ]
  },
  "tasks": [
    {"id": "MSL-01", "workstreamId": "SESSION", "path": "tasks/MSL-01.md", "dependsOn": []},
    {"id": "MSL-02", "workstreamId": "SCHEMA", "path": "tasks/MSL-02.md", "dependsOn": []},
    {"id": "MSL-03", "workstreamId": "BOOTSTRAP", "path": "tasks/MSL-03.md", "dependsOn": ["MSL-02"]},
    {"id": "MSL-04", "workstreamId": "AUTHORIZATION", "path": "tasks/MSL-04.md", "dependsOn": ["MSL-01", "MSL-03"]},
    {"id": "MSL-05", "workstreamId": "COMMIT", "path": "tasks/MSL-05.md", "dependsOn": ["MSL-04"]},
    {"id": "MSL-06", "workstreamId": "DESKTOP", "path": "tasks/MSL-06.md", "dependsOn": ["MSL-02", "MSL-05"]},
    {"id": "MSL-07", "workstreamId": "MOBILE", "path": "tasks/MSL-07.md", "dependsOn": ["MSL-06"]},
    {"id": "MSL-08", "workstreamId": "PROOF", "path": "tasks/MSL-08.md", "dependsOn": ["MSL-07"]}
  ],
  "outcomeComparison": {"path": "outcome-comparison.md"},
  "authorization": {
    "checkpoint": {"localCommit": "denied", "amend": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  }
}
```

## 依赖与原子切换

MSL-01 统一 Session 真源；MSL-02 统一链接与码图消费者。
MSL-03 闭合取回连接材料的引导链。MSL-04 形成可恢复、有限名额、带签名审批的
设备邀请。MSL-05 完成无 bearer 目标设备的受限 enrollment、Access 求值、
inactive 凭据交付与原子 ack。随后接入 Desktop/Mobile 的正常账号生命周期。

Schema 切换全部三个 qrcode.react 消费者和旧 DeepURL helper 后删除旧依赖；
安全核对与外部频道原始载荷不重编码。Session 删除 class 唯一索引与旧替换入口，
缺少绑定的存量 Session 撤销。内部替换通过版本控制撤回，不保留双实现。

源码、生成器、共有协议与注册均由一个集成者处理。每个任务细化精确改动路径，
目录 claim 只作为范围上限。运行资源只按当前工作区的非稳定 Profile 与
capability 获取，不从此计划推导环境授权。

## Acceptance Execution

```json
{
  "closures": {
    "msl-session": [],
    "msl-schema": [],
    "msl-bootstrap": [],
    "msl-authorization": [],
    "msl-commit": [],
    "msl-desktop": [],
    "msl-mobile": [],
    "msl-proof": ["station-access-session-class-suite-e2e"]
  },
  "completion": ["station-access-session-class-suite-e2e"],
  "full": []
}
```

新扫码原生格使用对应 Task 的 focused FUNCTIONAL_CHECK，不能据此声明正式
Acceptance PROVEN。新增正式 Gate 时回到冻结计划的机械修订，不自动扩大执行。
本次不执行 full/release 或无关 aggregate。实际效果登记于
[outcome-comparison.md](./outcome-comparison.md)，初始全部 UNPROVEN。

## 审查输入

审查垂直闭环、producer/consumer 顺序、Schema/Session 删除清单、事务锁序、
真实扫码与接收端证据、五维效果、授权边界和 bounded budget。
accepted sources 能裁决的问题由当前 Run 修正，例行审查不再次提交用户。

# Runtime Secrets Provisioning — 设计决策

> **Status**: active
> **Version**: v0.1
> **Created**: 2026-11-06 | **Updated**: 2026-11-06
> **Owner**: Platform Team

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| RS-D01 | 密钥按权威分两类，区别配给 | accepted |
| RS-D02 | 复用 per-role git-crypt runtime.env，不新建 secret 体系 | accepted |
| RS-D03 | Class B 随 make 部署幂等对账，非一次性手工装备 | accepted |
| RS-D04 | reconcile 仅 upsert 声明键，保留 Class A，compose 零改动 | accepted |
| RS-D05 | 值只走 SSH stdin + 远端 0600 原子落盘 | accepted |
| RS-D06 | 远端 env 按 compose project 命名空间隔离 | accepted |
| RS-D07 | fail-closed 双层（部署前预检 + entrypoint 必需键） | accepted |
| RS-D08 | 独立 runtime-secrets 模块而非扩写 service-coordination | accepted |
| RS-D09 | 首期只 onboard Station OAuth bridge + Relay 共享项 | accepted |

---

## RS-D01: 密钥按权威分两类，区别配给

**Status**: accepted
**Date**: 2026-11-06

### Context

部署链路此前把所有 runtime.env 一律当"一次性主机本地装备、deploy 只读"。这对 DB 密码、
应用密钥、Relay CA 等正确，但 OAuth bridge secret 的权威在 Vercel，必须随部署与外部对齐；
用同一策略导致它永不到达主机。

### Decision

按"值的权威是否在目标主机之外"将密钥分为 Class A（主机本地生成类）与 Class B（外部/共享类），
由 secret manifest 逐键声明 class，两类生命周期与配给策略不同。

### Rationale

单一策略无法同时满足"主机身份不外传/不覆盖"与"共享密钥随部署对齐"两个相互冲突的约束。

### Alternatives Considered

- 全部视为主机本地：共享密钥无到达路径（现状缺陷）。
- 全部由 profile 下发：会把 DB 密码/身份密钥复制到 git 并在多机间漂移，破坏一次性身份语义。

### Consequences

需要维护每键 class 声明；新增密钥时必须先归类。换来了两类语义都不被妥协。

---

## RS-D02: 复用 per-role git-crypt runtime.env，不新建 secret 体系

**Status**: accepted
**Date**: 2026-11-06

### Context

env 仓根 `.gitattributes` 默认对所有文件 git-crypt 加密；`corpdebug`/`home` 已有
`<profile>/<role>/runtime.env(.example)` 与 `PT_DEPLOY_RUNTIME_KIND/PATH` 先例。

### Decision

Class B 值放入既有 env 仓 `peers-touch/<profile>/<role>/runtime.env`（git-crypt），
必需键声明放入同目录的非密 manifest；不引入 age/sops 之外的新存储，也不在产品仓新增 secret 层。

### Rationale

最小改动、与既有 profile 心智一致（密钥就在 profile 里）、换机可移植；git-crypt 已是仓内事实标准。

### Alternatives Considered

- age/sops 加密：静态更强，但新增工具链与配对步骤，当前私有仓 + git-crypt 已满足威胁模型。
- 仅本机 gitignored 0600：最安全但不可移植，换机需重新配对，违背"部署即能用"。

### Consequences

安全性依赖私有仓访问控制与 git-crypt 密钥管理；未来若仓可见性扩大需重新评估（在 integration.md 记录）。

---

## RS-D03: Class B 随 make 部署幂等对账，非一次性手工装备

**Status**: accepted
**Date**: 2026-11-06

### Context

x-config/Relay 的 runtime.env 是一次性 provisioning，代码 bump 的 deploy 不重复配给。该边界对
主机本地类合理，但会让外部共享密钥在轮换或新 profile 上断供。

### Decision

在 deploy 闭环内新增 reconcile 步，对 Class B 每次 `make station/relay` 幂等对账下发；Class A 维持一次性。

### Rationale

用户明确目标是"部署即能用"；共享密钥与外部权威的一致性是部署正确性的一部分，不应依赖记得手工 provision。

### Alternatives Considered

- 保留手工 provisioning，缺密钥时只提示：仍会复发"部署成功但登录失败"。
- 另出显式 `provision-secrets` 子命令：增加操作负担，易被遗忘。

### Consequences

deploy 需要本地 git-crypt 已解锁；锁定时 reconcile 给出明确 BLOCKED 与解锁指引（不猜测、不强解）。

---

## RS-D04: reconcile 仅 upsert 声明键，保留 Class A，compose 零改动

**Status**: accepted
**Date**: 2026-11-06

### Context

同一 runtime.env 混含两类键；直接整文件下发会用 profile 值覆盖主机上已生成的 DB 密码/身份密钥。

### Decision

对账时只更新 manifest 声明为 Class B 的键（upsert），逐行保留其余既有行（Class A）；
compose 仍只读单个 `--env-file`，命令与 env 变量引用零改动。

### Rationale

用最小写面消除覆盖风险，且不需要 compose/entrypoint 感知密钥分类。

### Alternatives Considered

- 拆成两个 env 文件分别挂载：需改全部 compose 命令与 profile 模板，改动面大。
- 整文件下发后让主机密钥也入 profile：被 RS-D01 否决。

### Consequences

resolver 必须严格按白名单写；对未声明键保持不变并可报告差异。

---

## RS-D05: 值只走 SSH stdin + 远端 0600 原子落盘

**Status**: accepted
**Date**: 2026-11-06

### Context

密钥不得进 argv（会进 ps/history）、日志或 scp 旁路。

### Decision

本地装配的有效 env 经现有 SSH 通道以 stdin 写到远端 `mktemp`，`chmod 600` 后 `mv` 原子替换；
不落命令行参数。

### Rationale

复用既有 reviewed SSH 通道；stdin + 原子换名避免半截文件与进程读到中间态。

### Alternatives Considered

- scp/sftp 单独通道：x-config 等 runbook 明确禁止 hand-scp，且脱离 lease/source-sync 管线。
- 经环境变量透传：会出现在远端进程环境与日志。

### Consequences

deploy 输出与日志需继续经 redact 规则脱敏；reconcile 不回显值。

---

## RS-D06: 远端 env 按 compose project 命名空间隔离

**Status**: accepted
**Date**: 2026-11-06

### Context

four 主机上 `pt-station` 与 `pt-chat-native-four` 共用 `$HOME/peers-touch/station.env`，存在互相覆盖面。

### Decision

渲染产物落到 `$HOME/.peers-touch/runtime/<compose-project>/runtime.env`（沿用新契约 deploy 定义的
`PT_DEPLOY_RUNTIME_PATH`），一 project 一文件，0600。

### Rationale

与 corpdebug/home 已采用的 `PT_DEPLOY_RUNTIME_KIND=docker-compose` 契约一致；天然消除共享覆盖。

### Alternatives Considered

- 维持全局 station.env：多 profile 同机风险延续。

### Consequences

four 等旧扁平 profile 需迁到新契约（env 仓改动，需单独人类授权）。

---

## RS-D07: fail-closed 双层

**Status**: accepted
**Date**: 2026-11-06

### Context

`PEERS_OAUTH_BRIDGE_SECRET: ${...:-}` 静默空默认使缺密钥延迟到首个登录才暴露。

### Decision

部署前 resolver 按 manifest 预检阻断；entrypoint/compose 对声明了该能力的角色在启动前校验必需键非空，
缺失拒绝启动并报键名。不做影响本地/未启用环境的全局 `:?`。

### Rationale

把"延迟到首个用户请求"提前到"部署期 / 启动期"，且错误可定位、可修复。

### Alternatives Considered

- 全部 compose 变量改 `:?`：会误伤不使用 OAuth 的本地/compose 研发环境。

### Consequences

需要一个"角色必需键"声明来源（manifest）驱动 entrypoint 校验。

---

## RS-D08: 独立 runtime-secrets 模块

**Status**: accepted
**Date**: 2026-11-06

### Context

密钥配给是跨 Station/Relay、约束部署工具链与 compose 的平台运行时基础能力。

### Decision

在 `docs/architecture/platform/runtime/` 下新建 `runtime-secrets/` 独立模块，而非在
service-coordination.md 增加章节。

### Rationale

边界清晰、可长期承接 LiveKit 等密钥；避免 service-coordination（运行时凭据所有权）混入部署机制。

### Alternatives Considered

- 扩写 service-coordination.md：更轻，但混淆"凭据归属"与"值的配给"两件事。

### Consequences

新增一组需维护并登记进 architecture-modules.json 的模块文档。

---

## RS-D09: 首期只 onboard Station OAuth bridge + Relay 共享项

**Status**: accepted
**Date**: 2026-11-06

### Context

机制需先在真实阻断点上验证闭环；LiveKit 等当前未启用。

### Decision

首期承接 Class B：Station `PEERS_OAUTH_BRIDGE_SECRET`，以及 Relay 跨节点共享项（CA 证书分发、
invite token 等实际需要的子集）。LiveKit/其他后续仅通过 manifest 声明接入。

### Rationale

控制改动面，先用真机登录 Journey 证明机制，再横向扩展。

### Alternatives Considered

- 一次性迁移全部共享密钥：改动面大、验证稀释。

### Consequences

首个执行计划以 four 迁移 + OAuth bridge 为纵向闭环；其余密钥留待后续声明。

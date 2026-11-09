# Runtime Secrets Provisioning — 架构设计

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-11-06 | **Updated**: 2026-11-06
> **Owner**: Platform Team
> **Module**: `tooling/scripts/deploy/`, `tooling/docker/`

---

## 0. Evidence Ledger（事实台账）

| Claim | Class | Evidence |
|---|---|---|
| deploy.sh 只做同步/构建/重启，从不下发或对账远端 env | verified_fact | `tooling/scripts/deploy/deploy.sh` 仅 source deploy 定义、source-sync、执行 `PT_DEPLOY_*` 命令 |
| 远端 `$HOME/peers-touch/station.env` 无 bridge secret | verified_fact | four 主机实测 `PEERS_OAUTH_BRIDGE_SECRET=MISSING`，容器内 EMPTY |
| compose 对该密钥静默空默认 | verified_fact | `tooling/docker/compose.yml:70` `PEERS_OAUTH_BRIDGE_SECRET: ${PEERS_OAUTH_BRIDGE_SECRET:-}`，对比 `:69` `PEERS_AUTH_SECRET:?` |
| bridge secret 是 Station↔Vercel 共享密钥，缺失 fail-closed | verified_fact | `oauth_bridge.go` VerifyBridgeSignature 对空值返回 ErrBridgeSecretMissing；integration.md §90-93 |
| 缺密钥时 `make station` 仍成功，首个登录才失败 | verified_fact | four 部署健康通过；日志 GitHub 登录 401 `signature verification failed` |
| per-role git-crypt `runtime.env` 契约已存在 | verified_fact | env 仓 `peers-touch/corpdebug/{station,relay}/runtime.env.example`、`PT_DEPLOY_RUNTIME_KIND=docker-compose` + `PT_DEPLOY_RUNTIME_PATH`；env 仓根 `.gitattributes` 默认 git-crypt |
| Relay TLS/CA/operator key 由远端本机生成 | verified_fact | `tooling/scripts/deploy/posix_relay_runtime.py` |
| 新契约/旧扁平 profile 并存，four 共用单一 station.env | verified_fact | env 仓 four 与 corpdebug 定义对比；主机上 `pt-station` 与 `pt-chat-native-four` 并存 |
| 部署期应做密钥对账 | proposal | 本模块目标，待接受 |
| 主机本地密钥应一律改为 profile 下发 | rejected_alternative | 会破坏本机生成身份/数据库密码的"一次性、不跨机复制"语义，见 D-01 |

---

## 1. 核心原则

1. **两类密钥，两种权威**：判定标准是"值的权威是否在目标主机之外"。主机本地生成类的权威
   在主机，外部/共享类的权威在外部系统或共享加密源；二者生命周期、下发策略不可混用。
2. **部署即能用，但只对账该对账的**：deploy 幂等下发外部/共享类；对主机本地生成类只读不写、
   永不覆盖。
3. **拓扑与密钥分权**：host/角色/端口/命令只由 git 跟踪、clean 的 deploy 定义决定；secret
   层不携带、也无能力改写任何目标定位字段。
4. **保密纵深**：产品源码仓零密钥；值只存在于私有 env 仓（git-crypt）或本机 0600 → SSH stdin
   → 远端 0600 命名空间 env → 容器环境。不进 argv、日志、证据、shell history。
5. **fail-before-side-effects**：缺任一角色必需键，在构建与重启之前以结构化错误阻断；运行时
   entrypoint 再做一次同键校验，杜绝静默空值。
6. **最小泛化**：机制一次做对，能力靠声明扩展；首期只 onboard OAuth bridge 与 Relay 共享项。

## 2. 密钥分类模型

| 维度 | Class A：主机本地生成类 | Class B：外部/共享类 |
|---|---|---|
| 判定 | 值可在目标主机独立生成，且不与任何外部系统共享 | 值的权威在目标主机之外，必须与外部保持一致 |
| 权威源 | 主机（一次性生成） | 外部系统，或一处维护、多 profile 引用的加密共享源 |
| 典型 | `PEERS_AUTH_SECRET`、`PEERS_DB_PASSWORD`、Relay CA/TLS/operator key | `PEERS_OAUTH_BRIDGE_SECRET`、LiveKit API key/secret、Relay invite token（跨节点共享部分） |
| 静态存储 | 不入 git；主机 0600 | 私有 env 仓 per-role git-crypt `runtime.env` |
| deploy 行为 | 不读、不写、不覆盖（present 即保留） | 每次部署幂等 upsert 下发 |
| 缺失时 | 首次装备阶段生成（既有机制） | 部署前 BLOCKED，提示配对命令 |

一个键固定属于一类，由 secret manifest 显式声明其 class；不允许同一键在不同 profile 间归类不一致。
Class A 沿用现状（compose/posix_relay_runtime），本模块新增能力全部针对 Class B。

## 3. 系统架构

视角：Control Plane / Deployment Topology。箭头语义统一为"密钥值/控制权流向"。

```text
外部权威（如 Vercel broker）
   │  值一次性配对（人工，stdin；不经 chat/argv）
   ▼
本机私有 env 仓（git-crypt，默认加密）
   peers-touch/<profile>/<role>/runtime.env        ← Class B 值（密文入库，本机解锁后为明文）
   peers-touch/<profile>/<role>/secret-manifest.*  ← 必需键名 + class（跟踪、非密）
   │
   │ make station / make relay（本地 resolver）
   │  1. 解析评审拓扑（deploy 定义，非密、唯一 host 权威）
   │  2. 合并 非密值 + Class B secrets（manifest 白名单）
   │  3. 预检必需键；缺 → BLOCKED（只报键名，不构建/不重启）
   ▼
SSH 通道（值走 stdin，不经 argv / scp / shell history）
   ▼
远端 $HOME/.peers-touch/runtime/<compose-project>/runtime.env   0600，原子 mv
   │  compose --env-file 读取（按 compose project 命名空间，互不覆盖）
   ▼
容器环境变量 → Station / Relay 进程；entrypoint 启动前再校验必需键非空
```

与 Class A 的关系：同一远端 `runtime.env` 中，Class A 键（已在主机存在）由 upsert 过程**原样保留**；
对账器只写 manifest 声明为 Class B 的键。因此 compose 命令无需区分两类。

## 4. 核心契约

### 4.1 Secret manifest（每角色、跟踪、非密）

声明"该角色运行需要哪些键、属于哪类、来自哪"，是预检与白名单的唯一依据。示意（字段名在
data-model.md 固定）：

```yaml
role: station
required:
  - key: PEERS_OAUTH_BRIDGE_SECRET
    class: external-shared
    source: broker:peers-touch-oauth/production
    requiredWhen: oauthBrokerLoginEnabled
```

resolver 只允许注入 manifest 白名单内的键；任何出现在 secret 文件但不在 manifest 的键
都会被忽略并告警（防止借 secret 层夹带任意环境变量）。

### 4.2 部署期对账（deploy pipeline 内新增一步）

在 `deploy.sh` 的"源码同步完成之后、build/restart 之前"插入 reconcile：

```text
resolve topology (existing)
  → resolve secrets: per-profile 值 → 可引用的共享 infra 源 → 缺失
  → preflight: 按 manifest 校验 Class B 必需键非空；否则结构化 BLOCKED
  → render: 非密值 ∪ Class B 值；不内联 Class A
  → ship over SSH stdin → remote mktemp(0600) → atomic mv 到命名空间 runtime.env
  → existing reviewed build / restart（--env-file 指向渲染后路径）
  → health
```

幂等：同值重复部署不产生变化；只在 Class B 键变化时改文件并触发重启。
失败语义：reconcile 失败时不得执行 build/restart；已有运行容器保持原状。

### 4.3 fail-closed 双层

- 部署前：resolver/preflight 阻断（可读错误：缺哪个键、用什么命令配对）。
- 运行时：entrypoint/compose 依据"本角色必需键"集合校验非空，缺失拒绝启动；
  不再使用 `${VAR:-}` 静默空默认。对未声明该能力的本地/compose 研发环境零影响（不做全局 `:?`）。

## 5. 组件关系

| 组件 | 职责 | 不做什么 |
|---|---|---|
| env 仓 per-role `runtime.env`（git-crypt） | Class B 值的静态权威 | 不含 host/角色定位；不被产品仓读取 |
| secret manifest | 声明必需键、class、来源 | 不含值 |
| 本地 secret resolver（deploy 前置） | 解锁读取、白名单合并、预检、共享源引用解析 | 不打印值、不写产品仓 |
| deploy reconcile 步 | SSH stdin 下发、原子落盘、幂等 | 不生成 Class A、不 scp、不改拓扑 |
| 远端命名空间 `runtime.env` | compose 的 `--env-file` 输入 | 不跨 compose project 共享 |
| compose / entrypoint | 注入容器、启动前必需键校验 | 不发现/不配取密钥 |
| Station providers/health | 如实反映就绪状态 | 不持有密钥配取职责 |

## 6. 就绪与可观测

- "部署成功"的健康判据从"进程在听"升级为"该角色声明的外部依赖就绪"：Station 至少包含
  bridge secret 非空、broker 可达、providers 如实通告（配合修复 providers 绑定缺陷）。
- `make secret-status <profile> <role>` 只输出键名与 SET/MISSING/长度（复用 redact-env），
  不输出值；`make secret-set` 仅经 stdin 写入 0600。
- 所有对账结果只记键名/哈希，不记值。

## 7. 信任边界与不变量

- 产品源码仓 `peers-touch` 永不持有密钥值；CI/日志/证据/chat 中不得出现值。
- secret 层到主机只携带运行时 env 白名单子集；host/user/path/role 仍只来自评审 deploy 定义。
- 远端 env 按 compose project 命名空间隔离；同机多 profile 不互相覆盖。
- Class A 值绝不因部署被覆盖或外传；轮换 Class B 只改其权威源后重新部署。
- 复用现有 SSH/lease/source-sync 管线，不新增旁路通道或常驻 secret 服务。

### 7.1 配给安全管道：每段的密文/明文边界

"写入环境变量"本身不提供安全；安全来自值在每个阶段的形态与边界。Class B 密钥从权威源到
Station 进程经过五段，解密只在两个受控点发生（配给人的本机、Station 进程内）：

| 阶段 | 密钥形态 | 边界保证 | 挡不住什么（残余面） |
|---|---|---|---|
| ① 静态：env 仓 per-role runtime.env | git-crypt **密文** | 仓根 `.gitattributes` 默认 git-crypt；非授权 clone/CI 只见密文 | 有 GPG 解密权的成员可见；依赖仓访问控制 |
| ② 录入：`make secret-set` | stdin 明文 | 值只走 stdin；0600 写本机解锁副本；不入 argv/history | 配给人本机被入侵；误贴进聊天（靠流程） |
| ③ 传输：deploy→SSH | SSH 隧道内 | 复用 `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes`；值经 stdin，不经命令行 | 端点主机本身；SSH 客户端/服务端被入侵 |
| ④ 主机落盘：`<runtimePath>/runtime.env` | 明文 + OS 权限 | `chmod 0600`、当前用户属主、`mktemp`→原子 `mv`；按 compose project 命名空间 | **目标主机 root / docker socket 持有者可读** |
| ⑤ 进容器：compose `--env-file` | 进程 environ | 变量只进该容器进程环境；不写入镜像层、不进 `docker logs` | 同容器内进程、可 `docker exec` 者；core dump/子进程继承 |

不变量：产品源码仓任何时刻不出现明文值；值不进 argv、shell history、deploy 日志、验收证据；
⑤ 的镜像产物可自由分发而不含密钥。

### 7.2 目标主机 root 信任模型（待 owner 决策）

阶段④存在一个密码学无法消除的残余面：**主机 root 与 docker socket 持有者能读到明文
runtime.env 与容器 environ**。两种模型，成本与威胁覆盖不同：

| 维度 | 模型 R1：信任主机（当前设计） | 模型 R2：主机静态也加密 |
|---|---|---|
| 假设 | Home/DevBox 主机受信，攻击面是"非 root 用户 + 同机他 project" | 主机不可信（共用/托管/合规），连 root 静态读盘也要防 |
| 手段 | git-crypt 静态 + SSH 传输 + 0600 + project 命名空间 | 引入外部 KMS/Vault 或启动时拉取解密；或文件级信封加密 |
| 静态 root 读盘 | **可见明文** | 仅见密文 |
| 运行时 | 进程 environ 明文（必然，HMAC 要用） | 进程内存/environ 仍是明文（无法消除） |
| 新增依赖 | 无，复用 git-crypt/SSH | 新外部依赖（KMS/Vault/身份引导），与 D-02"不另造加密"冲突 |
| 适用 | 个人/家庭/自控研发主机 | 多租户、强合规主机 |

关键事实：**没有任何模型能在"Station 进程必须用密钥做 HMAC"的前提下，对该主机 root 完全隐藏
运行时密钥**——R2 只把"静态读盘可见"缩小为"运行时内存可见"，且要引入新的密钥托管依赖。

初始建议：采用 R1（与 D-02 复用 git-crypt 一致），并把"主机受信"显式写进 profile 的信任前提；
对未来多租户/托管主机再评估 R2。**此决策未最终接受，留待 owner 拍板**；图
`secret-provisioning`（官网 crypto 图）需如实标注这条 root 信任边界，不得暗示对主机 root 保密。

## 8. 质量门（目标态）

- 一个声明了 Class B 必需键但缺失的 profile，`make station/relay` 必须在 build 前以
  BLOCKED 失败，且错误不含值。
- 完整 Class B 配给 + 部署后，真机 GitHub 登录 Journey 走通（Station↔Vercel 同值）。
- 重复部署幂等：远端文件哈希不变则不重启；Class A 键在 reconcile 前后保持不变。
- 静态扫描：密钥值不出现在产品仓、argv、日志样本与验收证据。
- 配给链各段形态可审计：能从证据确认①密文、③隧道、④0600/命名空间、⑤不进镜像/日志。

# Runtime Secrets Provisioning — 数据模型

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-11-06 | **Updated**: 2026-11-06
> **Owner**: Platform Team

---

## 1. Secret 分类与标识

```text
SecretClass =
  | host-generated      # Class A：主机一次性生成，deploy 不读不写
  | external-shared     # Class B：权威在外部/共享源，deploy 幂等下发

SecretKey                # 仅允许 [A-Z0-9_]+，与容器环境变量名一致
Role                     # station | relay（与 PT_DEPLOY_ROLE 对齐）
Profile                  # env 仓 peers-touch/<profile>/ 目录名
ComposeProject           # PT_DEPLOY_COMPOSE_PROJECT，远端命名空间键
```

一个 `(Role, SecretKey)` 全局归类一致：同一键不得在不同 profile 被判为不同 class。

## 2. Secret manifest（跟踪、非密）

位置：env 仓 `peers-touch/<profile>/<role>/secret-manifest.yaml`（建议名；最终命名在执行计划固定）。
该文件随 env 仓 git-crypt 默认加密，但**不含值**；也可显式标为非密以便 diff 评审。

```yaml
role: station
composeProject: pt-station          # 与 deploy 定义一致，用于远端命名空间
required:
  - key: PEERS_OAUTH_BRIDGE_SECRET
    class: external-shared
    source: broker:peers-touch-oauth/production   # 权威源引用，不存值
    requiredWhen: oauthBrokerLoginEnabled         # 能力开关；恒需可写 always
  - key: PEERS_AUTH_SECRET
    class: host-generated
  - key: PEERS_DB_PASSWORD
    class: host-generated
```

规则：

- resolver 只接受 `required[].class=external-shared` 的键进入下发白名单；
- 出现在 `runtime.env` 但不在 manifest 的键：拒绝并报告（防夹带）；
- `source` 是给人看的权威来源定位/共享源引用，解析逻辑在 resolver 内实现。

## 3. runtime.env（密）

位置：env 仓 `peers-touch/<profile>/<role>/runtime.env`，git-crypt 加密；本机解锁后为
shell-safe 的 `KEY='value'` 行（沿用 corpdebug/home 写法）。

```text
PEERS_OAUTH_BRIDGE_SECRET='<shared-value-from-vendor>'
# Class A 键不在此维护（主机生成）；如历史文件已存在，reconcile 不读不写它们
```

远端渲染产物：`$HOME/.peers-touch/runtime/<composeProject>/runtime.env`，mode `0600`，
由 compose `--env-file` 消费。它是**渲染结果**，不是 git 权威：

```text
# 由 deploy reconcile 原子写入；Class B 来自 profile，Class A 行保留主机原值
PEERS_OAUTH_BRIDGE_SECRET='...'
PEERS_AUTH_SECRET='...'            # 主机既有行，原样保留
PEERS_NODE_SERVER_BASEURL='...'    # 非密 deploy/profile 值
```

## 4. Resolver 输入/输出（逻辑结构）

```ts
interface ResolvedSecretSet {
  composeProject: string;
  externalShared: Record<SecretKey, string>;  // 仅 Class B，白名单内
  missing: SecretKey[];                         // manifest 要求但解析不到
  ignoredUndeclared: SecretKey[];              // runtime.env 有、manifest 无
}

interface ReconcilePlan {
  remoteEnvPath: string;          // <runtimePath>/runtime.env
  upsert: Record<SecretKey, string>;
  preserveExistingKeys: SecretKey[];
  changed: boolean;               // 是否需要原子替换 + 重启
  renderedSha256: string;         // 仅哈希，不含值
}
```

## 5. BLOCKED 错误契约

预检失败输出结构化、不含值：

```json
{ "status": "BLOCKED",
  "code": "SECRET_PREFLIGHT_MISSING",
  "role": "station",
  "missing": ["PEERS_OAUTH_BRIDGE_SECRET"],
  "hint": "make secret-set PROFILE=four ROLE=station KEY=PEERS_OAUTH_BRIDGE_SECRET" }
```

- 错误、日志、`make secret-status` 只允许键名 / SET|MISSING / 长度 / 哈希；
- 禁止回显 value（与 `redact-env.sh` 的 KEY/TOKEN/SECRET/PASSWORD/CREDENTIAL 规则一致）。

## 6. 配给命令（接口形态，非实现）

```text
make secret-status PROFILE=<p> ROLE=<role>     # 只读：键名 + SET/MISSING/长度
make secret-set    PROFILE=<p> ROLE=<role> KEY=<k>   # 值从 stdin 读取，写 0600
```

`secret-set` 的 KEY 必须已在对应 manifest 声明为 external-shared，否则拒绝（不能借该命令写任意键）。

## 7. 状态机：一次部署的配给判定

```text
resolve manifest
  ├─ git-crypt locked            → BLOCKED: SECRET_VAULT_LOCKED（指引解锁，不构建）
  ├─ Class B 缺键               → BLOCKED: SECRET_PREFLIGHT_MISSING
  ├─ 含未声明键                  → BLOCKED 或拒绝该键（按严格策略，见执行计划）
  └─ 齐全 → render → compare 远端
                 ├─ unchanged    → 跳过下发，正常 build/restart
                 └─ changed      → stdin 原子落盘 → build/restart
```

无持久化 schema；本模块只操作 env 文件与内存结构，不新增数据库表。

# Runtime Secrets Provisioning — 集成与映射

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-11-06 | **Updated**: 2026-11-06
> **Owner**: Platform Team

---

## 1. 与现有模块的映射

| 现有系统 | 现状 | 本模块带来的改动 |
|---|---|---|
| [Service Coordination §4](../service-coordination.md) | 定义运行时凭据所有权，无 bridge secret 行、无配给语义 | 补 OAuth bridge secret 行并链接到本模块；所有权不变 |
| [Local Dev Control Plane](../../../engineering/local-dev/README.md) | profile/slot/lease/拓扑权威；deploy 解析 tracked-clean 定义 | deploy 闭环新增 reconcile；profile 模型不新增字段，密钥走 env 仓 per-role 文件 |
| [OAuth Login Broker](../../../domains/identity/oauth-login-broker/integration.md) | 要求 Station 与 Vercel 持相同 `PEERS_OAUTH_BRIDGE_SECRET`，但未写如何到达 | 补"配给路径"指向本模块；fail-closed 语义保持 |
| X Config / corpdebug 契约 | 已用 per-role git-crypt runtime.env + `PT_DEPLOY_RUNTIME_*`，但定位为一次性 provisioning | 作为既有模式参考；本模块把其中 Class B 部分升级为可重复对账，Class A 维持一次性 |
| compose / entrypoint | bridge secret 静默空默认；无角色必需键启动校验 | fail-loud + 必需键校验 |
| Station oauth providers | kebab-case 配置绑定失败、`has_credentials` 不反映真实就绪 | 修 json tag；就绪状态与 bridge secret 挂钩（健康判据） |

## 2. 影响面分析

| 面 | 文件/仓 | 改动程度 | 授权 |
|---|---|---|---|
| deploy 编排 | `tooling/scripts/deploy/deploy.sh` | 中（插入一步） | 产品仓常规 |
| 密钥对账器 | `tooling/scripts/deploy/secret-reconcile.*`（新增） | 新增 | 产品仓常规 |
| make 目标 | `tooling/make/local-dev.mk` | 小（secret-set/status） | 产品仓常规 |
| 容器契约 | `tooling/docker/compose.yml`、`entrypoint.sh` | 中 | 产品仓常规 |
| oauth provider 真实性 | `apps/station/app/subserver/oauth/{plugin.go,oauth.go}` | 小（绑定/就绪） | 产品仓常规 |
| four profile 迁移 | env 仓 `peers-touch/four/**` | 中（拓扑 + 新增 manifest/runtime.env） | **需 env 仓单独人类授权** |
| 文档反向链接 | runtime/README、local-dev-env、broker integration、modules.json | 小 | 产品仓常规 |

## 3. 迁移策略（four 作为首个纵向闭环）

1. 产品仓：实现 reconcile、compose/entrypoint fail-loud、providers 修复（不影响既有 profile）。
2. env 仓（授权后）：把 `four` 迁到 corpdebug 同款 `docker-compose` 契约——补
   `PT_DEPLOY_RUNTIME_KIND/PATH`、独立 project、`four/station/secret-manifest.yaml` 与
   `runtime.env`（含 bridge secret）、`four/relay/...`。
3. 配对：生产 broker bridge secret 经 stdin（`make secret-set`）写入 four 的 Class B 值；
   值来源为 Vercel production，需对应授权。
4. `make station`（four）→ reconcile 下发 → 重启 → 真机 GitHub 登录 Journey 验证。
5. 旧扁平 profile 逐个迁移；未迁移 profile 不受影响（reconcile 对无 manifest 的角色跳过，
   保持现状）。

回滚：reconcile 设计为可选步，移除 manifest 即回到"deploy 只读数"现状；远端保留上一版
runtime.env 以便 `make deploy-repair` 回滚，不用 secret 覆盖恢复。

## 4. 安全/保密核查

- 产品仓静态扫描不得出现任何真实值；新增脚本默认对 SECRET/TOKEN/KEY/PASSWORD/CREDENTIAL 脱敏。
- 值不进 argv（用 stdin）、不进命令回显、不进 deploy 日志与验收证据。
- 远端文件 0600、属主当前用户；同机多 project 文件隔离。
- git-crypt 锁定时不得"明文降级写入"，直接 BLOCKED。

## 5. 验证映射（执行计划细化）

- 负向：声明 Class B 但缺值 → `make station` 构建前 BLOCKED，错误无值。
- 正向：配给 + 部署后 Station/Relay 健康，真机 GitHub 登录端到端走通。
- 幂等/隔离：重复部署文件哈希不变不重启；Class A 键 reconcile 前后不变；同机他 project 不受影响。
- 保密：值不出现在产品仓、argv 样本、日志/证据。

## 6. 未决与前置（执行计划前需 owner 确认）

- secret-manifest 的确切文件名与 `requiredWhen` 能力开关集合。
- 共享源引用语法（`broker:<project>/<env>`）是否一期落地，还是先仅支持 per-profile 显式值。
- four env 仓改动授权，以及生产 bridge secret 的取出授权。

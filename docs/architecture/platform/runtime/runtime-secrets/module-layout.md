# Runtime Secrets Provisioning — 模块布局

> **Status**: active
> **Version**: v0.1
> **Created**: 2026-11-06 | **Updated**: 2026-11-06
> **Owner**: Platform Team

---

## 1. 涉及目录树（目标态）

```text
env 仓库（兄弟仓，git-crypt）
└── peers-touch/<profile>/
    ├── profile.env.example                 # 非密拓扑（既有，唯一 profile 权威）
    └── <role>/                             # station | relay
        ├── secret-manifest.yaml            # [新] 必需键 + class（非密，跟踪）
        └── runtime.env(.example)           # Class B 值（git-crypt；既有模式扩展）

peers-touch 产品仓（永不存值）
├── tooling/
│   ├── scripts/deploy/
│   │   ├── deploy.sh                       # [改] source-sync 后插入 reconcile 步
│   │   ├── secret-reconcile.<sh|mjs>       # [新] 解析/预检/渲染/SSH stdin 下发
│   │   └── posix_relay_runtime.py          # 既有：Class A 本机生成（不改语义）
│   ├── scripts/local-dev/
│   │   ├── station-dev.sh                  # [改] 委托 deploy，继承 reconcile
│   │   ├── relay-dev.sh                    # [改] 同上（relay 对称）
│   │   └── redact-env.sh                   # [复用] 状态输出脱敏
│   ├── make/
│   │   ├── local-dev.mk                    # [改] secret-set / secret-status 目标
│   │   └── deploy.mk                       # 既有 deploy 入口
│   └── docker/
│       ├── compose.yml                     # [改] 必需键 fail-loud；env 路径命名空间化
│       └── entrypoint.sh                   # [改] 角色必需键启动前校验
└── apps/station/app/subserver/oauth/       # [修] provider struct json tag / readiness（配套）
```

## 2. 文件职责

| 路径 | 职责 |
|---|---|
| `secret-manifest.yaml`（env 仓） | 声明角色必需键、class、权威源；白名单与预检依据 |
| `<role>/runtime.env`（env 仓） | Class B 值静态权威（git-crypt） |
| `secret-reconcile.*` | 读取解锁后的 env 仓 → 白名单合并 → 预检 → SSH stdin 原子下发 |
| `deploy.sh` | 在既有 lease/source-sync/build/restart 间编排 reconcile；不实现密钥逻辑 |
| `station-dev.sh` / `relay-dev.sh` | dev 期入口，透传 profile/deploy env，复用 deploy，不另造密钥通道 |
| `compose.yml` | 以渲染后 `--env-file` 注入；必需键 fail-loud |
| `entrypoint.sh` | 启动前校验"角色必需键"集合非空 |
| `posix_relay_runtime.py` | Class A（Relay CA/TLS/operator key）本机一次性生成，保持原状 |

## 3. 依赖方向

```text
profile/deploy 定义 (非密, host 权威)
        │
        ▼
secret-reconcile ──读取──► git-crypt runtime.env + manifest（env 仓）
        │ 只写白名单 Class B
        ▼
SSH stdin ──► 远端命名空间 runtime.env(0600) ──► compose --env-file ──► entrypoint 校验 ──► 进程

posix_relay_runtime (Class A) ──生成──► 同一 runtime.env 中的本机键（reconcile 只读保留）
```

- secret-reconcile 依赖 deploy 解析出的拓扑（host/path/project），自身**不**解析 host；
- compose/entrypoint 依赖 manifest 渲染出的"必需键"标记，但不反向依赖 env 仓；
- Station 业务代码不感知配给机制，只消费环境变量。

## 4. 治理边界

- env 仓改动（four 迁移、新增 manifest/runtime.env）受 env 仓 AGENTS 约束，需单独人类授权；
  本模块设计不自动改 env 仓。
- 产品仓改动集中在 `tooling/scripts/deploy`、`tooling/docker`、`tooling/make`；
  providers 修复归 station oauth 子服务，但由本模块的就绪契约驱动。

# Acceptance Framework — 模块目录结构

> **Status**: active
> **Version**: v2.1
> **Created**: 2026-08-15 | **Updated**: 2026-08-27
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 目标目录树

> Runtime Provisioning 相关的 `core/provisioning.py`、`environments/`、
> `provisioners/` 和 Actor Fixture 由已接受的 D-07 ~ D-10 约束。

```
tooling/acceptance/
├── core/                           # [NEW] 通用核心抽象（domain-neutral）
│   ├── __init__.py
│   ├── gate.py                     # AcceptanceGate 基类
│   ├── evidence.py                 # Evidence Schema + 报告工具
│   ├── evidence_store.py           # [D-11] 唯一root/run/ref/manifest/latest/cleanup owner
│   ├── errors.py                   # GateError 统一异常
│   ├── redaction.py                # 结构化报告和文本证据统一脱敏
│   ├── harness.py                  # 通用 JS harness 桥接 helper
│   ├── provisioning.py             # Environment contract、runtime manifest 与生命周期接口
│   ├── provisioner.py              # EnvironmentProvisioner 生命周期与 fail-closed 公共逻辑
│   ├── attestation.py              # Station deployment/runtime attestation producer
│   ├── drivers/
│   │   ├── __init__.py
│   │   └── base.py                 # BaseDriver 生命周期 + DomDriver DOM 能力
│   └── fixtures/
│       ├── __init__.py
│       └── base.py                 # BaseFixture 抽象基类
├── drivers/                        # 具体 Driver 实现
│   ├── __init__.py
│   ├── tauri.py                    # macOS Tauri Desktop（从 tauri_webdriver.py 迁移重构）
│   ├── chrome.py                   # [NEW] Selenium Chrome driver + CDP command bridge
│   ├── station.py                  # [NEW] Station HTTP API driver
│   └── mobile.py                   # [Phase 4] Mobile Tauri driver
├── fixtures/                       # 具体 Fixture 实现
│   ├── chat_native_reset.py        # Chat 环境重置
│   └── chat_native_actors.py       # Chat account/PTID actor manifest producer
├── environments/                   # 非 local Gate 的机器可读 provisioning contracts
│   ├── local-desktop-gateway.yaml
│   └── home-station.yaml
├── provisioners/                   # 环境生命周期实现，不承载产品断言
│   ├── __init__.py
│   ├── local_desktop_gateway.py
│   └── home_station.py
├── behavior-rules/
│   └── chat-receipts.yaml          # receiver-visible receipt/badge Gate 选择
├── gates/                          # 各域 Gate 实现（重构为继承 AcceptanceGate）
│   ├── chat/
│   │   ├── desktop_dom_message_visible.py
│   │   ├── native_two_client_runner.py
│   │   ├── native_visible_e2e.py
│   │   ├── group_pressure_security.py
│   │   ├── private_pressure_security.py
│   │   ├── group_admin_e2e.py
│   │   └── ...
│   ├── dashboard/
│   │   ├── federation_visible_surface.py       # 重构使用 ChromeDriver
│   │   └── federation_operational_drilldown.py
│   ├── desktop/
│   │   └── gateway_smoke.py                    # 重构使用 StationDriver + ChromeDriver
│   ├── federation/
│   │   ├── mutual_validation.py
│   │   └── surface_smoke.py
│   └── applet/                       # [NEW Phase 3] Applet MJS wrapper gates
│       ├── __init__.py
│       ├── lifecycle_smoothness.py
│       └── ...
├── capabilities/                   # 保持不变：能力定义 YAML
│   ├── core.yaml
│   ├── chat.yaml
│   ├── federation.yaml
│   ├── station-dashboard.yaml
│   └── applet.yaml
├── domains/                        # 保持不变：域 profile YAML
│   ├── index.yaml
│   ├── chat.yaml
│   ├── federation.yaml
│   ├── station-dashboard.yaml
│   └── applet.yaml
├── features/                       # 保持不变：feature contract YAML
│   └── *.yaml
├── templates/                      # 保持不变：onboarding 模板
│   ├── domain.yaml
│   ├── capability.yaml
│   └── feature.yaml
├── plans/                          # 保持不变：plan JSON
├── playbooks/                      # 保持不变：操作手册
├── evidence/                       # 保持不变：历史证据存档
├── tests/
│   └── fixtures/                   # reviewed deterministic fixtures only
├── gates.yaml                      # 保持不变：Gate catalog
├── registry.yaml                   # 保持不变：路径影响映射
├── desktop-performance-cohort.json # 保持不变：性能测试 cohort
└── README.md                       # 更新文档
```

## 文件职责

| 路径 | 职责 |
|------|------|
| `core/gate.py` | AcceptanceGate 抽象基类，统一 execute() 入口、异常捕获、自动证据保存、报告输出 |
| `core/evidence.py` | Evidence Schema 定义、证据文件路径管理、JSON 报告写入 |
| `core/evidence_store.py` | 解析artifact root、分配run、验证ArtifactRef、atomic write/latest、active lock与cleanup |
| `core/errors.py` | GateError 统一异常，其他通用异常类型 |
| `core/redaction.py` | 敏感字段、Bearer token、private key 和文本证据统一脱敏 |
| `core/harness.py` | async_harness 通用 JS 桥接，支持命名空间调用 |
| `core/provisioning.py` | 定义 EnvironmentProvisioner 生命周期、typed service topology、Runtime Resource Manifest、blocked artifact 和 cleanup result |
| `core/provisioner.py` | 解析并验证 worktree Profile、管理 Provisioner 状态和 reverse-order cleanup |
| `core/attestation.py` | 从 live Station 和 deployment worktree 生产 commit/workspace/proto attestation |
| `core/drivers/base.py` | BaseDriver 定义生命周期；DomDriver 定义 DOM/JS/截图能力 |
| `core/fixtures/base.py` | BaseFixture 抽象基类，定义 setup/teardown/reset 接口 |
| `drivers/tauri.py` | macOS Tauri 原生应用驱动，embedded WebDriver 连接，进程/端口/storage 隔离 |
| `drivers/chrome.py` | Selenium Chrome/Chromium headless 驱动，支持 CDP command bridge；Dashboard 消费迁移由 WS5 完成 |
| `drivers/station.py` | Station HTTP API 客户端，封装网关命令、认证、错误处理 |
| `drivers/mobile.py` | Android/iOS Tauri Mobile 驱动（Phase 4 实现） |
| `environments/*.yaml` | 把 Gate environment id 映射为 Profile、service、Fixture、credential reference、attestation 和 cleanup contract |
| `provisioners/*.py` | 执行环境 contract，生成 runtime manifest；不得定义或修改 Gate 产品成功条件 |
| `fixtures/chat_native_actors.py` | 发现/准备测试账号并产出 role、account reference、canonical PTID，不写入凭据值 |
| `gates/<domain>/*.py` | 各域验收场景实现，继承 AcceptanceGate，只包含业务编排逻辑 |

## 依赖关系

```
core/gate.py → core/evidence.py → core/errors.py
core/evidence.py → core/evidence_store.py → core/errors.py + core/redaction.py
core/provisioning.py → core/errors.py + core/redaction.py
core/provisioner.py → core/provisioning.py
core/attestation.py → core/provisioning.py
core/harness.py → core/drivers/base.py
core/drivers/base.py → core/errors.py
core/fixtures/base.py → core/errors.py
drivers/tauri.py → core/drivers/base.py
drivers/chrome.py → core/drivers/base.py
drivers/station.py → core/drivers/base.py
provisioners/*.py → core/provisioning.py + drivers/* + fixtures/*
gates/**/*.py → core/gate.py + 具体 Driver + core/harness.py
fixtures/*.py → core/fixtures/base.py
```

禁止的依赖方向：
- core/ 下的任何模块不得导入 gates/、drivers/（具体实现）或 fixtures/
- drivers/ 不得导入 gates/ 或 fixtures/
- gates/ 之间不得互相导入（场景独立）
- gates/ 不得导入 `.local` Profile 或 deployment 实现
- fixtures/ 不得调用 Gate 或修改 Gate 成功条件
- provisioners/ 不得包含产品断言、DOM selector 或消息内容判断
- attestation 不得由消费它的 Gate 或 validator 生产
- Runtime Manifest 只允许 `services[service-id]` 表达服务拓扑；禁止 singular
  `station`、dual-write 和按 map 顺序推断 primary service
- `core/_paths.py`不得定义runtime report/evidence/manifest目录
- 除`core/evidence_store.py`外不得解析`PT_ACCEPTANCE_ARTIFACT_ROOT`或platform default
- runtime writers不得写repository、`tooling/`、`docs/`或`.git/`
- readers不得通过字符串拼接解析ArtifactRef
- cleanup不得删除active run或latest target

## Repository 外 Runtime Layout

该layout不是source module tree，不得在repository中创建：

```text
<artifact-root>/
└── <workspace-id>/
    └── <gate-id>/
        ├── latest.json
        ├── .publish.lock
        └── <run-id>/
            ├── .active.lock
            ├── manifest.json
            ├── reports/
            ├── evidence/
            ├── logs/
            └── runtime/
```

# Acceptance Framework — 模块目录结构

> **Status**: active
> **Version**: v2.0
> **Created**: 2026-08-15 | **Updated**: 2026-08-16
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 目标目录树

```
tooling/acceptance/
├── core/                           # [NEW] 通用核心抽象（domain-neutral）
│   ├── __init__.py
│   ├── gate.py                     # AcceptanceGate 基类
│   ├── evidence.py                 # Evidence Schema + 报告工具
│   ├── errors.py                   # GateError 统一异常
│   ├── redaction.py                # 结构化报告和文本证据统一脱敏
│   ├── harness.py                  # 通用 JS harness 桥接 helper
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
│   └── chat_native_reset.py        # Chat 环境重置（保持，待重构继承 BaseFixture）
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
├── reports/                        # 保持不变：运行报告输出（gitignored）
│   └── evidence/                   # 证据文件（截图/DOM/log）
├── evidence/                       # 保持不变：历史证据存档
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
| `core/errors.py` | GateError 统一异常，其他通用异常类型 |
| `core/redaction.py` | 敏感字段、Bearer token、private key 和文本证据统一脱敏 |
| `core/harness.py` | async_harness 通用 JS 桥接，支持命名空间调用 |
| `core/drivers/base.py` | BaseDriver 定义生命周期；DomDriver 定义 DOM/JS/截图能力 |
| `core/fixtures/base.py` | BaseFixture 抽象基类，定义 setup/teardown/reset 接口 |
| `drivers/tauri.py` | macOS Tauri 原生应用驱动，embedded WebDriver 连接，进程/端口/storage 隔离 |
| `drivers/chrome.py` | Selenium Chrome/Chromium headless 驱动，支持 CDP command bridge；Dashboard 消费迁移由 WS5 完成 |
| `drivers/station.py` | Station HTTP API 客户端，封装网关命令、认证、错误处理 |
| `drivers/mobile.py` | Android/iOS Tauri Mobile 驱动（Phase 4 实现） |
| `gates/<domain>/*.py` | 各域验收场景实现，继承 AcceptanceGate，只包含业务编排逻辑 |

## 依赖关系

```
core/gate.py → core/evidence.py → core/errors.py
core/harness.py → core/drivers/base.py
core/drivers/base.py → core/errors.py
core/fixtures/base.py → core/errors.py
drivers/tauri.py → core/drivers/base.py
drivers/chrome.py → core/drivers/base.py
drivers/station.py → core/drivers/base.py
gates/**/*.py → core/gate.py + 具体 Driver + core/harness.py
fixtures/*.py → core/fixtures/base.py
```

禁止的依赖方向：
- core/ 下的任何模块不得导入 gates/、drivers/（具体实现）或 fixtures/
- drivers/ 不得导入 gates/ 或 fixtures/
- gates/ 之间不得互相导入（场景独立）

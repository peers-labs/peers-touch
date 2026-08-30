# Mobile Native OAuth Proof

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-29 | **Updated**: 2026-08-29
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/`, `apps/station/app/subserver/oauth/`, `tooling/acceptance/`

---

## 1. Document Scope

本文档集定义 W2-E2 physical OAuth proof 缺失的四项架构契约：

1. 负向 OAuth Fixture 的可信权限、生命周期和允许操作；
2. Station-owned OAuth attempt/session 权威 readback；
3. physical client 的 provider account 与 browser session lease；
4. 安装到物理设备上的 Mobile Acceptance build provenance。

本文档集不定义：

- OAuth、Access Gate 或 session 的产品语义；继续由 Mobile 和 Access Gate
  上游架构定义；
- Appium、XCUITest、UiAutomator2 的版本选择；
- W2-E2 实施顺序或任务拆分；
- 真实 provider 账号、设备标识、凭据值或部署地址；
- simulator evidence 到 physical proof 的降级或替代关系。

## 2. Background

W2-E1 已证明 iOS Simulator 与 Android Emulator 的 Tauri App、native callback、
WebView Harness、restart、fail-closed 和 cleanup 路径。W2-E2 仍不能执行完整
MS-AG03，因为当前实现只声明 browser ownership、只验证外部 app artifact 路径存在，
只读取 Mobile projection，并将十个负向 physical cells 标记为 `UNSUPPORTED`。

这些缺口不是 Gate 脚本细节。它们涉及谁可以构造负向业务前置状态、谁能证明
Station 持久化结果、provider browser 状态如何隔离，以及运行中的 app 如何绑定
到当前源码，因此必须先形成架构契约。

## 3. Design Goals

1. Fixture 只能准备前置状态，不能写入成功结果或绕过产品状态机。
2. Station proof 必须来自 Station deployment/runtime owner，而不是 Mobile
   projection 或 Gate 自证。
3. Provider account 与 browser profile 必须具有 run-exclusive lease、身份核验、
   串行化和 quarantine 语义。
4. 每个 physical client 必须证明正在运行的 app 与当前 source snapshot、构建输入
   和已检查 artifact 完全一致。
5. 任一契约缺失、身份不匹配或 cleanup 失败时，MS-AG03 保持 `UNPROVEN`。

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [design.md](./design.md) | 四项契约的 ownership、边界、数据流和 failure semantics |
| [decisions.md](./decisions.md) | Accepted MOP-D01..MOP-D04 and MOP-D03-A/MOP-D04-A decisions |
| [data-model.md](./data-model.md) | Fixture lease、proof snapshot、browser lease 和 build attestation schema |
| [integration.md](./integration.md) | 与现有 Mobile、Station 和 Acceptance 资产的映射 |
| [module-layout.md](./module-layout.md) | Build、lease、Provisioner、Harness 与 Gate 的目标所有权边界 |

## 5. Upstream Sources

- `docs/architecture/mobile/design.md` §7 OAuth contract。
- `docs/architecture/mobile/decisions.md` MS-D12..MS-D14。
- `docs/architecture/mobile/acceptance-matrix.md` MS-PA03、MS-PA17、
  MS-PA25、MS-AG03。
- `docs/architecture/access-gates/station-access-gate-architecture.md`。
- `docs/architecture/acceptance-framework/` 的 Provisioner、Fixture、
  RuntimeManifest 和 Evidence Store contracts。

## 6. Status

MOP-D01..MOP-D04 and this architecture module were accepted by the Owner on
2026-08-29. MOP-D03-A and MOP-D04-A passed independent review with no P0/P1 and
were accepted on 2026-08-29. E2-0A froze the amended contracts, and W2-E2-B
completed the E2-1 build-provenance and E2-3 resource-lease source closures.
W2-E2-D / E2-5 is dependency-ready but not started. MS-AG03 and W2 readiness
remain blocked/unproven until physical evidence passes.

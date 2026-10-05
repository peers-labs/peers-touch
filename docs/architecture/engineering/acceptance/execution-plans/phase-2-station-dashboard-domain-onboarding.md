# Phase 2: Station Dashboard Managed Domain Onboarding

> **Status**: implemented
> **Version**: v1.0
> **Created**: 2026-06-04 | **Updated**: 2026-06-04
> **Owner**: Architecture Team
> **Module**: `tooling/acceptance/`

---

## 目标

本阶段把 `station-dashboard` 接入项目级 Acceptance Framework，证明 acceptance 不再只服务 Federation。

目标边界：

- `station-dashboard` 是 managed domain，不承担框架自证职责。
- Federation 继续是 project validation domain，用于证明 acceptance 可处理复杂跨运行时产品域。
- Dashboard 自身能力通过 feature contract、capability、registry、gate 和 report 管理。
- Dashboard 是 Station 管理面 projection，不成为业务事实源。

---

## 交付物

| 交付物 | 路径 | 状态 |
|--------|------|------|
| Domain index entry | `tooling/acceptance/domains/index.yaml` | done |
| Domain profile | `tooling/acceptance/domains/station-dashboard.yaml` | done |
| Capability file | `tooling/acceptance/capabilities/station-dashboard.yaml` | done |
| Auth feature contract | `tooling/acceptance/features/station-dashboard-auth.yaml` | done |
| Operations feature contract | `tooling/acceptance/features/station-dashboard-operations.yaml` | done |
| Registry rules | `tooling/acceptance/registry.yaml` | done |
| Gate catalog entries | `tooling/acceptance/gates.yaml` | done |
| Make targets | `Makefile` | done |
| Architecture design update | `docs/architecture/engineering/acceptance/design.md` | done |
| Decision record | `docs/architecture/engineering/acceptance/decisions.md` | done |

---

## 验证标准

本阶段完成必须满足：

- `make acceptance-validate DOMAIN=station-dashboard` 通过，证明 profile / capability / feature / registry / gate 结构自洽。
- `make acceptance-validate` 通过，证明所有 active domains 可被项目级入口统一验证。
- `make acceptance-coverage-report` 能展示 `station-dashboard` 为 `managed_domain`。
- `make acceptance-plan` 在 Dashboard 相关路径变更时能选择 Station Dashboard gates。
- `make acceptance-station-dashboard-domain-validation` 可作为 evidence-proven 入口运行。

当前 stable gates：

- `station-dashboard-unit`：运行 Station Dashboard Go package tests。
- `station-dashboard-web-check`：运行 Station Dashboard web TypeScript checks。
- `station-dashboard-domain-validation`：要求 latest evidence 满足 domain profile。

---

## 依赖

本阶段依赖：

- `tooling/acceptance/domains/index.yaml` 已支持 active / candidate / planned 状态模型。
- `tooling/scripts/acceptance-validate.py` 已支持 project-level validation、single-domain validation 和 `--require-proven`。
- `tooling/scripts/acceptance-coverage-report.py` 已支持项目级 domain coverage report。
- Dashboard 后端已有 `station-dashboard-unit` gate。
- Dashboard web package 已有 `check` script。

---

## 未证明范围

本阶段不声明以下能力已完成：

- Dashboard 全站浏览器级 visible-surface gate。
- Dashboard 权限矩阵和细粒度角色验收。
- Dashboard 远程 fedp5 authenticated smoke，除 Federation page 既有 gates 外不扩大声明。
- Chat、Mobile、Applet 等其它产品域 onboarding。

---

## 下一步

下一阶段应选择一个更接近用户主路径的 domain，例如 `chat`，验证 acceptance 能管理 runtime freshness、realtime delivery、message persistence 和 Desktop visible surface。

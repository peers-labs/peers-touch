# Mobile Shell Architecture

> **Status**: active; iOS simulator-canonical Acceptance amendment accepted
> **Version**: v1.2
> **Created**: 2026-08-27 | **Updated**: 2026-09-21
> **Owner**: Mobile Architecture Team
> **Module**: `apps/mobile/`

---

## 1. Document Scope

本文档集定义：

- Mobile Shell 的产品合同、状态机和验收边界。
- Tauri v2 Mobile 下 Shell、导航、runtime projection、Rust capability
  kernel 与 native plugin 的职责关系。
- 原型到当前实现的 Gap、Proto 映射和集成影响面。

本文档集不定义：

- Station 子服务内部实现。
- Desktop 内核实现细节。
- 交付顺序；架构评审通过后才由 execution plan 定义。
- 原型样式源码；原型入口见 `prototype/README.md`。

## 2. Background

Mobile 已具备真实的 Station access gate、好友/群聊 runtime、E2EE、通知、
联系人和 Moments 发布能力，但顶层生命周期仍由 `App.tsx` effects 分散驱动，
runtime registry 仅是状态说明，Moments/Profile/Settings 与已确认原型仍有明显
产品闭环差距。该文档集定义目标边界，避免直接把原型组件复制进生产代码。

## 3. Design Goals

1. Shell 只负责可见生命周期和导航，不拥有业务 freshness。
2. Auth、session、command、social、group、moments 和 notification 各有唯一
   runtime owner，pre-session 与 post-session 生命周期不混用。
3. 所有跨端业务模型来自 `model/domain/`。
4. Station 切换、logout、revocation 和 resume 都具备原子 teardown/rebootstrap。
5. Mobile 使用移动端导航、BottomSheet、安全区和键盘合同。
6. 原型能力逐项映射为真实、可验证、无 mock 的产品闭环。

## 4. Document Navigation

| Document | Purpose |
|---|---|
| [product-definition.md](./product-definition.md) | Product promise and capability profile |
| [experience-contract.md](./experience-contract.md) | End-to-end journeys |
| [product-state-model.md](./product-state-model.md) | Visible product states and recovery |
| [product-feasibility.md](./product-feasibility.md) | Capability-by-capability feasibility closure |
| [acceptance-matrix.md](./acceptance-matrix.md) | Receiver-perspective acceptance |
| [design.md](./design.md) | Architecture boundaries and contracts |
| [decisions.md](./decisions.md) | ADR-lite decisions |
| [data-model.md](./data-model.md) | State and Proto mapping |
| [integration.md](./integration.md) | Initial implementation gap and target impact |
| [module-layout.md](./module-layout.md) | Target module ownership |
| [native-oauth-proof/README.md](./native-oauth-proof/README.md) | Optional W2-E2 physical OAuth diagnostics: Fixture, Station proof, browser lease, and build provenance |
| [mobile-acceptance-environment.md](./mobile-acceptance-environment.md) | Mobile acceptance environment contract: tiers, gate mapping, Station dependency, network model |
| [prototype/README.md](./prototype/README.md) | Confirmed prototype reference |
| [execution-plans/20260827-mobile-shell-implementation/plan.md](./execution-plans/20260827-mobile-shell-implementation/plan.md) | Dependency-ordered implementation and Acceptance plan |
| [execution-plans/20260829-mobile-native-oauth-proof.md](./execution-plans/20260829-mobile-native-oauth-proof.md) | Historical focused W2-E2 physical-diagnostics plan |
| [execution-plans/20261006-infra-chat-usability/plan.md](./execution-plans/20261006-infra-chat-usability/plan.md) | Focused Infra/Chat usability, mixed-client parity, and Session class takeover plan |

## 5. Upstream Sources

- `docs/global/architecture.md`: Client / Model / Station ownership.
- `docs/architecture/platform/client/frontend-runtime/`: shared runtime, admission and evidence.
- `docs/architecture/domains/social/runtime/`: social supervisor and projection domains.
- `docs/architecture/platform/station/access/`: Station-owned access chain.
- `docs/architecture/engineering/api-governance/proposals/20260918-conversation-member-authority.md`:
  accepted Conversation member administration and atomic owner transfer.
- `docs/architecture/domains/chat/lifecycle/`: cross-client Chat product composition.
- `docs/architecture/shared/notification/notification-architecture.md`: notification
  preferences, push-device registration, and APNs/FCM delivery ownership.
- `docs/architecture/shared/security/secure-content/`: private Social content and encrypted
  media ownership.
- `docs/architecture/domains/identity/unified-actor-system.md`: PTID boundary.
- `docs/architecture/platform/runtime/service-coordination.md`: signed Station identity handshake.
- `docs/client/mobile/`: lifecycle, native plugin and sync refinements.
- `docs/client/common/ui-identity/`: shared visual, state and component-tree rules.

## 6. Status

The PRODUCT contract, recovery/accessibility amendment, Prototype, and base
architecture were accepted by the Owner on 2026-08-27. The W2-E2 physical OAuth
diagnostic design, MOP-D01..MOP-D04 and focused execution plan were accepted on
2026-08-29. W2-E2-A through W2-E2-C and W2-E2-FREEZE are complete, covering
E2-0 through E2-4. D-19 Infra landed (PR #105) and E2-5 source-side closure is
complete (finalizer module, registry, baseline, capability YAML, gate catalog,
11 adversarial tests). MS-D26 now makes source-bound iOS Simulator evidence
canonical, using two isolated iOS clients where the Journey requires independent
sessions or actors. MS-D27 binds the current Mobile product proof to one
source-attested Station and defers cross-Station/Relay proof until the
Desktop/Mobile cross-Station plan. Android and E2-6 physical proof remain
optional diagnostics.

## 7. Accepted Owner-Contract Closure Amendment

The 2026-09-18 amendment closes the architecture prerequisites for the remaining
Mobile Shell work as one review unit. It covers:

- schema-bound generic Access Gate submission and Station-only finalization;
- canonical Conversation member administration and atomic ownership transfer;
- Social-owned directional block, unblock, blocked-list, and relationship
  projection semantics across Stations;
- Conversation-owned forward, retract, actor-local hide, and moderation-redact
  semantics with authoritative command readback;
- Social/Secure-Content-owned Moments policy explanations and encrypted media
  production;
- explicit Actor Profile, Notification, Social blocked-user, and device-setting
  ownership, with no additional account-preference owner in this release;
- Rust-owned authenticated business transport and native push, scheduled
  wakeup, and media-picker lifecycles;
- atomic deletion of the six remaining Mobile legacy callers and a
  repository-wide semantic reference audit.

The amendment preserves the accepted product scope `MS-C01..MS-C10` plus
degraded `MS-C14`. `MS-C11` WeChat OAuth, `MS-C12` voice/video calls, and
`MS-C13` Chat Docs remain excluded. Cross-client Chat scope does not implicitly
expand Mobile scope.

The Owner accepted `MS-D16..MS-D24` on 2026-09-18 and accepted `MS-D22A` on
2026-09-19. Those approvals authorize execution planning; they do not
authorize implementation. The Owner subsequently accepted `MS-D25` on
2026-09-19 to record the completed integration of typed Moments outcomes with
the Rust-owned media staging lifecycle; that decision does not promote
optional physical diagnostics. The
recovered Plan Package, immutable workspace binding, active-work registration,
and one Plan approval remain mandatory before a Development Session can select
the first current Task.

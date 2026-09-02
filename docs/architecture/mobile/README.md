# Mobile Shell Architecture

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-08-27 | **Updated**: 2026-08-30
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
| [native-oauth-proof/README.md](./native-oauth-proof/README.md) | W2-E2 physical OAuth Fixture, Station proof, browser lease and build provenance amendment |
| [prototype/README.md](./prototype/README.md) | Confirmed prototype reference |
| [execution-plans/20260827-mobile-shell-implementation.md](./execution-plans/20260827-mobile-shell-implementation.md) | Dependency-ordered implementation and Acceptance plan |
| [execution-plans/20260829-mobile-native-oauth-proof.md](./execution-plans/20260829-mobile-native-oauth-proof.md) | Focused W2-E2 implementation and physical-proof plan |

## 5. Upstream Sources

- `docs/global/architecture.md`: Client / Model / Station ownership.
- `docs/architecture/frontend-runtime/`: shared runtime, admission and evidence.
- `docs/architecture/social-runtime/`: social supervisor and projection domains.
- `docs/architecture/access-gates/`: Station-owned access chain.
- `docs/architecture/identity/unified-actor-system.md`: PTID boundary.
- `docs/architecture/service-coordination.md`: signed Station identity handshake.
- `docs/client/mobile/`: lifecycle, native plugin and sync refinements.
- `docs/client/common/ui-identity/`: shared visual, state and component-tree rules.

## 6. Status

The PRODUCT contract, recovery/accessibility amendment, Prototype, and base
architecture were accepted by the Owner on 2026-08-27. The W2-E2 physical OAuth
proof amendment, MOP-D01..MOP-D04 and focused execution plan were accepted on
2026-08-29. W2-E2-A, W2-E2-B, W2-E2-C and W2-E2-FREEZE are complete, covering
E2-0 through E2-4. MOP-D03-A/MOP-D04-A passed independent review with no P0/P1
and were accepted on 2026-08-29. D-19 architecture and its independently
reviewed Infra execution plan are accepted; Infra execution is active.
W2-E2-D / E2-5 remains blocked by D-19 Infra landing and the later reviewed
Mobile injection/remediation amendment. E2-6 remains `UNPROVEN` and must not
start before those source closures pass.

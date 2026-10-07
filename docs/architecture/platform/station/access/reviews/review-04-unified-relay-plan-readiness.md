# Review 04：统一 Relay/Station 接入计划完备性

> **Status**: conditionally-passed
> **Reviewed**: 2026-10-06
> **Scope**: Plan Version + Task Slices + Security + Acceptance
> **Reviewer Mode**: findings-first plan review

## Findings

| 严重度 | Finding | 处理 |
|---|---|---|
| P1 | 初版可能把“自动识别”扩张为 Relay 到 direct 的静默隐私降级 | V1 评审中固定为跨 DIRECT/RELAY 切换必须显式确认 |
| P1 | 客户端接入若早于 Relay 安全收口，会把现有透明代理暴露为产品面 | DAG 固定 role/security → enrollment → discovery → tunnel → clients |
| P1 | Station 与 Relay 身份、Access 与 transport 可能形成第二 authority | Task 按 owner 分层，Station binding 保持唯一客户端 owner |
| P2 | 私有连接材料缺少编码与泄漏约束 | 固定 `ptc1:`/fragment、digest 预登记、日志/analytics 脱敏 |
| P2 | `opaque stream` 未指定可交付 carrier，双端实现可能分叉 | 固定 WSS binary outer transport + TLS 1.3 inner transport |
| P2 | 初版 Desktop Cargo 命令包含多个 positional filter | 拆成三个可执行 `cargo test` 命令 |
| P2 | Shared Federation 只是 document collection，无法执行 module governance | 补齐 `module-layout.md` 并登记 `shared-federation` active module |
| P2 | 现有 profile 为 HTTP，不能直接产生生产 TLS proof | 写入 Execution Preconditions；外部 env 修改需 Owner 单独授权 |
| P2 | `sixwin` 只有 Windows host inventory，不是 Station/Relay deploy profile | V1 将其限定为 Windows Desktop runtime，后端继续使用 `one/two/three` |
| P2 | Relay 最小角色的 composition roots 未进入初版 scope | V1 纳入 app main、frame peer、native node 与唯一 role owner |

复审后 Plan 内无未解决 P0-P2。外部环境授权仍是进入 runtime 阶段前的硬条件。

## Verdict

`Conditionally approved`：Plan 可供 Owner 审批；未授权 mount 或 execution。

## Mechanical Review

- Plan ID：`SAL-RELAY-20261006`
- Version ID：`SAL-RELAY-20261006-v1`
- Digest：`85c08ac80ca202fdab85641d84f3bc1a4c818f51aad98c6b08f2b6875269b0a9`
- `make plan-validate`：PASS
- Architecture module governance：PASS
- `git diff --check`：PASS
- Task：7 个；DAG 无环；Desktop/Mobile 仅在共同 tunnel 后并行
- Plan 低于 300 行；Task 均低于 200 行
- `make plan-status`：`PLAN_MOUNT_REQUIRED`，符合“未挂载”预期

## Dependency Review

```text
minimal Relay role
  -> Station PoP enrollment
  -> signed endpoint discovery
  -> opaque tunnel + typed peer transport
      -> Desktop binding
      -> Mobile binding
          -> exact-source aggregate
```

- role/TLS/auth 是所有公网能力前置。
- route attestation 依赖 active mount generation。
- client adapters 不与尚未冻结的 tunnel wire 并行。
- Desktop/Mobile 写集独立，可在 Task 4 完成后并行。
- hard cut 与 aggregate 放在最后，避免双路径长期存在。

## Authorization Review

- Local checkpoint：allowed。
- Amend：denied。
- Push / PR / history rewrite：denied。
- Backend deploy profile：仅 `one/two/three`；Windows Desktop runtime：
  Owner 授权的 `sixwin` host。
- Destructive reset：无授权。
- 外部 `env` 仓库：不在 source claims；修改前必须取得显式 Owner 授权。

## Acceptance Review

每个功能 Task 同时包含 focused source/structural check、functional check 和
Acceptance proof。最终 aggregate 覆盖：

- Relay route allowlist、TLS、credential 与日志；
- invite race、PoP、rotate、revoke、reconnect；
- discovery public/private/forgery/replay；
- opaque plaintext inspection、SPKI、oversize、overload、cancel；
- Desktop installed 与 iOS Simulator；
- direct/relay 显式换路后的 scope continuity；
- cross-Station Chat/Social 代表性业务；
- 旧 forward/client-token/header passthrough 与 debug egress 归零。

## Remaining Preconditions

1. Owner 批准本 Plan Version 和目标 execution worktree。
2. Owner 明确授权使用 `one/two/three` profiles。
3. `sixwin` 只作为 Windows Desktop runtime，不伪造成 Station/Relay profile。
4. 若最终 remote TLS proof 需要修改 `env` 仓库，Owner 明确授权对应路径与环境。
5. mount 前再次验证 worktree identity、HEAD、Plan digest 和无冲突声明。

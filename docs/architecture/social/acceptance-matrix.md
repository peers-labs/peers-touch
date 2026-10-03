# Social Private Moments - Product Acceptance Matrix

> **Status**: active
> **Version**: v1.1
> **Created**: 2026-09-13 | **Updated**: 2026-09-24
> **Owner**: Social Product

---

## 1. Claim Boundary

`Social Private Moments secure` 只能由真实发布者、真实接收者、真实 Station/OSS 和
Native 设备上的当前 source-bound Journey 证明。以下证据不能单独建立该结论：

- 单元测试、静态扫描、typecheck 或 build。
- 只检查数据库中“看起来像密文”。
- 只请求 API 而没有接收端明文和未授权端拒绝证据。
- Browser、mock、截图或手写 attestation。
- Chat 的既有 E2EE 证明。

## 2. Required Runtime Cells

| Cell | Actors | Runtime | Claim |
|---|---|---|---|
| `SOC-SEC-RC01` | Alice/Bob/Eve | two Native Desktop clients + real Station/OSS | same-Station private publish/read/deny |
| `SOC-SEC-RC02` | Alice/Bob/Eve | Native Mobile sender/receiver + real Station/OSS | Mobile semantic parity |
| `SOC-SEC-RC03` | Bob/Bob2 | Native restart and trusted recovery | device recovery and revocation |
| `SOC-SEC-RC04` | Anonymous/Eve/Bob | direct HTTP/object requests | authentication, IDOR and metadata minimization |
| `SOC-SEC-RC05` | Alice/Anonymous | Native publisher + Browser/HTTP public reader | public continuity |
| `SOC-SEC-RC06` | Alice/Remote recipient | Native publisher on `four` + real Actor identity on `fiveArm` | unsupported cross-Station private audience fails before durable admission |

Cross-Station private sharing has no positive delivery cell in this version
because `SOC-SEC-C09` is deferred. `SOC-SEC-RC06` proves only the fail-closed
boundary; it does not claim cross-Station private delivery support.

## 3. Acceptance Scenarios

| ID | Journey | User action and observable result | Durable/security readback | Required cell |
|---|---|---|---|---|
| `SOC-SEC-AS01` | `SOC-SEC-J01` | Alice selects `FRIENDS`, publishes text + image, then sees the exact content | Station DB/log scan contains no private plaintext or inline content key | `RC01` |
| `SOC-SEC-AS02` | `SOC-SEC-J02` | Bob opens the Moment from HOME and direct link, restarts, and reads identical plaintext/media | Current actor/device envelope and ciphertext identity match; Alice need not be online | `RC01` |
| `SOC-SEC-AS03` | `SOC-SEC-J03` | Eve and Anonymous use real Post/Comment/Object IDs and receive no private content | Responses contain no body, media bytes, recipient PTIDs, device IDs or encrypted keys | `RC04` |
| `SOC-SEC-AS04` | `SOC-SEC-J03` | Expired or malformed Bearer request receives typed authentication failure | Handler does not execute as authenticated or silently retry anonymous | `RC04` |
| `SOC-SEC-AS05` | `SOC-SEC-J04` | Eve follows Alice: FOLLOWERS is readable, FRIENDS is not; Bob as friend reads FRIENDS | Relationship and audience readback explain each decision | `RC01` |
| `SOC-SEC-AS06` | `SOC-SEC-J05` | Bob comments; Alice reads exact text; Eve cannot read parent or comment | Comment storage/logs contain no plaintext; parent authorization gates all reads | `RC01` |
| `SOC-SEC-AS07` | `SOC-SEC-J06` | Bob opens private image/video; Eve cannot fetch the same object | Object grant is actor/device/object-bound, expiring, and cannot be replayed for another object | `RC01`, `RC04` |
| `SOC-SEC-AS08` | `SOC-SEC-J07` | Bob never opens the Moment; Bob2 before recovery sees recovery-required, then uses the existing recovery phrase and reads the authorized history | Recovery uses the actor recovery envelope; revoked resources and devices receive no new material | `RC03` |
| `SOC-SEC-AS09` | `SOC-SEC-J08` | Alice deletes or blocks; Bob's new detail/media/recovery requests fail and ordinary cache clears | Station delivery/grant state is revoked; report does not claim malicious-copy deletion | `RC01`, `RC03` |
| `SOC-SEC-AS10` | `SOC-SEC-J09` | Anonymous reads Alice's explicit PUBLIC Moment after private hard cut | Public table and object path remain readable without private envelopes | `RC05` |
| `SOC-SEC-AS11` | `SOC-SEC-J01` | Browser attempts private publish/read and is rejected before any plaintext leaves the client | Network capture shows no private publish payload or public media fallback | `RC05` |
| `SOC-SEC-AS12` | `SOC-SEC-J01` | Alice publishes to a same-Station GROUP and `CUSTOM_DENY(FOLLOWERS)`, then attempts `CUSTOM_DENY(PUBLIC)`, an explicit fiveArm recipient, and a Group containing that recipient | Supported audiences reach intended readers; unsupported cases consume no Content PreKey and commit no partial Post, delivery, object grant or envelope; remote evidence binds the owner-issued handle, expected identity digest, fixture-manifest digest, and result | `RC01`, `RC06` |
| `SOC-SEC-AS13` | `SOC-SEC-J02` | Bob response is inspected with multiple recipients/devices in the audience | Only Bob's eligible device envelope is present; author management data uses a separate path | `RC04` |
| `SOC-SEC-AS14` | all | Same journeys run on Mobile Native with equivalent visible outcomes | Proto identities and Station authorization decisions match Desktop | `RC02` |
| `SOC-SEC-AS15` | `SOC-SEC-J01` | Alice selects an audience beyond the actor/slot policy | Publish is rejected before encryption with no truncated recipient set or committed object | `RC01` |
| `SOC-SEC-AS16` | `SOC-SEC-J05` | Bob prepares two comments for overlapping recipients | Plans expose different one-time public keys/slot IDs and no stable recipient/device identifier | `RC04` |

## 4. Failure And Recovery Coverage

| Failure | Expected product behavior | Prohibited substitute |
|---|---|---|
| recipient key unavailable | preserve draft, name unavailable recipient, allow explicit retry/removal | silently omit recipient |
| Station unavailable before durable admission | preserve draft and audience | change to PUBLIC |
| Station unavailable after durable admission | show pending/retrying from durable identity | create duplicate Post |
| expired/revoked token | re-authentication state | anonymous downgrade |
| object grant denied/expired | media access denied with bounded retry | public ciphertext URL |
| ciphertext/hash/AEAD failure | integrity failure, zero partial plaintext | best-effort render |
| new device lacks history key | recovery-required | permanent empty state |
| relationship revoked | future access denied and ordinary cache cleared | claim remote deletion of saved copies |
| cross-Station private unsupported | reject before publish | partial delivery or trusted-Station plaintext |
| private comment/envelope rate exceeded | preserve comment draft and return typed retry-after | unbounded admission or silent drop |

## 5. Capability Traceability

| Capability | Journeys | Acceptance |
|---|---|---|
| `SOC-SEC-C01` | `SOC-SEC-J01`, `SOC-SEC-J04` | `SOC-SEC-AS01`, `SOC-SEC-AS05`, `SOC-SEC-AS12`, `SOC-SEC-AS15` |
| `SOC-SEC-C02` | `SOC-SEC-J01`, `SOC-SEC-J02`, `SOC-SEC-J05`, `SOC-SEC-J06` | `SOC-SEC-AS01`, `SOC-SEC-AS02`, `SOC-SEC-AS06`, `SOC-SEC-AS07` |
| `SOC-SEC-C03` | `SOC-SEC-J02`, `SOC-SEC-J03`, `SOC-SEC-J05`, `SOC-SEC-J06`, `SOC-SEC-J08` | `SOC-SEC-AS03`, `SOC-SEC-AS04`, `SOC-SEC-AS06`, `SOC-SEC-AS07`, `SOC-SEC-AS09` |
| `SOC-SEC-C04` | `SOC-SEC-J01`, `SOC-SEC-J02`, `SOC-SEC-J06`, `SOC-SEC-J07` | `SOC-SEC-AS02`, `SOC-SEC-AS07`, `SOC-SEC-AS08` |
| `SOC-SEC-C05` | `SOC-SEC-J02`, `SOC-SEC-J03`, `SOC-SEC-J05` | `SOC-SEC-AS03`, `SOC-SEC-AS13`, `SOC-SEC-AS16` |
| `SOC-SEC-C06` | `SOC-SEC-J07`, `SOC-SEC-J08` | `SOC-SEC-AS08`, `SOC-SEC-AS09` |
| `SOC-SEC-C07` | `SOC-SEC-J09` | `SOC-SEC-AS10` |
| `SOC-SEC-C08` | all supported journeys | `SOC-SEC-AS11`, `SOC-SEC-AS14` |
| `SOC-SEC-C09` | `SOC-SEC-J01` unsupported boundary | `SOC-SEC-AS12` |

## 6. Evidence Requirements

Each scenario records:

- exact Git checkpoint and clean source identity;
- sender, receiver, device and Station identities without credential values;
- owner-issued fixture handles with expected identity digest, fixture-manifest
  digest, and result binding for every remote-identity assertion;
- product action trace and receiver-visible result;
- Station authorization/storage and OSS grant/object readback;
- Key Exchange readback proving unsupported remote and
  `CUSTOM_DENY(PUBLIC)` attempts consumed no Content PreKey;
- cleanup result for clients, grants, temporary files and runtime leases;
- explicit `UNPROVEN` status for unrun Desktop, Mobile, recovery or negative cells.

Security completion additionally requires a negative corpus covering:

- anonymous, malformed token, expired token and revoked session;
- non-follower, follower-only, non-friend, blocked, wrong Circle and wrong Group;
- wrong actor, wrong device, wrong object and expired media grant;
- envelope substitution, ciphertext mutation and response metadata enumeration.

## 7. Product Gate Status

Current status: `PRODUCT_READY_FOR_ARCHITECTURE`.

Owner advanced the work to DESIGN on 2026-09-13. Runtime evidence remains
`UNPROVEN`; product acceptance authorizes architecture work, not readiness claims.

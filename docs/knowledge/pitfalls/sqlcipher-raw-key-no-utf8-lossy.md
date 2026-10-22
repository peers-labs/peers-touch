---
status: active
created: 2026-10-22
owns: apps/desktop/src-tauri/src/infrastructure/storage
applies: desktop
tags: [security, storage, sqlcipher, encryption]
---

# SQLCipher 密钥必须按原始字节传入，禁止 UTF-8 lossy 转换

## 现象

Desktop 本地 SQLite 用 SQLCipher 整库加密，密钥是 Keychain 中由 `OsRng`
生成的 32 随机字节。曾经的实现把随机字节经过
`String::from_utf8_lossy(...).into_bytes()` 再交给 `sqlite3_key_v2`。

随机字节几乎必然不是合法 UTF-8，lossy 转换会把每个非法子序列替换成同一个
`EF BF BD`，在进入 SQLCipher KDF 前折叠口令熵，低于设计声称的 256-bit。
这与"使用显式长度 FFI 调用"的注释自相矛盾——FFI 本来就该直接接收裸字节。

## 规则

- `sqlite3_key_v2` / `sqlite3_rekey_v2` 一律传入 `KeyMaterial.key_bytes`
  的原始切片与真实长度，不做任何字符串转换（`infrastructure/storage`
  的 `apply_sqlcipher_passphrase`）。
- 新增任何打开/轮换本地库的路径，都复用该函数，不允许再构造
  `from_utf8_lossy` 口令。
- 修复前创建的库用旧 lossy 口令加密。`open_database` 对原始口令验证失败
  的非空库执行一次性迁移：用 legacy lossy 口令打开 → rekey 为原始字节 →
  验证。迁移不是长期双 owner，迁移后旧口令必须失效（有测试锁定）。
- rekey 后关闭原连接，用独立连接仅凭原始字节重新打开并验证，同时验证
  旧口令失效。当前 bundled SQLCipher 在竞争写事务导致 rollback 时仍可能
  返回 SQLITE_OK；原连接用旧 read-key 读 `sqlite_master` 成功不能证明迁移
  已提交。验证失败必须关闭连接，不得继续写 metadata。

## 影响

- 威胁模型是"Station/网络拿不到明文，本机 SQLCipher 外壳 + OS 密钥库兜底"；
  密钥卫生是该边界的基础，不能在 FFI 边界折叠熵。
- Search D 区全文索引是加密库内的明文列，同样依赖此密钥不被弱化。

## 验证

`cargo test infrastructure::storage`：
`raw_non_utf8_key_preserves_entropy_and_opens_database`、
`legacy_lossy_database_is_opened_and_rekeyed_to_raw_bytes`。
竞争写事务回归由
`search_key_migration_rejects_a_rolled_back_rekey_with_competing_writer` 验证：
失败不报告迁移成功，原文保留，解除锁后可重新迁移。

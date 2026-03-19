# Crypto Module

加密和签名工具模块，提供 RSA 密钥管理和数据加密功能。

## 功能

### 1. RSA 密钥对生成

每个 Actor 注册时自动生成 RSA 密钥对（2048 位）：

```go
publicKey, privateKey, err := crypto.GenerateRSAKeyPair(2048)
```

密钥存储在 `touch_actor` 表中：
- `public_key`: PEM 格式的公钥
- `private_key`: PEM 格式的私钥

### 2. 数字签名

用于验证消息来源和完整性：

```go
// 签名
signature, err := crypto.SignData(data, privateKeyPEM)

// 验证
err := crypto.VerifySignature(data, signature, publicKeyPEM)
```

**应用场景**：
- Actor 发布内容时签名，证明内容来自该 Actor
- 跨节点通信时验证消息来源
- API 请求签名验证

### 3. 数据加密

用于端到端加密通信：

```go
// 加密（使用接收方公钥）
encrypted, err := crypto.EncryptData(data, recipientPublicKey)

// 解密（使用自己的私钥）
decrypted, err := crypto.DecryptData(encrypted, myPrivateKey)
```

**应用场景**：
- 私密消息加密
- 敏感数据传输
- 端到端加密聊天

## 设计原则

1. **去中心化身份验证**：每个 Actor 拥有自己的密钥对，无需中心化 CA
2. **端到端加密**：消息在客户端加密，服务器无法解密
3. **可验证性**：所有签名都可以通过公钥验证
4. **兼容性**：使用标准的 RSA + SHA256 算法

## 与 ActivityPub 的关系

虽然我们不再使用 ActivityPub 协议，但保留了其优秀的密钥管理机制：

- ✅ 每个 Actor 独立的密钥对
- ✅ 公钥可公开分享
- ✅ 私钥安全存储
- ❌ 不使用 HTTP Signature 认证（改用 JWT）
- ❌ 不使用 ActivityPub 的 JSON-LD 格式

## 安全建议

1. **私钥保护**：私钥永远不应该离开服务器
2. **密钥轮换**：定期更新密钥对（TODO）
3. **密钥长度**：使用 2048 位或更高
4. **传输安全**：始终使用 HTTPS 传输公钥

## 未来扩展

- [ ] 支持密钥轮换
- [ ] 支持多设备密钥管理
- [ ] 支持密钥恢复机制
- [ ] 支持更强的加密算法（如 RSA 4096）

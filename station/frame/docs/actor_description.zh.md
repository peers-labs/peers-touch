# ActivityPub User Actor 字段定义方案

本文档描述了 Peers-Touch 网络中 User 类型的 Actor 在 ActivityPub 协议下的字段定义，以及在 Profile 页面的展示与修改策略。

## 1. 字段总览

结合 ActivityPub 标准与 Peers-Touch 网络特性，Actor 对象包含以下字段：

| 字段名 (JSON-LD) | 类型 | 说明 | 来源/标准 | 是否必填 | 可变性 (Mutability) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `id` | URI | Actor 的全局唯一标识符 (IRI) | ActivityPub | 是 | **不可变** (Immutable) |
| `type` | String | Actor 类型，固定为 `Person` | ActivityPub | 是 | **不可变** |
| `preferredUsername` | String | 用户名/短名 (用于 @提及) | ActivityPub | 是 | **不可变** (通常) |
| `name` | String | 显示名称 (Display Name) | ActivityPub | 否 | **可修改** (Editable) |
| `summary` | String | 个人简介/Bio | ActivityPub | 否 | **可修改** |
| `icon` | Image/Link | 头像 (Avatar) | ActivityPub | 否 | **可修改** |
| `image` | Image/Link | 背景图 (Header) | ActivityPub | 否 | **可修改** |
| `inbox` | URI | 收件箱地址 | ActivityPub | 是 | **不可变** |
| `outbox` | URI | 发件箱地址 | ActivityPub | 是 | **不可变** |
| `followers` | URI | 粉丝列表地址 | ActivityPub | 否 | **不可变** |
| `following` | URI | 关注列表地址 | ActivityPub | 否 | **不可变** |
| `liked` | URI | 喜欢列表地址 | ActivityPub | 否 | **不可变** |
| `publicKey` | Object | 用于 HTTP 签名的公钥信息 | ActivityPub | 是 | **系统管理** (System Managed) |
| `endpoints` | Object | 其他端点 (如 sharedInbox) | ActivityPub | 否 | **不可变** |
| `ptid` | String | Peers-Touch ID (P2P 网络身份 ID) | **Peers-Touch 扩展** | 是 | **不可变** |
| `namespace` | String | 命名空间 (默认为 'peers') | **Peers-Touch 扩展** | 是 | **不可变** |
| `libp2pPublicKeys` | Array | Libp2p 协议使用的公钥列表 | **Peers-Touch 扩展** | 否 | **系统管理** |

---

## 2. Profile 编辑/展示 策略

### 2.1 用户可修改字段 (Editable)

用户在 Profile 编辑页面可以修改以下字段：

*   **`name` (显示名称)**:
    *   **说明**: 用户的昵称，可包含 UTF-8 字符。
    *   **限制**: 建议长度限制 100 字符。
*   **`summary` (个人简介)**:
    *   **说明**: 用户的自我介绍，支持纯文本。
    *   **限制**: 建议长度限制 500 字符。
*   **`icon` (头像)**:
    *   **说明**: 用户上传的头像图片。
    *   **操作**: 上传新图片后生成 URL 更新此字段。
*   **`image` (背景图)**:
    *   **说明**: 用户个人主页的背景/Banner 图片。
    *   **操作**: 上传新图片后生成 URL 更新此字段。

### 2.2 只读展示字段 (Read-Only Display)

以下字段在 Profile 页面主要用于展示或系统内部使用，用户不可直接编辑：

*   **`preferredUsername` (用户名)**:
    *   **说明**: 注册时确定的唯一标识符。
    *   **策略**: 通常注册后不可更改，或需要特殊流程更改。
*   **`id` (Actor IRI)**:
    *   **说明**: 系统生成的唯一 URI (如 `https://domain/users/alice`)。
    *   **策略**: 绝对不可更改。
*   **`ptid` (Peers-Touch ID)**:
    *   **说明**: 底层 P2P 网络的节点/身份 ID。
    *   **策略**: 系统生成，绑定身份，不可更改。
*   **`publicKey`**:
    *   **说明**: 系统管理的加密密钥。
    *   **策略**: 用户不可见/不可改，由系统自动管理。

### 2.3 扩展字段说明 (Peers-Touch Specific)

*   **`ptid`**:
    *   用于在 Peers-Touch 的 P2P 网络层（基于 libp2p）中寻址和验证身份。ActivityPub 的 HTTP 交互可以使用此 ID 进行跨协议的身份关联。
    *   在 JSON-LD 中建议定义 Context 扩展，例如 `https://peers.touch/ns#ptid`。
*   **`namespace`**:
    *   用于支持多租户或不同的网络分区。默认用户在 `peers` 命名空间下。

---

## 3. JSON-LD 示例

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    {
      "ptid": "https://peers.touch/ns#ptid",
      "namespace": "https://peers.touch/ns#namespace"
    }
  ],
  "id": "https://social.example.com/users/alice",
  "type": "Person",
  "preferredUsername": "alice",
  "name": "Alice Wonderland",
  "summary": "Just a decentralized dreamer.",
  "icon": {
    "type": "Image",
    "mediaType": "image/jpeg",
    "url": "https://social.example.com/uploads/avatar/alice.jpg"
  },
  "image": {
    "type": "Image",
    "mediaType": "image/png",
    "url": "https://social.example.com/uploads/header/alice.png"
  },
  "ptid": "QmXOy...", 
  "namespace": "peers",
  "inbox": "https://social.example.com/users/alice/inbox",
  "outbox": "https://social.example.com/users/alice/outbox",
  "publicKey": {
    "id": "https://social.example.com/users/alice#main-key",
    "owner": "https://social.example.com/users/alice",
    "publicKeyPem": "-----BEGIN PUBLIC KEY...END PUBLIC KEY-----"
  }
}
```

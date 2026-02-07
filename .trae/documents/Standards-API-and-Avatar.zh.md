# 接口与 Avatar 标准说明

## 1. 接口协议：Proto 为默认，禁止 JSON 除非例外

- **第一等级标准**：Station 与 Desktop 之间所有接口**默认使用 Proto**（`Content-Type: application/protobuf`），请求/响应体为 proto 定义并生成的模型。
- **禁止**在 Station 与 Desktop 间新增或保留 JSON 接口，除非**非用不可的例外**；例外需在文档中标注，并计划迁移到 Proto。
- 实现时：Handler 用 proto 解码请求、编码响应；Client 用 HttpService 发 proto 请求、解析 proto 响应。

### 已知 JSON 例外（待迁移 Proto）

- **POST /friend-chat/message/sync**：当前为 JSON 请求/响应，应迁移为 Proto（在 `model/domain/chat/friend_chat.proto` 或相关 proto 中定义 SyncMessagesRequest/SyncMessagesResponse，Station 与 Client 改为 proto 编解码）。

---

## 2. Avatar：只用 Avatar 组件，传 uid 即可

- 域内**统一使用 Avatar 组件**，调用时只传 **uid（actorId）** 和 fallbackName，**不传 avatarUrl**。
- 头像由**组件内部或域内统一解析**（如通过注册的 AvatarResolver、用户/演员服务），业务层不传递、不缓存 avatarUrl，避免到处接 URL 的“麻烦”。
- 正确用法示例：`Avatar(actorId: user.id, fallbackName: user.displayName)`，不写 `avatarUrl: ...`。

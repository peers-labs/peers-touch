# 应用存储设计（Desktop 与 Station 通用）

## 目标与原则
- 统一目录布局，支持 Desktop 与 Station 同机运行或独立部署
- 数据分层、权限隔离、便于备份与迁移
- 媒体文件可本地缓存，令牌与密钥不落盘于普通文件夹

## 基础路径
- Desktop（跨平台建议）：
  - macOS：`~/Library/Application Support/PeersTouchDesktop/`
  - Windows：`%APPDATA%\PeersTouchDesktop\`
  - Linux：`~/.local/share/PeersTouchDesktop/`
- Station（服务端）：
  - 使用框架 `appdir.Resolve("station","data")` 解析数据目录，默认：`<用户数据目录>/station/data/`
  - 如失败，后备：`/tmp/oss`（仅作为兜底，不建议生产）

## 目录结构
- Desktop
  - `users/<handle>/`
    - `media/`
      - `avatar/` 用户头像
      - `header/` 个人页头图
      - `attachments/` 发帖/聊天附件本地缓存
      - `cache/` 图片缩略图与临时下载（LRU）
    - `chat/`
      - `conversations/<peerId|roomId>/` 消息附件、本地草稿
    - `data/`
      - `profile.json` 用户资料快照（非权威）
      - `settings.json` 客户端设置
    - `logs/` 客户端日志
    - `temp/` 临时文件
  - 注意：`token/refreshToken` 使用系统安全存储（如 Keychain），不写入上述目录
- Station
  - `oss/` 媒体后端存储（本地 Backend）
    - `data/oss/` 实际文件存放（由 `storage.NewLocalBackend` 管理）
  - `db/` RDS/SQLite 数据库文件（按环境区分）
  - `actors/<handle>/` 业务侧为 Actor 的私有数据（可选）
  - `uploads/` 临时上传
  - `keys/` 服务端私钥等敏感文件（仅限最小权限）
  - `logs/` 服务端日志

## 媒体命名与路径映射
- 服务端 OSS 返回：`url: /sub-oss/file?key=YYYY/MM/DD/<random><ext>`
- 客户端本地缓存落地：
  - `users/<handle>/media/<category>/<random><ext>`
  - `<category>` 为 `avatar|header|attachments|cache`
- 随机名：长度 16 的随机字符串，保留服务端返回的扩展名

## 生命周期与配额（建议值）
- Desktop
  - `media/cache`：LRU 上限 512MB，超过则按访问时间清理
  - `attachments`：按会话/用户可配限额（如 2GB），支持手动清理
  - 定期校验远程 URL 可用性，失效时保留本地文件但标记为“离线”
- Station
  - OSS 文件受签名与 TTL 控制，过期策略由服务端配置
  - 日志与临时文件按滚动策略清理

## 权限与安全
- Desktop
  - macOS 需 Entitlements：`com.apple.security.files.user-selected.read-only` 与 `read-write`
  - 令牌、私密信息存储于 `flutter_secure_storage`，不写入工作目录
- Station
  - `keys/` 等敏感目录最小权限（0600/0700），不与媒体目录混放

## 同机运行建议
- Desktop 与 Station 可共享同一用户主目录，但分别使用 `PeersTouchDesktop` 与 `station/data` 的命名空间，避免互相污染
- 通过 URL（如 `/sub-oss/file?key=...`）与本地缓存映射连接，客户端不直接依赖服务端物理路径

## 示例
- 上传头像后：
  - 服务端：`/sub-oss/file?key=2025/12/24/ABCDEF1234567890.png`
  - 客户端缓存：`~/Library/Application Support/PeersTouchDesktop/<handle>/media/avatar/ABCDEF1234567890.png`

## 约定接口
- 上传：`POST /sub-oss/upload`（字段 `file`，JWT 鉴权）
- 获取元信息：`GET /sub-oss/meta?key=...`
- 文件读取：`GET /sub-oss/file?key=...`（可选签名）


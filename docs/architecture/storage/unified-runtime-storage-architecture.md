# Peers-Touch 统一运行时存储架构规范

## 1. 目标与边界

### 1.1 目标

- Desktop 与 Station 使用同一套存储语义与路径决议协议。
- 数据库、文件、日志、缓存均纳入统一存储框架，不再各模块自行定义落盘规则。
- 在不破坏现有能力的前提下，支持安全增强（加密、密钥轮换）、故障恢复、可观测性。

### 1.2 非目标

- 不定义业务领域模型细节。
- 不约束具体数据库引擎实现细节，但约束其接入方式与目录语义。

## 2. 统一协议

### 2.1 路径决议契约

- 输入：`appName + storageKind + segments`。
- 输出：绝对路径。
- 约束：
  - `appName` 仅允许：`desktop`、`station`。
  - `storageKind` 仅允许：`config`、`data`、`cache`、`logs`、`runtime`、`temp`。
  - 业务代码禁止手工拼接根路径，必须通过存储框架能力获取。

### 2.2 根路径契约

- 两端默认根必须来自平台目录规则。
- 统一根模型：
  - `<platformDataRoot>/peers-touch/<appName>/`

### 2.3 平台根目录规则

- macOS：
  - `<platformDataRoot> = ~/Library/Application Support`
- Windows：
  - `<platformDataRoot> = %LOCALAPPDATA%`
  - 若 `LOCALAPPDATA` 缺失，回退 `%USERPROFILE%/AppData/Local`
- Linux / 其他类 Unix：
  - 优先 `$XDG_DATA_HOME`
  - 回退 `~/.local/share`

## 3. 标准目录结构

```text
<platformDataRoot>/peers-touch/
  desktop/
    config/
    data/
      db/
      files/
    cache/
    logs/
    runtime/
    temp/
  station/
    config/
    data/
      db/
      files/
    cache/
    logs/
    runtime/
    temp/
```

## 4. 目录语义与可靠性等级

| 目录      | 语义                     | 生命周期 | 可靠性要求      | 加密要求      |
| ------- | ---------------------- | ---- | ---------- | --------- |
| config  | 配置与策略                  | 长周期  | 强一致        | 建议加密敏感字段  |
| data    | 核心业务状态与主数据             | 长周期  | 原子写 + 崩溃恢复 | 高敏感数据必须加密 |
| cache   | 可重建数据                  | 中周期  | 可丢弃        | 默认不强制     |
| logs    | 运行日志与审计                | 中周期  | 顺序写        | 严禁明文密钥    |
| runtime | 进程期状态（lock/socket/pid） | 进程周期 | 启停一致       | 不落敏感业务数据  |
| temp    | 临时文件                   | 短周期  | 可清理        | 到期可清除     |

### 4.1 存储 Scope 模型

- Scope 维度固定为四层：`app -> user -> device -> process`。
- 路径语义：
  - app scope：`<appName>/...`，用于区分 `desktop` 与 `station`。
  - user scope：`config/users/<userScope>/`、`data/users/<userScope>/`，用于同机多用户隔离。
  - device scope：默认由本机目录根天然隔离，不再单独加路径层。
  - process scope：仅允许存在于 `runtime/`，进程退出后可回收。
- `userScope` 生成规则：
  - 优先使用已登录会话的稳定用户标识（建议 `session.actor_id`）。
  - 未登录时统一回落 `__default__`。
  - 禁止直接使用可变显示名作为目录名，必须使用稳定 id 或其安全映射。

### 4.2 真源（Source-of-Truth）与同步边界

| 数据域           | 本地职责       | 真源            | 跨设备同步           | 说明                   |
| ------------- | ---------- | ------------- | --------------- | -------------------- |
| Provider 系统预设 | 只读缓存       | 安装包内置预设       | 否               | 由版本升级驱动变更，不允许用户覆盖原文件 |
| Provider 用户配置 | 读写覆盖       | 用户配置（本地）      | 是（后续接入 Station） | 采用“系统预设 + 用户覆盖”合并视图  |
| 用户偏好设置        | 快速读取与离线可用  | 用户配置（本地）      | 是               | 登录后可与远端合并，冲突按版本策略处理  |
| 聊天记录          | 高性能索引与离线访问 | Station（业务真源） | 是               | 本地是加速副本，需可重建与回放      |
| 缓存索引/派生数据     | 纯加速        | 本地缓存          | 否               | 可清理、可重建，不参与一致性协议     |

## 5. 数据库也是存储一等公民

### 5.1 统一原则

- 数据库与文件存储没有架构级差异，均属于统一存储框架管理对象。
- 数据库路径必须由存储框架决议，不允许模块自定义绝对路径。
- 数据库文件统一挂载于 `data/db/`，业务文件统一挂载于 `data/files/`。

### 5.2 数据库命名规范

- 命名规则：`<domain>.<profile>.db`
- 示例：
  - `chat.main.db`
  - `profile.main.db`
  - `settings.main.db`
  - `search.index.db`

### 5.3 分域分库原则

- Chat 数据库必须与非 Chat 数据库分离。
- 高写入高检索域（chat/search）必须独立库，避免拖累配置与低频业务。
- 跨域查询禁止直接表连接，采用应用层组合。

### 5.4 本地数据库并发与竞争控制

- 默认数据库并发策略采用 SQLite WAL 模式，保证读写并发与崩溃恢复能力。
- 同一进程内必须通过应用层写队列串行提交事务，禁止并发写同一逻辑实体。
- 跨进程访问必须依赖数据库文件锁；检测到锁竞争时，调用方应退避重试并上报指标。
- 涉及配置写入的关键路径必须带版本号（`revision`）进行乐观并发控制，避免覆盖其他会话的更新。

## 6. 加密与密钥管理

### 6.1 加密分级

- L0：无敏感数据，可不加密。
- L1：一般敏感数据，建议文件级加密。
- L2：高敏感数据（聊天消息、密钥、令牌），必须库级或页级加密。

### 6.2 强制要求

- Chat 主库默认按 L2 执行。
- 密钥不能明文存放在项目目录内。
- 密钥来源必须接入系统安全设施（macOS Keychain / Windows DPAPI / Linux Secret Service）。

### 6.3 轮换与恢复

- 每个库必须具备 `key_version` 元信息。
- 支持在线轮换：新写使用新密钥，后台迁移旧页。
- 备份导出需二次加密，不允许裸库导出。

## 7. 覆盖来源与环境控制

### 7.1 默认来源

- 默认来源标记为 `platform_default` 或 `default`，语义等价。

### 7.2 覆盖来源

- Desktop：
  - `PEERS_STORAGE_ROOT`
- Station：
  - `PEERS_PATHS_FILE`
  - `PEERS_CONFIG_DIR`
  - `PEERS_DATA_DIR`
  - `PEERS_CACHE_DIR`
  - `PEERS_LOGS_DIR`
  - `PEERS_RUNTIME_DIR`
  - `PEERS_TEMP_DIR`

### 7.3 约束

- 覆盖只允许改变路径，不允许改变目录语义。
- 禁止把 `runtime/temp` 覆盖到持久盘策略之外的高敏感区域。

## 8. 初始化、写入与迁移

### 8.1 启动初始化

- 启动时必须创建六类目录及标准子目录（`data/db`、`data/files`）。
- 初始化失败必须中止关键流程并返回可诊断错误。

### 8.2 原子写

- 文件写流程固定：`write tmp -> fsync -> rename`。
- 数据库写必须使用事务，禁止多表分散提交。

### 8.3 Schema 迁移

- 每个数据库必须有独立迁移版本号。
- 迁移失败必须可回滚或可重试。
- 迁移日志必须进入 `logs` 并打版本标签。

### 8.4 Provider 配置派生与持久化

- 目标：系统默认配置派生到每个用户，用户修改后独立存储，互不串配置。
- 目录布局（Desktop）：
  - 系统预设只读：`config/providers/system.default.yaml`（首次由内置 `providers.default.yaml` 派生）
  - 用户覆盖：`config/providers/users/<userScope>/override.yaml`
  - 可选快照：`config/providers/users/<userScope>/effective.snapshot.yaml`
- 读路径：
  - 启动时加载系统预设。
  - 按当前 `userScope` 加载用户覆盖。
  - 在内存中合并为有效配置（effective view）供 Provider/Model 运行时消费。
- 写路径：
  - 任何用户新增/修改/删除 Provider 与 Model，仅写入当前 `userScope` 的覆盖文件。
  - 系统预设文件永久只读，禁止被业务写入。
- 合并规则：
  - provider 级按 `provider.id` 合并，用户覆盖优先级高于系统预设。
  - model 级按 `model.id` 合并，支持用户显式禁用系统内置模型。
  - 删除操作采用 tombstone 标记，避免升级后被系统预设“复活”。
  - `override.yaml` 采用增量结构（`provider_overrides + tombstones + revision`），而非全量快照。
- 冲突处理：
  - 覆盖文件写入采用 `write tmp -> fsync -> rename`。
  - 覆盖文件携带 `revision`，提交时校验版本；冲突返回可诊断错误并提示刷新。

### 8.5 Scope 解析与命令层约束

- 命令层必须从会话上下文解析 `userScope`，建议直接绑定 `session.actor_id`。
- 应用层接口统一保留 `scope` 参数，不在业务函数内部推断当前用户。
- 所有 Provider/Model 写操作必须带 scope 进入存储层，禁止默认写入全局共享文件。

## 9. 框架能力补全要求

存储框架必须补全以下能力，作为统一协议的一部分：

- `resolvePath(appName, kind, segments[]) -> absPath`
- `resolveDatabasePath(appName, domain, profile) -> absPath`
- `ensureLayout(appName) -> layoutMeta`
- `atomicWrite(path, payload)`
- `openDatabase(spec)`，其中 `spec` 至少包含：
  - `domain`
  - `profile`
  - `encryptionLevel`
  - `keyRef`
- `healthCheck()`，返回目录/权限/可写性/剩余空间/加密状态

## 10. 可观测性与治理

- 必须输出统一存储观测指标：
  - 路径来源（default/env）
  - 初始化耗时
  - 迁移耗时与版本
  - DB 打开失败率
  - 原子写失败率
  - 磁盘占用与增长速率
- 必须输出治理日志：
  - 密钥版本变化
  - 迁移动作
  - 清理动作（cache/temp）
  - scope 命中来源（`session.actor_id` / `__default__`）
  - Provider 覆盖写入冲突与重试结果

## 11. 实施约束

- 新增任何本地持久化能力，必须挂接到六类目录之一。
- 不允许新增并列于六类目录之外的同级语义目录。
- 不允许模块自行定义根目录规则。
- 不允许 Chat 数据与其它模块混用同一个主库文件。

## 12. 验收标准

- 两端默认根目录均遵循平台目录规则。
- 两端根目录结构一致，只有 `appName` 差异。
- 两端均具备一致的路径决议、初始化、原子写、数据库路径决议能力。
- Chat 与非 Chat 落盘库分离，且 Chat 满足 L2 加密要求。
- 任一运行时文件或数据库均可映射到六类语义目录与一个明确域名。
- 同机多用户分别修改 Provider 配置后，互不影响且重启后保持各自结果。
- 未登录用户只影响 `__default__` scope，登录后切换到对应用户 scope。
- 系统预设升级后，用户覆盖仍可稳定叠加，且被 tombstone 的项不会被自动恢复。

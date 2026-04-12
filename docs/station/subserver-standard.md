# Subserver Standard

> Station platform specification source for how a Subserver is positioned, structured, and integrated into the Station runtime.

---

## 1. 文档定位

本文定义：

- Station Subserver 在当前架构中的角色
- Subserver 的目录结构与职责边界
- 插件注册、生命周期、配置、路由的约束
- Subserver 与 `frame` / `app` 的集成方式

本文不定义：

- 全量 Go 编码规范
- 全量库使用手册
- 单个业务域的详细架构

继续阅读请看：

- `base.md`
- `app-layer.md`
- `go-standards.md`
- `lib-usage.md`

---

## 2. 什么是 Subserver

Subserver 是 Station `app` 层中的业务能力单元。

它负责：

- 承载某个明确的业务域或能力域
- 向 Station runtime 注册自己的生命周期与处理入口
- 暴露自身 handler、service、domain、repo 等业务实现
- 通过 `frame` 提供的能力接入配置、日志、数据库、路由与运行时基础设施

它不负责：

- 复写 `frame` 的基础设施能力
- 让 `frame` 反向依赖自身业务语义
- 将全部业务逻辑直接堆进 handler

---

## 3. 当前路径约束

Subserver 当前主路径为：

```text
apps/station/app/subserver/<domain>/
```

示例（当前代码库中存在的域）：

- `agent`
- `friend_chat`
- `group_chat`
- `social`
- `activitypub`
- `dashboard`
- `mastodon`

---

## 4. 推荐目录结构

```text
apps/station/app/subserver/<domain>/
├── plugin.go                # 插件注册与工厂入口
├── options.go               # 域级配置与 option 装配
├── <domain>.go / subserver.go
├── handler.go               # 或 handler/*.go
├── service/                 # 应用服务 / 领域编排
├── domain/                  # 领域对象、值对象、转换器（按需）
├── db/                      # 数据访问与持久化模型（按需）
│   ├── model/
│   └── repo/
└── README.md                # 域说明（按需）
```

说明：

- 不是每个域都必须拥有完全相同的子目录。
- 但职责边界必须清楚：handler 不承载完整业务规则，service 不直接扮演 transport 层。
- 如果已经按 `handler/`, `application/`, `infrastructure/`, `domain/` 进一步细分，也应保持同样的职责约束。

---

## 5. 分层职责

### 5.1 plugin.go

负责：

- 注册到 `plugin.SubserverPlugins`
- 装配本域默认 `option.Option`
- 提供 `New(opts ...option.Option) server.Subserver`

不负责：

- 承载业务逻辑
- 直接处理 HTTP 请求

### 5.2 options.go

负责：

- 定义域级 option 结构
- 将配置映射为 `option.Option`
- 提供 `WithXxx(...)` 风格配置入口

### 5.3 subserver 主体文件

负责：

- 实现 `server.Subserver`
- 管理生命周期状态
- 组合 handler、service、repo 等依赖

### 5.4 handler 层

负责：

- transport 层输入输出转换
- 参数解析、权限前置检查、调用 service
- 返回协议层响应

不负责：

- 承载复杂业务编排
- 直接堆积跨流程状态机

### 5.5 service 层

负责：

- 业务编排
- 领域规则
- 调用 repo / domain service / infrastructure

### 5.6 db 层

负责：

- 持久化模型
- 数据访问封装
- 查询与事务边界配合

---

## 6. 生命周期约束

Subserver 应实现当前 Station 运行时所要求的 `server.Subserver` 行为。

典型生命周期：

1. `Init`
   - 构建资源
   - 注入依赖
   - 不进入持续运行任务
2. `Start`
   - 进入运行态
   - 启动调度、监听、后台工作流
3. `Stop`
   - 优雅关闭
   - 释放资源

常见状态：

- `server.StatusStopped`
- `server.StatusStarting`
- `server.StatusRunning`
- `server.StatusStopping`
- `server.StatusError`

状态流转应清晰、可观测，不要静默失败。

---

## 7. 插件注册约束

核心机制：

- `plugin.SubserverPlugins["<domain>"] = ...`
- `New(...option.Option) server.Subserver`

推荐模式：

```go
func init() {
	config.RegisterOptions(&domainOptions)
	plugin.SubserverPlugins["<domain>"] = &domainPlugin{}
}
```

要求：

- 注册名稳定、语义明确
- 注册名与路径、配置项、日志上下文保持一致
- 不使用历史遗留或临时命名污染长期域模型

---

## 8. 配置与依赖注入

Subserver 配置应通过 `option.Option` 与配置注册机制进入运行时。

推荐约束：

- 在 `plugin.go` 中注册配置结构
- 在 `options.go` 中定义域级 option 包装
- 在 `New` / `Init` 时解析并注入到 subserver 实例

数据库获取应复用统一 store 能力，例如：

```go
db, err := store.GetRDS(ctx, store.WithRDSDBName("agent"))
```

不要在 Subserver 内自行发明平行数据库接入方式。

---

## 9. 路由约束

Subserver 路由必须避免与主服务器系统路由冲突。

约束：

- Subserver 使用独立的域名前缀
- 避免伪装成主系统 `/api/v1/...` 路由
- 避免与 `/activitypub/...`、`/.well-known/...` 等主路径混淆

示例：

- 合理：`/<domain>/...`
- 不合理：把域内路由强行挂到与主协议层冲突的公共前缀下

具体协议兼容与路由文档更新，参见 Station API 文档与路由协议文档。

---

## 10. 日志与错误处理约束

### 日志

必须使用：

- `frame/core/logger`

要求：

- 第一个参数传 `context.Context`
- 记录关键上下文与失败原因
- 不使用 `fmt.Println`、标准库 `log` 直接输出业务日志

### 错误处理

要求：

- 不吞错
- 业务层错误带上下文
- handler 负责把错误映射到协议层响应
- 运行时失败要有日志和状态反馈

详细规范见：

- `go-standards.md`
- `lib-usage.md`

---

## 11. 与当前代码现实的对齐点

当前代码中可直接看到以下模式已经在使用：

- `server.Subserver`
- `plugin.SubserverPlugins`
- `server.SubserverTypeHTTP`
- `server.StatusStarting`
- `store.WithRDSDBName(...)`
- `frame/core/logger`

因此本文档必须围绕这些现实能力定义规范，而不是继续沿用旧路径或旧模块示例。

---

## 12. 验收标准

一份新的或重构后的 Subserver，如果要被认为符合规范，至少应满足：

- 路径位于 `apps/station/app/subserver/<domain>/`
- 明确区分 plugin / options / subserver / handler / service / repo 职责
- 生命周期与状态流转清晰
- 日志统一走 `frame/core/logger`
- 数据库访问统一走 `store` 能力
- 路由不与主系统保留路径冲突
- 业务逻辑不堆进 handler

---

## 13. 继续阅读

- [Station Base](./base.md)
- [App Layer](./app-layer.md)
- [Go Standards](./go-standards.md)
- [Lib Usage](./lib-usage.md)

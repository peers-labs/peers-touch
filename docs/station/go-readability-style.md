# Station Go 可读性与空间感风格补充规范

> 文档定位：本文是 `docs/station/go-standards.md`、`docs/station/lib-usage.md`、`docs/station/subserver-standard.md` 的补充规范。
> 目标：把“可读性、空间感、函数块优雅、参数组织清晰”这类主观偏好，收敛成可执行的代码风格规则。

---

## 1. 适用范围

适用于：

- `apps/station/app/`
- `apps/station/frame/`

不适用于：

- `.pb.go` 等生成代码
- `frame/example/` 中纯演示性质代码（建议逐步靠拢，但不强制一次性整改）

---

## 2. 与现有规范的关系

优先级从高到低：

1. `gofmt` / `goimports`
2. `docs/station/base.md`
3. `docs/station/subserver-standard.md`
4. `docs/station/lib-usage.md`
5. `docs/station/go-standards.md`
6. 本文档

说明：

- 现有规范已经覆盖了分层、日志、错误处理、`gofmt`、导出注释、早返回。
- 本文档补齐的是“风格节奏”与“可读性结构”，尤其是：
  - 空行节奏
  - 函数块拆分
  - 参数组织
  - `option` 使用边界
  - handler / service / repo 内部代码的空间感

---

## 3. 核心原则

### 3.1 可读性优先于压缩

不要为了少几行代码，把逻辑压缩成读者需要来回扫视的形态。

目标不是“短”，而是“一眼看出结构”。

### 3.2 一个函数只表达一个主意图

一个函数可以完成一个完整动作，但不应同时承担：

- 参数校验
- 权限判定
- 业务编排
- SQL 细节
- 响应格式化

一旦这些责任同时出现，必须考虑拆分。

### 3.3 空行是结构，不是装饰

空行用于表达“语义块切换”：

- 校验
- 依赖准备
- 主业务路径
- 收尾与返回

如果一段函数没有空行，读起来应该像没有段落的文章。

---

## 4. 空行与块节奏

### 4.1 标准函数骨架

推荐按以下顺序组织：

```go
func (s *Service) Do(ctx context.Context, input Input) (Output, error) {
	if err := validate(input); err != nil {
		return Output{}, err
	}

	dep, err := s.loadDependency(ctx, input.ID)
	if err != nil {
		return Output{}, err
	}

	result, err := s.execute(ctx, dep, input)
	if err != nil {
		return Output{}, err
	}

	return result, nil
}
```

### 4.2 必须插空行的场景

- `guard clause` 校验段之后
- 依赖加载与主业务逻辑之间
- 主业务逻辑与返回结果之间
- `if/for/switch` 块结束后，若后面进入新的语义阶段

### 4.3 不要滥用空行的场景

- 同一个语义块内每两行都空一行
- 一个简单的 `if err != nil { return err }` 前后都插空行
- 连续声明、连续赋值、本来属于同一组时硬拆开

---

## 5. 单行函数规则

### 5.1 禁止

禁止把有真实业务语义的函数写成单行：

```go
func (s *Session) IsExpired() bool { return time.Now().After(s.ExpiresAt) }
```

### 5.2 允许的例外

仅以下场景允许单行：

- `TableName()` 这类 ORM 约定函数
- 明显无歧义的 getter / passthrough
- 极小的协议适配器

即便允许，也要求：

- 同一文件内风格一致
- 不要与复杂多行函数交错得太破碎

### 5.3 推荐

对 Subserver 生命周期方法：

- `Name()`
- `Type()`
- `Status()`

允许单行，但建议集中放在一个区域，不要散落在文件中部。

---

## 6. 参数组织规则

### 6.1 超过 4 个基础类型参数时，优先考虑输入对象

出现以下信号时，应从长参数列表升级为 `Input` / `Command` 结构：

- 参数超过 4 个
- 同时包含多个 `string` / `int` / `bool`
- 调用方需要记忆顺序
- 某些参数未来明显会继续增长

不推荐：

```go
func (s *Service) SendMessage(
	sessionID,
	senderDID,
	receiverDID string,
	messageType int32,
	content,
	replyToID string,
	attachments []domain.Attachment,
	encryptedPayload []byte,
	clientULID string,
) (domain.Message, error)
```

推荐：

```go
type SendMessageInput struct {
	SessionID        string
	SenderDID        string
	ReceiverDID      string
	MessageType      int32
	Content          string
	ReplyToID        string
	Attachments      []domain.Attachment
	EncryptedPayload []byte
	ClientULID       string
}
```

### 6.2 `bool` 参数规则

- 禁止裸 `bool` 作为语义不明显的中间参数
- 若出现 `bool`，应通过命名结构体字段表达含义

不推荐：

```go
DoThing(ctx, actorID, true, false)
```

推荐：

```go
DoThing(ctx, DoThingInput{
	ActorID: actorID,
	Force:   true,
	DryRun:  false,
})
```

### 6.3 Option 的使用边界

`option.Option` 主要用于：

- 构造器
- 子服务装配
- 配置注入

不要把 `option.Option` 滥用到一次性业务命令上。

判断标准：

- 生命周期配置、依赖装配：用 `option.Option`
- 一次请求/一次业务动作输入：用 `Input` 结构

---

## 7. handler / service / repo 的内部风格

### 7.1 handler

推荐顺序：

1. 解析请求
2. 权限/身份校验
3. 调用 service
4. 映射响应

禁止：

- 在 handler 内嵌长 SQL
- 在 handler 内直接维护状态机
- 一边解析参数一边做复杂业务判定

### 7.2 service

service 应该最强调“块结构”：

1. 输入校验
2. 权限与前置状态校验
3. 主编排
4. 副作用（通知、事件、审计）
5. 返回

如果一个 service 函数看起来像“自顶向下的流程图”，通常就够好了。

### 7.3 repo / infrastructure

repo 允许更贴近 SQL / GORM，但仍然要：

- 明确 query 构造段
- 明确执行段
- 明确结果映射段

不要把 5 层链式调用、错误处理、数据组装混在一个连续大段里。

---

## 8. 注释规范

### 8.1 注释解释“为什么”，不是“代码正在做什么”

推荐：

```go
// Keep response shape stable for clients/tests: empty slice instead of nil.
```

不推荐：

```go
// Set x to 1.
x = 1
```

### 8.2 分隔线注释可以用，但要克制

允许：

- 文件中 2–4 个主分区
- 大型 repo/model 文件中清楚分组

不推荐：

- 几十行就插一条巨型分隔线
- 用分隔线掩盖函数本身结构混乱的问题

优先级：

- 先拆函数
- 再用空行
- 最后才用分隔线注释

---

## 9. 错误处理风格

### 9.1 禁止静默吞错

`_ = err` 只允许用于以下情况：

- 明确 best-effort 清理
- 输出响应时客户端断连这类无法补救的写失败
- 日志/指标的非关键路径

使用时必须满足至少一条：

- 有注释解释为何可忽略
- 前面已经记录日志
- 忽略不会破坏主业务正确性

### 9.2 错误上下文必须包含动作语义

推荐：

```go
return fmt.Errorf("load friend request %s: %w", requestID, err)
```

不推荐：

```go
return err
```

---

## 10. GORM / SQL 可读性规则

### 10.1 链式调用一行一个阶段

推荐：

```go
result := tx.Model(&NotificationModel{}).
	Where("notif_id IN ? AND recipient_id = ? AND status = ?", notifIDs, recipientID, domain.StatusUnread).
	Updates(map[string]interface{}{
		"status":     domain.StatusRead,
		"read_at":    now,
		"updated_at": now,
	})
```

### 10.2 原始 SQL 与业务意图分开

在执行大段 SQL 前，先用注释说明业务动作：

```go
// Atomic counter increment in the same transaction.
return tx.Exec(`...`).Error
```

### 10.3 repo 里允许 SQL，service 里尽量不出现 SQL 细节

如果 service 直接开始拼 SQL，通常说明边界错了。

---

## 11. 一致性修正优先级

做风格治理时，不要全盘凭感觉扫。

优先顺序：

1. 先修违反现有硬规范的代码
   - `fmt.Println` / `println`
   - 未经说明的吞错
   - handler/service/repo 边界混乱
2. 再修高频可读性问题
   - 超长参数列表
   - 大函数缺少块结构
   - 注释噪音
3. 最后再做细粒度排版统一
   - 单行 getter
   - 分隔线风格
   - 局部命名不统一

---

## 12. 审查检查表

提交 Go 代码前，至少自查：

- 这个函数是否只有一个主意图？
- 是否能一眼分出“校验 / 主逻辑 / 副作用 / 返回”？
- 参数顺序是否需要读实现才能看懂？
- 是否应该把长参数列表收敛成 `Input` 结构？
- 是否存在未解释的 `_ = err`？
- 是否用了 `fmt.Println` / `println` 这类非项目日志？
- handler / service / repo 的边界是否还清晰？

---

## 13. 落地建议

建议把本文作为 Station Go 风格补充真源，配合现有文档一起使用：

- 架构与边界：`base.md`、`subserver-standard.md`
- 库使用：`lib-usage.md`
- 官方与基础格式：`go-standards.md`
- 可读性与空间感：本文

如果后续要继续工程化，下一步建议不是继续写文字，而是补 3 类自动检查：

- 单行业务函数检查
- 未解释吞错检查
- `fmt.Println` / `println` 禁用检查

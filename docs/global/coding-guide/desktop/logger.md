# Desktop Logger 指南

## 架构总览

Desktop 的日志系统采用**双输出架构**：每条日志同时写入浏览器控制台和 Rust 后端。

```
前端代码
    |
    v
  log.info('ChatPage', 'message sent', { id: '123' })
    |
    ├──→ console.info('[ChatPage]', 'message sent', { id: '123' })   ← 开发调试
    |
    └──→ invoke('frontend_log', {                                     ← 持久化
           input: {
             level: 'info',
             tag: 'ChatPage',
             message: 'message sent',
             data: '{"id":"123"}'
           }
         })
            |
            v
         Rust tracing                                                 ← 统一日志文件
```


## 源码

```typescript
import { invoke } from '@tauri-apps/api/core';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function send(level: LogLevel, tag: string, message: string, data?: unknown) {
  console[level](`[${tag}]`, message, ...(data !== undefined ? [data] : []));
  try {
    invoke('frontend_log', {
      input: {
        level,
        tag,
        message,
        data: data !== undefined ? JSON.stringify(data) : undefined,
      },
    }).catch(() => {});
  } catch {
    // noop
  }
}

export const log = {
  debug: (tag: string, msg: string, data?: unknown) => send('debug', tag, msg, data),
  info: (tag: string, msg: string, data?: unknown) => send('info', tag, msg, data),
  warn: (tag: string, msg: string, data?: unknown) => send('warn', tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => send('error', tag, msg, data),
};
```


## 调用方式

```typescript
import { log } from '@/utils/logger';

log.debug('SessionStore', 'loading sessions');
log.info('ChatPage', 'message sent', { sessionId: 'abc', model: 'gpt-4' });
log.warn('ProviderCheck', 'API key missing', { providerId: 'openai' });
log.error('StreamChat', 'connection failed', { error: err.message });
```

所有四个方法签名一致：

```typescript
(tag: string, message: string, data?: unknown) => void
```


## 日志级别语义

| 级别 | 用途 | 示例 |
|------|------|------|
| `debug` | 开发调试信息，生产环境可能被过滤 | 加载状态、中间计算值、渲染触发 |
| `info` | 正常业务流程的关键节点 | 用户操作（发送消息、创建 Agent）、数据加载完成 |
| `warn` | 可恢复的异常或值得注意的降级 | API key 缺失回退默认、网络重试 |
| `error` | 不可恢复的错误 | API 调用失败、渲染异常、关键数据丢失 |


## Tag 命名规范

tag 是日志的分类标识，用于快速定位日志来源。推荐规范：

| 模式 | 示例 | 说明 |
|------|------|------|
| 页面名 | `ChatPage`、`MemoryPage` | 页面级操作 |
| 组件名 | `SessionList`、`ProviderLayout` | 组件内部逻辑 |
| Store 名 | `SessionStore`、`AgentStore` | 状态管理层 |
| 服务名 | `StreamChat`、`AppletManager` | 服务/工具类 |
| 模块名 | `TTS`、`MCP`、`Cron` | 功能模块 |

保持简洁、具有辨识度。避免过长的层级路径（不要用 `components.settings.ProviderLayout`）。


## 双输出细节

### 控制台输出

```typescript
console[level](`[${tag}]`, message, ...(data !== undefined ? [data] : []));
```

- 使用对应级别的 console 方法（`console.debug`、`console.info`、`console.warn`、`console.error`）
- tag 以 `[Tag]` 格式作为前缀
- data 存在时作为额外参数传入，在控制台中可展开查看对象结构
- data 不存在时不传多余参数，保持控制台输出整洁

### Rust 端输出

```typescript
invoke('frontend_log', {
  input: {
    level,
    tag,
    message,
    data: data !== undefined ? JSON.stringify(data) : undefined,
  },
}).catch(() => {});
```

- 通过 Tauri 的 `invoke` 调用 Rust 命令 `frontend_log`
- data 序列化为 JSON 字符串（Rust 端接收后可按需解析）
- data 为 `undefined` 时不发送该字段（节省传输）
- `catch(() => {})` 静默吞掉错误 -- 日志系统自身不应导致应用崩溃
- 外层 `try/catch` 兜底保护，防止 invoke 本身在非 Tauri 环境下抛出同步异常

### Rust 端 tracing 集成

Rust 端的 `frontend_log` 命令接收前端日志后，通过 tracing 框架写入统一日志文件。这样：
- 前端和后端的日志出现在**同一个日志文件**中
- 按时间线交叉排列，方便排查跨层问题
- 前端日志通过 tag 字段与 Rust 日志区分来源


## 禁止模式

### 禁止直接使用 console.log

```typescript
// 禁止
console.log('something happened');
console.error('error:', err);

// 正确
log.info('MyComponent', 'something happened');
log.error('MyComponent', 'error occurred', { error: err.message });
```

原因：
1. `console.log` 不会发送到 Rust 端，日志文件中不可见
2. 没有 tag 分类，无法按来源过滤
3. 没有级别区分，无法在生产环境过滤 debug 信息

### 禁止在 data 中传入敏感信息

```typescript
// 禁止 -- API key 会被序列化并写入日志文件
log.info('Provider', 'key updated', { apiKey: 'sk-xxxxx' });

// 正确
log.info('Provider', 'key updated', { providerId: 'openai' });
```

### 禁止在 data 中传入循环引用或不可序列化对象

```typescript
// 禁止 -- JSON.stringify 会失败
log.info('App', 'dom ref', { element: document.body });

// 正确 -- 提取需要的信息
log.info('App', 'dom ref', { tagName: document.body.tagName });
```


## 错误日志最佳实践

```typescript
try {
  await api.createAgent(data);
  log.info('AgentForm', 'agent created', { name: data.name });
} catch (err) {
  log.error('AgentForm', 'failed to create agent', {
    name: data.name,
    error: err instanceof Error ? err.message : String(err),
  });
}
```

关键点：
- 错误对象不要直接传入 data（不可序列化），提取 `message` 字段
- 同时记录足够的上下文（如操作的目标 name/id），方便排查
- 成功路径也应记录 info 日志，便于追踪完整操作链


## 设计要点总结

1. **日志系统自身零故障**：外层 try/catch + 内层 .catch(() => {})，确保日志发送失败不影响业务
2. **Tauri 环境检测**：即使在非 Tauri 环境中（如单元测试），invoke 的同步异常也会被捕获
3. **data 惰性序列化**：仅在 data 存在时执行 `JSON.stringify`，减少不必要的计算
4. **统一出口**：`log` 对象是唯一合法的日志出口，便于后续扩展（如添加采样、批量上报等）

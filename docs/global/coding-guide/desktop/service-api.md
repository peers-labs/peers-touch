# Desktop Service API 指南

## 架构总览

`services/desktop_api.ts` 是 Desktop 前端与后端通信的**中央 API 门面**。所有 Tauri 命令调用、类型定义、数据映射都集中在此文件中。

```
前端组件 / Store
      |
      v
  api.xxx()          ← desktop_api.ts 导出的统一接口
      |
      v
  invokeRustCommand  ← 底层 Tauri invoke 封装
      |
      v
  Rust Backend       ← Tauri 命令处理
```

设计原则：
- 前端组件**不直接调用** `invoke()`，统一通过 `api` 对象访问
- 类型定义与 API 方法**共置于同一文件**，保持类型与调用的一致性
- Tauri 用于所有本地操作，仅 SSE 流式聊天和文件上传通过 HTTP


## 三层 invoke 封装

### 第一层：invokeRustCommand

```typescript
async function invokeRustCommand<TInput, TData>(
  command: string,
  input?: TInput,
): Promise<RustCommandResult<TData>>
```

最底层封装。接收 Tauri 命令名和可选输入，返回标准 `RustCommandResult`：

```typescript
interface RustCommandResult<T> {
  ok: boolean;
  data?: T;
  error?: RustCommandError;
}

interface RustCommandError {
  code: RustErrorCode;   // 'NOT_FOUND' | 'UNAUTHORIZED' | 'INTERNAL_ERROR' | ...
  message: string;
  details?: Record<string, any>;
}
```

特征：
- 自动将 `input` 包装为 `{ input }` payload
- 捕获所有异常，**永不抛错**，而是返回 `{ ok: false, error: {...} }`
- 调用方需自行检查 `ok` 字段
- 认证失效属于**全局语义**：若 Rust 返回 `error.code = UNAUTHORIZED` 且 `error.details.code = session_revoked`，`invokeRustCommand` 必须发布 `AUTH_SESSION_REVOKED`

认证错误约束：

```typescript
interface RustCommandError {
  code: RustErrorCode;
  message: string;
  details?: {
    code?: string;      // e.g. "session_revoked"
    reason?: string;    // "expired" | "kicked" | "not_found" | "unknown"
    raw?: string;
  };
}
```

要求：
- 前端只消费结构化 `code/details`，禁止解析 `SESSION_REVOKED:...` 等字符串前缀协议
- `AUTH_SESSION_REVOKED` 由服务层统一发布，页面层不得各自实现“401 后退出登录”
- `reason` 仅用于 UI 文案和审计，不改变退出登录的全局编排入口

```typescript
const result = await invokeRustCommand<void, TauriStubPayload>('system_health');
if (result.ok && result.data) {
  // 使用 result.data
} else {
  // 处理 result.error
}
```


### 第二层：invokeAuthCommand

```typescript
async function invokeAuthCommand<TInput>(
  command: string,
  input?: TInput,
): Promise<TauriStubPayload>
```

用于认证相关命令。基于 `invokeRustCommand`，额外逻辑：
- 若 `ok === false` 或 `data` 为空，抛出 `AuthCommandException`
- 成功时直接返回 `data`（不需要调用方检查 `ok`）

```typescript
interface AuthCommandException extends Error {
  code: RustErrorCode;
  details?: Record<string, any>;
}
```

用于：`access_submit_login`、`auth_logout`、`auth_restore_session`、
`auth_validate_token`


### 第三层：invokeRustDataFromStatus

```typescript
async function invokeRustDataFromStatus<TInput, TOut>(
  command: string,
  input?: TInput,
): Promise<TOut>
```

最常用的封装。处理 `TauriStubPayload` 格式的响应：

```typescript
interface TauriStubPayload {
  command: string;
  status: string;   // JSON 字符串，包含实际业务数据
}
```

工作流程：
1. 调用 `invokeRustCommand`
2. 检查 `ok && data` 存在
3. 将 `data.status` JSON 解析为 `TOut`
4. 失败时直接抛 Error

这是 **90%+ API 方法使用的封装层**。调用方拿到的就是最终业务数据。

例外：
- Friend Chat / Group Chat / Notification / ICE 等 protobuf 命令应优先走 `invokeRustProto`
- 只有返回 `TauriStubPayload.status` 的旧 stub 命令才允许走 `invokeRustDataFromStatus`
- 新增 Desktop 命令时，如果 Station 返回 protobuf 或结构化错误，禁止再包一层字符串 `status`


## 运行时检测

```typescript
function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
```

部分 API（OAuth2、Account）根据运行时环境选择不同实现：
- Tauri 环境：走 Tauri invoke
- Web 环境：走 localStorage 模拟


## api 对象

`api` 是导出的核心对象，包含所有业务方法。按领域分组如下：

### 会话与消息

```typescript
api.listSessions()                        // → Session[]
api.deleteSession(key)                     // → { ok: boolean }
api.renameSession(key, title)              // → { ok: boolean; title: string }
api.duplicateSession(key)                  // → { ok: boolean; conversationId: string }
api.smartRenameSession(key)                // → { ok: boolean; title: string }
api.setSessionModel(key, model)            // → { ok: boolean; model: string }
api.getMessages(key)                       // → Message[]
api.deleteMessage(id)                      // → { ok: boolean }
api.updateMessage(id, content)             // → { ok: boolean }
api.stopChat(sessionKey)                   // → { ok: boolean; stopped: boolean }
```

### Agent 管理

```typescript
api.listAgents()                           // → Agent[]
api.getAgent(id)                           // → Agent
api.createAgent(data)                      // → Agent
api.updateAgent(id, data)                  // → Agent
api.deleteAgent(id)                        // → { ok: boolean }
api.duplicateAgent(id, name)               // → Agent
api.searchAgents(q)                        // → Agent[]
api.listAgentSessions(id)                  // → Session[]
```

### Provider 与模型

```typescript
api.listProviders()                        // → ProviderListItem[]
api.getProvider(id)                        // → ProviderDetail
api.updateProvider(id, data)               // → { provider: any }
api.checkProvider(id, data)                // → { ok: boolean; message?: string }
api.createProvider(data)                   // → { provider: any }
api.deleteProvider(id)                     // → { success: boolean }
api.listAvailableModels()                  // → { models: AvailableModel[]; default: string }
api.addModel(providerId, data)             // → { ok: boolean }
api.updateModel(providerId, modelId, data) // → { ok: boolean }
api.deleteModel(providerId, modelId)       // → { ok: boolean }
api.fetchRemoteModels(providerId, data)    // → { ok: boolean; models: string[] }
api.toggleModel(providerId, modelId, on)   // → { ok: boolean }
api.toggleAllModels(providerId, on)        // → { ok: boolean }
```

### Skills

```typescript
api.listSkills(source?)                    // → { skills: SkillListItem[]; builtin: BuiltinSkillInfo[] }
api.searchSkills(q, limit?)                // → { skills: SkillListItem[] }
api.getSkill(id)                           // → SkillRecord
api.getBuiltinSkill(identifier)            // → BuiltinSkillRecord
api.createSkill(name, content)             // → SkillImportResult
api.updateSkill(id, data)                  // → { ok: boolean }
api.deleteSkill(id)                        // → { ok: boolean }
api.toggleSkill(id, enabled)               // → { ok: boolean }
api.importSkillFromAddress(address, oauth?) // → SkillImportBatchResult
api.importSkillFromGitHub(owner, repo, ...)// → SkillImportResult
api.importSkillFromZIP(file)               // → SkillImportResult  (HTTP)
api.validateSkillZIP(file)                 // → SkillZipValidation (HTTP)
```

### Skill 市场

```typescript
api.listSkillMarkets()                     // → MarketSummary[]
api.addSkillMarketSource(url, name?, branch?) // → { ok: boolean }
api.removeSkillMarketSource(id)            // → { ok: boolean }
api.syncSkillMarket(marketId)              // → { skills: MarketSkillEntry[]; total: number }
api.listMarketSkills(marketId, q?)         // → { skills: MarketSkillEntry[]; total: number }
api.getMarketSkillDetail(marketId, path)   // → MarketSkillDetail
api.installMarketSkill(marketId, path)     // → SkillImportResult
```

### MCP 服务器

```typescript
api.listMCPServers()                       // → MCPServerItem[]
api.getMCPServer(name)                     // → MCPServerRecord
api.createMCPServer(data)                  // → { ok: boolean; name: string }
api.updateMCPServer(name, data)            // → { ok: boolean }
api.deleteMCPServer(name)                  // → { ok: boolean }
api.toggleMCPServer(name, enabled)         // → { ok: boolean }
api.testMCPServer(name)                    // → { ok: boolean; error?: string; tools?: string[] }
```

### 定时任务 (Cron)

```typescript
api.cronStatus()                           // → CronStatus
api.listCronJobs()                         // → CronJob[]
api.createCronJob(data)                    // → CronJob
api.updateCronJob(id, data)                // → CronJob
api.deleteCronJob(id)                      // → { ok: boolean }
api.toggleCronJob(id, enabled)             // → { ok: boolean }
api.runCronJob(id)                         // → { ok: boolean }
api.listCronRuns(jobId)                    // → CronRun[]
api.parseCronSchedule(text)                // → CronScheduleParsed
```

### 模型服务配置

```typescript
api.listModelConfig()                      // → Record<string, ModelRef>
api.getModelConfig(key)                    // → { key; ref; resolved }
api.setModelConfig(key, ref)               // → { key; ref }
api.deleteModelConfig(key)                 // → { ok: boolean }
api.getProviderReferences(providerId)      // → ModelServiceReference[]
```

### Channels (Bot/Webhook)

```typescript
api.listChannels()                         // → Channel[]
api.getChannel(id)                         // → Channel
api.createChannel(data)                    // → Channel
api.updateChannel(id, data)                // → Channel
api.deleteChannel(id)                      // → { ok: boolean }
api.testChannel(id)                        // → { ok: boolean }
api.sendChannelMessage(id, text, ...)      // → { ok: boolean }
api.listChannelChats(id)                   // → { chats: ChatTarget[] }
api.startBot(id)                           // → { ok: boolean }
api.stopBot(id)                            // → { ok: boolean }
api.getBotStatus(id)                       // → BotStatus
api.listChannelEvents(id, limit, offset)   // → { events: ChannelEvent[]; total: number }
api.getChannelStats(id)                    // → ChannelEventStats
```

### Memory

```typescript
api.listMemories(params?)                  // → { memories: Memory[]; total: number }
api.getMemory(id)                          // → Memory
api.deleteMemory(id)                       // → { ok: boolean }
api.searchMemories(query, layers?, ...)    // → { results: ScoredMemory[] }
api.getPersona(agentId?)                   // → { persona: Persona | null }
api.getMemoryStats()                       // → MemoryStats
api.getMemoryEvents(params?)               // → { events: MemoryEvent[] }
api.exportMemories(params?)                // → ExportData
api.importMemories(data, skipDuplicates?)  // → ImportResult
api.getEmbeddingStatus()                   // → { provider; model; dimensions; vector_count }
api.reEmbed()                              // → { ok: boolean; reembedded_count: number }
```

### OAuth2

```typescript
api.oauth2ListProviders()                  // → OAuth2ProviderSummary[]
api.oauth2GetProvider(id)                  // → OAuth2ProviderDetail
api.oauth2Authorize(id, environment?, returnTo?) // → { auth_url: string }
api.oauth2HandleCallback(input)            // → { status: string }
api.oauth2ListConnections()                // → OAuth2Connection[]
api.oauth2Disconnect(id)                   // → { status: string }
api.oauth2RefreshToken(id)                 // → { status: string }
```

### Account

```typescript
api.accountList()                          // → { accounts: AccountIdentity[]; active_account_id? }
api.accountGetActive()                     // → AccountIdentity | null
api.accountSwitch(id)                      // → { ok: boolean }
api.accountUpsertOAuth(input)              // → { ok: boolean; active_account_id }
```

### 其他

```typescript
api.health()                               // → { status: string }
api.getContractVersion()                   // → { version: string }
api.getStatistics()                        // → StatisticsData
api.getPreferences()                       // → UserPreferences
api.setPreferences(prefs)                  // → { ok: boolean }
api.getHelp()                              // → HelpCategoryGroup[]
api.search(query, source?, limit?)         // → SearchSourceGroup / SearchResultItem
api.aiSearch(query, web?)                  // → AISearchResponse
api.tailLogs(cursor, limit?, maxBytes?)    // → LogTailResponse
api.uploadFile(file)                       // → UploadResult (HTTP)
api.tts(text, voice?, speed?)              // → { url: string }
api.ttsVoices()                            // → { voices: TTSVoice[] }
api.stt(file, language?)                   // → { text: string } (HTTP)
api.openExternalUrl(url)                   // → { ok: boolean }
api.listApplets()                          // → AppletInfo[]
api.getApplet(id)                          // → AppletInfo
api.activateApplet(id)                     // → { ok: boolean }
api.deactivateApplet(id)                   // → { ok: boolean }
```


## streamChat：流式聊天

```typescript
export function streamChat(
  message: string,
  sessionKey: string,
  _agentName: string,
  onEvent: (event: StreamEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  _images?: ChatImageInput[],
  model?: string,
  providerId?: string,
): AbortController
```

当前实现使用 `chat_completion_once` 一次性获取完整响应，然后通过回调模拟流式事件：

```typescript
// 事件序列
onEvent({ event: 'text', data: { content: '...' } })  // 完整文本
onEvent({ event: 'done', data: { model: '...' } })    // 结束标记
onDone()
```

返回的 `AbortController` 可用于取消请求。


## Tauri vs HTTP 的选择

| 通信方式 | 使用场景 |
|----------|---------|
| Tauri invoke | 所有本地 CRUD 操作、认证、设置、Agent、Provider、Skill、MCP、Cron、Channel、Memory 等 |
| HTTP POST (FormData) | 文件上传（`uploadFile`、`importSkillFromZIP`、`validateSkillZIP`、`stt`） |
| HTTP GET | OAuth Provider 配置加载（Web 环境 fallback） |

原则：能用 Tauri invoke 的一律用 Tauri invoke，仅在 Tauri 无法处理（如 FormData 文件上传）或需要 Web 兼容时使用 HTTP。


## 核心类型定义

文件中共置的核心类型（部分）：

```typescript
interface Session {
  id: string; key: string; agent_name: string; title: string;
  message_count: number; model_override?: string;
  created_at: string; updated_at: string;
}

interface Message {
  id: string; role: string; content: string;
  content_type?: 'text' | 'card';
  attachments?: MessageAttachment[];
  model?: string; created_at: string; tool_calls?: string;
}

interface Agent {
  id: string; name: string; title: string; description: string;
  avatar: string; systemPrompt: string; model: string; provider: string;
  tags: string; chatConfig: string; params: string; isDefault: boolean;
  // ... 更多字段
}

interface AvailableModel {
  id: string; display_name: string; provider_id: string; provider_name: string;
  type: string; context_window: number; enabled: boolean;
  function_call?: boolean; vision?: boolean; reasoning?: boolean;
}

interface Memory {
  id: string;
  layer: 'identity' | 'context' | 'experience' | 'preference' | 'activity';
  agent_id: string; session_id: string;
  source: 'extraction' | 'agent_tool';
  content: Record<string, any>; summary: string;
  relevance: number; access_count: number;
  created_at: string; updated_at: string;
}

interface Channel {
  id: string; name: string;
  type: 'telegram' | 'lark' | 'slack' | 'webhook' | 'discord';
  enabled: boolean; config: string;
  createdAt: string; updatedAt: string;
  botStatus?: BotStatus;
}
```

完整类型定义请直接参考源文件。


## 数据映射函数

文件底部包含内部映射函数，将 Rust 返回的原始格式转换为前端类型：

```typescript
function mapAIChatSessionToSession(item: any): Session
function mapAIChatMessageToMessage(item: any): Message
function mapAIChatProviderToListItem(item: any): ProviderListItem
function mapAIChatProviderToDetail(item: any): ProviderDetail
function parseJSONSafe(input?: string): Record<string, any>
function millisToISO(millis?: number): string
```

这些函数处理字段名映射、时间戳转换、JSON 安全解析等，确保前端拿到的数据类型一致。


## 使用示例

```typescript
import { api, type Agent, type Session } from '@/services/desktop_api';

// 列出所有会话
const sessions: Session[] = await api.listSessions();

// 创建 Agent
const agent: Agent = await api.createAgent({
  name: 'my-agent',
  title: 'My Agent',
  systemPrompt: 'You are a helpful assistant.',
  model: 'gpt-4',
  provider: 'openai',
});

// 流式聊天
const controller = streamChat(
  'Hello!',
  sessions[0].key,
  'assistant',
  (event) => {
    if (event.event === 'text') {
      console.log(event.data.content);
    }
  },
  () => console.log('done'),
  (err) => console.error(err),
);

// 取消
controller.abort();
```

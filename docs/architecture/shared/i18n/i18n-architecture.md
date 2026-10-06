# Peers-Touch 多端多语言架构

> **Multi-Platform Internationalization Architecture**
>
> Created: 2026-04-09 | Updated: 2026-09-15

---

## 1. 架构总览

Peers-Touch i18n 架构围绕以下核心能力设计：

| 能力 | 说明 |
|------|------|
| **翻译源管理** | `packages/locales/` 统一维护 namespace 语言包与 metadata |
| **Runtime FS Loading** | Rust `I18nService` 负责部署与扫描运行时语言资源 |
| **Desktop 前端 i18n** | 前端通过 Tauri command 异步加载资源后再初始化 i18next |
| **Rust Error Key** | Rust 层返回 error key，invoke 层自动翻译 |
| **语言切换** | UI 提供运行时语言切换能力 |
| **社区语言包** | `config/i18n/` 支持用户扩展社区语言包 |
| **后端扩展能力** | 支持向种子数据、HTML 页面和服务端扩展场景延伸 |

---

## 2. 设计原则

1. **翻译源集中管理** — 所有翻译资源统一放在 `packages/locales/` 下，按 namespace 分文件，通过 Rust 部署到运行时目录。
2. **错误码驱动，文案客户端负责** — Station 只返回 `ErrorCode` 数字码，Rust 层只返回 i18n error key，客户端负责翻译。
3. **错误 i18n 必须在 invoke 层自动闭环** — `desktop_api.ts` 的 invoke 层自动调用 `resolveError()`，消费方无需关心 i18n。
4. **keySeparator: false — 点号是 key 的一部分，不是层级分隔符** — `"auth.login.title"` 是一个完整的 flat key 字符串，i18next 不做层级解析。
5. **按命名空间组织** — 翻译 key 按 `namespace.feature.context` 三段式命名约定，支持按需加载。
6. **TypeSafe** — 通过 TypeScript `CustomTypeOptions` 声明约束 namespace 和 returnNull 行为。

---

## 2.1 执行计划入口

本文只定义 i18n 架构、资源组织、运行链路与扩展约定。

如需查看落地状态、推进进度与后续扩展安排，请看：

- `execution-plans/i18n-rollout-status.md`

---

## 3. 整体架构

```
packages/locales/ (source of truth)
  ├── en/                (16 namespaces)
  ├── zh-CN/             (16 namespaces)
  └── metadata.json      (version + language metadata)
        │
        │ Rust I18nService.deploy_builtin_packs()
        │ (version + built-in content consistency)
        │
        ▼
config/i18n/ (runtime directory)
  ├── en/
  ├── zh-CN/
  ├── {community packs}/
  ├── metadata.json
  └── README.md
        │
        │ Rust I18nService.load_resources()
        │ (scans all directories, discovers languages)
        │
        ▼
Tauri Command: i18n_load_resources
        │
        ▼
Frontend: initI18n() → i18next.init({ resources, keySeparator: false })
        │
        ├── UI Text: t('namespace.key') via useTranslation hook
        ├── Class Components: <Translation> render prop (ErrorBoundary)
        ├── Module Constants: Factory function pattern getXxx(t)
        └── Error Display: invoke 层自动 resolveError() → 消费方零改动
```

### 数据流详解

1. **App 启动（Rust）** — `main.rs` setup 阶段调用 `state.i18n.deploy_builtin_packs(&resource_dir)`，将 `packages/locales/` 或 Tauri bundled resources 部署到 `config/i18n/`。只有 `metadata.json` 版本和内置语言包内容都一致时才跳过部署；任一不一致都会重新部署内置包。

2. **前端初始化** — `main.tsx` 的 `bootstrap()` 调用 `await initI18n()`（在 React render 之前），通过 Tauri command `i18n_load_resources` 获取所有翻译资源。

3. **i18next 就绪** — 以 `{ resources, keySeparator: false }` 初始化 i18next 实例，整个 React 树可用。

---

## 4. 翻译源

### 4.1 目录结构

```
packages/locales/                       ← @peers-touch/locales 包
├── en/                                 ← English (master)
│   ├── agent.json
│   ├── applet.json
│   ├── auth.json
│   ├── channels.json
│   ├── chat.json
│   ├── common.json
│   ├── cron.json
│   ├── errors.json
│   ├── layout.json
│   ├── memory.json
│   ├── notes.json
│   ├── provider.json
│   ├── search.json
│   ├── settings.json
│   ├── share.json
│   └── tts.json
├── zh-CN/                              ← 简体中文 (同结构)
│   └── ... (16 files)
├── metadata.json                       ← 版本 + 语言元信息
├── types.ts                            ← TypeScript namespace 类型
└── package.json                        ← @peers-touch/locales
```

### 4.2 16 个 Namespace

| Namespace | 职责 |
|-----------|------|
| `common` | 通用 UI：按钮、标签、时间、状态 |
| `auth` | 登录、注册、Session 管理 |
| `errors` | ErrorCode 映射 + 通用错误文案 + ErrorBoundary |
| `settings` | 设置页面各 Tab |
| `chat` | AI 聊天、会话管理 |
| `channels` | Bot/Webhook 频道 |
| `memory` | 记忆系统 |
| `notes` | 笔记系统 |
| `cron` | 定时任务 |
| `search` | 搜索功能 |
| `agent` | Agent 管理、Builder |
| `applet` | 小程序系统 |
| `share` | 分享功能 |
| `layout` | 全局布局、导航、用户面板 |
| `provider` | 模型服务商、模型选择、Skills |
| `tts` | 语音合成 / 语音识别设置 |

### 4.3 metadata.json 格式

```json
{
  "version": "0.2.0",
  "en": {
    "name": "English",
    "nativeName": "English",
    "namespaces": ["agent", "applet", "auth", "channels", "chat", "common", "cron", "errors", "layout", "memory", "notes", "provider", "search", "settings", "share", "tts"]
  },
  "zh-CN": {
    "name": "Chinese (Simplified)",
    "nativeName": "简体中文",
    "namespaces": ["agent", "applet", "auth", "channels", "chat", "common", "cron", "errors", "layout", "memory", "notes", "provider", "search", "settings", "share", "tts"]
  }
}
```

`version` 字段用于 Rust 部署时的快速版本比较。每次翻译内容更新后仍必须递增版本号；Rust 同时校验内置语言包内容，防止漏升版本时 release 运行目录长期保留旧文案。

### 4.4 Key 格式

采用 **Flat key with dots** 格式，配合 `keySeparator: false`：

```json
// packages/locales/en/auth.json
{
  "auth.login.title": "Welcome",
  "auth.login.subtitle": "Sign in to your account to continue",
  "auth.login.submit": "Sign In",
  "auth.login.continueWith": "Continue with {{provider}}",
  "auth.welcomeBack.title": "Welcome back,"
}
```

Key 中的 `.` 是命名约定，**不是 i18next 层级分隔符**。i18next 以 `keySeparator: false` 运行，将整个字符串视为单一 key。

### 4.5 变量插值

使用 i18next 标准语法 `{{var}}`：

```
Simple:       "Hello, {{name}}"
Plural:       "{{count}} messages"
Fallback:     "An error occurred: {{message}}"
```

---

## 5. 各层消费方案

### 5.1 Desktop React (前端)

#### 资源加载：Runtime via Tauri Command

Desktop 是 Tauri App，**不走 Vite dev server 加载资源**。翻译资源通过 Rust 从文件系统读取，经 Tauri IPC 传递给前端。

```typescript
// apps/desktop/src/i18n/index.ts — 核心初始化
export async function initI18n() {
  const result = await invoke<RustCommandResult<I18nResources>>('i18n_load_resources');

  // ... error handling ...

  const { languages, resources } = result.data;
  availableLanguages = languages;
  const lng = detectLanguage(languages.map(l => l.code));

  await i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: 'en',
    defaultNS: 'common',
    keySeparator: false,           // ← 点号不分层
    interpolation: { escapeValue: false },
  });
  return i18n;
}
```

在 `main.tsx` 中，`initI18n()` 在 React render 之前被 `await`：

```typescript
// apps/desktop/src/main.tsx
async function bootstrap() {
  const [{ default: App }, { default: SharePage }] = await Promise.all([
    import('./App'),
    import('./pages/SharePage'),
  ]);

  await initI18n();     // ← i18n 就绪后再 render

  createRoot(document.getElementById('root')!).render(/* ... */);
}
```

#### 三种消费模式

**模式 1: `useTranslation` Hook** — 函数组件标准用法（占 95%+）

```tsx
import { useTranslation } from 'react-i18next';

function LoginPage() {
  const { t } = useTranslation('auth');
  return (
    <>
      <h2>{t('auth.login.title')}</h2>
      <button>{t('auth.login.submit')}</button>
    </>
  );
}
```

**模式 2: `<Translation>` Render Prop** — Class 组件（ErrorBoundary）

```tsx
// apps/desktop/src/components/ErrorBoundary.tsx
import { Translation } from 'react-i18next';

export class ErrorBoundary extends Component<...> {
  render() {
    if (this.state.error) {
      return (
        <Translation ns="errors">
          {(t) => (
            <div>
              <h2>{t('error.boundary.title')}</h2>
              <p>{t('error.boundary.description')}</p>
              <button onClick={this.handleRestart}>
                {t('error.boundary.restart')}
              </button>
            </div>
          )}
        </Translation>
      );
    }
    return this.props.children;
  }
}
```

**模式 3: Factory Function** — 模块级常量

当 Select options 等常量需要 i18n 时，定义接收 `TFunction` 的工厂函数，在组件内调用：

```tsx
// apps/desktop/src/modules/tts/index.tsx
import type { TFunction } from 'i18next';

function getTtsProviderOptions(t: TFunction) {
  return [
    { value: 'browser', label: t('tts.provider.browser') },
    { value: 'edge',    label: t('tts.provider.edge') },
    { value: 'openai',  label: t('tts.provider.openai') },
  ];
}

// 在组件内：
function TTSSettings() {
  const { t } = useTranslation('tts');
  return <Select options={getTtsProviderOptions(t)} />;
}
```

### 5.2 Desktop Rust 层 (Tauri) — Rust message 字段统一为 i18n Error Key

#### 架构决策

**Rust `AppResult::fail()` 的 message 字段必须是 `errors.json` 中的 i18n key**，不允许硬编码人类可读的英文消息。

```rust
// ✅ Correct — message 是 i18n key
AppResult::fail(ErrorCode::InvalidArgument, "error.auth.accountRequired", None)

// ❌ Wrong — 硬编码英文消息
AppResult::fail(ErrorCode::InvalidArgument, "account is required", None)
```

#### 前端 invoke 层自动闭环

`desktop_api.ts` 中所有 invoke 封装函数在抛出错误前自动调用 `resolveError()`，消费方代码**无需关心 i18n**：

```
Rust: AppResult::fail("error.auth.accountRequired")
  → Tauri IPC
  → invokeRustCommand 返回 { ok: false, error: { message: "error.auth.accountRequired" } }
  → invokeRustDataFromStatus:
      const rawMsg = response.error?.message;
      const localizedMsg = resolveError(rawMsg);    // → "Account is required"
      throw new Error(localizedMsg);
  → 消费方: catch(err) → message.error(err.message)  // 直接显示本地化文本
```

三个 invoke 层封装均已接入：

| 封装函数 | resolveError 接入点 |
|----------|---------------------|
| `invokeRustDataFromStatus` | `throw new Error(resolveError(rawMsg))` |
| `invokeRustProto` | `throw new Error(resolveError(rawMsg))` |
| `AuthCommandException` | `super(resolveError(error.message))` |

这是一个**干净的架构边界**：Rust 负责返回语义化的 error key，前端 invoke 层负责翻译，消费方完全透明。

### 5.3 Station (Go)

**核心策略：Station 只返回 ErrorCode 数字码，客户端负责翻译。**

Station 通过 protobuf `ErrorCode` 枚举返回错误码。当前已分配
`10001..10010`、`20001..20008`、`30001..30017`、`30101..30110` 和
`40001..40008`；proposed `SC-D20` reserves `30201..30209` for Content
PreKey client errors. 客户端收到后：

```typescript
function handleStationError(response: ErrorResponse) {
  const localizedMessage = resolveError(response.code, response.message);
  message.error(localizedMessage);
}
```

`errors.json` 中通过 `"error.{code}"` 映射：

```json
{
  "error.10001": "Invalid resource format",
  "error.10008": "Account not found",
  "error.20001": "Unauthorized, please login again"
}
```

Station 侧无需 i18n 改动。Touch framework 已有 `ErrorResponse` 结构体携带 `ErrorCode`。
W7A must add `error.30201` through `error.30209` to the shared English and
Chinese error catalogs before the SC-D20 routes become active.

**Dashboard jsonError 扩展**（可选扩展）：新增 `error_key` 字符串字段供 Desktop 客户端直接使用 i18n key。

### 5.4 Rust I18nService 架构

`I18nService` 位于 Rust 基础设施层（`src/infrastructure/i18n/mod.rs`），作为 `AppState` 的成员被所有 Tauri command 共享。

```rust
pub struct I18nService {
    i18n_root: PathBuf,            // config_dir/i18n/ (deployed copy)
    dev_source: Option<PathBuf>,   // packages/locales/ (debug builds only)
}
```

#### Dev-mode Direct-Read

在 debug 构建中，`I18nService::new()` 自动探测 monorepo 的 `packages/locales/` 源目录。若存在，则 `load_resources()` 和 `resolve_key()` 直接从源目录读取 — **编辑 locale JSON 后刷新页面即可生效，无需手动 bump metadata.json 版本号**。

在 release 构建中，`dev_source` 始终为 `None`，所有读取走 `config/i18n/`（版本化部署的副本）。

#### 核心方法

| 方法 | 职责 |
|------|------|
| `new(config_dir)` | 初始化，解析 `{config_dir}/i18n/` 路径；debug 构建自动探测 dev_source |
| `deploy_builtin_packs(resource_dir)` | 版本与内容一致性部署：source/deployed 的 metadata version 和 en/、zh-CN/ 内容都一致才跳过；任一不一致则重新部署内置包。Production 路径必需 |
| `load_resources()` | dev_source 存在 → 直接读源目录；否则 → 扫描 config/i18n/ 所有子目录（含社区包），返回 `I18nResources` |
| `resolve_key(lang, ns, key)` | Rust 侧文本解析，优先读 dev_source，fallback 读 i18n_root |

#### 源目录解析

```
Production:  Tauri resource_dir/i18n/        ← bundled resources → deploy → config/i18n/
Dev mode:    detect_dev_source()             ← CARGO_MANIFEST_DIR → ../../.. → packages/locales/
             load_resources() 直接读 packages/locales/，跳过 config/i18n/
```

`detect_dev_source()` 在 `I18nService::new()` 时通过 `CARGO_MANIFEST_DIR` 逆向查找 monorepo 根目录下的 `packages/locales/`。`deploy_builtin_packs()` 仍然用于 production 路径的版本化部署。

#### 社区语言包

用户在 `config/i18n/` 下放置新的语言目录（如 `ja/`、`ko/`），`load_resources()` 会自动发现。内置语言包（en/、zh-CN/）由 App 管理，社区包永远不被覆盖。

### 5.5 种子数据 i18n 约定

种子数据（Default Agent、New Chat 等）使用 `i18n:` 前缀约定：

```json
{
  "title": "i18n:agent.default.title",
  "description": "i18n:agent.default.description"
}
```

前端渲染逻辑：

```typescript
function renderTitle(title: string, t: TFunction): string {
  if (title.startsWith('i18n:')) {
    return t(title.slice(5));   // strip "i18n:" prefix, pass to t()
  }
  return title;                 // user-created data, show as-is
}
```

此约定区分「系统预设数据」（需要 i18n）和「用户创建数据」（原样显示）。

### 5.6 OAuth2 HTML 页面 i18n

OAuth2 loopback callback 在 Rust 层直接生成 HTML 页面返回给浏览器。需要本地化的场景：

- 授权成功提示页
- 授权失败提示页
- 重定向等待页

实现方案：

1. 新增 `oauth.json` namespace（en/ + zh-CN/）
2. `I18nService` 新增 `resolve_key(lang, ns, key)` 方法
3. OAuth2 handler 从 `I18nService` 获取本地化字符串，注入 HTML 模板

---

## 6. ErrorCode 国际化策略

### 6.1 错误码三层体系

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1: Protobuf ErrorCode (Station ↔ Client 通信)               │
│   - 10001-10010: Actor/WellKnown                                  │
│   - 20001-20008: Request/Auth                                     │
│   - 30001-30017: Post/Comment                                     │
│   - 映射: errors.json "error.10001" → 翻译文案                     │
├──────────────────────────────────────────────────────────────────┤
│ Layer 2: Desktop AppError (Tauri Command → Frontend)              │
│   - AppResult::fail() message 字段已统一为 i18n key                │
│   - 如 "error.auth.accountRequired", "error.storage.readFailed"  │
│   - invoke 层 resolveError() 自动翻译                              │
├──────────────────────────────────────────────────────────────────┤
│ Layer 3: Validation Message (纯客户端)                             │
│   - 表单验证、输入校验                                              │
│   - 直接用 t('auth.login.xxx') 获取翻译                            │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Invoke 层自动解析架构

```
Rust:
  AppResult::fail(ErrorCode::InvalidArgument, "error.auth.accountRequired", None)
    │
    ▼ Tauri IPC serialization
Frontend (desktop_api.ts):
  invokeRustCommand ← { ok: false, error: { code: "INVALID_ARGUMENT", message: "error.auth.accountRequired" } }
    │
    ▼ invokeRustDataFromStatus / invokeRustProto / AuthCommandException
  resolveError("error.auth.accountRequired")
    │
    ▼ i18n.t("error.auth.accountRequired", { ns: "errors" })
  → "Account is required" (en) / "请填写账户" (zh-CN)
    │
    ▼ throw new Error("Account is required")
Consumer:
  catch(err) → message.error(err.message)   // 自动显示本地化文本，零改动
```

### 6.3 resolveError 实现

```typescript
// apps/desktop/src/i18n/error-resolver.ts
export function resolveError(code: number | string, fallbackMessage?: string): string {
  const key = `error.${code}`;
  const resolved = i18n.t(key, { ns: 'errors', defaultValue: '' });

  if (resolved && resolved !== key) return resolved;

  if (fallbackMessage) {
    return i18n.t('error.generic', { ns: 'errors', message: fallbackMessage });
  }

  return i18n.t('error.unknown', { ns: 'errors' });
}
```

解析优先级：精确 key 匹配 → generic fallback with message → unknown fallback。

---

## 7. 语言切换机制

### 7.1 语言检测优先级

```
1. 用户手动设置（持久化在 localStorage: 'peers-touch-lang'）
2. navigator.language 精确匹配
3. navigator.language 前缀匹配（zh-* → zh-CN）
4. Fallback: en
```

### 7.2 语言元信息

语言列表从 `metadata.json` 解析，通过 `load_resources()` 返回的 `LanguageInfo` 提供给前端：

```typescript
export interface LanguageInfo {
  code: string;           // "en", "zh-CN"
  name: string | null;    // "English", "Chinese (Simplified)"
  native_name: string | null;  // "English", "简体中文"
  namespaces: string[];   // namespace 列表
}
```

### 7.3 LanguageSwitcher 组件

`LanguageSwitcher` 组件已在以下位置使用：

- **LoginPage** — 页面右上角
- **SettingsPage** — General Tab

```
┌─────────────────────────────────┐
│  🌐 English          ▾         │
│  ┌───────────────────────────┐  │
│  │ English          ✓        │  │
│  │ 简体中文                   │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

切换调用 `changeLanguage(lang)` → `i18n.changeLanguage()` + `localStorage.setItem()`，立即生效无需重启。

---

## 8. 开发工作流

### 8.1 新增文案

```
1. 在 packages/locales/en/{namespace}.json 中添加 key + English text
2. 在 packages/locales/zh-CN/{namespace}.json 中添加对应中文翻译
3. 在代码中使用 t('namespace.feature.context') 引用
4. 如需新增 namespace，更新 metadata.json 中对应语言的 namespaces 数组
```

### 8.2 Key 命名规范

```
Pattern:  {namespace}.{feature}.{context}

Examples:
  common.action.cancel          — 通用按钮
  auth.login.title              — 登录页标题
  chat.session.empty            — 会话列表空态
  settings.general.language     — 设置页语言选项
  error.10001                   — Station ErrorCode 翻译
  error.auth.accountRequired    — Rust 层 Auth 领域错误
  error.boundary.title          — ErrorBoundary 崩溃页
  tts.provider.browser          — TTS 模块设置选项
```

**keySeparator: false** — key 中的点号是命名约定，不是 i18next 层级分隔。`t('auth.login.title')` 查找的是 JSON 中 `"auth.login.title"` 这个完整 key。

规则：
- 全小写，用 `.` 分隔语义段
- camelCase 仅用于多单词 context 段（如 `welcomeBack`、`switchAccount`）
- 避免缩写（`btn` → `button`，`msg` → `message`），约定俗成的除外
- 变量用 `{{paramName}}`

### 8.3 Factory Function 模式

当 Select options、Table columns 等模块级常量需要 i18n 时，使用工厂函数：

```typescript
function getXxxOptions(t: TFunction) {
  return [
    { value: 'a', label: t('xxx.option.a') },
    { value: 'b', label: t('xxx.option.b') },
  ];
}
```

在组件内调用 `getXxxOptions(t)` 确保每次 render 获取最新语言。

### 8.4 Class 组件 `<Translation>` 模式

Class 组件无法使用 Hook，使用 `<Translation>` render prop：

```tsx
import { Translation } from 'react-i18next';

<Translation ns="errors">
  {(t) => <p>{t('error.boundary.description')}</p>}
</Translation>
```

### 8.5 禁止事项

1. **禁止在 JSX/TSX 中直接写用户可见文本字符串**
2. **禁止在 Rust 层返回人类可读的英文错误消息，必须返回 i18n key** — 如 `"error.auth.accountRequired"` 而非 `"account is required"`
3. **禁止在 Station Go 代码中返回国际化文案（只返回 ErrorCode）**
4. **禁止使用 console/print 调试语句，只使用域内 logger**

---

## 9. 落地状态

### Phase 1: 基础设施搭建 ✅ Complete

- ✅ `packages/locales/` 目录，en / zh-CN 两个语言，16 个 namespace
- ✅ `metadata.json` 版本管理（当前 v0.5.8）
- ✅ Rust `I18nService` — deploy_builtin_packs + load_resources
- ✅ Tauri command `i18n_load_resources`
- ✅ `apps/desktop/src/i18n/index.ts` — runtime 异步加载
- ✅ `apps/desktop/src/i18n/error-resolver.ts` — resolveError
- ✅ `main.tsx` 中 `await initI18n()` 在 React render 前执行

### Phase 2: 前端全量迁移 ✅ Complete

- ✅ 全部 13 个页面迁移（LoginPage, SettingsPage, ChatPage, SearchPage, MemoryPage, NotesPage, CronPage, ChannelsPage, AppletsPage, AppletRuntimePage, AppletExample, AgentProfilePage, SharePage）
- ✅ 全部组件迁移（54 个文件、174+ useTranslation 调用）
- ✅ ErrorBoundary — `<Translation>` render prop 模式
- ✅ TTS Module — Factory function 模式 `getTtsProviderOptions(t)`
- ✅ 各 Settings Tab 组件全量 i18n

### Phase 3: Rust Error Key 统一 🔄 In Progress

- ✅ `desktop_api.ts` invoke 层三个封装均接入 `resolveError()`
- ✅ `AuthCommandException` 构造时自动 resolveError
- 🔄 Rust `AppResult::fail()` message 字段逐步替换为 i18n key
- 🔄 `errors.json` 持续扩充错误 key 覆盖

### Phase 4: 语言设置 UI ✅ Complete

- ✅ `LanguageSwitcher` 组件实现
- ✅ LoginPage 右上角语言切换
- ✅ Settings General 语言切换
- ✅ 语言偏好持久化到 localStorage
- ✅ 切换后即时生效

### Phase 5: 后端 i18n ⏳ Planned

- ⏳ 种子数据 `i18n:` 前缀约定
- ⏳ OAuth2 HTML 页面 — `I18nService.resolve_key()` + `oauth.json` namespace
- ⏳ Go Dashboard jsonError 新增 `error_key` 字段
- ⏳ Rust 侧 `resolve_key(lang, ns, key)` 方法

---

## 10. 文件清单

### 翻译源（packages/locales/）

```
packages/locales/
├── en/
│   ├── agent.json           ├── applet.json         ├── auth.json
│   ├── channels.json        ├── chat.json           ├── common.json
│   ├── cron.json            ├── errors.json         ├── layout.json
│   ├── memory.json          ├── notes.json          ├── provider.json
│   ├── search.json          ├── settings.json       ├── share.json
│   └── tts.json
├── zh-CN/
│   └── ... (同 en/ 结构，16 files)
├── metadata.json
├── types.ts
└── package.json
```

### 前端 i18n 模块（apps/desktop/src/i18n/）

```
apps/desktop/src/i18n/
├── index.ts                 ← initI18n(), changeLanguage(), getAvailableLanguages()
├── error-resolver.ts        ← resolveError()
└── types.d.ts               ← i18next CustomTypeOptions 声明
```

### Rust 基础设施（apps/desktop/src-tauri/）

```
apps/desktop/src-tauri/src/
├── infrastructure/i18n/
│   └── mod.rs               ← I18nService struct
├── interface/tauri_commands/
│   └── i18n.rs              ← i18n_load_resources command
└── main.rs                  ← setup 阶段调用 deploy_builtin_packs
```

### 前端消费文件（54 files, 174+ useTranslation calls）

```
apps/desktop/src/
├── main.tsx                          ← await initI18n()
├── components/
│   ├── ErrorBoundary.tsx             ← <Translation> render prop
│   ├── common/LanguageSwitcher.tsx   ← 语言切换组件
│   ├── ChatInput.tsx, SessionList.tsx, AgentList.tsx, ...
│   ├── settings/AccountTab.tsx, ProviderDetail.tsx, ProviderMenu.tsx, ...
│   └── chat/ChatSessionList.tsx, ChatMessageArea.tsx, ...
├── pages/
│   ├── LoginPage.tsx, SettingsPage.tsx, ChatPage.tsx, ...
│   └── SearchPage.tsx, MemoryPage.tsx, NotesPage.tsx, ...
└── modules/
    └── tts/index.tsx                 ← Factory function pattern
```

---

## 附录: 关键架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| **i18n 库** | i18next + react-i18next | 已安装；生态成熟；namespace 支持好；支持 Hook / render prop / HOC 多种消费模式 |
| **翻译资源格式** | JSON flat keys | i18next 原生支持；`keySeparator: false` 避免嵌套结构歧义 |
| **Runtime FS Loading** | Tauri Command 加载，非 Vite import | Tauri Desktop 运行时无 Vite dev server；需要支持社区语言包动态发现；Rust 层可做版本管理 |
| **keySeparator: false** | 点号是 key 命名约定 | 避免 i18next 将 `auth.login.title` 解析为嵌套结构 `{ auth: { login: { title } } }`；flat key 结构更简单、JSON 更易维护、避免 TypeScript 类型过深问题 |
| **Factory Function 模式** | `getXxxOptions(t: TFunction)` | 模块级常量（如 Select options）不能在组件外调用 Hook，工厂函数延迟到 render 时执行，确保语言切换后立即更新 |
| **Station 策略** | 只返回 ErrorCode，不做 i18n | 服务端不应关心展示语言；ErrorCode 是稳定的接口契约 |
| **Rust Error Key 策略** | message 字段统一为 i18n key | 干净的架构边界——Rust 返回语义化 key，前端 invoke 层自动翻译，消费方零改动。非"渐进替换"，而是明确的架构规范 |
| **Invoke 层自动闭环** | desktop_api.ts resolveError() | 所有 Rust error 在 invoke 封装层被翻译后才抛出，上层消费方 `catch(err) → message.error(err.message)` 自动显示本地化文本 |
| **版本化部署** | metadata.json version + 内置包内容比较 | 版本和内容都一致时跳过复制；防止漏升版本导致陈旧文案；社区语言包永不被覆盖 |

---

*本文档描述 Peers-Touch Desktop 多语言架构的已落地实现及后续规划。最后更新: 2026-04-11。*

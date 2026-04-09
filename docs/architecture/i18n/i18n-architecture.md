# Peers-Touch 多端多语言架构

> **Multi-Platform Internationalization Architecture**
>
> Created: 2026-04-09 | Status: Draft

---

## 1. 现状分析

### 1.1 各端 i18n 现状

| 端 | 现状 | 问题 |
|---|------|------|
| **Desktop (React/TS)** | `i18next` + `react-i18next` 已安装，**但零使用**。所有文案硬编码在 JSX 中，中英混杂。 | 无法切换语言；新增文案随意，中英混用严重。 |
| **Desktop (Rust/Tauri)** | 错误消息全部硬编码英文字符串（如 `"account is required"`）。 | 前端显示的错误信息无法国际化。 |
| **Station (Go)** | 错误消息硬编码在 Go 代码中，5+ 种不同错误返回格式并存。 | 无国际化能力；客户端无法翻译 Station 返回的错误。 |

### 1.2 核心矛盾

1. **无统一翻译源**：无标准化的翻译资源管理。
2. **错误码与文案耦合**：Station 直接返回英文 message，客户端无法本地化。
3. **中英混杂**：Desktop 页面中文英文混用，无统一规范。

---

## 2. 设计原则

1. **翻译源集中管理** — 所有翻译资源统一放在 `locales/` 目录下，按 namespace 分文件。
2. **错误码驱动，文案客户端负责** — Station/Rust 只返回 `ErrorCode`，客户端负责将 code 映射为本地化文案。
3. **按命名空间组织** — 翻译 key 按 `namespace.feature.context` 三段式组织，支持按需加载。
4. **TypeSafe** — 通过 TypeScript 类型约束，确保引用不存在的 key 在开发期被发现。

---

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                      LOCALE SOURCE (JSON)                            │
│                                                                       │
│  locales/                                                             │
│  ├── en/                         ← Master language                    │
│  │   ├── common.json             ← Shared: buttons, labels, time     │
│  │   ├── auth.json               ← Auth module                       │
│  │   ├── chat.json               ← Chat module                       │
│  │   ├── settings.json           ← Settings module                   │
│  │   ├── social.json             ← Social module                     │
│  │   ├── applets.json            ← Applet system                     │
│  │   └── errors.json             ← ErrorCode → message mapping       │
│  └── zh-CN/                                                           │
│      └── ... (same structure)                                         │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                          │
                    Build-time import
                          │
                          ▼
                   ┌───────────┐
                   │  Desktop   │
                   │  React/TS  │
                   │            │
                   │ i18next +  │
                   │ react-i18n │
                   │ ext        │
                   │ t('key')   │
                   └──────┬─────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │  UI Text  │   │  Error   │   │  Station  │
    │  t(key)   │   │  Resolve │   │  ErrorCode│
    │  直接翻译  │   │  code →  │   │  → 本地   │
    │           │   │  message │   │  翻译     │
    └──────────┘   └──────────┘   └──────────┘
```

---

## 4. 翻译源：统一 JSON 格式

### 4.1 目录结构

```
locales/                          ← 项目根目录下
├── en/                           ← English (master)
│   ├── common.json               ← Common UI: buttons, labels, time
│   ├── auth.json                 ← Auth: login, register, session
│   ├── chat.json                 ← Chat: messages, sessions
│   ├── settings.json             ← Settings page
│   ├── social.json               ← Social features
│   ├── applets.json              ← Applet system
│   └── errors.json               ← ErrorCode mapping
├── zh-CN/                        ← Simplified Chinese
│   └── ... (same structure)
└── _meta/
    └── supported.json            ← Supported languages registry
```

### 4.2 命名规范

翻译 key 采用**点分三段式**：`namespace.feature.context`

```json
// locales/en/auth.json
{
  "auth.login.title": "Welcome",
  "auth.login.subtitle": "Sign in to your account to continue",
  "auth.login.tab.quick": "Quick Login",
  "auth.login.tab.email": "Email Login",
  "auth.login.email.placeholder": "Email address",
  "auth.login.password.placeholder": "Password",
  "auth.login.submit": "Sign In",
  "auth.login.continueWith": "Continue with {{provider}}",
  "auth.login.waiting": "Waiting for authorization...",
  "auth.login.waitingHint": "Please complete authorization in the new window",
  "auth.login.success": "Login successful",
  "auth.login.successWelcome": "Welcome, {{name}}",
  "auth.login.failed": "Login failed",
  "auth.login.incomplete": "Login incomplete, please retry.",
  "auth.login.startAuth": "Start Login",
  "auth.login.loginWith": "Sign in with {{provider}}",
  "auth.login.redirectHint": "You will be redirected to {{provider}} for authorization",
  "auth.welcomeBack.title": "Welcome back,",
  "auth.welcomeBack.switchAccount": "Switch Account",
  "auth.welcomeBack.continue": "Continue"
}
```

```json
// locales/en/common.json
{
  "common.action.cancel": "Cancel",
  "common.action.confirm": "Confirm",
  "common.action.retry": "Retry",
  "common.action.save": "Save",
  "common.action.edit": "Edit",
  "common.action.delete": "Delete",
  "common.action.done": "Done",
  "common.action.back": "Back",
  "common.state.loading": "Loading...",
  "common.state.noData": "No Data",
  "common.time.today": "Today",
  "common.time.yesterday": "Yesterday"
}
```

```json
// locales/en/errors.json
{
  "error.10001": "Invalid resource format",
  "error.10003": "Invalid username",
  "error.10004": "Invalid email",
  "error.10005": "Invalid password",
  "error.10006": "Account already exists",
  "error.10008": "Account not found",
  "error.10009": "Invalid credentials",
  "error.20001": "Unauthorized, please login again",
  "error.20002": "Invalid request",
  "error.20008": "Server error, please try again later",
  "error.auth.accountRequired": "Account is required",
  "error.auth.passwordRequired": "Password is required",
  "error.auth.tokenMissing": "Session expired, please login again",
  "error.auth.tokenInvalid": "Session invalid, please login again",
  "error.generic": "An error occurred: {{message}}",
  "error.network": "Network error, please check your connection",
  "error.unknown": "An unknown error occurred"
}
```

### 4.3 变量插值

使用 i18next 标准语法 `{{var}}`：

```
Simple:       "Hello, {{name}}"
Plural:       "You have {{count}} message(s)"
```

---

## 5. 各层消费方案

### 5.1 Desktop (React + i18next)

Desktop 已安装 `i18next@^23` 和 `react-i18next@^14`，直接启用。

#### 目录结构

```
apps/desktop/src/
├── i18n/
│   ├── index.ts                  ← i18next init config
│   ├── error-resolver.ts         ← ErrorCode → localized message
│   └── types.ts                  ← TypeScript key type definitions
```

#### 初始化

```typescript
// apps/desktop/src/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// JSON files imported at build time (vite handles JSON import)
import enCommon from '../../../locales/en/common.json';
import enAuth from '../../../locales/en/auth.json';
import enChat from '../../../locales/en/chat.json';
import enSettings from '../../../locales/en/settings.json';
import enErrors from '../../../locales/en/errors.json';
import enSocial from '../../../locales/en/social.json';
import enApplets from '../../../locales/en/applets.json';

import zhCommon from '../../../locales/zh-CN/common.json';
import zhAuth from '../../../locales/zh-CN/auth.json';
import zhChat from '../../../locales/zh-CN/chat.json';
import zhSettings from '../../../locales/zh-CN/settings.json';
import zhErrors from '../../../locales/zh-CN/errors.json';
import zhSocial from '../../../locales/zh-CN/social.json';
import zhApplets from '../../../locales/zh-CN/applets.json';

const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    chat: enChat,
    settings: enSettings,
    errors: enErrors,
    social: enSocial,
    applets: enApplets,
  },
  'zh-CN': {
    common: zhCommon,
    auth: zhAuth,
    chat: zhChat,
    settings: zhSettings,
    errors: zhErrors,
    social: zhSocial,
    applets: zhApplets,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('peers-touch-lang')
    || (navigator.language.startsWith('zh') ? 'zh-CN' : 'en'),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'auth', 'chat', 'settings', 'errors', 'social', 'applets'],
  interpolation: {
    escapeValue: false,     // React already escapes
  },
});

export default i18n;
```

#### 组件使用

```tsx
import { useTranslation } from 'react-i18next';

function LoginPage() {
  const { t } = useTranslation('auth');

  return (
    <>
      <h2>{t('auth.login.title')}</h2>
      <p>{t('auth.login.subtitle')}</p>
      <button>{t('auth.login.submit')}</button>
    </>
  );
}
```

#### 错误码本地化

```typescript
// apps/desktop/src/i18n/error-resolver.ts
import i18n from './index';

/**
 * Resolve an error code (from Station or Rust) to a localized message.
 * Falls back to the raw message if no translation key exists.
 */
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

#### 语言切换

```typescript
import i18n from '../i18n';

function changeLanguage(lang: string) {
  i18n.changeLanguage(lang);
  localStorage.setItem('peers-touch-lang', lang);
}
```

### 5.2 Desktop Rust 层 (Tauri)

**核心策略：Rust 只负责返回 ErrorCode，不负责 message 翻译。**

当前 Rust 层的 `AppResult::fail()` 携带 `message: String`，这些 message 是英文硬编码。
改造方向：

```rust
// Before (current)
AppResult::fail(ErrorCode::InvalidArgument, "account is required".to_string(), None)

// After (target)
// message 字段变为 error_key，前端用它查翻译
AppResult::fail(ErrorCode::InvalidArgument, "error.auth.accountRequired".to_string(), None)
```

**渐进策略**：不需要一步到位改所有。先在前端做兼容：
- 如果 `message` 字段能匹配到 `errors.json` 中的 key → 显示翻译
- 否则 → 直接显示 message 原文

这样可以逐步将 Rust 中的硬编码 message 替换为 i18n key，无需一次性全改。

### 5.3 Station (Go)

**核心策略：Station 只返回 ErrorCode 数字码，message 字段为英文 fallback，客户端用 code 查本地翻译。**

Station 当前已有 protobuf `ErrorCode` 枚举（10001-30017），客户端收到错误响应后：

```typescript
// Desktop error handling
function handleStationError(response: ErrorResponse) {
  const localizedMessage = resolveError(response.code, response.message);
  message.error(localizedMessage);
}
```

Station 侧**无需改动**——只需确保所有错误响应携带 `ErrorCode` 数字码即可。
`errors.json` 中通过 `"error.{code}"` 映射翻译。

---

## 6. ErrorCode 国际化策略

### 6.1 错误码层次

```
┌──────────────────────────────────────────────────────────┐
│ Layer 1: Protobuf ErrorCode (Station ↔ Client 通信)       │
│   - 10001-10010: Actor/WellKnown                          │
│   - 20001-20008: Request/Auth                             │
│   - 30001-30017: Post/Comment                             │
│   - 映射在 errors.json: "error.10001" → 翻译文案           │
├──────────────────────────────────────────────────────────┤
│ Layer 2: Desktop AppError.code (Tauri Command → Frontend) │
│   - InvalidArgument, Unauthorized, Forbidden...           │
│   - message 字段逐步替换为 i18n key                        │
│   - 映射在 errors.json: "error.auth.xxx" → 翻译文案        │
├──────────────────────────────────────────────────────────┤
│ Layer 3: Validation Message (纯客户端)                     │
│   - 表单验证、输入校验                                      │
│   - 直接用 t('auth.login.xxx') 获取翻译                    │
└──────────────────────────────────────────────────────────┘
```

### 6.2 前端统一错误展示

```typescript
// apps/desktop/src/utils/error-display.ts
import { message as antdMessage } from 'antd';
import { resolveError } from '../i18n/error-resolver';

interface StationError {
  code?: number;
  message?: string;
}

interface AppError {
  code?: string;
  message?: string;
}

export function showError(error: StationError | AppError | Error | string) {
  let text: string;

  if (typeof error === 'string') {
    text = resolveError(error);
  } else if (error instanceof Error) {
    text = error.message;
  } else if (typeof error.code === 'number') {
    // Station protobuf ErrorCode
    text = resolveError(error.code, error.message);
  } else if (typeof error.code === 'string') {
    // Tauri AppError
    text = resolveError(error.message || error.code);
  } else {
    text = error.message || resolveError('unknown');
  }

  antdMessage.error(text);
}
```

---

## 7. 语言切换机制

### 7.1 语言检测优先级

```
1. 用户手动设置（持久化在 localStorage）
2. 系统语言（navigator.language）
3. Fallback: en
```

### 7.2 支持语言注册

```json
// locales/_meta/supported.json
{
  "languages": [
    { "code": "en", "name": "English", "nativeName": "English" },
    { "code": "zh-CN", "name": "Chinese (Simplified)", "nativeName": "简体中文" }
  ],
  "default": "en"
}
```

### 7.3 Desktop 语言设置 UI

在 Settings → General 中新增 Language 选项：

```
┌─────────────────────────────────┐
│  🌐 Language                     │
│  ┌───────────────────────────┐  │
│  │ English          ✓        │  │
│  │ 简体中文                   │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

切换立即生效（i18next.changeLanguage），无需重启。

---

## 8. 开发工作流

### 8.1 新增文案

```
1. 在 locales/en/{namespace}.json 中添加 key + English text
2. 在 locales/zh-CN/{namespace}.json 中添加对应中文翻译
3. 在代码中使用 t('namespace.feature.context') 引用
```

### 8.2 Key 命名规范

```
Pattern:  {namespace}.{feature}.{context}

Examples:
  common.action.cancel          — 通用按钮
  auth.login.title              — 登录页标题
  chat.session.empty            — 会话列表空态
  settings.general.language     — 设置页语言选项
  error.10001                   — ErrorCode 翻译
  error.auth.accountRequired    — Auth 领域错误
```

规则：
- 全小写，用 `.` 分隔层级
- camelCase 仅用于多单词 context 段（如 `welcomeBack`、`switchAccount`）
- 避免缩写（`btn` → `button`，`msg` → `message`），但约定俗成的除外
- 参数用 `{{paramName}}`

### 8.3 禁止事项

1. **禁止在 JSX/TSX 中直接写用户可见文本字符串**
2. **禁止在 Rust 层返回面向用户的 message（应返回 error key）**
3. **禁止在 Station Go 代码中返回国际化文案（只返回 ErrorCode）**

---

## 9. Desktop 落地计划

### Phase 1: 基础设施搭建

- [ ] 创建 `locales/` 目录，建立 en / zh-CN 两个语言
- [ ] 创建 namespace JSON 文件（common, auth, chat, settings, errors, social, applets）
- [ ] 实现 `apps/desktop/src/i18n/index.ts` — i18next 初始化
- [ ] 实现 `apps/desktop/src/i18n/error-resolver.ts` — 错误码翻译
- [ ] 在 `main.tsx` 中引入 i18n 初始化

### Phase 2: 页面迁移（高优先级页面）

- [ ] `LoginPage.tsx` — 中英混杂最严重，优先迁移
- [ ] `SettingsPage.tsx` — 包含大量 label、tab 名称
- [ ] `ChatPage.tsx` — 核心功能页
- [ ] 通用组件 `PageHeader`, `ErrorBoundary`, `SplashScreen` 等

### Phase 3: 错误信息国际化

- [ ] 梳理所有 Rust `AppResult::fail()` 的 message 字段
- [ ] 建立 `errors.json` 完整 mapping
- [ ] 前端 error handler 统一走 `resolveError()`

### Phase 4: 语言设置 UI

- [ ] Settings → General 增加语言切换组件
- [ ] 语言偏好持久化到 localStorage
- [ ] 验证切换后所有页面即时更新

---

## 10. 文件清单

本方案落地后，项目新增/修改的文件列表：

```
New files:
  locales/en/common.json
  locales/en/auth.json
  locales/en/chat.json
  locales/en/settings.json
  locales/en/social.json
  locales/en/applets.json
  locales/en/errors.json
  locales/zh-CN/common.json
  locales/zh-CN/auth.json
  locales/zh-CN/chat.json
  locales/zh-CN/settings.json
  locales/zh-CN/social.json
  locales/zh-CN/applets.json
  locales/zh-CN/errors.json
  locales/_meta/supported.json
  apps/desktop/src/i18n/index.ts
  apps/desktop/src/i18n/error-resolver.ts
  apps/desktop/src/i18n/types.ts            (optional: key type gen)

Modified files:
  apps/desktop/src/main.tsx                 (import i18n init)
  apps/desktop/src/pages/LoginPage.tsx      (t() migration)
  apps/desktop/src/pages/SettingsPage.tsx   (t() migration + language UI)
  apps/desktop/src/pages/ChatPage.tsx       (t() migration)
  ... (all pages/components with hardcoded text)
```

---

## 附录: 技术选型理由

| 决策 | 选择 | 理由 |
|------|------|------|
| Desktop i18n 库 | i18next + react-i18next | 已安装；生态成熟；namespace 支持好 |
| 翻译资源格式 | JSON | i18next 原生支持；Vite 可直接 import |
| 翻译 key 风格 | 点分层级 | 清晰表达归属；i18next 天然支持 |
| Station 策略 | 不做 i18n，只返回 ErrorCode | 服务端不应关心展示语言 |
| Rust 策略 | message 渐进替换为 error key | 兼容现状，逐步迁移 |

---

*本文档描述 Peers-Touch Desktop 多语言架构的设计方案。经评审确认后进入实施阶段。*

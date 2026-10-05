# I18n Rollout Status

## 1. 文档定位

本文是 `../i18n-architecture.md` 的落地状态与扩展推进附属文档。

本文记录：

- 当前落地状态
- 已完成能力
- 进行中能力
- 后续扩展方向

架构真源以：

- `../i18n-architecture.md`

为准。

## 2. 当前状态

| 能力 | 状态 | 说明 |
|------|------|------|
| **翻译源管理** | ✅ Landed | `packages/locales/` 16 个 namespace × 2 语言，metadata.json 版本管理 |
| **Runtime FS Loading** | ✅ Landed | Rust I18nService 部署 + 扫描 → Tauri Command → 前端异步加载 |
| **Desktop 全量 i18n** | ✅ Landed | 54 个文件、174+ `useTranslation` 调用，覆盖全部 13 个页面及组件 |
| **Rust Error Key** | 🔄 In Progress | `AppResult::fail()` message 统一为 i18n key，invoke 层自动翻译 |
| **语言切换** | ✅ Landed | LoginPage + Settings General 均有 LanguageSwitcher |
| **社区语言包** | ✅ Landed | config/i18n/ 支持用户自行放置社区翻译目录 |
| **后端 i18n 扩展** | ⏳ Planned | 种子数据 i18n、OAuth2 HTML 页面、Go Dashboard error_key |

## 3. 后续扩展

- Dashboard `jsonError.error_key` 扩展
- Rust `resolve_key(lang, ns, key)` 能力落地
- 种子数据 `i18n:` 前缀约定落地
- OAuth2 callback HTML 页面本地化

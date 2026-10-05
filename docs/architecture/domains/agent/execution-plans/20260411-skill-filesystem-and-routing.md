# P0: Skill 文件系统、渐进式披露与 Skills Guard 安全扫描

## 依赖

- 依赖 System Prompt Assembly（skill index 需要注入 system prompt）
- 依赖 Agent Turn Loop（tool call routing 需要 turn loop 就绪）

## 目标

在 Station 中实现 Skill 的完整生命周期管理：存储、渐进式披露、即时修补、安全扫描（Skills Guard），使 LLM 能够在运行时自主发现、加载、创建和修补 skill，同时通过多层安全扫描机制防范恶意 skill 内容。

## Hermes 参照

| 文件 | 职责 |
|---|---|
| `tools/skills_tool.py` | `skills_list()`, `skill_view()` 渐进式披露 |
| `tools/skill_manager_tool.py` | `skill_manage()` 创建/修补/删除 |
| `agent/prompt_builder.py` | `build_skills_system_prompt()` 索引构建 |
| **`tools/skills_guard.py`** | **Skills Guard 安全扫描引擎：威胁检测、信任分级、verdict 判定、报告生成** |

## 当前状态

- Desktop Tauri `application::skills` 是 stub 实现（in-memory Vec），无真实持久化
- Station 没有 skill 存储能力，没有安全扫描能力
- Desktop SkillsTab 有 UI 但没有真实后端
- 不存在任何 trust level / install policy 机制

---

## 交付物

### 1. Skill 数据模型

```sql
CREATE TABLE agent_skills (
    skill_id      TEXT PRIMARY KEY,
    agent_id      TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL,
    category      TEXT,
    platforms     TEXT,          -- JSON array: ["macos", "linux"]
    conditions    TEXT,          -- JSON: { "fallback_for": [...], "requires": [...] }
    content       TEXT NOT NULL, -- SKILL.md 全文
    source        TEXT,          -- 安装来源: "builtin" | "trusted" | "community" | "agent-created"
    trust_level   TEXT,          -- 信任等级: "builtin" | "trusted" | "community" | "agent-created"
    scan_verdict  TEXT,          -- 扫描结论: "safe" | "caution" | "dangerous" | NULL
    version       INTEGER DEFAULT 1,
    created_at    TIMESTAMP,
    updated_at    TIMESTAMP,
    UNIQUE(agent_id, name)
);
```

### 2. `skill_service.go`

Skill 核心业务逻辑，对应 hermes `skills_tool.py` + `skill_manager_tool.py`。

| Method | 对应 Hermes | 用途 |
|---|---|---|
| `ListSkills(agentID)` | `skills_list()` | 返回 name + description 列表（Tier 1 渐进式披露） |
| `GetSkill(agentID, name)` | `skill_view(name)` | 返回 SKILL.md 全文（Tier 2） |
| `CreateSkill(agentID, name, content)` | `skill_manage(action='create')` | 创建新 skill，写入前触发 Skills Guard 扫描 |
| `PatchSkill(agentID, name, oldStr, newStr)` | `skill_manage(action='patch')` | fuzzy find-and-replace 即时修补 |
| `DeleteSkill(agentID, name)` | `skill_manage(action='delete')` | 删除 skill |
| `BuildSkillIndex(agentID)` | `build_skills_system_prompt()` | 构建 system prompt index block |

### 3. `skills_guard_service.go`

Skills Guard 安全扫描引擎，对应 hermes `tools/skills_guard.py`。完整的威胁检测、信任分级、verdict 判定和报告生成。

#### 3.1 威胁类别体系（13 类）

| # | Category | 说明 | 代表性正则模式示例 |
|---|---|---|---|
| 1 | `exfiltration` | 数据外泄 | `curl\s+.*-d\s+.*\$`, `wget\s+.*--post-data`, `\$\(env\)`, `os\.environ`, `sendmail.*<` |
| 2 | `injection` | Prompt injection | `you are now`, `ignore (?:previous\|all) instructions`, `system:\s*`, `IMPORTANT:.*override`, `\<\|im_start\|>system` |
| 3 | `destructive` | 破坏性操作 | `rm\s+-rf\s+/`, `mkfs\.`, `dd\s+if=.*of=/dev/`, `format\s+[cC]:`, `>\s*/dev/sd[a-z]` |
| 4 | `persistence` | 持久化驻留 | `crontab\s+-[el]`, `@reboot`, `/etc/rc\.local`, `launchctl\s+load`, `systemctl\s+enable` |
| 5 | `network` | 异常网络行为 | `nc\s+-[lp]`, `bash\s+-i\s+>&\s+/dev/tcp/`, `ncat\s+--exec`, `socat\s+TCP-LISTEN`, `\.listen\(\d+\)` |
| 6 | `obfuscation` | 代码混淆 | `base64\s+-d\s*\|.*sh`, `eval\s*\(.*base64`, `\$\{!.*\}`, `printf\s+.*\\x[0-9a-f]`, `exec\(compile\(` |
| 7 | `structural` | 文件结构异常 | （非正则，由结构性检查处理） |
| 8 | `traversal` | 路径穿越 | `\.\.\/`, `\.\.\\\\`, `%2e%2e%2f`, `%2e%2e/`, `\.\./\.\./\.\./` |
| 9 | `mining` | 加密货币挖矿 | `xmrig`, `stratum\+tcp://`, `coinhive`, `cryptonight`, `minerd` |
| 10 | `supply_chain` | 供应链攻击 | `pip\s+install\s+--index-url`, `npm\s+install\s+.*--registry`, `curl.*\|\s*bash`, `wget.*\|\s*sh`, `go\s+install\s+.*@` |
| 11 | `execution` | 危险执行 | `chmod\s+\+x`, `chmod\s+[0-7]*[1357]`, `\.\/[a-zA-Z]`, `exec\s+`, `subprocess\.call\(` |
| 12 | `privilege_escalation` | 提权 | `sudo\s+`, `su\s+-`, `doas\s+`, `pkexec`, `setuid` |
| 13 | `credential_exposure` | 凭证暴露 | `(?:password\|passwd\|pwd)\s*=\s*["'][^"']+["']`, `(?:api_key\|apikey\|secret)\s*=\s*["']`, `AKIA[0-9A-Z]{16}`, `ghp_[a-zA-Z0-9]{36}`, `sk-[a-zA-Z0-9]{48}` |

> 完整规则集 60+ 条正则，按 category 分组，每条包含 pattern_id, severity, description。

#### 3.2 结构性检查（Structural Checks）

| 检查项 | 常量名 | 阈值 | Severity |
|---|---|---|---|
| 文件数量 | `MAX_FILE_COUNT` | 50 | high |
| 总大小 | `MAX_TOTAL_SIZE_KB` | 1024 (1 MB) | high |
| 单文件大小 | `MAX_SINGLE_FILE_KB` | 256 | medium |

#### 3.3 二进制文件检测

可疑二进制扩展名列表 `SUSPICIOUS_BINARY_EXTENSIONS`：

```
.exe, .dll, .so, .dylib, .bin, .dat, .com, .msi, .dmg, .app, .deb, .rpm
```

检测到任何上述扩展名的文件 → severity = `critical`, category = `execution`。

#### 3.4 Symlink 逃逸检测

```
对 skill 目录下每个 symlink:
  1. resolved_path = os.path.realpath(symlink_path)
  2. if not resolved_path.is_relative_to(skill_dir):
       → Finding(severity="critical", category="traversal")
```

#### 3.5 不可见 Unicode 字符检测

扫描 17 种零宽度/方向控制字符：

| # | 字符 | Code Point |
|---|---|---|
| 1 | Zero-Width Space | `U+200B` |
| 2 | Zero-Width Non-Joiner | `U+200C` |
| 3 | Zero-Width Joiner | `U+200D` |
| 4 | Left-to-Right Mark | `U+200E` |
| 5 | Right-to-Left Mark | `U+200F` |
| 6 | Left-to-Right Embedding | `U+202A` |
| 7 | Right-to-Left Embedding | `U+202B` |
| 8 | Pop Directional Formatting | `U+202C` |
| 9 | Left-to-Right Override | `U+202D` |
| 10 | Right-to-Left Override | `U+202E` |
| 11 | Word Joiner | `U+2060` |
| 12 | Function Application | `U+2061` |
| 13 | Invisible Times | `U+2062` |
| 14 | Invisible Separator | `U+2063` |
| 15 | Invisible Plus | `U+2064` |
| 16 | Inhibit Symmetric Swapping | `U+2069` |
| 17 | Zero-Width No-Break Space (BOM) | `U+FEFF` |

检测到不可见字符 → severity = `high`, category = `obfuscation`。

#### 3.6 信任等级（Trust Level）

| Trust Level | 说明 | 扫描行为 |
|---|---|---|
| `builtin` | 随 agent 发行的内置 skill | **不扫描**，直接放行 |
| `trusted` | 来自 openai/anthropic 等官方仓库 | 扫描，放宽阈值 |
| `community` | 其他所有来源 | **严格扫描** |
| `agent-created` | LLM 在对话中自主创建的 skill | 扫描 |

#### 3.7 INSTALL_POLICY 矩阵

`trust_level × verdict` 决定安装行为：

| Trust Level ╲ Verdict | `safe` | `caution` | `dangerous` |
|---|---|---|---|
| `builtin` | allow | allow | allow |
| `trusted` | allow | allow | block |
| `community` | allow | block | block |
| `agent-created` | allow | allow | ask |

- **allow** — 直接安装/加载，无需用户干预
- **ask** — 弹出确认对话框，提示用户审核扫描报告后决定
- **block** — 拒绝安装，返回扫描报告说明原因

#### 3.8 数据结构

```go
// Finding 表示单条扫描发现
type Finding struct {
    PatternID   string   // 匹配的规则 ID，如 "exfil-curl-post"
    Severity    string   // "critical" | "high" | "medium" | "low"
    Category    string   // 13 种威胁类别之一
    File        string   // 触发文件相对路径
    Line        int      // 触发行号
    Match       string   // 匹配的文本片段
    Description string   // 规则描述
}

// ScanResult 表示对一个 skill 的完整扫描结果
type ScanResult struct {
    SkillName   string    // skill 名称
    Source      string    // 安装来源 URL
    TrustLevel  string    // "builtin" | "trusted" | "community" | "agent-created"
    Verdict     string    // "safe" | "caution" | "dangerous"
    Findings    []Finding
    ScannedAt   time.Time
    Summary     string    // 人类可读的扫描摘要
}
```

#### 3.9 Verdict 判定逻辑

```
if any finding.severity == "critical":
    verdict = "dangerous"
elif any finding.severity == "high":
    verdict = "caution"
elif len(findings) > 0:
    verdict = "caution"
else:
    verdict = "safe"
```

#### 3.10 `format_scan_report()` 报告生成

生成人类可读的扫描报告，用于 `ask` 场景下向用户展示，以及 `block` 场景下的错误说明。

格式：

```
🔍 Skill Security Scan: {skill_name}
Trust Level: {trust_level} | Verdict: {verdict}
Scanned at: {scanned_at}

⚠ {findings_count} finding(s):

  [{severity}] {category}: {description}
  → {file}:{line} | match: "{match}"

  [{severity}] {category}: {description}
  → {file}:{line} | match: "{match}"

Summary: {summary}
```

### 4. Skill Index 构建规则

将 skill 列表注入 system prompt，触发 LLM 自主发现和加载：

```
## Skills (mandatory)
Before replying, scan the skills below. If one clearly matches your task,
load it with skill_view(name) and follow its instructions.
If a skill has issues, fix it with skill_manage(action='patch').

<available_skills>
  category:
    - skill-name: description
    - another-skill: description
</available_skills>
```

条件激活规则（构建 index 时过滤）：

- `platforms` — 按当前 OS 平台筛选，不匹配则不出现在 index 中
- `fallback_for_toolsets` — 当主 toolset 可用时隐藏该 skill
- `requires_tools` — 当依赖的 tool 不在当前 tool definitions 中时隐藏

### 5. Skill 作为 Tool 暴露

在 turn 的 tool definitions 中注册三个 tool schema，与 hermes 保持一致：

| Tool Name | 对应 Method | 渐进式披露 Tier |
|---|---|---|
| `skills_list` | `ListSkills` | Tier 1: name + description |
| `skill_view` | `GetSkill` | Tier 2: SKILL.md 全文 |
| `skill_manage` | `CreateSkill` / `PatchSkill` / `DeleteSkill` | Tier 3: 创建/修补/删除 |

渐进式披露四层：

1. **Tier 0** — System prompt index 自动注入分类摘要
2. **Tier 1** — `skills_list` 返回 name + description 列表
3. **Tier 2** — `skill_view(name)` 加载 SKILL.md 全文 + linked files 列表
4. **Tier 3** — `skill_view(name, file_path)` 加载引用文件

### 6. SKILL.md 内容校验

| 校验项 | 规则 |
|---|---|
| frontmatter | 必须包含 `name` 和 `description` 字段 |
| `description` 长度 | ≤ 1024 chars |
| 全文长度 | ≤ 100,000 chars |
| 安全扫描 | 写入前经过 Skills Guard 扫描，verdict 为 `block` 时拒绝 |

### 7. 即时修补（Instant Patching）

- `skill_manage(action='patch', old_string=..., new_string=...)` 使用 fuzzy find-and-replace
- System prompt 里的 SKILLS_GUIDANCE 写死了：`"If a skill has issues, fix it with skill_manage(action='patch')"`
- 修补后自动清除 skills prompt cache

---

## 步骤

| # | 任务 | 交付物 |
|---|---|---|
| 1 | 创建 `agent_skills` 表（含 trust_level, scan_verdict 字段） | DDL migration |
| 2 | 实现 `skill_service.go`（CRUD + BuildIndex） | skill_service.go |
| 3 | 实现 `skills_guard_service.go`（13 类威胁检测 + 结构性检查 + unicode 检测 + verdict 判定 + 报告生成） | skills_guard_service.go |
| 4 | 在 `skill_service.go` 的 Create 流程中集成 Skills Guard 扫描，根据 trust_level × verdict 矩阵决定 allow/ask/block | skill_service.go 更新 |
| 5 | 在 `prompt_assembly_service.go` 中调用 `BuildSkillIndex` 构建 skills block，应用条件激活过滤 | prompt_assembly_service.go |
| 6 | 在 turn loop 中注册 `skills_list`, `skill_view`, `skill_manage` tool schemas | tool registration |
| 7 | 在 tool call handler 中路由 skill tool calls 到 skill_service | tool routing |
| 8 | 在 Desktop SkillsTab 中接入真实 API，展示 scan verdict badge | SkillsTab.tsx |

---

## 验收标准

- [ ] LLM 能在对话中通过 `skills_list` 发现所有可用 skill
- [ ] LLM 能通过 `skill_view` 加载 skill 全文
- [ ] LLM 能通过 `skill_manage(create)` 创建新 skill，且下次对话能发现
- [ ] LLM 能通过 `skill_manage(patch)` 修补现有 skill
- [ ] Skill index 按条件激活规则出现在 system prompt 中
- [ ] **community 来源的 dangerous skill 被 block，拒绝安装**
- [ ] **community 来源的 caution skill 被 block，拒绝安装**
- [ ] **agent-created 的 dangerous skill 触发 ask，提示用户确认**
- [ ] **trusted 来源的 dangerous skill 被 block**
- [ ] **不可见 Unicode 字符（U+200B ~ U+FEFF）被检测并标记为 high severity**
- [ ] **结构性检查生效：文件数 > 50 / 总大小 > 1 MB / 单文件 > 256 KB → 产生 Finding**
- [ ] **二进制文件（.exe, .dll, .so, .dylib 等）被检测为 critical**
- [ ] **Symlink 逃逸（指向 skill 目录外）被检测为 critical**
- [ ] **`format_scan_report()` 生成人类可读的扫描报告**
- [ ] 写入含 prompt injection 内容的 skill 被 injection 类正则捕获
- [ ] builtin skill 不经过扫描，直接放行

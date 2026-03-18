# Prompt System 改进计划

> 针对 .trae/rules 和 .prompts/ 系统的新鲜性和完整性审查与改进

## 📋 执行摘要

**发现的主要问题**：

1. ❌ **缺少 AI 工作流程指引**：AI 完成能力建设后没有自测要求和指引
2. ❌ **测试方法不明确**：各平台的测试方法分散，缺少统一的测试工作流
3. ❌ **第一级原则动作不清晰**：哪些是必须执行的、不可跳过的步骤没有明确标注
4. ⚠️ **工作流程文档不完整**：现有 `14-workflow.md` 缺少 AI Agent 工作流部分

***

## 🎯 改进目标

### 1. 建立 AI 工作流规范

**目的**：确保 AI 在完成任务后能够自主验证工作成果

**具体要求**：

* 定义 AI 必须执行的验证步骤（第一级原则）

* 明确不同类型任务的验证方法

* 建立自测失败时的处理流程

### 2. 强化测试要求（在现有文档中）

**目的**：确保 AI 必须执行测试验证

**具体要求**：

* 在 14-workflow\.md 中强化"测试是强制性的"

* 明确标注测试步骤为 🚨 必须执行

* 添加测试失败的处理流程

### 3. 标注第一级原则动作

**目的**：明确哪些步骤是不可跳过的、必须执行的

**具体要求**：

* 在现有规则中标注 🚨、⭐️、🔴 等优先级标记

* 区分"建议性"和"强制性"规则

* 建立规则违反的后果说明

***

## 📊 现状分析

### ✅ 已有的良好实践

1. **Workflow 文档已存在** (`.prompts/10-GLOBAL/14-workflow.md`)

   * 包含质量检查流程（Lint、Build、Test）

   * 有 Git pre-commit hooks 示例

   * 明确了各平台的检查命令

2. **测试基础设施已建立**

   * Station: `qa/station/api_tests/` - API 测试脚本

   * Client: 单元测试框架（Flutter test、Dart test）

   * Proto 验证脚本：`test_proto_final.sh`、`test_proto_api.sh`

3. **代码规范已完整** (`.prompts/10-GLOBAL/13-coding-standards.md`)

   * Dart/Flutter 规范详细

   * Go 规范完整

   * 包含 Linting 和格式化要求

### ❌ 缺失的关键内容

#### 1. AI 工作流规范（增强现有文档）

**位置**：`.prompts/10-GLOBAL/14-workflow.md`（已存在，需要增强）

**缺失内容**：

* AI 完成代码后的强制验证步骤（需要明确标注为"必须"）

* 如何判断任务是否"真正完成"的清单

* 自测失败时的处理流程和示例

* 何时可以向用户报告"完成"的标准

#### 2. 测试方法（14-workflow\.md 已包含✅）

**位置**：`.prompts/10-GLOBAL/14-workflow.md`（已存在）

**已有内容**：

* ✅ 各平台测试命令（flutter test / go test）

* ✅ Lint、Build、Test 检查流程

* ✅ Quality Checklist

* ✅ 测试示例代码

* ✅ Pre-commit hooks 示例

**不需要新建测试指南文档**

#### 3. 第一级原则清单

**位置**：应该在 `.prompts/10-GLOBAL/00-first-principles.md`（新建）

**缺失内容**：

* 不可违反的架构原则（如 Proto-First、No StatefulWidget）

* 必须执行的验证步骤（Lint → Build → Test）

* 代码提交前的强制检查清单

* 违反原则的后果和补救措施

#### 4. 现有文档需要增强的部分

**14-workflow\.md** 需要添加：

* "AI Agent 专用工作流"章节

* "自测与验证"章节强化

* "失败处理流程"章节

**project\_rules.md** 需要添加：

* "第一级原则"速查表

* "AI 工作完成标准"清单

***

## 🛠️ 具体改进方案

### 方案 A：创建新文档（推荐）

**优点**：

* 结构清晰，易于查找

* 不影响现有文档

* 可以详细展开每个主题

**新建文件**：

```
.prompts/10-GLOBAL/
└── 00-first-principles.md      # 🔴 第一级原则（NEW）
```

**增强现有文件**：

```
.prompts/10-GLOBAL/
└── 14-workflow.md               # 增强：添加强制自测流程、失败处理、AI 工作标准
```

**文件关系**：

```
project_rules.md (入口)
    ↓
00-first-principles.md (必读第一：什么不能违反)
    ↓
14-workflow.md（增强版：如何自测和验证，已包含测试方法）
    ↓
10-project-identity.md → 11-architecture.md → ...
    ↓
平台文档（具体技术细节）
```

### 方案 B：增强现有文档

**优点**：

* 减少文件数量

* 信息集中

**缺点**：

* 文档会变得很长

* 不同关注点混在一起

**修改文件**：

* `14-workflow.md` 添加 AI 工作流章节

* `13-coding-standards.md` 添加第一级原则标记

* 在 `project_rules.md` 中强化测试要求

***

## 📝 推荐实施计划

### Phase 1: 建立第一级原则（优先级：🔴 最高）

**目标**：让 AI 明确知道什么是不可跳过的

**行动**：

1. 创建 `00-first-principles.md`
2. 从现有文档中提取"绝对禁止"和"必须遵守"的规则
3. 添加优先级标记系统：

   * 🔴 **L0-禁止违反**：架构原则（Proto-First、No StatefulWidget）

   * 🚨 **L1-必须执行**：验证步骤（Lint、Build、Test）

   * ⭐️ **L2-强烈建议**：最佳实践（日志规范、错误处理）

   * 💡 **L3-建议采纳**：优化建议（代码组织、性能优化）

**文档结构**：

```markdown
# 第一级原则：不可违反的规则

## 🔴 L0：架构原则（禁止违反）
- Proto-First：所有模型必须用 Proto 定义
- No StatefulWidget：禁止使用 StatefulWidget
- Package Imports Only：禁止相对导入
...

## 🚨 L1：验证步骤（必须执行）
### 代码完成后必须：
1. ✅ Lint Check：`flutter analyze` / `gofmt`
2. ✅ Build Check：确保编译通过
3. ✅ Test Check：运行相关测试
4. ✅ Manual Verification：功能自测

## ⭐️ L2：最佳实践（强烈建议）
...

## 💡 L3：优化建议（可选）
...
```

### Phase 2: 增强工作流文档（优先级：🟠 高）

**目标**：在现有 `14-workflow.md` 中明确 AI 必须执行的验证步骤

**行动**：

1. 在 `14-workflow.md` 中添加"AI 强制验证流程"章节
2. 明确标注哪些步骤是 🚨 不可跳过的
3. 添加自测失败的处理流程
4. 提供"任务完成"报告模板

**需要添加的章节**：

#### 在 "Quality Assurance Workflow" 之前添加：

````markdown
## 🤖 AI Agent 工作流程（必读）

### ⚠️ 重要：任务完成标准

**只有满足以下所有条件，才能向用户报告"任务完成"：**

1. ✅ **代码实现**：功能已完全实现，符合需求
2. 🚨 **Lint 通过**：无任何 lint 错误或警告
3. 🚨 **Build 成功**：代码能够成功编译/构建
4. 🚨 **测试通过**：所有相关测试运行通过
5. ✅ **功能验证**：已手动测试，功能正常工作

**如果任何一项未通过，必须先修复，不得报告"完成"。**

---

### 📋 强制验证步骤（按顺序执行）

#### Step 1: 🚨 Lint Check（必须）

**Client (Dart/Flutter)**:
```bash
cd client/desktop  # 或 client/mobile
flutter analyze
````

**Station (Go)**:

```bash
cd station
gofmt -l .  # 应该无输出
```

**期望结果**：无错误、无警告

**如果失败**：

* 阅读所有 lint 错误信息

* 逐一修复每个问题

* 重新运行 lint 直到通过

* **不要跳过此步骤**

***

#### Step 2: 🚨 Build Check（必须）

**Client (Desktop)**:

```bash
cd client/desktop

# macOS
flutter build macos --debug

# Windows
flutter build windows --debug

# Linux
flutter build linux --debug
```

**Station**:

```bash
cd station/app
go build -o /tmp/station-test .
```

**期望结果**：构建成功，无编译错误

**如果失败**：

* 仔细阅读编译错误信息

* 检查导入语句是否正确

* 检查类型是否匹配

* 修复所有错误后重新构建

* **不要跳过此步骤**

***

#### Step 3: 🚨 Test Check（必须）

**Client**:

```bash
cd client/desktop  # 或 client/mobile
flutter test
```

**Station**:

```bash
cd station
go test ./...
```

**期望结果**：所有测试通过

**如果失败**：

* 分析失败的测试用例

* 判断是代码问题还是测试问题

* 修复代码或更新测试

* 重新运行测试直到全部通过

* 如果无法修复，**不要报告"完成"**，而是向用户说明情况并请求指导

***

#### Step 4: ✅ 功能验证（建议）

* 手动运行应用

* 验证实现的功能是否正常工作

* 检查日志输出是否有异常

* 测试边界情况和错误处理

***

### 📝 完成报告模板

**只有在所有强制步骤（🚨）都通过后，才使用此模板向用户报告：**

```
✅ 任务已完成

## 实施内容
- [列出实现的主要功能和修改]

## 验证结果
- ✅ Lint Check: 通过（0 errors, 0 warnings）
- ✅ Build Check: 编译成功
- ✅ Test Check: 所有测试通过 (X passed / Y total)
- ✅ 功能验证: 已手动测试，运行正常

## 修改的文件
- [file1.dart](file:///path/to/file1.dart)
- [file2.go](file:///path/to/file2.go)

## 注意事项
- [如有需要，列出使用注意事项或已知限制]
```

***

### 🔧 失败处理流程

#### Lint 失败处理

```
1. 仔细阅读所有 lint 错误/警告
2. 理解每个问题的含义
3. 按照项目规范修复（参考 13-coding-standards.md）
4. 重新运行 flutter analyze / gofmt
5. 重复直到通过
6. ⚠️ 不要报告"完成"直到 lint 通过
```

#### Build 失败处理

```
1. 查看完整的编译错误输出
2. 定位第一个错误（后续错误可能是连锁反应）
3. 检查导入、类型、语法
4. 修复后重新构建
5. ⚠️ 不要报告"完成"直到构建成功
```

#### Test 失败处理

```
1. 运行 flutter test -v / go test -v 查看详细信息
2. 分析失败原因：
   - 是新代码引入的 bug？
   - 是测试用例需要更新？
   - 是测试数据不匹配？
3. 修复问题（代码或测试）
4. 重新运行测试
5. 如果多次尝试仍失败，向用户报告：
   "⚠️ 实现已完成，但测试失败。失败信息：[...]
    需要您的指导：是修改代码还是更新测试？"
```

***

### 🚫 常见错误（避免）

❌ **错误示例 1**：实现完就报告完成

```
"我已经完成了功能实现，代码在 xxx.dart"
（没有运行任何验证）
```

✅ **正确做法**：

```
实现 → Lint → Build → Test → 功能验证 → 报告完成
```

***

❌ **错误示例 2**：遇到 lint 错误就问用户

```
"lint 报了几个错误，需要修复吗？"
```

✅ **正确做法**：

```
自动修复所有 lint 错误，不需要询问
```

***

❌ **错误示例 3**：跳过测试

```
"功能已实现并手动测试通过"
（没有运行 flutter test / go test）
```

✅ **正确做法**：

```
必须运行自动化测试，即使手动测试通过
```

````

#### 在 "Quality Checklist" 中添加：
```markdown
### AI 自检清单（每次完成任务时必查）

完成代码实现后，逐项检查：

- [ ] 🚨 运行了 Lint Check 并通过
- [ ] 🚨 运行了 Build Check 并成功
- [ ] 🚨 运行了 Test Check 并通过
- [ ] ✅ 进行了功能验证
- [ ] 📝 准备了完成报告（包含验证结果）
- [ ] ⚠️ 如有失败，已修复或向用户说明

**只有全部勾选后，才能向用户报告"完成"。**
````

### Phase 3: 补充 qa/ 测试脚本说明（可选，优先级：🟢 低）

**目标**：如果需要，可以在 14-workflow\.md 中添加 qa/ 脚本的简单说明

**现状**：

* 14-workflow\.md 已包含基本测试命令（flutter test / go test）

* qa/ 目录下有集成测试脚本，但不是 AI 日常必须运行的

**可选行动**：
在 14-workflow\.md 的"Test Check"章节添加一个"高级测试"小节：

````markdown
#### Advanced Testing (Optional)

**API Integration Tests** (for Station):
```bash
# Full integration test suite
cd qa/station
./run_docker_tests.sh

# Specific API tests
./api_tests/friend_chat_test.sh
./api_tests/health_test.sh
````

**Proto Validation**:

```bash
./test_proto_api.sh
./test_proto_final.sh
```

These are typically run in CI/CD or when making significant changes.
Not required for every code change.

```
```

**注意**：这不是必须的，因为 AI 主要需要关注的是 lint/build/unit test 三步骤。

***

### Phase 4: 更新入口文档（优先级：🟡 中）

**目标**：确保新规范能被 AI 发现和使用

**行动**：

1. 更新 `.trae/rules/project_rules.md`
2. 更新 `.prompts/00-META/INDEX.md`
3. 在 `14-workflow.md` 中添加引用

**project\_rules.md 修改**：

```markdown
## 🎯 Quick Start for AI

**ALWAYS READ THESE FIRST (in order):**

1. 🔴 **[00-first-principles.md]** - L0/L1 级规则（不可违反）
2. 🚨 **[14-workflow.md]** - 工作流程（包含强制自测步骤）
3. **[10-project-identity.md]** - What is Peers-Touch?
4. **[12-domain-model.md]** - Proto-based models

**Then read based on your task:**
- **Desktop work**: [21.0-base.md]
- **Mobile work**: [22.0-base.md]
- **Station work**: [30-station-base.md] + [35-lib-usage.md]
```

**INDEX.md 修改**：

```markdown
## 🗂️ Directory Structure

```

.prompts/
├── 00-META/
│   └── INDEX.md
│
├── 10-GLOBAL/
│   ├── 00-first-principles.md     # 🔴 第一级原则（必读第一）
│   ├── 10-project-identity.md
│   ├── ...
│   └── 14-workflow\.md              # 🚨 工作流程（含强制自测+测试方法）
...

```

---

## 📈 实施优先级

### 立即实施（本周完成）
1. ✅ **创建 00-first-principles.md**
   - 影响：让 AI 立即知道什么是不可违反的
   - 工作量：2-3 小时（整理现有规则）

2. ✅ **增强 14-workflow.md**
   - 影响：确保 AI 完成任务后必须自测
   - 工作量：2-3 小时（添加 AI 强制验证流程章节）

### 短期实施（本月完成）
3. ✅ **更新入口文档**
   - 影响：确保新规范被发现
   - 工作量：1 小时
   - 修改 project_rules.md 和 INDEX.md

### 可选项（低优先级）
4. 💡 **补充 qa/ 测试脚本说明**（可选）
   - 影响：让 AI 了解集成测试脚本
   - 工作量：0.5 小时
   - 注：不是必须的，因为 AI 主要关注 unit test

### 持续改进
5. 🔄 **在现有文档中添加优先级标记**
   - 在各个专项文档中标注 🔴/🚨/⭐️/💡
   - 随时更新和完善

---

## 🎓 AI 学习路径优化

### 当前路径（存在问题）
```

project\_rules.md → 10/11/12/13/14 → 平台文档 → 开始工作 → ❓不知道如何自测
（14-workflow\.md 存在但自测要求不够明确）

```

### 改进后路径（清晰明确）
```

project\_rules.md
↓
00-first-principles.md (知道什么不能违反)
↓
14-workflow\.md（增强版，明确自测流程）
↓
10/11/12/13 (理解项目)
↓
平台文档 (学习具体技术)
↓
开始工作 → 按照 14-workflow\.md 强制自测 → ✅ 完成

```

---

## 📋 验收标准

改进完成后，AI 应该能够：

✅ **知道什么是第一级原则**
   - 能够列出 L0/L1 级规则
   - 在编码时自动遵守

✅ **知道如何自测**
   - 完成代码后自动运行 Lint/Build/Test
   - 测试失败时知道如何处理
   - 只有在全部通过后才报告完成

✅ **知道如何测试**
   - 能够找到正确的测试命令（14-workflow.md 中有）
   - 知道什么时候需要写测试
   - 理解测试是强制性的（flutter test / go test）

✅ **知道优先级**
   - 能够区分"必须"和"建议"
   - 遇到冲突时知道哪个优先级更高

---

## 🔍 质量保证

新文档必须满足：

1. **可发现性**
   - 从 project_rules.md 可以找到
   - 从 INDEX.md 可以导航到
   - 在相关文档中有交叉引用

2. **可理解性**
   - 结构清晰，章节明确
   - 有具体示例和命令
   - 使用图标和标记提高可读性

3. **可执行性**
   - 所有命令都经过验证可以运行
   - 所有路径都是正确的
   - 所有测试脚本都存在

4. **一致性**
   - 与现有文档风格一致
   - 术语使用统一
   - 格式规范统一

---

## 📅 时间表

| 阶段 | 任务 | 预计时间 | 负责人 | 状态 |
|------|------|---------|--------|------|
| Phase 1 | 创建 00-first-principles.md | 2-3h | - | ⏳ Pending |
| Phase 2 | 增强 14-workflow.md | 2-3h | - | ⏳ Pending |
| Phase 3 | 更新入口文档 | 1h | - | ⏳ Pending |
| Review | 文档审查和调整 | 1h | - | ⏳ Pending |
| **总计** | | **6-8h** | | |

---

## 🔄 后续维护

1. **定期审查**（每月）
   - 检查文档是否与实际代码实践一致
   - 根据反馈更新和改进

2. **收集反馈**
   - AI 使用过程中的困惑点
   - 开发者的实际需求
   - 新的最佳实践

3. **版本管理**
   - 在 CHANGELOG.md 中记录更改
   - 保持版本号更新

---

## 📚 参考资料

### 现有资源
- `.prompts/10-GLOBAL/14-workflow.md` - 现有工作流（✅ 已包含测试方法）
- `.prompts/10-GLOBAL/13-coding-standards.md` - 编码规范
- `.prompts/30-STATION/35-lib-usage.md` - Station 库使用规范
- `qa/station/api_tests/` - 集成测试脚本（可选，不是 AI 日常必须）
- `client/*/test/` - 客户端单元测试用例
- `station/*_test.go` - Go 单元测试

---

## 💡 额外建议（可选，非必须）

### 1. 考虑添加"常见错误"文档
**位置**：`.prompts/10-GLOBAL/17-common-mistakes.md`

**内容**：
- AI 经常犯的错误及修复方法
- Lint 常见错误的解决方案
- Build 失败的常见原因

**优先级**：低，可以在实际使用中收集错误案例后再创建

### 2. 建立"快速参考卡"
**位置**：`.prompts/00-META/QUICK-REF.md`

**内容**：
- 常用命令速查
- 重要路径速查
- 紧急问题处理

**优先级**：低，现有文档已经够用

---

## ✅ 总结

**核心问题**：
1. AI 不知道完成任务后必须自测
2. 测试方法不清晰
3. 第一级原则不明确

**解决方案**：
1. 创建 00-first-principles.md（第一级原则）
2. 增强 14-workflow.md（添加 AI 强制自测流程）
3. 更新入口文档确保可发现性

**注意**：14-workflow.md 已包含完整的测试方法，无需新建测试指南文档

**预期效果**：
- AI 完成任务后自动执行 Lint/Build/Test
- AI 知道什么是不可违反的规则
- AI 能够找到并使用正确的测试方法
- 代码质量显著提高，bug 减少

---

*计划创建日期：2026-02-22*  
*预计完成日期：2026-03-01*  
*文档版本：1.0*
```


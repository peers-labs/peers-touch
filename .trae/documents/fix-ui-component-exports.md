# peers_touch_ui 包重构方案 - 统一、干净、合理

## 问题分析

### 1. 核心问题
Desktop 项目编译失败，报告大量组件找不到或导入冲突：
- `TextBox`、`PasswordBox`、`PrimaryButton` 等基础输入组件找不到
- `SearchInput`、`RefreshableList`、`PeersImage` 等扩展组件找不到
- `ReplyMessage`、`ThreadPanel` 等聊天相关组件找不到
- `Avatar` 和 `Scaffold` 存在导入冲突（peers_touch_base vs peers_touch_ui, Flutter Material vs peers_touch_ui）

### 2. 根本原因

#### 2.1 组件存在但未导出
通过检查发现，所有报错的组件**实际存在**于 `peers_touch_ui` 包中，但位于 `lib/src/` 目录下：

**存在的组件列表：**
```
lib/src/widgets/
├── textbox.dart
├── password_box.dart
├── button.dart (PrimaryButton 可能在此)
├── search_input.dart
├── refreshable_list.dart
├── peers_image.dart
├── icon_tabs.dart
├── tabs.dart
├── checkbox.dart
├── dropdown.dart
├── slider.dart
├── number.dart
├── notice.dart
└── ...

lib/src/chat/
├── reply_preview.dart (ReplyMessage 可能在此)
├── thread_panel.dart (ThreadPanel 在此)
├── mention_input.dart
└── chat.dart

lib/src/context_menu/
├── context_menu.dart (MessageContextMenu 可能在此)
├── context_menu_action.dart
└── context_menu_trigger.dart

lib/src/emoji/
├── emoji.dart
└── emoji_sticker_picker.dart (SimpleEmojiPicker 可能在此)
```

#### 2.2 导出结构分析
当前 `peers_touch_ui` 的导出结构：

```dart
// lib/peers_touch_ui.dart
export 'tokens/tokens.dart';
export 'foundation/foundation.dart';
export 'mobile/mobile.dart';
export 'desktop/desktop.dart';
```

**问题：`lib/src/` 目录下的所有组件都没有被导出！**

### 3. 为什么会删除/隐藏这些组件？

根据包结构分析，这些组件**并非被删除**，而是：

#### 3.1 架构设计意图
`lib/src/` 是 Dart 包的**私有实现**目录惯例：
- `lib/` 下的文件默认是公开API
- `lib/src/` 下的文件默认是内部实现
- 必须通过显式 `export` 才能暴露给外部使用

#### 3.2 可能的历史原因
1. **重构中的中间状态**：
   - 可能正在从旧UI库迁移到新的设计系统
   - `lib/src/` 中的组件是旧版本或待废弃的实现
   - 新的简化组件在 `lib/foundation/` 中

2. **设计系统分层**：
   - `foundation/` - 基础原子组件（Button, Input, Card等）
   - `desktop/` - Desktop平台特定组件
   - `mobile/` - Mobile平台特定组件
   - `src/` - 复杂业务组件或待整合的组件

3. **避免API膨胀**：
   - 限制公开API表面
   - 只暴露稳定、经过设计的组件
   - 避免业务代码依赖不稳定的实现

### 4. Desktop 项目的依赖方式

Desktop 项目通过两种方式使用UI组件：

#### 4.1 直接依赖 peers_touch_ui
```dart
import 'package:peers_touch_ui/peers_touch_ui.dart';
```
只能访问公开导出的组件（foundation + desktop + mobile）

#### 4.2 通过 ui_kit.dart 封装
Desktop 项目有自己的 `app/theme/ui_kit.dart`，提供：
- 统一的尺寸和间距
- 主题相关的样式函数
- 按钮、输入框等组件的统一样式

**但这只是样式封装，并非组件实现**

## 唯一方案：清晰的三层架构

### 架构原则

1. **职责清晰**：每个目录有明确的职责和边界
2. **无历史包袱**：移除 `src/` 目录，所有组件都是公开API
3. **功能不变**：保持所有组件的功能和API不变，只调整目录结构
4. **易于维护**：清晰的导出和依赖关系

### 目标架构

```
peers_touch_ui/
├── lib/
│   ├── tokens/              # 设计令牌（颜色、间距、圆角、阴影、字体）
│   ├── foundation/          # 基础原子组件（适用所有平台）
│   │   ├── button.dart      # 基础Button（非业务特定）
│   │   ├── input.dart       # 基础Input
│   │   ├── card.dart        # 基础Card
│   │   ├── avatar.dart      # 基础Avatar
│   │   ├── badge.dart
│   │   ├── tag.dart
│   │   ├── divider.dart
│   │   └── icon.dart
│   ├── widgets/             # 业务通用组件（跨平台复用）
│   │   ├── textbox.dart     # 业务输入框（带label、copy等功能）
│   │   ├── password_box.dart
│   │   ├── search_input.dart
│   │   ├── peers_image.dart
│   │   ├── refreshable_list.dart
│   │   ├── icon_tabs.dart
│   │   ├── tabs.dart
│   │   ├── checkbox.dart
│   │   ├── dropdown.dart
│   │   ├── slider.dart
│   │   ├── number.dart
│   │   ├── notice.dart
│   │   ├── buttons.dart     # PrimaryButton、SecondaryButton等业务按钮
│   │   └── widgets.dart     # 统一导出
│   ├── chat/                # 聊天相关组件（跨平台）
│   │   ├── reply_preview.dart
│   │   ├── thread_panel.dart
│   │   ├── mention_input.dart
│   │   ├── emoji_picker.dart
│   │   └── chat.dart        # 统一导出
│   ├── context_menu/        # 上下文菜单组件
│   │   ├── context_menu.dart
│   │   ├── context_menu_action.dart
│   │   ├── context_menu_trigger.dart
│   │   └── context_menu.dart # 统一导出
│   ├── desktop/             # Desktop平台特定组件
│   ├── mobile/              # Mobile平台特定组件
│   └── peers_touch_ui.dart  # 主导出文件
```

### 组件分类规则

#### 1. **foundation/** - 基础原子组件
**定义**：最基本的UI元素，无业务逻辑，只有视觉样式和基础交互
**特点**：
- 纯视觉组件
- API简单明确
- 适用所有场景
- 已经存在且稳定

**当前组件**：
- Button（基础按钮，接受type/size等参数）
- Input（基础输入框）
- Card、Avatar、Badge、Tag、Divider、Icon

#### 2. **widgets/** - 业务通用组件
**定义**：基于foundation构建，包含业务逻辑，跨平台复用
**特点**：
- 包含业务功能（如TextBox的copy按钮、label显示）
- 基于foundation组件构建
- 跨desktop和mobile复用
- 从 `src/widgets/` 迁移而来

**将迁移的组件**：
- TextBox（带label、copy功能的输入框）
- PasswordBox（密码输入框）
- PrimaryButton、SecondaryButton（业务按钮样式）
- SearchInput（搜索输入框）
- PeersImage（图片组件）
- RefreshableList（可刷新列表）
- IconTabs、Tabs（标签页组件）
- Checkbox、Dropdown、Slider、Number、Notice等

#### 3. **chat/** - 聊天功能模块
**定义**：聊天相关的复杂组件
**特点**：
- 专门服务于聊天功能
- 包含复杂交互逻辑
- 跨平台复用

**将迁移的组件**：
- ReplyPreview（回复预览）
- ThreadPanel（线程面板）
- MentionInput（@提及输入）
- EmojiPicker（表情选择器）

#### 4. **context_menu/** - 右键菜单模块
**定义**：上下文菜单相关组件
**从 `src/context_menu/` 迁移而来**

### 实施步骤

#### 步骤1：创建 widgets/ 目录结构
```bash
# 将 src/widgets/ 移动到 widgets/
mv lib/src/widgets/* lib/widgets/
```

#### 步骤2：创建 chat/ 目录结构
```bash
# 将 src/chat/ 移动到 chat/
mv lib/src/chat/* lib/chat/
```

#### 步骤3：创建 context_menu/ 目录结构
```bash
# 将 src/context_menu/ 移动到 context_menu/
mv lib/src/context_menu/* lib/context_menu/
```

#### 步骤4：移动其他 src/ 组件
```bash
# emoji 和 layout 等组件根据功能归类
mv lib/src/emoji/* lib/widgets/  # 或创建独立的 emoji/ 目录
```

#### 步骤5：创建统一导出文件

**lib/widgets/widgets.dart**
```dart
export 'textbox.dart';
export 'password_box.dart';
export 'buttons.dart';  // PrimaryButton、SecondaryButton
export 'search_input.dart';
export 'peers_image.dart';
export 'refreshable_list.dart';
export 'icon_tabs.dart';
export 'tabs.dart';
export 'checkbox.dart';
export 'dropdown.dart';
export 'slider.dart';
export 'number.dart';
export 'notice.dart';
export 'gallery.dart';
export 'image.dart';
export 'heatmap.dart';
export 'line_chart.dart';
export 'donut_chart.dart';
export 'chip.dart';
```

**lib/chat/chat.dart** (更新)
```dart
export 'reply_preview.dart';
export 'thread_panel.dart';
export 'mention_input.dart';
// 不导出 chat.dart 自身，避免循环
```

**lib/context_menu/context_menu.dart** (更新)
```dart
export 'context_menu.dart' hide ContextMenu; // 避免循环
export 'context_menu_action.dart';
export 'context_menu_trigger.dart';
// 或者重命名为 context_menu_exports.dart
```

#### 步骤6：更新主入口导出

**lib/peers_touch_ui.dart**
```dart
export 'tokens/tokens.dart';
export 'foundation/foundation.dart';
export 'widgets/widgets.dart';      // 新增
export 'chat/chat.dart';            // 新增
export 'context_menu/context_menu.dart'; // 新增
export 'desktop/desktop.dart';
export 'mobile/mobile.dart';
```

#### 步骤7：删除 src/ 目录
```bash
rm -rf lib/src/
```

#### 步骤8：处理命名冲突

**Avatar 冲突处理**：
- 决策：**使用 peers_touch_ui 的 Avatar**
- peers_touch_base 的 Avatar 功能应该由 peers_touch_ui 提供
- 在 desktop 项目中：
  ```dart
  // 不从 peers_touch_base 导入 Avatar
  import 'package:peers_touch_ui/peers_touch_ui.dart'; // 使用这个 Avatar
  ```

**Scaffold 冲突处理**：
- 决策：**desktop 项目使用 Material 的 Scaffold**
- peers_touch_ui 的 Scaffold 重命名为 UIScaffold 或 DesktopScaffold
- 在 desktop/desktop.dart 中：
  ```dart
  export 'layout/scaffold.dart' show DesktopScaffold;  // 重命名导出
  ```

#### 步骤9：更新组件内部导入路径
- 所有组件内的相对导入改为包导入
- 例如：`import '../tokens/colors.dart'` → `import 'package:peers_touch_ui/tokens/colors.dart'`

#### 步骤10：验证编译
```bash
cd client/common/peers_touch_ui
flutter pub get
flutter analyze

cd ../../desktop  
flutter pub get
flutter analyze
```

## 具体执行清单

### 准备阶段

- [ ] 1. 备份当前代码到git分支
- [ ] 2. 确认所有测试通过（如有）
- [ ] 3. 创建 peers_touch_ui 工作分支

### 执行阶段

- [ ] 1. **创建目录结构**
  - 创建 `lib/widgets/` 目录
  - 创建 `lib/chat/` 目录（如不存在）
  - 创建 `lib/context_menu/` 目录（如不存在）

- [ ] 2. **迁移 widgets 组件**
  - 将 `lib/src/widgets/*` 移动到 `lib/widgets/`
  - 将 `src/widgets/button.dart` 重命名为 `widgets/buttons.dart`（包含PrimaryButton等）
  - 创建 `lib/widgets/widgets.dart` 导出文件

- [ ] 3. **迁移 chat 组件**
  - 将 `lib/src/chat/*` 移动到 `lib/chat/`  
  - 更新 `lib/chat/chat.dart` 导出文件

- [ ] 4. **迁移 context_menu 组件**
  - 将 `lib/src/context_menu/*` 移动到 `lib/context_menu/`
  - 创建或更新导出文件（避免循环导入）

- [ ] 5. **迁移 emoji 和其他组件**
  - 将 `lib/src/emoji/*` 移动到适当位置（widgets/ 或独立emoji/目录）
  - 将 `lib/src/layout/*` 移动到适当位置（可能不需要，检查后决定）
  - 将 `lib/src/icons/*` 移动到适当位置

- [ ] 6. **更新主入口文件**
  - 修改 `lib/peers_touch_ui.dart` 添加新模块导出
  - 确保导出顺序正确，避免循环依赖

- [ ] 7. **删除 src/ 目录**
  - 确认所有文件已迁移
  - 删除空的 `lib/src/` 目录

- [ ] 8. **处理命名冲突 - Avatar**
  - 在 `lib/foundation/foundation.dart` 中导出 Avatar
  - 在 desktop 项目中移除 `import 'package:peers_touch_base/widgets/avatar.dart'`
  - 统一使用 `import 'package:peers_touch_ui/peers_touch_ui.dart'` 中的 Avatar

- [ ] 9. **处理命名冲突 - Scaffold**
  - 将 `lib/desktop/layout/scaffold.dart` 中的 Scaffold 类重命名为 DesktopScaffold
  - 更新 `lib/desktop/layout/layout.dart` 的导出
  - 在 desktop 项目中更新引用（如有）

- [ ] 10. **更新组件内部导入**
  - 将所有相对导入改为包导入
  - 例如：`../tokens/colors.dart` → `package:peers_touch_ui/tokens/colors.dart`

- [ ] 11. **修复 desktop 项目导入**
  - 移除不再需要的 ui_kit 组件构造代码（TextBox等现在可直接导入）
  - 更新所有使用 src/ 组件的导入语句
  - 统一使用 `package:peers_touch_ui/peers_touch_ui.dart`

### 验证阶段

- [ ] 12. **peers_touch_ui 包验证**
  ```bash
  cd client/common/peers_touch_ui
  flutter pub get
  flutter analyze
  flutter test
  ```

- [ ] 13. **desktop 项目验证**
  ```bash
  cd client/desktop
  flutter pub get
  flutter analyze
  flutter build macos --debug
  ```

- [ ] 14. **运行时测试**
  - 启动 desktop 应用
  - 测试 TextBox、PasswordBox 等输入组件
  - 测试 PrimaryButton、SecondaryButton 等按钮
  - 测试 Avatar、SearchInput 等其他组件
  - 测试聊天功能（ReplyMessage、ThreadPanel 等）
  - 测试右键菜单（ContextMenu）

- [ ] 15. **文档更新**
  - 更新 peers_touch_ui README
  - 添加新架构说明
  - 添加组件使用示例

### 收尾阶段

- [ ] 16. **代码审查**
  - 检查是否有遗漏的相对导入
  - 检查是否有未使用的导入
  - 确认命名一致性

- [ ] 17. **提交代码**
  - git add 所有更改
  - 提交清晰的 commit message
  - 如需要，创建 Pull Request

## 注意事项

1. **兼容性**：
   - 导出新组件可能影响现有代码
   - 需要仔细测试所有功能模块

2. **命名冲突**：
   - Avatar 冲突需要明确处理策略
   - Scaffold 可能需要重命名

3. **版本管理**：
   - peers_touch_ui 版本从 0.0.1 升级到 0.1.0
   - 需要在 desktop 的 pubspec.yaml 中更新（已自动更新）

4. **文档更新**：
   - 导出新组件后需要更新 README
   - 添加组件使用示例

## 风险评估

### 高风险项：
- Avatar 和 Scaffold 的冲突可能影响大量文件
- ReplyMessage 等类型缺失可能涉及聊天功能核心逻辑

### 中风险项：
- src/ 组件可能存在未完成的重构
- 组件API可能不稳定

### 低风险项：
- 基础输入组件（TextBox, PasswordBox）相对稳定
- 导出操作本身风险低

## 预期结果

执行本方案后：
- ✅ **清晰的三层架构**：tokens → foundation → widgets/chat/context_menu → desktop/mobile
- ✅ **无历史包袱**：完全移除 src/ 目录
- ✅ **功能完全保留**：所有组件功能和API不变，只是目录位置调整
- ✅ **命名冲突解决**：Avatar 统一使用 peers_touch_ui，Scaffold 重命名为 DesktopScaffold
- ✅ **编译通过**：desktop 项目可以正常编译和运行
- ✅ **易于维护**：清晰的模块划分和导出结构
- ✅ **未来扩展友好**：新组件知道应该放在哪个目录

## 架构优势

### 对比旧架构

**旧架构问题**：
```
lib/
├── src/              # ❌ 私有目录，组件不可访问
│   ├── widgets/      # ❌ 业务组件被隐藏
│   ├── chat/         # ❌ 聊天组件被隐藏
│   └── context_menu/ # ❌ 菜单组件被隐藏
├── foundation/       # ✅ 基础组件
├── desktop/          # ✅ 桌面组件
└── mobile/           # ✅ 移动组件
```

**新架构优势**：
```
lib/
├── tokens/           # ✅ 设计令牌
├── foundation/       # ✅ 基础原子组件
├── widgets/          # ✅ 业务通用组件（公开）
├── chat/             # ✅ 聊天功能模块（公开）
├── context_menu/     # ✅ 菜单功能模块（公开）
├── desktop/          # ✅ 桌面特定组件
└── mobile/           # ✅ 移动特定组件
```

### 模块职责清晰

1. **tokens/** - 设计系统基础
   - 颜色、间距、圆角、阴影、字体
   - 被所有组件依赖

2. **foundation/** - 原子组件
   - 最基础的UI元素
   - 无业务逻辑
   - Button、Input、Card等

3. **widgets/** - 业务通用组件
   - 基于foundation构建
   - 包含业务逻辑
   - TextBox、PrimaryButton等

4. **chat/** - 聊天功能模块
   - 专门的聊天组件
   - ReplyPreview、ThreadPanel等

5. **context_menu/** - 菜单功能模块
   - 右键菜单相关
   - ContextMenu、ContextMenuAction等

6. **desktop/mobile/** - 平台特定
   - 各平台独有组件
   - 布局、导航等

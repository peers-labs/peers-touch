
# 桌面端表情包组件重构 - 实现计划

## 概述
本计划参考微信表情选择器的设计，对桌面端表情选择器组件进行重构，并将组件移到 `client/common/peers_touch_ui` 公共 UI 库的 `components/media/` 目录下以便复用。

## 微信表情选择器核心特性（根据截图分析）
1. **最近使用表情**：顶部区域展示最近使用的表情
2. **主表情网格**：按分类组织的整洁网格布局
3. **底部标签导航**：用于切换表情/贴纸/收藏等不同分类
4. **搜索功能**：顶部搜索栏快速查找特定表情

---

## 任务列表

### [ ] 任务 0：将表情组件移动到 peers_touch_ui 的 components/media/
- **优先级**：P0
- **依赖**：无
- **描述**：
  - 在 `client/common/peers_touch_ui/lib/components/media/` 中添加 emoji_picker.dart 文件
  - 迁移现有 emoji_picker_panel 的功能到公共 UI 库
  - 更新所有引用
- **成功标准**：
  - 表情组件位于 peers_touch_ui 的 components/media/
  - 所有现有引用正常工作
- **测试要求**：
  - `programmatic` TR-0.1：编译无错误
  - `human-judgment` TR-0.2：现有功能不受影响

### [ ] 任务 1：添加最近使用表情功能
- **优先级**：P0
- **依赖**：任务 0
- **描述**：
  - 添加存储和展示最近使用表情的功能
  - 使用本地存储保存最近使用的表情
  - 在选择器顶部展示最近使用表情区域
- **成功标准**：
  - 最近使用表情显示在表情选择器顶部
  - 最近使用表情在应用重启后仍然保留
- **测试要求**：
  - `programmatic` TR-1.1：验证最近使用表情正确保存和加载
  - `human-judgment` TR-1.2：最近使用表情区域可见且功能正常
- **备注**：使用现有的存储服务

### [ ] 任务 2：优化表情选择器 UI 布局（微信风格）
- **优先级**：P0
- **依赖**：任务 0
- **描述**：
  - 重构表情选择器结构以匹配微信的布局
  - 添加底部标签栏用于切换表情/贴纸/收藏等分类
  - 优化网格布局，添加合适的间距和样式
- **成功标准**：
  - 表情选择器具有简洁、微信风格的布局
  - 底部标签导航功能正常
- **测试要求**：
  - `human-judgment` TR-2.1：UI 符合微信的视觉风格
  - `programmatic` TR-2.2：底部标签可以正确切换不同分类

### [ ] 任务 3：添加搜索功能
- **优先级**：P1
- **依赖**：任务 2
- **描述**：
  - 在表情选择器顶部添加搜索栏
  - 根据搜索关键词过滤表情
- **成功标准**：
  - 搜索栏存在且功能正常
  - 用户输入时表情可以正确过滤
- **测试要求**：
  - `human-judgment` TR-3.1：可以通过表情名称搜索到各种表情
  - `programmatic` TR-3.2：搜索结果实时更新

### [ ] 任务 4：与桌面端集成
- **优先级**：P0
- **依赖**：任务 1、2
- **描述**：
  - 更新 FriendChatInputBar 使用新的公共表情组件
  - 更新 FriendChatPage 集成新的组件
  - 更新群聊使用新的组件
- **成功标准**：
  - 新表情选择器在单聊和群聊中都能正常工作
- **测试要求**：
  - `human-judgment` TR-4.1：在单聊中可以正常插入表情
  - `human-judgment` TR-4.2：在群聊中可以正常插入表情
- **备注**：同时更新单聊和群聊的输入栏

### [ ] 任务 5：添加收藏功能
- **优先级**：P1
- **依赖**：任务 1
- **描述**：
  - 允许用户收藏表情
  - 将收藏保存到本地存储
  - 在独立标签页中展示收藏
- **成功标准**：
  - 用户可以添加/移除收藏
  - 收藏在应用重启后仍然保留
- **测试要求**：
  - `programmatic` TR-5.1：收藏正确保存/加载到本地存储
  - `human-judgment` TR-5.2：收藏标签页显示已保存的表情

---

## 实现步骤
1. 从任务 0 开始：将组件移动到 peers_touch_ui 的 components/media/
2. 然后任务 1：实现最近使用表情功能
3. 然后任务 2：优化 UI 布局
4. 然后任务 4：与现有聊天功能集成
5. 最后任务 3 和 5：搜索和收藏功能

## 文件变更

### 需要创建的新文件
- `client/common/peers_touch_ui/lib/components/media/emoji_picker.dart` (公共组件)

### 需要修改的文件
- `client/desktop/lib/features/friend_chat/widgets/chat_input_bar.dart`
- `client/desktop/lib/features/friend_chat/view/friend_chat_page.dart`
- `client/desktop/lib/features/friend_chat/controller/friend_chat_controller.dart`

### 需要删除的文件
- `client/desktop/lib/features/friend_chat/widgets/emoji_picker_panel.dart`

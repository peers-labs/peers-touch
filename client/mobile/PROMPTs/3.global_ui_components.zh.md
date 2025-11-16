# 移动端全局 UI 组件规范

组件以语义化与复用为核心，遵循 Stateless + GetX 的状态驱动。下列为移动端重点组件清单与约束。

## 基础导航

- AppBar：左右动作位 + 中间标题；高度 56dp；支持搜索态/透明态
- BottomTabBar：5 个主入口；图标 + 标签；支持二次点击回到顶部与长按快捷
- Drawer：左侧模块目录；平板常驻；手机滑动呼出
- SegmentedTabs：模块内多子页签（如 Chat：全部/未读/置顶）

## 列表与卡片

- ListItem（通用）：头像/标题/副文本/辅助动作；支持滑动露出动作（删除/收藏）
- ChatListTile：会话头像、名称、未读数、最后消息与时间；置顶/免打扰标识
- CircleCard：圈子封面/名称/成员数/更新状态；点击进入详情
- FeedCard：动态内容（文本/图片/视频）、作者、时间、互动计数；支持转发评论

## 交流与输入

- MessageBubble：文本/图片/音频/文件；对齐（左/右）；状态（发送中/失败/已读）
- ConversationInput：文本输入 + 工具栏（表情、附件、AI）；语音输入可选
- Reply/Quote：针对消息的引用与回复气泡；长按唤出
- AI ToolPicker：工具列表（检索/摘要/翻译等），可在对话中调用

## 状态与反馈

- Skeleton：列表与详情占位；Shimmer 效果
- LoadingDialog：全局加载；支持遮罩与取消
- Snackbar/Toast：轻量提示；时长与位置可配置
- Badge：未读/新消息标记；密度适配

## 选择与表单

- CommonInput：通用输入框，含校验与清除
- Switch/Checkbox/Radio：统一语义与行为；支持禁用态
- DatePicker/TimePicker：移动端优化（滚轮/底部弹窗）

## 媒体与预览

- ImageViewer：支持双指缩放、拖拽关闭
- AudioPlayer：播放/暂停/进度；耳机/扬声器切换
- FileItem：文件类型图标 + 文件名 + 大小 + 下载/打开动作

## 通用组件约束

- 所有组件无业务倾向；业务状态由 Controller 驱动
- 交互反馈一致：Ripple/Highlight；动效时间与曲线统一
- 多语言通过 `LocaleKeys` 管理；文案统一英文注册
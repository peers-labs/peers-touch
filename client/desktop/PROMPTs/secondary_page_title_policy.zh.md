# 二级页功能标题显示规则（新增）

- 默认不在二级导航/侧栏重复显示功能标题（如“设置”）。
- 当前所在页通过一级菜单的高亮方形背景表达，无需二次显示。
- 如确需显示，可在页面注册时通过 `toDIsplayPageTitle` 参数开启；该参数默认值为 `false`。

示例（注册时关闭标题显示）：

```dart
PrimaryMenuItem(
  id: 'settings',
  title: l.settingsTitle,
  icon: PTIcons.settings,
  builder: () => const SettingPage(),
  toDIsplayPageTitle: false,
)
```

页面实现中读取该参数以决定是否在左侧二级导航区展示功能标题。
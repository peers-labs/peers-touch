import 'package:flutter/material.dart';

/// 设置项类型
enum SettingItemType {
  sectionHeader,  // 分区标题
  toggle,         // 开关
  select,         // 下拉选择
  textInput,      // 文本输入
  button,         // 按钮
  divider,        // 分割线
}

/// 设置项定义
class SettingItem {
  final String id;
  final String title;
  final String? description;
  final IconData? icon;
  final SettingItemType type;
  final dynamic value;
  final List<String>? options; // 用于select类型
  final String? placeholder;   // 用于textInput类型
  final VoidCallback? onTap;
  final ValueChanged<dynamic>? onChanged;

  const SettingItem({
    required this.id,
    required this.title,
    this.description,
    this.icon,
    required this.type,
    this.value,
    this.options,
    this.placeholder,
    this.onTap,
    this.onChanged,
  });
}

/// 设置分区定义
class SettingSection {
  final String id;
  final String title;
  final IconData? icon;
  final List<SettingItem> items;

  const SettingSection({
    required this.id,
    required this.title,
    this.icon,
    required this.items,
  });
}
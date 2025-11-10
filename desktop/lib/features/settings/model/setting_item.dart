import 'package:flutter/material.dart';

/// 设置项类型
enum SettingItemType {
  sectionHeader,  // 分区标题
  toggle,         // 开关
  select,         // 下拉选择
  textInput,      // 文本输入
  password,       // 密码输入
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
  final bool Function(List<SettingItem> allItems)? isVisible;

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
    this.isVisible,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'description': description,
        'icon': icon?.codePoint,
        'type': type.name,
        'value': value,
        'options': options,
        'placeholder': placeholder,
      };

  factory SettingItem.fromJson(Map<String, dynamic> json) => SettingItem(
        id: json['id'] as String,
        title: json['title'] as String,
        description: json['description'] as String?,
        icon: json['icon'] != null ? IconData(json['icon'] as int, fontFamily: 'MaterialIcons') : null,
        type: SettingItemType.values.firstWhere((e) => e.name == json['type']),
        value: json['value'],
        options: (json['options'] as List?)?.map((e) => e.toString()).toList(),
        placeholder: json['placeholder'] as String?,
      );
}

/// 设置分区定义
class SettingSection {
  final String id;
  final String title;
  final IconData? icon;
  final List<SettingItem> items;
  final Widget? page;

  const SettingSection({
    required this.id,
    required this.title,
    this.icon,
    this.items = const [],
    this.page,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'icon': icon?.codePoint,
        'items': items.map((e) => e.toJson()).toList(),
      };

  factory SettingSection.fromJson(Map<String, dynamic> json) => SettingSection(
        id: json['id'] as String,
        title: json['title'] as String,
        icon: json['icon'] != null ? IconData(json['icon'] as int, fontFamily: 'MaterialIcons') : null,
        items: (json['items'] as List).map((e) => SettingItem.fromJson(e as Map<String, dynamic>)).toList(),
      );
}
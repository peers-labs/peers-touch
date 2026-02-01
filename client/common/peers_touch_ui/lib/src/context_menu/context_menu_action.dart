import 'package:flutter/material.dart';

/// 上下文菜单项
class ContextMenuAction {
  const ContextMenuAction({
    required this.id,
    required this.label,
    required this.onTap,
    this.icon,
    this.iconColor,
    this.labelColor,
    this.isDestructive = false,
    this.isDisabled = false,
    this.shortcut,
  });

  /// 唯一标识
  final String id;

  /// 显示文本
  final String label;

  /// 点击回调
  final VoidCallback onTap;

  /// 图标
  final IconData? icon;

  /// 图标颜色
  final Color? iconColor;

  /// 文本颜色
  final Color? labelColor;

  /// 是否为危险操作（显示红色）
  final bool isDestructive;

  /// 是否禁用
  final bool isDisabled;

  /// 快捷键提示（仅桌面端显示）
  final String? shortcut;

  /// 复制并修改
  ContextMenuAction copyWith({
    String? id,
    String? label,
    VoidCallback? onTap,
    IconData? icon,
    Color? iconColor,
    Color? labelColor,
    bool? isDestructive,
    bool? isDisabled,
    String? shortcut,
  }) {
    return ContextMenuAction(
      id: id ?? this.id,
      label: label ?? this.label,
      onTap: onTap ?? this.onTap,
      icon: icon ?? this.icon,
      iconColor: iconColor ?? this.iconColor,
      labelColor: labelColor ?? this.labelColor,
      isDestructive: isDestructive ?? this.isDestructive,
      isDisabled: isDisabled ?? this.isDisabled,
      shortcut: shortcut ?? this.shortcut,
    );
  }

  /// 获取实际的图标颜色
  Color getIconColor(BuildContext context) {
    if (isDisabled) {
      return Theme.of(context).disabledColor;
    }
    if (isDestructive) {
      return Theme.of(context).colorScheme.error;
    }
    return iconColor ?? Theme.of(context).colorScheme.onSurface;
  }

  /// 获取实际的文本颜色
  Color getLabelColor(BuildContext context) {
    if (isDisabled) {
      return Theme.of(context).disabledColor;
    }
    if (isDestructive) {
      return Theme.of(context).colorScheme.error;
    }
    return labelColor ?? Theme.of(context).colorScheme.onSurface;
  }
}

/// 预定义的常用菜单项
class ContextMenuActions {
  ContextMenuActions._();

  /// 回复
  static ContextMenuAction reply(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'reply',
      label: '回复',
      icon: Icons.reply,
      onTap: onTap,
    );
  }

  /// 复制
  static ContextMenuAction copy(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'copy',
      label: '复制',
      icon: Icons.copy,
      onTap: onTap,
      shortcut: '⌘C',
    );
  }

  /// 转发
  static ContextMenuAction forward(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'forward',
      label: '转发',
      icon: Icons.forward,
      onTap: onTap,
    );
  }

  /// 删除
  static ContextMenuAction delete(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'delete',
      label: '删除',
      icon: Icons.delete_outline,
      onTap: onTap,
      isDestructive: true,
    );
  }

  /// 撤回
  static ContextMenuAction recall(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'recall',
      label: '撤回',
      icon: Icons.undo,
      onTap: onTap,
    );
  }

  /// 引用
  static ContextMenuAction quote(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'quote',
      label: '引用',
      icon: Icons.format_quote,
      onTap: onTap,
    );
  }

  /// 收藏
  static ContextMenuAction favorite(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'favorite',
      label: '收藏',
      icon: Icons.star_outline,
      onTap: onTap,
    );
  }

  /// 多选
  static ContextMenuAction multiSelect(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'multi_select',
      label: '多选',
      icon: Icons.check_box_outlined,
      onTap: onTap,
    );
  }

  /// 置顶
  static ContextMenuAction pin(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'pin',
      label: '置顶',
      icon: Icons.push_pin_outlined,
      onTap: onTap,
    );
  }

  /// 取消置顶
  static ContextMenuAction unpin(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'unpin',
      label: '取消置顶',
      icon: Icons.push_pin,
      onTap: onTap,
    );
  }

  /// 静音
  static ContextMenuAction mute(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'mute',
      label: '静音',
      icon: Icons.notifications_off_outlined,
      onTap: onTap,
    );
  }

  /// 取消静音
  static ContextMenuAction unmute(VoidCallback onTap) {
    return ContextMenuAction(
      id: 'unmute',
      label: '取消静音',
      icon: Icons.notifications,
      onTap: onTap,
    );
  }
}

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:peers_touch_ui/src/context_menu/context_menu_action.dart';

/// 平台自适应的上下文菜单触发器
///
/// Desktop: 右键点击显示弹出菜单
/// Mobile: 长按显示底部 Sheet
class ContextMenuTrigger extends StatelessWidget {
  const ContextMenuTrigger({
    super.key,
    required this.child,
    required this.actions,
    this.enabled = true,
    this.onTap,
    this.onDoubleTap,
    this.menuWidth = 200,
    this.sheetTitle,
  });

  /// 子组件
  final Widget child;

  /// 菜单项列表
  final List<ContextMenuAction> actions;

  /// 是否启用菜单
  final bool enabled;

  /// 单击回调
  final VoidCallback? onTap;

  /// 双击回调
  final VoidCallback? onDoubleTap;

  /// 菜单宽度（仅桌面端）
  final double menuWidth;

  /// 底部 Sheet 标题（仅移动端）
  final String? sheetTitle;

  bool get _isDesktop =>
      Platform.isMacOS || Platform.isWindows || Platform.isLinux;

  @override
  Widget build(BuildContext context) {
    if (!enabled || actions.isEmpty) {
      return GestureDetector(
        onTap: onTap,
        onDoubleTap: onDoubleTap,
        child: child,
      );
    }

    if (_isDesktop) {
      return _buildDesktopTrigger(context);
    } else {
      return _buildMobileTrigger(context);
    }
  }

  Widget _buildDesktopTrigger(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      onDoubleTap: onDoubleTap,
      onSecondaryTapDown: (details) {
        _showDesktopMenu(context, details.globalPosition);
      },
      child: child,
    );
  }

  Widget _buildMobileTrigger(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      onDoubleTap: onDoubleTap,
      onLongPress: () {
        _showMobileSheet(context);
      },
      child: child,
    );
  }

  void _showDesktopMenu(BuildContext context, Offset position) {
    final theme = Theme.of(context);
    final enabledActions = actions.where((a) => !a.isDisabled).toList();

    showMenu<String>(
      context: context,
      position: RelativeRect.fromLTRB(
        position.dx,
        position.dy,
        position.dx + 1,
        position.dy + 1,
      ),
      constraints: BoxConstraints(minWidth: menuWidth, maxWidth: menuWidth),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      elevation: 8,
      items: actions.map((action) {
        return PopupMenuItem<String>(
          value: action.id,
          enabled: !action.isDisabled,
          height: 40,
          child: Row(
            children: [
              if (action.icon != null) ...[
                Icon(
                  action.icon,
                  size: 18,
                  color: action.getIconColor(context),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: Text(
                  action.label,
                  style: TextStyle(
                    color: action.getLabelColor(context),
                    fontSize: 14,
                  ),
                ),
              ),
              if (action.shortcut != null)
                Text(
                  action.shortcut!,
                  style: TextStyle(
                    color: theme.colorScheme.onSurfaceVariant,
                    fontSize: 12,
                  ),
                ),
            ],
          ),
        );
      }).toList(),
    ).then((value) {
      if (value != null) {
        final action = actions.firstWhere((a) => a.id == value);
        action.onTap();
      }
    });
  }

  void _showMobileSheet(BuildContext context) {
    final theme = Theme.of(context);

    showModalBottomSheet(
      context: context,
      backgroundColor: theme.colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 拖动指示器
              Container(
                margin: const EdgeInsets.only(top: 8),
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: theme.colorScheme.outlineVariant,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),

              // 标题
              if (sheetTitle != null)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    sheetTitle!,
                    style: theme.textTheme.titleMedium,
                  ),
                ),

              // 菜单项
              ...actions.map((action) {
                return ListTile(
                  leading: action.icon != null
                      ? Icon(action.icon, color: action.getIconColor(context))
                      : null,
                  title: Text(
                    action.label,
                    style: TextStyle(color: action.getLabelColor(context)),
                  ),
                  enabled: !action.isDisabled,
                  onTap: action.isDisabled
                      ? null
                      : () {
                          Navigator.pop(context);
                          action.onTap();
                        },
                );
              }),

              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }
}

/// 消息操作菜单的快捷包装
class MessageContextMenu extends StatelessWidget {
  const MessageContextMenu({
    super.key,
    required this.child,
    this.onReply,
    this.onCopy,
    this.onForward,
    this.onDelete,
    this.onRecall,
    this.onQuote,
    this.onMultiSelect,
    this.canRecall = false,
    this.canDelete = false,
    this.enabled = true,
    this.onTap,
  });

  final Widget child;
  final VoidCallback? onReply;
  final VoidCallback? onCopy;
  final VoidCallback? onForward;
  final VoidCallback? onDelete;
  final VoidCallback? onRecall;
  final VoidCallback? onQuote;
  final VoidCallback? onMultiSelect;
  final bool canRecall;
  final bool canDelete;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final actions = <ContextMenuAction>[];

    if (onReply != null) {
      actions.add(ContextMenuActions.reply(onReply!));
    }
    if (onCopy != null) {
      actions.add(ContextMenuActions.copy(onCopy!));
    }
    if (onForward != null) {
      actions.add(ContextMenuActions.forward(onForward!));
    }
    if (onQuote != null) {
      actions.add(ContextMenuActions.quote(onQuote!));
    }
    if (onMultiSelect != null) {
      actions.add(ContextMenuActions.multiSelect(onMultiSelect!));
    }
    if (onRecall != null && canRecall) {
      actions.add(ContextMenuActions.recall(onRecall!));
    }
    if (onDelete != null && canDelete) {
      actions.add(ContextMenuActions.delete(onDelete!));
    }

    return ContextMenuTrigger(
      actions: actions,
      enabled: enabled,
      onTap: onTap,
      child: child,
    );
  }
}

/// 会话操作菜单的快捷包装
class SessionContextMenu extends StatelessWidget {
  const SessionContextMenu({
    super.key,
    required this.child,
    this.isPinned = false,
    this.isMuted = false,
    this.onPin,
    this.onMute,
    this.onDelete,
    this.enabled = true,
    this.onTap,
  });

  final Widget child;
  final bool isPinned;
  final bool isMuted;
  final VoidCallback? onPin;
  final VoidCallback? onMute;
  final VoidCallback? onDelete;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final actions = <ContextMenuAction>[];

    if (onPin != null) {
      actions.add(isPinned
          ? ContextMenuActions.unpin(onPin!)
          : ContextMenuActions.pin(onPin!));
    }
    if (onMute != null) {
      actions.add(isMuted
          ? ContextMenuActions.unmute(onMute!)
          : ContextMenuActions.mute(onMute!));
    }
    if (onDelete != null) {
      actions.add(ContextMenuActions.delete(onDelete!));
    }

    return ContextMenuTrigger(
      actions: actions,
      enabled: enabled,
      onTap: onTap,
      child: child,
    );
  }
}

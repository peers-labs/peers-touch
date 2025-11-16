import 'package:flutter/material.dart';
import 'package:peers_touch_desktop/app/theme/theme_tokens.dart';
import 'package:peers_touch_desktop/app/theme/ui_kit.dart';

/// 统一“框 + 按钮”组合组件
/// - 边框：使用一级菜单选中态的同款边框（WeChatTokens.divider，1px）
/// - 高度：与一级菜单选中边框的盒子高度一致（menuBarWidth * menuItemBoxRatio）
/// - 宽度：输入框占据父容器剩余空间，按钮为等高正方形
class FrameActionCombo extends StatelessWidget {
  final String? hintText;
  final TextEditingController? controller;
  final ValueChanged<String>? onChanged;
  final IconData? prefixIcon;
  final VoidCallback? onAction;
  final IconData actionIcon;

  const FrameActionCombo({
    super.key,
    this.hintText,
    this.controller,
    this.onChanged,
    this.prefixIcon,
    this.onAction,
    this.actionIcon = Icons.add,
  });

  @override
  Widget build(BuildContext context) {
    // 使用 WeChatTokens 计算统一高度与边框样式
    final tokens = Theme.of(context).extension<WeChatTokens>();
    final double boxSize = tokens != null
        ? tokens.menuBarWidth * tokens.menuItemBoxRatio
        : UIKit.controlHeightMd; // 兜底为全局控件高度
    final Color dividerColor = UIKit.dividerColor(context);
    final double radiusSm = UIKit.radiusSm(context);
    final double radiusMd = UIKit.radiusMd(context);

    return Row(
      children: [
        // 输入框
        Expanded(
          child: SizedBox(
            height: boxSize,
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              decoration: InputDecoration(
                hintText: hintText,
                isDense: true,
                filled: true,
                fillColor: UIKit.inputFillLight(context),
                contentPadding: EdgeInsets.symmetric(
                  horizontal: UIKit.spaceMd(context),
                  vertical: UIKit.spaceSm(context),
                ),
                prefixIcon:
                    prefixIcon != null ? Icon(prefixIcon, color: UIKit.textSecondary(context)) : null,
                border: UIKit.inputOutlineBorder(context),
                enabledBorder: UIKit.inputOutlineBorder(context),
                focusedBorder: UIKit.inputFocusedBorder(context),
              ),
            ),
          ),
        ),
        SizedBox(width: UIKit.spaceSm(context)),
        // 右侧操作按钮（可选）
        if (onAction != null)
          InkWell(
            onTap: onAction,
            borderRadius: BorderRadius.circular(radiusMd),
            child: Container(
              width: boxSize,
              height: boxSize,
              decoration: BoxDecoration(
                color: UIKit.assistantSidebarBg(context),
                borderRadius: BorderRadius.circular(radiusMd),
                border: Border.all(color: dividerColor, width: UIKit.dividerThickness),
              ),
              child: Icon(actionIcon, color: UIKit.textPrimary(context)),
            ),
          ),
      ],
    );
  }
}